"""Check temporal conditioning and explicit pixel ranges of demo profiles."""

import numpy as np
import pytest

from edenlive.data.recording_manifest import prompt_schedule
from edenlive.inference.io import _to_numpy_video
from edenlive.models.adapters.wan22_diffusers.dynamic_prompt import frame_lengths


def test_bright_normalized_video_keeps_explicit_range():
    video = np.full((2, 4, 4, 3), 0.2, dtype=np.float32)
    assert (_to_numpy_video(video, value_range="-1,1") == 153).all()
    assert (_to_numpy_video(video, value_range="0,1") == 51).all()
    with pytest.raises(ValueError, match="value_range"):
        _to_numpy_video(video, value_range="unknown")


def test_chunk_prompts_include_only_overlapping_events():
    metadata = {
        "staticPrompt": "scene",
        "dynamicPrompts": [
            {"startMs": 375, "endMs": 500, "text": "turn"},
            {"startMs": 875, "endMs": 1000, "text": "jump"},
        ],
    }
    rows = prompt_schedule(metadata, 25, fps=24, chunk_size=3)
    assert [r["prompt"] for r in rows] == ["scene", "scene turn", "scene jump"]
    assert [r["latent_frames"] for r in rows] == [3, 3, 1]
    assert all(
        r["prompt"] == "scene" for r in prompt_schedule(metadata, 25, dynamic=False)
    )


def test_text_boundary_belongs_to_left_latent_segment():
    timeline = {
        "fps": 24,
        "num_frames": 25,
        "segments": [
            {"start_sec": 0, "end_sec": 0.5, "text": "left"},
            {"start_sec": 0.5, "end_sec": 25 / 24, "text": "right"},
        ],
    }
    assert frame_lengths(timeline, 7) == (4, 3)
    with pytest.raises(ValueError, match="decoded frames"):
        frame_lengths(timeline, 8)


@pytest.mark.parametrize("commit", [False, True])
def test_fixed_window_cache_retains_raw_keys_and_rotates_history(monkeypatch, commit):
    import torch
    from types import SimpleNamespace
    from edenlive.models.adapters.wan22_diffusers import wan_ops

    history = torch.arange(12, dtype=torch.float32).reshape(1, 3, 1, 4)
    current = torch.arange(12, 24, dtype=torch.float32).reshape(1, 3, 4)
    cache = {
        "k": torch.zeros(1, 6, 1, 4),
        "v": torch.zeros(1, 6, 1, 4),
        "global_end_index": torch.tensor(3),
        "local_end_index": torch.tensor(3),
    }
    cache["k"][:, :3] = history
    seen = {}

    def dispatch(q, k, v, **kwargs):
        seen["key"] = k.clone()
        return q

    monkeypatch.setattr(
        wan_ops,
        "_wan_imports",
        lambda: (None, None, dispatch, None, lambda a, h, e: (h, h, h)),
    )
    attn = SimpleNamespace(
        norm_q=torch.nn.Identity(),
        norm_k=torch.nn.Identity(),
        heads=1,
        to_out=[torch.nn.Identity(), torch.nn.Identity()],
    )
    query_rope = (torch.ones(1, 3, 1, 4), torch.zeros(1, 3, 1, 4))
    key_rope = (torch.zeros(1, 6, 1, 4), torch.ones(1, 6, 1, 4))
    wan_ops._self_attention(
        attn,
        current,
        rotary_emb=query_rope,
        key_rotary_emb=key_rope,
        kv_cache=cache,
        current_start=3,
        global_query_length=3,
        max_attention_tokens=6,
        cache_update=commit,
    )
    raw = torch.cat([history, current.unflatten(2, (1, 4))], dim=1)
    assert torch.equal(seen["key"], wan_ops._apply_rotary_emb(raw, *key_rope))
    assert torch.equal(cache["k"][:, :3], history)
    if commit:
        assert torch.equal(cache["k"], raw)
    else:
        assert not cache["k"][:, 3:].any()


@pytest.mark.parametrize(
    "rank,expected", [(0, [0, 1, 4, 5, 8, 9]), (1, [2, 3, 6, 7, 10, 11])]
)
def test_fixed_window_rope_follows_each_sp_chunk_storage_order(rank, expected):
    import torch
    from edenlive.core.types import RuntimeContext
    from edenlive.runtime.distributed.sequence_parallel import SequenceParallelState
    from edenlive.models.adapters.wan22_diffusers.wan_ops import _shard_cache_rotary_emb

    context = RuntimeContext(
        extras={
            "sequence_parallel_state": SequenceParallelState(
                enabled=True, size=2, sp_rank=rank
            )
        }
    )
    frequencies = torch.arange(12).reshape(1, 12, 1, 1)
    cos, sin = _shard_cache_rotary_emb((frequencies, frequencies + 100), 4, context)
    assert cos.flatten().tolist() == expected
    assert sin.flatten().tolist() == [i + 100 for i in expected]


def test_loaded_control_norm_uses_transformer_storage_dtype(monkeypatch):
    import torch
    from types import SimpleNamespace
    from edenlive.core.types import RuntimeContext
    from edenlive.models.adapters.wan22_diffusers import adapter as adapter_module

    transformer = torch.nn.Module()
    transformer.config = SimpleNamespace(in_channels=4)
    transformer.patch_embedding = torch.nn.Conv3d(4, 4, 1)
    transformer.blocks = torch.nn.ModuleList()

    class Pipeline:
        def __init__(self):
            self.transformer = transformer

        def to(self, device):
            self.transformer.to(device)
            return self

    model = adapter_module.Wan22DiffusersAdapter(
        {
            "torch_dtype": "bfloat16",
            "proxy_dino": {
                "enabled": True,
                "control_dim": 4,
                "channel_concat_rmsnorm": True,
            },
        }
    )
    monkeypatch.setattr(model, "_assemble_pipeline", lambda **kwargs: Pipeline())
    monkeypatch.setattr(model, "_load_proxy_dino", lambda **kwargs: torch.nn.Identity())
    monkeypatch.setattr(
        adapter_module, "patch_wan_transformer_forward", lambda module: None
    )
    monkeypatch.setattr(
        adapter_module, "configure_teacher_forcing_attention", lambda *args: None
    )
    model.load_components(RuntimeContext(device=torch.device("cpu")))
    assert transformer.patch_embedding.weight.dtype == torch.bfloat16
    assert transformer.patch_embedding.condition_norm.weight.dtype == torch.bfloat16


def test_cache_commit_keeps_clip_image_embeddings(monkeypatch):
    import torch
    from edenlive.core.types import ConditionBundle, ModalityPayload
    from edenlive.models.adapters.wan22_diffusers.adapter import Wan22DiffusersAdapter

    seen = {}

    class Transformer(torch.nn.Module):
        def forward(self, **kwargs):
            seen.update(kwargs)

    model = Wan22DiffusersAdapter({})
    model.components = {"transformer": Transformer()}
    monkeypatch.setattr(model, "load_components", lambda context=None: None)
    monkeypatch.setattr(
        model,
        "_channel_concat_causal_input",
        lambda latent, condition, **kwargs: latent,
    )
    image = torch.randn(1, 3, 4)
    condition = ConditionBundle(
        items={
            "prompt_embeds": ModalityPayload("prompt_embeds", torch.randn(1, 2, 4)),
            "image_embeds": ModalityPayload("image_embeds", image),
        }
    )
    model._update_all_transformer_caches(
        torch.zeros(1, 4, 3, 2, 2),
        torch.zeros(1),
        condition,
        {"transformer": []},
        current_start=0,
    )
    assert seen["encoder_hidden_states_image"] is image
    assert seen["cache_update"] is True


def test_unipc_sigma_table_stays_on_the_generation_device():
    import torch
    from edenlive.schedulers.diffusers_adapter import DiffusersSchedulerAdapter

    class NativeScheduler:
        config = {"num_train_timesteps": 1000}

        def set_timesteps(self, steps, device=None):
            self.sigmas = torch.tensor([1.0, 0.5, 0.0])
            self.timesteps = torch.tensor([1000.0, 500.0], device=device)

    native = NativeScheduler()
    schedule = DiffusersSchedulerAdapter(native).build_schedule(
        2, device=torch.device("meta")
    )
    assert schedule.sigmas.device == schedule.timesteps.device
    assert native.sigmas is schedule.sigmas
