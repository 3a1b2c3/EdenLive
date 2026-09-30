from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from eden.core.config_schema import build_config, config_get
from eden.schedulers.base import EdenScheduler, ScheduleState


def randn_sp_synced(*args: Any, **kwargs: Any):
    """Lazy runtime import to keep scheduler/model package initialization acyclic."""

    from eden.runtime.distributed.sequence_parallel import randn_sp_synced as _randn_sp_synced

    return _randn_sp_synced(*args, **kwargs)


class FlowMatchingScheduler(EdenScheduler):
    """Common flow-matching scheduler for training noise and inference steps."""

    @dataclass
    class InferenceConfig:
        schedule: str = "linear"
        prediction_type: str | None = None
        timestep_scale: float | None = None
        num_train_timesteps: int | None = None
        min_sigma: float = 0.0
        max_sigma: float = 1.0
        sigmas: Any | None = None
        timesteps: Any | None = None
        shift: Any | None = None
        flow_shift: float | None = None
        stretch: bool = False
        terminal: float = 0.1
        default_num_tokens: int = 4096
        min_tokens: int = 1024
        max_tokens: int = 4096
        min_shift: float | None = None
        base_shift: float = 0.95
        max_shift: float = 2.05
        extra_one_step: bool = False
        stochastic_sampling: bool = False
        # Endpoint used by stochastic flow sampling.  Unlike ``terminal``
        # (which controls stretching), this is the state predicted by each
        # model call before the next state is re-noised.
        terminal_sigma: float = 0.0
        step_endpoint_sigmas: Any | None = None
        extra: dict[str, Any] = field(default_factory=dict)

    def __init__(self, config: dict[str, Any] | None = None, *, native_scheduler: Any | None = None) -> None:
        self.config = config or {}
        self.native_scheduler = native_scheduler
        self.prediction_type = str(self.config.get("prediction_type", "velocity"))
        self.timestep_scale = float(self.config.get("timestep_scale", self.config.get("num_train_timesteps", 1000)))
        self.num_train_timesteps = int(self.config.get("num_train_timesteps", int(self.timestep_scale)))

    def add_noise(self, clean, noise, sigma):
        """Interpolate clean latents and Gaussian noise at an explicit sigma."""
        sigma_for_latents = expand_sigma_for_latents(sigma, clean)
        return (1.0 - sigma_for_latents) * clean + sigma_for_latents * noise

    def prediction_to_x0(self, sample, prediction, sigma, *, prediction_type: str | None = None):
        """Map the configured flow parameterization back to the clean latent."""
        prediction_type = str(prediction_type or self.prediction_type)
        sigma_b = expand_sigma_for_latents(sigma, sample).to(dtype=sample.dtype)
        if prediction_type == "velocity":
            return sample - sigma_b * prediction
        if prediction_type in {"x0", "sample"}:
            return prediction
        if prediction_type in {"epsilon", "noise"}:
            return (sample - sigma_b * prediction) / (1.0 - sigma_b).clamp(min=1.0e-8)
        raise ValueError(f"Unsupported flow-matching prediction_type {prediction_type!r}")

    def prediction_to_endpoint(
        self,
        sample,
        prediction,
        sigma,
        endpoint_sigma,
        *,
        prediction_type: str | None = None,
    ):
        """Convert a prediction at ``sigma`` to an arbitrary flow endpoint.

        Flow paths use ``x_t=(1-t)x_0+t eps``.  For a velocity prediction the
        endpoint estimate is therefore ``x_s=x_t-(t-s)v``.  The x0/epsilon
        branches first recover the clean sample and interpolate it to ``s``
        using the noise component implied by the current sample.  ``s=0`` is
        deliberately routed through :meth:`prediction_to_x0` so existing
        stochastic trajectories remain numerically unchanged.
        """
        import torch

        prediction_type = str(prediction_type or self.prediction_type)
        sigma_b = expand_sigma_for_latents(sigma, sample).to(dtype=sample.dtype)
        endpoint_b = expand_sigma_for_latents(endpoint_sigma, sample).to(dtype=sample.dtype)
        if not bool(torch.any(endpoint_b != 0)):
            return self.prediction_to_x0(sample, prediction, sigma, prediction_type=prediction_type)
        if prediction_type == "velocity":
            return sample - (sigma_b - endpoint_b) * prediction
        x0 = self.prediction_to_x0(sample, prediction, sigma, prediction_type=prediction_type)
        alpha_t = 1.0 - sigma_b
        alpha_s = 1.0 - endpoint_b
        beta_t = sigma_b
        beta_s = endpoint_b
        eps = (sample - alpha_t * x0) / beta_t.clamp(min=1.0e-8)
        return alpha_s * x0 + beta_s * eps

    def add_noise_from_endpoint(self, endpoint, noise, sigma, endpoint_sigma):
        """Re-noise an endpoint sample from ``s`` to ``t``.

        The conditional coefficients are derived from the same affine flow
        path as :meth:`add_noise`; roots are clamped to protect bf16/low
        precision runs from tiny negative round-off near ``t == s``.
        """
        import torch

        sigma_b = expand_sigma_for_latents(sigma, endpoint).to(dtype=endpoint.dtype)
        endpoint_b = expand_sigma_for_latents(endpoint_sigma, endpoint).to(dtype=endpoint.dtype)
        if not bool(torch.any(endpoint_b != 0)):
            return self.add_noise(endpoint, noise, sigma)
        alpha_t = 1.0 - sigma_b
        alpha_s = 1.0 - endpoint_b
        beta_t = sigma_b
        beta_s = endpoint_b
        alpha_cond = alpha_t / alpha_s.clamp(min=1.0e-8)
        beta_cond = torch.sqrt(
            torch.clamp(beta_t.square() - alpha_cond.square() * beta_s.square(), min=0.0)
        )
        return alpha_cond * endpoint + beta_cond * noise

    def build_schedule(
        self,
        num_steps: int,
        *,
        latents=None,
        num_tokens: int | None = None,
        device=None,
        dtype=None,
        config: dict[str, Any] | None = None,
        sigmas=None,
    ) -> ScheduleState:
        import torch

        cfg = build_config(self.InferenceConfig, _merged(self.config.get("inference", {}), config or {}))
        device = device if device is not None else (latents.device if latents is not None else "cpu")
        dtype = dtype if dtype is not None else torch.float32
        if sigmas is None:
            sigmas = cfg.sigmas
        if sigmas is not None and cfg.timesteps is not None:
            raise ValueError("flow_euler accepts either scheduler.sigmas or scheduler.timesteps, not both")
        schedule_type = str(cfg.schedule)
        explicit_schedule = sigmas is not None or cfg.timesteps is not None
        explicit_kind = None
        min_sigma = float(cfg.min_sigma)
        max_sigma = float(cfg.max_sigma)
        if min_sigma > max_sigma:
            raise ValueError(f"scheduler.min_sigma ({min_sigma}) must be <= scheduler.max_sigma ({max_sigma})")
        if cfg.timesteps is not None:
            explicit_kind = "timesteps"
            timesteps = torch.as_tensor(cfg.timesteps, device=device, dtype=torch.float32).flatten()
            timestep_scale = float(cfg.timestep_scale if cfg.timestep_scale is not None else self.timestep_scale)
            sigmas = timesteps / timestep_scale
        elif sigmas is not None:
            explicit_kind = "sigmas"
            sigmas = torch.as_tensor(sigmas, device=device, dtype=torch.float32)
        else:
            if schedule_type in {"diffusers_flow", "flow_shifted", "shifted_linear"}:
                train_steps = int(cfg.num_train_timesteps or self.num_train_timesteps)
                # Build the full [1, 0) lattice first, then warp, then cut the
                # post-shift window.  min/max therefore mean actual noise levels
                # (same units the DiT sees), not pre-shift linspace endpoints.
                terminal_sigma = 0.0 if bool(cfg.extra_one_step) else 1.0 / float(train_steps)
                sigmas = torch.linspace(
                    1.0,
                    terminal_sigma,
                    int(num_steps) + 1,
                    device=device,
                    dtype=torch.float32,
                )[:-1]
            else:
                sigmas = torch.linspace(max_sigma, min_sigma, int(num_steps) + 1, device=device, dtype=torch.float32)

        if not explicit_schedule:
            shift = cfg.shift
            if schedule_type in {"diffusers_flow", "flow_shifted", "shifted_linear"}:
                shift_value = float(shift if shift is not None else (cfg.flow_shift if cfg.flow_shift is not None else 1.0))
                sigmas = _diffusers_flow_shift(sigmas, shift_value)
                if (
                    not bool(cfg.extra_one_step)
                    and sigmas.numel() > 0
                    and abs(float(sigmas[0].item()) - 1.0) < 1.0e-6
                ):
                    sigmas[0] = sigmas[0] - 1.0e-6
            elif schedule_type in {"shifted", "ltx_shifted"} or shift is not None:
                shift_value = self._resolve_shift(cfg, latents=latents, num_tokens=num_tokens)
                sigmas = _time_shift(sigmas, shift_value)
            if bool(cfg.stretch):
                sigmas = _stretch_terminal(sigmas, float(cfg.terminal))
            if schedule_type in {"diffusers_flow", "flow_shifted", "shifted_linear"}:
                sigmas = _slice_post_shift_window(sigmas, min_sigma=min_sigma, max_sigma=max_sigma)
        if explicit_schedule:
            # Explicit timesteps/sigmas are already model-space points. Window
            # them in that space, but never apply another shift warp.
            sigmas = _slice_post_shift_window(sigmas, min_sigma=min_sigma, max_sigma=max_sigma)
            sigmas = _complete_explicit_trajectory(
                sigmas,
                kind=explicit_kind,
                terminal_sigma=float(cfg.terminal_sigma),
            )
        elif schedule_type in {"diffusers_flow", "flow_shifted", "shifted_linear"}:
            # Windowing changes the point count, so always append the terminal
            # x0 used by Euler/CD bookkeeping when it is not already present.
            if sigmas.numel() == 0:
                raise ValueError("shifted schedule produced an empty sigma lattice")
            terminal = float(cfg.terminal_sigma)
            if float(sigmas[-1].item()) > terminal + 1.0e-8:
                sigmas = torch.cat([sigmas, sigmas.new_tensor([terminal])])
        elif sigmas.numel() == int(num_steps):
            sigmas = torch.cat([sigmas, sigmas.new_tensor([float(cfg.terminal_sigma)])])

        terminal = float(cfg.terminal_sigma)
        if not 0.0 <= terminal <= 1.0:
            raise ValueError(f"scheduler.terminal_sigma must be in [0, 1], got {terminal}")
        endpoints = cfg.step_endpoint_sigmas
        if endpoints is None:
            endpoint_values = [terminal] * max(0, int(sigmas.numel()) - 1)
        else:
            endpoint_values = [float(value) for value in endpoints]
            if len(endpoint_values) != max(0, int(sigmas.numel()) - 1):
                raise ValueError(
                    "scheduler.step_endpoint_sigmas must have one value per model-call point; "
                    f"got {len(endpoint_values)} for {int(sigmas.numel()) - 1} calls"
                )
        if any(value < -1.0e-8 or value > 1.0 + 1.0e-8 for value in endpoint_values):
            raise ValueError("scheduler.step_endpoint_sigmas values must be in [0, 1]")
        for index, endpoint in enumerate(endpoint_values):
            sigma = float(sigmas[index].item())
            sigma_next = float(sigmas[index + 1].item())
            if endpoint > sigma_next + 1.0e-6 or endpoint > sigma + 1.0e-6:
                raise ValueError(
                    "scheduler endpoint must satisfy endpoint_sigma <= sigma_next <= sigma; "
                    f"step={index}, endpoint={endpoint}, sigma={sigma}, sigma_next={sigma_next}"
                )
        timestep_scale = float(cfg.timestep_scale if cfg.timestep_scale is not None else self.timestep_scale)
        timesteps = sigmas * timestep_scale
        return ScheduleState(
            sigmas=sigmas.to(dtype=torch.float32),
            timesteps=timesteps.to(device=device, dtype=dtype),
            prediction_type=str(cfg.prediction_type or self.prediction_type),
            timestep_scale=timestep_scale,
            metadata={
                "schedule": schedule_type,
                "shift": cfg.shift,
                "stretch": bool(cfg.stretch),
                "extra_one_step": bool(cfg.extra_one_step),
                "stochastic_sampling": bool(cfg.stochastic_sampling),
                "explicit_trajectory": explicit_kind,
                "terminal_sigma": terminal,
                "step_endpoint_sigmas": tuple(endpoint_values),
            },
        )

    def model_timestep(
        self,
        schedule: ScheduleState,
        step_index: int,
        *,
        batch_size: int | None = None,
        mask=None,
        device=None,
        dtype=None,
    ):
        import torch

        value = schedule.timesteps[step_index] if schedule.timesteps is not None else schedule.sigmas[step_index]
        device = device if device is not None else value.device
        dtype = dtype if dtype is not None else torch.float32
        value = value.to(device=device, dtype=dtype)
        if mask is not None:
            return mask.to(device=device, dtype=dtype) * value
        if batch_size is None:
            return value
        return value.expand(int(batch_size))

    def model_sigma(self, schedule: ScheduleState, step_index: int, *, batch_size: int | None = None, device=None, dtype=None):
        sigma = schedule.sigmas[step_index]
        if device is not None or dtype is not None:
            sigma = sigma.to(device=device or sigma.device, dtype=dtype or sigma.dtype)
        if batch_size is None:
            return sigma
        return sigma.expand(int(batch_size))

    def step(self, sample, model_output, schedule: ScheduleState, step_index: int, **kwargs: Any):
        sigma = schedule.sigmas[step_index].to(device=sample.device, dtype=torch_float32(sample))
        sigma_next = schedule.sigmas[step_index + 1].to(device=sample.device, dtype=torch_float32(sample))
        sigma_b = _view_like(sigma, sample)
        sigma_next_b = _view_like(sigma_next, sample)
        prediction_type = str(kwargs.get("prediction_type", schedule.prediction_type))
        if bool(schedule.metadata.get("stochastic_sampling", False)):
            endpoint_values = schedule.metadata.get("step_endpoint_sigmas", ())
            endpoint_sigma = endpoint_values[step_index] if endpoint_values else 0.0
            endpoint = self.prediction_to_endpoint(
                sample,
                model_output,
                sigma,
                endpoint_sigma,
                prediction_type=prediction_type,
            )
            # The final model call directly returns x0. Intermediate calls use
            # fresh SP-synchronized Gaussian noise at the next requested sigma.
            if step_index + 1 >= schedule.num_steps:
                return endpoint.to(sample.dtype)
            noise = randn_sp_synced(
                tuple(endpoint.shape),
                device=endpoint.device,
                dtype=endpoint.dtype,
                context=kwargs.get("runtime_context"),
                generator=kwargs.get("generator"),
            )
            return self.add_noise_from_endpoint(endpoint, noise, sigma_next, endpoint_sigma).to(sample.dtype)
        if prediction_type == "velocity":
            velocity = model_output
        elif prediction_type in {"x0", "sample"}:
            velocity = (sample - model_output) / sigma_b.clamp(min=1.0e-8)
        elif prediction_type in {"epsilon", "noise"}:
            x0 = (sample - sigma_b * model_output) / (1.0 - sigma_b).clamp(min=1.0e-8)
            velocity = model_output - x0
        else:
            raise ValueError(f"Unsupported flow-matching prediction_type {prediction_type!r}")
        return (sample.to(velocity.dtype) + velocity * (sigma_next_b - sigma_b)).to(sample.dtype)

    def _resolve_shift(self, cfg: Any, *, latents=None, num_tokens: int | None = None) -> float:
        shift = config_get(cfg, "shift")
        if isinstance(shift, (int, float)):
            return float(shift)
        shift_cfg = shift if isinstance(shift, dict) else cfg
        if num_tokens is None:
            num_tokens = _num_tokens(latents) if latents is not None else int(config_get(shift_cfg, "default_num_tokens", 4096))
        min_tokens = int(config_get(shift_cfg, "min_tokens", 1024))
        max_tokens = int(config_get(shift_cfg, "max_tokens", 4096))
        min_shift = float(config_get(shift_cfg, "min_shift", config_get(shift_cfg, "base_shift", 0.95)))
        max_shift = float(config_get(shift_cfg, "max_shift", 2.05))
        if max_tokens == min_tokens:
            return max_shift
        slope = (max_shift - min_shift) / float(max_tokens - min_tokens)
        return slope * float(num_tokens) + (min_shift - slope * float(min_tokens))


def _merged(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merged(out[key], value)
        else:
            out[key] = value
    return out


def _num_tokens(tensor) -> int:
    if tensor is None:
        return 4096
    if getattr(tensor, "ndim", 0) == 3:
        return int(tensor.shape[1])
    if getattr(tensor, "ndim", 0) == 5:
        return int(tensor.shape[2]) * int(tensor.shape[3]) * int(tensor.shape[4])
    return int(tensor.numel() // max(1, int(tensor.shape[0])))


def expand_sigma_for_latents(sigma, clean):
    """Expand a per-sample / per-frame sigma or loss weight to the latent layout.

    Latents are ``[B, C, T, H, W]`` (5-D) or ``[B, T, D]`` (3-D), so a 2-D
    ``[B, T]`` weight must expand around the *time* axis, not by appending
    trailing singleton dims.  Trailing-unsqueeze would line a frame-count axis
    up against the channel axis, which is what previously broadcast a
    chunk-granularity loss weight across channels.
    """

    if not hasattr(sigma, "ndim"):
        import torch

        sigma = torch.as_tensor(sigma, device=clean.device, dtype=clean.dtype)
    if sigma.ndim == 0:
        return sigma.to(device=clean.device, dtype=clean.dtype)
    if sigma.ndim == 1:
        return sigma.view(-1, *([1] * (clean.ndim - 1))).to(device=clean.device, dtype=clean.dtype)
    if clean.ndim == 5 and sigma.ndim == 2:
        return sigma.view(sigma.shape[0], 1, sigma.shape[1], 1, 1).to(device=clean.device, dtype=clean.dtype)
    if clean.ndim == 3 and sigma.ndim == 2:
        return sigma.unsqueeze(-1).to(device=clean.device, dtype=clean.dtype)
    if clean.ndim == 5 and sigma.ndim == 4:
        return sigma.unsqueeze(1).to(device=clean.device, dtype=clean.dtype)
    return sigma.to(device=clean.device, dtype=clean.dtype)


def _time_shift(sigmas, shift: float):
    shifted = sigmas.clone()
    nonzero = shifted != 0
    shifted[nonzero] = math.exp(float(shift)) / (
        math.exp(float(shift)) + (1.0 / shifted[nonzero] - 1.0)
    )
    return shifted


def _diffusers_flow_shift(sigmas, shift: float):
    return float(shift) * sigmas / (1.0 + (float(shift) - 1.0) * sigmas)


def _slice_post_shift_window(sigmas, *, min_sigma: float, max_sigma: float):
    """Keep model-space sigma points inside ``[min_sigma, max_sigma]``.

    Shifted lattices are built on the full ``[1, 0)`` interval first. Expert
    windows such as A14B high ``[0.9, 1.0]`` therefore cut the already-warped
    noise levels, matching inference expert switching. Explicit timestep lists
    are converted to sigma and cut by the same window, without a second warp.
    Default ``min_sigma=0, max_sigma=1`` is a no-op.
    """
    import torch

    if abs(min_sigma) <= 1.0e-12 and abs(max_sigma - 1.0) <= 1.0e-12:
        return sigmas
    keep = (sigmas >= float(min_sigma) - 1.0e-8) & (sigmas <= float(max_sigma) + 1.0e-8)
    sliced = sigmas[keep]
    if sliced.numel() == 0:
        raise ValueError(
            f"scheduler window [{min_sigma}, {max_sigma}] contains no sigma points "
            f"in [{float(sigmas[-1].item())}, {float(sigmas[0].item())}]"
        )
    return sliced


def _complete_explicit_trajectory(values, *, kind: str | None, terminal_sigma: float = 0.0):
    """Normalize explicit model-call points to a trajectory with a terminal zero.

    Explicit ``sigmas`` and ``timesteps`` describe the points where the model
    is evaluated, not a separate Euler solver schedule.  A zero supplied as
    the final entry is therefore retained; otherwise append the terminal x0
    point used by the final update.
    """
    import torch

    values = values.flatten()
    if values.numel() == 0:
        raise ValueError(f"scheduler.{kind or 'sigmas'} must contain at least one value")
    if not bool(torch.isfinite(values).all()):
        raise ValueError(f"scheduler.{kind or 'sigmas'} must contain only finite values")
    if values.numel() > 1 and bool(torch.any(values[1:] > values[:-1])):
        raise ValueError(f"scheduler.{kind or 'sigmas'} must be monotonically non-increasing")
    terminal_sigma = float(terminal_sigma)
    if not 0.0 <= terminal_sigma <= 1.0:
        raise ValueError(f"scheduler.terminal_sigma must be in [0, 1], got {terminal_sigma}")
    if float(values[-1].item()) > terminal_sigma + 1.0e-8:
        values = torch.cat([values, values.new_tensor([terminal_sigma])])
    elif float(values[-1].item()) < terminal_sigma - 1.0e-8:
        raise ValueError(
            f"scheduler trajectory ends at {float(values[-1].item())}, below terminal_sigma={terminal_sigma}; "
            "the terminal must not exceed the final model-call sigma"
        )
    return values


def _stretch_terminal(sigmas, terminal: float):
    out = sigmas.clone()
    nonzero = out != 0
    if int(nonzero.sum().item()) <= 1:
        return out
    one_minus = 1.0 - out[nonzero]
    scale = one_minus[-1] / max(1.0e-8, 1.0 - float(terminal))
    out[nonzero] = 1.0 - one_minus / scale
    return out


def _view_like(value, sample):
    return value.view(*([1] * sample.ndim))


def torch_float32(tensor):
    import torch

    return torch.float32 if tensor.dtype in {torch.float16, torch.bfloat16, torch.float32} else tensor.dtype
