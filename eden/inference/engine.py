from __future__ import annotations

from typing import Any

from eden.core.types import RuntimeContext
from eden.inference.request import GenerationOutput, GenerationRequest
from eden.inference.strategies import default_strategies
from eden.models.base import ModelAdapter
from eden.runtime.base import RuntimePlugin


class InferenceEngine:
    """Composable inference entrypoint shared by validation and offline runs."""

    def __init__(
        self,
        model: ModelAdapter,
        runtime_context: RuntimeContext | None = None,
        runtime_plugins: list[RuntimePlugin] | None = None,
        config: dict[str, Any] | None = None,
    ) -> None:
        self.model = model
        self.config = config or {}
        self.runtime_context = runtime_context or RuntimeContext()
        for plugin in runtime_plugins or []:
            self.runtime_context = plugin.attach(model, self.runtime_context)
        self.strategies = default_strategies()

    def generate(self, request: GenerationRequest) -> GenerationOutput:
        strategy_name = request.strategy or str(self.config.get("strategy", "diffusion"))
        if strategy_name == "causal":
            strategy_name = "chunk_causal"
        if strategy_name not in self.strategies:
            available = ", ".join(sorted(self.strategies))
            raise KeyError(f"Unknown inference strategy {strategy_name!r}; available: {available}")
        return self.strategies[strategy_name].generate(self.model, request, self.runtime_context)
