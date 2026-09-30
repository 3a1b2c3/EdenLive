# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Checkpoint loading for the AR teacher-forced 14B proxy-DINO DiT.

The training run saves a torch ``DistributedCheckpoint`` (DCP) directory
written by FSDP2's ``get_model_state_dict``, so every tensor is prefixed
``model.`` and the DiT itself keeps Diffusers module names. Two transforms
get it into FlashDreams' ``WanDiTNetwork`` layout:

1. Strip the ``model.`` prefix that FSDP2 added.
2. Apply the shared Diffusers remap, extended with the three groups the
   base table does not cover (verified against the checkpoint's own tensor
   shapes in ``.metadata``):

   - ``attn2.add_k_proj`` / ``add_v_proj`` / ``norm_added_k`` — the Wan
     2.1 I2V CLIP cross-attention branch, which FlashDreams names
     ``cross_attn.k_img`` / ``v_img`` / ``norm_k_img``.
   - ``condition_embedder.image_embedder.*`` — the CLIP ``MLPProj``, whose
     ``LayerNorm/Linear/GELU/Linear/LayerNorm`` stack lands on
     ``img_emb.proj.{0,1,3,4}``.
   - ``patch_embedding.condition_norm.weight`` — the fp32 affine RMSNorm
     over the appended proxy-DINO control channels. It passes through
     unchanged, but the module has to exist before loading, which is why
     the network subclass builds it eagerly.

``load_checkpoint`` cannot be reused here: it classifies an
extension-less directory as a distributed checkpoint and then demands the
model's keys match the checkpoint's exactly, with no remap hook. Reading
the chosen keys into a plain dict keeps the remap in our hands.
"""

from __future__ import annotations

import torch
from torch.distributed.checkpoint.state_dict_loader import _load_state_dict_from_keys

from flashdreams.core.checkpoint.load import get_storage_reader
from flashdreams.core.checkpoint.remap import remap_checkpoint_keys
from flashdreams.recipes.wan.transformer.checkpoint import (
    wan_dit_state_dict_from_diffusers,
)

_FSDP_MODEL_PREFIX = "model."

# Applied after ``wan_dit_state_dict_from_diffusers``; these keys have no
# entry in the shared table.
_PROXY_DINO_KEY_REMAP: dict[str, str] = {
    # Wan 2.1 I2V CLIP cross-attention branch.
    r"^blocks\.(\d+)\.attn2\.add_k_proj\.(.*)$": r"blocks.\1.cross_attn.k_img.\2",
    r"^blocks\.(\d+)\.attn2\.add_v_proj\.(.*)$": r"blocks.\1.cross_attn.v_img.\2",
    r"^blocks\.(\d+)\.attn2\.norm_added_k\.(.*)$": r"blocks.\1.cross_attn.norm_k_img.\2",
    # CLIP image embedder -> MLPProj sequential. Index 2 is the GELU.
    r"^condition_embedder\.image_embedder\.norm1\.(.*)$": r"img_emb.proj.0.\1",
    r"^condition_embedder\.image_embedder\.ff\.net\.0\.proj\.(.*)$": r"img_emb.proj.1.\1",
    r"^condition_embedder\.image_embedder\.ff\.net\.2\.(.*)$": r"img_emb.proj.3.\1",
    r"^condition_embedder\.image_embedder\.norm2\.(.*)$": r"img_emb.proj.4.\1",
}


def game14b_dit_state_dict_from_diffusers(
    state_dict: dict[str, torch.Tensor],
) -> dict[str, torch.Tensor]:
    """Remap a proxy-DINO AR 14B Diffusers state dict to FlashDreams keys."""
    return remap_checkpoint_keys(
        wan_dit_state_dict_from_diffusers(state_dict),
        _PROXY_DINO_KEY_REMAP,
    )


def load_game14b_dit_state_dict(checkpoint_path: str) -> dict[str, torch.Tensor]:
    """Read the DiT weights out of the training DCP directory.

    Only the ``model.*`` keys are requested, so the optimizer state that
    shares the same shards is never materialized.
    """
    reader = get_storage_reader(checkpoint_path)
    metadata = reader.read_metadata()
    model_keys = [
        key
        for key in metadata.state_dict_metadata
        if key.startswith(_FSDP_MODEL_PREFIX)
    ]
    if not model_keys:
        raise ValueError(
            f"{checkpoint_path} has no '{_FSDP_MODEL_PREFIX}*' tensors; it does "
            "not look like an FSDP2 model checkpoint."
        )
    # Single-process read: torch warns that no process group is initialized
    # and falls back to a local read, which is exactly what we want here.
    loaded = _load_state_dict_from_keys(model_keys, storage_reader=reader)
    # The checkpoint's planner metadata records every tensor under a
    # ``("model", <remainder>)`` path, so the loader rebuilds a nested dict
    # ``{"model": {<remainder>: tensor}}`` rather than the flat keys the
    # metadata lists. Flatten it back before the remap sees it.
    model_state = loaded.get(_FSDP_MODEL_PREFIX.rstrip("."))
    if isinstance(model_state, dict):
        loaded = {
            f"{_FSDP_MODEL_PREFIX}{key}": value for key, value in model_state.items()
        }
    state_dict: dict[str, torch.Tensor] = {}
    for key, value in loaded.items():
        if not isinstance(value, torch.Tensor):
            raise TypeError(
                f"checkpoint entry {key!r} is a {type(value).__name__}, not a "
                "tensor; the DCP layout is not the flat 'model.*' this loader "
                "expects."
            )
        if not key.startswith(_FSDP_MODEL_PREFIX):
            continue
        state_dict[key[len(_FSDP_MODEL_PREFIX) :]] = value
    return game14b_dit_state_dict_from_diffusers(state_dict)


__all__ = [
    "game14b_dit_state_dict_from_diffusers",
    "load_game14b_dit_state_dict",
]
