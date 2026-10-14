from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from edenlive.core.types import (
    ConditionBundle,
    PredictionBundle,
    RuntimeContext,
)
from edenlive.core.config_schema import config_get


@dataclass(frozen=True)
class ModelCapabilities:
    """Static contract advertised by a model adapter.

    Algorithms and runtime plugins use this before execution to reject invalid
    combinations, such as using a teacher-forcing algorithm with a model that
    does not expose the required causal forward hook.
    """

    tasks: tuple[str, ...]
    conditions: tuple[str, ...]
    outputs: tuple[str, ...]
    runtimes: tuple[str, ...] = ()

class ModelAdapter(ABC):
    """Boundary between Eden algorithms and a concrete Video DiT family.

    A model adapter owns all model-family-specific details: loading weights,
    encoding conditions, running the DiT, decoding latents, exposing trainable
    modules, and providing optional causal/KV-cache hooks. Algorithm, runtime,
    and inference layers should call these hooks instead of reaching into a
    concrete pipeline or component tree.

    Subclasses must implement the abstract methods below. Optional hooks raise
    ``NotImplementedError`` by default; implement them only when the model
    supports the corresponding algorithm/runtime/inference strategy.
    """

    def __init__(self, config: Any) -> None:
        self.config = config
        self.name = config_get(config, "name", self.__class__.__name__)

    @property
    @abstractmethod
    def capabilities(self) -> ModelCapabilities:
        """Return the tasks, condition names, output names, and runtimes supported.

        Output format:
            ``ModelCapabilities`` with stable string identifiers. These names are
            matched against algorithm requirements and runtime plugin names.
        """
        raise NotImplementedError

    @abstractmethod
    def load_components(self, runtime_context: RuntimeContext | None = None) -> None:
        """Load model-family components and move them into an execution-ready state.

        Inputs:
            ``runtime_context`` carries the target device, distributed state, and
            runtime flags such as FSDP meta-init.

        Expected behavior:
            Load reusable components exactly once, cache them on the adapter, and
            prepare trainable modules for subsequent forward calls.
        """
        raise NotImplementedError

    @abstractmethod
    def forward_dit(
        self,
        noisy_latents: Any,
        timesteps: Any,
        conditions: ConditionBundle,
        *,
        cache: Any | None = None,
        output_heads: tuple[str, ...] = ("video",),
        runtime_context: RuntimeContext | None = None,
        **kwargs: Any,
    ) -> PredictionBundle:
        """Run a standard bidirectional DiT denoising forward.

        Inputs:
            ``noisy_latents`` are model latent tensors.
            ``timesteps`` are model-scaled timesteps, usually from
            ``EdenScheduler``.
            ``conditions`` must contain adapter-specific encoded condition
            payloads, commonly ``prompt_embeds``.
            ``output_heads`` names requested outputs, such as ``("video",)``.

        Output format:
            ``PredictionBundle`` keyed by output name. The video prediction is
            expected to be under ``predictions["video"]`` when requested.
        """
        raise NotImplementedError

    def encode_generation_prompts(
        self,
        prompts: list[str],
        conditions: ConditionBundle | None = None,
        runtime_context: RuntimeContext | None = None,
        *,
        unconditional: bool = False,
    ) -> Any:
        """Encode inference prompts, including model-specific multimodal context.

        The default remains text-only. Adapters whose text encoder consumes a
        first-frame image (for example a VLM-backed TI2V model) override this
        hook so bidirectional generation does not grow model-specific branches.
        """
        del conditions, unconditional
        return self.encode_prompts(prompts, runtime_context)

    def prepare_causal_image_condition(
        self,
        condition_latents: Any,
        conditions: ConditionBundle,
        runtime_context: RuntimeContext | None = None,
    ) -> tuple[Any, ConditionBundle]:
        """Split TI2V state into a clean AR prefix and model-side condition.

        The default treats every image-condition latent frame as a clean prefix,
        matching replacement-style TI2V adapters. Channel-conditioned models can
        override this hook to keep a longer condition timeline in ``conditions``
        while exposing only the independently given frame(s) as clean KV-cache
        prefill. Both positive and CFG-unconditional bundles pass through this
        hook so model-side image conditions remain explicit in either branch.
        """

        del runtime_context
        return condition_latents, conditions
