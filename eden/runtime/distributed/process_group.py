"""Process-group initialization shared by training and offline inference.

Both entrypoints previously carried their own copy of this logic. Keeping one
implementation here means the device binding and timeout policy cannot drift
between a train run and the offline inference run that validates it.
"""

from __future__ import annotations

import datetime
import os

import torch
import torch.distributed as dist

from eden.utils import get_logger

logger = get_logger(__name__)

# torch's built-in default for the NCCL backend is 10 minutes, which is shorter
# than a cold weight load off a shared filesystem: ranks that finish loading
# early sit in the first collective while slower ranks are still reading, and
# the whole job dies before step 0. Override with EDEN_DIST_TIMEOUT.
DEFAULT_DIST_TIMEOUT_SECONDS = 3600


def resolve_dist_timeout() -> datetime.timedelta:
    """Read the collective timeout from the environment, falling back to 1h."""

    raw = os.environ.get("EDEN_DIST_TIMEOUT")
    seconds = DEFAULT_DIST_TIMEOUT_SECONDS
    if raw:
        try:
            parsed = int(raw)
            if parsed > 0:
                seconds = parsed
            else:
                logger.warning("EDEN_DIST_TIMEOUT=%s is not positive; using %ss", raw, seconds)
        except ValueError:
            logger.warning("EDEN_DIST_TIMEOUT=%s is not an integer; using %ss", raw, seconds)
    return datetime.timedelta(seconds=seconds)


def _should_init() -> bool:
    return (
        "RANK" in os.environ
        and "WORLD_SIZE" in os.environ
        and "LOCAL_RANK" in os.environ
        and int(os.environ.get("WORLD_SIZE", "1")) > 1
        and dist.is_available()
        and not dist.is_initialized()
    )


def init_distributed() -> tuple[torch.device, int, int]:
    """Initialize the default process group and bind this rank to its device.

    Returns ``(device, rank, world_size)``. Safe to call when the process was
    not launched under torchrun: it degrades to single-process defaults.
    """

    local_rank = int(os.environ.get("LOCAL_RANK", "0"))

    # Bind the device BEFORE init_process_group so NCCL does not have to infer
    # the rank -> GPU mapping from ambient state, and pass it explicitly via
    # device_id. Without this torch warns that a wrong guess "can potentially
    # cause a hang".
    device = torch.device("cpu")
    if torch.cuda.is_available():
        torch.cuda.set_device(local_rank)
        device = torch.device("cuda", local_rank)

    if _should_init():
        timeout = resolve_dist_timeout()
        kwargs: dict[str, object] = {"timeout": timeout}
        if device.type == "cuda":
            kwargs["device_id"] = device
        dist.init_process_group("nccl", **kwargs)
        logger.info(
            "Initialized process group: rank %s/%s local_rank %s device %s timeout %s",
            dist.get_rank(),
            dist.get_world_size(),
            local_rank,
            device,
            timeout,
        )

    initialized = dist.is_available() and dist.is_initialized()
    rank = dist.get_rank() if initialized else 0
    world = dist.get_world_size() if initialized else 1
    return device, rank, world


def destroy_distributed() -> None:
    """Tear down the default process group when one is active."""

    if dist.is_available() and dist.is_initialized():
        dist.destroy_process_group()
