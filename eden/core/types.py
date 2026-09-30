from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


TensorLike = Any


@dataclass
class ModalityPayload:
    """A typed payload for one modality or output head."""

    name: str
    data: TensorLike | None = None
    mask: TensorLike | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class ConditionBundle:
    """Typed conditions consumed by adapters and algorithms."""

    items: dict[str, ModalityPayload] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)

    def get(self, name: str, default: ModalityPayload | None = None) -> ModalityPayload | None:
        return self.items.get(name, default)

    def require(self, name: str) -> ModalityPayload:
        if name not in self.items:
            raise KeyError(f"Missing required condition {name!r}")
        return self.items[name]


@dataclass
class TargetBundle:
    """Typed training targets, for example video latents and camera poses."""

    items: dict[str, ModalityPayload] = field(default_factory=dict)

    def get(self, name: str, default: ModalityPayload | None = None) -> ModalityPayload | None:
        return self.items.get(name, default)

    def require(self, name: str) -> ModalityPayload:
        if name not in self.items:
            raise KeyError(f"Missing required target {name!r}")
        return self.items[name]


@dataclass
class OutputBundle:
    """Decoded model outputs."""

    items: dict[str, ModalityPayload] = field(default_factory=dict)


@dataclass
class PredictionBundle:
    """Raw model predictions before optional decoding."""

    predictions: dict[str, ModalityPayload] = field(default_factory=dict)
    aux: dict[str, Any] = field(default_factory=dict)
    cache: Any | None = None

    def get(self, name: str, default: ModalityPayload | None = None) -> ModalityPayload | None:
        return self.predictions.get(name, default)

    def require(self, name: str) -> ModalityPayload:
        if name not in self.predictions:
            raise KeyError(f"Missing required prediction {name!r}")
        return self.predictions[name]


@dataclass
class Batch:
    """Framework-level batch independent of any specific Video DiT."""

    inputs: dict[str, ModalityPayload] = field(default_factory=dict)
    conditions: ConditionBundle = field(default_factory=ConditionBundle)
    targets: TargetBundle = field(default_factory=TargetBundle)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class EncodedBatch:
    """Adapter-normalized batch ready for objectives and DiT calls."""

    latents: TensorLike | None
    conditions: ConditionBundle
    targets: TargetBundle
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class RuntimeContext:
    """Runtime capabilities currently attached to a model/trainer call."""

    device: Any | None = None
    dtype: Any | None = None
    distributed: dict[str, Any] = field(default_factory=dict)
    precision: dict[str, Any] = field(default_factory=dict)
    cache: dict[str, Any] = field(default_factory=dict)
    extras: dict[str, Any] = field(default_factory=dict)
