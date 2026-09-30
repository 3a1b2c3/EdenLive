from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ScheduleState:
    """Inference-time schedule state shared across denoising steps.

    ``sigmas`` must include the terminal value used by ``step``; therefore
    ``num_steps`` is usually ``len(sigmas) - 1``. ``timesteps`` are the
    model-scaled counterpart passed into the DiT.
    """

    sigmas: Any
    timesteps: Any | None = None
    prediction_type: str = "velocity"
    timestep_scale: float = 1.0
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def num_steps(self) -> int:
        return max(0, int(self.sigmas.shape[0]) - 1)


@dataclass(frozen=True)
class InferenceSchedulerProfile:
    """Model facts needed to construct a generic inference scheduler.

    This is deliberately not a scheduler allow-list.  It describes the model's
    numerical parameterization so users can experiment with any registered
    inference solver without adding model-specific branches to the solver.
    """

    parameterization: str = "flow_velocity"
    prediction_type: str = "velocity"
    timestep_scale: float = 1000.0
    num_train_timesteps: int = 1000
    defaults: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class SchedulerBuildContext:
    """Context passed to a config-selected inference scheduler factory."""

    model: Any
    profile: InferenceSchedulerProfile
    runtime_context: Any | None = None


class InferenceScheduler(ABC):
    """Protocol for inference-time denoising schedulers.

    Inference schedulers are intentionally independent from training noise
    samplers.  Stateful solvers such as UniPC must be instantiated per logical
    generation trajectory.
    """

    @abstractmethod
    def build_schedule(self, num_steps: int, **kwargs: Any) -> ScheduleState:
        """Create an inference schedule."""
        raise NotImplementedError

    @abstractmethod
    def model_timestep(self, schedule: ScheduleState, step_index: int, **kwargs: Any) -> Any:
        """Return the model timestep for a schedule position."""
        raise NotImplementedError

    @abstractmethod
    def step(self, sample: Any, model_output: Any, schedule: ScheduleState, step_index: int, **kwargs: Any) -> Any:
        """Apply one denoising update."""
        raise NotImplementedError

    def prepare_model_input(self, sample: Any, schedule: ScheduleState, step_index: int, **kwargs: Any) -> Any:
        """Optionally transform the current sample before model forward."""
        return sample

    def model_sigma(self, schedule: ScheduleState, step_index: int, **kwargs: Any) -> Any:
        """Return the sigma value for a schedule position."""
        return schedule.sigmas[step_index]

    def initial_noise_scale(self, schedule: ScheduleState) -> Any:
        """Return the scale applied to initial latent noise, if needed."""
        return schedule.sigmas[0]


class EdenScheduler(InferenceScheduler, ABC):
    """Inference scheduler contract with the flow/diffusion conversions.

    Scheduler implementations own all model-independent diffusion/flow-matching
    math: building inference schedules, mapping schedule positions to model
    timesteps, applying one denoising update, and converting predictions between
    flow parameterizations. Model adapters may initialize scheduler defaults from
    native model metadata, but inference code should use this protocol.
    """

    def add_noise(self, clean: Any, noise: Any, sigma: Any) -> Any:
        """Construct a noisy sample at an explicit flow/diffusion noise level."""
        raise NotImplementedError

    def prediction_to_x0(
        self,
        sample: Any,
        prediction: Any,
        sigma: Any,
        *,
        prediction_type: str | None = None,
    ) -> Any:
        """Convert a model prediction at ``sample``/``sigma`` into clean data."""
        raise NotImplementedError

    def prediction_to_endpoint(
        self,
        sample: Any,
        prediction: Any,
        sigma: Any,
        endpoint_sigma: Any,
        *,
        prediction_type: str | None = None,
    ) -> Any:
        """Convert a prediction into a state at an arbitrary flow endpoint.

        Schedulers whose parameterization supports nonzero endpoints should
        override this hook. The base path retains the historical x0 behavior
        for zero endpoints.
        """
        try:
            import torch

            nonzero = bool(torch.any(torch.as_tensor(endpoint_sigma) != 0))
        except Exception:
            nonzero = float(endpoint_sigma) != 0.0
        if nonzero:
            raise NotImplementedError(
                f"{type(self).__name__} does not support nonzero prediction endpoints"
            )
        return self.prediction_to_x0(
            sample,
            prediction,
            sigma,
            prediction_type=prediction_type,
        )
