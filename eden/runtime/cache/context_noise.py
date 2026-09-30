"""Noising of committed KV-cache context for chunk-AR generation.

Chunk-AR rollout can commit *noised* context rather than clean latents: a
student trained with noised history expects the same distribution at inference
time, and the sink prefix may use its own sigma. The math is a pure tensor
function of the committed chunk, so it belongs beside the cache manager that
calls it rather than in a training recipe.
"""

from __future__ import annotations

from typing import Any, Callable


def noise_context_latents(
    clean,
    sigma: float,
    *,
    sink_sigma: float | None = None,
    sink_frames: int = 0,
    frame_offset: int = 0,
    pin_first_frame: bool = False,
    timesteps=None,
    noise_fn: Callable[..., Any],
    add_noise_fn: Callable[..., Any],
    timestep_scale: float = 1000.0,
):
    """Noise committed context, optionally using a different sigma on the sink.

    ``sigma`` applies to every context frame. When ``sink_sigma`` is set and
    ``sink_frames`` is positive, frames inside the sink prefix use it instead.
    The optional clean timestep keeps a caller-provided base (for example an
    expert endpoint) and only replaces frames that this function noises. The
    TI2V condition frame stays clean when ``pin_first_frame`` is set.

    ``frame_offset`` is the committed chunk's start in *latent frames*, so sink
    membership is decided in global latent time rather than per chunk.
    """

    import torch

    sigma = float(sigma)
    sink_frames = max(0, int(sink_frames))
    frame_offset = max(0, int(frame_offset))
    num_frames = int(clean.shape[2])
    frame_sigma = clean.new_full((clean.shape[0], num_frames), sigma)
    if sink_sigma is not None and sink_frames > 0:
        local_sink = max(0, min(num_frames, sink_frames - frame_offset))
        if local_sink:
            frame_sigma[:, :local_sink] = float(sink_sigma)
    if pin_first_frame and frame_offset == 0 and num_frames > 0:
        frame_sigma[:, 0] = 0.0
    frame_timesteps = frame_sigma * float(timestep_scale)
    if timesteps is not None:
        base = timesteps
        if getattr(base, "ndim", 0) < 2:
            base = base.reshape(clean.shape[0], 1).expand(clean.shape[0], num_frames).clone()
        else:
            base = base.clone()
        frame_timesteps = torch.where(frame_sigma != 0, frame_timesteps, base)
    if torch.count_nonzero(frame_sigma) == 0:
        return clean, frame_timesteps
    noise = noise_fn(tuple(clean.shape), device=clean.device, dtype=clean.dtype)
    return add_noise_fn(clean, noise, frame_sigma), frame_timesteps


__all__ = ["noise_context_latents"]
