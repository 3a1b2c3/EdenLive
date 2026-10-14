from __future__ import annotations

from dataclasses import MISSING, fields, is_dataclass
from typing import Any, Mapping, get_args, get_origin, get_type_hints


def build_config(config_cls, config: Any):
    """Build a dataclass config from a YAML mapping.

    Unknown keys are placed in an ``extra`` field when the config declares one.
    This keeps the public key names explicit while preserving room for
    experiment-specific extensions.
    """

    if isinstance(config, config_cls):
        return config
    if config is None:
        config = {}
    if not isinstance(config, Mapping):
        raise TypeError(f"{config_cls.__qualname__} expects a mapping, got {type(config).__name__}")
    if not is_dataclass(config_cls):
        raise TypeError(f"{config_cls.__qualname__} must be a dataclass")

    field_map = {field.name: field for field in fields(config_cls)}
    type_hints = get_type_hints(config_cls)
    kwargs: dict[str, Any] = {}
    for name, field in field_map.items():
        if name == "extra":
            continue
        if name in config:
            kwargs[name] = _coerce_value(type_hints.get(name, field.type), config[name])
        elif field.default is not MISSING or field.default_factory is not MISSING:
            continue
        else:
            raise ValueError(f"Missing required config key {config_cls.__qualname__}.{name}")

    unknown = {key: value for key, value in config.items() if key not in field_map}
    if "extra" in field_map:
        kwargs["extra"] = dict(unknown)
    elif unknown:
        keys = ", ".join(sorted(unknown))
        raise ValueError(f"Unknown config key(s) for {config_cls.__qualname__}: {keys}")
    return config_cls(**kwargs)


def config_get(config: Any, key: str, default: Any = None) -> Any:
    if isinstance(config, Mapping):
        return config.get(key, default)
    value = getattr(config, key, default)
    return default if value is None else value


def _coerce_value(annotation: Any, value: Any) -> Any:
    if value is None:
        return None
    origin = get_origin(annotation)
    args = get_args(annotation)
    if origin is tuple and args:
        return tuple(value)
    if origin is list and args:
        return list(value)
    if origin in {dict, Mapping}:
        return dict(value)
    if origin is not None and type(None) in args:
        non_none = [item for item in args if item is not type(None)]
        if len(non_none) == 1:
            return _coerce_value(non_none[0], value)
    if isinstance(annotation, type) and is_dataclass(annotation) and isinstance(value, Mapping):
        return build_config(annotation, value)
    return value
