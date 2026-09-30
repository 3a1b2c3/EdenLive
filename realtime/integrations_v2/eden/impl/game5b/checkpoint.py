# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Checkpoint loading for the rollout-DMD proxy-DINO 5B DiT.

The Stage-3 SGF run saves a torch ``DistributedCheckpoint`` (DCP) directory
holding four interleaved module trees:

* ``model.*`` -- the live rollout generator.
* ``algorithm.rollout_dmd.ema_transformer.*`` -- the distilled EMA the
  reference config selects with ``checkpoint_source: ema``. This is the one
  inference wants; it is what the recipe's own validation samples from.
* ``algorithm.rollout_dmd.fake_score_transformer.*`` -- the DMD critic.
* ``optimizer.*`` -- two optimizer states.

Only the requested subtree's tensors are read, so the other three (and the
optimizer, which is by far the largest) are never materialized.

Unlike the 14B AR checkpoint, the key surface needs nothing beyond the shared
Diffusers remap: this model has no CLIP cross-attention branch (Wan 2.2 TI2V
5B never had one) and its channel-concat patch embedding is a plain
``nn.Conv3d``, so there is no ``patch_embedding.condition_norm`` to place.
Verified against the checkpoint's own ``.metadata``: all 825 remapped keys
match :class:`~flashdreams.recipes.wan.transformer.impl.network.WanDiTNetwork`
exactly, with no extras and no shape mismatches.

``load_checkpoint`` cannot be reused here: it classifies an extension-less
directory as a distributed checkpoint and then demands the model's keys match
the checkpoint's exactly, with no remap hook and no way to select one subtree
out of four.
"""

from __future__ import annotations

from typing import Literal

import torch
from torch.distributed.checkpoint.state_dict_loader import _load_state_dict_from_keys

from flashdreams.core.checkpoint.load import get_storage_reader
from flashdreams.recipes.wan.transformer.checkpoint import (
    wan_dit_state_dict_from_diffusers,
)

Game5BCheckpointSource = Literal["ema", "model"]

_SOURCE_PREFIXES: dict[str, str] = {
    # The reference inference config pins ``checkpoint_source: ema``.
    "ema": "algorithm.rollout_dmd.ema_transformer.",
    "model": "model.",
}


def game5b_dit_state_dict_from_diffusers(
    state_dict: dict[str, torch.Tensor],
) -> dict[str, torch.Tensor]:
    """Remap a proxy-DINO 5B Diffusers state dict to FlashDreams keys."""
    return wan_dit_state_dict_from_diffusers(state_dict)


def _flatten_loaded(loaded: dict, prefix: str) -> dict[str, torch.Tensor]:
    """Flatten DCP's nested read back to the flat keys the metadata lists.

    The planner records each tensor under a path whose head is the first
    ``.``-separated segment group it was saved beneath, so the loader rebuilds
    a nested dict rather than the flat keys. The nesting depth differs per
    subtree (``{"model": {...}}`` for the generator,
    ``{"algorithm.rollout_dmd": {"ema_transformer....": ...}}`` for the EMA),
    so walk down until the leaves are tensors instead of assuming a depth.
    """
    flat: dict[str, torch.Tensor] = {}

    def walk(node: dict, path: str) -> None:
        for key, value in node.items():
            joined = f"{path}{key}" if not path else f"{path}.{key}"
            if isinstance(value, dict):
                walk(value, joined)
            elif isinstance(value, torch.Tensor):
                flat[joined] = value
            else:
                raise TypeError(
                    f"checkpoint entry {joined!r} is a {type(value).__name__}, "
                    "not a tensor; the DCP layout is not the one this loader "
                    "expects."
                )

    walk(loaded, "")
    return {
        key[len(prefix) :]: value
        for key, value in flat.items()
        if key.startswith(prefix)
    }


def load_game5b_dit_state_dict(
    checkpoint_path: str,
    *,
    source: Game5BCheckpointSource = "ema",
) -> dict[str, torch.Tensor]:
    """Read one module subtree's DiT weights out of the training DCP directory.

    Args:
        checkpoint_path: The ``step_*`` DCP directory.
        source: ``"ema"`` for the distilled rollout-DMD EMA (what the
            reference inference config selects), ``"model"`` for the live
            generator.

    Returns:
        A state dict keyed for :class:`WanDiTNetwork`.
    """
    prefix = _SOURCE_PREFIXES.get(source)
    if prefix is None:
        raise ValueError(
            f"unknown checkpoint source {source!r}; expected one of "
            f"{sorted(_SOURCE_PREFIXES)}"
        )
    reader = get_storage_reader(checkpoint_path)
    metadata = reader.read_metadata()
    keys = [key for key in metadata.state_dict_metadata if key.startswith(prefix)]
    if not keys:
        available = sorted(
            {key.split(".")[0] for key in metadata.state_dict_metadata}
        )
        raise ValueError(
            f"{checkpoint_path} has no '{prefix}*' tensors (top-level groups: "
            f"{available}); it does not look like a rollout-DMD checkpoint "
            f"with a {source!r} subtree."
        )
    # Single-process read: torch warns that no process group is initialized and
    # falls back to a local read, which is exactly what we want here. Naming
    # only this subtree's keys is what keeps the optimizer state — the bulk of
    # the directory — off the heap.
    loaded = _load_state_dict_from_keys(keys, storage_reader=reader)
    state_dict = _flatten_loaded(loaded, prefix)
    if not state_dict:
        raise ValueError(
            f"{checkpoint_path} yielded no tensors under {prefix!r} despite "
            f"{len(keys)} matching metadata keys."
        )
    return game5b_dit_state_dict_from_diffusers(state_dict)


__all__ = [
    "Game5BCheckpointSource",
    "game5b_dit_state_dict_from_diffusers",
    "load_game5b_dit_state_dict",
]
