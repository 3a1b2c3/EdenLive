from __future__ import annotations

from typing import Any

from edenlive.models import MODEL_ADAPTERS
from edenlive.runtime import RUNTIME_PLUGINS


def build_model_adapter(config: dict[str, Any]):
    model_cfg = config.get("model", {})
    adapter_name = model_cfg.get("adapter")
    if not adapter_name:
        raise ValueError("config.model.adapter is required")
    return MODEL_ADAPTERS.get(adapter_name)(model_cfg)


def build_runtime_plugins(config: dict[str, Any]):
    runtime_cfg = config.get("runtime", {})
    plugins = []
    for name, cfg in runtime_cfg.items():
        if isinstance(cfg, dict):
            plugins.append(RUNTIME_PLUGINS.get(name)(cfg))
    return plugins
