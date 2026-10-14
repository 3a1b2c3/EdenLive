from __future__ import annotations

import importlib
import inspect
from collections.abc import Mapping
from typing import Any

from edenlive.schedulers.base import InferenceScheduler, ScheduleState, SchedulerBuildContext


class DiffusersSchedulerAdapter(InferenceScheduler):
    """Expose a Diffusers-style stateful scheduler through Eden's contract."""

    def __init__(
        self,
        native_scheduler: Any,
        *,
        prediction_type: str = "velocity",
        timestep_scale: float | None = None,
        schedule_defaults: dict[str, Any] | None = None,
    ) -> None:
        self.native_scheduler = native_scheduler
        self.config = getattr(native_scheduler, "config", None)
        self.prediction_type = str(prediction_type)
        self.timestep_scale = float(
            timestep_scale
            if timestep_scale is not None
            else _config_value(self.config, "num_train_timesteps", 1000)
        )
        self.num_train_timesteps = int(_config_value(self.config, "num_train_timesteps", self.timestep_scale))
        self.schedule_defaults = dict(schedule_defaults or {})

    def build_schedule(self, num_steps: int, **kwargs: Any) -> ScheduleState:
        config = _merge(self.schedule_defaults, kwargs.get("config") or {})
        device = kwargs.get("device")
        call_kwargs: dict[str, Any] = {"device": device}
        nested = config.get("set_timesteps")
        if isinstance(nested, Mapping):
            call_kwargs.update(nested)
        for key in ("sigmas", "timesteps", "mu", "shift"):
            if config.get(key) is not None:
                call_kwargs[key] = config[key]
        _call_set_timesteps(self.native_scheduler, int(num_steps), call_kwargs)

        sigmas = getattr(self.native_scheduler, "sigmas", None)
        timesteps = getattr(self.native_scheduler, "timesteps", None)
        if sigmas is None or timesteps is None:
            raise TypeError(
                f"Native scheduler {type(self.native_scheduler).__name__} must expose sigmas and timesteps"
            )
        sigmas = sigmas.to(device=device)
        self.native_scheduler.sigmas = sigmas
        return ScheduleState(
            sigmas=sigmas,
            timesteps=timesteps,
            prediction_type=self.prediction_type,
            timestep_scale=self.timestep_scale,
            metadata={
                "name": type(self.native_scheduler).__name__,
                "native_scheduler": self.native_scheduler,
            },
        )

    def model_timestep(self, schedule: ScheduleState, step_index: int, **kwargs: Any) -> Any:
        value = schedule.timesteps[step_index]
        device = kwargs.get("device")
        dtype = kwargs.get("dtype")
        if device is not None or dtype is not None:
            value = value.to(device=device or value.device, dtype=dtype or value.dtype)
        batch_size = kwargs.get("batch_size")
        return value.expand(int(batch_size)) if batch_size is not None else value

    def prepare_model_input(self, sample: Any, schedule: ScheduleState, step_index: int, **kwargs: Any) -> Any:
        scale_model_input = getattr(self.native_scheduler, "scale_model_input", None)
        if not callable(scale_model_input):
            return sample
        return scale_model_input(sample, schedule.timesteps[step_index])

    def step(self, sample: Any, model_output: Any, schedule: ScheduleState, step_index: int, **kwargs: Any) -> Any:
        del kwargs
        output = self.native_scheduler.step(
            model_output,
            schedule.timesteps[step_index],
            sample,
            return_dict=False,
        )
        return output[0]

def _call_set_timesteps(native_scheduler: Any, num_steps: int, kwargs: dict[str, Any]) -> None:
    signature = inspect.signature(native_scheduler.set_timesteps)
    accepted = {
        key: value
        for key, value in kwargs.items()
        if key in signature.parameters and value is not None
    }
    native_scheduler.set_timesteps(num_steps, **accepted)


def _config_value(config: Any, name: str, default: Any) -> Any:
    if isinstance(config, Mapping):
        return config.get(name, default)
    return getattr(config, name, default)


def _merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    merged.update({key: value for key, value in override.items() if key != "name"})
    return merged


def build_diffusers_scheduler(
    context: SchedulerBuildContext,
    config: dict[str, Any] | None = None,
) -> DiffusersSchedulerAdapter:
    """Build any Diffusers scheduler selected by inference config.

    ``class_name`` identifies a Diffusers scheduler and ``init`` contains its
    constructor options.  This deliberately avoids a
    model-side scheduler allow-list; unsupported constructor or step semantics
    fail at the bridge boundary with the native scheduler's error.
    """

    options = dict(config or {})
    config_overrides = options.pop("config_overrides", {})
    if not isinstance(config_overrides, Mapping):
        raise TypeError("inference.scheduler.config_overrides must be a mapping")

    class_name = options.pop("class_name", options.pop("scheduler_class", None))
    if not class_name:
        raise ValueError("a Diffusers inference scheduler requires class_name")
    try:
        import diffusers

        scheduler_type = getattr(diffusers, str(class_name))
    except (ImportError, AttributeError):
        schedulers = importlib.import_module("diffusers.schedulers")
        scheduler_type = getattr(schedulers, str(class_name))

    init_config = dict(options.pop("init", {}) or {})
    if not init_config:
        init_config.update(dict(config_overrides))
    init_config.setdefault("num_train_timesteps", int(context.profile.num_train_timesteps))
    native = scheduler_type(**init_config)

    prediction_type = str(options.get("prediction_type", context.profile.prediction_type))
    timestep_scale = float(options.get("timestep_scale", context.profile.timestep_scale))
    return DiffusersSchedulerAdapter(
        native,
        prediction_type=prediction_type,
        timestep_scale=timestep_scale,
        schedule_defaults=options,
    )


def build_flow_unipc_scheduler(
    context: SchedulerBuildContext,
    config: dict[str, Any] | None = None,
) -> DiffusersSchedulerAdapter:
    """Convenience alias for the generic Diffusers bridge in flow mode."""

    options = dict(context.profile.defaults)
    options.update(config or {})
    shift = float(options.get("flow_shift", options.get("shift", 1.0)))
    init_keys = {
        "solver_order",
        "thresholding",
        "dynamic_thresholding_ratio",
        "sample_max_value",
        "predict_x0",
        "solver_type",
        "lower_order_final",
        "disable_corrector",
        "timestep_spacing",
        "steps_offset",
        "final_sigmas_type",
        "use_dynamic_shifting",
        "time_shift_type",
        "shift_terminal",
    }
    init_config = {key: options[key] for key in init_keys if key in options}
    init_config.update(
        {
            "num_train_timesteps": int(context.profile.num_train_timesteps),
            "prediction_type": "flow_prediction",
            "use_flow_sigmas": True,
            "flow_shift": shift,
        }
    )
    options["class_name"] = "UniPCMultistepScheduler"
    options["init"] = init_config
    return build_diffusers_scheduler(context, options)
