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

"""Eden World streaming inference pipeline (camera-controlled I2V)."""

from __future__ import annotations

from dataclasses import dataclass, field

import torch
from torch import Tensor

from flashdreams.infra.encoder.text.umt5 import UMT5TextEncoder, UMT5TextEncoderConfig
from flashdreams.recipes.wan.pipeline import (
    WanInferencePipeline,
    WanInferencePipelineCache,
    WanInferencePipelineConfig,
)
from flashdreams.recipes.wan.transformer.constants import NEGATIVE_PROMPT
from eden.impl.encoder.camctrl import (
    CamCtrlInput,
    I2VCamCtrlInput,
)


@dataclass(kw_only=True)
class EdenUMT5TextEncoderConfig(UMT5TextEncoderConfig):
    """UMT5 text encoder config with Tyro-friendly target typing."""

    _target: type[UMT5TextEncoder] = field(default_factory=lambda: UMT5TextEncoder)


EDEN_WORLD_V2_NEGATIVE_PROMPT = "画面突变，" + NEGATIVE_PROMPT
"""Upstream v2 negative prompt (``WanI2VCausal._generate_causal_pretrain``).

The shared Wan negative prompt plus the upstream v2's leading abrupt-cut
term. Only encoded when CFG is enabled (the 14B causal-pretrain preset); the
fast presets run with ``guidance_scale=1.0`` and skip the uncond stream.
"""


@dataclass(kw_only=True)
class EdenWorldInferencePipelineConfig(WanInferencePipelineConfig):
    """Config for the Eden World streaming pipeline.

    Same shape as the Wan I2V config; only the target class is overridden.
    """

    _target: type["EdenWorldInferencePipeline"] = field(
        default_factory=lambda: EdenWorldInferencePipeline
    )
    text_encoder: EdenUMT5TextEncoderConfig | None = field(
        default_factory=EdenUMT5TextEncoderConfig
    )


class EdenWorldInferencePipeline(WanInferencePipeline):
    """Streaming camera-controlled I2V pipeline for Eden World.

    The only difference from the base Wan I2V pipeline is ``generate``:
    the caller passes a camera payload (intrinsics, poses, world scale),
    and the per-AR-step image chunk is constructed internally from the
    cached first frame.
    """

    @staticmethod
    def _negative_prompt() -> str:
        """Use the exact upstream v2 CFG negative prompt."""
        return EDEN_WORLD_V2_NEGATIVE_PROMPT

    @torch.no_grad()
    def generate(
        self,
        autoregressive_index: int,
        cache: WanInferencePipelineCache,
        input: CamCtrlInput,
    ) -> Tensor:
        """Generate one decoded video chunk for AR step ``autoregressive_index``.

        Args:
            autoregressive_index: AR step index, starting at 0.
            cache: Cache from ``initialize_cache``; ``cache.image`` must
                be populated (Eden World is I2V-only).
            input: Per-AR-step camera payload (intrinsics, poses, world
                scale). The first-frame pixel chunk is built internally
                from ``cache.image``.

        Returns:
            Decoded video of shape ``[*batch_shape, T, C, H, W]`` in
            ``[-1, 1]``.
        """
        assert cache.image is not None, (
            "EdenWorldInferencePipeline is I2V-only; pass ``image=...`` "
            "to ``initialize_cache``."
        )
        i2v_chunk = self._preprocess_i2v_input(autoregressive_index, cache.image)
        camctrl_input = I2VCamCtrlInput(i2v=i2v_chunk, camctrl=input)

        # Skip ``WanInferencePipeline.generate`` -- it would rebuild ``input``
        # from ``cache.image`` and discard the composite camera payload.
        # Using ``super(WanInferencePipeline, self)`` jumps directly to
        # ``StreamInferencePipeline.generate`` while keeping ``self``'s
        # generic-parameter bindings.
        return super(WanInferencePipeline, self).generate(
            autoregressive_index=autoregressive_index,
            cache=cache,
            input=camctrl_input,
        )
