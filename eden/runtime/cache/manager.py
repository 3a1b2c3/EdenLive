from __future__ import annotations

from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

from eden.runtime.cache.base import CausalCacheBackend


@dataclass
class _BranchPlan:
    """Normalized per-branch condition sources for one chunk-AR rollout."""

    keys: tuple[str, ...]
    conditions: dict[str, Any] = field(default_factory=dict)
    condition_fns: dict[str, Any] = field(default_factory=dict)
    release_fns: dict[str, Any] = field(default_factory=dict)
    guidance: Any | None = None

    def fuse(self, predictions: dict[str, Any], guidance_scale: float):
        """Combine per-branch predictions into the guided prediction.

        Without a guidance spec this reproduces the historical two-branch
        behavior, including the single-branch case where the prediction passes
        through untouched.
        """
        if self.guidance is not None:
            return self.guidance.fuse(predictions)
        cond = predictions[_LEGACY_POSITIVE]
        if _LEGACY_NEGATIVE not in predictions:
            return cond
        uncond = predictions[_LEGACY_NEGATIVE]
        return uncond + float(guidance_scale) * (cond - uncond)


_LEGACY_POSITIVE = "cond"
_LEGACY_NEGATIVE = "uncond"


class ChunkCausalGenerationManager:
    """Reusable chunk-AR denoising loop backed by a model-specific KV cache."""

    def __init__(self, backend: CausalCacheBackend) -> None:
        self.backend = backend

    @staticmethod
    def _resolve_branches(
        *,
        guidance,
        prompt_condition,
        negative_condition,
        condition_fn,
        negative_condition_fn,
        condition_release_fn,
        negative_condition_release_fn,
        branch_conditions,
        branch_condition_fns,
        branch_release_fns,
    ) -> _BranchPlan:
        if guidance is None:
            # Legacy two-branch contract: positive plus optional negative.
            keys = [_LEGACY_POSITIVE]
            conditions = {_LEGACY_POSITIVE: prompt_condition}
            fns = {_LEGACY_POSITIVE: condition_fn}
            releases = {_LEGACY_POSITIVE: condition_release_fn}
            if negative_condition is not None:
                keys.append(_LEGACY_NEGATIVE)
                conditions[_LEGACY_NEGATIVE] = negative_condition
                fns[_LEGACY_NEGATIVE] = negative_condition_fn
                releases[_LEGACY_NEGATIVE] = negative_condition_release_fn
            return _BranchPlan(
                keys=tuple(keys),
                conditions=conditions,
                condition_fns={key: value for key, value in fns.items() if value is not None},
                release_fns={key: value for key, value in releases.items() if value is not None},
            )

        keys = tuple(guidance.branch_keys())
        conditions = dict(branch_conditions or {})
        fns = {
            key: value
            for key, value in (branch_condition_fns or {}).items()
            if value is not None
        }
        missing = [key for key in keys if key not in conditions and key not in fns]
        if missing:
            raise ValueError(
                "Guided chunk-AR generation requires a condition or condition_fn for every "
                f"branch; missing {sorted(missing)}"
            )
        return _BranchPlan(
            keys=keys,
            conditions=conditions,
            condition_fns=fns,
            release_fns={
                key: value
                for key, value in (branch_release_fns or {}).items()
                if value is not None
            },
            guidance=guidance,
        )

    def generate(
        self,
        *,
        latents,
        scheduler,
        prompt_condition,
        negative_condition=None,
        decode_fn,
        frame_seq_length: int,
        chunk_size: int,
        num_inference_steps: int,
        guidance_scale: float,
        device,
        scheduler_config: dict[str, Any] | None = None,
        condition_latents=None,
        runtime_context=None,
        generator=None,
        condition_fn=None,
        negative_condition_fn=None,
        condition_release_fn=None,
        negative_condition_release_fn=None,
        offload_generated_chunks: bool | None = None,
        pack_first_frame: bool = False,
        guidance=None,
        branch_conditions=None,
        branch_condition_fns=None,
        branch_release_fns=None,
    ):
        """Run the chunk-AR loop, optionally over more than two CFG branches.

        The default two-branch contract (``prompt_condition`` plus optional
        ``negative_condition``) is unchanged. ``guidance`` with
        ``branch_conditions``/``branch_condition_fns`` generalizes it: every
        branch gets its own KV cache, each denoising step forwards every branch,
        and ``guidance.fuse`` combines the predictions. Commits are replicated to
        every branch cache with identical clean latents, exactly as the
        two-branch path already does for the negative cache.
        """

        import torch

        branches = self._resolve_branches(
            guidance=guidance,
            prompt_condition=prompt_condition,
            negative_condition=negative_condition,
            condition_fn=condition_fn,
            negative_condition_fn=negative_condition_fn,
            condition_release_fn=condition_release_fn,
            negative_condition_release_fn=negative_condition_release_fn,
            branch_conditions=branch_conditions,
            branch_condition_fns=branch_condition_fns,
            branch_release_fns=branch_release_fns,
        )

        batch_size = latents.shape[0]
        latent_frames = latents.shape[2]
        chunk_size = int(chunk_size)
        pack_first_frame = bool(pack_first_frame)
        if chunk_size < 1:
            raise ValueError("inference.chunk_size must be positive")
        max_tokens = int(latent_frames) * int(frame_seq_length)
        # Prefer the backend-owned context (the normal adapter path), while
        # still honoring the explicit runtime context for lightweight/custom
        # backends that do not retain one themselves.
        backend_context = getattr(self.backend, "runtime_context", None)
        context_for_cache = backend_context if backend_context is not None else runtime_context
        cache_cfg = (
            getattr(context_for_cache, "cache", {}).get("kv_cache", {})
            if context_for_cache is not None
            else {}
        )
        if offload_generated_chunks is None:
            offload_generated_chunks = bool(cache_cfg.get("offload_generated_chunks", True))
        max_context_frames = _context_int(cache_cfg, "max_latent_frames", default=None)
        sink_context_frames = _context_int(cache_cfg, "sink_latent_frames", default=0) or 0
        max_attention_tokens = (
            int(max_context_frames) * int(frame_seq_length) if max_context_frames is not None else None
        )
        sink_attention_tokens = int(sink_context_frames) * int(frame_seq_length)
        context_noise_sigma = float(cache_cfg.get("context_noise_sigma", 0.0) or 0.0)
        context_noise_sigma_sink = cache_cfg.get("context_noise_sigma_sink")
        if context_noise_sigma_sink is not None:
            context_noise_sigma_sink = float(context_noise_sigma_sink)
        if max_attention_tokens is not None and max_attention_tokens < int(chunk_size) * int(frame_seq_length):
            raise ValueError(
                "runtime.kv_cache.context.max_latent_frames must be at least inference.chunk_size"
            )
        # A configured context window is also the physical cache capacity.  The
        # backend may still receive the full trajectory when no window is set,
        # preserving the old unbounded-context behavior.
        cache_capacity = max_attention_tokens if max_attention_tokens is not None else max_tokens
        # One cache per guidance branch. Branch order is fixed by the guidance
        # spec so ranks allocate and forward in the same order under SP.
        caches = {
            key: self.backend.allocate(batch_size=batch_size, max_tokens=cache_capacity)
            for key in branches.keys
        }
        # Keeping the completed AR trajectory on CPU is important for long
        # rollouts: only the active chunk and the fixed KV window need to stay
        # resident on the execution device.  Adapters move the final latent
        # back to the VAE device in their decode hook.
        if offload_generated_chunks and latents.device.type != "cpu":
            output = latents.to(device="cpu")
            del latents
            latent_source = output
        else:
            latent_source = latents
            output_device = torch.device("cpu") if offload_generated_chunks else latent_source.device
            output = torch.zeros_like(latent_source, device=output_device)

        def _condition_for(start_frame: int, num_frames: int, *, branch: str):
            fn = branches.condition_fns.get(branch)
            if fn is None:
                return branches.conditions.get(branch)
            return fn(int(start_frame), int(num_frames))

        def _release_branch_conditions() -> None:
            for key in branches.keys:
                release = branches.release_fns.get(key)
                if release is not None:
                    release()

        def commit_clean(latent, start_token: int, prepared=None) -> None:
            """Commit one finalized chunk, optionally noising sink and context."""
            start_frame = int(start_token) // int(frame_seq_length)
            committed = latent
            timestep = torch.zeros(batch_size, device=device, dtype=torch.float32)
            if context_noise_sigma > 0.0 or context_noise_sigma_sink is not None:
                from eden.runtime.cache.context_noise import noise_context_latents
                from eden.runtime.distributed.sequence_parallel import randn_sp_synced

                def _sample_noise(shape, *, device, dtype):
                    # Cache context is part of the logical sample.  Under SP,
                    # all ranks in the group must commit identical noise before
                    # the model shards the sequence.  Keep generator support
                    # for single-rank/offline deterministic generation.
                    return randn_sp_synced(
                        shape,
                        device=device,
                        dtype=dtype,
                        context=context_for_cache,
                        generator=generator,
                    )

                pin_first = bool(condition_latents is not None and start_frame == 0)
                committed, timestep = noise_context_latents(
                    latent,
                    context_noise_sigma,
                    sink_sigma=context_noise_sigma_sink,
                    sink_frames=int(sink_context_frames),
                    frame_offset=start_frame,
                    pin_first_frame=pin_first,
                    noise_fn=_sample_noise,
                    add_noise_fn=scheduler.add_noise,
                    timestep_scale=1000.0,
                )
                if pin_first:
                    committed = committed.clone()
                    committed[:, :, :1] = condition_latents[:, :, :1].to(
                        device=committed.device, dtype=committed.dtype
                    )
                    timestep = timestep.clone()
                    timestep[:, 0] = 0.0
            prepared = dict(prepared or {})
            for key in branches.keys:
                condition = prepared.get(key)
                if condition is None:
                    condition = _condition_for(start_frame, int(latent.shape[2]), branch=key)
                self.backend.commit(
                    committed,
                    timestep,
                    condition,
                    caches[key],
                    current_start=start_token,
                    max_attention_tokens=max_attention_tokens,
                    sink_attention_tokens=sink_attention_tokens,
                )

        # TI2V prefill: write the given conditioning frame(s) and commit them as clean
        # chunks (first frame standalone, rest in chunk_size blocks) without denoising.
        num_condition_frames = 0 if condition_latents is None else int(condition_latents.shape[2])
        if pack_first_frame:
            if num_condition_frames < 1:
                raise ValueError("pack_first_frame requires at least one condition latent frame")
            # Packed-first-frame mode is deliberately a one-frame TI2V contract:
            # the given frame is part of the first denoising chunk, while all
            # remaining frames in that chunk follow the normal AR schedule.
            # Adapters such as A14B already reduce their clean cache prefix to
            # one frame in ``prepare_causal_image_condition``.  Rejecting a
            # longer prefix here avoids silently changing chunk boundaries.
            if num_condition_frames != 1:
                raise ValueError(
                    "pack_first_frame requires exactly one condition latent frame; "
                    f"got {num_condition_frames}"
                )
            output[:, :, :1] = condition_latents[:, :, :1].to(
                device=output.device, dtype=output.dtype
            )
        elif num_condition_frames > 0:
            output[:, :, :num_condition_frames] = condition_latents.to(device=output.device, dtype=output.dtype)
            for start_frame, end_frame in _condition_spans(num_condition_frames, chunk_size):
                frames = end_frame - start_frame
                prepared = {
                    key: _condition_for(start_frame, frames, branch=key) for key in branches.keys
                }
                commit_clean(
                    condition_latents[:, :, start_frame:end_frame],
                    start_frame * frame_seq_length,
                    prepared,
                )
                prepared = None
                _release_branch_conditions()

        # Autoregressive generation of the remaining frames in chunk_size blocks.
        generation_start = 0 if pack_first_frame else num_condition_frames
        for chunk_start in range(generation_start, latent_frames, chunk_size):
            current_frames = min(chunk_size, latent_frames - chunk_start)
            current = latent_source[:, :, chunk_start : chunk_start + current_frames].to(
                device=device, non_blocking=True
            )
            if pack_first_frame and chunk_start == 0:
                current = current.clone()
                current[:, :, :1] = condition_latents[:, :, :1].to(
                    device=current.device, dtype=current.dtype
                )
            current_start_token = chunk_start * frame_seq_length
            current_conditions = {
                key: _condition_for(chunk_start, current_frames, branch=key) for key in branches.keys
            }
            # Stateful multistep solvers must start a fresh trajectory for each
            # independently denoised autoregressive chunk.
            schedule = scheduler.build_schedule(
                num_inference_steps,
                latents=current,
                device=device,
                dtype=torch.float32,
                config=scheduler_config or {},
            )
            for step_index in range(schedule.num_steps):
                timestep = scheduler.model_timestep(
                    schedule,
                    step_index,
                    batch_size=batch_size,
                    device=device,
                    dtype=torch.float32,
                )
                if pack_first_frame and chunk_start == 0:
                    # Wan's causal forward accepts per-frame timesteps.  Keep
                    # the packed condition frame at t=0 while the generated
                    # frames use the scheduler timestep for this denoise step.
                    if getattr(timestep, "ndim", 0) == 0:
                        timestep = timestep.expand(batch_size)
                    if getattr(timestep, "ndim", 0) == 1:
                        timestep = timestep[:, None].expand(batch_size, current_frames).clone()
                    elif getattr(timestep, "ndim", 0) == 2:
                        if timestep.shape[1] == 1:
                            timestep = timestep.reshape(batch_size, 1).expand(batch_size, current_frames).clone()
                        elif timestep.shape[1] == current_frames:
                            timestep = timestep.clone()
                        else:
                            raise ValueError(
                                "Packed-first-frame scheduler timestep must be scalar, [B], "
                                f"[B,1], or [B,{current_frames}], got {tuple(timestep.shape)}"
                            )
                    else:
                        raise ValueError(
                            "Packed-first-frame scheduler timestep must be scalar, [B], "
                            f"[B,1], or [B,{current_frames}], got {tuple(timestep.shape)}"
                        )
                    timestep[:, 0] = 0.0
                predictions = {
                    key: self.backend.forward(
                        current,
                        timestep,
                        current_conditions[key],
                        caches[key],
                        current_start=current_start_token,
                        max_attention_tokens=max_attention_tokens,
                        sink_attention_tokens=sink_attention_tokens,
                    )
                    for key in branches.keys
                }
                pred = branches.fuse(predictions, guidance_scale)
                current = scheduler.step(
                    current,
                    pred,
                    schedule,
                    step_index,
                    runtime_context=runtime_context,
                    generator=generator,
                )
                if pack_first_frame and chunk_start == 0:
                    # Solvers update the whole tensor (and stochastic solvers
                    # may re-noise it), so re-pin the supplied clean frame
                    # after every transition as well as before every forward.
                    current = current.clone()
                    current[:, :, :1] = condition_latents[:, :, :1].to(
                        device=current.device, dtype=current.dtype
                    )

            output[:, :, chunk_start : chunk_start + current_frames] = current.detach().to(
                device=output.device, dtype=output.dtype
            )
            commit_clean(current, current_start_token, current_conditions)
            current_conditions = None
            _release_branch_conditions()

        return SimpleNamespace(frames=decode_fn(output))

def _condition_spans(num_condition_frames: int, chunk_size: int):
    """Frame ``(start, end)`` spans for committing TI2V conditioning frames.

    The first frame is a standalone 1-frame chunk (matching the training mask's
    independent first frame); any further conditioning frames (video extension)
    are grouped into ``chunk_size`` blocks.
    """
    if num_condition_frames <= 0:
        return
    yield (0, 1)
    frame = 1
    while frame < num_condition_frames:
        end_frame = min(frame + chunk_size, num_condition_frames)
        yield (frame, end_frame)
        frame = end_frame


def _context_int(cache_cfg: dict[str, Any], key: str, default=None):
    context_cfg = cache_cfg.get("context", {})
    value = None
    if isinstance(context_cfg, dict):
        value = context_cfg.get(key)
    if value is None:
        value = cache_cfg.get(key, default)
    if value is None:
        return default
    value = int(value)
    return value if value > 0 else default
