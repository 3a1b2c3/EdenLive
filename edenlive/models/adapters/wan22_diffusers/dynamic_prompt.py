"""Wan bidirectional temporal text: explicit layouts, no mutable processor state."""

from __future__ import annotations

import bisect
from importlib.metadata import version

from edenlive.core.text_timeline import clip_text_timeline


def validate_config(config, variant):
    if not config.get("enabled", False):
        return
    if variant != "5b":
        raise ValueError("dynamic_prompt currently supports Wan 2.2 5B only")
    if config["backend"] != "flash4":
        raise ValueError("The reference dynamic prompt profile requires flash4")


def validate_environment(device, dtype):
    from .teacher_forcing_attention import validate_flash4_environment

    validate_flash4_environment(device, dtype)
    # Match the package used by the reference profile.
    if version("flash-attn-4") != "4.0.0b31":
        raise RuntimeError("dynamic_prompt flash4 requires flash-attn-4==4.0.0b31")
    from . import flash4_varlen  # noqa: F401


def frame_lengths(timeline, num_latent_frames: int) -> tuple[int, ...]:
    timeline = clip_text_timeline(
        timeline["segments"],
        start_sec=0,
        fps=timeline["fps"],
        num_frames=timeline["num_frames"],
    )
    expected = (num_latent_frames - 1) * 4 + 1
    if timeline["num_frames"] != expected:
        raise ValueError(
            f"text timeline has {timeline['num_frames']} decoded frames; Wan input requires {expected}"
        )
    # The latent at t covers the causal VAE interval ending at t. An exact
    # caption boundary belongs to the segment on its left; frame zero is first.
    ends = [s["end_sec"] for s in timeline["segments"]]
    counts = [0] * len(ends)
    for i in range(num_latent_frames):
        index = bisect.bisect_left(ends, i * 4 / timeline["fps"] - 1e-7)
        counts[index] += 1
    if any(n == 0 for n in counts):
        raise ValueError(
            "text segment is shorter than the Wan latent time resolution and receives no latent frames"
        )
    return tuple(counts)


def build_layout(timelines, *, latent_shape, patch_size, text_length, device):
    import torch

    batch_size, _, frames, height, width = latent_shape
    if len(timelines) != batch_size or int(patch_size[0]) != 1:
        raise ValueError(
            "dynamic prompt needs one timeline per sample and temporal patch size 1"
        )
    tokens_per_frame = (height // int(patch_size[1])) * (width // int(patch_size[2]))
    lengths = tuple(
        tuple(n * tokens_per_frame for n in frame_lengths(t, frames)) for t in timelines
    )
    flat = [n for sample in lengths for n in sample]
    cumulative = [0]
    for n in flat:
        cumulative.append(cumulative[-1] + n)
    return dict(
        lengths=lengths,
        text_length=int(text_length),
        cu_q=torch.tensor(cumulative, device=device, dtype=torch.int32),
        cu_k=torch.arange(len(flat) + 1, device=device, dtype=torch.int32)
        * text_length,
        max_q=max(flat),
    )


def cross_attention(attn, hidden_states, encoder_hidden_states, layout):
    import torch
    from diffusers.models.transformers.transformer_wan import _get_qkv_projections

    if attn.add_k_proj is not None:
        raise ValueError("dynamic prompt does not support added image K/V")
    q, k, v = _get_qkv_projections(attn, hidden_states, encoder_hidden_states)
    q = attn.norm_q(q).unflatten(2, (attn.heads, -1))
    k = attn.norm_k(k).unflatten(2, (attn.heads, -1))
    v = v.unflatten(2, (attn.heads, -1))
    lengths, text_length = layout["lengths"], layout["text_length"]
    from .flash4_varlen import varlen_fwd

    # Discard per-sample padding between prompt banks before the varlen call.
    packed_k = torch.cat(
        [k[i, : len(sample) * text_length] for i, sample in enumerate(lengths)]
    )
    packed_v = torch.cat(
        [v[i, : len(sample) * text_length] for i, sample in enumerate(lengths)]
    )
    out, _ = varlen_fwd(
        q.flatten(0, 1),
        packed_k,
        packed_v,
        layout["cu_q"],
        layout["cu_k"],
        layout["max_q"],
        text_length,
    )
    out = out.reshape_as(q)
    out = out.flatten(2, 3).type_as(q)
    return attn.to_out[1](attn.to_out[0](out))
