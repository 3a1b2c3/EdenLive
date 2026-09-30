from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class DatasetConfig:
    """One dataset entry: a registered name plus its constructor params.

    Offline inference reads a single ``data.dataset``; the weighted multi-source
    mixture config is a training concern and is not part of this package.
    """

    name: str
    params: dict[str, Any] = field(default_factory=dict)


__all__ = ["DatasetConfig"]
