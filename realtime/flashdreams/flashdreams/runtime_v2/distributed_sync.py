# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Distributed helpers for the v2 runtime session loops."""

from __future__ import annotations

import os

import torch
import torch.distributed as dist

from flashdreams.runtime_v2.user_input_events import UserInputEvents


def broadcast_model_loop_state(
    events: UserInputEvents,
    generation: int,
    stop: bool,
    client_connected: bool = True,
) -> tuple[UserInputEvents, int, bool, bool]:
    """Share rank-0 input, stop state, and client presence with every rank.

    Context-parallel generation requires identical camera control on every rank.
    Rank 0 owns the browser window; other ranks receive the same event batch
    on the model thread, which is also the thread that runs NCCL.

    ``client_connected`` travels the same way because only rank 0 can observe
    it, and a rank that generated a step its peers skipped would deadlock the
    next collective. Every rank steps or idles on rank 0's answer.
    """
    if torch.cuda.is_available():
        # broadcast_object_list uses NCCL for the size tensor. CUDA device
        # is thread-local, so a worker model thread would otherwise default
        # to cuda:0 and raise DistBackendError.
        torch.cuda.set_device(int(os.environ.get("LOCAL_RANK", "0")))
    payload = [
        (
            events.get_events(),
            int(generation),
            bool(stop),
            bool(client_connected),
        )
    ]
    dist.broadcast_object_list(payload, src=0)
    (
        received_events,
        received_generation,
        received_stop,
        received_client_connected,
    ) = payload[0]
    return (
        UserInputEvents(list(received_events)),
        int(received_generation),
        bool(received_stop),
        bool(received_client_connected),
    )


def broadcast_step_gate(paused: bool) -> bool:
    """Share one rank-0 in-step pause decision with every rank.

    Only rank 0 renders the game, so only rank 0 can tell that the client is
    holding a blocking card. A rank that generated a chunk its peers skipped
    would deadlock the next collective, so the answer is decided once and
    broadcast rather than recomputed per rank.

    Args:
        paused: Rank 0's decision. Ignored on every other rank.

    Returns:
        Rank 0's decision, on every rank.
    """
    if torch.cuda.is_available():
        # Same thread-local device requirement as broadcast_model_loop_state:
        # the model thread would otherwise drive NCCL from cuda:0.
        torch.cuda.set_device(int(os.environ.get("LOCAL_RANK", "0")))
    payload = [bool(paused)]
    dist.broadcast_object_list(payload, src=0)
    return bool(payload[0])
