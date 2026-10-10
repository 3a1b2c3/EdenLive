# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Per-AR-step condition encoder for the proxy-DINO AR 14B model.

Two conditions are assembled here:

**First frame.** The reference rollout is ``pack_first_frame: true`` over a
channel-concat I2V condition built the ``independent`` way (the training
recipe's ``cached_grey_tail`` is the no-VAE form of the same splice): latent
frame 0 is the cover encoded alone, and frames 1: are the tail of an
all-zeros (mid-grey) clip encoded on its own, so they carry no cover
information and depend only on the frame geometry.

The tail is *not* one latent frame tiled: the streaming VAE's output keeps
drifting over the first chunks of an all-zeros input (frame 1 differs from
frames 2+, frame 5 from frame 30). It is therefore encoded through the streaming
VAE once per resolution, chunk by chunk, out to latent frame 17 -- the last
frame of an 18-frame attention arena (6 sink + 12 rolling), which is full after
AR step 5. Chunk ``k < 6`` reads frames ``[3k, 3k + 3)`` of it exactly; from
chunk 6 on, every chunk reuses frames 15-17. Nothing is encoded per rollout
beyond the cover itself, and nothing is ever encoded for the whole rollout
length.

The mask marks latent frame 0 of the rollout only (AR step 0, frame 0). The
same frame is stamped into the noisy latent and held at ``t=0`` by the
transformer, which is the ``pack_first_frame`` pin.

**Proxy-DINO control.** Already encoded from the rendered game frames by
:class:`~eden.impl.game14b.dino.ProxyDinoControlEncoder`; the caller supplies
the finished features, because their computation is deliberately overlapped
with the previous chunk's denoising.

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

GREY_TAIL_LATENT_FRAMES = 18
"""Latent frames of the all-zeros clip cached per resolution (frames 0-17).

Matches the 18-frame attention arena (sink 6 + window 12). Frame 0 is never
read -- the cover takes its place -- so the tail proper is frames 1-17.
"""


@dataclass(kw_only=True)
class Game14BCtrlInput:
    """Per-AR-step payload handed to the encoder by the pipeline."""

    image: Tensor | None
    """Cover frame ``[..., 1, 3, H, W]`` in ``[-1, 1]`` at AR step 0, else ``None``.

    The cover is encoded at AR step 0 and nowhere else; later steps only read
    the cached grey tail.
    """

    control: Tensor
    """Proxy-DINO features for this chunk, ``[..., T, 1024, Hl, Wl]``.

    Already encoded (and, in the Game2V loop, computed during the previous
    chunk's denoising) so this encoder never blocks on DINO.
    """


@dataclass(kw_only=True)
class Game14BCtrlEncoderCache(StreamingEncoderCache):
    """Per-rollout cache: the cover latent and the grey tail it is spliced onto."""

    vae: WanVAECache
    """Wan VAE cache. The cover and the grey tail are each encoded through a
    fresh cache of their own, so this slot is not read by the condition path."""

    cover_latent: Tensor | None = None
    """``[..., 1, 16, Hl, Wl]`` latent of the cover encoded alone (AR step 0)."""

    grey_tail: Tensor | None = None
    """``[..., 18, 16, Hl, Wl]`` all-zeros clip latent; see the module docstring."""


@dataclass(kw_only=True)
class Game14BCtrlEncoderConfig(EncoderConfig):
    """Config for the proxy-DINO 14B condition encoder."""

    _target: type["Game14BCtrlEncoder"] = field(
        default_factory=lambda: Game14BCtrlEncoder
    )

    encoder: WanVAEEncoderConfig = field(default_factory=WanVAEEncoderConfig)
    """Streaming Wan VAE encoder; pin its checkpoint to the decoder's."""


def grey_tail_window(autoregressive_index: int, len_t: int) -> tuple[int, int]:
    """Frames ``[start, stop)`` of the cached grey tail AR step ``k`` reads.

    Exact while the 18-frame arena fills (``k < 6`` at ``len_t=3``); after that
    every chunk occupies the arena's last ``len_t`` slots, and reuses the tail
    frames that sat there.
    """
    start = min(
        autoregressive_index * len_t, GREY_TAIL_LATENT_FRAMES - len_t
    )
    return start, start + len_t


class Game14BCtrlEncoder(StreamingVideoEncoder[Game14BCtrlEncoderCache]):
    """Assemble the per-chunk I2V + proxy-DINO control payload."""

    encoder: WanVAEEncoder

    def __init__(self, config: Game14BCtrlEncoderConfig) -> None:
        super().__init__(config)
        self.config: Game14BCtrlEncoderConfig = config
        self.encoder = config.encoder.setup()
        # The all-zeros tail depends only on the frame geometry, so one tensor
        # per resolution serves every rollout. Keyed by ``(device, dtype, H, W)``.
        self._grey_tail_cache: dict[tuple, Tensor] = {}
        # The cover latent depends only on the anchor frame, which a session
        # keeps across restarts; compared by identity, not by value.
        self._cover_cache: tuple[Tensor, Tensor] | None = None

    def initialize_autoregressive_cache(self) -> Game14BCtrlEncoderCache:
        return Game14BCtrlEncoderCache(
            vae=self.encoder.initialize_autoregressive_cache(),
        )

    @torch.no_grad()
    def encode_cover(self, image: Tensor) -> Tensor:
        """Latent frame 0: the cover encoded alone through a fresh VAE cache."""
        if image.shape[-4] != 1:
            raise ValueError(
                f"first frame must have T=1, got shape {tuple(image.shape)}"
            )
        cached = self._cover_cache
        if cached is not None and cached[0] is image:
            return cached[1]
        latent = self.encoder(
            image,
            autoregressive_index=0,
            cache=self.encoder.initialize_autoregressive_cache(),
        )
        self._cover_cache = (image, latent)
        return latent

    @torch.no_grad()
    def grey_tail(self, image: Tensor, len_t: int = 3) -> Tensor:
        """Latent frames 0-17 of an all-zeros clip at ``image``'s geometry.

        Encoded through the streaming VAE the way a rollout would encode it:
        the seed frame plus two 4-frame groups at AR 0 (3 latents), then
        12-frame chunks (3 latents each) until frame 17. Streaming and
        whole-clip encodes are the same computation, so this is the tail a
        one-shot ``independent`` encode would produce, cut at frame 17.
        """
        key = (image.device, image.dtype, image.shape[-2], image.shape[-1])
        cached = self._grey_tail_cache.get(key)
        if cached is not None:
            return cached
        ratio = self.temporal_compression_ratio
        if GREY_TAIL_LATENT_FRAMES % len_t:
            raise ValueError(
                f"len_t={len_t} does not tile the {GREY_TAIL_LATENT_FRAMES}-frame arena"
            )
        cache = self.encoder.initialize_autoregressive_cache()
        batch_shape = image.shape[:-4]
        latents: list[Tensor] = []
        produced = 0
        step = 0
        while produced < GREY_TAIL_LATENT_FRAMES:
            frames = self.encoder.get_input_temporal_size(step, len_t)
            zeros = image.new_zeros(*batch_shape, frames, *image.shape[-3:])
            latent = self.encoder(zeros, autoregressive_index=step, cache=cache)
            latents.append(latent)
            produced += int(latent.shape[-4])
            step += 1
        tail = torch.cat(latents, dim=-4)[..., :GREY_TAIL_LATENT_FRAMES, :, :, :]
        if int(tail.shape[-4]) != GREY_TAIL_LATENT_FRAMES:
            raise RuntimeError(
                f"grey tail encode produced {tail.shape[-4]} latent frames, "
                f"expected {GREY_TAIL_LATENT_FRAMES} (temporal ratio {ratio})"
            )
        self._grey_tail_cache[key] = tail
        logger.info(
            "Game2V 14B: encoded the grey condition tail (latent frames 0-{}) "
            "once at {}x{}; reused for every rollout from here on",
            GREY_TAIL_LATENT_FRAMES - 1,
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
        """Build this chunk's condition latent and pair it with the control."""
        assert cache is not None, "Game14BCtrlEncoder requires a per-rollout cache."
        control = input.control
        len_t = int(control.shape[-4])

        if autoregressive_index == 0:
            if input.image is None:
                raise ValueError(
                    "Game14BCtrlEncoder needs the cover pixels at AR step 0; the "
                    "packed first frame is encoded there and nowhere else."
                )
            cache.cover_latent = self.encode_cover(input.image)
            cache.grey_tail = self.grey_tail(input.image, len_t)
        elif cache.grey_tail is None or cache.cover_latent is None:
            raise ValueError(
                f"Game14BCtrlEncoder saw AR step {autoregressive_index} before AR "
                "step 0; the rollout must start at 0 so the packed first frame "
                "is encoded."
            )

        start, stop = grey_tail_window(autoregressive_index, len_t)
        condition = cache.grey_tail[..., start:stop, :, :, :]
        mask = condition.new_zeros(
            *condition.shape[:-3], _MASK_TAG_CHANNELS, *condition.shape[-2:]
        )
        if autoregressive_index == 0:
            # Latent frame 0 of the rollout is the cover, not the tail's own
            # frame 0, and it is the only frame the mask marks.
            condition = torch.cat(
                [
                    cache.cover_latent.to(dtype=condition.dtype),
                    condition[..., 1:, :, :, :],
                ],
                dim=-4,
            )
            mask[..., 0, :, :, :] = 1.0
        return I2VProxyDinoCtrl(
            i2v=I2VCtrl(latent=condition, mask=mask),
            control=control.to(device=condition.device, dtype=condition.dtype),
        )

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
    "GREY_TAIL_LATENT_FRAMES",
    "Game14BCtrlEncoder",
    "Game14BCtrlEncoderCache",
    "Game14BCtrlEncoderConfig",
    "Game14BCtrlInput",
    "grey_tail_window",
]
