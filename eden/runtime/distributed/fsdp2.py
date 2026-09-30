from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

from eden.core.types import RuntimeContext
from eden.runtime.base import RuntimePlugin
from eden.runtime.distributed.sequence_parallel import ensure_sequence_parallel_state
from eden.runtime.precision import (
    attach_runtime_precision,
    compute_dtype,
    dtype_name,
    param_dtype,
    reduce_dtype,
    resolve_torch_dtype,
)
from eden.utils import get_logger

if TYPE_CHECKING:  # A runtime plugin only needs ``ModelAdapter`` for annotations, and
    # ``from __future__ import annotations`` defers those.  Importing it eagerly closes
    # a cycle: ``eden.runtime`` -> here -> ``eden.models`` -> the Wan adapter
    # -> back into the half-initialized ``eden.runtime``.  ``models/__init__.py``
    # catches that ImportError and leaves MODEL_ADAPTERS permanently empty, so the
    # failure surfaces much later as "Unknown model_adapter".
    from eden.models.base import ModelAdapter

logger = get_logger(__name__)


class FSDP2Plugin(RuntimePlugin):
    name = "fsdp2"

    @dataclass
    class Config:
        enabled: bool = False
        meta_init: bool = True
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
            "meta_init": self.config.meta_init,
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
    replica_groups = context.extras.get(
        "algorithm_module_groups",
        context.extras.get("frozen_module_groups", {}),
    )
    replica_plan = None
    replica_plan_factory = getattr(model, "replica_sharding_plan", None)
    if callable(replica_plan_factory):
        replica_plan = replica_plan_factory(replica_groups, context)
    # A model adapter owns special handling for model-family replicas (for
    # example, Wan score/EMA copies that need RoPE reset and meta-state
    # materialization).  Algorithms may also own ordinary trainable modules,
    # such as a feature discriminator.  Shard any replica the adapter did not
    # place in its own plan as a normal root without teaching this generic
    # runtime about a particular algorithm or group name.
    planned_root_ids = {id(module) for module in (replica_plan or {}).get("roots", ()) if module is not None}
    auxiliary_roots = tuple(
        module
        for modules in replica_groups.values()
        for module in modules.values()
        if module is not None and id(module) not in planned_root_ids
    )
    if auxiliary_roots:
        _broadcast_initialized_modules(auxiliary_roots)
        replica_plan = _merge_sharding_plans(
            replica_plan or {"blocks": (), "roots": ()},
            {"blocks": (), "roots": auxiliary_roots},
        )
    plan = _merge_sharding_plans(model.sharding_plan(context), replica_plan)
    _validate_trainable_parameter_dtypes(model, plan, context, param_dtype(context))
    prepare_module = getattr(model, "prepare_fsdp_module", None)
    if callable(prepare_module):
        for module in plan.get("roots", ()):
            if module is not None:
                prepare_module(module, context)
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


def _top_level_fsdp_modules(module: Any, fsdp_module_type: type) -> tuple[Any, ...]:
    if isinstance(module, fsdp_module_type):
        return (module,)
    roots = []
    for child in module.children():
        roots.extend(_top_level_fsdp_modules(child, fsdp_module_type))
    return tuple(roots)


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


def _broadcast_initialized_modules(modules: tuple[Any, ...]) -> None:
    """Synchronize ordinary algorithm-owned module initialization from rank 0."""

    import torch.distributed as dist

    backend = str(dist.get_backend())
    seen: set[int] = set()
    for module in modules:
        for tensor in (*module.parameters(), *module.buffers()):
            if id(tensor) in seen or getattr(tensor, "is_meta", False):
                continue
            seen.add(id(tensor))
            # NCCL cannot broadcast an incidental CPU-only buffer. Auxiliary
            # trainable parameters are prepared on the run device before this
            # point, so skipping such a buffer is both safe and explicit.
            if backend == "nccl" and tensor.device.type != "cuda":
                continue
            dist.broadcast(tensor.detach(), src=0)


def _merge_sharding_plans(
    base: dict[str, tuple[Any, ...]],
    extra: dict[str, tuple[Any, ...]] | None,
) -> dict[str, tuple[Any, ...]]:
    if not extra:
        return base
    return {
        key: tuple(dict.fromkeys((*base.get(key, ()), *extra.get(key, ()))))
        for key in {"blocks", "roots"}
    }


def _fsdp_ignored_params(model: ModelAdapter, module: Any, context: RuntimeContext) -> set[Any]:
    resolver = getattr(model, "fsdp_ignored_params", None)
    if not callable(resolver):
        return set()
    params = resolver(module, context)
    return set(params or ())


def fsdp2_enabled(context: RuntimeContext) -> bool:
    cfg = context.distributed.get("fsdp2", {})
    return bool(cfg.get("enabled", False))


def fsdp2_meta_init_enabled(context: RuntimeContext) -> bool:
    cfg = context.distributed.get("fsdp2", {})
    return bool(cfg.get("enabled", False) and cfg.get("meta_init", True))


def is_fsdp2_model(module: Any) -> bool:
    try:
        from torch.distributed._composable.fsdp import FSDPModule
    except Exception:  # pragma: no cover
        return False
    return any(isinstance(child, FSDPModule) for child in module.modules())


def materialize_and_broadcast_weights(module: Any, device: Any, state_dict: dict[str, Any] | None = None) -> None:
    """Materialize meta tensors and broadcast rank-0 full state into FSDP2 shards."""

    from torch.distributed.checkpoint.state_dict import StateDictOptions, set_model_state_dict

    module.to_empty(device=device)
    if state_dict is None:
        state_dict = {}
    options = StateDictOptions(full_state_dict=True, broadcast_from_rank0=True)
    set_model_state_dict(module, state_dict, options=options)
    logger.info_rank0("FSDP2 meta-init weights materialized and broadcast from rank 0")


def materialize_meta_module(module: Any, device: Any) -> None:
    """Allocate real storage for a sharded module before loading checkpoint shards."""

    module.to_empty(device=device)
    logger.info_rank0("FSDP2 meta tensors materialized locally for checkpoint load")


def load_fsdp2_checkpoint(
    module: Any,
    optimizer: Any,
    path: str | Path,
) -> tuple[int, int, dict[str, Any]]:
    """Load a sharded FSDP2 checkpoint directory via torch.distributed.checkpoint.

    Only the ``model`` subtree is restored. DCP reshards it from the training
    world size to the current inference topology. ``optimizer`` is accepted and
    ignored so the historical call shape keeps working; optimizer and
    algorithm-owned state are training concerns.
    """

    del optimizer
    import torch.distributed.checkpoint as dcp
    from torch.distributed.checkpoint.state_dict import (
        StateDictOptions,
        get_model_state_dict,
        set_model_state_dict,
    )

    options = StateDictOptions(full_state_dict=False)
    state = {
        "model": get_model_state_dict(module, options=options),
        "metadata": {"global_step": 0, "epoch": 0},
    }
    dcp.load(state, checkpoint_id=str(path))
    set_model_state_dict(module, state["model"], options=options)
    metadata = state["metadata"]
    metadata.update(_load_trainer_state(path))
    step = int(metadata.get("global_step", 0))
    epoch = int(metadata.get("epoch", 0))
    logger.info_rank0(f"FSDP2 sharded checkpoint loaded: {path} (step {step})")
    return step, epoch, metadata


def _save_trainer_state(path: str | Path, metadata: dict[str, Any]) -> None:
    """Persist non-sharded trainer metadata that DCP cannot discover on load."""

    import torch
    import torch.distributed as dist

    if dist.is_available() and dist.is_initialized() and dist.get_rank() != 0:
        return
    state_path = Path(path) / "trainer_state.pt"
    temporary_path = state_path.with_suffix(".pt.tmp")
    torch.save(metadata, temporary_path)
    temporary_path.replace(state_path)


def _load_trainer_state(path: str | Path) -> dict[str, Any]:
    import torch

    state_path = Path(path) / "trainer_state.pt"
    if not state_path.exists():
        return {}
    state = torch.load(state_path, map_location="cpu", weights_only=True)
    if not isinstance(state, dict):
        raise TypeError(f"FSDP2 trainer state {state_path} must contain a mapping")
    return state


def _checkpoint_has_key(path: str | Path, key: str) -> bool:
    import torch.distributed.checkpoint as dcp

    try:
        metadata = dcp.FileSystemReader(str(path)).read_metadata()
    except Exception:
        return False
    return any(name == key or name.startswith(f"{key}.") for name in metadata.state_dict_metadata)


def checkpoint_algorithm_keys(path: str | Path) -> tuple[str, ...]:
    """Return the ``algorithm.<key>`` names a sharded DCP checkpoint stores.

    Training recipes wrote their own state under ``algorithm.<recipe>``; the
    EMA weights an inference run wants live in one of those subtrees. The
    inference layer no longer has the recipe objects, so the checkpoint itself
    is the only source of truth for which key is present.
    """

    import torch.distributed.checkpoint as dcp

    try:
        metadata = dcp.FileSystemReader(str(path)).read_metadata()
    except Exception:
        return ()
    keys: set[str] = set()
    for name in metadata.state_dict_metadata:
        if not isinstance(name, str) or not name.startswith("algorithm."):
            continue
        parts = name.split(".")
        if len(parts) >= 2 and parts[1]:
            keys.add(parts[1])
    return tuple(sorted(keys))


def checkpoint_state_child(path: str | Path, parent_key: str, child: str) -> str | None:
    """Return ``child`` only when the checkpoint actually stores it under ``parent_key``.

    Single-expert training collapses the lone module to the checkpoint root, so a
    subtree such as ``algorithm.training_ema`` holds that module's parameters
    directly. Multi-module recipes keep a named child (``ema_transformer``) below
    the same key. Callers that address one named module must not assume the child
    level exists; a missing child means the module *is* the subtree.
    """

    if _checkpoint_has_key(path, f"{parent_key}.{child}"):
        return child
    return None
