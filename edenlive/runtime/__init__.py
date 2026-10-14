from edenlive.core.registry import Registry
from edenlive.runtime.base import RuntimePlugin
from edenlive.runtime.cache.kv_cache import KVCachePlugin
from edenlive.runtime.distributed.fsdp2 import FSDP2Plugin
from edenlive.runtime.distributed.sequence_parallel import SequenceParallelPlugin
from edenlive.runtime.efficiency import AttentionBackendPlugin, TorchCompilePlugin
from edenlive.runtime.precision import (
    attach_runtime_precision,
    compute_dtype,
    param_dtype,
    reduce_dtype,
    resolve_torch_dtype,
)

RUNTIME_PLUGINS: Registry[type[RuntimePlugin]] = Registry("runtime_plugin")
RUNTIME_PLUGINS.register("fsdp2", FSDP2Plugin)
RUNTIME_PLUGINS.register("sequence_parallel", SequenceParallelPlugin)
RUNTIME_PLUGINS.register("kv_cache", KVCachePlugin)
RUNTIME_PLUGINS.register("torch_compile", TorchCompilePlugin)
RUNTIME_PLUGINS.register("attention_backend", AttentionBackendPlugin)

__all__ = [
    "RUNTIME_PLUGINS",
    "RuntimePlugin",
    "attach_runtime_precision",
    "compute_dtype",
    "param_dtype",
    "reduce_dtype",
    "resolve_torch_dtype",
]
