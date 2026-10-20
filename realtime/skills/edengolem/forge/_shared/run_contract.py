"""Shared run metadata and validation budget. No gameplay timer is inferred."""
import json
import math
from pathlib import Path

from _shared.paths import resolve_inside

MAX_VALIDATION_SECONDS = 300
META_NAMES = ("step3.json", "step2.json", "step1.json")


def read_meta(run_dir):
    for name in META_NAMES:
        path = Path(run_dir) / name
        if path.is_file():
            meta = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(meta, dict):
                raise ValueError(f"{path}: metadata must be an object")
            return meta
    return {}


def validate_budget(seconds):
    if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or not 0 < seconds <= MAX_VALIDATION_SECONDS:
        raise ValueError(f"validation budget must be > 0 and <= {MAX_VALIDATION_SECONDS} seconds")
    return seconds


def validation_budget(run_dir, override=None, *, project_root=None):
    """Return (seconds, source) from the linked brief or an explicit override."""
    if override is not None and project_root is None:
        return validate_budget(override), "explicit CLI override"
    meta = read_meta(run_dir)
    path = None
    if "brief" in meta:
        if not isinstance(meta["brief"], str) or not meta["brief"].strip():
            raise ValueError("brief must be a nonempty path string")
        path = (Path(run_dir) / meta["brief"]).resolve()
        if project_root is not None:
            path = resolve_inside(project_root, path, "brief")
    if override is not None:
        return validate_budget(override), "explicit CLI override"
    if path is not None:
        from validate_game_brief import validate_brief
        brief = json.loads(path.read_text(encoding="utf-8"))
        errors = validate_brief(brief)
        if errors:
            raise ValueError(f"{path}: {errors[0].message}")
        return validate_budget(brief["time_budget_seconds"]), str(path)
    raise ValueError("run metadata must link a brief or provide an explicit validation override")
