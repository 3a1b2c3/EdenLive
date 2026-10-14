"""Optional Wan teacher-forcing attention backend; no global backend mutation."""
from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version

from edenlive.utils import get_logger

logger = get_logger(__name__)


def validate_backend_name(backend: str) -> None:
    if backend not in ("triton", "flash4"):
        raise ValueError("model.teacher_forcing_attention_backend must be 'triton' or 'flash4'")


def validate_flash4_environment(device, dtype) -> None:
    """Fail before loading weights, rather than silently selecting a different kernel."""
    import torch
    from packaging.version import Version

    if Version(torch.__version__.split("+")[0]) < Version("2.11"):
        raise RuntimeError("Wan flash4 requires PyTorch >=2.11; tested with 2.11.0+cu128")
    if torch.device(device).type != "cuda" or not torch.cuda.is_available():
        raise RuntimeError("Wan flash4 requires a CUDA GPU")
    if torch.cuda.get_device_capability(device) != (9, 0):
        raise RuntimeError("This Wan flash4 integration currently targets SM90 (Hopper); other GPUs are unvalidated")
    if dtype != torch.bfloat16:
        raise ValueError("This Wan flash4 integration requires BF16 compute")
    try:
        versions = {name: version(name) for name in ("flash-attn-4", "nvidia-cutlass-dsl", "triton")}
        import flash_attn.cute  # noqa: F401
    except (ImportError, OSError, PackageNotFoundError) as exc:
        raise RuntimeError(
            "Cannot import FA4. Install requirements/wan22-fa4.txt in the training environment. "
            "An older flash-attn (FA2) extension built for a different torch can also break this import."
        ) from exc
    logger.info_rank0(f"Wan teacher-forcing FA4: torch={torch.__version__}, cuda={torch.version.cuda}, {versions}")


def flash4_attention(query, key, value):
    """Run an unmasked Wan self-attention with the official FA4 CuTe API.

    ``flash_attn``'s top-level FA2 symbols are intentionally not used here:
    the FA4 wheel exposes the implementation from ``flash_attn.cute``.  The
    CuTe function accepts Wan's ``[batch, sequence, heads, head_dim]`` layout
    and returns ``(output, lse)``; only the output belongs in the transformer
    residual stream.
    """

    from flash_attn.cute import flash_attn_func

    output, _lse = flash_attn_func(
        q=query,
        k=key,
        v=value,
        causal=False,
    )
    return output


def configure_teacher_forcing_attention(transformer, backend: str) -> None:
    validate_backend_name(backend)
    transformer._eden_teacher_forcing_attention_backend = backend
    for block in transformer.blocks:
        block.attn1._eden_teacher_forcing_attention_backend = backend
    logger.info_rank0(f"Wan teacher-forcing self-attention backend: {backend}")
