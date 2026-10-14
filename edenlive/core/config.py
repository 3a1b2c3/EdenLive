from __future__ import annotations

import copy
import os
import re
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None


def _read_yaml(path: Path) -> dict[str, Any]:
    if yaml is None:
        raise RuntimeError("PyYAML is required to load EdenLive YAML configs")
    with path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    if not isinstance(data, dict):
        raise TypeError(f"Config {path} must contain a mapping at the top level")
    return data


_ENV_PLACEHOLDER = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


def _expand_environment(value: Any) -> Any:
    """Resolve ``${NAME}`` placeholders recursively without requiring Hydra.

    Empty values remain empty strings so path validation occurs in the component
    that owns the setting rather than silently choosing an unrelated default.
    """

    if isinstance(value, str):
        return _ENV_PLACEHOLDER.sub(lambda match: os.environ.get(match.group(1), ""), value)
    if isinstance(value, dict):
        return {key: _expand_environment(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_expand_environment(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_expand_environment(item) for item in value)
    return value


def _parse_override_value(value: str) -> Any:
    if yaml is not None:
        parsed = yaml.safe_load(value)
        return parsed
    lowered = value.lower()
    if lowered in {"true", "false"}:
        return lowered == "true"
    if lowered in {"none", "null"}:
        return None
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        return value


def apply_overrides(config: dict[str, Any], overrides: list[str] | tuple[str, ...]) -> dict[str, Any]:
    """Apply dotlist overrides such as inference.num_inference_steps=4."""

    out = copy.deepcopy(config)
    for item in overrides:
        if "=" not in item:
            raise ValueError(f"Config override must be key=value, got: {item!r}")
        key, raw_value = item.split("=", 1)
        if not key or any(part == "" for part in key.split(".")):
            raise ValueError(f"Invalid config override key: {key!r}")
        cursor = out
        parts = key.split(".")
        for part in parts[:-1]:
            existing = cursor.get(part)
            if existing is None:
                existing = {}
                cursor[part] = existing
            if not isinstance(existing, dict):
                raise TypeError(f"Cannot override {key!r}: {part!r} is not a mapping")
            cursor = existing
        cursor[parts[-1]] = _parse_override_value(raw_value)
    return out


def load_config(path: str | Path) -> dict[str, Any]:
    """Load one self-contained YAML config and expand ``${NAME}`` placeholders."""

    return _expand_environment(_read_yaml(Path(path)))
