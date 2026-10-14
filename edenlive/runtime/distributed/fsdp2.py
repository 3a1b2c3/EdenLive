from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from edenlive.core.types import RuntimeContext
from edenlive.runtime.base import RuntimePlugin
from edenlive.runtime.distributed.sequence_parallel import ensure_sequence_parallel_state
from edenlive.runtime.precision import (
    attach_runtime_precision,
    compute_dtype,
    dtype_name,
    param_dtype,
    reduce_dtype,
    resolve_torch_dtype,
)
from edenlive.utils import get_logger

if TYPE_CHECKING:  # A runtime plugin only needs ``ModelAdapter`` for annotations, and
    # ``from __future__ import annotations`` defers those.  Importing it eagerly closes
    # a cycle: ``edenlive.runtime`` -> here -> ``edenlive.models`` -> the Wan adapter
    # -> back into the half-initialized ``edenlive.runtime``.  ``models/__init__.py``
    # catches that ImportError and leaves MODEL_ADAPTERS permanently empty, so the
    # failure surfaces much later as "Unknown model_adapter".
    from edenlive.models.base import ModelAdapter

logger = get_logger(__name__)


class FSDP2Plugin(RuntimePlugin):
    name = "fsdp2"

    @dataclass
    class Config:
        enabled: bool = False
        mixed_precision: str = "bf16"
        # Compute dtype for unsharded FSDP forwards. ``mixed_precision`` remains
        # the backward-compatible alias when this field is omitted.
        param_dtype: str | None = None
        # Gradient reduce-scatter dtype. Defaults to the optimizer/storage
        # dtype so small updates are not rounded away during communication.
        reduce_dtype: str | None = None
        reshard_after_forward: bool = True
        wrap_policy: str = "transformer_block"
        mesh: str = "dp"
        extra: dict[str, Any] = field(default_factory=dict)

    def attach(self, model: ModelAdapter, context: RuntimeContext) -> RuntimeContext:
        if not self.enabled:
            return context
        super().attach(model, context)
        compute = resolve_torch_dtype(self.config.param_dtype or self.config.mixed_precision)
        storage = param_dtype(context, fallback=resolve_torch_dtype("float32"))
        reduction = resolve_torch_dtype(self.config.reduce_dtype) if self.config.reduce_dtype else storage
        attach_runtime_precision(context, compute_dtype=compute, param_dtype=storage)
        context.precision["reduce_dtype"] = reduction
        context.distributed["fsdp2"] = {
            "enabled": True,
            # ``enabled`` records requested policy; ``applied`` records that
            # composable FSDP actually wrapped at least one module.  A
            # single-process launch has no process group, so prepare_model()
            # intentionally leaves this false and training must use autocast
            # for the FP32 master parameters.
            "applied": False,
            "reshard_after_forward": self.config.reshard_after_forward,
            "mixed_precision": self.config.mixed_precision,
            "param_dtype": dtype_name(compute),
            "reduce_dtype": dtype_name(reduction),
            "wrap_policy": self.config.wrap_policy,
            "mesh": self.config.mesh,
        }
        return context

    def prepare_model(self, model: ModelAdapter, context: RuntimeContext) -> None:
        if not self.enabled:
            return
        apply_fsdp2(model, context)


def apply_fsdp2(model: ModelAdapter, context: RuntimeContext) -> None:
    import torch.distributed as dist

    fsdp_cfg = context.distributed.get("fsdp2")
    if not fsdp_cfg or not fsdp_cfg.get("enabled", False) or not dist.is_initialized():
        return

    from torch.distributed.fsdp import MixedPrecisionPolicy, fully_shard

    sp_state = ensure_sequence_parallel_state(context)
    mesh_mode = str(fsdp_cfg.get("mesh", "dp"))
    if mesh_mode == "dp" and sp_state.enabled:
        # Shard/reduce over the full (ulysses x dp) world, NOT just dp. Ulysses SP
        # gives each rank only its local token shard, so non-attention params'
        # gradients are partial and must be averaged across the SP group too.
        # FSDP's built-in reduce-scatter over this flattened mesh does exactly
        # that (equivalent to a MEAN all-reduce across all ranks).
        if sp_state.fsdp_mesh is None:
            # Falling back to dp_mesh would silently reintroduce the missing
            # SP-group gradient reduction (dp_size=1 when SP==world => no-op).
            raise RuntimeError(
                "sequence_parallel is enabled but fsdp_mesh was not built; refusing to "
                "shard over dp_mesh alone, which would skip gradient reduction across the "
                "SP group and let per-rank weights diverge."
            )
        mesh = sp_state.fsdp_mesh
        mesh_desc = f"fsdp={sp_state.world_size} (dp={sp_state.dp_size} x sp={sp_state.size})"
    elif mesh_mode in {"dp", "world"}:
        from torch.distributed.device_mesh import init_device_mesh

        mesh = init_device_mesh("cuda", (dist.get_world_size(),))
        mesh_desc = f"{mesh_mode}={dist.get_world_size()}"
    else:
        raise ValueError(f"Unsupported fsdp2.mesh={mesh_mode!r}; expected 'dp' or 'world'")
    compute = compute_dtype(
        context,
        fallback=resolve_torch_dtype(fsdp_cfg.get("param_dtype") or fsdp_cfg.get("mixed_precision", "bf16")),
    )
    reduction = reduce_dtype(context, fallback=resolve_torch_dtype(fsdp_cfg.get("reduce_dtype") or "float32"))
    mp_policy = MixedPrecisionPolicy(param_dtype=compute, reduce_dtype=reduction, output_dtype=compute)
    plan = model.sharding_plan(context)
    _validate_trainable_parameter_dtypes(model, plan, context, param_dtype(context))
    sharded = 0
    for module in plan.get("blocks", ()):
        if module is not None:
            ignored_params = _fsdp_ignored_params(model, module, context)
            fully_shard(
                module,
                mesh=mesh,
                mp_policy=mp_policy,
                reshard_after_forward=fsdp_cfg.get("reshard_after_forward", True),
                ignored_params=ignored_params,
            )
            sharded += 1
    for module in plan.get("roots", ()):
        if module is not None:
            ignored_params = _fsdp_ignored_params(model, module, context)
            fully_shard(
                module,
                mesh=mesh,
                mp_policy=mp_policy,
                reshard_after_forward=fsdp_cfg.get("reshard_after_forward", True),
                ignored_params=ignored_params,
            )
            sharded += 1
    fsdp_cfg["applied"] = sharded > 0
    logger.info_rank0(
        "FSDP2 applied: "
        f"{sharded} modules sharded (compute={dtype_name(compute)}, reduce={dtype_name(reduction)}, mesh={mesh_desc})"
    )


def _validate_trainable_parameter_dtypes(
    model: ModelAdapter,
    plan: dict[str, tuple[Any, ...]],
    context: RuntimeContext,
    expected_dtype: Any,
) -> None:
    """Reject non-master trainable weights before FSDP records their dtype."""

    if expected_dtype is None:
        return
    mismatches = []
    seen: set[int] = set()
    for group in ("roots", "blocks"):
        for module in plan.get(group, ()):
            if module is None:
                continue
            ignored = _fsdp_ignored_params(model, module, context)
            for name, parameter in module.named_parameters():
                if id(parameter) in seen:
                    continue
                seen.add(id(parameter))
                if (
                    parameter not in ignored
                    and parameter.requires_grad
                    and parameter.is_floating_point()
                    and parameter.dtype != expected_dtype
                ):
                    mismatches.append(f"{type(module).__name__}.{name}={dtype_name(parameter.dtype)}")
    if mismatches:
        raise RuntimeError(
            "FSDP2 trainable parameters must be cast to the runtime master dtype "
            f"{dtype_name(expected_dtype)} before fully_shard(): " + "; ".join(mismatches[:8])
        )


def _fsdp_ignored_params(model: ModelAdapter, module: Any, context: RuntimeContext) -> set[Any]:
    resolver = getattr(model, "fsdp_ignored_params", None)
    if not callable(resolver):
        return set()
    params = resolver(module, context)
    return set(params or ())
