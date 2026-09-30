from __future__ import annotations

from eden.core.config_schema import config_get
from eden.core.types import ConditionBundle, ModalityPayload, OutputBundle, RuntimeContext
from eden.inference.request import GenerationOutput, GenerationRequest
from eden.inference.strategies.base import GenerationStrategy
from eden.schedulers import InferenceSchedulerSpec, build_inference_scheduler
from eden.inference.strategies.utils import (
    CFG_BRANCH_COND,
    CFG_BRANCH_TEXT,
    CFG_BRANCH_UNCOND,
    generator_from_params,
    image_condition_latents,
    prompts_from_request,
    resolve_guidance,
)
from eden.models.base import ModelAdapter


class DiffusionStrategy(GenerationStrategy):
    """Plain bidirectional denoising generation without chunk-causal KV cache."""

    name = "diffusion"

    def generate(
        self,
        model: ModelAdapter,
        request: GenerationRequest,
        runtime_context: RuntimeContext,
    ) -> GenerationOutput:
        import torch

        prompts = prompts_from_request(request, required=False)
        if not prompts:
            raise KeyError("diffusion inference requires a text condition")
        params = request.params
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
        prompt_embeds = model.encode_generation_prompts(
            prompts,
            request.conditions,
            runtime_context,
        )
        guidance = resolve_guidance(model, params, runtime_context=runtime_context)
        branch_keys = guidance.branch_keys()
        # One condition bundle per guidance branch. The conditioned branch keeps
        # the positive prompt and the real control; the optional decoupled
        # ``text`` branch keeps the positive prompt but takes the adapter's
        # neutral control; ``uncond`` is the negative prompt with neutral control.
        branch_conditions: dict[str, ConditionBundle] = {
            CFG_BRANCH_COND: model.prepare_dit_conditions(
                prompt_embeds,
                request.conditions,
                runtime_context,
            )
        }
        if CFG_BRANCH_TEXT in branch_keys:
            branch_conditions[CFG_BRANCH_TEXT] = model.prepare_dit_conditions(
                prompt_embeds,
                request.conditions,
                runtime_context,
                unconditional=True,
            )
        if CFG_BRANCH_UNCOND in branch_keys:
            negative_prompt = params.get("negative_prompt", config_get(model.config, "negative_prompt", ""))
            negative_embeds = model.encode_generation_prompts(
                [negative_prompt] * batch_size,
                request.conditions,
                runtime_context,
                unconditional=True,
            )
            branch_conditions[CFG_BRANCH_UNCOND] = model.prepare_dit_conditions(
                negative_embeds,
                request.conditions,
                runtime_context,
                unconditional=True,
            )

        # Optional image condition (TI2V). How the condition enters the forward pass
        # is model-specific, so the strategy only resolves the condition latent and
        # delegates assembly to the adapter's image-conditioning hooks.
        condition_latents = image_condition_latents(
            model,
            request,
            batch_size,
            runtime_context,
            generator=generator,
        )
        has_condition = condition_latents is not None

        scheduler_config = params.get("scheduler")
        scheduler_spec = InferenceSchedulerSpec.from_config(scheduler_config)
        scheduler = build_inference_scheduler(model, scheduler_config, runtime_context)
        num_inference_steps = int(params.get("num_inference_steps", params.get("sampling_steps", 8)))
        schedule = scheduler.build_schedule(
            num_inference_steps,
            latents=latents,
            device=device,
            dtype=torch.float32,
            config=scheduler_spec.options if scheduler_config is not None else params,
        )
        for step_index in range(schedule.num_steps):
            timestep_batch = scheduler.model_timestep(
                schedule,
                step_index,
                batch_size=batch_size,
                device=device,
                dtype=torch.float32,
            )
            if has_condition:
                model_input, timestep_batch = model.prepare_image_conditioned_input(
                    noisy_latents=scheduler.prepare_model_input(latents, schedule, step_index),
                    condition_latents=condition_latents,
                    timestep=timestep_batch,
                    runtime_context=runtime_context,
                )
            else:
                model_input = scheduler.prepare_model_input(latents, schedule, step_index)
            cfg_forward = getattr(model, "forward_dit_cfg", None)
            if (
                len(branch_keys) == 2
                and CFG_BRANCH_UNCOND in branch_conditions
                and callable(cfg_forward)
            ):
                # Adapters with a fused two-branch CFG kernel keep that fast
                # path for joint text+control guidance. Decoupled guidance needs
                # three independent predictions, so it uses the generic loop.
                pred = cfg_forward(
                    model_input,
                    timestep_batch,
                    branch_conditions[CFG_BRANCH_COND],
                    branch_conditions[CFG_BRANCH_UNCOND],
                    guidance.text_scale,
                    runtime_context=runtime_context,
                )
            else:
                predictions = {
                    key: model.forward_dit(
                        noisy_latents=model_input,
                        timesteps=timestep_batch,
                        conditions=branch_conditions[key],
                        output_heads=("video",),
                        runtime_context=runtime_context,
                    )
                    .require("video")
                    .data
                    for key in branch_keys
                }
                pred = guidance.fuse(predictions)
            latents = scheduler.step(
                latents,
                pred,
                schedule,
                step_index,
                runtime_context=runtime_context,
                generator=generator,
            )

        if has_condition:
            latents = model.merge_image_condition(latents, condition_latents, runtime_context)

        items = {}
        if "video" in request.outputs:
            items["video"] = ModalityPayload("video", model.decode_video_latents(latents, runtime_context))
        for name in request.outputs:
            items.setdefault(name, ModalityPayload(name, None))
        return GenerationOutput(
            outputs=OutputBundle(items=items),
            metadata={
                "strategy": self.name,
                "guidance": {
                    "text_scale": guidance.text_scale,
                    "control_scale": guidance.control_scale,
                    "control_name": guidance.control_name,
                    "branches": list(branch_keys),
                },
            },
        )
