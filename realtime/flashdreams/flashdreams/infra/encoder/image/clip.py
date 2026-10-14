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

"""Wan CLIP image encoder, exposed as an infra Encoder."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import cast

import torch
from torch import Tensor
from transformers import (
    BatchFeature,
    CLIPImageProcessor,
    CLIPVisionModelWithProjection,
)
from transformers.modeling_outputs import BaseModelOutputWithPooling

from flashdreams.core.io.hf import maybe_download_hf_repo_on_rank0
from flashdreams.infra.encoder import Encoder, EncoderConfig


@dataclass(kw_only=True)
class CLIPImageEncoderConfig(EncoderConfig):
    """Config for the Wan I2V CLIP image encoder."""

    _target: type["CLIPImageEncoder"] = field(default_factory=lambda: CLIPImageEncoder)

    model_id_or_local_path: str = "Wan-AI/Wan2.1-I2V-14B-480P-Diffusers"
    """HF repo id, or a local snapshot whose ``image_encoder/`` and
    ``image_processor/`` subfolders ``from_pretrained`` can read directly."""

    dtype: torch.dtype = torch.bfloat16


class CLIPImageEncoder(Encoder):
    """CLIP image encoder used by Wan I2V.

    Stateless. Input images are ``[..., C, H, W]`` in ``[-1, 1]``.

    Examples:

      >>> encoder = CLIPImageEncoderConfig().setup().to("cuda")
      >>> embeddings = encoder(image)  # [..., 257, 1280]
    """

    def __init__(self, config: CLIPImageEncoderConfig) -> None:
        super().__init__(config)
        self.config: CLIPImageEncoderConfig = config

        maybe_download_hf_repo_on_rank0(
            config.model_id_or_local_path,
            allow_patterns=("image_encoder/**", "image_processor/**"),
        )

        # The Wan snapshot's config.json declares ``CLIPVisionModelWithProjection``
        # (it carries ``visual_projection.weight``). Loading it as the bare
        # ``CLIPVisionModel`` drops that tensor and prints an UNEXPECTED-key
        # report on every rank. The projection only maps the pooled output to
        # the contrastive space; this encoder reads ``hidden_states[-2]``, so
        # the projection is unused either way, but loading the declared class
        # consumes the checkpoint exactly.
        self.image_encoder = CLIPVisionModelWithProjection.from_pretrained(
            config.model_id_or_local_path,
            subfolder="image_encoder",
            dtype=config.dtype,
            local_files_only=True,
        )
        self.image_encoder.eval().requires_grad_(False)

        self.image_processor = CLIPImageProcessor.from_pretrained(
            config.model_id_or_local_path,
            subfolder="image_processor",
            local_files_only=True,
        )

    @torch.no_grad()
    def forward(self, input: Tensor) -> Tensor:
        """Encode images ``[..., C, H, W]`` in ``[-1, 1]``; returns ``[..., 257, 1280]``."""
        batch_shape = input.shape[:-3]
        batch_size = math.prod(batch_shape)
        images = input.reshape(batch_size, *input.shape[-3:])

        device = self.image_encoder.device
        pixels = ((images.float().clamp(-1, 1) + 1) * 127.5).round().to(torch.uint8)
        pixels = pixels.permute(0, 2, 3, 1).cpu().numpy()
        # ``CLIPImageProcessor.__call__`` returns a ``BatchFeature`` (dict-like
        # over named tensors) which is moved to device/dtype and unpacked as
        # kwargs into the vision model.
        processed = cast(
            BatchFeature,
            self.image_processor(
                images=list(pixels),
                return_tensors="pt",
            ),
        ).to(device, dtype=self.image_encoder.dtype)
        image_embeds: BaseModelOutputWithPooling = self.image_encoder(
            **processed,
            output_hidden_states=True,
        )

        assert image_embeds.hidden_states is not None
        output: Tensor = image_embeds.hidden_states[-2]
        return output.reshape(*batch_shape, *output.shape[-2:])


# python -m recipes.wan21.image_encoder
if __name__ == "__main__":
    device = torch.device("cuda")
    dtype = torch.bfloat16

    image_encoder = CLIPImageEncoderConfig().setup().to(device)

    image = torch.rand(1, 2, 3, 224, 224, device=device, dtype=dtype) * 2.0 - 1.0
    image_embeds = image_encoder(image)

    print(image_embeds.shape)  # torch.Size([1, 2, 257, 1280])
    print(image_embeds.dtype)
    print(image_embeds.device)
    print(image_embeds.sum())
