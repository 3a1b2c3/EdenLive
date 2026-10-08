# SPDX-License-Identifier: Apache-2.0
"""Where the EdenLive weights live.

The model tree is one directory, shaped as the Hugging Face repo that gets
published: ``dit-5b/``, ``dit-14b/``, ``dit-5b-bidir/``, ``dit-14b-bidir/``,
``umt5/``, ``vae-5b/``, ``vae-14b/``, ``decoder-5b/``, ``vision-encoder/``,
``clip/`` and ``flux-c2f/``. It sits on CPFS, which
is mounted at different paths on the notebook and inside the GPU pod, so the
root is resolved rather than hardcoded.

Set ``EDEN_MODEL_ROOT`` to that directory, or name it as ``model_root`` in the
pipeline YAML, which takes precedence. ``launch.sh`` exports the environment
variable. With neither set, paths resolve against ``DEFAULT_MODEL_ROOT`` below,
relative to the repository root.
"""

from __future__ import annotations

import os

DEFAULT_MODEL_ROOT = "models/EdenLive"
"""Used when neither the YAML nor the environment names a tree. Relative, so it
reads as a path under the repository rather than a machine-specific mount."""


def eden_model_root() -> str:
    """The EdenLive weight directory from the environment, else the default."""
    return os.environ.get("EDEN_MODEL_ROOT") or DEFAULT_MODEL_ROOT


EDEN_MODEL_ROOT = eden_model_root()
"""Resolved once at import. Set ``EDEN_MODEL_ROOT`` before importing eden configs."""
