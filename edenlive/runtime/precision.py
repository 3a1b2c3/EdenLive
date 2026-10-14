from __future__ import annotations

from typing import Any

from edenlive.core.types import RuntimeContext

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
