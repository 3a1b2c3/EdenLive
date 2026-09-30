"""Component directories resolve from config, not from a Diffusers snapshot.

The adapter used to load the whole pipeline with one
``DiffusionPipeline.from_pretrained(model_id)``, which meant swapping the DiT for a
different one required faking a complete released snapshot -- ``model_index.json``
included. Components now load one directory at a time so only the DiT's own path
changes. These tests pin that resolution and its failure modes without touching
diffusers or any weights.
"""

from __future__ import annotations

import pytest

from eden.models.adapters.wan22_diffusers.adapter import Wan22DiffusersAdapter

COMPONENTS = ("tokenizer", "text_encoder", "vae", "scheduler", "transformer")


def _tree(root, names=COMPONENTS):
    """Create the component subdirectories a resolvable tree needs."""

    for name in names:
        (root / name).mkdir(parents=True, exist_ok=True)
    return root


def test_components_default_to_subdirectories_of_pretrained_dir(tmp_path):
    root = _tree(tmp_path / "weights")
    model = Wan22DiffusersAdapter({"pretrained_dir": str(root)})

    dirs = model._resolve_component_dirs(COMPONENTS)

    assert dirs == {name: root / name for name in COMPONENTS}


def test_component_path_override_wins_over_pretrained_dir(tmp_path):
    root = _tree(tmp_path / "weights")
    our_dit = tmp_path / "our-dit"
    our_dit.mkdir()
    model = Wan22DiffusersAdapter(
        {"pretrained_dir": str(root), "components": {"transformer": {"path": str(our_dit)}}}
    )

    dirs = model._resolve_component_dirs(COMPONENTS)

    assert dirs["transformer"] == our_dit
    # Everything else still comes from the shared tree.
    assert dirs["vae"] == root / "vae"


def test_missing_required_component_names_itself(tmp_path):
    root = _tree(tmp_path / "weights", [n for n in COMPONENTS if n != "vae"])
    model = Wan22DiffusersAdapter({"pretrained_dir": str(root)})

    with pytest.raises(FileNotFoundError) as excinfo:
        model._resolve_component_dirs(COMPONENTS)

    message = str(excinfo.value)
    assert "model.components.vae" in message
    assert str(root / "vae") in message


def test_missing_optional_component_is_simply_absent(tmp_path):
    # A single-expert checkpoint ships no transformer_2, and a T2V tree no CLIP tower.
    root = _tree(tmp_path / "weights")
    model = Wan22DiffusersAdapter({"pretrained_dir": str(root)})

    dirs = model._resolve_component_dirs(COMPONENTS + ("transformer_2", "image_encoder"))

    assert "transformer_2" not in dirs
    assert "image_encoder" not in dirs
    assert set(dirs) == set(COMPONENTS)


def test_pretrained_dir_is_required_when_no_override_covers_the_component(tmp_path):
    model = Wan22DiffusersAdapter({"components": {"transformer": {"path": str(tmp_path)}}})

    # The overridden component resolves without a root ...
    assert model._component_dir("transformer") == tmp_path
    # ... but anything not overridden has nowhere to come from.
    with pytest.raises(ValueError, match="model.pretrained_dir is required"):
        model._component_dir("vae")


def test_pipeline_class_must_be_one_of_the_two_wan_pipelines(tmp_path):
    model = Wan22DiffusersAdapter({"pretrained_dir": str(tmp_path), "pipeline_class": "SDXLPipeline"})

    with pytest.raises(ValueError, match="model.pipeline_class must be one of"):
        model._pipeline_class()
