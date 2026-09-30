from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

from eden.core.config_schema import build_config
from eden.core.types import (
    Batch,
    ConditionBundle,
    EncodedBatch,
    ModalityPayload,
    OutputBundle,
    PredictionBundle,
    RuntimeContext,
)
from eden.models.base import ModelAdapter, ModelCapabilities
from eden.models.adapters.wan22_diffusers.wan_ops import (
    _expand_timesteps_to_tokens,
    allocate_wan_kv_cache,
    patch_wan_transformer_forward,
    wan_causal_forward_with_cache,
    wan_teacher_forcing_forward,
)
from eden.models.adapters.wan22_diffusers.channel_concat import (
    channel_concat_condition_norm_parameters,
    enable_wan_channel_concat,
)
from eden.models.adapters.wan22_diffusers.i2v_condition import (
    FIRST_FRAME_ENCODINGS,
    encode_first_frame_condition,
    first_frame_mask,
)
from eden.models.adapters.wan22_diffusers.proxy_dino_cross_attn import (
    configure_wan_proxy_dino_cross_attention_layers,
)
from eden.models.adapters.wan22_diffusers.teacher_forcing_attention import (
    configure_teacher_forcing_attention,
    validate_backend_name,
    validate_flash4_environment,
    validate_teacher_forcing_attention,
)
from eden.runtime.distributed.sequence_parallel import (
    get_sequence_parallel_state,
    randn_sp_synced,
)
from eden.runtime.precision import compute_dtype, param_dtype, resolve_torch_dtype
from eden.schedulers import (
    DiffusersSchedulerAdapter,
    FlowMatchingScheduler,
    InferenceSchedulerProfile,
    clone_diffusers_scheduler,
)

from eden.utils import get_logger

logger = get_logger(__name__)


class WanCausalCacheBackend:
    """Wan-specific KV-cache backend behind the runtime cache manager."""

    def __init__(self, adapter: "Wan22DiffusersAdapter", runtime_context: RuntimeContext | None = None) -> None:
        self.adapter = adapter
        self.runtime_context = runtime_context

    def allocate(self, *, batch_size: int, max_tokens: int) -> dict[str, Any]:
        return self.adapter._allocate_caches_by_transformer(batch_size, max_tokens, self.runtime_context)

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
        return self.adapter.forward_dit_causal_cached(
            latents,
            timesteps,
            condition,
            cache,
            current_start=current_start,
            max_attention_tokens=max_attention_tokens,
            sink_attention_tokens=sink_attention_tokens,
            cache_update=False,
            runtime_context=self.runtime_context,
        )

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
        self.adapter._update_all_transformer_caches(
            latents,
            timesteps,
            condition,
            cache,
            current_start=current_start,
            max_attention_tokens=max_attention_tokens,
            sink_attention_tokens=sink_attention_tokens,
            cache_update=True,
            runtime_context=self.runtime_context,
        )


class Wan22DiffusersAdapter(ModelAdapter):
    """Minimal Wan2.2 5B Diffusers adapter.

    Loads the Diffusers components, patches causal attention, and converts
    checkpoints.
    """

    _capabilities = ModelCapabilities(
        tasks=("t2v", "ti2v"),
        conditions=("text", "image", "video_context"),
        outputs=("video",),
        runtimes=("fsdp2", "sequence_parallel", "kv_cache", "torch_compile", "attention_backend"),
    )

    @dataclass
    class Config:
        adapter: str = "wan22_diffusers"
        name: str | None = None
        model_id: str = "Wan-AI/Wan2.2-TI2V-5B-Diffusers"
        variant: str = "5b"
        cache_dir: str | None = None
        torch_dtype: str = "bfloat16"
        local_files_only: bool = True
        gradient_checkpointing: bool = True
        max_sequence_length: int = 512
        default_chunk_size: int = 3
        teacher_forcing_attention_backend: str = "triton"
        min_train_timestep: int = 1
        max_train_timestep: int | None = None
        scheduler: dict[str, Any] = field(default_factory=dict)
        proxy_dino: dict[str, Any] = field(default_factory=dict)
        image_condition: dict[str, Any] = field(default_factory=dict)
        negative_prompt: str = ""
        extra: dict[str, Any] = field(default_factory=dict)

    def __init__(self, config: Config | dict[str, Any]) -> None:
        typed_config = build_config(self.Config, config)
        super().__init__(typed_config)
        validate_backend_name(self.config.teacher_forcing_attention_backend)
        self.model_id = self.config.model_id
        self.variant = self.config.variant
        self.components: dict[str, Any] = {}
        self._native_scheduler = None
        self._scheduler = FlowMatchingScheduler(self._scheduler_config())
        self.device = None
        self.dtype = None
        self._loaded_with_meta_init = False
        self._causal_prepared = False

    @property
    def _proxy_dino_enabled(self) -> bool:
        return bool(self.config.proxy_dino.get("enabled", False))

    _IMAGE_CONDITION_MODES = ("replace_first_frame", "mask_channel_concat")

    @property
    def _image_condition_mode(self) -> str:
        """How a first-frame image enters the DiT.

        ``replace_first_frame`` (default): Wan2.2 TI2V-5B -- the 1-frame image latent
        overwrites latent frame 0 and those tokens run at timestep 0 (per-token AdaLN).
        ``mask_channel_concat``: Wan2.1-I2V-14B -- a 4-channel first-frame mask and a
        16-channel condition latent are channel-concatenated onto the 16-channel noisy
        latent (36 DiT input channels); the timestep stays scalar. See
        ``i2v_condition.py`` for the condition construction and its two encodings.
        """

        mode = str(self.config.image_condition.get("mode", "replace_first_frame"))
        if mode not in self._IMAGE_CONDITION_MODES:
            raise ValueError(f"model.image_condition.mode must be one of {self._IMAGE_CONDITION_MODES}, got {mode!r}")
        return mode

    @property
    def _image_condition_concat(self) -> bool:
        return self._image_condition_mode == "mask_channel_concat"

    @property
    def _first_frame_encoding(self) -> str:
        encoding = str(self.config.image_condition.get("first_frame_encoding", "masked_video"))
        if encoding not in FIRST_FRAME_ENCODINGS:
            raise ValueError(
                f"model.image_condition.first_frame_encoding must be one of {FIRST_FRAME_ENCODINGS}, got {encoding!r}"
            )
        return encoding

    def _clip_image_embeds_enabled(self) -> bool:
        """Whether the I2V transformer also takes CLIP image embeds (Wan2.1-I2V does).

        ``auto`` reads the loaded transformer: ``image_dim`` set means the cross-attention
        has ``add_k_proj``/``add_v_proj`` and *expects* image tokens -- running it without
        them attends over an empty key set, so a missing ``image_encoder`` is an error,
        not a silent fallback.
        """

        setting = self.config.image_condition.get("clip_embeds", "auto")
        if isinstance(setting, bool):
            return setting
        if str(setting) != "auto":
            raise ValueError(f"model.image_condition.clip_embeds must be auto|true|false, got {setting!r}")
        transformer = self.components.get("transformer")
        image_dim = getattr(getattr(transformer, "config", None), "image_dim", None)
        if image_dim is None:
            return False
        if self.components.get("image_encoder") is None or self.components.get("image_processor") is None:
            raise RuntimeError(
                "the loaded Wan transformer has image_dim set (expects CLIP image embeds) but the pipeline "
                "shipped no image_encoder/image_processor; set model.image_condition.clip_embeds explicitly"
            )
        return True

    @property
    def _proxy_dino_injection_type(self) -> str:
        """Return the explicit control injection mechanism.

        ``channel_concat`` remains the backwards-compatible default for the
        original Proxy-DINO configuration.  The cross-attention variant keeps
        the pretrained Wan patch embedding unchanged.
        """

        return str(self.config.proxy_dino.get("injection_type", "channel_concat"))

    @property
    def _proxy_dino_channel_concat_enabled(self) -> bool:
        return self._proxy_dino_enabled and self._proxy_dino_injection_type == "channel_concat"

    @property
    def _proxy_dino_channel_concat_rmsnorm(self) -> bool:
        """Whether to RMS-normalize Proxy-DINO channels before channel concat.

        ``channel_concat_rmsnorm`` is the explicit Wan option.  Accept the
        reference implementation's ``condition_rmsnorm`` spelling as a small
        compatibility alias, while leaving the default disabled for existing
        checkpoints/configurations.
        """

        cfg = self.config.proxy_dino
        return bool(
            cfg.get(
                "channel_concat_rmsnorm",
                cfg.get("channel_concat_condition_rmsnorm", cfg.get("condition_rmsnorm", False)),
            )
        )

    @property
    def _proxy_dino_cross_attn_enabled(self) -> bool:
        return self._proxy_dino_enabled and self._proxy_dino_injection_type == "frame_cross_attn"

    @property
    def capabilities(self) -> ModelCapabilities:
        return self._capabilities

    def load_components(self, runtime_context: RuntimeContext | None = None) -> None:
        if self.components:
            return
        try:
            import torch
            from diffusers import DiffusionPipeline
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError(
                "Wan22DiffusersAdapter requires torch and diffusers."
            ) from exc

        dtype_name = self.config.torch_dtype
        dtype = compute_dtype(runtime_context, fallback=resolve_torch_dtype(dtype_name))
        device = (
            runtime_context.device
            if runtime_context is not None and runtime_context.device is not None
            else torch.device("cuda" if torch.cuda.is_available() else "cpu")
        )
        if self.config.teacher_forcing_attention_backend == "flash4":
            validate_flash4_environment(device, dtype)
        meta_init = bool(runtime_context and runtime_context.extras.get("fsdp2_meta_init", False))
        rank = self._distributed_rank()
        load_kwargs = dict(
            torch_dtype=dtype,
            local_files_only=bool(self.config.local_files_only),
            cache_dir=self.config.cache_dir,
        )

        all_meta = bool(runtime_context and runtime_context.extras.get("fsdp2_meta_init_all_meta", False))
        pipeline_overrides = self._pipeline_component_overrides(
            load_kwargs,
            runtime_context,
            use_meta_transformers=bool(meta_init and (rank != 0 or all_meta)),
        )
        pipeline_cls = self._pipeline_loader_class(DiffusionPipeline)
        pipe = pipeline_cls.from_pretrained(
            self.model_id,
            **load_kwargs,
            **pipeline_overrides,
        )

        if not meta_init:
            pipe.to(device)
        if hasattr(pipe, "vae"):
            pipe.vae.requires_grad_(False).eval()
            if not meta_init:
                pipe.vae.to(device=device, dtype=dtype)
        if hasattr(pipe, "text_encoder"):
            pipe.text_encoder.requires_grad_(False).eval()
            if not meta_init:
                pipe.text_encoder.to(device=device, dtype=dtype)
        # Wan2.1-I2V ships a CLIP image encoder; the TI2V/T2V bases do not.
        image_encoder = getattr(pipe, "image_encoder", None)
        if image_encoder is not None:
            image_encoder.requires_grad_(False).eval()
            if not meta_init:
                image_encoder.to(device=device, dtype=dtype)
        for name in ("transformer", "transformer_2"):
            module = getattr(pipe, name, None)
            if module is not None:
                if self._proxy_dino_channel_concat_enabled:
                    enable_wan_channel_concat(
                        module,
                        self._proxy_dino_control_dim(),
                        zero_init_control_channels=bool(
                            self.config.proxy_dino.get("channel_concat_zero_init", True)
                        ),
                        condition_rmsnorm=self._proxy_dino_channel_concat_rmsnorm,
                    )
                configure_wan_proxy_dino_cross_attention_layers(module, self.config.proxy_dino)
                patch_wan_transformer_forward(module)
                configure_teacher_forcing_attention(module, self.config.teacher_forcing_attention_backend)
                if meta_init:
                    module.to(dtype=dtype)
                else:
                    module.to(device=device, dtype=dtype)
                # ``module.to(dtype=...)`` also visits the optional norm. Keep
                # its affine scale in fp32, as the reference implementation
                # does, while its forward casts normalized features back to
                # the transformer's compute dtype.
                if self._proxy_dino_channel_concat_rmsnorm:
                    norm = getattr(getattr(module, "patch_embedding", None), "condition_norm", None)
                    if norm is not None:
                        if meta_init:
                            norm.to(dtype=torch.float32)
                        else:
                            norm.to(device=device, dtype=torch.float32)
                module.requires_grad_(False).eval()
                if self.config.gradient_checkpointing and hasattr(module, "enable_gradient_checkpointing"):
                    module.enable_gradient_checkpointing()
        self.components = {
            "pipeline": pipe,
            "transformer": getattr(pipe, "transformer", None),
            "transformer_2": getattr(pipe, "transformer_2", None),
            "vae": getattr(pipe, "vae", None),
            "text_encoder": getattr(pipe, "text_encoder", None),
            "scheduler": getattr(pipe, "scheduler", None),
            "image_encoder": image_encoder,
            "image_processor": getattr(pipe, "image_processor", None),
            "proxy_dino": self._load_proxy_dino(device=device, dtype=dtype) if self._proxy_dino_enabled else None,
        }
        loaded_transformers = tuple(
            name for name in ("transformer", "transformer_2") if self.components.get(name) is not None
        )
        if runtime_context is not None:
            runtime_context.extras["wan_transformer_components"] = loaded_transformers
        logger.info_rank0(f"Wan transformer components loaded: {loaded_transformers}")
        self._native_scheduler = self.components["scheduler"]
        self._scheduler = FlowMatchingScheduler(
            self._scheduler_config(self._native_scheduler),
            native_scheduler=self._native_scheduler,
        )
        self.device = device
        self.dtype = dtype
        self._loaded_with_meta_init = meta_init
        self.prepare_trainable_parameter_dtype(runtime_context)

    def _scheduler_config(self, native_scheduler: Any | None = None) -> dict[str, Any]:
        native_cfg = getattr(native_scheduler, "config", None)
        shift = getattr(
            native_cfg,
            "shift",
            getattr(native_cfg, "flow_shift", getattr(native_scheduler, "shift", 5.0)),
        )
        num_train_timesteps = int(
            getattr(native_cfg, "num_train_timesteps", getattr(native_scheduler, "num_train_timesteps", 1000))
        )
        cfg = {
            "prediction_type": "velocity",
            "timestep_scale": float(num_train_timesteps),
            "num_train_timesteps": num_train_timesteps,
            "training": {
                "sampler": "uniform",
                "min_sigma": float(self.config.min_train_timestep) / float(num_train_timesteps),
                "max_sigma": float(self.config.max_train_timestep or num_train_timesteps) / float(num_train_timesteps),
            },
            "inference": {
                "schedule": "shifted_linear",
                "shift": float(shift),
                "stretch": False,
                "min_sigma": 0.0,
                "max_sigma": 1.0,
            },
        }
        return _deep_merge_dict(cfg, self.config.scheduler)

    def _transformer_components_to_load(
        self,
        runtime_context: RuntimeContext | None = None,
    ) -> tuple[str, ...]:
        """Return Diffusers transformer component names needed by this run.

        The generic Wan adapter preserves the checkpoint's complete transformer
        set. Multi-expert adapters may narrow this list for a training run so
        ``DiffusionPipeline.from_pretrained`` never reads inactive weights.
        """

        del runtime_context
        return ("transformer", "transformer_2")

    def _pipeline_loader_class(self, default_class: Any) -> Any:
        """Return the concrete Diffusers pipeline class used for loading.

        Calling ``DiffusionPipeline.from_pretrained`` on the base class loses
        optional-component overrides because its own ``_optional_components``
        list is empty. Multi-expert adapters can return the concrete pipeline
        class so ``None`` overrides for inactive experts are honored.
        """

        return default_class

    def _required_transformer_components(
        self,
        runtime_context: RuntimeContext | None = None,
    ) -> tuple[str, ...]:
        """Return requested components whose meta construction must succeed."""

        del runtime_context
        # The base Wan adapter also covers single-transformer checkpoints where
        # ``transformer_2`` is genuinely absent and remains optional.
        return ("transformer",)

    def _pipeline_component_overrides(
        self,
        load_kwargs: dict[str, Any],
        runtime_context: RuntimeContext | None,
        *,
        use_meta_transformers: bool,
    ) -> dict[str, Any]:
        """Build component overrides passed to ``from_pretrained``.

        Passing ``None`` for an optional Diffusers component prevents its
        checkpoint subfolder from being loaded. Active transformers are built
        on the meta device on non-source FSDP2 ranks (and for checkpoint-based
        all-meta initialization), as before.
        """

        transformer_names = tuple(dict.fromkeys(self._transformer_components_to_load(runtime_context)))
        supported_names = ("transformer", "transformer_2")
        unknown_names = set(transformer_names) - set(supported_names)
        if unknown_names:
            raise ValueError(f"Unsupported Wan transformer components: {sorted(unknown_names)}")

        overrides: dict[str, Any] = {
            name: None for name in supported_names if name not in transformer_names
        }
        if use_meta_transformers:
            overrides.update(
                self._build_meta_transformers(
                    load_kwargs,
                    transformer_names=transformer_names,
                    required_transformer_names=self._required_transformer_components(runtime_context),
                )
            )
        return overrides

    def _build_meta_transformers(
        self,
        load_kwargs: dict[str, Any],
        *,
        transformer_names: tuple[str, ...] = ("transformer", "transformer_2"),
        required_transformer_names: tuple[str, ...] = ("transformer",),
    ) -> dict[str, Any]:
        import torch

        try:
            from diffusers import WanTransformer3DModel
        except ImportError:
            from diffusers.models import WanTransformer3DModel

        transformers: dict[str, Any] = {}
        for subfolder in transformer_names:
            try:
                cfg = WanTransformer3DModel.load_config(
                    self.model_id,
                    subfolder=subfolder,
                    local_files_only=load_kwargs.get("local_files_only", True),
                    cache_dir=load_kwargs.get("cache_dir"),
                )
                with torch.device("meta"):
                    transformers[subfolder] = WanTransformer3DModel.from_config(cfg)
            except Exception:
                if subfolder in required_transformer_names:
                    raise
        return transformers

    def encode_batch(self, batch: Batch, runtime_context: RuntimeContext | None = None) -> EncodedBatch:
        self.load_components(runtime_context)
        latents = None
        video_target = batch.targets.get("video")
        if video_target is not None:
            latents = video_target.data
        elif "video" in batch.inputs:
            latents = batch.inputs["video"].data

        return EncodedBatch(
            latents=latents,
            conditions=self.encode_conditions(batch.conditions, runtime_context),
            targets=batch.targets,
            metadata=batch.metadata,
        )

    def encode_conditions(self, conditions: ConditionBundle, runtime_context: RuntimeContext | None = None) -> ConditionBundle:
        self.load_components(runtime_context)
        # Raw text and image payloads are encoded per-call by prepare_dit_conditions,
        # so the typed bundle passes through unchanged here.
        return conditions

    def prepare_dit_conditions(
        self,
        prompt_embeds,
        conditions: ConditionBundle | None = None,
        runtime_context: RuntimeContext | None = None,
        *,
        unconditional: bool = False,
    ) -> ConditionBundle:
        import torch

        items = {"prompt_embeds": ModalityPayload("prompt_embeds", prompt_embeds)}
        if self._proxy_dino_enabled:
            proxy_payload = conditions.get("video_context") if conditions is not None else None
            if proxy_payload is None or proxy_payload.data is None:
                raise KeyError("Wan proxy-DINO conditioning requires a 'video_context' condition")
            control = self.encode_proxy_dino_condition(
                proxy_payload.data,
                runtime_context,
            )
            control_mode = self._proxy_dino_cfg_unconditional_control()
            if unconditional and control_mode == "zero":
                control = control.new_zeros(control.shape)
            items["proxy_dino"] = ModalityPayload(
                "proxy_dino",
                control,
                metadata={"injection": self._proxy_dino_injection_type, "time_axis": "latent"},
            )
        # Wan2.1-I2V's cross-attention also takes CLIP image tokens. They are a
        # function of the conditioning image alone, so they ride on the condition
        # bundle rather than being recomputed per denoising step.
        if self._image_condition_concat and self._clip_image_embeds_enabled():
            image_payload = conditions.get("image") if conditions is not None else None
            if image_payload is None or image_payload.data is None:
                raise KeyError("Wan I2V CLIP image conditioning requires an 'image' condition")
            items["image_embeds"] = ModalityPayload(
                "image_embeds", self.encode_clip_image_embeds(image_payload.data, runtime_context)
            )
        return ConditionBundle(items=items)

    def prepare_causal_dit_conditions(
        self,
        prompt_embeds,
        conditions: ConditionBundle | None = None,
        runtime_context: RuntimeContext | None = None,
        *,
        chunk_start: int = 0,
        chunk_frames: int | None = None,
        unconditional: bool = False,
    ) -> ConditionBundle:
        """Prepare only the Proxy-DINO control needed by one AR chunk.

        Proxy-DINO otherwise sees the complete source clip. For long rollouts
        that needlessly keeps the
        source and all intermediate encoder activations on GPU.  Slice the raw
        source in its declared time unit before entering the regular condition
        preparation path; text embeddings remain shared across chunks.
        """

        if conditions is None or chunk_frames is None:
            return self.prepare_dit_conditions(
                prompt_embeds, conditions, runtime_context, unconditional=unconditional
            )
        import torch

        source = conditions.get("video_context")
        if source is None or source.data is None or not self._proxy_dino_enabled:
            return self.prepare_dit_conditions(
                prompt_embeds, conditions, runtime_context, unconditional=unconditional
            )
        data = source.data
        if not torch.is_tensor(data):
            data = torch.as_tensor(data)
        cfg = self.config.proxy_dino
        axis = str(cfg.get("video_context_time_axis", "decoded"))
        start = max(0, int(chunk_start))
        frames = max(0, int(chunk_frames))
        if frames < 1:
            raise ValueError("Causal Proxy-DINO chunk_frames must be positive")
        if axis == "decoded":
            ratio = int(cfg.get("vae_time_compression_ratio", 4))
            begin = start * ratio
            # ``end`` is exclusive.  This must yield exactly ``frames``
            # indices, including the independent TI2V prefill where
            # ``frames == 1`` (then the span is simply ``[begin, begin + 1)``).
            end = begin + (frames - 1) * ratio + 1
            # Proxy-DINO independently encodes frames, so retain only the exact
            # latent-aligned source images.
            indices = torch.arange(begin, end, ratio, device=data.device)
            if int(indices.numel()) != frames or int(indices[-1].item()) >= int(data.shape[2]):
                raise ValueError(
                    f"Proxy-DINO source timeline is shorter than latent chunk [{start}, {start + frames}): "
                    f"decoded_frames={data.shape[2]}, ratio={ratio}"
                )
            sliced = data.index_select(2, indices)
            local_axis = "latent"
        elif axis == "latent":
            sliced = data[:, :, start : start + frames]
            if int(sliced.shape[2]) != frames:
                raise ValueError(
                    f"Proxy-DINO source timeline is shorter than latent chunk [{start}, {start + frames}): "
                    f"latent_frames={data.shape[2]}"
                )
            local_axis = "latent"
        else:
            raise ValueError(
                "model.proxy_dino.video_context_time_axis must be 'decoded' or 'latent', "
                f"got {axis!r}"
            )
        local_conditions = ConditionBundle(
            items={
                **conditions.items,
                "video_context": ModalityPayload(
                    "video_context", sliced, mask=source.mask, metadata=dict(source.metadata)
                ),
            },
            raw=dict(conditions.raw),
        )
        # The sliced payload already has one entry per latent frame. Temporarily
        # override only this call's time-axis interpretation without mutating
        # the adapter's persistent config.
        original_axis = self.config.proxy_dino.get("video_context_time_axis")
        self.config.proxy_dino["video_context_time_axis"] = local_axis
        try:
            prepared = self.prepare_dit_conditions(
                prompt_embeds, local_conditions, runtime_context, unconditional=unconditional
            )
        finally:
            if original_axis is None:
                self.config.proxy_dino.pop("video_context_time_axis", None)
            else:
                self.config.proxy_dino["video_context_time_axis"] = original_axis
        proxy = prepared.get("proxy_dino")
        if proxy is not None:
            proxy.metadata["timeline_start"] = start
        return prepared

    @staticmethod
    def _condition_batch_size(prompt_embeds: Any) -> int | None:
        if isinstance(prompt_embeds, (list, tuple)):
            return len(prompt_embeds)
        shape = getattr(prompt_embeds, "shape", None)
        if shape is not None and len(shape) > 0:
            return int(shape[0])
        return None

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
        self.load_components(runtime_context)
        modules = kwargs.get("modules") or self._generation_modules(runtime_context)
        transformer = self._select_transformer(timesteps, modules=modules)
        if transformer is None:  # pragma: no cover
            raise RuntimeError("Loaded Wan pipeline does not expose a transformer component")
        prompt = conditions.get("prompt_embeds")
        if prompt is None:
            raise KeyError("Wan forward_dit requires encoded prompt_embeds condition")
        if hasattr(timesteps, "ndim") and timesteps.ndim == 0:
            timesteps = timesteps.expand(noisy_latents.shape[0])
        hidden_states = self._proxy_dino_model_input(noisy_latents, conditions)
        output = transformer(
            hidden_states=hidden_states,
            timestep=timesteps,
            encoder_hidden_states=prompt.data,
            encoder_hidden_states_image=self._condition_data(conditions, "image_embeds"),
            proxy_dino_embeds=self._condition_data(conditions, "proxy_dino"),
            attention_kwargs=kwargs.get("attention_kwargs"),
            eden_runtime_context=runtime_context,
            eden_parallel_config=get_sequence_parallel_state(runtime_context).parallel_config,
            return_dict=False,
        )[0]
        return PredictionBundle(
            predictions={"video": ModalityPayload(name="video", data=output)},
            cache=cache,
        )

    def decode_outputs(
        self,
        predictions: PredictionBundle,
        output_specs: tuple[str, ...] = ("video",),
        runtime_context: RuntimeContext | None = None,
    ) -> OutputBundle:
        self.load_components(runtime_context)
        return OutputBundle(
            items={name: predictions.require(name) for name in output_specs if predictions.get(name) is not None}
        )

    def scheduler(self) -> FlowMatchingScheduler:
        return self._scheduler

    def inference_scheduler_profile(
        self,
        runtime_context: RuntimeContext | None = None,
    ) -> InferenceSchedulerProfile:
        del runtime_context
        cfg = self._scheduler_config(self._native_scheduler)
        return InferenceSchedulerProfile(
            parameterization="flow_velocity",
            prediction_type="velocity",
            timestep_scale=float(cfg["timestep_scale"]),
            num_train_timesteps=int(cfg["num_train_timesteps"]),
            defaults=dict(cfg["inference"]),
        )

    def build_native_inference_scheduler(
        self,
        config: dict[str, Any] | None = None,
        runtime_context: RuntimeContext | None = None,
    ) -> DiffusersSchedulerAdapter | FlowMatchingScheduler:
        self.load_components(runtime_context)
        if self._native_scheduler is None:
            return self._scheduler
        options = dict(config or {})
        native_config = getattr(self._native_scheduler, "config", {})
        native_keys = set(native_config.keys()) if hasattr(native_config, "keys") else set()
        overrides = {key: value for key, value in options.items() if key in native_keys}
        if "shift" in options and "flow_shift" in native_keys:
            overrides["flow_shift"] = options["shift"]
        native = clone_diffusers_scheduler(self._native_scheduler, overrides)
        profile = self.inference_scheduler_profile(runtime_context)
        return DiffusersSchedulerAdapter(
            native,
            prediction_type=profile.prediction_type,
            timestep_scale=profile.timestep_scale,
            schedule_defaults=options,
        )

    def encode_prompts(self, prompts: list[str], runtime_context: RuntimeContext | None = None):
        self.load_components(runtime_context)
        pipe = self.components["pipeline"]
        with self._torch_no_grad():
            prompt_embeds, _ = pipe.encode_prompt(
                prompt=prompts,
                negative_prompt=None,
                do_classifier_free_guidance=False,
                device=self.device,
                dtype=self.dtype,
                max_sequence_length=int(self.config.max_sequence_length),
            )
        return prompt_embeds.to(self.dtype)

    def encode_video_latents(self, video, runtime_context: RuntimeContext | None = None, sample_mode: str = "argmax"):
        """Encode a training video target, or accept configured cached VAE latents."""

        self.load_components(runtime_context)
        import torch

        if self._proxy_dino_enabled and bool(self.config.proxy_dino.get("use_cached_latents", False)):
            if not torch.is_tensor(video) or video.ndim != 5:
                raise ValueError("cached Wan targets must be a [B,C,T,H,W] latent tensor")
            expected_channels = int(self.components["transformer"].config.in_channels)
            if int(video.shape[1]) != expected_channels:
                raise ValueError(
                    f"cached Wan target has {video.shape[1]} channels, expected {expected_channels}; "
                    "disable proxy_dino.use_cached_latents to encode pixels through the VAE"
                )
            return video.to(device=self.device, dtype=self.dtype, non_blocking=True)

        return self._encode_pixel_video_latents(video, sample_mode=sample_mode)

    def _encode_pixel_video_latents(self, video, *, sample_mode: str = "argmax", output_dtype=None):
        """VAE-encode RGB pixels irrespective of cached-target configuration.

        ``encode_video_latents`` has a cached-target shortcut for SFT datasets.
        Image conditioning must never use that shortcut: its input is always
        RGB pixels, even when the training video target is a cached Wan latent.
        """

        import torch

        vae = self.components["vae"]
        video = video.to(device=self.device, dtype=self.dtype)
        with torch.no_grad():
            encoded = vae.encode(video)
            if sample_mode == "sample":
                latents = encoded.latent_dist.sample()
            else:
                latents = encoded.latent_dist.mode()
            if output_dtype is not None:
                latents = latents.to(dtype=output_dtype)
            mean = torch.tensor(vae.config.latents_mean, device=latents.device, dtype=latents.dtype).view(
                1, vae.config.z_dim, 1, 1, 1
            )
            inv_std = 1.0 / torch.tensor(vae.config.latents_std, device=latents.device, dtype=latents.dtype).view(
                1, vae.config.z_dim, 1, 1, 1
            )
            latents = (latents - mean) * inv_std
        return latents

    def encode_image_condition(
        self,
        image,
        runtime_context: RuntimeContext | None = None,
        *,
        generator=None,
        num_frames: int | None = None,
    ):
        """Encode a conditioning image into this model's image condition.

        Accepts a ``[C, H, W]`` / ``[B, C, H, W]`` tensor (or numpy array) already
        normalized to ``[-1, 1]`` like the video pipeline (an obvious ``[0, 255]``
        tensor is rescaled as a safety net). Always VAE-encodes pixels so latent
        normalization matches video exactly.

        ``replace_first_frame``: lifts the image to a 1-frame video and returns a
        ``[B, z, 1, h, w]`` latent (``num_frames`` is ignored).
        ``mask_channel_concat``: returns the ``[B, temporal_scale + z, T, h, w]``
        ``[mask | condition latent]`` tensor for the requested decoded ``num_frames``
        (required), built per ``image_condition.first_frame_encoding``.
        """

        del generator
        self.load_components(runtime_context)
        import torch

        if not torch.is_tensor(image):
            image = torch.as_tensor(image)
        image = image.float()
        if image.ndim == 3:  # [C, H, W] -> [B, C, H, W]
            image = image.unsqueeze(0)
        if image.ndim != 4:
            raise ValueError(f"encode_image_condition expects a [C,H,W] or [B,C,H,W] image, got {tuple(image.shape)}")
        if float(image.max()) > 1.5:  # safety net for a raw [0, 255] image
            image = image / 127.5 - 1.0
        if self._image_condition_concat:
            return self._encode_i2v_concat_condition(image, num_frames=num_frames)
        video = image.unsqueeze(2)  # [B, C, 1, H, W]
        # Do not call ``encode_video_latents`` here: in cached-target training
        # it deliberately interprets [B,48,T,H,W] as precomputed DiT latents,
        # whereas a TI2V image is always [B,3,1,H,W] pixels.
        return self._encode_pixel_video_latents(video)

    def _encode_i2v_concat_condition(self, image, *, num_frames: int | None):
        """``[mask (temporal_scale) | condition latent (z)]`` over all latent frames for Wan I2V."""

        import torch

        if num_frames is None:
            raise ValueError("mask_channel_concat image conditioning needs num_frames to build the condition clip")
        pipe = self.components["pipeline"]
        vae = self.components["vae"]
        transformer = self.components["transformer"]
        temporal_scale = int(getattr(pipe, "vae_scale_factor_temporal", 4))
        z_dim = int(vae.config.z_dim)
        expected_in = 2 * z_dim + temporal_scale
        actual_in = int(transformer.config.in_channels)
        if actual_in != expected_in:
            raise ValueError(
                "image_condition.mode=mask_channel_concat expects a Wan I2V transformer with "
                f"in_channels={expected_in} (= {z_dim} noisy + {temporal_scale} mask + {z_dim} condition), "
                f"got {actual_in}"
            )
        image = image.to(device=self.device)
        latents = encode_first_frame_condition(
            self._encode_pixel_video_latents,
            image,
            num_frames=int(num_frames),
            encoding=self._first_frame_encoding,
        )
        mask = first_frame_mask(
            int(latents.shape[0]),
            int(num_frames),
            int(latents.shape[3]),
            int(latents.shape[4]),
            temporal_scale=temporal_scale,
            device=latents.device,
            dtype=latents.dtype,
        )
        if int(mask.shape[2]) != int(latents.shape[2]):
            raise RuntimeError(
                f"first-frame mask spans {mask.shape[2]} latent frames but the condition latent has "
                f"{latents.shape[2]}"
            )
        return torch.cat([mask, latents], dim=1)

    def encode_clip_image_embeds(self, image, runtime_context: RuntimeContext | None = None):
        """CLIP image embeddings for Wan2.1-I2V: penultimate hidden states, as the pipeline does.

        ``image`` is ``[C, H, W]`` / ``[B, C, H, W]`` in ``[-1, 1]``; it is converted back to
        uint8 RGB because the CLIP processor performs its own 224 resize / normalization.
        """

        self.load_components(runtime_context)
        import torch

        encoder = self.components.get("image_encoder")
        processor = self.components.get("image_processor")
        if encoder is None or processor is None:
            raise RuntimeError("encode_clip_image_embeds requires the pipeline's image_encoder and image_processor")
        if not torch.is_tensor(image):
            image = torch.as_tensor(image)
        image = image.float()
        if image.ndim == 3:
            image = image.unsqueeze(0)
        if image.ndim != 4:
            raise ValueError(
                f"encode_clip_image_embeds expects a [C,H,W] or [B,C,H,W] image, got {tuple(image.shape)}"
            )
        if float(image.max()) > 1.5:
            image = image / 127.5 - 1.0
        pixels = ((image.clamp(-1.0, 1.0) + 1.0) * 127.5).round().to(torch.uint8).permute(0, 2, 3, 1).cpu().numpy()
        with torch.no_grad():
            inputs = processor(images=list(pixels), return_tensors="pt")
            pixel_values = inputs["pixel_values"].to(device=self.device, dtype=self.dtype)
            hidden = encoder(pixel_values=pixel_values, output_hidden_states=True).hidden_states[-2]
        return hidden.to(self.dtype)

    def prepare_image_conditioned_input(
        self,
        *,
        noisy_latents,
        condition_latents,
        timestep,
        runtime_context: RuntimeContext | None = None,
    ):
        """Assemble the image-conditioned DiT input for one denoising step.

        ``mask_channel_concat`` (Wan2.1-I2V-14B): channel-concat ``[noisy | mask | condition]``
        and keep the scalar timestep.

        ``replace_first_frame`` (Wan2.2 TI2V): pin the condition frames clean and mark
        them as timestep 0 via a per-token timestep, so their AdaLN treats them as given
        while the remaining frames denoise at ``timestep``. The per-token timestep is
        built at full sequence length; under sequence parallel the transformer forward
        shards it alongside the hidden states.
        """
        import torch

        if self._image_condition_concat:
            condition = condition_latents.to(device=noisy_latents.device, dtype=noisy_latents.dtype)
            return torch.cat([noisy_latents, condition], dim=1), timestep

        cond_frames = int(condition_latents.shape[2])
        model_input = noisy_latents.clone()
        model_input[:, :, :cond_frames] = condition_latents.to(model_input.dtype)

        batch_size, _c, num_frames, height, width = noisy_latents.shape
        transformer = self.components.get("transformer")
        frame_seq_length = (height // transformer.config.patch_size[1]) * (width // transformer.config.patch_size[2])
        num_tokens = int(num_frames) * int(frame_seq_length)
        cond_tokens = int(cond_frames) * int(frame_seq_length)
        token_timestep = _expand_timesteps_to_tokens(
            timestep,
            batch_size=batch_size,
            token_count=num_tokens,
            num_frames=num_frames,
            frame_seq_length=frame_seq_length,
        ).clone()
        token_timestep[:, :cond_tokens] = 0.0
        return model_input, token_timestep

    def merge_image_condition(self, latents, condition_latents, runtime_context: RuntimeContext | None = None):
        if self._image_condition_concat:
            # Concat models denoise all frames; the condition never replaces latents.
            return latents
        cond_frames = int(condition_latents.shape[2])
        latents = latents.clone()
        latents[:, :, :cond_frames] = condition_latents.to(latents.dtype)
        return latents

    @property
    def concat_image_condition(self) -> bool:
        return self._image_condition_concat

    def prepare_causal_image_condition(
        self,
        condition_latents,
        conditions: ConditionBundle,
        runtime_context: RuntimeContext | None = None,
    ):
        """Keep Wan I2V's ``[mask | condition]`` timeline out of the clean KV prefix.

        Only latent frame 0 is clean history for chunk-AR. The full encoded stream stays
        on the condition bundle and is sliced by global latent-frame offset in each
        cached forward.
        """

        del runtime_context
        if not self._image_condition_concat:
            return super().prepare_causal_image_condition(condition_latents, conditions)
        if getattr(condition_latents, "ndim", 0) != 5 or int(condition_latents.shape[2]) < 1:
            raise ValueError("Wan I2V causal image condition must be [B,C,T,H,W] with T >= 1")
        z = int(self._latent_channels())
        if int(condition_latents.shape[1]) <= z:
            # Replacement-style 16-channel condition: keep the historical prefix.
            return super().prepare_causal_image_condition(condition_latents, conditions)
        prepared = ConditionBundle(
            items={
                **conditions.items,
                "image_condition_latents": ModalityPayload(
                    "image_condition_latents",
                    condition_latents,
                    metadata={"time_axis": "latent", "injection": "channel_concat"},
                ),
            },
            raw=dict(conditions.raw),
        )
        # The clean prefix is the *first frame's own latent*, not zeros: committing a
        # zeroed prefix would both poison the KV cache and diverge from teacher forcing,
        # which anchors frame 0 on the target's real latent.
        mask_channels = int(condition_latents.shape[1]) - z
        prefix = condition_latents[:, mask_channels:, :1]
        if int(prefix.shape[1]) != z:
            raise ValueError(
                "Wan I2V causal image condition must be [mask | latent] with "
                f"{z} latent channels; got {int(condition_latents.shape[1])} total"
            )
        return prefix, prepared

    def _latent_channels(self) -> int:
        """Channels of the latent being denoised = VAE ``z_dim``.

        Not ``transformer.config.in_channels``: the Wan I2V transformers take 36 input
        channels (16 noisy + 4 mask + 16 condition) but denoise 16. For the T2V / TI2V
        bases the two coincide (16 / 48).
        """

        vae = self.components.get("vae")
        z_dim = getattr(getattr(vae, "config", None), "z_dim", None)
        if z_dim:
            return int(z_dim)
        transformer = self.components.get("transformer")
        in_channels = getattr(getattr(transformer, "config", None), "in_channels", None)
        if in_channels:
            return int(in_channels)
        raise RuntimeError("cannot determine latent channels: neither vae.config.z_dim nor transformer.in_channels")

    def decode_video_latents(self, latents, runtime_context: RuntimeContext | None = None):
        self.load_components(runtime_context)
        import torch

        vae = self.components["vae"]
        # Cached validation latents originate in the CPU dataloader, while the
        # frozen VAE is kept on the execution device.  Align the latent with the
        # VAE parameter device/dtype before constructing the denormalized input;
        # otherwise Conv3d raises a CPU-vs-CUDA type/device mismatch.
        vae_parameter = next(vae.parameters(), None)
        vae_device = vae_parameter.device if vae_parameter is not None else self.device
        vae_dtype = vae_parameter.dtype if vae_parameter is not None else self.dtype
        if vae_device is not None or vae_dtype is not None:
            latents = latents.to(device=vae_device, dtype=vae_dtype, non_blocking=True)
        with torch.no_grad():
            mean = torch.tensor(vae.config.latents_mean, device=latents.device, dtype=latents.dtype).view(
                1, vae.config.z_dim, 1, 1, 1
            )
            inv_std = 1.0 / torch.tensor(vae.config.latents_std, device=latents.device, dtype=latents.dtype).view(
                1, vae.config.z_dim, 1, 1, 1
            )
            z = latents / inv_std + mean
            return vae.decode(z, return_dict=True).sample

    def forward_dit_teacher_forcing(
        self,
        *,
        noisy_latents,
        clean_latents,
        timesteps,
        clean_timesteps,
        prompt_embeds,
        conditions: ConditionBundle | None = None,
        chunk_size: int,
        max_context_frames: int | None = None,
        sink_frames: int = 0,
        independent_first_frame: bool = False,
        pack_first_frame: bool = False,
        modules: dict[str, Any] | None = None,
        runtime_context: RuntimeContext | None = None,
    ):
        validate_teacher_forcing_attention(
            self.config.teacher_forcing_attention_backend,
            sp_size=get_sequence_parallel_state(runtime_context).size,
            pack_first_frame=pack_first_frame,
            max_context_frames=max_context_frames,
            sink_frames=sink_frames,
        )
        self.load_components(runtime_context)
        transformer = self._select_transformer(timesteps, modules=modules)
        if transformer is None:
            raise RuntimeError("Loaded Wan pipeline does not expose a transformer component")
        return transformer(
            hidden_states=self._proxy_dino_model_input(noisy_latents, conditions),
            clean_hidden_states=self._proxy_dino_model_input(clean_latents, conditions),
            timestep=timesteps,
            clean_timestep=clean_timesteps,
            encoder_hidden_states=prompt_embeds,
            encoder_hidden_states_image=self._causal_image_embeds(conditions, path="forward_dit_teacher_forcing"),
            proxy_dino_embeds=self._condition_data(conditions, "proxy_dino"),
            teacher_forcing_chunk_size=chunk_size,
            teacher_forcing_max_context_frames=max_context_frames,
            teacher_forcing_sink_frames=sink_frames,
            teacher_forcing_independent_first_frame=independent_first_frame,
            teacher_forcing_pack_first_frame=pack_first_frame,
            eden_runtime_context=runtime_context,
            eden_parallel_config=get_sequence_parallel_state(runtime_context).parallel_config,
            return_dict=False,
        )[0]

    def raw_scheduler(self, runtime_context: RuntimeContext | None = None):
        self.load_components(runtime_context)
        return self._native_scheduler

    def prepare_generation_latents(
        self,
        *,
        batch_size: int,
        height: int,
        width: int,
        num_frames: int,
        runtime_context: RuntimeContext | None = None,
        generator: Any | None = None,
    ):
        self.load_components(runtime_context)
        import torch

        pipe = self.components["pipeline"]
        temporal_scale = int(getattr(pipe, "vae_scale_factor_temporal", 4))
        spatial_scale = int(getattr(pipe, "vae_scale_factor_spatial", 8))
        latent_frames = (num_frames - 1) // temporal_scale + 1
        latent_height = height // spatial_scale
        latent_width = width // spatial_scale
        transformer0 = self.components.get("transformer")
        if transformer0 is None:
            raise RuntimeError("Loaded Wan pipeline does not expose a transformer component")
        # Noise must have the *latent* width, not the DiT input width. They coincide on
        # the T2V/TI2V bases but not on Wan I2V, whose ``in_channels`` is 36
        # (16 noisy + 4 mask + 16 condition) while only 16 channels are denoised.
        # Using in_channels there over-allocates by 20 and the image-condition and
        # proxy-control concats then overshoot the patch embedding.
        latent_channels = self._latent_channels()
        return randn_sp_synced(
            (batch_size, latent_channels, latent_frames, latent_height, latent_width),
            device=self.device,
            dtype=self.dtype,
            context=runtime_context,
            generator=generator,
        )

    def offload_generation_latents(self, latents, runtime_context: RuntimeContext | None = None):
        """Move long chunk-AR noise storage to CPU after shape-dependent setup."""

        del runtime_context
        if getattr(latents, "device", None) is None or latents.device.type == "cpu":
            return latents
        return latents.to(device="cpu")

    def generation_frame_seq_length(self, latents, runtime_context: RuntimeContext | None = None) -> int:
        self.load_components(runtime_context)
        transformer0 = self.components.get("transformer")
        if transformer0 is None:
            raise RuntimeError("Loaded Wan pipeline does not expose a transformer component")
        latent_height = int(latents.shape[-2])
        latent_width = int(latents.shape[-1])
        frame_seq_length = (latent_height // transformer0.config.patch_size[1]) * (
            latent_width // transformer0.config.patch_size[2]
        )
        return int(frame_seq_length)

    def forward_dit_causal_cached(
        self,
        latents,
        timesteps,
        prompt_embeds,
        caches_by_transformer: dict[str, Any],
        *,
        current_start: int,
        max_attention_tokens: int | None = None,
        sink_attention_tokens: int = 0,
        cache_update: bool = False,
        runtime_context: RuntimeContext | None = None,
        transformer_name: str | None = None,
        modules: dict[str, Any] | None = None,
    ):
        self.load_components(runtime_context)
        modules = modules or self._generation_modules(runtime_context)
        if transformer_name is not None:
            name = str(transformer_name)
            transformer = modules.get(name)
        else:
            transformer = self._select_transformer(timesteps, modules=modules)
            name = self._transformer_name(transformer, modules=modules)
        if transformer is None:
            raise RuntimeError(f"Wan cached forward has no transformer lane {name!r}")
        cache = caches_by_transformer[name]
        condition_bundle = prompt_embeds if isinstance(prompt_embeds, ConditionBundle) else None
        prompt_embeds = self._prompt_embeds_data(prompt_embeds)
        proxy_payload = condition_bundle.get("proxy_dino") if condition_bundle is not None else None
        proxy_dino = proxy_payload.data if proxy_payload is not None else None
        proxy_start = int(proxy_payload.metadata.get("timeline_start", 0)) if proxy_payload is not None else 0
        hidden_states = self._channel_concat_causal_input(
            latents,
            condition_bundle,
            current_start=current_start,
        )
        return transformer(
            hidden_states=hidden_states,
            timestep=timesteps,
            encoder_hidden_states=prompt_embeds,
            encoder_hidden_states_image=self._causal_image_embeds(
                condition_bundle, path="forward_dit_causal_cached"
            ),
            proxy_dino_embeds=proxy_dino,
            proxy_dino_start_frame=proxy_start,
            kv_cache=cache,
            current_start=current_start,
            max_attention_tokens=max_attention_tokens,
            sink_attention_tokens=sink_attention_tokens,
            cache_update=cache_update,
            eden_runtime_context=runtime_context,
            eden_parallel_config=get_sequence_parallel_state(runtime_context).parallel_config,
            return_dict=False,
        )[0]

    def _update_all_transformer_caches(
        self,
        latents,
        timesteps,
        prompt_embeds,
        caches_by_transformer: dict[str, Any],
        *,
        current_start: int,
        max_attention_tokens: int | None = None,
        sink_attention_tokens: int = 0,
        cache_update: bool = True,
        runtime_context: RuntimeContext | None = None,
        transformer_names: tuple[str, ...] | None = None,
        modules: dict[str, Any] | None = None,
    ) -> None:
        from contextlib import nullcontext

        import torch

        self.load_components(runtime_context)
        condition_bundle = prompt_embeds if isinstance(prompt_embeds, ConditionBundle) else None
        prompt_embeds = self._prompt_embeds_data(prompt_embeds)
        proxy_payload = condition_bundle.get("proxy_dino") if condition_bundle is not None else None
        proxy_dino = proxy_payload.data if proxy_payload is not None else None
        proxy_start = int(proxy_payload.metadata.get("timeline_start", 0)) if proxy_payload is not None else 0
        generation_modules = modules if modules is not None else self._generation_modules(runtime_context)
        selected_names = transformer_names or tuple(generation_modules)
        for name in selected_names:
            transformer = generation_modules.get(name)
            if transformer is None:
                continue
            # Committing clean/context latents updates mutable KV state only;
            # it is never a differentiable model operation.  Keeping this
            # narrow no-grad scope is important for rollout-DMD: the active
            # generator forward remains differentiable, while the subsequent
            # cache write cannot turn a cache tensor into an autograd view and
            # trip the next in-place append.
            commit_context = torch.no_grad() if cache_update else nullcontext()
            with commit_context:
                transformer(
                    hidden_states=self._channel_concat_causal_input(
                        latents,
                        condition_bundle,
                        current_start=current_start,
                    ),
                    timestep=timesteps,
                    encoder_hidden_states=prompt_embeds,
                    proxy_dino_embeds=proxy_dino,
                    proxy_dino_start_frame=proxy_start,
                    kv_cache=caches_by_transformer[name],
                    current_start=current_start,
                    max_attention_tokens=max_attention_tokens,
                    sink_attention_tokens=sink_attention_tokens,
                    cache_update=cache_update,
                    eden_runtime_context=runtime_context,
                    eden_parallel_config=get_sequence_parallel_state(runtime_context).parallel_config,
                    return_dict=False,
                )

    def _allocate_caches_by_transformer(
        self,
        batch_size: int,
        max_tokens: int,
        runtime_context: RuntimeContext | None = None,
    ) -> dict[str, Any]:
        caches = {}
        for name, transformer in self._generation_modules(runtime_context).items():
            if transformer is not None:
                caches[name] = allocate_wan_kv_cache(
                    transformer,
                    batch_size,
                    max_tokens,
                    dtype=self.dtype,
                    device=self.device,
                    runtime_context=runtime_context,
                )
        return caches

    def _transformer_name(self, transformer, *, modules: dict[str, Any] | None = None) -> str:
        for name, module in (modules or self.trainable_modules()).items():
            if module is transformer:
                return name
        raise KeyError("Transformer is not registered in trainable_modules()")

    def _generation_modules(self, runtime_context: RuntimeContext | None = None) -> dict[str, Any]:
        if runtime_context is not None:
            modules = runtime_context.extras.get("generation_modules")
            if modules:
                return modules
        return self.trainable_modules()

    @staticmethod
    def _condition_data(conditions: ConditionBundle | None, name: str):
        payload = conditions.get(name) if conditions is not None else None
        return payload.data if payload is not None else None

    @staticmethod
    def _prompt_embeds_data(condition):
        """Unwrap the text embeds a caller may pass either bare or in a bundle.

        The causal forwards accept both: a ``ConditionBundle`` carrying the
        encoded prompt alongside the other conditions, or the prompt tensor on
        its own.
        """

        if isinstance(condition, ConditionBundle):
            return condition.require("prompt_embeds").data
        return condition

    def _causal_image_embeds(self, conditions: ConditionBundle | None, *, path: str):
        """CLIP image embeds for the teacher-forcing / chunk-AR forwards, or a hard error.

        The bidirectional ``forward_dit`` passes ``encoder_hidden_states_image`` straight
        through, and ``wan_ops`` only concatenates the image tokens when it is not
        ``None``. So on a base whose transformer declares ``image_dim`` (Wan2.1-I2V), a
        silently missing embed changes the attended key set rather than failing: the
        cross-attention's ``add_k_proj``/``add_v_proj`` sit unused and the run looks fine
        while conditioning on nothing. Fail loudly instead.
        """

        embeds = self._condition_data(conditions, "image_embeds")
        if embeds is not None:
            return embeds
        transformer = self.components.get("transformer")
        if getattr(getattr(transformer, "config", None), "image_dim", None) is None:
            return None
        raise RuntimeError(
            f"{path} received no 'image_embeds' condition, but the loaded Wan transformer declares "
            "image_dim (its cross-attention expects CLIP image tokens). Pass the image condition through "
            "prepare_dit_conditions() so it emits an 'image_embeds' condition, or select a "
            "transformer without image_dim."
        )

    def _proxy_dino_control_dim(self) -> int:
        if not self._proxy_dino_enabled:
            raise RuntimeError("proxy-DINO control is not enabled")
        control_dim = int(self.config.proxy_dino.get("control_dim", 1024))
        if control_dim < 1:
            raise ValueError("model.proxy_dino.control_dim must be positive")
        return control_dim

    def _load_proxy_dino(self, *, device, dtype):
        cfg = self.config.proxy_dino
        model_path = str(cfg.get("model_path", ""))
        checkpoint_path = str(cfg.get("checkpoint_path", ""))
        if not model_path or not checkpoint_path:
            raise ValueError(
                "model.proxy_dino.model_path and model.proxy_dino.checkpoint_path are required when enabled"
            )
        from extern.proxy_dino import create_checkpoint_dinov3_encoder

        encoder = create_checkpoint_dinov3_encoder(
            model_path,
            checkpoint_path,
            projection_dim=self._proxy_dino_control_dim(),
            patchify_factor=int(cfg.get("patchify_factor", 2)),
            local_files_only=bool(cfg.get("local_files_only", self.config.local_files_only)),
        )
        if int(encoder.feature_dim) != self._proxy_dino_control_dim():
            raise ValueError(
                f"proxy-DINO feature dim {encoder.feature_dim} does not match configured "
                f"control_dim={self._proxy_dino_control_dim()}"
            )
        # Keep the projection in fp32: ``encode_proxy_dino`` intentionally
        # projects fp32 patch grids after the autocast backbone pass, matching
        # the reference encoder numerics.
        del dtype
        return encoder.to(device=device).requires_grad_(False).eval()

    def encode_proxy_dino_condition(
        self,
        video_context,
        runtime_context: RuntimeContext | None = None,
    ):
        """Encode a source video into latent-time proxy-DINO channel features."""

        self.load_components(runtime_context)
        import torch
        import torch.nn.functional as F

        if not torch.is_tensor(video_context):
            video_context = torch.as_tensor(video_context)
        if video_context.ndim != 5:
            raise ValueError(
                "proxy-DINO video_context must have Eden layout [B,C,T,H,W], "
                f"got {tuple(video_context.shape)}"
            )
        if int(video_context.shape[1]) != 3:
            raise ValueError(f"proxy-DINO video_context must contain RGB channels, got {video_context.shape[1]}")
        video = video_context.to(device=self.device, dtype=torch.float32, non_blocking=True)
        if float(video.detach().amin()) < -0.05:
            video = (video + 1.0) * 0.5
        elif float(video.detach().amax()) > 1.5:
            video = video / 255.0
        video = video.clamp(0.0, 1.0).permute(0, 2, 1, 3, 4).contiguous()
        cfg = self.config.proxy_dino
        temporal_ratio = int(cfg.get("vae_time_compression_ratio", 4))
        batch_size, context_frames, channels, height, width = video.shape
        time_axis = str(cfg.get("video_context_time_axis", "decoded"))
        if time_axis == "decoded":
            if (context_frames - 1) % temporal_ratio:
                raise ValueError(
                    f"proxy-DINO video has {context_frames} decoded frames; expected 1 mod "
                    f"vae_time_compression_ratio={temporal_ratio}"
                )
            images = video[:, ::temporal_ratio]
        elif time_axis == "latent":
            images = video
        else:
            raise ValueError(
                "model.proxy_dino.video_context_time_axis must be 'decoded' or 'latent', "
                f"got {time_axis!r}"
            )
        encoder_size = tuple(int(v) for v in cfg.get("image_size", (288, 512)))
        images = F.interpolate(
            images.reshape(batch_size * images.shape[1], channels, height, width),
            size=encoder_size,
            mode="bilinear",
            align_corners=False,
            antialias=True,
        )
        from extern.proxy_dino import encode_proxy_dino

        features = encode_proxy_dino(self.components["proxy_dino"], images, image_size=encoder_size)
        features = features.squeeze(2).reshape(
            batch_size,
            -1,
            self._proxy_dino_control_dim(),
            features.shape[-2],
            features.shape[-1],
        )
        return features.permute(0, 2, 1, 3, 4).contiguous().to(dtype=self.dtype)

    def cfg_decoupled_control(self, runtime_context: RuntimeContext | None = None) -> str | None:
        """Report ``proxy_dino`` when it is the only control the CFG branch drops.

        Independent proxy guidance needs an intermediate branch whose prompt is
        positive but whose control is neutral. That branch is only well defined
        when ``unconditional=True`` neutralizes the Proxy-DINO control and
        nothing else, so any other condition that also reacts to the flag
        would disqualify it.
        """
        del runtime_context
        if not self._proxy_dino_enabled:
            return None
        if self._proxy_dino_cfg_unconditional_control() != "zero":
            return None
        return "proxy_dino"

    def _proxy_dino_cfg_unconditional_control(self) -> str:
        """Return how CFG's unconditional branch treats Proxy-DINO control.

        ``zero`` gives the unconditional branch zero control, so guidance pushes
        along the proxy axis as well as text.  ``same`` keeps the source-video
        control in both branches, so guidance varies text only.  The two match
        differently trained weights and are not interchangeable.
        """

        mode = str(self.config.proxy_dino.get("cfg_unconditional_control", "zero")).lower()
        if mode not in {"zero", "same"}:
            raise ValueError(
                "model.proxy_dino.cfg_unconditional_control must be 'zero' or 'same', "
                f"got {mode!r}"
            )
        return mode

    def _channel_concat_input(self, latents, conditions: ConditionBundle | None):
        if not self._proxy_dino_channel_concat_enabled:
            return latents
        payload = conditions.get("proxy_dino") if conditions is not None else None
        if payload is None or payload.data is None:
            raise KeyError("proxy-DINO enabled Wan forward requires prepared 'proxy_dino' features")
        import torch
        import torch.nn.functional as F

        control = payload.data.to(device=latents.device, dtype=latents.dtype)
        if control.ndim != 5 or int(control.shape[0]) != int(latents.shape[0]):
            raise ValueError(
                f"proxy-DINO feature shape {tuple(control.shape)} is incompatible with Wan latent "
                f"shape {tuple(latents.shape)}"
            )
        if int(control.shape[1]) != self._proxy_dino_control_dim():
            raise ValueError(
                f"proxy-DINO channels {control.shape[1]} do not match configured "
                f"control_dim={self._proxy_dino_control_dim()}"
            )
        if tuple(control.shape[2:]) != tuple(latents.shape[2:]):
            control = F.interpolate(control, size=tuple(latents.shape[2:]), mode="trilinear", align_corners=False)
        return torch.cat((latents, control), dim=1)

    def _proxy_dino_model_input(self, latents, conditions: ConditionBundle | None):
        """Prepare DiT input for either legacy concat or cross-attention control."""

        return self._channel_concat_input(latents, conditions)

    def _channel_concat_causal_input(
        self,
        latents,
        condition: ConditionBundle | None,
        *,
        current_start: int,
    ):
        """Build the chunk-AR DiT input by concatenating latent-time conditions.

        Cache backends use flattened patch-token offsets whereas I2V concat and
        proxy-DINO features are indexed by latent frame.  ``current_start``
        therefore has to be converted through the active Wan frame token count
        before the temporal slice is selected.

        Order: denoised 16-ch latents -> Wan I2V ``[mask | condition]`` 20-ch
        (when ``image_condition.mode=mask_channel_concat``) -> proxy-DINO
        control.  This must match ``prepare_image_conditioned_input``, which the
        bidirectional path uses for the same layout; dropping the I2V block here
        left the patch embedding 20 channels short (1040 vs 1060).
        """

        # Models that concatenate neither stream (plain T2V/TI2V causal runs) must not pay
        # the offset arithmetic: it is meaningless for them.
        if not self._image_condition_concat and not self._proxy_dino_channel_concat_enabled:
            return latents
        chunk_frames, start = self._causal_frame_span(latents, current_start)
        base = self._i2v_concat_causal_input(latents, condition, start=start, chunk_frames=chunk_frames)
        return self._proxy_dino_causal_input(base, condition, start=start, chunk_frames=chunk_frames)

    def _causal_frame_span(self, latents, current_start: int) -> tuple[int, int]:
        """``(chunk_frames, start_latent_frame)`` for a flattened-token offset."""

        chunk_frames = int(latents.shape[2])
        frame_seq_length = self.generation_frame_seq_length(latents)
        if frame_seq_length <= 0 or int(current_start) % frame_seq_length:
            raise ValueError(
                "causal current_start must be a flattened-token offset aligned to a latent frame: "
                f"current_start={current_start}, frame_seq_length={frame_seq_length}"
            )
        return chunk_frames, int(current_start) // frame_seq_length

    def _i2v_concat_causal_input(self, latents, condition, *, start: int, chunk_frames: int):
        """Concatenate this chunk's Wan I2V ``[mask | condition]`` channels."""

        if not self._image_condition_concat:
            return latents
        image_payload = condition.get("image_condition_latents") if condition is not None else None
        if image_payload is None or image_payload.data is None:
            raise KeyError("Wan I2V causal forward requires prepared 'image_condition_latents'")
        image_condition = image_payload.data[:, :, start : start + chunk_frames]
        if int(image_condition.shape[2]) != chunk_frames:
            raise ValueError(
                "Wan I2V causal image condition is shorter than the requested chunk: "
                f"start={start}, chunk_frames={chunk_frames}, available={image_payload.data.shape[2]}"
            )
        import torch

        return torch.cat(
            (latents, image_condition.to(device=latents.device, dtype=latents.dtype)),
            dim=1,
        )

    def _proxy_dino_causal_input(self, latents, condition, *, start: int, chunk_frames: int):
        """Concatenate this chunk's proxy-DINO control features."""

        if not self._proxy_dino_channel_concat_enabled:
            return latents
        payload = condition.get("proxy_dino") if condition is not None else None
        if payload is None or payload.data is None:
            raise KeyError("proxy-DINO enabled Wan causal forward requires prepared 'proxy_dino' features")
        control = payload.data
        timeline_start = int(payload.metadata.get("timeline_start", 0))
        local_start = start - timeline_start
        if local_start < 0 or local_start + chunk_frames > int(control.shape[2]):
            raise ValueError(
                f"proxy-DINO causal chunk [{start}, {start + chunk_frames}) is outside "
                f"the condition timeline [{timeline_start}, {timeline_start + control.shape[2]})"
            )
        chunk_condition = ConditionBundle(
            items={
                "proxy_dino": ModalityPayload(
                    "proxy_dino", control[:, :, local_start : local_start + chunk_frames]
                )
            }
        )
        return self._channel_concat_input(latents, chunk_condition)

    def prepare_causal(self, runtime_context: RuntimeContext | None = None) -> None:
        self._causal_prepared = True

    def trainable_modules(self) -> dict[str, Any]:
        modules = {"transformer": self.components.get("transformer")}
        if self.components.get("transformer_2") is not None:
            modules["transformer_2"] = self.components.get("transformer_2")
        return modules

    def sharding_plan(self, runtime_context: RuntimeContext | None = None) -> dict[str, tuple[Any, ...]]:
        roots = tuple(module for module in self.trainable_modules().values() if module is not None)
        blocks = tuple(block for module in roots for block in getattr(module, "blocks", ()))
        return {"blocks": blocks, "roots": roots}

    def fsdp_ignored_params(self, module: Any, runtime_context: RuntimeContext | None = None) -> set[Any]:
        """Keep the Proxy-DINO condition RMSNorm outside FSDP when dtypes diverge.

        Channel-concat RMSNorm is a 1-D affine scale stored in FP32, matching the
        reference implementation, even when the Conv3d runs in BF16. FSDP2 mixed
        precision records one original dtype per shard, so a mixed-dtype parameter
        must be ignored rather than recast. Training already stores the transformer
        in FP32, so this set stays empty there and the tiny norm remains sharded
        with the rest of the root. Inference keeps weights in BF16 and only then
        leaves the FP32 scale replicated and unsharded.
        """

        storage = param_dtype(runtime_context)
        return {
            parameter
            for parameter in channel_concat_condition_norm_parameters(module)
            if storage is None or parameter.dtype != storage
        }

    def cache_backend(self, runtime_context: RuntimeContext | None = None) -> WanCausalCacheBackend:
        self.load_components(runtime_context)
        return WanCausalCacheBackend(self, runtime_context)

    def trainable_parameters(self):
        for module in self.trainable_modules().values():
            if module is not None:
                yield from module.parameters()

    def post_fsdp_materialize(self, runtime_context: RuntimeContext | None = None) -> None:
        if not self.components:
            return
        device = (
            runtime_context.device
            if runtime_context is not None and runtime_context.device is not None
            else self.device
        )
        dtype = self.dtype
        for name in ("vae", "text_encoder"):
            module = self.components.get(name)
            if module is not None:
                module.to(device=device, dtype=dtype)
                module.requires_grad_(False).eval()
        proxy_dino = self.components.get("proxy_dino")
        if proxy_dino is not None:
            # The DINO backbone may run under bfloat16 autocast, but its patch
            # projection intentionally remains fp32 in ``encode_proxy_dino``.
            proxy_dino.to(device=device)
            proxy_dino.requires_grad_(False).eval()
        for module in self.trainable_modules().values():
            if module is not None:
                self._reset_rope_buffers(module, device=device, dtype=dtype)
        self.device = device

    def post_fsdp_materialize_replicas(
        self,
        module_groups: dict[str, dict[str, Any]],
        runtime_context: RuntimeContext | None = None,
    ) -> None:
        device = (
            runtime_context.device
            if runtime_context is not None and runtime_context.device is not None
            else self.device
        )
        for modules in module_groups.values():
            for module in modules.values():
                if module is not None:
                    self._reset_rope_buffers(module, device=device, dtype=self.dtype)

    def replica_sharding_plan(
        self,
        module_groups: dict[str, dict[str, Any]],
        runtime_context: RuntimeContext | None = None,
    ) -> dict[str, tuple[Any, ...]]:
        del runtime_context
        # Only Wan-compatible replicas take the adapter's meta-materialization
        # path. Algorithm-owned auxiliary modules are sharded as ordinary FSDP
        # roots by the runtime; sending one through this path would call
        # ``to_empty()`` on already initialized parameters and discard them.
        # Include frozen staged-prefix experts even when the adapter's
        # trainable mapping intentionally exposes only the active expert.
        # Prefix modules can be meta-initialized and require the same block
        # sharding/materialization and RoPE reset as score/EMA replicas.
        transformer_names = {"transformer", "transformer_2"}
        roots = tuple(
            module
            for modules in module_groups.values()
            for name, module in modules.items()
            if name in transformer_names and module is not None and hasattr(module, "blocks")
        )
        blocks = tuple(block for root in roots for block in getattr(root, "blocks", ()))
        return {"blocks": blocks, "roots": roots}

    @staticmethod
    def _distributed_rank() -> int:
        try:
            import torch.distributed as dist

            if dist.is_available() and dist.is_initialized():
                return dist.get_rank()
        except Exception:
            pass
        return int(os.environ.get("RANK", "0"))

    @staticmethod
    def _reset_rope_buffers(module, *, device, dtype) -> None:
        rope = getattr(module, "rope", None)
        if rope is None:
            return
        try:
            new_rope = rope.__class__(
                attention_head_dim=rope.attention_head_dim,
                patch_size=rope.patch_size,
                max_seq_len=rope.max_seq_len,
            )
        except Exception:
            return
        module.rope = new_rope.to(device=device, dtype=dtype)

    def _select_transformer(self, timesteps: Any, *, modules: dict[str, Any] | None = None):
        modules = self.trainable_modules() if modules is None else modules
        t2 = modules.get("transformer_2")
        if t2 is None:
            return modules.get("transformer")
        boundary = getattr(self.components["pipeline"].config, "boundary_ratio", None)
        if boundary is None:
            return modules.get("transformer")
        try:
            import torch

            t_value = timesteps.float().mean().item() if torch.is_tensor(timesteps) else float(timesteps)
        except Exception:
            t_value = 1000.0
        boundary_timestep = float(boundary) * float(self.components["scheduler"].config.num_train_timesteps)
        return modules.get("transformer") if t_value >= boundary_timestep else t2

    @staticmethod
    def _torch_no_grad():
        import torch

        return torch.no_grad()


def _deep_merge_dict(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge_dict(out[key], value)
        else:
            out[key] = value
    return out
