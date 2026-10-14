# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Autoregressive diffusion model: scheduler + transformer."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Generic, cast

import torch
import torch.nn as nn
from torch import Tensor
from typing_extensions import TypeVar

from flashdreams.infra.config import InstantiateConfig
from flashdreams.infra.diffusion.scheduler import Scheduler, SchedulerConfig
from flashdreams.infra.diffusion.transformer import (
    Transformer,
    TransformerAutoregressiveCache,
    TransformerCacheT,
    TransformerConfig,
)

# Distinct TypeVar for ``DiffusionModel.FinalState``: nested generics don't
# inherit the enclosing class's TypeVar, and reusing the outer name only
# shadows it (then ty resolves it to the TypeVar's default).
_FinalStateCacheT = TypeVar(
    "_FinalStateCacheT",
    bound=TransformerAutoregressiveCache,
    default=TransformerAutoregressiveCache,
)


@dataclass(kw_only=True)
class DiffusionModelConfig(InstantiateConfig):
    """Config for the autoregressive diffusion model."""

    _target: type["DiffusionModel"] = field(default_factory=lambda: DiffusionModel)

    transformer: TransformerConfig
    """Flow-prediction network config."""

    scheduler: SchedulerConfig
    """Denoising-loop config."""

    seed: int | None = None
    """RNG seed for initial-noise draws and scheduler sampling.
    ``None`` uses the global RNG."""

    max_latent_frames: int | None = None
    """Draw one bounded video's initial noise, offload it to CPU, then slice chunks."""

    context_noise: int = 0
    """Timestep used by ``finalize`` for the AR cache-update forward.
    ``0`` skips ``add_noise``."""

    noise_in_unpatchified_shape: bool = False
    """Debug-only: draw the initial noise in the unpatchified shape, then
    patchify. Slower than the default patchified path; useful when matching
    another implementation's RNG sequence."""

    noise_from_rank0: bool = False
    """Draw every noise tensor (initial and scheduler re-noise) once, on rank
    0, at the full unpatchified chunk shape, broadcast it, then let each rank
    take its context-parallel shard.

    The default path has each rank draw only its own shard from a generator
    seeded identically on every rank, so under CP every shard receives the
    *same* noise and the chunk's noise repeats ``cp_size`` times along the
    token axis. This flag gives the single-GPU distribution at any CP size.
    Bypasses ``Transformer.initial_noise`` and needs a scheduler whose
    ``sample`` accepts ``noise_fn`` (``FlowMatchScheduler``)."""


class DiffusionModel(nn.Module, Generic[TransformerCacheT]):
    """Autoregressive diffusion model (scheduler + transformer).

    Generic over the transformer's AR cache type so user-facing typing on
    ``cache`` is preserved end-to-end.

    Examples:

        model = config.setup().to("cuda")
        cache = model.transformer.initialize_autoregressive_cache(...)
        clean, final_state = model.generate(autoregressive_index=0, cache=cache)
        model.finalize(final_state)
    """

    @dataclass(kw_only=True)
    class FinalState(Generic[_FinalStateCacheT]):
        """State passed from ``generate`` to ``finalize``."""

        clean_latent: Tensor
        """Patchified clean latent at the end of denoising."""

        autoregressive_index: int
        """AR step this state was produced at."""

        cache: _FinalStateCacheT
        """Long-lived AR cache used during generation."""

        input: Any = None
        """Patchified per-AR-step encoder output, or ``None``."""

    transformer: Transformer[TransformerCacheT]
    scheduler: Scheduler

    def __init__(self, config: DiffusionModelConfig) -> None:
        super().__init__()
        # Validate before building the transformer, which may load weights.
        if config.noise_from_rank0 and config.noise_in_unpatchified_shape:
            raise ValueError(
                "noise_from_rank0 already draws in the unpatchified shape; "
                "do not also set noise_in_unpatchified_shape"
            )
        if config.noise_from_rank0 and config.context_noise > 0:
            # ``finalize``'s ``add_noise`` still draws per rank.
            raise ValueError("noise_from_rank0 requires context_noise == 0")
        self.config = config
        self.transformer = cast(
            Transformer[TransformerCacheT], self.config.transformer.setup()
        )
        self.scheduler = self.config.scheduler.setup()
        self._rng: torch.Generator | None = None
        self._initial_video_noise: Tensor | None = None

    @property
    def device(self) -> torch.device:
        return self.transformer.device

    @property
    def dtype(self) -> torch.dtype:
        return self.transformer.dtype

    @property
    def rng(self) -> torch.Generator | None:
        """Per-model generator, lazily built on the current device.

        Returns ``None`` when ``config.seed`` is ``None``. Rebuilt the first
        time the model's device changes after a ``.to(...)``. A device move
        resets the RNG stream — fine for "construct on CPU, ``.to(gpu)``
        once" but mid-rollout device hops lose RNG state.
        """
        if self.config.seed is None:
            return None
        if self._rng is None or self._rng.device != self.device:
            self._rng = torch.Generator(device=self.device).manual_seed(
                self.config.seed
            )
        return self._rng

    @property
    def latent_shape(self) -> tuple[int, ...]:
        return self.transformer.latent_shape

    def _rank0_noise(self, like: Tensor) -> Tensor:
        """This rank's shard of one standard-normal draw over the full chunk.

        ``like`` is a patchified per-rank latent. Rank 0 draws the whole
        unpatchified chunk from ``self.rng`` and broadcasts it; every rank then
        patchifies and keeps its CP shard, so the shards are disjoint slices of
        a single sample exactly as on one GPU. See
        ``DiffusionModelConfig.noise_from_rank0``.
        """
        # Recover the full-chunk shape through the transformer's own inverse so
        # any CP layout works. It is a (tiny) collective that every rank makes
        # at the same point; not cached, since the rollout's height/width can
        # change between sessions without changing the shard shape.
        full_shape = tuple(
            self.transformer.unpatchify_and_maybe_gather_cp(
                torch.empty_like(like)
            ).shape
        )
        distributed = (
            torch.distributed.is_initialized()
            and torch.distributed.get_world_size() > 1
        )
        if not distributed or torch.distributed.get_rank() == 0:
            shape_cthw = (
                *full_shape[:-4],
                full_shape[-3],
                full_shape[-4],
                *full_shape[-2:],
            )
            full = (
                torch.randn(
                    shape_cthw, device=like.device, dtype=like.dtype, generator=self.rng
                )
                .movedim(-3, -4)
                .contiguous()
            )
        else:
            full = torch.empty(full_shape, device=like.device, dtype=like.dtype)
        if distributed:
            torch.distributed.broadcast(full, src=0)
        return self.transformer.patchify_and_maybe_split_cp(full)

    def _video_initial_noise(self, like: Tensor, autoregressive_index: int) -> Tensor:
        full_shape = tuple(
            self.transformer.unpatchify_and_maybe_gather_cp(
                torch.empty_like(like)
            ).shape
        )
        distributed = (
            torch.distributed.is_initialized()
            and torch.distributed.get_world_size() > 1
        )
        if not distributed or torch.distributed.get_rank() == 0:
            if self._initial_video_noise is None:
                shape = (
                    *full_shape[:-4],
                    full_shape[-3],
                    self.config.max_latent_frames,
                    *full_shape[-2:],
                )
                self._initial_video_noise = torch.randn(
                    shape, device=like.device, dtype=like.dtype, generator=self.rng
                ).cpu()
            start = autoregressive_index * self.transformer.config.len_t
            full = (
                self._initial_video_noise[..., start : start + full_shape[-4], :, :]
                .to(like.device)
                .movedim(-3, -4)
                .contiguous()
            )
        else:
            full = torch.empty(full_shape, device=like.device, dtype=like.dtype)
        if distributed:
            torch.distributed.broadcast(full, src=0)
        return self.transformer.patchify_and_maybe_split_cp(full)

    def generate(
        self,
        autoregressive_index: int,
        cache: TransformerCacheT,
        input: Any = None,
    ) -> tuple[Tensor, "DiffusionModel.FinalState[TransformerCacheT]"]:
        """Run the denoising loop for one AR step.

        Args:
            autoregressive_index: AR step index.
            cache: Long-lived AR cache, mutated in place.
            input: Optional per-AR-step encoder output. Patchified here and
                forwarded to ``predict_flow`` / ``postprocess_clean_latent``,
                then stashed on the returned ``FinalState`` for ``finalize``.

        Returns:
            ``(clean_latent, final_state)``. ``clean_latent`` is unpatchified;
            ``final_state`` should be passed to ``finalize``.
        """
        if input is not None:
            input = self.transformer.patchify_and_maybe_split_cp(input)
        latent_shape = self.latent_shape
        if self.config.max_latent_frames is not None:
            len_t = self.transformer.config.len_t
            frames = min(
                len_t, self.config.max_latent_frames - autoregressive_index * len_t
            )
            if frames <= 0:
                raise ValueError("max_latent_frames exhausted")
            latent_shape = (
                *latent_shape[:-2],
                latent_shape[-2] * frames // len_t,
                latent_shape[-1],
            )
            for block in cache.network_cache.block_caches:
                block.self_attn.valid_chunk_size = latent_shape[-2]
        cache.start(autoregressive_index)

        noise_fn = self._rank0_noise if self.config.noise_from_rank0 else None
        if self.config.max_latent_frames is not None:
            initial_noise = self._video_initial_noise(
                torch.empty(latent_shape, device=self.device, dtype=self.dtype),
                autoregressive_index,
            )
        elif noise_fn is not None:
            initial_noise = noise_fn(
                torch.empty(self.latent_shape, device=self.device, dtype=self.dtype)
            )
        elif self.config.noise_in_unpatchified_shape:
            # Draw noise at the unpatchified shape so the RNG sequence matches
            # implementations that sample before patchify; ``self.latent_shape``
            # is patchified, so go through ``unpatchify_and_maybe_gather_cp``
            # first to recover the pixel-side latent shape.
            dummy_latent = torch.empty(
                self.latent_shape, device=self.device, dtype=self.dtype
            )
            dummy_latent = self.transformer.unpatchify_and_maybe_gather_cp(dummy_latent)
            initial_noise = self.transformer.initial_noise(
                latent_shape=tuple(dummy_latent.shape),
                rng=self.rng,
                cache=cache,
                input=input,
            )

        else:
            initial_noise = self.transformer.initial_noise(
                latent_shape=self.latent_shape,
                rng=self.rng,
                cache=cache,
                input=input,
            )

        def predict_flow(noisy_latent: Tensor, timestep: Tensor) -> Tensor:
            # Round-trip patchify/unpatchify around the network when the
            # scheduler is operating on unpatchified latents; the transformer
            # itself always consumes/emits patchified shapes.
            if self.config.noise_in_unpatchified_shape:
                noisy_latent = self.transformer.patchify_and_maybe_split_cp(
                    noisy_latent
                )

            output = self.transformer.predict_flow(
                noisy_latent=noisy_latent,
                timestep=timestep,
                cache=cache,
                input=input,
            )

            if self.config.noise_in_unpatchified_shape:
                output = self.transformer.unpatchify_and_maybe_gather_cp(output)
            return output

        # Only schedulers that support it take ``noise_fn``; leave the others'
        # signature untouched.
        sample_kwargs: dict[str, Any] = (
            {"noise_fn": noise_fn} if noise_fn is not None else {}
        )
        clean_latent = self.scheduler.sample(
            initial_noise=initial_noise,
            predict_flow=predict_flow,
            rng=self.rng,
            **sample_kwargs,
        )

        if self.config.noise_in_unpatchified_shape:
            # Scheduler emitted an unpatchified latent; patchify before
            # ``postprocess_clean_latent`` and the cache-update path.
            clean_latent = self.transformer.patchify_and_maybe_split_cp(clean_latent)

        clean_latent = self.transformer.postprocess_clean_latent(
            clean_latent=clean_latent,
            cache=cache,
            input=input,
        )

        # Postpone KV cache update to the finalization step. No runtime
        # subscript: ``_FinalStateCacheT`` is bound from ``cache``'s type.
        final_state = DiffusionModel.FinalState(
            clean_latent=clean_latent,
            autoregressive_index=autoregressive_index,
            cache=cache,
            input=input,
        )

        clean_latent = self.transformer.unpatchify_and_maybe_gather_cp(clean_latent)
        return clean_latent, final_state

    def finalize(
        self,
        final_state: "DiffusionModel.FinalState[TransformerCacheT]",
    ) -> None:
        """Advance the AR cache using the clean latent from ``generate``.

        Re-noises the clean latent to ``config.context_noise`` and runs the
        transformer's ``finalize_kv_cache`` (one forward for vanilla
        transformers, multiple for dual-network DiTs).

        ``context_noise == 0`` skips ``add_noise`` (sigma=0 is identity) and
        feeds the clean latent directly. This also dodges the requirement
        for schedulers to support a ``t=0`` lookup (UniPC's inference
        schedule has no ``t=0`` entry).
        """
        context_noise = self.config.context_noise
        # Same dtype the scheduler hands the denoising forwards, so a CUDA graph
        # shared by both sees one staged timestep dtype.
        timestep = torch.tensor(
            context_noise,
            device=self.device,
            dtype=self.scheduler.network_timestep_dtype(self.dtype),
        )
        if context_noise > 0.0:
            clean_latent = final_state.clean_latent
            # Round-trip patchify/unpatchify around ``add_noise`` so the
            # scheduler sees the same shape as in ``generate``; the cache
            # update below always consumes a patchified latent.
            if self.config.noise_in_unpatchified_shape:
                clean_latent = self.transformer.unpatchify_and_maybe_gather_cp(
                    final_state.clean_latent
                )
            noisy_latent = self.scheduler.add_noise(
                clean_input=clean_latent,
                timestep=timestep,
                rng=self.rng,
            )
            if self.config.noise_in_unpatchified_shape:
                noisy_latent = self.transformer.patchify_and_maybe_split_cp(
                    noisy_latent
                )
        else:
            noisy_latent = final_state.clean_latent
        self.transformer.finalize_kv_cache(
            noisy_latent=noisy_latent,
            timestep=timestep,
            cache=final_state.cache,
            input=final_state.input,
        )
        final_state.cache.finalize(final_state.autoregressive_index)
