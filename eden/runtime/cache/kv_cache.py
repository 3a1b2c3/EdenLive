from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from eden.core.types import RuntimeContext
from eden.runtime.base import RuntimePlugin

if TYPE_CHECKING:  # A runtime plugin only needs ``ModelAdapter`` for annotations, and
    # ``from __future__ import annotations`` defers those.  Importing it eagerly closes
    # a cycle: ``eden.runtime`` -> here -> ``eden.models`` -> the Wan adapter
    # -> back into the half-initialized ``eden.runtime``.  ``models/__init__.py``
    # catches that ImportError and leaves MODEL_ADAPTERS permanently empty, so the
    # failure surfaces much later as "Unknown model_adapter".
    from eden.models.base import ModelAdapter


class KVCachePlugin(RuntimePlugin):
    name = "kv_cache"

    @dataclass
    class ContextConfig:
        max_latent_frames: int | None = None
        sink_latent_frames: int = 0
        debug_window: bool = False

    @dataclass
    class Config:
        enabled: bool = False
        context: "KVCachePlugin.ContextConfig | None" = None
        quantized: bool = False
        compression: str = "none"
        offload_generated_chunks: bool = True
        # Sigma used when committing context into the KV cache. The default
        # commits clean context. ``context_noise_sigma_sink`` overrides only the
        # configured sink prefix; absent means the sink uses the same sigma.
        context_noise_sigma: float = 0.0
        context_noise_sigma_sink: float | None = None
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
        context_noise_sigma = _unit_float(self.config.context_noise_sigma, "context_noise_sigma")
        context_noise_sigma_sink = (
            None
            if self.config.context_noise_sigma_sink is None
            else _unit_float(self.config.context_noise_sigma_sink, "context_noise_sigma_sink")
        )
        if context_noise_sigma_sink is not None and sink_latent_frames <= 0:
            raise ValueError(
                "runtime.kv_cache.context_noise_sigma_sink requires context.sink_latent_frames > 0"
            )
        context.cache["kv_cache"] = {
            "enabled": True,
            "context": {
                "max_latent_frames": max_context_latent_frames,
                "sink_latent_frames": sink_latent_frames,
                "debug_window": bool(self.config.context.debug_window),
            },
            "max_context_latent_frames": max_context_latent_frames,
            "sink_latent_frames": sink_latent_frames,
            "debug_window": bool(self.config.context.debug_window),
            "quantized": bool(self.config.quantized),
            "compression": self.config.compression,
            "offload_generated_chunks": bool(self.config.offload_generated_chunks),
            "context_noise_sigma": context_noise_sigma,
            "context_noise_sigma_sink": context_noise_sigma_sink,
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


def _unit_float(value, name: str) -> float:
    value = float(value)
    if not 0.0 <= value <= 1.0:
        raise ValueError(f"runtime.kv_cache.{name} must be in [0, 1], got {value}")
    return value
