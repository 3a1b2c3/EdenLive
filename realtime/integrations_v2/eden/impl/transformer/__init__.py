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

"""Wan 2.1 transformer adapter with Plücker camera control for Eden World."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import overload

import torch
from torch import Tensor

from flashdreams.recipes.wan.transformer.wan21 import (
    Wan21Transformer,
    Wan21TransformerCache,
    Wan21TransformerConfig,
)
from eden.impl.encoder.camctrl import I2VCamCtrlEmbeddings

from .impl.network import (
    EdenWorldDiTNetwork,
    EdenWorldDiTNetwork1pt3BConfig,
    EdenWorldDiTNetwork14BConfig,
    EdenWorldDiTNetworkCache,
    EdenWorldDiTNetworkConfig,
)

EDEN_WORLD_MIN_CHECKPOINT_FREE_GB = 200.0
"""First-run storage budget documented for LingBot-World model caches."""


@dataclass(kw_only=True)
class EdenWorldTransformerCache(Wan21TransformerCache):
    """Long-lived AR cache for the Eden World transformer.

    Narrows :class:`Wan21TransformerCache`'s network-cache slots to the
    Plücker-aware Eden variant. Inherits ``rope_adapter`` /
    ``rope_freqs`` / ``autoregressive_index`` from the parent and the
    same ``start`` / ``finalize`` lifecycle.
    """

    network_cache: EdenWorldDiTNetworkCache
    """Conditional per-block KV / cross-attn cache."""

    network_cache_uncond: EdenWorldDiTNetworkCache | None = None
    """Unconditional per-block caches; ``None`` disables CFG."""


@dataclass(kw_only=True)
class EdenWorldTransformerConfig(Wan21TransformerConfig):
    """Config for the Eden World transformer.

    Bakes in the temporal layout (``len_t``, ``window_size_t``,
    ``sink_size_t``); per-rollout spatial layout (``height``, ``width``)
    is supplied to
    :meth:`Wan21Transformer.initialize_autoregressive_cache`. CP size is
    auto-detected from ``torch.distributed.get_world_size()`` (see
    :class:`Wan21TransformerConfig`).
    """

    _target: type["EdenWorldTransformer"] = field(
        default_factory=lambda: EdenWorldTransformer
    )

    network: EdenWorldDiTNetworkConfig = field(
        default_factory=EdenWorldDiTNetwork14BConfig
    )
    checkpoint_min_free_gb: float | None = EDEN_WORLD_MIN_CHECKPOINT_FREE_GB


class EdenWorldTransformer(Wan21Transformer):
    """Eden World DiT (Wan 2.1 + per-block Plücker camera control)."""

    def __init__(self, config: EdenWorldTransformerConfig) -> None:
        super().__init__(config)

    @torch.no_grad()
    def replace_text_embeddings(
        self,
        cache: EdenWorldTransformerCache,
        text_embeddings: Tensor,
    ) -> None:
        """Swap the rollout's conditional cross-attention text context."""
        network = getattr(self.network, "_orig_mod", self.network)
        assert isinstance(network, EdenWorldDiTNetwork)
        network.replace_text_embeddings(cache.network_cache, text_embeddings)
        if self._use_cuda_graph:
            self._cuda_graph_dispatch.reset()

    def predict_flow(
        self,
        noisy_latent: Tensor,
        timestep: Tensor,
        cache: EdenWorldTransformerCache,
        input: I2VCamCtrlEmbeddings,
    ) -> Tensor:
        return super().predict_flow(
            noisy_latent=noisy_latent,
            timestep=timestep,
            cache=cache,
            input=input.i2v,
            network_extra_kwargs={"plucker": input.plucker},
        )

    @overload
    def patchify_and_maybe_split_cp(self, x: Tensor) -> Tensor: ...
    @overload
    def patchify_and_maybe_split_cp(
        self, x: I2VCamCtrlEmbeddings
    ) -> I2VCamCtrlEmbeddings: ...
    def patchify_and_maybe_split_cp(
        self, x: Tensor | I2VCamCtrlEmbeddings
    ) -> Tensor | I2VCamCtrlEmbeddings:
        """Patchify and (optionally) split for context parallelism."""
        if isinstance(x, I2VCamCtrlEmbeddings):
            if x._is_patchified:
                return x
            return I2VCamCtrlEmbeddings(
                i2v=super().patchify_and_maybe_split_cp(x.i2v),
                plucker=super().patchify_and_maybe_split_cp(x.plucker),
                _is_patchified=True,
            )
        return super().patchify_and_maybe_split_cp(x)
