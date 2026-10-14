from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

import torch
import torch.distributed as dist

from edenlive.core.types import RuntimeContext
from edenlive.runtime.base import RuntimePlugin
from edenlive.utils import get_logger

if TYPE_CHECKING:  # A runtime plugin only needs ``ModelAdapter`` for annotations, and
    # ``from __future__ import annotations`` defers those.  Importing it eagerly closes
    # a cycle: ``edenlive.runtime`` -> here -> ``edenlive.models`` -> the Wan adapter
    # -> back into the half-initialized ``edenlive.runtime``.  ``models/__init__.py``
    # catches that ImportError and leaves MODEL_ADAPTERS permanently empty, so the
    # failure surfaces much later as "Unknown model_adapter".
    from edenlive.models.base import ModelAdapter

logger = get_logger(__name__)


@dataclass
class SequenceParallelState:
    enabled: bool
    size: int
    rank: int = 0
    world_size: int = 1
    dp_size: int = 1
    dp_rank: int = 0
    sp_rank: int = 0
    group: Any | None = None
    mesh: Any | None = None
    dp_mesh: Any | None = None
    sp_mesh: Any | None = None
    # Flattened (ulysses x dp) mesh spanning the whole world. FSDP2 must reduce
    # gradients over THIS mesh, not dp_mesh: with Ulysses SP each rank only sees
    # its local token shard, so the non-attention params' gradients are partial
    # and must be averaged across the SP group as well as the DP group.
    fsdp_mesh: Any | None = None
    parallel_config: Any | None = None


class SequenceParallelPlugin(RuntimePlugin):
    name = "sequence_parallel"

    @dataclass
    class Config:
        enabled: bool = False
        size: int = 1
        axis: str = "temporal"
        layout: str = "balanced_blocks"
        backend: str = "ulysses"
        ulysses_anything: bool = False
        convert_to_fp32: bool = True
        extra: dict[str, Any] = field(default_factory=dict)

    def attach(self, model: ModelAdapter, context: RuntimeContext) -> RuntimeContext:
        if not self.enabled:
            return context
        super().attach(model, context)
        size = int(self.config.size)
        if size < 1:
            raise ValueError("sequence_parallel.size must be >= 1")
        context.distributed["sequence_parallel"] = {
            "enabled": size > 1,
            "size": size,
            "axis": self.config.axis,
            "layout": self.config.layout,
            "backend": self.config.backend,
            "ulysses_anything": bool(self.config.ulysses_anything),
            "convert_to_fp32": bool(self.config.convert_to_fp32),
        }
        return context

    def prepare_model(self, model: ModelAdapter, context: RuntimeContext) -> None:
        if not self.enabled:
            return
        state = ensure_sequence_parallel_state(context)
        if state.enabled:
            prepare = getattr(model, "prepare_sequence_parallel", None)
            if callable(prepare):
                prepare(context)
            logger.info_rank0(
                f"Sequence parallel initialized: size={state.size}, dp_size={state.dp_size}, "
                f"backend={context.distributed['sequence_parallel'].get('backend', 'ulysses')}"
            )


def ensure_sequence_parallel_state(context: RuntimeContext) -> SequenceParallelState:
    existing = context.extras.get("sequence_parallel_state")
    if isinstance(existing, SequenceParallelState):
        return existing

    import torch.distributed as dist

    cfg = context.distributed.get("sequence_parallel", {})
    requested_size = int(cfg.get("size", 1))
    enabled = bool(cfg.get("enabled", False) and requested_size > 1 and dist.is_available() and dist.is_initialized())
    world_size = dist.get_world_size() if dist.is_available() and dist.is_initialized() else 1
    rank = dist.get_rank() if dist.is_available() and dist.is_initialized() else 0
    if not enabled:
        state = SequenceParallelState(enabled=False, size=1, rank=rank, world_size=world_size)
        context.extras["sequence_parallel_state"] = state
        return state
    if world_size % requested_size != 0:
        raise ValueError(f"world_size={world_size} must be divisible by sequence_parallel.size={requested_size}")

    from torch.distributed.device_mesh import init_device_mesh

    dp_size = world_size // requested_size
    # Diffusers context parallel expects dimensions named ring/ulysses. We keep
    # ring size 1 and shard FSDP over the dp dimension.
    mesh = init_device_mesh(
        "cuda",
        (1, requested_size, dp_size),
        mesh_dim_names=("ring", "ulysses", "dp"),
    )
    sp_mesh = mesh["ulysses"]
    dp_mesh = mesh["dp"]
    sp_rank = sp_mesh.get_local_rank()
    dp_rank = dp_mesh.get_local_rank()

    # FSDP2 must reduce gradients across the full (ulysses x dp) world so the
    # partial per-token-shard gradients from Ulysses SP are averaged over the SP
    # group as well as the DP group. ring is size 1, so ulysses x dp = world.
    try:
        fsdp_mesh = mesh["ulysses", "dp"]._flatten("fsdp")
    except Exception:
        # Fallback for torch versions without _flatten: a fresh 1D world mesh.
        fsdp_mesh = init_device_mesh("cuda", (world_size,), mesh_dim_names=("fsdp",))

    parallel_config = _build_diffusers_parallel_config(context, mesh, requested_size)
    state = SequenceParallelState(
        enabled=True,
        size=requested_size,
        rank=rank,
        world_size=world_size,
        dp_size=dp_size,
        dp_rank=dp_rank,
        sp_rank=sp_rank,
        group=sp_mesh.get_group(),
        mesh=mesh,
        dp_mesh=dp_mesh,
        sp_mesh=sp_mesh,
        fsdp_mesh=fsdp_mesh,
        parallel_config=parallel_config,
    )
    context.extras["sequence_parallel_state"] = state
    return state


def _build_diffusers_parallel_config(context: RuntimeContext, mesh: Any, sp_size: int):
    cfg = context.distributed.get("sequence_parallel", {})
    try:
        from diffusers.models._modeling_parallel import ContextParallelConfig, ParallelConfig
    except Exception:
        return None
    cp = ContextParallelConfig(
        ring_degree=1,
        ulysses_degree=sp_size,
        convert_to_fp32=bool(cfg.get("convert_to_fp32", True)),
        mesh=mesh,
        ulysses_anything=bool(cfg.get("ulysses_anything", False)),
    )
    pc = ParallelConfig(context_parallel_config=cp)
    device = context.device if context.device is not None else torch.device("cuda", torch.cuda.current_device())
    pc.setup(
        rank=torch.distributed.get_rank(),
        world_size=torch.distributed.get_world_size(),
        device=device,
        mesh=mesh,
    )
    return pc


def get_sequence_parallel_state(context: RuntimeContext | None) -> SequenceParallelState:
    if context is None:
        return SequenceParallelState(enabled=False, size=1)
    return ensure_sequence_parallel_state(context)


def split_sequence(tensor: torch.Tensor, context: RuntimeContext | None, *, dim: int = 1) -> tuple[torch.Tensor, int]:
    state = get_sequence_parallel_state(context)
    if not state.enabled:
        return tensor, 0
    length = tensor.shape[dim]
    if length % state.size != 0:
        raise RuntimeError(f"Cannot sequence-split length {length} by SP size {state.size}; enable *_anything or pad first")
    local = length // state.size
    start = state.sp_rank * local
    return tensor.narrow(dim, start, local).contiguous(), start


def gather_sequence(tensor: torch.Tensor, context: RuntimeContext | None, *, dim: int = 1) -> torch.Tensor:
    state = get_sequence_parallel_state(context)
    if not state.enabled:
        return tensor
    tensor = tensor.contiguous()
    if tensor.requires_grad:
        from torch.distributed.nn.functional import all_gather

        chunks = all_gather(tensor, group=state.group)
    else:
        chunks = [torch.empty_like(tensor) for _ in range(state.size)]
        dist.all_gather(chunks, tensor, group=state.group)
    return torch.cat(tuple(chunks), dim=dim).contiguous()


def broadcast_from_sp_src(tensor: torch.Tensor, context: RuntimeContext | None, *, src_sp_rank: int = 0) -> torch.Tensor:
    state = get_sequence_parallel_state(context)
    if not state.enabled:
        return tensor
    src_global_rank = _global_rank_for_sp_rank(state, src_sp_rank)
    torch.distributed.broadcast(tensor, src=src_global_rank, group=state.group)
    return tensor


def randn_sp_synced(
    shape: tuple[int, ...],
    *,
    device,
    dtype,
    context: RuntimeContext | None,
    generator: torch.Generator | None = None,
) -> torch.Tensor:
    state = get_sequence_parallel_state(context)
    if not state.enabled or state.sp_rank == 0:
        tensor = torch.randn(shape, device=device, dtype=dtype, generator=generator)
    else:
        tensor = torch.empty(shape, device=device, dtype=dtype)
    return broadcast_from_sp_src(tensor, context, src_sp_rank=0)


def _global_rank_for_sp_rank(state: SequenceParallelState, src_sp_rank: int) -> int:
    ranks = list(torch.distributed.get_process_group_ranks(state.group))
    return ranks[int(src_sp_rank)]
