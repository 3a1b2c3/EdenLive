from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from eden.core.types import ConditionBundle, OutputBundle


@dataclass
class GenerationRequest:
    """Framework-level inference request.

    Conditions and outputs stay typed so text/image/custom modalities can be
    added without changing pipeline method signatures.
    """

    conditions: ConditionBundle
    strategy: str = "diffusion"
    outputs: tuple[str, ...] = ("video",)
    params: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class GenerationOutput:
    """Structured inference result returned by all generation strategies."""

    outputs: OutputBundle
    metadata: dict[str, Any] = field(default_factory=dict)

    def get(self, name: str, default: Any | None = None):
        return self.outputs.items.get(name, default)
