from __future__ import annotations

from typing import Any
import types

import torch

from edenlive.models.adapters.wan22_diffusers.teacher_forcing_attention import (
    flash4_attention,
)
from edenlive.runtime.distributed.sequence_parallel import (
    gather_sequence,
    get_sequence_parallel_state,
    split_sequence,
)


def _wan_imports():
    from diffusers.models.attention_dispatch import AttentionBackendName, dispatch_attention_fn
    from diffusers.models.modeling_outputs import Transformer2DModelOutput
    from diffusers.models.transformers.transformer_wan import _get_added_kv_projections, _get_qkv_projections

    return AttentionBackendName, Transformer2DModelOutput, dispatch_attention_fn, _get_added_kv_projections, _get_qkv_projections


def _apply_rotary_emb(hidden_states: torch.Tensor, freqs_cos: torch.Tensor, freqs_sin: torch.Tensor) -> torch.Tensor:
    x1, x2 = hidden_states.unflatten(-1, (-1, 2)).unbind(-1)
    cos = freqs_cos[..., 0::2]
    sin = freqs_sin[..., 1::2]
    out = torch.empty_like(hidden_states)
    out[..., 0::2] = x1 * cos - x2 * sin
    out[..., 1::2] = x1 * sin + x2 * cos
    return out.type_as(hidden_states)


def _offset_rotary_emb(model, hidden_states: torch.Tensor, start_frame: int = 0, *, num_frames: int | None = None):
    batch_size, _num_channels, input_frames, height, width = hidden_states.shape
    num_frames = input_frames if num_frames is None else num_frames
    p_t, p_h, p_w = model.config.patch_size
    ppf, pph, ppw = num_frames // p_t, height // p_h, width // p_w

    split_sizes = [model.rope.t_dim, model.rope.h_dim, model.rope.w_dim]
    freqs_cos = model.rope.freqs_cos.to(hidden_states.device).split(split_sizes, dim=1)
    freqs_sin = model.rope.freqs_sin.to(hidden_states.device).split(split_sizes, dim=1)

    end_frame = int(start_frame) + ppf
    freqs_cos_f = freqs_cos[0][start_frame:end_frame].view(ppf, 1, 1, -1).expand(ppf, pph, ppw, -1)
    freqs_cos_h = freqs_cos[1][:pph].view(1, pph, 1, -1).expand(ppf, pph, ppw, -1)
    freqs_cos_w = freqs_cos[2][:ppw].view(1, 1, ppw, -1).expand(ppf, pph, ppw, -1)

    freqs_sin_f = freqs_sin[0][start_frame:end_frame].view(ppf, 1, 1, -1).expand(ppf, pph, ppw, -1)
    freqs_sin_h = freqs_sin[1][:pph].view(1, pph, 1, -1).expand(ppf, pph, ppw, -1)
    freqs_sin_w = freqs_sin[2][:ppw].view(1, 1, ppw, -1).expand(ppf, pph, ppw, -1)

    freqs_cos_out = torch.cat([freqs_cos_f, freqs_cos_h, freqs_cos_w], dim=-1).reshape(
        1, ppf * pph * ppw, 1, -1
    )
    freqs_sin_out = torch.cat([freqs_sin_f, freqs_sin_h, freqs_sin_w], dim=-1).reshape(
        1, ppf * pph * ppw, 1, -1
    )
    return freqs_cos_out.expand(batch_size, -1, -1, -1), freqs_sin_out.expand(batch_size, -1, -1, -1)


def _shard_cache_rotary_emb(rotary_emb, chunk_tokens: int, runtime_context):
    """Match each rank's cache: concatenate that rank's slice of each chunk.

    Gathering cache shards produces rank-major, not chronological token order.
    Rotate local K in its actual storage order before gathering K and V.
    """
    if not get_sequence_parallel_state(runtime_context).enabled:
        return rotary_emb
    return tuple(torch.cat([
        split_sequence(chunk, runtime_context, dim=1)[0]
        for chunk in frequency.split(chunk_tokens, dim=1)
    ], dim=1) for frequency in rotary_emb)


def _self_attention(
    attn,
    hidden_states: torch.Tensor,
    *,
    rotary_emb,
    attention_mask=None,
    kv_cache: dict[str, torch.Tensor] | None = None,
    current_start: int = 0,
    global_query_length: int | None = None,
    max_attention_tokens: int | None = None,
    sink_attention_tokens: int = 0,
    cache_update: bool = True,
    cache_read_position: tuple[int, int] | None = None,
    key_rotary_emb=None,
    runtime_context=None,
    parallel_config=None,
) -> torch.Tensor:
    AttentionBackendName, _Transformer2DModelOutput, dispatch_attention_fn, _get_added_kv_projections, _get_qkv_projections = _wan_imports()

    query, key, value = _get_qkv_projections(attn, hidden_states, None)
    query = attn.norm_q(query).unflatten(2, (attn.heads, -1))
    key = attn.norm_k(key).unflatten(2, (attn.heads, -1))
    value = value.unflatten(2, (attn.heads, -1))
    query = _apply_rotary_emb(query, *rotary_emb)
    if key_rotary_emb is None:
        key = _apply_rotary_emb(key, *rotary_emb)

    sp_state = get_sequence_parallel_state(runtime_context)

    if kv_cache is not None:
        current_end = int(current_start) + int(global_query_length or query.shape[1])
        num_new_tokens = query.shape[1]
        local_start, local_end = _cache_local_span(
            kv_cache,
            current_start=int(current_start),
            current_end=current_end,
            num_new_tokens=num_new_tokens,
            sp_size=sp_state.size,
            cache_update=cache_update,
            cache_read_position=cache_read_position,
        )
        local_max_attention_tokens = _to_local_attention_budget(max_attention_tokens, sp_state.size)
        local_sink_attention_tokens = _to_local_attention_budget(sink_attention_tokens, sp_state.size) or 0
        if cache_update:
            local_start, local_end = _compact_cache_for_append(
                kv_cache,
                num_new_tokens=num_new_tokens,
                sink_attention_tokens=local_sink_attention_tokens,
            )
            ranges = _select_cache_window_ranges(
                local_end=local_end,
                max_attention_tokens=local_max_attention_tokens,
                sink_attention_tokens=local_sink_attention_tokens,
            )
            # A cache commit is persistent inference state, not part of the
            # denoising autograd graph.  In particular, qkv projections are
            # commonly produced by ``chunk``/``split`` and therefore carry
            # view metadata.  Never retain those views (or their graph) in a
            # mutable cache that will be written again by a later chunk.
            # ``commit`` callers also run under ``no_grad`` at the adapter
            # boundary, but keeping this detached-copy guard here makes the
            # low-level cache primitive safe for direct callers as well.
            key = key.detach().contiguous()
            value = value.detach().contiguous()
            kv_cache["k"][:, local_start:local_end] = key
            kv_cache["v"][:, local_start:local_end] = value
            key = torch.cat([kv_cache["k"][:, start:end] for start, end in ranges], dim=1)
            value = torch.cat([kv_cache["v"][:, start:end] for start, end in ranges], dim=1)
        else:
            key, value = _cache_window_with_current(
                kv_cache,
                key,
                value,
                stored_end=local_start,
                max_attention_tokens=local_max_attention_tokens,
                sink_attention_tokens=local_sink_attention_tokens,
            )
            ranges = ((0, int(key.shape[1])),)
        _maybe_debug_cache_window(runtime_context, local_end=local_end, ranges=ranges)
        if key_rotary_emb is not None:
            key = _apply_rotary_emb(key, *key_rotary_emb)
        if sp_state.enabled:
            key = gather_sequence(key, runtime_context, dim=1)
            value = gather_sequence(value, runtime_context, dim=1)
        if cache_update:
            kv_cache["global_end_index"].fill_(current_end)
            kv_cache["local_end_index"].fill_(local_end)

    backend = getattr(attn, "_eden_teacher_forcing_attention_backend", "triton")
    if backend == "flash4" and kv_cache is None and sp_state.size == 1:
        # Bidir SFT has no mask.  Use the official FA4 CuTe API directly rather
        # than Diffusers' ``flash`` backend, which is the FA2 interface and is
        # intentionally absent from a flash-attn-4 installation.
        hidden_states = flash4_attention(query, key, value)
    else:
        # A cached causal forward has a local query shard but an explicitly
        # all-gathered (global) K/V history.  Diffusers' Ulysses dispatcher
        # expects *both* query and K/V to be local before its all-to-all
        # exchange; passing this already-global K/V through it makes the
        # forward appear to work but leaves an invalid saved shape for its
        # backward reshape.  The cache path has already performed the needed
        # sequence collective, so use the ordinary attention backend here.
        attention_parallel_config = None if kv_cache is not None else parallel_config
        hidden_states = dispatch_attention_fn(
            query,
            key,
            value,
            attn_mask=None,
            dropout_p=0.0,
            is_causal=False,
            backend=None,
            parallel_config=attention_parallel_config,
        )
    hidden_states = hidden_states.flatten(2, 3).type_as(query)
    hidden_states = attn.to_out[0](hidden_states)
    hidden_states = attn.to_out[1](hidden_states)
    return hidden_states


def _cache_local_span(
    kv_cache,
    *,
    current_start: int,
    current_end: int,
    num_new_tokens: int,
    sp_size: int,
    cache_update: bool,
    cache_read_position: tuple[int, int] | None = None,
) -> tuple[int, int]:
    """Resolve the local cache span from an immutable committed cursor.

    Checkpoint recomputation can run after later chunks have advanced the live
    cache indices. A non-committing forward therefore captures its cursor during
    the original forward and reuses it during backward replay.
    """

    import math

    if cache_read_position is None:
        committed_global_end = int(kv_cache["global_end_index"].item())
        committed_local_end = int(kv_cache["local_end_index"].item())
    else:
        if cache_update:
            raise ValueError("A committing cache forward cannot use a replay cursor")
        committed_global_end, committed_local_end = map(int, cache_read_position)
    if not cache_update and committed_global_end != int(current_start):
        raise RuntimeError(
            "Non-committing Wan cache forward must start at its captured committed cache end: "
            f"current_start={current_start}, committed_end={committed_global_end}"
        )
    global_delta = int(current_end) - committed_global_end
    if global_delta < 0:
        raise RuntimeError(
            f"Wan cache cursor moved past the requested end: committed_end={committed_global_end}, "
            f"current_end={current_end}"
        )
    local_delta = int(math.ceil(global_delta / max(1, int(sp_size))))
    local_end = committed_local_end + local_delta
    local_start = local_end - int(num_new_tokens)
    capacity = int(kv_cache["k"].shape[1])
    if local_start < 0 or int(num_new_tokens) > capacity:
        raise RuntimeError(
            f"KV cache is too small for Wan AR inference: local_start={local_start}, "
            f"local_end={local_end}, cache_size={kv_cache['k'].shape[1]}"
        )
    return local_start, local_end


def _compact_cache_for_append(
    kv_cache,
    *,
    num_new_tokens: int,
    sink_attention_tokens: int,
) -> tuple[int, int]:
    """Evict old recent KV in-place while retaining a fixed sink prefix.

    Cache tensors are intentionally fixed-size GPU allocations.  This compact
    shift is performed only on committing forwards (never on denoising reads),
    so the active chunk remains differentiable and replay-safe.
    """

    capacity = int(kv_cache["k"].shape[1])
    old_end = int(kv_cache["local_end_index"].item())
    num_new_tokens = int(num_new_tokens)
    if num_new_tokens > capacity:
        raise RuntimeError(
            f"Current Wan chunk ({num_new_tokens} tokens) exceeds fixed KV capacity ({capacity})"
        )
    if old_end + num_new_tokens <= capacity:
        return old_end, old_end + num_new_tokens

    sink = min(max(0, int(sink_attention_tokens or 0)), capacity - num_new_tokens)
    keep_recent = max(0, capacity - sink - num_new_tokens)
    old_recent_start = max(sink, old_end - keep_recent)
    old_recent_end = old_end
    keep_len = max(0, old_recent_end - old_recent_start)
    if keep_len:
        # Source and destination overlap after the first eviction.  Clone the
        # retained tail before compacting it toward the sink boundary.
        kv_cache["k"][:, sink : sink + keep_len].copy_(
            kv_cache["k"][:, old_recent_start:old_recent_end].clone()
        )
        kv_cache["v"][:, sink : sink + keep_len].copy_(
            kv_cache["v"][:, old_recent_start:old_recent_end].clone()
        )
    return sink + keep_len, sink + keep_len + num_new_tokens


def _cache_window_with_current(
    kv_cache,
    current_key: torch.Tensor,
    current_value: torch.Tensor,
    *,
    stored_end: int,
    max_attention_tokens: int | None,
    sink_attention_tokens: int,
):
    """Build a replay-stable attention view from committed plus current KV.

    ``stored_end`` is the committed local cursor captured for this forward. It
    must not be recovered from the live cache: a later clean-chunk commit can
    advance ``local_end_index`` before activation-checkpoint replay runs.
    """

    stored_end = int(stored_end)
    capacity = int(kv_cache["k"].shape[1])
    if stored_end < 0 or stored_end > capacity:
        raise RuntimeError(
            "Wan captured cache cursor is outside physical storage: "
            f"stored_end={stored_end}, cache_size={capacity}"
        )
    current_tokens = int(current_key.shape[1])
    if max_attention_tokens is None:
        return (
            torch.cat((kv_cache["k"][:, :stored_end], current_key), dim=1),
            torch.cat((kv_cache["v"][:, :stored_end], current_value), dim=1),
        )
    budget = int(max_attention_tokens)
    if current_tokens > budget:
        raise RuntimeError(
            f"Current Wan chunk ({current_tokens} tokens) exceeds attention budget ({budget})"
        )
    sink = min(max(0, int(sink_attention_tokens or 0)), budget - current_tokens)
    recent_budget = max(0, budget - sink - current_tokens)
    sink_end = min(sink, stored_end)
    recent_start = max(sink_end, stored_end - recent_budget)
    key = torch.cat((kv_cache["k"][:, :sink_end], kv_cache["k"][:, recent_start:stored_end], current_key), dim=1)
    value = torch.cat((kv_cache["v"][:, :sink_end], kv_cache["v"][:, recent_start:stored_end], current_value), dim=1)
    return key, value


def _cache_checkpoint_replay_safe(
    kv_cache,
    *,
    max_attention_tokens: int | None,
    sp_size: int,
) -> bool:
    """Whether future commits can leave captured cache history in place.

    Training rollouts allocate storage for their complete logical trajectory,
    which is larger than a configured attention window and therefore remains
    replay-safe. Fixed-capacity chunk-AR caches allocate exactly the window
    budget and compact history in place; checkpoint replay after such a commit
    would read different KV values even with a captured cursor, so those block
    forwards must retain their normal autograd activations instead.
    """

    local_budget = _to_local_attention_budget(max_attention_tokens, sp_size)
    if local_budget is None:
        return True
    return int(kv_cache["k"].shape[1]) > int(local_budget)


def _cross_attention(attn, hidden_states: torch.Tensor, encoder_hidden_states: torch.Tensor, dynamic_prompt=None) -> torch.Tensor:
    if dynamic_prompt is not None:
        from .dynamic_prompt import cross_attention
        return cross_attention(attn, hidden_states, encoder_hidden_states, dynamic_prompt)
    AttentionBackendName, _Transformer2DModelOutput, dispatch_attention_fn, _get_added_kv_projections, _get_qkv_projections = _wan_imports()

    encoder_hidden_states_img = None
    if attn.add_k_proj is not None:
        image_context_length = encoder_hidden_states.shape[1] - 512
        encoder_hidden_states_img = encoder_hidden_states[:, :image_context_length]
        encoder_hidden_states = encoder_hidden_states[:, image_context_length:]

    query, key, value = _get_qkv_projections(attn, hidden_states, encoder_hidden_states)
    query = attn.norm_q(query).unflatten(2, (attn.heads, -1))
    key = attn.norm_k(key).unflatten(2, (attn.heads, -1))
    value = value.unflatten(2, (attn.heads, -1))

    hidden_states_img = None
    if encoder_hidden_states_img is not None:
        key_img, value_img = _get_added_kv_projections(attn, encoder_hidden_states_img)
        key_img = attn.norm_added_k(key_img).unflatten(2, (attn.heads, -1))
        value_img = value_img.unflatten(2, (attn.heads, -1))
        hidden_states_img = dispatch_attention_fn(
            query,
            key_img,
            value_img,
            attn_mask=None,
            dropout_p=0.0,
            is_causal=False,
            parallel_config=None,
        )
        hidden_states_img = hidden_states_img.flatten(2, 3).type_as(query)

    hidden_states = dispatch_attention_fn(
        query,
        key,
        value,
        attn_mask=None,
        dropout_p=0.0,
        is_causal=False,
        parallel_config=None,
    )
    hidden_states = hidden_states.flatten(2, 3).type_as(query)
    if hidden_states_img is not None:
        hidden_states = hidden_states + hidden_states_img
    hidden_states = attn.to_out[0](hidden_states)
    hidden_states = attn.to_out[1](hidden_states)
    return hidden_states


def _select_cache_window_ranges(
    *,
    local_end: int,
    max_attention_tokens: int | None,
    sink_attention_tokens: int = 0,
) -> tuple[tuple[int, int], ...]:
    local_end = int(local_end)
    sink_attention_tokens = max(0, int(sink_attention_tokens or 0))
    if max_attention_tokens is None or int(max_attention_tokens) <= 0 or local_end <= int(max_attention_tokens):
        return ((0, local_end),)
    max_attention_tokens = int(max_attention_tokens)
    if sink_attention_tokens >= max_attention_tokens:
        raise ValueError("sink_attention_tokens must be smaller than max_attention_tokens")
    sink_end = min(sink_attention_tokens, local_end)
    recent_budget = max_attention_tokens - sink_end
    recent_start = max(sink_end, local_end - recent_budget)
    ranges: list[tuple[int, int]] = []
    if sink_end > 0:
        ranges.append((0, sink_end))
    if recent_start < local_end:
        ranges.append((recent_start, local_end))
    if not ranges:
        ranges.append((max(0, local_end - max_attention_tokens), local_end))
    return _merge_ranges(ranges)


def _merge_ranges(ranges: list[tuple[int, int]]) -> tuple[tuple[int, int], ...]:
    valid = sorted((int(start), int(end)) for start, end in ranges if int(start) < int(end))
    if not valid:
        return tuple()
    merged = [valid[0]]
    for start, end in valid[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return tuple(merged)


def _to_local_attention_budget(tokens: int | None, sp_size: int) -> int | None:
    if tokens is None or int(tokens) <= 0:
        return None
    import math

    return int(math.ceil(int(tokens) / max(1, int(sp_size))))


def _maybe_debug_cache_window(runtime_context, *, local_end: int, ranges: tuple[tuple[int, int], ...]) -> None:
    if runtime_context is None:
        return
    cache_cfg = getattr(runtime_context, "cache", {}).get("kv_cache", {})
    if not cache_cfg.get("debug_window", False):
        return
    debug_seen = runtime_context.extras.setdefault("_kv_cache_debug_seen", set())
    key = (int(local_end), ranges)
    if key in debug_seen:
        return
    debug_seen.add(key)
    sp_state = get_sequence_parallel_state(runtime_context)
    print(
        f"[edenlive.kv_cache] rank={sp_state.rank} sp_rank={sp_state.sp_rank} "
        f"local_end={local_end} visible_ranges={ranges}",
        flush=True,
    )


def _block_forward(
    block,
    hidden_states: torch.Tensor,
    encoder_hidden_states: torch.Tensor,
    temb: torch.Tensor,
    rotary_emb,
    *,
    attention_mask=None,
    kv_cache: dict[str, torch.Tensor] | None = None,
    current_start: int = 0,
    global_query_length: int | None = None,
    max_attention_tokens: int | None = None,
    sink_attention_tokens: int = 0,
    cache_update: bool = True,
    cache_read_position: tuple[int, int] | None = None,
    key_rotary_emb=None,
    runtime_context=None,
    parallel_config=None,
    num_frames: int | None = None,
    repeat_streams: int = 1,
    proxy_dino_embeds: torch.Tensor | None = None,
    proxy_dino_query_grid_size: tuple[int, int] | None = None,
    proxy_dino_start_frame: int = 0,
    proxy_dino_causal: bool = False,
    dynamic_prompt=None,
) -> torch.Tensor:
    if temb.ndim == 4:
        shift_msa, scale_msa, gate_msa, c_shift_msa, c_scale_msa, c_gate_msa = (
            block.scale_shift_table.unsqueeze(0) + temb.float()
        ).chunk(6, dim=2)
        shift_msa = shift_msa.squeeze(2)
        scale_msa = scale_msa.squeeze(2)
        gate_msa = gate_msa.squeeze(2)
        c_shift_msa = c_shift_msa.squeeze(2)
        c_scale_msa = c_scale_msa.squeeze(2)
        c_gate_msa = c_gate_msa.squeeze(2)
    else:
        shift_msa, scale_msa, gate_msa, c_shift_msa, c_scale_msa, c_gate_msa = (
            block.scale_shift_table + temb.float()
        ).chunk(6, dim=1)

    norm_hidden_states = (block.norm1(hidden_states.float()) * (1 + scale_msa) + shift_msa).type_as(hidden_states)
    attn_output = _self_attention(
        block.attn1,
        norm_hidden_states,
        rotary_emb=rotary_emb,
        attention_mask=attention_mask,
        kv_cache=kv_cache,
        current_start=current_start,
        global_query_length=global_query_length,
        max_attention_tokens=max_attention_tokens,
        sink_attention_tokens=sink_attention_tokens,
        cache_update=cache_update,
        cache_read_position=cache_read_position,
                key_rotary_emb=key_rotary_emb,
        runtime_context=runtime_context,
        parallel_config=parallel_config,
    )
    hidden_states = (hidden_states.float() + attn_output * gate_msa).type_as(hidden_states)

    norm_hidden_states = block.norm2(hidden_states.float()).type_as(hidden_states)
    attn_output = _cross_attention(block.attn2, norm_hidden_states, encoder_hidden_states, dynamic_prompt)
    hidden_states = hidden_states + attn_output

    norm_hidden_states = (block.norm3(hidden_states.float()) * (1 + c_scale_msa) + c_shift_msa).type_as(hidden_states)
    ff_output = block.ffn(norm_hidden_states)
    hidden_states = (hidden_states.float() + ff_output.float() * c_gate_msa).type_as(hidden_states)
    return hidden_states


def _condition_embeddings(
    model,
    timestep: torch.Tensor,
    encoder_hidden_states: torch.Tensor,
    encoder_hidden_states_image: torch.Tensor | None,
    *,
    timestep_seq_len: int | None,
):
    temb, timestep_proj, encoder_hidden_states, encoder_hidden_states_image = model.condition_embedder(
        timestep,
        encoder_hidden_states,
        encoder_hidden_states_image,
        timestep_seq_len=timestep_seq_len,
    )
    if timestep_seq_len is not None:
        timestep_proj = timestep_proj.unflatten(2, (6, -1))
    else:
        timestep_proj = timestep_proj.unflatten(1, (6, -1))
    if encoder_hidden_states_image is not None:
        encoder_hidden_states = torch.concat([encoder_hidden_states_image, encoder_hidden_states], dim=1)
    return temb, timestep_proj, encoder_hidden_states


def _unpatchify_output(
    model,
    hidden_states: torch.Tensor,
    temb: torch.Tensor,
    *,
    batch_size: int,
    num_frames: int,
    height: int,
    width: int,
):
    p_t, p_h, p_w = model.config.patch_size
    post_patch_num_frames = num_frames // p_t
    post_patch_height = height // p_h
    post_patch_width = width // p_w
    if temb.ndim == 3:
        shift, scale = (model.scale_shift_table.unsqueeze(0).to(temb.device) + temb.unsqueeze(2)).chunk(2, dim=2)
        shift = shift.squeeze(2)
        scale = scale.squeeze(2)
    else:
        shift, scale = (model.scale_shift_table.to(temb.device) + temb.unsqueeze(1)).chunk(2, dim=1)
    shift = shift.to(hidden_states.device)
    scale = scale.to(hidden_states.device)
    hidden_states = (model.norm_out(hidden_states.float()) * (1 + scale) + shift).type_as(hidden_states)
    hidden_states = model.proj_out(hidden_states)
    hidden_states = hidden_states.reshape(
        batch_size, post_patch_num_frames, post_patch_height, post_patch_width, p_t, p_h, p_w, -1
    )
    hidden_states = hidden_states.permute(0, 7, 1, 4, 2, 5, 3, 6)
    return hidden_states.flatten(6, 7).flatten(4, 5).flatten(2, 3)


def _split_rotary_emb(rotary_emb, runtime_context, *, start: int, length: int):
    if not get_sequence_parallel_state(runtime_context).enabled:
        return rotary_emb
    return (
        rotary_emb[0].narrow(1, start, length).contiguous(),
        rotary_emb[1].narrow(1, start, length).contiguous(),
    )


def _split_token_condition(tensor: torch.Tensor, runtime_context, *, start: int, length: int) -> torch.Tensor:
    if not get_sequence_parallel_state(runtime_context).enabled or tensor.ndim < 3:
        return tensor
    return tensor.narrow(1, start, length).contiguous()


def wan_parallel_forward(
    model,
    hidden_states: torch.Tensor,
    timestep: torch.Tensor,
    encoder_hidden_states: torch.Tensor,
    *,
    encoder_hidden_states_image: torch.Tensor | None = None,
    runtime_context=None,
    parallel_config=None,
    proxy_dino_embeds: torch.Tensor | None = None,
    proxy_dino_query_grid_size: tuple[int, int] | None = None,
    dynamic_prompt=None,
    return_dict: bool = True,
):
    _AttentionBackendName, Transformer2DModelOutput, _dispatch_attention_fn, _get_added_kv_projections, _get_qkv_projections = _wan_imports()

    batch_size, _num_channels, num_frames, height, width = hidden_states.shape
    query_grid_size = proxy_dino_query_grid_size or (
        height // int(model.config.patch_size[1]),
        width // int(model.config.patch_size[2]),
    )
    rotary_emb = model.rope(hidden_states)
    hidden_tokens = model.patch_embedding(hidden_states).flatten(2).transpose(1, 2)
    global_query_length = hidden_tokens.shape[1]
    hidden_tokens, seq_start = split_sequence(hidden_tokens, runtime_context, dim=1)
    rotary_emb = _split_rotary_emb(rotary_emb, runtime_context, start=seq_start, length=hidden_tokens.shape[1])

    # A per-token timestep (e.g. TI2V clean-first-frame conditioning: frame-0 tokens at 0,
    # the rest at t) drives per-token AdaLN and must follow the sequence shard; a plain
    # per-sample scalar keeps the original behaviour.
    per_token_timestep = torch.is_tensor(timestep) and timestep.ndim == 2 and timestep.shape[1] == global_query_length
    if per_token_timestep:
        temb, timestep_proj, encoder_hidden_states = _condition_embeddings(
            model,
            timestep.flatten(),
            encoder_hidden_states,
            encoder_hidden_states_image,
            timestep_seq_len=global_query_length,
        )
        # ``timestep_proj`` is consumed inside the blocks on the local shard; ``temb`` stays
        # full for the post-gather unpatchify.
        timestep_proj = _split_token_condition(
            timestep_proj, runtime_context, start=seq_start, length=hidden_tokens.shape[1]
        )
    else:
        if timestep.ndim != 1:
            timestep = timestep.reshape(batch_size)
        temb, timestep_proj, encoder_hidden_states = _condition_embeddings(
            model,
            timestep,
            encoder_hidden_states,
            encoder_hidden_states_image,
            timestep_seq_len=None,
        )
    if torch.is_grad_enabled() and model.gradient_checkpointing:
        for block in model.blocks:
            hidden_tokens = torch.utils.checkpoint.checkpoint(
                block,
                hidden_tokens,
                encoder_hidden_states,
                timestep_proj,
                rotary_emb,
                runtime_context=runtime_context,
                parallel_config=parallel_config,
                proxy_dino_embeds=proxy_dino_embeds,
                proxy_dino_query_grid_size=query_grid_size,
                num_frames=num_frames,
                dynamic_prompt=dynamic_prompt,
                use_reentrant=False,
            )
    else:
        for block in model.blocks:
            hidden_tokens = block(
                hidden_tokens,
                encoder_hidden_states,
                timestep_proj,
                rotary_emb,
                runtime_context=runtime_context,
                parallel_config=parallel_config,
                proxy_dino_embeds=proxy_dino_embeds,
                proxy_dino_query_grid_size=query_grid_size,
                num_frames=num_frames,
                dynamic_prompt=dynamic_prompt,
            )

    hidden_tokens = gather_sequence(hidden_tokens, runtime_context, dim=1)
    output = _unpatchify_output(
        model,
        hidden_tokens,
        temb,
        batch_size=batch_size,
        num_frames=num_frames,
        height=height,
        width=width,
    )
    if not return_dict:
        return (output,)
    return Transformer2DModelOutput(sample=output)


def _expand_timesteps_to_tokens(
    timestep: torch.Tensor,
    *,
    batch_size: int,
    token_count: int,
    num_frames: int,
    frame_seq_length: int,
) -> torch.Tensor:
    if timestep.ndim == 0:
        return timestep.view(1, 1).expand(batch_size, token_count)
    if timestep.ndim == 1:
        if timestep.numel() == batch_size:
            return timestep[:, None].expand(batch_size, token_count)
        if batch_size == 1 and timestep.numel() == num_frames:
            return timestep.view(1, num_frames).repeat_interleave(frame_seq_length, dim=1)
        if batch_size == 1 and timestep.numel() == token_count:
            return timestep.view(1, token_count)
        if timestep.numel() == batch_size * token_count:
            return timestep.view(batch_size, token_count)
    if timestep.ndim == 2:
        if timestep.shape == (batch_size, token_count):
            return timestep
        if timestep.shape == (batch_size, num_frames):
            return timestep.repeat_interleave(frame_seq_length, dim=1)
        if timestep.shape[0] == batch_size and timestep.shape[1] == 1:
            return timestep.expand(batch_size, token_count)
    raise ValueError(
        f"Cannot expand timestep shape {tuple(timestep.shape)} to token shape "
        f"({batch_size}, {token_count})"
    )


def wan_causal_forward_with_cache(
    model,
    hidden_states: torch.Tensor,
    timestep: torch.Tensor,
    encoder_hidden_states: torch.Tensor,
    *,
    kv_cache: list[dict[str, torch.Tensor]],
    current_start: int,
    max_attention_tokens: int | None = None,
    sink_attention_tokens: int = 0,
    cache_update: bool = True,
    encoder_hidden_states_image: torch.Tensor | None = None,
    runtime_context=None,
    parallel_config=None,
    proxy_dino_embeds: torch.Tensor | None = None,
    proxy_dino_query_grid_size: tuple[int, int] | None = None,
    proxy_dino_start_frame: int = 0,
    return_dict: bool = True,
):
    _AttentionBackendName, Transformer2DModelOutput, _dispatch_attention_fn, _get_added_kv_projections, _get_qkv_projections = _wan_imports()

    batch_size, _num_channels, num_frames, height, width = hidden_states.shape
    query_grid_size = proxy_dino_query_grid_size or (
        height // int(model.config.patch_size[1]),
        width // int(model.config.patch_size[2]),
    )
    p_t, p_h, p_w = model.config.patch_size
    frame_seq_length = (height // p_h) * (width // p_w) * p_t
    start_frame = int(current_start) // frame_seq_length
    cache_settings = runtime_context.cache.get("kv_cache", {}) if runtime_context else {}
    cache_context = cache_settings.get("context", {})
    key_rotary_emb = None
    if cache_context.get("rope_mode", "absolute") == "fixed_window":
        if max_attention_tokens is None:
            raise ValueError("fixed_window RoPE requires a finite attention window")
        window_frames = int(max_attention_tokens) // frame_seq_length
        chunk_frames = int(cache_settings.get("chunk_size", num_frames))
        sink_frames = int(sink_attention_tokens) // frame_seq_length
        if window_frames % chunk_frames or sink_frames % chunk_frames:
            raise ValueError("fixed_window RoPE requires window and sink aligned to whole chunks")
        query_start = min(start_frame, window_frames - chunk_frames)
        visible_frames = query_start + num_frames
        # A short final chunk uses only the beginning of the current slots;
        # it must not expand history into the unused slots or shift Q forward.
        max_attention_tokens = visible_frames * frame_seq_length
        key_rotary_emb = _offset_rotary_emb(model, hidden_states, num_frames=visible_frames)
        # Q occupies the last chunk of the visible window. The global cursor
        # remains untouched for cache commits, proxy frames and prompt timing.
        rotary_emb = tuple(freq[:, -num_frames * frame_seq_length:] for freq in key_rotary_emb)
        key_rotary_emb = _shard_cache_rotary_emb(key_rotary_emb, chunk_frames * frame_seq_length, runtime_context)
    else:
        rotary_emb = _offset_rotary_emb(model, hidden_states, start_frame=start_frame)


    hidden_tokens = model.patch_embedding(hidden_states).flatten(2).transpose(1, 2)
    global_query_length = hidden_tokens.shape[1]
    hidden_tokens, seq_start = split_sequence(hidden_tokens, runtime_context, dim=1)
    rotary_emb = _split_rotary_emb(rotary_emb, runtime_context, start=seq_start, length=hidden_tokens.shape[1])
    # A packed TI2V first frame is part of the first causal chunk, but it must
    # retain its clean timestep (0) while the remaining chunk frames use the
    # denoising timestep.  Preserve this per-frame condition through the
    # causal cache path instead of collapsing a [B, F] input to timestep[:, 0].
    # The token expansion mirrors ``wan_parallel_forward`` and keeps the local
    # SP shard's AdaLN projection aligned with its token shard.
    per_token_timestep = (
        torch.is_tensor(timestep)
        and timestep.ndim == 2
        and timestep.shape[1] in {num_frames, global_query_length}
    )
    if per_token_timestep:
        if timestep.shape[1] == num_frames:
            timestep = timestep.repeat_interleave(frame_seq_length, dim=1)
        temb, timestep_proj, encoder_hidden_states = _condition_embeddings(
            model,
            timestep.flatten(),
            encoder_hidden_states,
            encoder_hidden_states_image,
            timestep_seq_len=global_query_length,
        )
        timestep_proj = _split_token_condition(
            timestep_proj,
            runtime_context,
            start=seq_start,
            length=hidden_tokens.shape[1],
        )
    else:
        if timestep.ndim == 2:
            timestep = timestep[:, 0]
        temb, timestep_proj, encoder_hidden_states = _condition_embeddings(
            model,
            timestep,
            encoder_hidden_states,
            encoder_hidden_states_image,
            timestep_seq_len=None,
        )
    sp_state = get_sequence_parallel_state(runtime_context)

    for block_index, block in enumerate(model.blocks):
        cache_read_position = None
        checkpoint_replay_safe = True
        if not cache_update:
            layer_cache = kv_cache[block_index]
            cache_read_position = (
                int(layer_cache["global_end_index"].item()),
                int(layer_cache["local_end_index"].item()),
            )
            if cache_read_position[0] != int(current_start):
                raise RuntimeError(
                    "Non-committing Wan cache forward must start at the committed cache end: "
                    f"current_start={current_start}, committed_end={cache_read_position[0]}"
                )
            checkpoint_replay_safe = _cache_checkpoint_replay_safe(
                layer_cache,
                max_attention_tokens=max_attention_tokens,
                sp_size=sp_state.size,
            )
        block_kwargs = {
            "kv_cache": kv_cache[block_index],
            "current_start": current_start,
            "global_query_length": global_query_length,
            "max_attention_tokens": max_attention_tokens,
            "sink_attention_tokens": sink_attention_tokens,
            "cache_update": cache_update,
            "cache_read_position": cache_read_position,
            "key_rotary_emb": key_rotary_emb,
            "runtime_context": runtime_context,
            "parallel_config": parallel_config,
            "proxy_dino_embeds": proxy_dino_embeds,
            "proxy_dino_query_grid_size": query_grid_size,
            "proxy_dino_start_frame": proxy_dino_start_frame,
            "proxy_dino_causal": True,
            "num_frames": num_frames,
        }
        if (
            torch.is_grad_enabled()
            and model.gradient_checkpointing
            and not cache_update
            and checkpoint_replay_safe
        ):
            hidden_tokens = torch.utils.checkpoint.checkpoint(
                block,
                hidden_tokens,
                encoder_hidden_states,
                timestep_proj,
                rotary_emb,
                use_reentrant=False,
                **block_kwargs,
            )
        else:
            hidden_tokens = block(
                hidden_tokens,
                encoder_hidden_states,
                timestep_proj,
                rotary_emb,
                **block_kwargs,
            )

    hidden_tokens = gather_sequence(hidden_tokens, runtime_context, dim=1)
    output = _unpatchify_output(
        model,
        hidden_tokens,
        temb,
        batch_size=batch_size,
        num_frames=num_frames,
        height=height,
        width=width,
    )
    if not return_dict:
        return (output,)
    return Transformer2DModelOutput(sample=output)


def allocate_wan_kv_cache(
    model,
    batch_size: int,
    max_tokens: int,
    *,
    dtype: torch.dtype,
    device: torch.device,
    runtime_context=None,
):
    import math

    sp_state = get_sequence_parallel_state(runtime_context)
    if sp_state.enabled:
        max_tokens = int(math.ceil(int(max_tokens) / int(sp_state.size)))
    caches = []
    heads = int(model.config.num_attention_heads)
    head_dim = int(model.config.attention_head_dim)
    for _ in model.blocks:
        caches.append(
            {
                "k": torch.zeros(batch_size, max_tokens, heads, head_dim, dtype=dtype, device=device),
                "v": torch.zeros(batch_size, max_tokens, heads, head_dim, dtype=dtype, device=device),
                "global_end_index": torch.zeros(1, dtype=torch.long, device=device),
                "local_end_index": torch.zeros(1, dtype=torch.long, device=device),
            }
        )
    return caches


def patch_wan_transformer_forward(model) -> None:
    """Route extra eden causal kwargs through the module forward path.

    FSDP2 installs hooks on the transformer module itself. Calling helper
    functions outside ``module.__call__`` bypasses those hooks and mixes plain
    tensors with DTensor parameters, so we patch a small dispatcher onto the
    instance and still enter through ``transformer(...)``.
    """

    if getattr(model, "_eden_causal_forward_patched", False):
        return
    for block in model.blocks:
        _patch_wan_block_forward(block)
    original_forward = model.forward

    def eden_forward(
        self,
        hidden_states: torch.Tensor,
        timestep: torch.Tensor,
        encoder_hidden_states: torch.Tensor,
        encoder_hidden_states_image: torch.Tensor | None = None,
        return_dict: bool = True,
        attention_kwargs: dict[str, Any] | None = None,
        kv_cache: list[dict[str, torch.Tensor]] | None = None,
        current_start: int | None = None,
        max_attention_tokens: int | None = None,
        sink_attention_tokens: int = 0,
        cache_update: bool = True,
        eden_runtime_context=None,
        eden_parallel_config=None,
        proxy_dino_embeds: torch.Tensor | None = None,
        proxy_dino_query_grid_size: tuple[int, int] | None = None,
        proxy_dino_start_frame: int = 0,
        dynamic_prompt=None,
    ):
        if kv_cache is not None:
            return wan_causal_forward_with_cache(
                self,
                hidden_states=hidden_states,
                timestep=timestep,
                encoder_hidden_states=encoder_hidden_states,
                encoder_hidden_states_image=encoder_hidden_states_image,
                kv_cache=kv_cache,
                current_start=int(current_start or 0),
                max_attention_tokens=max_attention_tokens,
                sink_attention_tokens=int(sink_attention_tokens or 0),
                cache_update=bool(cache_update),
                runtime_context=eden_runtime_context,
                parallel_config=eden_parallel_config,
                proxy_dino_embeds=proxy_dino_embeds,
                proxy_dino_query_grid_size=proxy_dino_query_grid_size,
                proxy_dino_start_frame=proxy_dino_start_frame,
                return_dict=return_dict,
            )
        if eden_parallel_config is not None or proxy_dino_embeds is not None or dynamic_prompt is not None:
            return wan_parallel_forward(
                self,
                hidden_states=hidden_states,
                timestep=timestep,
                encoder_hidden_states=encoder_hidden_states,
                encoder_hidden_states_image=encoder_hidden_states_image,
                runtime_context=eden_runtime_context,
                parallel_config=eden_parallel_config,
                proxy_dino_embeds=proxy_dino_embeds,
                proxy_dino_query_grid_size=proxy_dino_query_grid_size,
                dynamic_prompt=dynamic_prompt,
                return_dict=return_dict,
            )
        return original_forward(
            hidden_states=hidden_states,
            timestep=timestep,
            encoder_hidden_states=encoder_hidden_states,
            encoder_hidden_states_image=encoder_hidden_states_image,
            return_dict=return_dict,
            attention_kwargs=attention_kwargs,
        )

    model._eden_original_forward = original_forward
    model.forward = types.MethodType(eden_forward, model)
    model._eden_causal_forward_patched = True


def _patch_wan_block_forward(block) -> None:
    if getattr(block, "_eden_causal_forward_patched", False):
        return
    original_forward = block.forward

    def eden_block_forward(
        self,
        hidden_states: torch.Tensor,
        encoder_hidden_states: torch.Tensor,
        temb: torch.Tensor,
        rotary_emb,
        attention_mask=None,
        kv_cache: dict[str, torch.Tensor] | None = None,
        current_start: int = 0,
        global_query_length: int | None = None,
        max_attention_tokens: int | None = None,
        sink_attention_tokens: int = 0,
        cache_update: bool = True,
        cache_read_position: tuple[int, int] | None = None,
        key_rotary_emb=None,
        runtime_context=None,
        parallel_config=None,
        proxy_dino_embeds: torch.Tensor | None = None,
        proxy_dino_query_grid_size: tuple[int, int] | None = None,
        proxy_dino_start_frame: int = 0,
        proxy_dino_causal: bool = False,
        dynamic_prompt=None,
        num_frames: int | None = None,
        repeat_streams: int = 1,
    ) -> torch.Tensor:
        use_fa4_unmasked = (
            getattr(self.attn1, "_eden_teacher_forcing_attention_backend", "triton") == "flash4"
            and attention_mask is None
            and kv_cache is None
            and parallel_config is None
        )
        if (
            attention_mask is not None
            or kv_cache is not None
            or parallel_config is not None
            or proxy_dino_embeds is not None
            or dynamic_prompt is not None
            or use_fa4_unmasked
        ):
            return _block_forward(
                self,
                hidden_states,
                encoder_hidden_states,
                temb,
                rotary_emb,
                attention_mask=attention_mask,
                kv_cache=kv_cache,
                current_start=current_start,
                global_query_length=global_query_length,
                max_attention_tokens=max_attention_tokens,
                sink_attention_tokens=sink_attention_tokens,
                cache_update=cache_update,
                cache_read_position=cache_read_position,
                key_rotary_emb=key_rotary_emb,
                runtime_context=runtime_context,
                parallel_config=parallel_config,
                proxy_dino_embeds=proxy_dino_embeds,
                proxy_dino_query_grid_size=proxy_dino_query_grid_size,
                proxy_dino_start_frame=proxy_dino_start_frame,
                proxy_dino_causal=proxy_dino_causal,
                num_frames=num_frames,
                repeat_streams=repeat_streams,
                dynamic_prompt=dynamic_prompt,
            )
        return original_forward(hidden_states, encoder_hidden_states, temb, rotary_emb)

    block._eden_original_forward = original_forward
    block.forward = types.MethodType(eden_block_forward, block)
    block._eden_causal_forward_patched = True
