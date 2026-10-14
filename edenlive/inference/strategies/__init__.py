from __future__ import annotations

from edenlive.inference.strategies.base import GenerationStrategy
from edenlive.inference.strategies.chunk_causal import ChunkCausalStrategy
from edenlive.inference.strategies.diffusion import DiffusionStrategy


def default_strategies() -> dict[str, GenerationStrategy]:
    strategies: list[GenerationStrategy] = [
        DiffusionStrategy(),
        ChunkCausalStrategy(),
    ]
    return {strategy.name: strategy for strategy in strategies}


__all__ = [
    "GenerationStrategy",
    "DiffusionStrategy",
    "ChunkCausalStrategy",
    "default_strategies",
]
