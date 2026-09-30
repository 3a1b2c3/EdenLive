from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from eden.core.registry import Registry
from eden.schedulers.base import InferenceScheduler, SchedulerBuildContext
from eden.schedulers.flow_matching import FlowMatchingScheduler
from eden.schedulers.diffusers_adapter import build_diffusers_scheduler, build_flow_unipc_scheduler


SchedulerFactory = Callable[[SchedulerBuildContext, dict[str, Any]], InferenceScheduler]
INFERENCE_SCHEDULERS: Registry[SchedulerFactory] = Registry("inference scheduler")


@dataclass(frozen=True)
class InferenceSchedulerSpec:
    name: str | None = None
    options: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_config(cls, config: str | Mapping[str, Any] | None) -> "InferenceSchedulerSpec":
        if config is None:
            return cls()
        if isinstance(config, str):
            return cls(name=config)
        if not isinstance(config, Mapping):
            raise TypeError(f"inference.scheduler must be a string or mapping, got {type(config).__name__}")
        options = dict(config)
        name = options.pop("name", None)
        nested = options.pop("params", None)
        if nested is not None:
            if not isinstance(nested, Mapping):
                raise TypeError("inference.scheduler.params must be a mapping")
            options = {**dict(nested), **options}
        return cls(name=str(name) if name is not None else None, options=options)


def build_inference_scheduler(
    model: Any,
    config: str | Mapping[str, Any] | None,
    runtime_context: Any | None = None,
) -> InferenceScheduler:
    """Resolve a request-local inference scheduler without model allow-lists."""

    spec = InferenceSchedulerSpec.from_config(config)
    if spec.name is None or spec.name in {"default", "model_default", "legacy"}:
        scheduler = model.scheduler()
    elif spec.name == "native":
        scheduler = model.build_native_inference_scheduler(spec.options, runtime_context)
    else:
        profile = model.inference_scheduler_profile(runtime_context)
        context = SchedulerBuildContext(model=model, profile=profile, runtime_context=runtime_context)
        scheduler = INFERENCE_SCHEDULERS.get(spec.name)(context, spec.options)
    _validate_scheduler(scheduler, spec.name or "model_default")
    return scheduler


def _build_flow_euler(context: SchedulerBuildContext, config: dict[str, Any]) -> FlowMatchingScheduler:
    profile = context.profile
    inference_config = dict(profile.defaults)
    inference_config.update(config)
    return FlowMatchingScheduler(
        {
            "prediction_type": profile.prediction_type,
            "timestep_scale": profile.timestep_scale,
            "num_train_timesteps": profile.num_train_timesteps,
            "inference": inference_config,
        }
    )


def _validate_scheduler(scheduler: Any, name: str) -> None:
    required = ("build_schedule", "model_timestep", "step")
    missing = [member for member in required if not callable(getattr(scheduler, member, None))]
    if missing:
        raise TypeError(f"Inference scheduler {name!r} is missing required methods: {', '.join(missing)}")


INFERENCE_SCHEDULERS.register("flow_euler", _build_flow_euler)
INFERENCE_SCHEDULERS.register("flow_matching", _build_flow_euler)
INFERENCE_SCHEDULERS.register("flow_unipc", build_flow_unipc_scheduler)
INFERENCE_SCHEDULERS.register("diffusers", build_diffusers_scheduler)
