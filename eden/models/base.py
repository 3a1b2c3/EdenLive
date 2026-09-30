from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from eden.core.types import (
    Batch,
    ConditionBundle,
    EncodedBatch,
    OutputBundle,
    PredictionBundle,
    RuntimeContext,
    TargetBundle,
)
from eden.core.config_schema import config_get

if TYPE_CHECKING:
    from eden.schedulers.base import InferenceSchedulerProfile


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

    def supports_task(self, task: str) -> bool:
        return task in self.tasks

    def supports_conditions(self, conditions: tuple[str, ...]) -> bool:
        return all(item in self.conditions for item in conditions)

    def supports_outputs(self, outputs: tuple[str, ...]) -> bool:
        return all(item in self.outputs for item in outputs)


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
    def encode_batch(self, batch: Batch, runtime_context: RuntimeContext | None = None) -> EncodedBatch:
        """Convert a raw dataloader ``Batch`` into model-ready tensors/payloads.

        Inputs:
            ``Batch`` uses common Eden keys such as ``conditions["text"]``
            and ``targets["video"]``. Extra conditions may be present.

        Output format:
            ``EncodedBatch`` containing latent tensors, encoded conditions,
            original targets, and metadata needed by algorithms.
        """
        raise NotImplementedError

    @abstractmethod
    def encode_conditions(self, conditions: ConditionBundle, runtime_context: RuntimeContext | None = None) -> ConditionBundle:
        """Encode condition payloads without touching targets.

        Inputs:
            ``ConditionBundle`` may contain text, image, reference video, or
            model-specific custom payloads.

        Output format:
            Another ``ConditionBundle`` with the same semantic condition names,
            but values converted to model-ready embeddings/latents when needed.
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

    @abstractmethod
    def decode_outputs(
        self,
        predictions: PredictionBundle,
        output_specs: tuple[str, ...] = ("video",),
        runtime_context: RuntimeContext | None = None,
    ) -> OutputBundle:
        """Decode model predictions into requested output modalities.

        Inputs:
            ``predictions`` is the result of a model forward. ``output_specs``
            lists output names requested by an algorithm or inference strategy.

        Output format:
            ``OutputBundle`` keyed by output name. Values are ``ModalityPayload``
            instances containing decoded tensors or media-ready arrays.
        """
        raise NotImplementedError

    @abstractmethod
    def scheduler(self) -> Any:
        """Return the Eden scheduler used by this adapter.

        Output format:
            An object implementing ``EdenScheduler``. It may wrap native
            model scheduler metadata, but training and inference should consume
            the Eden scheduler API.
        """
        raise NotImplementedError

    # Inference primitives. GenerationStrategy implementations call these hooks
    # instead of reaching into concrete model internals.
    def encode_prompts(self, prompts: list[str], runtime_context: RuntimeContext | None = None) -> Any:
        """Encode text prompts for training or inference.

        Inputs:
            A list of prompt strings, already batched by the caller.

        Output format:
            Model-specific text embeddings suitable for ``forward_dit`` or
            causal cached forward hooks.
        """
        raise NotImplementedError(f"{self.name} does not implement text prompt encoding")

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

    def prepare_dit_conditions(
        self,
        prompt_embeds: Any,
        conditions: ConditionBundle | None = None,
        runtime_context: RuntimeContext | None = None,
        *,
        unconditional: bool = False,
    ) -> ConditionBundle:
        """Build model-ready DiT conditions while preserving optional modalities.

        The default contract is text-only. Adapters can add encoded image,
        reference-video, or custom conditions without requiring algorithms and
        generation strategies to know their model-specific representation.
        """
        from eden.core.types import ModalityPayload

        return ConditionBundle(items={"prompt_embeds": ModalityPayload("prompt_embeds", prompt_embeds)})

    def cfg_decoupled_control(self, runtime_context: RuntimeContext | None = None) -> str | None:
        """Name the control condition that CFG can guide independently of text.

        Returns ``None`` (the default) when this adapter's unconditional branch
        differs from its conditional branch only by the text prompt. An adapter
        returns a condition name when ``prepare_dit_conditions(...,
        unconditional=True)`` replaces exactly that one named control with its
        neutral value, so a strategy can build the intermediate
        positive-prompt/neutral-control branch by passing positive prompt
        embeddings together with ``unconditional=True``.

        Advertising a name is a contract: the ``unconditional`` flag must not
        also alter any other condition, otherwise the extra guidance term would
        mix two axes.
        """
        del runtime_context
        return None

    def prepare_causal_dit_conditions(
        self,
        prompt_embeds: Any,
        conditions: ConditionBundle | None = None,
        runtime_context: RuntimeContext | None = None,
        *,
        chunk_start: int = 0,
        chunk_frames: int | None = None,
        unconditional: bool = False,
    ) -> ConditionBundle:
        """Prepare conditions for one chunk of a causal generation request.

        The default is deliberately identical to :meth:`prepare_dit_conditions`.
        Adapters with long temporal controls can override this hook (or consume
        the chunk arguments in their existing condition preparation) to encode
        only the current chunk instead of materializing a full control timeline.
        """

        del chunk_start, chunk_frames
        return self.prepare_dit_conditions(
            prompt_embeds,
            conditions,
            runtime_context,
            unconditional=unconditional,
        )

    def encode_video_latents(
        self,
        video: Any,
        runtime_context: RuntimeContext | None = None,
        sample_mode: str = "argmax",
    ) -> Any:
        """Encode video tensors into the latent space used by the DiT.

        Inputs:
            ``video`` is usually a batched tensor from ``targets["video"]``.
            ``sample_mode`` selects deterministic or sampled VAE latents when the
            underlying model supports both.

        Output format:
            A latent tensor with the model's channel/time/height/width layout.
        """
        raise NotImplementedError(f"{self.name} does not implement video latent encoding")

    def prepare_generation_latents(
        self,
        *,
        batch_size: int,
        height: int,
        width: int,
        num_frames: int,
        runtime_context: RuntimeContext | None = None,
        generator: Any | None = None,
    ) -> Any:
        """Create the initial latent noise tensor for generation.

        Inputs:
            Batch size and requested decoded video size/frame count. ``generator``
            should be honored for deterministic inference when supported.

        Output format:
            A model latent tensor ready for the inference denoising loop.
        """
        raise NotImplementedError(f"{self.name} does not implement generation latent preparation")

    def offload_generation_latents(
        self,
        latents: Any,
        runtime_context: RuntimeContext | None = None,
    ) -> Any:
        """Move the inactive chunk-AR latent trajectory out of accelerator memory.

        The generic default targets CPU and preserves non-tensor objects. Model
        adapters may override this when their latent container needs a custom
        transfer operation. The active chunk is moved back to the execution
        device by the cache manager immediately before denoising.
        """

        del runtime_context
        device = getattr(latents, "device", None)
        if device is None or device.type == "cpu":
            return latents
        return latents.to(device="cpu")

    def decode_video_latents(self, latents: Any, runtime_context: RuntimeContext | None = None) -> Any:
        """Decode model video latents into video output tensors/arrays."""
        raise NotImplementedError(f"{self.name} does not implement video latent decoding")

    # Image-to-video conditioning. The generation strategy stays model-agnostic: it
    # resolves the condition latent (via ``encode_image_condition``) and delegates how
    # the condition enters the forward pass to these hooks, so each model family can
    # use its own convention (Wan2.2: clean first-frame latent + per-token timestep;
    # Wan2.1 I2V: channel-concat + CLIP cross-attention; etc.).
    def encode_image_condition(
        self,
        image: Any,
        runtime_context: RuntimeContext | None = None,
        *,
        generator: Any | None = None,
        num_frames: int | None = None,
    ) -> Any:
        """Encode a conditioning image into the model's condition latent.

        ``generator`` must be honored when the model samples from a VAE posterior,
        so seeded inference remains reproducible. Under sequence parallelism the
        adapter is responsible for synchronizing any stochastic condition latent.

        ``num_frames`` is the requested number of decoded video frames. Most TI2V
        models encode only the supplied image and may ignore it. I2V models with a
        temporal VAE can use it to build the model-native condition video before
        encoding (for example, Wan2.2 I2V-A14B encodes ``[image, zeros...]`` as one
        complete video rather than padding a one-frame latent afterwards).
        """
        raise NotImplementedError(f"{self.name} does not implement image conditioning")

    def prepare_image_conditioned_input(
        self,
        *,
        noisy_latents: Any,
        condition_latents: Any,
        timestep: Any,
        runtime_context: RuntimeContext | None = None,
    ) -> tuple[Any, Any]:
        """Assemble ``(model_input, model_timestep)`` for an image-conditioned step.

        Called once per denoising step when an image condition is present. Returns
        the tensor to feed ``forward_dit`` and the (possibly per-token) timestep.
        """
        raise NotImplementedError(f"{self.name} does not implement image-conditioned denoising")

    def merge_image_condition(
        self,
        latents: Any,
        condition_latents: Any,
        runtime_context: RuntimeContext | None = None,
    ) -> Any:
        """Impose the clean condition onto the final latents before decoding.

        Replacement-style models overwrite their condition frames; concat/embedding
        models leave the denoised latents untouched (the identity default).
        """
        return latents

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

    def raw_scheduler(self, runtime_context: RuntimeContext | None = None) -> Any:
        """Return the underlying native scheduler when useful for debugging.

        By default this is the Eden scheduler. Adapters may override it to
        expose the model family's original scheduler object.
        """
        return self.scheduler()

    def inference_scheduler_profile(
        self,
        runtime_context: RuntimeContext | None = None,
    ) -> "InferenceSchedulerProfile":
        """Return model numerics used by generic inference schedulers.

        This profile describes parameterization facts, not an allow-list.  Any
        registered solver may consume it when selected by inference config.
        """

        from eden.schedulers.base import InferenceSchedulerProfile

        del runtime_context
        scheduler = self.scheduler()
        config = getattr(scheduler, "config", None)
        if isinstance(config, dict):
            defaults = dict(config.get("inference", {}))
            prediction_type = str(config.get("prediction_type", getattr(scheduler, "prediction_type", "velocity")))
            timestep_scale = float(config.get("timestep_scale", getattr(scheduler, "timestep_scale", 1000.0)))
            num_train_timesteps = int(config.get("num_train_timesteps", timestep_scale))
        else:
            defaults = {}
            prediction_type = str(getattr(scheduler, "prediction_type", "velocity"))
            timestep_scale = float(getattr(scheduler, "timestep_scale", self.num_train_timesteps()))
            num_train_timesteps = int(getattr(scheduler, "num_train_timesteps", timestep_scale))
        parameterization = "flow_velocity" if prediction_type in {"velocity", "flow_prediction"} else prediction_type
        return InferenceSchedulerProfile(
            parameterization=parameterization,
            prediction_type=prediction_type,
            timestep_scale=timestep_scale,
            num_train_timesteps=num_train_timesteps,
            defaults=defaults,
        )

    def build_native_inference_scheduler(
        self,
        config: dict[str, Any] | None = None,
        runtime_context: RuntimeContext | None = None,
    ) -> Any:
        """Return the model release's native scheduler for one request.

        Adapters with stateful native schedulers should override this and return
        a fresh instance.  The base fallback preserves legacy adapters.
        """

        del config, runtime_context
        return self.scheduler()

    def num_train_timesteps(self, default: int = 1000) -> int:
        """Return the model scheduler's training timestep scale."""
        scheduler = self.scheduler()
        scheduler_cfg = getattr(scheduler, "config", None)
        return int(
            getattr(
                scheduler_cfg,
                "num_train_timesteps",
                getattr(scheduler, "num_train_timesteps", default),
            )
        )

    # Optional training/inference hooks for causal teacher-forcing and AR rollout.
    def forward_dit_teacher_forcing(
        self,
        *,
        noisy_latents: Any,
        clean_latents: Any,
        timesteps: Any,
        clean_timesteps: Any,
        prompt_embeds: Any,
        conditions: ConditionBundle | None = None,
        chunk_size: int,
        max_context_frames: int | None = None,
        sink_frames: int = 0,
        independent_first_frame: bool = False,
        pack_first_frame: bool = False,
        modules: Any | None = None,
        runtime_context: RuntimeContext | None = None,
    ) -> Any:
        """Run a teacher-forcing DiT forward over clean context plus noisy chunks.

        Inputs:
            ``noisy_latents`` are the noisy prediction targets.
            ``clean_latents`` are clean or augmented-clean context latents.
            ``timesteps`` and ``clean_timesteps`` are model-scaled timestep
            tensors for noisy and clean streams.
            ``prompt_embeds`` are encoded text conditions.
            ``chunk_size`` is in latent frames.
            ``max_context_frames`` and ``sink_frames`` are optional latent-frame
            attention-window controls for the teacher-forcing mask.
            ``independent_first_frame`` treats the TI2V condition frame as its
            own chunk before the regular causal chunks.
            ``pack_first_frame`` keeps that frame clean but places it inside
            the first regular ``chunk_size`` attention block instead.
            ``modules`` optionally selects an adapter-owned compatible replica,
            such as a frozen distillation teacher or EMA target.

        Output format:
            A tensor prediction aligned with ``noisy_latents``.
        """
        raise NotImplementedError(f"{self.name} does not implement teacher-forcing DiT forward")

    def generation_frame_seq_length(self, latents: Any, runtime_context: RuntimeContext | None = None) -> int:
        """Return the number of DiT sequence tokens contributed by one latent frame."""
        raise NotImplementedError(f"{self.name} does not expose generation frame sequence length")

    def forward_dit_causal_cached(
        self,
        latents: Any,
        timesteps: Any,
        prompt_embeds: Any,
        caches_by_transformer: Any,
        *,
        current_start: int,
        runtime_context: RuntimeContext | None = None,
    ) -> Any:
        """Run a causal DiT forward using an existing model-specific KV cache.

        Inputs:
            ``latents`` are the current denoising chunk.
            ``current_start`` is the chunk start in flattened sequence tokens.
            ``caches_by_transformer`` is created by the adapter cache backend.

        Output format:
            A tensor prediction aligned with the current chunk.
        """
        raise NotImplementedError(f"{self.name} does not implement cached causal DiT forward")

    def build_cache(self, runtime_context: RuntimeContext | None = None) -> Any | None:
        """Build a model-specific cache object when the adapter owns cache allocation."""
        raise NotImplementedError(f"{self.name} does not implement cache construction")

    def prepare_causal(self, runtime_context: RuntimeContext | None = None) -> None:
        """Prepare model internals for causal/chunk-autoregressive execution."""
        raise NotImplementedError(f"{self.name} does not implement causal preparation")

    def trainable_modules(self) -> dict[str, Any]:
        """Return named trainable modules owned by the adapter.

        Runtime plugins and checkpoint code use this mapping for FSDP wrapping,
        parameter iteration, and state dict extraction. Frozen encoders/VAEs
        should not be returned here.
        """
        return {}

    def trainable_parameters(self):
        """Yield parameters from ``trainable_modules`` for optimizer construction."""
        for module in self.trainable_modules().values():
            if module is not None:
                yield from module.parameters()

    def prepare_trainable_parameter_dtype(self, runtime_context: RuntimeContext | None = None) -> None:
        """Keep optimizer-owned parameters in the runtime storage dtype.

        FSDP2 mixed precision computes in ``context.dtype`` while the sharded
        master weights stay in ``context.precision['param_dtype']``. Adapters
        that load weights in the compute dtype should call this after the
        trainable modules exist so AdamW does not update BF16 parameters.
        Frozen encoders and VAE weights are not returned by
        ``trainable_modules`` and therefore keep the compute dtype.
        """

        from eden.runtime.precision import cast_trainable_parameters, param_dtype

        if runtime_context is not None and runtime_context.extras.get("mode") != "train":
            return
        storage = param_dtype(runtime_context)
        if storage is None:
            return
        cast_trainable_parameters(self.trainable_modules(), storage)

    def post_fsdp_materialize_replicas(
        self,
        module_groups: dict[str, dict[str, Any]],
        runtime_context: RuntimeContext | None = None,
    ) -> None:
        """Finalize algorithm-owned frozen replicas after meta materialization."""
        del module_groups, runtime_context

    def replica_sharding_plan(
        self,
        module_groups: dict[str, dict[str, Any]],
        runtime_context: RuntimeContext | None = None,
    ) -> dict[str, tuple[Any, ...]]:
        """Describe how adapter-compatible frozen replicas are sharded.

        The default conservatively wraps each replica root. Model families
        with a known transformer layout should override this and list their
        internal FSDP block roots without exposing that layout to algorithms.
        """
        del runtime_context
        roots = tuple(
            module
            for modules in module_groups.values()
            for module in modules.values()
            if module is not None
        )
        return {"blocks": (), "roots": roots}

    def sharding_plan(self, runtime_context: RuntimeContext | None = None) -> dict[str, tuple[Any, ...]]:
        """Return module groups used by distributed runtime plugins.

        Output format:
            ``{"blocks": tuple(...), "roots": tuple(...)}``, where blocks are
            typically transformer layers and roots are top-level trainable
            modules. FSDP2 uses this plan to decide what to shard.
        """
        roots = tuple(module for module in self.trainable_modules().values() if module is not None)
        blocks = tuple(block for module in roots for block in getattr(module, "blocks", ()))
        return {"blocks": blocks, "roots": roots}

    def cache_backend(self, runtime_context: RuntimeContext | None = None) -> Any | None:
        """Return a ``CausalCacheBackend`` for chunk-causal inference."""
        raise NotImplementedError(f"{self.name} does not implement a causal cache backend")

    def fsdp_root_module(self, runtime_context: RuntimeContext | None = None) -> Any | None:
        """Return the root module whose state should be checkpointed under FSDP."""
        modules = {name: module for name, module in self.trainable_modules().items() if module is not None}
        if not modules:
            return None
        if len(modules) == 1:
            return next(iter(modules.values()))
        try:
            import torch

            return torch.nn.ModuleDict(modules)
        except Exception:
            return None

    def pre_fsdp_state_dict(self, runtime_context: RuntimeContext | None = None) -> dict[str, Any] | None:
        """Return a CPU state dict captured before FSDP meta-init materialization."""
        root = self.fsdp_root_module(runtime_context)
        if root is None:
            return None
        return {key: value.detach().cpu().clone() for key, value in root.state_dict().items()}

    def post_fsdp_materialize(self, runtime_context: RuntimeContext | None = None) -> None:
        """Run adapter-specific fixes after FSDP materializes meta tensors."""
        return None
