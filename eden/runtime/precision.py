from __future__ import annotations

from typing import Any

from eden.core.types import RuntimeContext

_DTYPE_ALIASES = {
    "bf16": "bfloat16",
    "bfloat16": "bfloat16",
    "fp16": "float16",
    "float16": "float16",
    "fp32": "float32",
    "float32": "float32",
}


def resolve_torch_dtype(name: Any):
    """Parse a config dtype name into a ``torch.dtype``."""

    import torch

    if name is None:
        return None
    if isinstance(name, torch.dtype):
        return name
    try:
        canonical = _DTYPE_ALIASES[str(name).lower()]
    except KeyError as exc:
        raise ValueError(
            f"Unsupported dtype {name!r}; expected one of {sorted(set(_DTYPE_ALIASES))}"
        ) from exc
    return getattr(torch, canonical)


def dtype_name(dtype: Any) -> str:
    """Return the canonical config name for a ``torch.dtype`` or alias."""

    if dtype is None:
        return "none"
    name = str(getattr(dtype, "name", None) or dtype)
    return _DTYPE_ALIASES.get(name.lower().removeprefix("torch."), name)


def attach_runtime_precision(context: RuntimeContext, *, compute_dtype, param_dtype) -> RuntimeContext:
    """Record compute vs storage dtypes used by adapters, FSDP2, and algorithms.

    ``context.dtype`` remains the compute dtype so frozen encoders, activations,
    and existing algorithm helpers keep working. Trainable parameters that the
    optimizer owns live in ``param_dtype`` (FP32 by default) so FSDP2 mixed
    precision can keep a high-precision sharded master while computing in BF16.
    """

    context.dtype = compute_dtype
    context.precision = {
        "compute_dtype": compute_dtype,
        "param_dtype": param_dtype,
        "reduce_dtype": param_dtype,
    }
    return context


def compute_dtype(context: RuntimeContext | None, fallback=None):
    if context is None:
        return fallback
    return context.precision.get("compute_dtype", context.dtype) or fallback


def param_dtype(context: RuntimeContext | None, fallback=None):
    if context is None:
        return fallback
    return context.precision.get("param_dtype", context.dtype) or fallback


def reduce_dtype(context: RuntimeContext | None, fallback=None):
    if context is None:
        return fallback
    return context.precision.get("reduce_dtype") or param_dtype(context, fallback)


def training_autocast(context: RuntimeContext | None):
    """Cast non-FSDP training compute to the runtime compute dtype.

    FSDP2 mixed precision already all-gathers unsharded parameters in
    ``compute_dtype``, so wrapping that path again would be redundant. When
    FSDP is off, trainable weights stay in ``param_dtype`` and this context
    keeps the forward/backward math in BF16/FP16.
    """

    from contextlib import nullcontext

    import torch

    compute = compute_dtype(context)
    storage = param_dtype(context)
    if context is None or compute is None or storage is None or compute == storage:
        return nullcontext()
    # Configuration can request FSDP2 in a one-process smoke test, while
    # apply_fsdp2() correctly skips wrapping because no process group exists.
    # Only an actually wrapped model supplies its own mixed-precision
    # all-gathers; otherwise the FP32 master weights still need autocast.
    if bool((context.distributed.get("fsdp2") or {}).get("applied", False)):
        return nullcontext()
    if compute not in {torch.bfloat16, torch.float16}:
        return nullcontext()
    device_type = getattr(getattr(context, "device", None), "type", None) or "cpu"
    return torch.autocast(device_type=device_type, dtype=compute)


def _is_distributed_tensor(value: Any) -> bool:
    return callable(getattr(value, "to_local", None))


def cast_floating_parameters(module: Any, dtype) -> None:
    """Cast floating parameters of ``module`` to ``dtype`` without moving buffers.

    Skip DTensor/FSDP shards: those already keep the original storage dtype, and
    assigning ``parameter.data`` would break the sharded parameter contract.
    """

    if module is None or dtype is None:
        return
    for parameter in module.parameters():
        if (
            parameter.is_floating_point()
            and parameter.dtype != dtype
            and not _is_distributed_tensor(parameter)
        ):
            parameter.data = parameter.data.to(dtype=dtype)


def cast_trainable_parameters(modules: dict[str, Any] | None, dtype) -> None:
    """Cast floating trainable parameters in a named module mapping."""

    if not modules or dtype is None:
        return
    for module in modules.values():
        if module is None:
            continue
        for parameter in module.parameters():
            if (
                parameter.requires_grad
                and parameter.is_floating_point()
                and parameter.dtype != dtype
                and not _is_distributed_tensor(parameter)
            ):
                parameter.data = parameter.data.to(dtype=dtype)
