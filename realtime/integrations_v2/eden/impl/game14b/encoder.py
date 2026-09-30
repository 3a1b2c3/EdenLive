# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Per-AR-step condition encoder for the proxy-DINO AR 14B model.

Two conditions are assembled here:

**First frame.** The recipe's inference path is ``independent``: encode the
cover frame alone, and splice after it the tail of an all-zeros clip encoded
on its own. The two share latent frame 0 (the first chunk only ever sees the
cover) while frames 1: carry no cover information, so the tail depends only on
the frame geometry and is computed once per resolution and reused. This is the
distribution the AR teacher-forcing checkpoint was trained on
(``cached_grey_tail``, the no-VAE form of the same splice). The streaming
:class:`I2VCtrlEncoder` is deliberately *not* reused: it zeroes the latent and
mask after AR step 0, a different distribution than this checkpoint has seen.

**Proxy-DINO control.** Already encoded from the rendered game frames by
:class:`~eden.impl.game14b.dino.ProxyDinoControlEncoder`; the caller supplies
the finished features, because their computation is deliberately overlapped
with the previous chunk's denoising (see :mod:`eden.apps.game2v.session`).

Both are combined into the :class:`~eden.impl.game14b.transformer.I2VProxyDinoCtrl`
payload the transformer patchifies and channel-concatenates.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import torch
from loguru import logger
from torch import Tensor

from flashdreams.infra.encoder import (
    EncoderConfig,
    StreamingEncoderCache,
    StreamingVideoEncoder,
)
from flashdreams.recipes.wan.autoencoder.i2v import I2VCtrl
from flashdreams.recipes.wan.autoencoder.vae import (
    WanVAECache,
    WanVAEEncoder,
    WanVAEEncoderConfig,
)

from .transformer import I2VProxyDinoCtrl

# Channels the mask occupies in the network input. The encoder emits a
# 16-channel uniform tag so mask and latent patchify identically; the
# transformer slices the leading 16 patch entries back to the 4 real channels.
_MASK_TAG_CHANNELS = 16


@dataclass(kw_only=True)
class Game14BCtrlInput:
    """Per-AR-step payload handed to the encoder by the pipeline."""

    control: Tensor
    """Proxy-DINO features for this chunk, ``[..., T, 1024, Hl, Wl]``.

    Already encoded (and, in the Game2V loop, computed during the previous
    chunk's denoising) so this encoder never blocks on DINO.
    """


@dataclass(kw_only=True)
class Game14BCtrlEncoderCache(StreamingEncoderCache):
    """Per-rollout cache: the precomputed first-frame condition latent."""

    vae: WanVAECache
    """Wan VAE cache. The ``independent`` condition encodes each clip through a
    fresh cache of its own, so this slot is not read by the condition path."""

    condition_latent: Tensor | None = None
    """``[..., T_total, 16, Hl, Wl]`` condition latent for the whole rollout."""


@dataclass(kw_only=True)
class Game14BCtrlEncoderConfig(EncoderConfig):
    """Config for the proxy-DINO 14B condition encoder."""

    _target: type["Game14BCtrlEncoder"] = field(
        default_factory=lambda: Game14BCtrlEncoder
    )

    encoder: WanVAEEncoderConfig = field(default_factory=WanVAEEncoderConfig)
    """Streaming Wan VAE encoder; pin its checkpoint to the decoder's."""


class Game14BCtrlEncoder(StreamingVideoEncoder[Game14BCtrlEncoderCache]):
    """Assemble the per-chunk I2V + proxy-DINO control payload."""

    encoder: WanVAEEncoder

    def __init__(self, config: Game14BCtrlEncoderConfig) -> None:
        super().__init__(config)
        self.config: Game14BCtrlEncoderConfig = config
        self.encoder = config.encoder.setup()
        # The all-zeros condition tail depends only on the frame geometry, so
        # one latent frame per resolution serves every rollout. Keyed by
        # ``(device, dtype, H, W)``.
        self._grey_tail_cache: dict[tuple, Tensor] = {}

    def initialize_autoregressive_cache(self) -> Game14BCtrlEncoderCache:
        return Game14BCtrlEncoderCache(
            vae=self.encoder.initialize_autoregressive_cache(),
        )

    @torch.no_grad()
    def encode_first_frame_condition(
        self,
        image: Tensor,
        *,
        num_frames: int,
        cache: Game14BCtrlEncoderCache,
    ) -> Tensor:
        """Encode the ``independent`` first-frame condition for the rollout.

        Args:
            image: Cover frame ``[..., 1, 3, H, W]`` in ``[-1, 1]``.
            num_frames: Decoded frames ``F`` to cover; must satisfy
                ``(F - 1) % temporal_compression_ratio == 0``.
            cache: Rollout cache; the resulting latent is stashed on it.

        Returns:
            ``[..., T, 16, Hl, Wl]`` normalized condition latent.
        """
        ratio = self.temporal_compression_ratio
        if (num_frames - 1) % ratio != 0:
            raise ValueError(
                f"num_frames - 1 must be divisible by {ratio}, got {num_frames}"
            )
        if image.shape[-4] != 1:
            raise ValueError(
                f"first frame must have T=1, got shape {tuple(image.shape)}"
            )
        # Latent frame 0 is the cover encoded alone. The tail is frames 1: of
        # an all-zeros clip encoded on its own, so it carries none of the cover
        # and depends only on the frame geometry: one tensor per resolution,
        # tiled out to however long this rollout is.
        latent = self.encoder(
            image,
            autoregressive_index=0,
            cache=self.encoder.initialize_autoregressive_cache(),
        )
        tail_frames = (num_frames - 1) // ratio
        if tail_frames:
            tail = self._grey_tail(image).expand(
                *latent.shape[:-4], tail_frames, *latent.shape[-3:]
            )
            latent = torch.cat([latent, tail], dim=-4)
        cache.condition_latent = latent
        return latent

    def _grey_tail(self, image: Tensor) -> Tensor:
        """One latent frame of the all-zeros condition clip, frames 1: on.

        Cached per ``(device, dtype, H, W)``. The tail is mid-grey zeros in
        pixel space, so nothing about the cover enters it, and it is the same
        tensor for every rollout at this resolution.

        One frame stands in for the whole tail because the streaming VAE's
        state is a window over its own input, and an all-zeros input leaves
        that window all zeros after the seed frame. Every later chunk therefore
        sees the identical state and emits the identical latent, so the tail is
        that one latent frame repeated.
        """
        key = (image.device, image.dtype, image.shape[-2], image.shape[-1])
        cached = self._grey_tail_cache.get(key)
        if cached is not None:
            return cached
        ratio = self.temporal_compression_ratio
        # The seed frame establishes the streaming state; the next chunk is the
        # first one whose output is part of the tail.
        cache = self.encoder.initialize_autoregressive_cache()
        zeros = image.new_zeros(*image.shape[:-4], 1, *image.shape[-3:])
        self.encoder(zeros, autoregressive_index=0, cache=cache)
        chunk = zeros.expand(*image.shape[:-4], ratio, *image.shape[-3:])
        tail = self.encoder(chunk, autoregressive_index=1, cache=cache)
        if int(tail.shape[-4]) != 1:
            raise RuntimeError(
                f"grey tail chunk must encode to one latent frame, got {tuple(tail.shape)}"
            )
        self._grey_tail_cache[key] = tail
        logger.info(
            "Game2V 14B: encoded the grey condition tail once at {}x{}; "
            "reused for every rollout from here on",
            image.shape[-2],
            image.shape[-1],
        )
        return tail

    @torch.no_grad()
    def forward(
        self,
        input: Game14BCtrlInput,
        autoregressive_index: int = 0,
        cache: Game14BCtrlEncoderCache | None = None,
    ) -> I2VProxyDinoCtrl:
        """Slice this chunk's condition latent and pair it with the control."""
        assert cache is not None, "Game14BCtrlEncoder requires a per-rollout cache."
        assert cache.condition_latent is not None, (
            "encode_first_frame_condition() must run once per rollout before "
            "the first forward() call."
        )
        control = input.control
        len_t = int(control.shape[-4])
        start = self._latent_frame_start(autoregressive_index, len_t)
        condition = cache.condition_latent[..., start : start + len_t, :, :, :]
        if int(condition.shape[-4]) != len_t:
            raise ValueError(
                f"condition latent covers {cache.condition_latent.shape[-4]} frames; "
                f"AR step {autoregressive_index} needs [{start}, {start + len_t})."
            )

        # Mask marks latent frame 0 of the rollout only. Emitted at 16
        # channels so it patchifies identically to the latent; the network
        # input build slices it back to 4.
        mask = condition.new_zeros(
            *condition.shape[:-3], _MASK_TAG_CHANNELS, *condition.shape[-2:]
        )
        if start == 0:
            mask[..., 0, :, :, :] = 1.0
        return I2VProxyDinoCtrl(
            i2v=I2VCtrl(latent=condition, mask=mask),
            control=control.to(dtype=condition.dtype),
        )

    def _latent_frame_start(self, autoregressive_index: int, len_t: int) -> int:
        """First latent frame this AR step consumes."""
        return autoregressive_index * len_t

    @property
    def temporal_compression_ratio(self) -> int:
        return self.encoder.temporal_compression_ratio

    @property
    def spatial_compression_ratio(self) -> int:
        return self.encoder.spatial_compression_ratio

    def get_output_temporal_size(
        self, autoregressive_index: int, input_temporal_size: int
    ) -> int:
        return self.encoder.get_output_temporal_size(
            autoregressive_index, input_temporal_size
        )

    def get_input_temporal_size(
        self, autoregressive_index: int, output_temporal_size: int
    ) -> int:
        return self.encoder.get_input_temporal_size(
            autoregressive_index, output_temporal_size
        )


__all__ = [
    "Game14BCtrlEncoder",
    "Game14BCtrlEncoderCache",
    "Game14BCtrlEncoderConfig",
    "Game14BCtrlInput",
]
