from __future__ import annotations

from abc import ABC
from typing import TYPE_CHECKING, Any

from edenlive.core.config_schema import build_config
from edenlive.core.types import RuntimeContext

if TYPE_CHECKING:  # A runtime plugin only needs ``ModelAdapter`` for annotations, and
    # ``from __future__ import annotations`` defers those.  Importing it eagerly closes
    # a cycle: ``edenlive.runtime`` -> here -> ``edenlive.models`` -> the Wan adapter
    # -> back into the half-initialized ``edenlive.runtime``.  ``models/__init__.py``
    # catches that ImportError and leaves MODEL_ADAPTERS permanently empty, so the
    # failure surfaces much later as "Unknown model_adapter".
    from edenlive.models.base import ModelAdapter


class RuntimePlugin(ABC):
    """Runtime optimization plugin applied around a model adapter.

    Runtime plugins own cross-cutting execution concerns such as FSDP2,
    sequence parallelism, KV-cache settings, precision, or future memory
    optimizations. They should not implement algorithm loss logic or
    model-family internals. Instead they attach structured runtime state to
    ``RuntimeContext`` and optionally mutate/wrap model modules before training
    or inference starts.

    Subclasses normally provide an inner ``Config`` dataclass and override
    ``attach`` and/or ``prepare_model``.
    """

    name = "runtime"
    Config = dict

    def __init__(self, config: dict[str, Any]) -> None:
        """Parse the plugin config block from ``runtime.<plugin_name>``."""
        config_cls = getattr(self, "Config", dict)
        self.config = build_config(config_cls, config) if config_cls is not dict else dict(config or {})

    @property
    def enabled(self) -> bool:
        return bool(getattr(self.config, "enabled", False))

    def validate(self, model: ModelAdapter) -> None:
        """Ensure the selected model adapter advertises support for this plugin."""
        if self.name not in model.capabilities.runtimes:
            raise ValueError(f"Model adapter {model.name} does not support runtime {self.name}")

    def attach(self, model: ModelAdapter, context: RuntimeContext) -> RuntimeContext:
        """Attach runtime state before model loading/preparation.

        Inputs:
            ``model`` is the selected adapter. ``context`` is the mutable
            per-run state passed through trainers and inference engines.

        Output format:
            The same ``RuntimeContext`` instance or a replacement context with
            plugin state written into ``context.distributed``, ``context.cache``,
            or ``context.extras``.
        """
        if not self.enabled:
            return context
        self.validate(model)
        context.extras.setdefault("runtime_plugins", []).append(self.name)
        return context

    def prepare_model(self, model: ModelAdapter, context: RuntimeContext) -> None:
        """Apply module-level runtime changes after components are loaded.

        Examples include FSDP wrapping, sequence-parallel setup, precision
        transforms, or other operations that require concrete model modules.
        """
        return None
