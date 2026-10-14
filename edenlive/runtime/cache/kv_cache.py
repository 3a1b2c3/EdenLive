from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from edenlive.core.types import RuntimeContext
from edenlive.runtime.base import RuntimePlugin

if TYPE_CHECKING:  # A runtime plugin only needs ``ModelAdapter`` for annotations, and
    # ``from __future__ import annotations`` defers those.  Importing it eagerly closes
    # a cycle: ``edenlive.runtime`` -> here -> ``edenlive.models`` -> the Wan adapter
    # -> back into the half-initialized ``edenlive.runtime``.  ``models/__init__.py``
    # catches that ImportError and leaves MODEL_ADAPTERS permanently empty, so the
    # failure surfaces much later as "Unknown model_adapter".
    from edenlive.models.base import ModelAdapter


class KVCachePlugin(RuntimePlugin):
    name = "kv_cache"

    @dataclass
    class ContextConfig:
        max_latent_frames: int | None = None
        sink_latent_frames: int = 0
        debug_window: bool = False
        rope_mode: str = "absolute"

    @dataclass
    class Config:
        enabled: bool = False
        context: "KVCachePlugin.ContextConfig | None" = None
        quantized: bool = False
        compression: str = "none"
        offload_generated_chunks: bool = True
        extra: dict[str, Any] = field(default_factory=dict)

        def __post_init__(self) -> None:
            if self.context is None:
                self.context = KVCachePlugin.ContextConfig()

    def attach(self, model: ModelAdapter, context: RuntimeContext) -> RuntimeContext:
        if not self.enabled:
            return context
        super().attach(model, context)
        max_context_latent_frames = _optional_positive_int(
            self.config.context.max_latent_frames
        )
        sink_latent_frames = _non_negative_int(
            self.config.context.sink_latent_frames
        )
        if max_context_latent_frames is not None and sink_latent_frames >= max_context_latent_frames:
            raise ValueError("runtime.kv_cache.context.sink_latent_frames must be smaller than max_latent_frames")
        if self.config.context.rope_mode not in {"absolute", "fixed_window"}:
            raise ValueError("runtime.kv_cache.context.rope_mode must be absolute or fixed_window")
        if self.config.context.rope_mode == "fixed_window" and max_context_latent_frames is None:
            raise ValueError("fixed_window RoPE requires a finite context window")
        context.cache["kv_cache"] = {
            "enabled": True,
            "context": {
                "max_latent_frames": max_context_latent_frames,
                "sink_latent_frames": sink_latent_frames,
                "debug_window": bool(self.config.context.debug_window),
                "rope_mode": self.config.context.rope_mode,
            },
            "max_context_latent_frames": max_context_latent_frames,
            "sink_latent_frames": sink_latent_frames,
            "debug_window": bool(self.config.context.debug_window),
            "quantized": bool(self.config.quantized),
            "compression": self.config.compression,
            "offload_generated_chunks": bool(self.config.offload_generated_chunks),
        }
        return context


def _optional_positive_int(value):
    if value is None:
        return None
    value = int(value)
    return value if value > 0 else None


def _non_negative_int(value) -> int:
    if value is None:
        return 0
    return max(0, int(value))
