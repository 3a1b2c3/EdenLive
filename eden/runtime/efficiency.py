from __future__ import annotations

import types
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from eden.core.types import RuntimeContext
from eden.runtime.base import RuntimePlugin
from eden.utils import get_logger

if TYPE_CHECKING:  # A runtime plugin only needs ``ModelAdapter`` for annotations, and
    # ``from __future__ import annotations`` defers those.  Importing it eagerly closes
    # a cycle: ``eden.runtime`` -> here -> ``eden.models`` -> the Wan adapter
    # -> back into the half-initialized ``eden.runtime``.  ``models/__init__.py``
    # catches that ImportError and leaves MODEL_ADAPTERS permanently empty, so the
    # failure surfaces much later as "Unknown model_adapter".
    from eden.models.base import ModelAdapter

logger = get_logger(__name__)


class TorchCompilePlugin(RuntimePlugin):
    """Compile adapter-owned transformer blocks before FSDP2 wraps them."""

    name = "torch_compile"

    @dataclass
    class Config:
        enabled: bool = False
        backend: str | None = "inductor"
        mode: str | None = None
        fullgraph: bool = False
        dynamic: bool = False
        preserve_precision: bool = False
        extra: dict[str, Any] = field(default_factory=dict)

    def attach(self, model: ModelAdapter, context: RuntimeContext) -> RuntimeContext:
        if not self.enabled:
            return context
        super().attach(model, context)
        context.extras["torch_compile"] = {
            "enabled": True,
            "backend": self.config.backend,
            "mode": self.config.mode,
            "fullgraph": bool(self.config.fullgraph),
            "dynamic": bool(self.config.dynamic),
            "preserve_precision": bool(self.config.preserve_precision),
        }
        return context

    def prepare_model(self, model: ModelAdapter, context: RuntimeContext) -> None:
        if not self.enabled:
            return
        import torch

        if not hasattr(torch, "compile"):
            raise RuntimeError("runtime.torch_compile requires torch.compile")
        plan = model.sharding_plan(context)
        blocks = tuple(dict.fromkeys(block for block in plan.get("blocks", ()) if block is not None))
        if not blocks:
            raise RuntimeError("runtime.torch_compile found no adapter-owned transformer blocks")

        compile_kwargs: dict[str, Any] = {
            "fullgraph": bool(self.config.fullgraph),
            "dynamic": bool(self.config.dynamic),
        }
        if self.config.backend is not None:
            compile_kwargs["backend"] = self.config.backend
        if self.config.mode is not None:
            compile_kwargs["mode"] = self.config.mode

        if self.config.preserve_precision:
            if self.config.backend != "inductor" or self.config.mode not in (None, "default"):
                raise ValueError("preserve_precision requires torch_compile backend=inductor, mode=default")
            from torch._inductor import config as inductor_config

            if not hasattr(inductor_config, "emulate_precision_casts"):
                raise RuntimeError("preserve_precision requires PyTorch with Inductor emulate_precision_casts (tested: 2.11.0)")
            # Per-compiled-function options avoid changing process-global Inductor state.
            # torch.compile does not accept both mode and options.
            compile_kwargs.pop("mode", None)
            compile_kwargs["options"] = {"emulate_precision_casts": True}

        compiled = 0
        for block in blocks:
            if getattr(block, "_eden_forward_compiled", False):
                continue
            original_forward = block.forward
            if hasattr(original_forward, "__func__"):
                block._eden_original_forward = original_forward.__func__
                compiled_forward = torch.compile(original_forward.__func__, **compile_kwargs)
                block.forward = types.MethodType(compiled_forward, block)
            else:
                block._eden_original_forward = original_forward
                block.forward = torch.compile(original_forward, **compile_kwargs)
            block._eden_forward_compiled = True
            compiled += 1

        if compiled == 0:
            raise RuntimeError("runtime.torch_compile did not compile any transformer blocks")
        context.extras["torch_compile"]["compiled_blocks"] = compiled
        logger.info_rank0(f"torch.compile applied to {compiled} transformer blocks ({compile_kwargs})")


class AttentionBackendPlugin(RuntimePlugin):
    """Select a Diffusers attention backend through the process environment.

    Diffusers resolves ``DIFFUSERS_ATTN_BACKEND`` when its attention dispatch
    module is imported. This plugin therefore validates and records the choice;
    callers should set the environment before Python starts (as the benchmark
    launch does).
    """

    name = "attention_backend"

    @dataclass
    class Config:
        enabled: bool = False
        backend: str = "native"
        extra: dict[str, Any] = field(default_factory=dict)

    def attach(self, model: ModelAdapter, context: RuntimeContext) -> RuntimeContext:
        if not self.enabled:
            return context
        super().attach(model, context)
        import os

        requested = str(self.config.backend)
        current = os.environ.get("DIFFUSERS_ATTN_BACKEND", "native")
        if current != requested:
            raise RuntimeError(
                "runtime.attention_backend must be selected before Python starts: "
                f"requested={requested!r}, environment={current!r}"
            )
        try:
            from diffusers.models.attention_dispatch import AttentionBackendName

            AttentionBackendName(requested)
        except Exception as exc:
            raise ValueError(f"Unsupported Diffusers attention backend: {requested!r}") from exc
        context.extras["attention_backend"] = requested
        logger.info_rank0(f"Diffusers attention backend: {requested}")
        return context
