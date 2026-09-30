from __future__ import annotations

from collections.abc import Callable
from typing import Generic, TypeVar

T = TypeVar("T")


class Registry(Generic[T]):
    """Small explicit registry used by models, tasks, algorithms, and runtimes."""

    def __init__(self, name: str) -> None:
        self.name = name
        self._items: dict[str, T] = {}
        self._unavailable: dict[str, BaseException] = {}

    def record_unavailable(self, key: str, error: BaseException) -> None:
        """Note that ``key`` exists but could not be imported.

        Lets ``get`` explain *why* an entry is missing rather than reporting it
        as an unknown name, which reads like a typo in the config.
        """

        self._unavailable[key] = error

    def register(self, key: str, value: T | None = None) -> Callable[[T], T] | T:
        def decorator(obj: T) -> T:
            if key in self._items:
                raise KeyError(f"{self.name} registry already contains {key!r}")
            self._items[key] = obj
            return obj

        if value is None:
            return decorator
        return decorator(value)

    def get(self, key: str) -> T:
        try:
            return self._items[key]
        except KeyError as exc:
            error = self._unavailable.get(key)
            if error is not None:
                raise KeyError(
                    f"{self.name} {key!r} failed to import: {error!r}. "
                    "Install its dependencies or fix the import error above."
                ) from error
            available = ", ".join(sorted(self._items)) or "<empty>"
            raise KeyError(f"Unknown {self.name} {key!r}. Available: {available}") from exc

    def has(self, key: str) -> bool:
        return key in self._items

    def keys(self) -> list[str]:
        return sorted(self._items)
