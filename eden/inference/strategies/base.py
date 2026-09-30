from __future__ import annotations

from abc import ABC, abstractmethod

from eden.core.types import RuntimeContext
from eden.inference.request import GenerationOutput, GenerationRequest
from eden.models.base import ModelAdapter


class GenerationStrategy(ABC):
    """Inference algorithm executed by ``InferenceEngine``.

    A generation strategy owns the denoising/control flow for inference, such as
    bidirectional diffusion or chunk-causal autoregressive rollout. It should
    call ``ModelAdapter`` hooks and runtime managers instead of directly
    accessing model-family internals.
    """

    name: str

    @abstractmethod
    def generate(
        self,
        model: ModelAdapter,
        request: GenerationRequest,
        runtime_context: RuntimeContext,
    ) -> GenerationOutput:
        """Generate outputs for one request.

        Inputs:
            ``model`` is the selected adapter. ``request`` contains typed
            conditions, requested output names, strategy params, and metadata.
            ``runtime_context`` carries device/distributed/cache state.

        Output format:
            ``GenerationOutput`` containing an ``OutputBundle`` keyed by output
            names such as ``video`` plus optional strategy metadata.
        """
        raise NotImplementedError
