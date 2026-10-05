"""Tests for the .state.json gate: forge/validate.py and forge/next.py."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

from _shared.state import state_errors

REPO_ROOT = Path(__file__).resolve().parents[2]
VALIDATE = REPO_ROOT / "forge" / "validate.py"
NEXT = REPO_ROOT / "forge" / "next.py"

_STAGE_IDS = ("intake", "scene", "behavior", "acceptance")


def minimal_state(**overrides) -> dict:
    state = {
        "current_stage": "intake",
        "stages": {
            stage: {"status": "not_started", "evidence": [], "loop_count": 0}
            for stage in _STAGE_IDS
        },
    }
    state.update(overrides)
    return state


def reviewed_assessments(evidence="review report") -> dict:
    return {
        "functional": {"status": "passed", "evidence": [evidence]},
        "experience": {"status": "passed", "evidence": [evidence]},
        "performance": {"status": "not_evaluated", "evidence": [],
                        "reason": "No performance target for this fixture."},
    }


def progressed_state(current_stage) -> dict:
    state = minimal_state(current_stage=current_stage)
    count = len(_STAGE_IDS) if current_stage == "done" else _STAGE_IDS.index(current_stage)
    for stage in _STAGE_IDS[:count]:
        state["stages"][stage].update(status="passed", evidence=[f"{stage} report"],
                                      artifact="brief.json" if stage == "intake" else f"runs/{stage}")
        if stage != "intake":
            state["stages"][stage]["assessments"] = reviewed_assessments(f"{stage} report")
    return state


def run(script: Path, path: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(script), str(path)], capture_output=True, text=True
    )


def write(tmp_path, state: dict, name: str = "state.json") -> Path:
    path = tmp_path / name
    path.write_text(json.dumps(state), encoding="utf-8")
    return path


def test_validate_malformed_shapes_fail_without_traceback(tmp_path) -> None:
    for state in ([], None, {}, {"stages": []}, minimal_state(stages={"intake": None})):
        for script in (VALIDATE, NEXT):
            result = run(script, write(tmp_path, state))
            assert result.returncode == 1
            assert result.stderr
            assert "Traceback" not in result.stderr


def test_validate_accepts_valid_state(tmp_path) -> None:
    result = run(VALIDATE, write(tmp_path, minimal_state()))
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize("stage", _STAGE_IDS[1:])
def test_passed_gameplay_stages_require_assessments(stage):
    state = progressed_state("done")
    assert not state_errors(state)
    del state["stages"][stage]["assessments"]
    errors = state_errors(state)
    assert len(errors) == 1 and f"stages.{stage}" in errors[0] and "assessments" in errors[0]


def test_partial_assessments_do_not_count_as_a_complete_review():
    state = progressed_state("behavior")
    del state["stages"]["scene"]["assessments"]["experience"]
    assert any("experience" in error for error in state_errors(state))


def test_validate_rejects_passed_without_evidence(tmp_path) -> None:
    state = minimal_state()
    state["stages"]["intake"]["status"] = "passed"
    result = run(VALIDATE, write(tmp_path, state))
    assert result.returncode == 1
    assert "evidence" in result.stderr


def test_validate_rejects_skipped_without_reason(tmp_path) -> None:
    state = minimal_state()
    state["stages"]["intake"]["status"] = "skipped"
    result = run(VALIDATE, write(tmp_path, state))
    assert result.returncode == 1
    assert "skipped" in result.stderr


def test_validate_rejects_loop_count_over_cap(tmp_path) -> None:
    state = minimal_state()
    state["stages"]["behavior"]["loop_count"] = 4
    result = run(VALIDATE, write(tmp_path, state))
    assert result.returncode == 1
    assert "loop_count" in result.stderr


def test_next_reports_first_stage(tmp_path) -> None:
    result = run(NEXT, write(tmp_path, minimal_state()))
    assert result.returncode == 0
    assert "intake" in result.stdout
    assert "not started" in result.stdout


def test_next_advances_past_passed_stage(tmp_path) -> None:
    state = minimal_state()
    state["stages"]["intake"] = {"status": "passed", "evidence": ["brief.json"],
                                  "artifact": "brief.json", "loop_count": 0}
    result = run(NEXT, write(tmp_path, state))
    assert result.returncode == 0
    assert "scene" in result.stdout


def test_next_stops_at_loop_cap(tmp_path) -> None:
    state = progressed_state("behavior")
    state["stages"]["behavior"] = {"status": "in_progress", "evidence": [], "loop_count": 3}
    result = run(NEXT, write(tmp_path, state))
    assert result.returncode == 3


def test_next_reports_done(tmp_path) -> None:
    state = progressed_state("done")
    result = run(NEXT, write(tmp_path, state))
    assert result.returncode == 0
    assert "complete" in result.stdout.lower()


@pytest.mark.parametrize("script", [VALIDATE, NEXT])
@pytest.mark.parametrize("current", ["scene", "done"])
def test_unfinished_prerequisites_cannot_be_bypassed(tmp_path, script, current):
    result = run(script, write(tmp_path, minimal_state(current_stage=current)))
    assert result.returncode == 1
    assert "intake" in result.stderr
    assert "complete" not in result.stdout.lower()


@pytest.mark.parametrize("script", [VALIDATE, NEXT])
def test_done_rejects_a_single_unfinished_stage(tmp_path, script):
    state = progressed_state("done")
    state["stages"]["acceptance"].update(status="in_progress", evidence=[])
    result = run(script, write(tmp_path, state))
    assert result.returncode == 1
    assert "acceptance" in result.stderr


@pytest.mark.parametrize("status", ["in_progress", "passed"])
def test_later_progress_cannot_hide_behind_an_earlier_current_stage(tmp_path, status):
    state = minimal_state()
    state["stages"]["scene"].update(status=status, evidence=["scene report"])
    result = run(VALIDATE, write(tmp_path, state))
    assert result.returncode == 1
    assert "intake" in result.stderr


def test_done_rejects_stage_skips(tmp_path):
    state = progressed_state("done")
    state["stages"]["behavior"].update(status="skipped")
    result = run(NEXT, write(tmp_path, state))
    assert result.returncode == 1
    assert "skipped" in result.stderr


def test_next_reports_the_stage_gate(tmp_path) -> None:
    """A stage that names its prompt but not its gate leaves the reader to guess."""
    state = progressed_state("behavior")
    result = run(NEXT, write(tmp_path, state))
    assert result.returncode == 0
    assert "check_step2.py" in result.stdout


def test_next_reports_acceptance_browser_gate(tmp_path) -> None:
    """Acceptance points at its implemented browser gate."""
    state = progressed_state("acceptance")
    result = run(NEXT, write(tmp_path, state))
    assert result.returncode == 0
    assert "check_step3.py" in result.stdout


def test_every_stage_has_a_gate_entry() -> None:
    """A stage missing from STAGE_GATES would silently print nothing about verification."""
    sys.path.insert(0, str(REPO_ROOT / "forge"))
    from _shared.constants import STAGES, STAGE_GATES  # noqa: PLC0415

    assert set(STAGE_GATES) == set(STAGES)


def test_gate_commands_reference_scripts_that_exist() -> None:
    """A gate command naming a script that is not there is worse than no gate line."""
    sys.path.insert(0, str(REPO_ROOT / "forge"))
    from _shared.constants import STAGE_GATES  # noqa: PLC0415

    for stage, commands in STAGE_GATES.items():
        for command in commands:
            script = next(part for part in command.split() if part.endswith(".py"))
            assert (REPO_ROOT / script).is_file(), f"{stage}: {script} does not exist"
