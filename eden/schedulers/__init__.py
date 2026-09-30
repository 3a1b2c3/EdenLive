from eden.schedulers.base import (
    EdenScheduler,
    InferenceScheduler,
    InferenceSchedulerProfile,
    SchedulerBuildContext,
    ScheduleState,
)
from eden.schedulers.diffusers_adapter import (
    DiffusersSchedulerAdapter,
    build_diffusers_scheduler,
    build_flow_unipc_scheduler,
    clone_diffusers_scheduler,
)
from eden.schedulers.flow_matching import FlowMatchingScheduler, expand_sigma_for_latents

__all__ = [
    "EdenScheduler",
    "InferenceScheduler",
    "InferenceSchedulerProfile",
    "SchedulerBuildContext",
    "DiffusersSchedulerAdapter",
    "build_diffusers_scheduler",
    "build_flow_unipc_scheduler",
    "FlowMatchingScheduler",
    "expand_sigma_for_latents",
    "ScheduleState",
    "clone_diffusers_scheduler",
    "InferenceSchedulerSpec",
    "INFERENCE_SCHEDULERS",
    "build_inference_scheduler",
]


def __getattr__(name: str):
    # Keep scheduler imports cheap and avoid the scheduler -> runtime -> model
    # cycle when a model adapter imports FlowMatchingScheduler during startup.
    if name in {"INFERENCE_SCHEDULERS", "InferenceSchedulerSpec", "build_inference_scheduler"}:
        from eden.schedulers.factory import INFERENCE_SCHEDULERS, InferenceSchedulerSpec, build_inference_scheduler

        return {
            "INFERENCE_SCHEDULERS": INFERENCE_SCHEDULERS,
            "InferenceSchedulerSpec": InferenceSchedulerSpec,
            "build_inference_scheduler": build_inference_scheduler,
        }[name]
    raise AttributeError(name)
