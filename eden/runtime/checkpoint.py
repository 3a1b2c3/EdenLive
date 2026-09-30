from __future__ import annotations

from pathlib import Path
from typing import Any

import torch

from eden.runtime.distributed.fsdp2 import is_fsdp2_model, load_fsdp2_checkpoint
from eden.utils import get_logger

logger = get_logger(__name__)


def _checkpoint_root(model_adapter):
    modules = model_adapter.trainable_modules()
    trainable = {name: module for name, module in modules.items() if module is not None}
    if not trainable:
        return None, {}
    root_module = next(iter(trainable.values())) if len(trainable) == 1 else torch.nn.ModuleDict(trainable)
    return root_module, trainable


def find_full_checkpoint_file(path: str | Path) -> Path | None:
    """Return a single-file checkpoint path, including the legacy ``.pt`` suffix.

    FSDP2 training checkpoints are DCP directories, while the original
    non-FSDP training path writes one ``.pt`` file.  Callers that accept either
    format use this helper before choosing a loader, rather than inferring the
    format from the *destination* model's FSDP wrapping.
    """

    path = Path(path)
    if path.is_file():
        return path
    if not path.suffix:
        candidate = path.with_suffix(".pt")
        if candidate.is_file():
            return candidate
    return None


def load_training_checkpoint(
    *,
    model_adapter,
    path: str | Path,
) -> tuple[int, int, dict[str, Any]]:
    """Restore a training checkpoint's model weights into the live adapter.

    Offline inference uses this for the plain ``checkpoint_source: model`` path.
    Both checkpoint formats a training run could produce are accepted: an FSDP2
    DCP directory (resharded to the current inference topology by DCP) and the
    single-file ``.pt`` the non-FSDP path wrote. Optimizer, LR-scheduler, and
    data-stream state are ignored -- they are training-only and this package no
    longer trains.
    """

    path = Path(path)
    root_module, trainable = _checkpoint_root(model_adapter)
    if not trainable:
        return 0, 0, {}

    if is_fsdp2_model(root_module):
        return load_fsdp2_checkpoint(root_module, None, path)

    ckpt_path = path if path.suffix == ".pt" else path.with_suffix(".pt")
    state = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    model_state = state.get("model", {})
    for name, module in trainable.items():
        if name in model_state:
            module.load_state_dict(model_state[name])
    step = int(state.get("step", state.get("global_step", 0)))
    epoch = int(state.get("epoch", 0))
    metadata = dict(state.get("extra", {}))
    metadata.update({"global_step": step, "epoch": epoch})
    logger.info_rank0(f"Checkpoint loaded: {ckpt_path} (step {step})")
    return step, epoch, metadata


def _looks_like_root_state_dict(state: dict[str, Any]) -> bool:
    return bool(state) and torch.is_tensor(next(iter(state.values())))


def load_module_checkpoint(
    module,
    path: str | Path,
    *,
    checkpoint_key: str = "model",
    module_name: str | None = None,
    state_child: str | None = None,
) -> dict[str, Any]:
    """Load one model/algorithm state subtree into an arbitrary prepared module.

    This is used by the trainer for algorithm-declared frozen or trainable
    replicas and by inference when independently trained named model modules
    must be composed. The caller declares the target and key; checkpoint
    format and FSDP/DCP handling remain owned by the runtime layer.

    ``module_name`` selects one named module from the module-keyed ``model``
    mapping used by unsharded Eden ``.pt`` checkpoints. FSDP2/DCP
    checkpoints store the sole training root directly below ``checkpoint_key``,
    so no additional selection is applied to that format.
    """

    path = Path(path)
    if path.suffix == ".pt":
        state = torch.load(path, map_location="cpu", weights_only=False)
        selected = state
        for part in checkpoint_key.split("."):
            if not isinstance(selected, dict) or part not in selected:
                raise KeyError(f"Checkpoint {path} has no state key {checkpoint_key!r}")
            selected = selected[part]
        if state_child is not None:
            for part in str(state_child).split("."):
                if not isinstance(selected, dict) or part not in selected:
                    prefix = f"{part}."
                    prefixed = {
                        key[len(prefix) :]: value
                        for key, value in selected.items()
                        if isinstance(key, str) and key.startswith(prefix)
                    } if isinstance(selected, dict) else {}
                    if not prefixed:
                        raise KeyError(f"Checkpoint {path} has no state child {state_child!r}")
                    selected = prefixed
                else:
                    selected = selected[part]
        if module_name is not None and isinstance(selected, dict):
            if module_name in selected:
                # Legacy module-keyed checkpoints store
                # ``model: {transformer: state_dict}``.
                selected = selected[module_name]
            else:
                # Full-root exports use the flattened ModuleDict naming
                # convention (``transformer.weight``). Extract only the
                # requested expert and strip its prefix before loading.
                prefix = f"{module_name}."
                prefixed = {
                    key[len(prefix) :]: value
                    for key, value in selected.items()
                    if isinstance(key, str) and key.startswith(prefix)
                }
                if prefixed:
                    selected = prefixed
        _load_module_state(module, selected)
        metadata = dict(state.get("extra", state.get("metadata", {})))
        metadata.setdefault("global_step", int(state.get("step", state.get("global_step", 0))))
        return metadata

    import torch.distributed.checkpoint as dcp
    from torch.distributed.checkpoint.state_dict import (
        StateDictOptions,
        get_model_state_dict,
        set_model_state_dict,
    )

    options = StateDictOptions(full_state_dict=False)
    # DCP stores algorithm roots as one logical key with flattened child names
    # below it.  Wrap a requested child under the same name so the runtime can
    # load the existing shards without asking DCP to invent a new nested root.
    target_module = module
    if state_child is not None:
        target_module = torch.nn.ModuleDict({str(state_child): module})
    load_key = checkpoint_key
    state = {
        load_key: get_model_state_dict(target_module, options=options),
        "metadata": {"global_step": 0, "epoch": 0},
    }
    dcp.load(state, checkpoint_id=str(path))
    set_model_state_dict(target_module, state[load_key], options=options)
    metadata = dict(state["metadata"])
    # DCP tensor state only contains the small distributed metadata mapping.
    # Eden stores arbitrary serializable recipe metadata beside it so
    # module-only loads (for example a frozen staged prefix) can validate the
    # exact source checkpoint without restoring the complete training state.
    sidecar = path / "trainer_state.pt"
    if sidecar.is_file():
        saved = torch.load(sidecar, map_location="cpu", weights_only=True)
        if not isinstance(saved, dict):
            raise TypeError(f"FSDP2 trainer state {sidecar} must contain a mapping")
        metadata.update(saved)
    logger.info_rank0(f"Module checkpoint loaded: {path} [{load_key}]")
    return metadata


def _load_module_state(module, state) -> None:
    try:
        module.load_state_dict(state, strict=True)
        return
    except (RuntimeError, TypeError):
        pass
    children = dict(module.named_children())
    if not isinstance(state, dict) or not children or not all(name in children for name in state):
        module.load_state_dict(state, strict=True)
        return
    for name, child_state in state.items():
        children[name].load_state_dict(child_state, strict=True)
