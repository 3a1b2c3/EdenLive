"""Tests for forge/validate_run_meta.py: a passing fixture + failing mutations."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "forge"))

from validate_run_meta import validate_meta  # noqa: E402

VALID = {
    "scene_manifest": "scene-manifest.json",
    "control_scheme": "third_person_chase",
    "player_modality": "avatar",
    "core_verb": "run and jump",
    "modules": ["/assets/user-interface/PrototypeShell.js"],
    "controls": ["WASD move", "Space jump"],
    "gate": "input does what the player intends",
    "out_of_scope": ["win condition", "lose condition"],
    "brief": "brief.json",
    "signature_actions": [{"id": "jump", "brief_refs": ["/core_verb"], "action": "Run and jump",
                           "success_checks": [], "boundary": {"checks": []}, "feedback": ""}],
}


def test_valid_card_has_no_errors():
    assert validate_meta(VALID) == []


def test_plate_tilt_is_an_accepted_scheme():
    assert validate_meta({**VALID, "control_scheme": "plate_tilt"}) == []


def test_unknown_control_scheme_fails():
    errors = validate_meta({**VALID, "control_scheme": "not_a_scheme"})
    assert len(errors) == 1
    assert "not_a_scheme" in errors[0].message


def test_missing_required_key_fails():
    errors = validate_meta({"control_scheme": "snake", "player_modality": "avatar"})
    assert errors, "missing core_verb / modules / controls must fail"


def test_unknown_top_level_key_fails():
    errors = validate_meta({**VALID, "typo_key": True})
    assert errors, "additionalProperties: false must reject an unknown key"
