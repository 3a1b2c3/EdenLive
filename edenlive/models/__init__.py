from edenlive.core.registry import Registry
from edenlive.models.base import ModelAdapter, ModelCapabilities

MODEL_ADAPTERS: Registry[type[ModelAdapter]] = Registry("model_adapter")

try:
    from edenlive.models.adapters.wan22_diffusers.adapter import Wan22DiffusersAdapter

    MODEL_ADAPTERS.register("wan22_diffusers", Wan22DiffusersAdapter)
except ImportError as exc:
    # Optional heavy dependencies (diffusers, transformers) may be absent, and an
    # adapter import must not break `import edenlive`. Record why so a later
    # "Unknown model_adapter" failure can name the real cause instead of looking
    # like a typo in the config.
    MODEL_ADAPTERS.record_unavailable("wan22_diffusers", exc)

__all__ = ["MODEL_ADAPTERS", "ModelAdapter", "ModelCapabilities"]
