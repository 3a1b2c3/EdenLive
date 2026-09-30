from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import torch
from eden.runtime.checkpoint import (
    find_full_checkpoint_file,
    load_module_checkpoint,
    load_training_checkpoint,
)
from eden.runtime.distributed.fsdp2 import (
    checkpoint_algorithm_keys,
    checkpoint_state_child,
    is_fsdp2_model,
)
from eden.utils import get_logger

logger = get_logger(__name__)


def load_inference_module_checkpoints(
    *,
    model_adapter,
    checkpoints: dict[str, str | Path] | None,
    runtime_context=None,
    source: str = "model",
) -> str:
    """Compose independently trained named model modules for inference.

    Checkpoint names address the adapter's public ``trainable_modules`` mapping.
    Each checkpoint is restored into only that prepared live module, allowing a
    dual-expert inference model to combine checkpoints produced by two
    single-expert FSDP2 training runs. DCP handles resharding from the training
    world size to the current inference topology.

    ``source`` matches ``load_inference_checkpoint``: ``model`` restores adapter
    weights, while ``ema`` loads the training-EMA subtree from each expert's
    checkpoint.
    """

    configured = dict(checkpoints or {})
    if not configured:
        return "base"
    modules = {
        name: module
        for name, module in model_adapter.trainable_modules().items()
        if module is not None
    }
    unknown = sorted(set(configured) - set(modules))
    if unknown:
        available = ", ".join(sorted(modules)) or "none"
        raise KeyError(
            "Inference module checkpoints target unavailable model modules "
            f"{unknown}; available modules: {available}"
        )

    source = str(source or "model").lower()

    step_names: dict[str, str] = {}
    for name, raw_path in configured.items():
        if not raw_path:
            raise ValueError(f"Inference module checkpoint {name!r} has an empty path")
        requested_path = Path(raw_path)
        checkpoint_path = find_full_checkpoint_file(requested_path) or requested_path
        if not checkpoint_path.exists():
            raise FileNotFoundError(f"Inference module checkpoint does not exist: {checkpoint_path}")
        target = _ema_checkpoint_target(model_adapter, checkpoint_path, source)
        load_module, checkpoint_key, module_name = _module_checkpoint_load_target(
            modules[name],
            name,
            checkpoint_path=checkpoint_path,
            target=target,
            source=source,
        )
        load_kwargs = {"checkpoint_key": checkpoint_key, "module_name": module_name}
        if checkpoint_path.suffix != ".pt" and checkpoint_path.is_dir() and source != "model":
            # Recipes that checkpoint several modules (consistency distillation)
            # store ``algorithm.<key>.<module>.*``. Single-expert training stores
            # the lone module flat as ``algorithm.<key>.*`` with no child level,
            # so the module name must not be forced as a selector there.
            load_kwargs["state_child"] = checkpoint_state_child(checkpoint_path, checkpoint_key, module_name)
        metadata = load_module_checkpoint(load_module, checkpoint_path, **load_kwargs)
        step = int(metadata.get("global_step", 0))
        step_names[name] = f"step_{step:06d}" if step > 0 else _step_name(checkpoint_path)
        logger.info_rank0(
            f"Inference module checkpoint loaded: {name} <- {checkpoint_path} (source={source})"
        )

    unique_steps = set(step_names.values())
    if len(unique_steps) == 1:
        return next(iter(unique_steps))
    return "__".join(f"{name}_{step_names[name]}" for name in sorted(step_names))


def load_inference_checkpoint(
    *,
    model_adapter,
    checkpoint: str | Path | None,
    output_root: str | Path,
    export_if_needed: bool = True,
    runtime_context=None,
    source: str = "model",
) -> str:
    """Load a training checkpoint for inference and return an output step name.

    ``source`` selects adapter weights (``model``) or the EMA weights a training
    run saved alongside them (``ema``).
    """

    source = str(source or "model").lower()
    if not checkpoint:
        if source != "model":
            raise ValueError(
                f"Inference checkpoint source {source!r} requires inference.checkpoint; "
                "refusing to fall back to base model weights"
            )
        return "base"
    checkpoint_path = Path(checkpoint)
    step_name = _step_name(checkpoint_path)
    target = _ema_checkpoint_target(model_adapter, checkpoint_path, source)
    root = model_adapter.fsdp_root_module()
    if root is None:
        return step_name

    if checkpoint_path.suffix == ".pt":
        if target is None:
            _load_full_checkpoint(model_adapter, checkpoint_path, runtime_context=runtime_context)
        else:
            _load_algorithm_checkpoint_target(checkpoint_path, *target)
        return step_name

    if target is not None:
        metadata = _load_algorithm_dcp_target(checkpoint_path, *target)
        step = int(metadata.get("global_step", 0))
        return f"step_{step:06d}" if step > 0 else step_name

    if is_fsdp2_model(root):
        step, _epoch, _metadata = load_training_checkpoint(
            model_adapter=model_adapter,
            path=checkpoint_path,
        )
        return f"step_{step:06d}" if step > 0 else step_name

    if not export_if_needed:
        raise RuntimeError(
            f"Checkpoint {checkpoint_path} looks sharded, but inference model is not FSDP2-wrapped. "
            "Enable export_if_needed or run inference with FSDP2."
        )
    export_path = _export_path(checkpoint_path, output_root)
    if not _export_is_current(export_path, checkpoint_path):
        logger.info_rank0(f"Exporting sharded checkpoint for inference: {checkpoint_path} -> {export_path}")
        _export_sharded_to_full(model_adapter, checkpoint_path, export_path)
    elif _rank() == 0:
        logger.info_rank0(f"Using cached exported checkpoint: {export_path}")
    _barrier()
    _load_full_checkpoint(model_adapter, export_path)
    return export_path.stem


#: ``algorithm.<key>`` subtrees that training recipes used for EMA weights, in
#: the order an inference run should prefer them. A recipe that kept its own EMA
#: (consistency distillation, rollout DMD) stores ``ema_<module>`` children; the
#: trainer-owned ``training_ema`` subtree mirrors the live module layout
#: directly. The checkpoint is probed for these because the inference-only tree
#: no longer carries the recipe objects that used to name their own target.
_EMA_CHECKPOINT_KEYS = ("consistency_distillation", "rollout_dmd", "training_ema")


def _ema_checkpoint_target(model_adapter, checkpoint_path: Path, source: str) -> tuple[str, Any] | None:
    """Resolve ``(checkpoint_key, module)`` for an EMA inference source.

    ``source='model'`` means the adapter's own weights and needs no target. For
    ``ema`` the saved subtree references the *live* adapter modules, so loading
    it updates the inference model in place instead of allocating a second FSDP
    replica just to copy weights back.
    """

    source = str(source or "model").lower()
    if source == "model":
        return None
    if source != "ema":
        raise ValueError(f"inference.checkpoint_source must be 'model' or 'ema', got {source!r}")

    modules = {
        name: module
        for name, module in model_adapter.trainable_modules().items()
        if module is not None
    }
    if not modules:
        raise RuntimeError("EMA inference requires adapter trainable modules")

    key = _resolve_ema_checkpoint_key(checkpoint_path)
    if key is None:
        available = ", ".join(_EMA_CHECKPOINT_KEYS)
        raise ValueError(
            f"Checkpoint {checkpoint_path} carries no EMA state; looked for algorithm subtrees: {available}"
        )

    if key == "training_ema":
        # The trainer-owned subtree mirrors the adapter's module layout.
        target = next(iter(modules.values())) if len(modules) == 1 else torch.nn.ModuleDict(modules)
        return key, target
    # Recipe-owned EMA keeps an ``ema_<module>`` child per trainable module.
    return key, torch.nn.ModuleDict({f"ema_{name}": module for name, module in modules.items()})


def _resolve_ema_checkpoint_key(checkpoint_path: Path) -> str | None:
    """Find which EMA subtree a checkpoint actually stores."""

    if checkpoint_path.suffix == ".pt" or checkpoint_path.is_file():
        state = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
        present = set(state.get("algorithm", {}) or {})
    else:
        present = set(checkpoint_algorithm_keys(checkpoint_path))
    for key in _EMA_CHECKPOINT_KEYS:
        if key in present:
            return key
    return None


def _module_checkpoint_load_target(
    module,
    name: str,
    *,
    checkpoint_path: Path,
    target: tuple[str, Any] | None,
    source: str,
) -> tuple[Any, str, str | None]:
    """Select the live module, checkpoint key, and optional child name for one expert."""

    if target is None:
        return module, "model", name

    algorithm_key, target_root = target
    child_name = _algorithm_inference_child_name(target_root, name, source)
    checkpoint_key = f"algorithm.{algorithm_key}"
    # Unsharded ``.pt`` files store a flattened algorithm ModuleDict. Strip the
    # ``ema_<module>`` prefix and load into the bare expert. DCP stores that
    # child under the algorithm key, so wrap the live expert to match.
    if checkpoint_path.suffix == ".pt" or checkpoint_path.is_file():
        return module, checkpoint_key, child_name
    # ``load_module_checkpoint`` now wraps DCP targets internally when a child
    # selector is supplied, so keep the live module bare here as well.
    return module, checkpoint_key, child_name


def _algorithm_inference_child_name(target_module: Any, module_name: str, source: str) -> str:
    children = dict(target_module.named_children()) if hasattr(target_module, "named_children") else {}
    if not children:
        return module_name
    preferred = f"{source}_{module_name}"
    if preferred in children:
        return preferred
    if module_name in children:
        return module_name
    available = ", ".join(sorted(children)) or "none"
    raise KeyError(
        f"Inference module {module_name!r} has no {source!r} target in the EMA checkpoint state; "
        f"available: {available}"
    )


def _step_name(path: Path) -> str:
    return path.stem if path.suffix == ".pt" else path.name


def _export_path(checkpoint_path: Path, output_root: str | Path) -> Path:
    if checkpoint_path.parent.name == "ckpts":
        return checkpoint_path.parent / f"{_step_name(checkpoint_path)}.pt"
    return Path(output_root) / "ckpts" / f"{_step_name(checkpoint_path)}.pt"


def _meta_path(path: Path) -> Path:
    return path.with_suffix(path.suffix + ".meta.json")


def _export_is_current(export_path: Path, source_checkpoint: Path) -> bool:
    if not export_path.exists() or not _meta_path(export_path).exists():
        return False
    try:
        meta = json.loads(_meta_path(export_path).read_text(encoding="utf-8"))
    except Exception:
        return False
    return meta.get("source_checkpoint") == str(source_checkpoint.resolve())


def _export_sharded_to_full(model_adapter, checkpoint_path: Path, export_path: Path) -> None:
    import torch.distributed.checkpoint as dcp
    from torch.distributed.checkpoint.state_dict import (
        StateDictOptions,
        get_model_state_dict,
        set_model_state_dict,
    )

    root = model_adapter.fsdp_root_module()
    if root is None:
        raise RuntimeError("Cannot export checkpoint because model adapter has no trainable root module")
    options = StateDictOptions(full_state_dict=True, cpu_offload=True)
    state = {
        "model": get_model_state_dict(root, options=options),
        "metadata": {"global_step": 0, "epoch": 0},
    }
    dcp.load(state, checkpoint_id=str(checkpoint_path))
    set_model_state_dict(root, state["model"], options=options)
    model_state = get_model_state_dict(root, options=options)
    model_state = {key: value.detach().cpu() if torch.is_tensor(value) else value for key, value in model_state.items()}
    if _rank() != 0:
        return
    export_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "model": model_state,
            "model_format": "root_state_dict",
            "metadata": dict(state.get("metadata", {})),
        },
        export_path,
    )
    meta = {
        "source_checkpoint": str(checkpoint_path.resolve()),
        "source_format": "fsdp2_dcp",
        "export_format": "root_state_dict_pt",
        "global_step": int(state.get("metadata", {}).get("global_step", 0)),
        "model_adapter": getattr(model_adapter, "name", model_adapter.__class__.__name__),
    }
    _meta_path(export_path).write_text(json.dumps(meta, indent=2, sort_keys=True), encoding="utf-8")
    logger.info_rank0(f"Exported full inference checkpoint: {export_path}")


def _load_full_checkpoint(model_adapter, checkpoint_path: Path, *, runtime_context=None) -> None:
    state = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    model_state = state.get("model", state)
    model_format = state.get("model_format")
    if model_format == "root_state_dict" or _looks_like_root_state_dict(model_state):
        root = model_adapter.fsdp_root_module()
        if root is None:
            raise RuntimeError("Cannot load root checkpoint because model adapter has no trainable root module")
        # A full root state dict exported before FSDP2 wrapping contains plain
        # CPU tensors.  Calling ``root.load_state_dict`` after ``fully_shard``
        # attempts to copy those tensors directly into DTensor parameters and
        # fails with "mixed torch.Tensor and DTensor".  The distributed state
        # dict API performs the required DTensor conversion, sharding, and
        # rank-0 broadcast.  Keep the ordinary load path for unwrapped models.
        if is_fsdp2_model(root):
            from torch.distributed.checkpoint.state_dict import StateDictOptions, set_model_state_dict

            options = StateDictOptions(
                full_state_dict=True,
                broadcast_from_rank0=True,
                strict=True,
            )
            set_model_state_dict(root, model_state, options=options)
        else:
            root.load_state_dict(model_state, strict=True)
    else:
        modules = model_adapter.trainable_modules()
        for name, module in modules.items():
            if module is not None and name in model_state:
                module.load_state_dict(model_state[name], strict=True)
    logger.info_rank0(f"Inference checkpoint loaded: {checkpoint_path}")


def _load_algorithm_checkpoint_target(checkpoint_path: Path, checkpoint_key: str, target_module: Any) -> None:
    state = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    algorithm_state = state.get("algorithm", {})
    if checkpoint_key not in algorithm_state:
        available = ", ".join(sorted(algorithm_state)) or "none"
        raise KeyError(
            f"Checkpoint {checkpoint_path} has no algorithm state {checkpoint_key!r}; available: {available}"
        )
    target_state = target_module.state_dict()
    source_state = algorithm_state[checkpoint_key]
    selected_state = {name: source_state[name] for name in target_state if name in source_state}
    missing = sorted(set(target_state) - set(selected_state))
    if missing:
        raise KeyError(
            f"Checkpoint {checkpoint_path} is missing requested {checkpoint_key!r} target weights: "
            + ", ".join(missing[:5])
        )
    target_module.load_state_dict(selected_state, strict=True)
    logger.info_rank0(f"Inference checkpoint loaded from {checkpoint_key} EMA target: {checkpoint_path}")


def _load_algorithm_dcp_target(checkpoint_path: Path, checkpoint_key: str, target_module: Any) -> dict[str, Any]:
    """Load an algorithm target directly from a sharded DCP checkpoint.

    The target module references the adapter's live inference modules.  This
    lets an EMA state become the inference model without exporting a separate
    full checkpoint or allocating the frozen training replicas.
    """
    import torch.distributed.checkpoint as dcp
    from torch.distributed.checkpoint.state_dict import StateDictOptions, get_model_state_dict, set_model_state_dict

    options = StateDictOptions(full_state_dict=False)
    state = {
        f"algorithm.{checkpoint_key}": get_model_state_dict(target_module, options=options),
        "metadata": {"global_step": 0, "epoch": 0},
    }
    dcp.load(state, checkpoint_id=str(checkpoint_path))
    set_model_state_dict(target_module, state[f"algorithm.{checkpoint_key}"], options=options)
    metadata = dict(state["metadata"])
    logger.info_rank0(f"Inference checkpoint loaded from {checkpoint_key} EMA target: {checkpoint_path}")
    return metadata


def _looks_like_root_state_dict(model_state: Any) -> bool:
    if not isinstance(model_state, dict) or not model_state:
        return False
    first = next(iter(model_state.values()))
    return torch.is_tensor(first)


def _rank() -> int:
    import torch.distributed as dist

    return dist.get_rank() if dist.is_available() and dist.is_initialized() else 0


def _barrier() -> None:
    import torch.distributed as dist

    if dist.is_available() and dist.is_initialized():
        dist.barrier()
