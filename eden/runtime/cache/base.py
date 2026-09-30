from __future__ import annotations

from typing import Any, Protocol


class CausalCacheBackend(Protocol):
    """Model-specific backend behind the runtime KV-cache lifecycle.

    The cache manager owns the generic chunk-autoregressive denoising loop.
    This backend is the adapter-provided bridge that allocates model-native
    cache storage and runs cached forwards. All positions and attention budgets
    are expressed in flattened DiT sequence tokens, not latent frames.
    """

    def allocate(self, *, batch_size: int, max_tokens: int) -> Any:
        """Allocate cache storage for one prompt branch.

        Inputs:
            ``batch_size`` is the local batch. ``max_tokens`` is the physical
            flattened-token capacity. With a configured context window this is
            the fixed sink-plus-recent capacity, not the full rollout length.

        Output format:
            A model-specific cache handle passed back to ``forward`` and
            ``commit`` unchanged.
        """
        ...

    def forward(
        self,
        latents,
        timesteps,
        condition,
        cache,
        *,
        current_start: int,
        max_attention_tokens: int | None = None,
        sink_attention_tokens: int = 0,
    ):
        """Run one cached forward for the current denoising chunk.

        Inputs:
            ``latents`` contains only the current chunk.
            ``current_start`` is the chunk start offset in flattened tokens.
            ``max_attention_tokens`` is the total visible-token budget when
            windowing is enabled. ``sink_attention_tokens`` is the prefix token
            budget retained as sink context.

        Output format:
            A prediction tensor aligned with ``latents``.
        """
        ...

    def commit(
        self,
        latents,
        timesteps,
        condition,
        cache,
        *,
        current_start: int,
        max_attention_tokens: int | None = None,
        sink_attention_tokens: int = 0,
    ) -> None:
        """Commit finalized chunk latents into the cache.

        The cache manager calls this after denoising a chunk, usually with zero
        timestep / clean latents. Implementations should update cache state so
        subsequent chunks can attend to the committed history.
        """
        ...


class NullCacheBackend:
    """Fallback backend used when a model does not support causal KV-cache."""

    def allocate(self, *, batch_size: int, max_tokens: int) -> None:
        return None

    def forward(
        self,
        latents,
        timesteps,
        condition,
        cache,
        *,
        current_start: int,
        max_attention_tokens: int | None = None,
        sink_attention_tokens: int = 0,
    ):
        raise RuntimeError("This model adapter does not provide a causal cache backend")

    def commit(
        self,
        latents,
        timesteps,
        condition,
        cache,
        *,
        current_start: int,
        max_attention_tokens: int | None = None,
        sink_attention_tokens: int = 0,
    ) -> None:
        return None
