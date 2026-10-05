"""Tests for forge/validate_game_brief.py: one passing fixture + failing mutations.

Contract (README/CLAUDE.md): gates cover behavior and supplied briefs validate.
Run from the repo root with:
    make test-py            # or: python -m pytest forge/tests/ -q
"""

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = REPO_ROOT / "forge" / "validate_game_brief.py"
REFERENCE_DIR = REPO_ROOT / "assets" / "game-briefs"
SCHEMA_PATH = REPO_ROOT / "docs" / "specs" / "game-brief.schema.json"


def load_schema() -> dict:
    """Read the brief schema directly so field expectations track the published contract."""
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def minimal_brief() -> dict:
    """A minimal but fully valid game brief (self-contained fixture, no external file)."""
    return {
        "ui": {"mode": "polish"},
        "title": "Placeholder Run",
        "core_verb": "Move and jump toward the goal while avoiding hazards.",
        "fantasy": "A minimal greybox run.",
        "control_scheme": "third_person_chase",
        "player_modality": "avatar",
        "fail_state": "You fall off the platform.",
        "win_state": "Reach the goal marker.",
        "interaction_tags": [
            {"id": "hazard", "role": "hazard", "meaning": "Hurts on contact."},
            {"id": "coin", "role": "resource", "meaning": "Collectible."},
            {"id": "goal_marker", "role": "goal", "meaning": "Reach to win."},
        ],
        "time_budget_seconds": 120,
        "context": {
            "distilled_prompt": "A straight run to the goal.",
            "twists": [],
            "assumptions": [],
            "open_questions": [],
        },
        "scene": {"theme_elements": [{"id":"board","label":"Board","role":"board"}],
            "description": (
                "A minimal greybox platform strip in an empty void, with platforms to cross "
                "and a goal marker at the far end. Sparse: nothing but the platforms."
            ),
        },
    }


def run_validator(path: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(VALIDATOR), str(path)],
        capture_output=True,
        text=True,
    )


def test_valid_brief_passes(tmp_path) -> None:
    good = tmp_path / "good.brief.json"
    good.write_text(json.dumps(minimal_brief()), encoding="utf-8")
    result = run_validator(good)
    assert result.returncode == 0, result.stderr


def test_invalid_brief_fails_loud(tmp_path) -> None:
    brief = minimal_brief()
    del brief["win_state"]  # failing mutation: required field removed
    bad = tmp_path / "bad.brief.json"
    bad.write_text(json.dumps(brief), encoding="utf-8")
    result = run_validator(bad)
    assert result.returncode == 1, result.stderr
    assert "win_state" in result.stderr  # reason printed, not silent


def test_scene_needs_its_description(tmp_path) -> None:
    brief = minimal_brief()
    brief["scene"] = {}  # failing mutation: prose dropped
    bad = tmp_path / "bare-scene.brief.json"
    bad.write_text(json.dumps(brief), encoding="utf-8")
    result = run_validator(bad)
    assert result.returncode == 1, result.stderr
    assert "description" in result.stderr


def test_scene_rejects_unknown_construction_fields(tmp_path) -> None:
    """Scene construction details belong in the implementation, not extra brief fields."""
    brief = minimal_brief()
    brief["scene"]["topology"] = "linear-corridor"  # failing mutation: decision back in the brief
    bad = tmp_path / "over-specified.brief.json"
    bad.write_text(json.dumps(brief), encoding="utf-8")
    result = run_validator(bad)
    assert result.returncode == 1, result.stderr
    assert "topology" in result.stderr


@pytest.mark.parametrize("elements", [None, 42, [], [
    {"id": "board", "label": "Board", "role": "board"},
    {"id": "board", "label": "Another board", "role": "board"},
]])
def test_invalid_theme_inventory_reports_validation_errors(tmp_path, elements) -> None:
    brief = minimal_brief()
    brief["scene"]["theme_elements"] = elements
    bad = tmp_path / "invalid-inventory.brief.json"
    bad.write_text(json.dumps(brief), encoding="utf-8")
    result = run_validator(bad)
    assert result.returncode == 1, result.stderr
    assert "scene.theme_elements" in result.stderr
    assert "Traceback" not in result.stderr


def test_missing_file_is_usage_error() -> None:
    result = run_validator(REPO_ROOT / "nope.brief.json")
    assert result.returncode == 2


def test_starter_lists_every_required_field_with_blank_semantics() -> None:
    """The skeleton must show what to author, and never pretend to have authored it."""
    result = subprocess.run(
        [sys.executable, str(VALIDATOR), "--starter"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    starter = json.loads(result.stdout)
    required = set(load_schema()["required"])
    assert required <= starter.keys(), required - starter.keys()
    # Defaults are safe only where a value carries no meaning about this game.
    assert starter["control_scheme"] == "custom"
    assert starter["time_budget_seconds"] == 120
    assert starter["ui"] == {"mode": "polish"}
    for field in ("title", "core_verb", "fantasy", "player_modality", "fail_state", "win_state"):
        assert starter[field] == "", field
    assert starter["scene"]["description"] == ""
    assert all(not value for value in starter["scene"]["theme_elements"][0].values())


def test_starter_output_creates_a_file_and_never_overwrites(tmp_path) -> None:
    target = tmp_path / "new.brief.json"
    command = [sys.executable, str(VALIDATOR), "--starter", "--output", str(target)]
    assert subprocess.run(command, capture_output=True, text=True).returncode == 0
    assert json.loads(target.read_text(encoding="utf-8"))["control_scheme"] == "custom"

    target.write_text("authored by hand", encoding="utf-8")
    result = subprocess.run(command, capture_output=True, text=True)
    assert result.returncode == 2
    assert target.read_text(encoding="utf-8") == "authored by hand"
    assert "error:" in result.stderr


def test_starter_help_lists_the_control_and_modality_enums() -> None:
    result = subprocess.run(
        [sys.executable, str(VALIDATOR), "--help"], capture_output=True, text=True,
    )
    assert result.returncode == 0
    schema = load_schema()
    for name in ("control_scheme", "player_modality"):
        for value in schema["properties"][name]["enum"]:
            assert value in result.stdout, (name, value)


def _load_validator_module():
    """Import forge/validate_game_brief.py in-process.

    The reference-brief loop validates every brief in assets/game-briefs/; doing that via
    ``run_validator`` spawns one Python subprocess per brief (each paying interpreter and
    jsonschema startup), which is most of the suite's wall time. Loading the script once and
    calling its own ``validate_brief`` keeps the same authority in the same code, in-process.
    """
    spec = importlib.util.spec_from_file_location("validate_game_brief", VALIDATOR)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_every_reference_brief_validates() -> None:
    mod = _load_validator_module()
    refs = sorted(REFERENCE_DIR.glob("*.brief.json"))
    assert refs, "no reference briefs found"
    for ref in refs:
        brief = json.loads(ref.read_text(encoding="utf-8"))
        errors = mod.validate_brief(brief)
        assert not errors, f"{ref.name}: {errors[0].message}"
