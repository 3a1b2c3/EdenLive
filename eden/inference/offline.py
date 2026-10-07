from __future__ import annotations

from pathlib import Path
from typing import Any

from eden.core.factory import build_model_adapter, build_runtime_plugins
from eden.core.types import Batch, ConditionBundle, ModalityPayload, RuntimeContext
from eden.data import build_dataloader
from eden.inference.checkpoint import (
    load_inference_checkpoint,
    load_inference_module_checkpoints,
)
from eden.inference.engine import InferenceEngine
from eden.inference.io import save_generation_artifacts
from eden.inference.request import GenerationRequest
from eden.runtime.precision import attach_runtime_precision, resolve_torch_dtype


def run_offline_inference(config: dict[str, Any], *, output_dir: str | Path | None = None) -> None:
    """Run batch inference over a configured dataloader.

    This is intentionally thin: data loading, generation, and artifact writing
    reuse the same framework objects used by training validation.
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
    checkpoint = inference_cfg.get("checkpoint")
    module_checkpoints = inference_cfg.get("module_checkpoints")
    if checkpoint and module_checkpoints:
        raise ValueError(
            "inference.checkpoint and inference.module_checkpoints are mutually exclusive"
        )
    if module_checkpoints:
        step_name = load_inference_module_checkpoints(
            model_adapter=model,
            checkpoints=module_checkpoints,
            runtime_context=runtime_context,
            source=str(inference_cfg.get("checkpoint_source", "model")),
        )
    else:
        step_name = load_inference_checkpoint(
            model_adapter=model,
            checkpoint=checkpoint,
            output_root=output_root,
            export_if_needed=bool(inference_cfg.get("export_if_needed", True)),
            runtime_context=runtime_context,
            source=str(inference_cfg.get("checkpoint_source", "model")),
        )
    engine = InferenceEngine(model, runtime_context=runtime_context, config=inference_cfg)
    loader = _select_inference_loader(config, runtime_context)
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
        request = GenerationRequest(
            conditions=conditions,
            strategy=str(inference_cfg.get("strategy", inference_cfg.get("pipeline", "diffusion"))),
            outputs=tuple(inference_cfg.get("outputs", inference_cfg.get("output_heads", ["video"]))),
            params=dict(inference_cfg),
            metadata={"source": "offline", "batch_idx": batch_idx},
        )
        with torch.no_grad():
            output = engine.generate(request)
        # SP ranks produce equivalent logical samples. Keep every rank's artifact
        # for distributed debugging; the writer's rank-prefixed filenames avoid
        # collisions and make mismatches inspectable.
        save_generation_artifacts(
            batch=batch,
            output=output,
            prompts=prompts,
            step=step_name,
            rank=rank,
            output_dir=save_root,
            config=inference_cfg,
            batch_start_index=batch_idx * max(len(prompts), 1),
        )
    _destroy_distributed()


def _condition_text_items(batch, num_samples: int) -> list[str]:
    data = batch.conditions.require("text").data
    if isinstance(data, str):
        return [data]
    return list(data[:num_samples])


def _select_inference_loader(config: dict[str, Any], runtime_context: RuntimeContext | None = None):
    """Select the configured dataset unless explicit prompt-only input is requested."""
    inference_cfg = config.get("inference", {})
    if bool(inference_cfg.get("use_prompt_loader", False)) or "data" not in config:
        return _prompt_loader(inference_cfg, runtime_context)
    return build_dataloader(config["data"], runtime_context)


def _prompt_loader(inference_cfg: dict[str, Any], runtime_context: RuntimeContext | None = None):
    import json
    from pathlib import Path

    import torch.distributed as dist

    prompt_json_path = inference_cfg.get("prompt_json_path")
    if prompt_json_path is not None:
        path = Path(prompt_json_path)
        payload = json.loads(path.read_text(encoding="utf-8"))
        prompt = payload if isinstance(payload, list) else [payload]
    else:
        prompt = inference_cfg.get("prompt", "a cinematic test prompt")
    prompts = prompt if isinstance(prompt, list) else [str(prompt)]
    if dist.is_available() and dist.is_initialized() and bool(inference_cfg.get("shard_prompts", True)):
        shards, shard_rank = _prompt_shard_topology(runtime_context)
        prompts = prompts[shard_rank::shards]
    prompt_batch_size = max(1, int(inference_cfg.get("prompt_batch_size", 1)))
    for start in range(0, len(prompts), prompt_batch_size):
        chunk = prompts[start : start + prompt_batch_size]
        if not chunk:
            continue
        batch = Batch(
            conditions=ConditionBundle(items={"text": ModalityPayload("text", chunk)}),
            metadata={"items": [{"dataset": "prompt", "prompt_index": start + offset} for offset, _ in enumerate(chunk)]},
        )
        yield batch


def _prompt_shard_topology(runtime_context: RuntimeContext | None = None) -> tuple[int, int]:
    import torch.distributed as dist

    if not dist.is_available() or not dist.is_initialized():
        return 1, 0
    try:
        from eden.runtime.distributed.sequence_parallel import get_sequence_parallel_state

        state = get_sequence_parallel_state(runtime_context)
        if state.enabled:
            return int(state.dp_size), int(state.dp_rank)
    except Exception:
        pass
    return dist.get_world_size(), dist.get_rank()


def _init_distributed():
    from eden.runtime.distributed.process_group import init_distributed

    return init_distributed()


def _destroy_distributed() -> None:
    from eden.runtime.distributed.process_group import destroy_distributed

    destroy_distributed()
