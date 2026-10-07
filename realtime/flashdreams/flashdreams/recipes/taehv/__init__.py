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

"""TAEHV video decoder and Hunyuan Video 1.5 codec configs."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Annotated

import torch
import tyro
from torch import Tensor

from eden.model_root import EDEN_MODEL_ROOT
from flashdreams.infra.decoder import DecoderConfig, StreamingVideoDecoder
from flashdreams.infra.encoder import EncoderConfig, StreamingVideoEncoder
from flashdreams.recipes.taehv.checkpoint import (
    StateDictTransform,
    compose,
    legacy_to_blocks_keys,
    truncate_oversize_tgrow_weights,
)
from flashdreams.recipes.taehv.impl import TAEHV, TAEHVCache, TAEHVEncoderCache

AVAILABLE_TAEHV_CHECKPOINT_PATHS = {
    "lighttae": "https://huggingface.co/lightx2v/Autoencoders/resolve/main/lighttaew2_1.pth",
    "lighttae_wan22": f"{EDEN_MODEL_ROOT}/decoder-5b/lighttaew2_2.pth",
    "hy1_5": "https://huggingface.co/Overworld-Models/taehv1_5/resolve/main/taehv1_5.pth",
}
"""Checkpoint paths for the TAEHV decoder."""

_LIGHTTAE_CHANNELS: tuple[int, int, int, int] = (256, 128, 64, 64)
"""TAEHV ``Decoder`` block widths the ``lighttae`` weights were trained
for. Mirrors :attr:`TAEHV.channels` for the default config; kept here so
:data:`lighttae_state_dict_transform` can pre-compute the per-``TGrow``
expected output channel widths without an instantiated model."""


lighttae_state_dict_transform: StateDictTransform = compose(
    legacy_to_blocks_keys,
    truncate_oversize_tgrow_weights(channels=_LIGHTTAE_CHANNELS),
)
"""Per-checkpoint remap for the ``lighttae`` weights. Rewrites the flat
``decoder.<i>.*`` keys to the current ``decoder.blocks.<i>.*`` layout
and clips the stride=2 ``TGrow`` weights at idx 7 down to the stride=1
slice the live model expects."""


@dataclass(kw_only=True)
class TeahvVAEDecoderConfig(DecoderConfig):
    """Config for the TAEHV decoder."""

    _target: Annotated[type, tyro.conf.Suppress] = field(
        default_factory=lambda: TeahvVAEDecoder
    )

    checkpoint_path: str = AVAILABLE_TAEHV_CHECKPOINT_PATHS["lighttae"]
    """Path to a pretrained TAEHV checkpoint. Defaults to the ``lighttae`` weights."""

    state_dict_transform: StateDictTransform | None = lighttae_state_dict_transform
    """Pre-load state-dict remap. Defaults to
    :data:`lighttae_state_dict_transform`; ``None`` falls through to the
    bare :class:`TAEHV` default (see
    :meth:`~flashdreams.recipes.taehv.impl.TAEHV.load_from_checkpoint`)."""

    dtype: torch.dtype = torch.bfloat16
    """Network parameter / activation dtype."""

    use_cuda_graph: bool = True
    """Wrap the decoder forward in a CUDA graph for replay."""

    use_compile: bool = True
    """``torch.compile(mode="max-autotune-no-cudagraphs")``."""


class TeahvVAEDecoder(StreamingVideoDecoder[TAEHVCache]):
    """TAEHV (Tiny AutoEncoder for Hunyuan Video) decoder.

    Forward input is a latent ``[..., Tl, Cl, Hl, Wl]``; output is a video
    tensor ``[..., T, C, H, W]`` in ``[-1, 1]``.

    Set ``torch.backends.cudnn.benchmark = True`` at process start for ~5%
    extra on the eager seed/tail chunks.
    """

    TEMPORAL_COMPRESSION_RATIO = TAEHV.TEMPORAL_COMPRESSION_RATIO
    SPATIAL_COMPRESSION_RATIO = TAEHV.SPATIAL_COMPRESSION_RATIO

    MODEL_TYPE = "wan21"
    """:class:`TAEHV` architecture branch (latent width / patchify factor)."""

    mean: Tensor
    """Per-channel latent mean buffer; registered only when ``need_scaled``."""

    std: Tensor
    """Per-channel latent standard deviation buffer; registered only when ``need_scaled``."""

    _LIGHTTAE_MEAN: tuple[float, ...] = (
        -0.7571, -0.7089, -0.9113, 0.1075,
        -0.1745, 0.9653, -0.1517, 1.5508,
        0.4134, -0.0715, 0.5517, -0.3632,
        -0.1922, -0.9497, 0.2503, -0.2921,
    )  # fmt: skip
    """Per-channel mean for the ``lighttae`` checkpoint's latent scaling."""

    _LIGHTTAE_STD: tuple[float, ...] = (
        2.8184, 1.4541, 2.3275, 2.6558,
        1.2196, 1.7708, 2.6052, 2.0743,
        3.2687, 2.1526, 2.8652, 1.5579,
        1.6382, 1.1253, 2.8251, 1.9160,
    )  # fmt: skip
    """Per-channel standard deviation for the ``lighttae`` checkpoint's latent scaling."""

    def __init__(self, config: TeahvVAEDecoderConfig) -> None:
        super().__init__(config)
        self.config: TeahvVAEDecoderConfig = config

        self.need_scaled = "lighttae" in config.checkpoint_path
        self.taehv = TAEHV(
            checkpoint_path=config.checkpoint_path,
            model_type=self.MODEL_TYPE,
            use_cuda_graph=config.use_cuda_graph,
            use_compile=config.use_compile,
            state_dict_transform=config.state_dict_transform,
        ).to(dtype=config.dtype)

        if self.need_scaled:
            self.register_buffer(
                "mean",
                torch.tensor(self._LIGHTTAE_MEAN, dtype=config.dtype).view(
                    1, 1, -1, 1, 1
                ),
                persistent=False,
            )
            self.register_buffer(
                "std",
                torch.tensor(self._LIGHTTAE_STD, dtype=config.dtype).view(
                    1, 1, -1, 1, 1
                ),
                persistent=False,
            )

    def initialize_autoregressive_cache(self) -> TAEHVCache:
        """Return an empty streaming decoder cache."""
        return self.taehv.prepare_cache()

    @torch.inference_mode()
    def forward(
        self,
        input: Tensor,
        autoregressive_index: int = 0,
        cache: TAEHVCache | None = None,
    ) -> Tensor:
        """Decode a latent chunk to a video tensor in ``[-1, 1]``.

        Args:
            input: Latent of shape ``[..., Tl, Cl, Hl, Wl]``.
            autoregressive_index: Unused by TAEHV; kept for the
                :class:`~flashdreams.infra.decoder.StreamingDecoder` interface.
            cache: Streaming decoder cache; created on the fly when ``None``.

        Returns:
            Video tensor of shape ``[..., T, C, H, W]`` in ``[-1, 1]``.
        """
        if cache is None:
            cache = self.initialize_autoregressive_cache()

        assert input.ndim >= 4, (
            f"Expected input to have shape [..., T, C, H, W] (ndim>=4), "
            f"got ndim={input.ndim}"
        )

        *batch_shape, T, C, H, W = input.shape
        batch_size = math.prod(batch_shape)
        z = input.reshape(batch_size, T, C, H, W)

        if self.need_scaled:
            z = z * self.std
            z = z + self.mean

        x = self.taehv.decode(z, cache=cache).mul_(2).sub_(1)
        return x.reshape(*batch_shape, *x.shape[1:])

    @property
    def temporal_compression_ratio(self) -> int:
        """Pixel frames / latent frames in steady state (AR >= 1)."""
        return self.TEMPORAL_COMPRESSION_RATIO

    @property
    def spatial_compression_ratio(self) -> int:
        """Pixel side / latent side."""
        return self.SPATIAL_COMPRESSION_RATIO

    def get_output_temporal_size(
        self, autoregressive_index: int, input_temporal_size: int
    ) -> int:
        """Return pixel frame count from ``input_temporal_size`` latent frames.

        AR 0 applies causal padding: the first latent frame yields one pixel
        frame, remaining frames yield ``temporal_compression_ratio`` each.
        AR >= 1 is a plain multiply."""
        r = self.temporal_compression_ratio
        if autoregressive_index == 0:
            return 1 + (input_temporal_size - 1) * r
        return input_temporal_size * r

    def get_input_temporal_size(
        self, autoregressive_index: int, output_temporal_size: int
    ) -> int:
        """Return latent frame count needed to produce ``output_temporal_size`` pixel frames.

        Inverse of :meth:`get_output_temporal_size`."""
        r = self.temporal_compression_ratio
        if autoregressive_index == 0:
            assert (output_temporal_size - 1) % r == 0, (
                f"AR 0 output_temporal_size={output_temporal_size} must satisfy "
                f"(N - 1) % temporal_compression_ratio={r} == 0."
            )
            return 1 + (output_temporal_size - 1) // r
        assert output_temporal_size % r == 0, (
            f"AR>=1 output_temporal_size={output_temporal_size} must be divisible "
            f"by temporal_compression_ratio={r}."
        )
        return output_temporal_size // r


@dataclass(kw_only=True)
class TeahvVAEWan22DecoderConfig(TeahvVAEDecoderConfig):
    """Config for the Wan 2.2 (48-channel, 16x-spatial) LightTAE decoder.

    Same decoder body as :class:`TeahvVAEDecoderConfig`, re-pointed at the
    ``lighttaew2_2`` weights. The architecture difference is entirely in the
    ``wan22`` :class:`~flashdreams.recipes.taehv.impl.TAEHV` branch:
    ``latent_channels=48`` and ``patch_size=2``, the latter adding a final
    ``pixel_shuffle`` that takes the spatial ratio from 8x to 16x -- matching
    the Wan 2.2 TI2V-5B VAE it stands in for.
    """

    _target: Annotated[type, tyro.conf.Suppress] = field(
        default_factory=lambda: TeahvVAEWan22Decoder
    )

    checkpoint_path: str = AVAILABLE_TAEHV_CHECKPOINT_PATHS["lighttae_wan22"]
    """Path to the ``lighttaew2_2`` weights."""


class TeahvVAEWan22Decoder(TeahvVAEDecoder):
    """LightTAE decoder for Wan 2.2's 48-channel 16x latents.

    Drop-in replacement for
    :class:`~flashdreams.recipes.wan.autoencoder.vae.Wan22TI2V5BVAEDecoder`:
    identical compression ratios (temporal 4, spatial 16) and the same
    normalized-latent input convention, so a pipeline swaps one for the other
    without touching frame counts or latent sizes.
    """

    TEMPORAL_COMPRESSION_RATIO = 4
    # ``TAEHV.SPATIAL_COMPRESSION_RATIO`` counts the three 2x upsamples only;
    # the ``wan22`` branch's ``patch_size=2`` pixel-shuffle adds the fourth.
    SPATIAL_COMPRESSION_RATIO = 16

    MODEL_TYPE = "wan22"

    _LIGHTTAE_MEAN: tuple[float, ...] = (
        -0.2289, -0.0052, -0.1323, -0.2339, -0.2799, 0.0174, 0.1838, 0.1557,
        -0.1382, 0.0542, 0.2813, 0.0891, 0.1570, -0.0098, 0.0375, -0.1825,
        -0.2246, -0.1207, -0.0698, 0.5109, 0.2665, -0.2108, -0.2158, 0.2502,
        -0.2055, -0.0322, 0.1109, 0.1567, -0.0729, 0.0899, -0.2799, -0.1230,
        -0.0313, -0.1649, 0.0117, 0.0723, -0.2839, -0.2083, -0.0520, 0.3748,
        0.0152, 0.1957, 0.1433, -0.2944, 0.3573, -0.0548, -0.1681, -0.0667,
    )  # fmt: skip
    """48-channel latent mean, i.e. the Wan 2.2 TI2V-5B VAE's own
    ``latents_mean``. The tiny decoder is trained against the VAE's *raw*
    latents, so the pipeline's normalized latents are de-normalized with the
    same constants the Wan VAE decoder would use."""

    _LIGHTTAE_STD: tuple[float, ...] = (
        0.4765, 1.0364, 0.4514, 1.1677, 0.5313, 0.4990, 0.4818, 0.5013,
        0.8158, 1.0344, 0.5894, 1.0901, 0.6885, 0.6165, 0.8454, 0.4978,
        0.5759, 0.3523, 0.7135, 0.6804, 0.5833, 1.4146, 0.8986, 0.5659,
        0.7069, 0.5338, 0.4889, 0.4917, 0.4069, 0.4999, 0.6866, 0.4093,
        0.5709, 0.6065, 0.6415, 0.4944, 0.5726, 1.2042, 0.5458, 1.6887,
        0.3971, 1.0600, 0.3943, 0.5537, 0.5444, 0.4089, 0.7468, 0.7744,
    )  # fmt: skip
    """48-channel latent standard deviation; see :attr:`_LIGHTTAE_MEAN`."""

    def __init__(self, config: TeahvVAEWan22DecoderConfig) -> None:
        super().__init__(config)
        self.config: TeahvVAEWan22DecoderConfig = config


@dataclass(kw_only=True)
class Hy15TAEHVDecoderConfig(DecoderConfig):
    """Config for the Hunyuan Video 1.5 TAEHV decoder."""

    _target: Annotated[type, tyro.conf.Suppress] = field(
        default_factory=lambda: Hy15TAEHVDecoder
    )

    checkpoint_path: str = AVAILABLE_TAEHV_CHECKPOINT_PATHS["hy1_5"]
    """Path or URL for the Hunyuan Video 1.5 TAEHV checkpoint."""

    state_dict_transform: StateDictTransform | None = legacy_to_blocks_keys
    """Pre-load state-dict remap from the published flat key layout."""

    dtype: torch.dtype = torch.bfloat16
    """Network parameter / activation dtype."""

    use_cuda_graph: bool = True
    """Wrap the decoder forward in a CUDA graph for replay."""

    use_compile: bool = True
    """``torch.compile(mode="max-autotune-no-cudagraphs")``."""


class Hy15TAEHVDecoder(TeahvVAEDecoder):
    """Hunyuan Video 1.5 TAEHV decoder with raw 32-channel latents."""

    TEMPORAL_COMPRESSION_RATIO = 4
    SPATIAL_COMPRESSION_RATIO = 16

    MODEL_TYPE = "hy1_5"

    def __init__(self, config: Hy15TAEHVDecoderConfig) -> None:
        StreamingVideoDecoder.__init__(self, config)
        self.config: Hy15TAEHVDecoderConfig = config
        # Unlike the Wan checkpoints, this one's latents are already raw, so
        # the base's ``"lighttae" in checkpoint_path`` sniff must not decide
        # here: ``lighttaehy1_5.pth`` would match it and rescale wrongly.
        self.need_scaled = False
        self.taehv = TAEHV(
            checkpoint_path=config.checkpoint_path,
            model_type=self.MODEL_TYPE,
            use_cuda_graph=config.use_cuda_graph,
            use_compile=config.use_compile,
            state_dict_transform=config.state_dict_transform,
        ).to(dtype=config.dtype)


@dataclass(kw_only=True)
class Hy15TAEHVEncoderConfig(EncoderConfig):
    """Config for the Hunyuan Video 1.5 TAEHV encoder."""

    _target: Annotated[type, tyro.conf.Suppress] = field(
        default_factory=lambda: Hy15TAEHVEncoder
    )

    checkpoint_path: str = AVAILABLE_TAEHV_CHECKPOINT_PATHS["hy1_5"]
    """Path or URL for the Hunyuan Video 1.5 TAEHV checkpoint."""

    state_dict_transform: StateDictTransform | None = legacy_to_blocks_keys
    """Pre-load state-dict remap from the published flat key layout."""

    dtype: torch.dtype = torch.bfloat16
    """Network parameter / activation dtype."""


class Hy15TAEHVEncoder(StreamingVideoEncoder[TAEHVEncoderCache]):
    """Hunyuan Video 1.5 TAEHV pixel-video encoder."""

    TEMPORAL_COMPRESSION_RATIO = 4
    SPATIAL_COMPRESSION_RATIO = 16

    def __init__(self, config: Hy15TAEHVEncoderConfig) -> None:
        super().__init__(config)
        self.config: Hy15TAEHVEncoderConfig = config
        # This instance only establishes the seed latent; its decoder is unused,
        # so decoder graph/compile settings would add setup work without speeding it up.
        self.taehv = TAEHV(
            checkpoint_path=config.checkpoint_path,
            model_type="hy1_5",
            enable_encoder=True,
            use_cuda_graph=False,
            use_compile=False,
            state_dict_transform=config.state_dict_transform,
        ).to(dtype=config.dtype)

    def initialize_autoregressive_cache(self) -> TAEHVEncoderCache:
        """Return an empty causal encoder cache."""
        return self.taehv.prepare_encoder_cache()

    @torch.no_grad()
    def forward(
        self,
        input: Tensor,
        autoregressive_index: int = 0,
        cache: TAEHVEncoderCache | None = None,
    ) -> Tensor:
        """Encode frames in ``[-1, 1]`` to raw Hunyuan Video 1.5 latents."""
        if cache is None:
            cache = self.initialize_autoregressive_cache()
        assert input.ndim >= 4, "Expected input to have shape [..., T, C, H, W]"

        *batch_shape, T, C, H, W = input.shape
        batch_size = math.prod(batch_shape)
        x = input.reshape(batch_size, T, C, H, W).add(1).mul_(0.5)
        z = self.taehv.encode(x, cache=cache)
        return z.reshape(*batch_shape, *z.shape[1:])

    @property
    def temporal_compression_ratio(self) -> int:
        """Pixel frames / latent frames for complete causal groups."""
        return self.TEMPORAL_COMPRESSION_RATIO

    @property
    def spatial_compression_ratio(self) -> int:
        """Pixel side / latent side."""
        return self.SPATIAL_COMPRESSION_RATIO

    def get_output_temporal_size(
        self, autoregressive_index: int, input_temporal_size: int
    ) -> int:
        """Return latent count emitted from complete input frame groups."""
        r = self.temporal_compression_ratio
        assert input_temporal_size % r == 0, (
            f"Hy15 TAEHV encoder input_temporal_size={input_temporal_size} must be "
            f"divisible by temporal_compression_ratio={r}."
        )
        return input_temporal_size // r

    def get_input_temporal_size(
        self, autoregressive_index: int, output_temporal_size: int
    ) -> int:
        """Return pixel frame count needed for ``output_temporal_size`` latents."""
        return output_temporal_size * self.temporal_compression_ratio


if __name__ == "__main__":
    config = tyro.cli(TeahvVAEDecoderConfig)
    model = config.setup()
    print(model)
