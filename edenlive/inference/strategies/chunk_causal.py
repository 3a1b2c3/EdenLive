from __future__ import annotations

from typing import Any

from edenlive.core.config_schema import config_get
from edenlive.core.types import ConditionBundle, ModalityPayload, OutputBundle, RuntimeContext
from edenlive.inference.request import GenerationOutput, GenerationRequest
from edenlive.inference.strategies.base import GenerationStrategy
from edenlive.schedulers import InferenceSchedulerSpec, build_inference_scheduler
from edenlive.inference.strategies.utils import (
    CFG_BRANCH_COND,
    CFG_BRANCH_UNCOND,
    generator_from_params,
    image_condition_latents,
    prompts_from_request,
    resolve_guidance,
)
from edenlive.models.base import ModelAdapter
from edenlive.runtime.cache import ChunkCausalGenerationManager


class ChunkCausalStrategy(GenerationStrategy):
    """Chunk-by-chunk autoregressive denoising with a model-provided KV backend."""

    name = "chunk_causal"

    def generate(
        self,
        model: ModelAdapter,
        request: GenerationRequest,
        runtime_context: RuntimeContext,
    ) -> GenerationOutput:
        prompts = prompts_from_request(request)
        if not prompts:
            raise KeyError("chunk_causal inference requires a text condition")
        model.prepare_causal(runtime_context)
        params = request.params
        chunk_size = int(params.get("chunk_size", config_get(model.config, "default_chunk_size", 3)))
        # Packed TI2V first-frame handling is opt-in for inference.  The
        # historical path (false) pre-fills/commits the condition frame as a
        # standalone clean cache entry before denoising frame 1 onward.
        pack_first_frame = bool(params.get("pack_first_frame", False))
        batch_size = len(prompts)
        device = runtime_context.device if runtime_context.device is not None else model.device
        generator = generator_from_params(params, device)
        latents = model.prepare_generation_latents(
            batch_size=batch_size,
            height=int(params.get("height", 384)),
            width=int(params.get("width", 512)),
            num_frames=int(params.get("num_frames", 81)),
            runtime_context=runtime_context,
            generator=generator,
        )
        prompt_embeds = model.encode_prompts(prompts, runtime_context)

        chunk_prompts = params.get("chunk_prompts")
        chunk_embeddings = {}
        if chunk_prompts is not None:
            expected = (int(latents.shape[2]) + chunk_size - 1) // chunk_size
            if batch_size != 1 or len(chunk_prompts) != expected:
                raise ValueError("chunk_prompts requires one sample and one text per latent chunk")
            chunk_embeddings[prompts[0]] = prompt_embeds
            for text in dict.fromkeys(chunk_prompts):
                if text not in chunk_embeddings:
                    chunk_embeddings[text] = model.encode_prompts([text], runtime_context)


        # TI2V: a first-frame image condition switches on the independent-first-frame
        # rollout (condition committed clean, generation continues from frame 1).
        condition_latents = image_condition_latents(
            model,
            request,
            batch_size,
            runtime_context,
            generator=generator,
        )

        guidance = resolve_guidance(params)
        branch_keys = guidance.branch_keys()
        # Per-branch prompt embeddings and control semantics.
        branch_embeds = {CFG_BRANCH_COND: prompt_embeds}
        branch_unconditional = {CFG_BRANCH_COND: False}
        if CFG_BRANCH_UNCOND in branch_keys:
            negative_prompt = params.get("negative_prompt", config_get(model.config, "negative_prompt", ""))
            branch_embeds[CFG_BRANCH_UNCOND] = model.encode_prompts(
                [negative_prompt] * batch_size, runtime_context
            )
            branch_unconditional[CFG_BRANCH_UNCOND] = True

        # Chunk-local control encoding is expensive, so each branch memoizes the
        # bundle for the span it was last asked for and drops it when the manager
        # finishes that chunk.
        cached_chunk: dict[str, tuple[tuple[int, int], Any] | None] = {
            key: None for key in branch_keys
        }

        def prepare_branch_chunk(branch: str, start_frame: int, chunk_frames: int):
            key = (int(start_frame), int(chunk_frames))
            entry = cached_chunk.get(branch)
            if entry is None or entry[0] != key:
                text_embeddings = branch_embeds[branch]
                if chunk_prompts is not None and branch != CFG_BRANCH_UNCOND:
                    text_embeddings = chunk_embeddings[chunk_prompts[int(start_frame) // chunk_size]]
                entry = (
                    key,
                    model.prepare_causal_dit_conditions(
                        text_embeddings,
                        request.conditions,
                        runtime_context,
                        chunk_start=start_frame,
                        chunk_frames=chunk_frames,
                        unconditional=branch_unconditional[branch],
                    ),
                )
                cached_chunk[branch] = entry
            return entry[1]

        def release_branch_chunk(branch: str) -> None:
            cached_chunk[branch] = None

        # Build the template used by ``prepare_causal_image_condition`` from a
        # single frame only.  Some adapters (notably Wan2.2 I2V-A14B) return a
        # full latent image-condition timeline but keep that timeline as a
        # model-side condition; encoding Proxy-DINO for all of those frames
        # here would defeat chunk-local control encoding and can reintroduce an
        # OOM before the AR loop even starts.  The manager asks ``condition_fn``
        # for each actual prefill/generation span below, so multi-frame clean
        # prefixes are still prepared and committed in their own chunks.
        initial_condition_frames = (
            1 if condition_latents is not None else min(chunk_size, int(latents.shape[2]))
        )
        branch_templates = {
            key: prepare_branch_chunk(key, 0, initial_condition_frames) for key in branch_keys
        }

        # Replacement-style TI2V models prefill every condition latent as clean
        # context. Channel-conditioned I2V models (A14B) instead keep the full
        # image-condition stream as a per-chunk DiT condition and prefill only
        # the independently supplied first latent frame. The adapter owns that
        # distinction; the generic cache manager only receives the clean prefix.
        condition_prefix_latents = condition_latents
        if condition_latents is not None:
            for key in branch_keys:
                prefix, branch_templates[key] = model.prepare_causal_image_condition(
                    condition_latents,
                    branch_templates[key],
                    runtime_context,
                )
                if key == CFG_BRANCH_COND:
                    condition_prefix_latents = prefix

        def _chunk_condition(branch: str, start_frame: int, chunk_frames: int):
            prepared = prepare_branch_chunk(branch, start_frame, chunk_frames)
            # ``prepare_causal_image_condition`` may add an adapter-owned full
            # image timeline (A14B). Preserve that state while replacing only
            # the temporal controls encoded for this chunk.
            template = branch_templates[branch]
            if isinstance(template, ConditionBundle) and isinstance(prepared, ConditionBundle):
                for name, payload in template.items.items():
                    if name not in prepared.items or name == "image_condition_latents":
                        prepared.items[name] = payload
            return prepared

        manager = ChunkCausalGenerationManager(model.cache_backend(runtime_context))
        scheduler_config = params.get("scheduler")
        scheduler_spec = InferenceSchedulerSpec.from_config(scheduler_config)
        scheduler = build_inference_scheduler(model, scheduler_config, runtime_context)
        frame_seq_length = int(model.generation_frame_seq_length(latents, runtime_context))
        offload_generated_chunks = params.get("offload_generated_chunks")
        cache_cfg = runtime_context.cache.get("kv_cache", {})
        if offload_generated_chunks is None:
            offload_generated_chunks = bool(cache_cfg.get("offload_generated_chunks", True))
        if offload_generated_chunks:
            latents = model.offload_generation_latents(latents, runtime_context)
        output = manager.generate(
            latents=latents,
            scheduler=scheduler,
            decode_fn=lambda z: model.decode_video_latents(z, runtime_context),
            frame_seq_length=frame_seq_length,
            chunk_size=chunk_size,
            num_inference_steps=int(params.get("num_inference_steps", 8)),
            device=device,
            scheduler_config=scheduler_spec.options if scheduler_config is not None else params,
            condition_latents=condition_prefix_latents,
            runtime_context=runtime_context,
            generator=generator,
            offload_generated_chunks=offload_generated_chunks,
            pack_first_frame=pack_first_frame,
            guidance=guidance,
            branch_conditions=dict(branch_templates),
            branch_condition_fns={
                key: (lambda start, frames, key=key: _chunk_condition(key, start, frames))
                for key in branch_keys
            },
            branch_release_fns={
                key: (lambda key=key: release_branch_chunk(key)) for key in branch_keys
            },
        )
        items = {}
        if "video" in request.outputs:
            items["video"] = ModalityPayload("video", getattr(output, "frames", None))
        for name in request.outputs:
            items.setdefault(name, ModalityPayload(name, None))
        return GenerationOutput(
            outputs=OutputBundle(items=items),
            metadata={
                "strategy": self.name,
                "scheduler": getattr(scheduler, "__class__", type(scheduler)).__name__,
                "guidance": {
                    "text_scale": guidance.text_scale,
                    "branches": list(branch_keys),
                },
                "raw_output": output,
            },
        )
