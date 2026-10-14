from __future__ import annotations

from pathlib import Path
from typing import Any

from edenlive.core.factory import build_model_adapter, build_runtime_plugins
from edenlive.core.types import ConditionBundle, ModalityPayload, RuntimeContext
from edenlive.data import build_dataloader
from edenlive.inference.engine import InferenceEngine
from edenlive.inference.io import save_generation_artifacts
from edenlive.inference.request import GenerationRequest
from edenlive.runtime.precision import attach_runtime_precision, resolve_torch_dtype


def run_offline_inference(config: dict[str, Any], *, output_dir: str | Path | None = None) -> None:
    """Run batch inference over a configured dataloader.

    Data loading, generation, and artifact writing share the configured model
    and runtime context.
    """

    import torch

    device, rank, _world = _init_distributed()
    runtime_context = RuntimeContext(device=device)
    runtime_context.extras["mode"] = "inference"
    compute = resolve_torch_dtype("bfloat16")
    attach_runtime_precision(
        runtime_context,
        compute_dtype=compute,
        # Inference keeps weights in the compute dtype. FP32 master weights are
        # a training-only optimizer concern and would double resident memory.
        param_dtype=compute,
    )
    model = build_model_adapter(config)
    runtime_plugins = build_runtime_plugins(config)
    for plugin in runtime_plugins:
        runtime_context = plugin.attach(model, runtime_context)
    model.load_components(runtime_context)
    # Keep inference ordering identical to training: compile ordinary blocks,
    # install sequence parallel, then wrap the final graph with FSDP2.
    priority = {"torch_compile": 0, "sequence_parallel": 1, "fsdp2": 2}
    for plugin in sorted(runtime_plugins, key=lambda plugin: priority.get(plugin.name, 1)):
        plugin.prepare_model(model, runtime_context)

    inference_cfg = config.get("inference", {})
    output_root = Path(
        output_dir
        or inference_cfg.get("output_dir")
        or "outputs/inference"
    )
    engine = InferenceEngine(model, runtime_context=runtime_context, config=inference_cfg)
    loader = build_dataloader(config["data"], runtime_context)
    save_root = output_root / "save" / "inference"
    max_batches = int(inference_cfg.get("max_batches", 0))

    for batch_idx, batch in enumerate(loader):
        if max_batches > 0 and batch_idx >= max_batches:
            break
        prompts = _condition_text_items(batch, int(inference_cfg.get("num_samples", 1)))
        conditions = ConditionBundle(
            items={**batch.conditions.items, "text": ModalityPayload("text", prompts)},
            raw=dict(batch.conditions.raw),
        )
        params = dict(inference_cfg)
        proxy = conditions.get("video_context")
        if proxy is not None and "num_frames" in proxy.metadata:
            params["num_frames"] = int(proxy.metadata["num_frames"])
        chunk_prompts = conditions.get("chunk_prompts")
        if chunk_prompts is not None:
            if len(chunk_prompts.data) != 1:
                raise ValueError("chunk_prompts requires batch_size=1")
            params["chunk_prompts"] = chunk_prompts.data[0]
        request = GenerationRequest(
            conditions=conditions,
            strategy=str(inference_cfg.get("strategy", inference_cfg.get("pipeline", "diffusion"))),
            outputs=tuple(inference_cfg.get("outputs", inference_cfg.get("output_heads", ["video"]))),
            params=params,
            metadata={"source": "offline", "batch_idx": batch_idx},
        )
        with torch.no_grad():
            output = engine.generate(request)
        # Every rank of a sequence-parallel group holds the same sample, so only
        # the group's first rank writes it.
        if _is_artifact_writer(runtime_context):
            names = _artifact_names(batch, len(prompts), rank=rank, batch_idx=batch_idx)
            save_generation_artifacts(
                batch=batch,
                output=output,
                prompts=prompts,
                names=names,
                step="base",
                output_dir=save_root,
                config=inference_cfg,
            )
            import json
            import yaml

            artifact_dir = save_root / "base"
            (artifact_dir / "resolved.yaml").write_text(yaml.safe_dump(config, sort_keys=False, allow_unicode=True), encoding="utf-8")
            for index, name in enumerate(names):
                item = batch.metadata.get("items", [])[index]
                (artifact_dir / f"{name}_input.json").write_text(json.dumps(item, ensure_ascii=False, indent=2), encoding="utf-8")
                (artifact_dir / f"{name}_request.json").write_text(json.dumps(params, ensure_ascii=False, indent=2), encoding="utf-8")
                timeline = batch.conditions.get("text_timeline")
                if timeline is not None:
                    (artifact_dir / f"{name}_text_timeline.json").write_text(
                        json.dumps(timeline.data[index], ensure_ascii=False, indent=2), encoding="utf-8"
                    )
    _destroy_distributed()


def _is_artifact_writer(runtime_context: RuntimeContext) -> bool:
    from edenlive.runtime.distributed.sequence_parallel import get_sequence_parallel_state

    state = get_sequence_parallel_state(runtime_context)
    return not state.enabled or state.sp_rank == 0


def _artifact_names(batch, count: int, *, rank: int, batch_idx: int) -> list[str]:
    """One filename stem per sample: the manifest ``id`` when the row has one."""

    import re

    items = batch.metadata.get("items") or []
    names = []
    for index in range(count):
        item = items[index] if index < len(items) and isinstance(items[index], dict) else {}
        raw = str(item.get("id") or "").strip()
        name = re.sub(r"[^A-Za-z0-9._-]+", "_", raw).strip("._")
        names.append(name or f"rank_{rank:02d}_batch_{batch_idx:04d}_{index:02d}")
    return names


def _condition_text_items(batch, num_samples: int) -> list[str]:
    data = batch.conditions.require("text").data
    if isinstance(data, str):
        return [data]
    return list(data[:num_samples])


def _init_distributed():
    from edenlive.runtime.distributed.process_group import init_distributed

    return init_distributed()


def _destroy_distributed() -> None:
    from edenlive.runtime.distributed.process_group import destroy_distributed

    destroy_distributed()
