"""Load widened DiT weights using either supported safetensors filename.

The released tree names the DiT file ``diffusion_pytorch_model.safetensors``,
and its patch embedding is wider than ``config.json`` says
because the proxy control channels are appended. That file used to fall through to
diffusers' single-file conversion against the base config and fail on the patch
embedding shape; it must go through the widened loader like the diffusers name does.
"""

from __future__ import annotations

import json

import pytest
import torch

from edenlive.models.adapters.wan22_diffusers.adapter import Wan22DiffusersAdapter

CONTROL_CHANNELS = 8


def _write_tiny_widened_dit(directory, filename):
    from diffusers import WanTransformer3DModel
    from safetensors.torch import save_file

    config = {
        "patch_size": [1, 2, 2],
        "num_attention_heads": 2,
        "attention_head_dim": 8,
        "in_channels": 4,
        "out_channels": 4,
        "text_dim": 8,
        "freq_dim": 8,
        "ffn_dim": 16,
        "num_layers": 1,
        "rope_max_seq_len": 32,
    }
    model = WanTransformer3DModel(**config)
    state = {key: value.contiguous() for key, value in model.state_dict().items()}
    weight = state["patch_embedding.weight"]
    state["patch_embedding.weight"] = torch.cat(
        [weight, torch.randn(weight.shape[0], CONTROL_CHANNELS, *weight.shape[2:])], dim=1
    )
    directory.mkdir()
    save_file(state, str(directory / filename))
    (directory / "config.json").write_text(
        json.dumps({"_class_name": "WanTransformer3DModel", **config}), encoding="utf-8"
    )
    return state


@pytest.mark.parametrize("filename", ["model.safetensors", "diffusion_pytorch_model.safetensors"])
def test_widened_dit_loads_under_either_filename(tmp_path, filename):
    directory = tmp_path / "dit"
    state = _write_tiny_widened_dit(directory, filename)
    adapter = Wan22DiffusersAdapter({"pretrained_dir": str(tmp_path)})

    model = adapter._load_component("transformer", directory, dtype=None)

    assert model.patch_embedding.in_channels == 4 + CONTROL_CHANNELS
    assert torch.equal(model.patch_embedding.weight, state["patch_embedding.weight"])
    # Exercise patchify itself: the original failure was a channel mismatch here.
    patches = model.patch_embedding(torch.randn(1, 4 + CONTROL_CHANNELS, 1, 4, 4))
    assert patches.shape == (1, 16, 1, 2, 2)


def test_dit_directory_without_weights_names_both_filenames(tmp_path):
    directory = tmp_path / "dit"
    directory.mkdir()
    (directory / "config.json").write_text("{}", encoding="utf-8")
    adapter = Wan22DiffusersAdapter({"pretrained_dir": str(tmp_path)})

    with pytest.raises(FileNotFoundError, match="model.safetensors"):
        adapter._load_component("transformer", directory, dtype=None)
