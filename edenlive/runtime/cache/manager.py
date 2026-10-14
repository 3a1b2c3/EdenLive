from __future__ import annotations

from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

from edenlive.runtime.cache.base import CausalCacheBackend


@dataclass
class _BranchPlan:
    """Normalized per-branch condition sources for one chunk-AR rollout."""

    keys: tuple[str, ...]
    conditions: dict[str, Any] = field(default_factory=dict)
    condition_fns: dict[str, Any] = field(default_factory=dict)
    release_fns: dict[str, Any] = field(default_factory=dict)
    guidance: Any | None = None

    def fuse(self, predictions: dict[str, Any]):
        """Combine per-branch predictions into the guided prediction."""
        return self.guidance.fuse(predictions)


class ChunkCausalGenerationManager:
    """Reusable chunk-AR denoising loop backed by a model-specific KV cache."""

    def __init__(self, backend: CausalCacheBackend) -> None:
        self.backend = backend

    @staticmethod
    def _resolve_branches(
        *,
        guidance,
        branch_conditions,
        branch_condition_fns,
        branch_release_fns,
    ) -> _BranchPlan:
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
        decode_fn,
        frame_seq_length: int,
        chunk_size: int,
        num_inference_steps: int,
        device,
        scheduler_config: dict[str, Any] | None = None,
        condition_latents=None,
        runtime_context=None,
        generator=None,
        offload_generated_chunks: bool | None = None,
        pack_first_frame: bool = False,
        guidance,
        branch_conditions=None,
        branch_condition_fns=None,
        branch_release_fns=None,
    ):
        """Run the chunk-AR loop over the CFG branches ``guidance`` defines.

        Every branch gets its own KV cache, each denoising step forwards every
        branch, and ``guidance.fuse`` combines the predictions. Commits are
        replicated to every branch cache with identical clean latents.
        """

        import torch

        branches = self._resolve_branches(
            guidance=guidance,
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
        cache_cfg["chunk_size"] = chunk_size
        if cache_cfg.get("context", {}).get("rope_mode") == "fixed_window" and not pack_first_frame:
            raise ValueError("fixed_window RoPE requires pack_first_frame=true")
        max_context_frames = _context_int(cache_cfg, "max_latent_frames", default=None)
        sink_context_frames = _context_int(cache_cfg, "sink_latent_frames", default=0) or 0
        max_attention_tokens = (
            int(max_context_frames) * int(frame_seq_length) if max_context_frames is not None else None
        )
        sink_attention_tokens = int(sink_context_frames) * int(frame_seq_length)
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
            """Commit one finalized chunk to every branch cache."""
            start_frame = int(start_token) // int(frame_seq_length)
            timestep = torch.zeros(batch_size, device=device, dtype=torch.float32)
            prepared = dict(prepared or {})
            for key in branches.keys:
                condition = prepared.get(key)
                if condition is None:
                    condition = _condition_for(start_frame, int(latent.shape[2]), branch=key)
                self.backend.commit(
                    latent,
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
            raise ValueError("condition latents require inference.pack_first_frame: true")

        # Autoregressive generation of the remaining frames in chunk_size blocks.
        for chunk_start in range(0, latent_frames, chunk_size):
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
                pred = branches.fuse(predictions)
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
