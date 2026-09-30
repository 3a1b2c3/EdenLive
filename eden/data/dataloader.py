from __future__ import annotations

from typing import Any

import torch
import torch.distributed as dist
from torch.utils.data import ConcatDataset, DataLoader, DistributedSampler

from eden.core.types import Batch, ConditionBundle, ModalityPayload, TargetBundle
from eden.data.config import DatasetConfig
from eden.data.dataset_manifest import ManifestDataset


#: Datasets available to offline inference. A manifest row carries the conditions
#: (prompt, source video, first frame) a generation request needs; the training
#: datasets and their mixture sampler are not part of the inference path.
DATASETS = {
    "manifest": ManifestDataset,
}


def build_dataset(config: DatasetConfig | dict[str, Any]):
    if isinstance(config, DatasetConfig):
        name = config.name
        params = config.params
    else:
        name = config["name"]
        params = config.get("params", {})
    cls = DATASETS[name]
    return cls(**params)


def _collate_values(values: list[Any]) -> Any:
    import torch

    if values and all(torch.is_tensor(item) for item in values):
        try:
            return torch.stack(values, dim=0)
        except RuntimeError:
            return values
    return values


def _collate_payloads(samples: list[dict], section: str) -> dict[str, ModalityPayload]:
    keys = sorted({key for sample in samples for key in sample.get(section, {})})
    payloads = {}
    for key in keys:
        values = [sample.get(section, {}).get(key) for sample in samples]
        payloads[key] = ModalityPayload(name=key, data=_collate_values(values))
    return payloads


def collate_to_batch(samples: list[dict]) -> Batch:
    if samples and "conditions" in samples[0]:
        metadata = {
            "items": [item.get("metadata", {}) for item in samples],
            "paths": [item.get("path") for item in samples],
        }
        _attach_source_metadata(metadata)
        return Batch(
            inputs=_collate_payloads(samples, "inputs"),
            conditions=ConditionBundle(items=_collate_payloads(samples, "conditions")),
            targets=TargetBundle(items=_collate_payloads(samples, "targets")),
            metadata=metadata,
        )

    videos = torch.stack([item["video"] for item in samples], dim=0)
    texts = [item["text"] for item in samples]
    paths = [item.get("path") for item in samples]
    metadata = {
        "paths": paths,
        "items": [item.get("metadata", {}) for item in samples],
    }
    _attach_source_metadata(metadata)
    return Batch(
        inputs={"video": ModalityPayload(name="video", data=videos)},
        conditions=ConditionBundle(items={"text": ModalityPayload(name="text", data=texts)}),
        targets=TargetBundle(items={"video": ModalityPayload(name="video", data=videos)}),
        metadata=metadata,
    )


def _attach_source_metadata(metadata: dict[str, Any]) -> None:
    items = metadata.get("items", [])
    source_ids = [item.get("source_id") for item in items if isinstance(item, dict)]
    if source_ids and all(isinstance(source_id, str) and source_id for source_id in source_ids):
        metadata["source_ids"] = list(source_ids)
    unique_source_ids = set(source_ids)
    unique_source_ids.discard(None)
    if len(unique_source_ids) == 1:
        metadata["source_id"] = next(iter(unique_source_ids))
        metadata["source_sample_indices"] = [item.get("source_sample_index") for item in items]
        metadata["source_draw_indices"] = [item.get("source_draw_index") for item in items]


def _distributed_sampler_topology(runtime_context=None):
    if not dist.is_available() or not dist.is_initialized() or dist.get_world_size() <= 1:
        return None
    try:
        from eden.runtime.distributed.sequence_parallel import get_sequence_parallel_state

        state = get_sequence_parallel_state(runtime_context)
    except Exception:
        state = None
    if state is not None and state.enabled:
        return state.dp_size, state.dp_rank
    return dist.get_world_size(), dist.get_rank()


def build_dataloader(config: dict[str, Any], runtime_context=None) -> DataLoader:
    if "sources" in config or (config.get("datasets") is not None and config.get("weights") is not None):
        raise ValueError(
            "weighted multi-source data configs belong to training; offline inference takes a single "
            "`data.dataset` (see any config under eden/configs/)"
        )

    datasets_cfg = config.get("datasets")
    if datasets_cfg is not None:
        datasets = [build_dataset(item) for item in datasets_cfg]
        ds = ConcatDataset(datasets)
    else:
        ds = build_dataset(config["dataset"])

    loader_cfg = dict(config.get("loader", {}))
    for key in ("batch_size", "num_workers", "pin_memory", "drop_last", "persistent_workers", "prefetch_factor"):
        if key in config:
            loader_cfg.setdefault(key, config[key])
    sampler = None
    shuffle = bool(config.get("shuffle", True))
    topology = _distributed_sampler_topology(runtime_context)
    drop_last = bool(loader_cfg.get("drop_last", True))
    if topology is not None:
        replicas, rank = topology
        sampler = DistributedSampler(
            ds,
            num_replicas=int(replicas),
            rank=int(rank),
            shuffle=shuffle,
            drop_last=drop_last,
        )
        shuffle = False

    num_workers = int(loader_cfg.get("num_workers", 4))

    dataloader_kwargs = {
        "batch_size": int(loader_cfg.get("batch_size", 1)),
        "shuffle": shuffle if sampler is None else False,
        "sampler": sampler,
        "num_workers": num_workers,
        "pin_memory": bool(loader_cfg.get("pin_memory", True)),
        "drop_last": drop_last,
        "persistent_workers": bool(loader_cfg.get("persistent_workers", True)) and num_workers > 0,
        "collate_fn": collate_to_batch,
    }
    if num_workers > 0:
        prefetch_factor = loader_cfg.get("prefetch_factor", 2)
        if prefetch_factor is not None:
            dataloader_kwargs["prefetch_factor"] = int(prefetch_factor)

    return DataLoader(
        ds,
        **dataloader_kwargs,
    )
