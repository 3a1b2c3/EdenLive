from __future__ import annotations

import os
from pathlib import Path


def resolve_output_path(output_dir: str | Path) -> Path:
    """Resolve a configured output directory against ``EXP_ROOT``.

    A relative ``inference.output_dir`` is placed under ``EXP_ROOT`` (default
    ``./outputs``) so a set of runs can be pointed at another filesystem without
    editing configs. Absolute paths are returned unchanged.
    """

    path = Path(output_dir)
    exp_root = os.environ.get("EXP_ROOT", "./outputs")
    if exp_root is not None and not path.is_absolute():
        return Path(os.path.join(exp_root, os.fspath(path)))
    return path


__all__ = ["resolve_output_path"]
