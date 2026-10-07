# SPDX-License-Identifier: Apache-2.0
"""Where the EdenLive weights live.

The model tree is one directory, shaped as the Hugging Face repo that gets
published: ``dit-5b/``, ``dit-14b/``, ``dit-5b-bidir/``, ``dit-14b-bidir/``,
``umt5/``, ``vae-5b/``, ``vae-14b/``, ``decoder-5b/``, ``vision-encoder/``,
``clip/`` and ``flux-c2f/``. It sits on CPFS, which
is mounted at different paths on the notebook and inside the GPU pod, so the
root is resolved rather than hardcoded.

``EDEN_MODEL_ROOT`` overrides the detection outright.
"""

from __future__ import annotations

import os

_CANDIDATES = (
    "/mnt/workspace/models/EdenLive",
    "/mnt/workspace/models/EdenLive",
)


def eden_model_root() -> str:
    """The EdenLive weight directory, from the env var or the mount that exists."""
    override = os.environ.get("EDEN_MODEL_ROOT")
    if override:
        return override
    for candidate in _CANDIDATES:
        if os.path.isdir(candidate):
            return candidate
    return _CANDIDATES[0]


EDEN_MODEL_ROOT = eden_model_root()
"""Resolved once at import. Set ``EDEN_MODEL_ROOT`` before importing eden configs."""
