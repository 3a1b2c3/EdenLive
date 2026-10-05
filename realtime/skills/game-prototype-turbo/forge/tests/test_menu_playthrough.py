"""Browser coverage for an untimed menu/board game.

The shared gates must support a discrete choice game without inventing a clock or
pretending that a changing label proves input. The fixture uses the same real
keyboard actions and terminal round contract as continuous prototypes; it is written
from `gate_fixtures` rather than checked in, so no example game ships with the skill.
"""

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "forge"))

import check_step2  # noqa: E402
import check_rounds  # noqa: E402
import check_step3  # noqa: E402
from gate_fixtures import MENU_CLOSURE_STRATEGY, MENU_GAME, MENU_STRATEGY, fixture_run  # noqa: E402

pytestmark = pytest.mark.slow


def test_menu_board_supports_real_selection_and_replay(tmp_path) -> None:
    with fixture_run("menu-play", run_name="menu-board") as (runs_dir, run):
        runs_rel = runs_dir.relative_to(ROOT).as_posix()
        assert check_rounds.main([str(run.relative_to(ROOT))]) == 0
        assert check_step2.main(
            ["--runs", runs_rel, "--only", "menu-board", "--output", ""]
        ) == 0

        strategy = tmp_path / "menu-board.json"
        strategy.write_text(json.dumps(MENU_STRATEGY), encoding="utf-8")
        output = tmp_path / "menu-evidence"
        assert check_step3.main(
            [
                "--runs",
                runs_rel,
                "--only",
                "menu-board",
                "--strategy",
                str(strategy),
                "--output",
                str(output),
                "--wall-seconds",
                "12",
            ]
        ) == 0
    report = json.loads((output / "report.json").read_text(encoding="utf-8"))
    assert report["functional"]["status"] == "passed"
    assert [scenario["status"] for scenario in report["scenarios"]] == [
        "passed",
        "passed",
        "passed",
    ]
    assert report["validationBudget"]["seconds"] == 30
    assert report["validationBudget"]["source"].endswith("brief.json")
    assert [s['terminal']['elapsed'] for s in report['scenarios']] == [0, 0, 0]
    assert len({s['terminal']['roundId'] for s in report['scenarios']}) == 3


def test_closure_scope_proves_terminal_restart_and_a_fresh_playable_round(tmp_path) -> None:
    """Behaviour's closure check drives the same executor over a smaller scope.

    It must reach one terminal outcome, restart for real, and show the new round
    still accepting input -- and must say plainly that it is not full acceptance.
    """
    with fixture_run("menu-closure", run_name="menu-board") as (runs_dir, _):
        strategy = tmp_path / "closure.json"
        strategy.write_text(json.dumps(MENU_CLOSURE_STRATEGY), encoding="utf-8")
        output = tmp_path / "closure-evidence"
        assert check_step3.main([
            "--scope", "closure",
            "--runs", runs_dir.relative_to(ROOT).as_posix(),
            "--only", "menu-board",
            "--strategy", str(strategy),
            "--output", str(output),
            "--wall-seconds", "12",
        ]) == 0
    report = json.loads((output / "report.json").read_text(encoding="utf-8"))
    assert report["functional"]["status"] == "passed"
    assert report["scope"]["id"] == "closure"
    assert "not evaluated here" in report["scope"]["proves"]
    assert [s["status"] for s in report["scenarios"]] == ["passed", "passed"]
    assert [s["expected"] for s in report["scenarios"]] == ["WON", "RUNNING"]
    # The restart must produce a genuinely new round that is still running.
    assert len({s["terminal"]["roundId"] for s in report["scenarios"]}) == 2
    assert report["scenarios"][1]["terminal"]["state"] == "RUNNING"
    assert report["scenarios"][1]["terminal"]["terminalCount"] == 0
    assert report["scenarios"][1]["interactions"], "the fresh round must accept real input"


def test_closure_scope_rejects_a_restart_that_does_not_stay_playable(tmp_path) -> None:
    """A restarted round that never accepts input must fail closure, not pass quietly."""
    with fixture_run("menu-closure-idle", run_name="menu-board") as (runs_dir, _):
        idle = {**MENU_CLOSURE_STRATEGY,
                "scenarios": [MENU_CLOSURE_STRATEGY["scenarios"][0],
                              {"expect": "RUNNING", "rules": []}]}
        strategy = tmp_path / "idle.json"
        strategy.write_text(json.dumps(idle), encoding="utf-8")
        output = tmp_path / "idle-evidence"
        assert check_step3.main([
            "--scope", "closure",
            "--runs", runs_dir.relative_to(ROOT).as_posix(),
            "--only", "menu-board",
            "--strategy", str(strategy),
            "--output", str(output),
            "--wall-seconds", "8",
        ]) == 1
    report = json.loads((output / "report.json").read_text(encoding="utf-8"))
    assert report["functional"]["status"] == "failed"
    assert "requires actual input" in report["scenarios"][1]["reason"]


def test_closure_ignores_interaction_emitted_by_restart_itself(tmp_path) -> None:
    """A reset-side event cannot stand in for play in the restarted round."""
    broken = MENU_GAME["main.js"]
    broken = broken.replace(
        "    events = [];\n    roundId += 1;",
        "    events = [];\n    roundId += 1;\n    events.push({ id: 1000 + roundId, type: 'menu.moved', index: 0 });",
    )
    assert broken != MENU_GAME["main.js"]
    idle = {**MENU_CLOSURE_STRATEGY,
            "scenarios": [MENU_CLOSURE_STRATEGY["scenarios"][0],
                          {"expect": "RUNNING", "rules": []}]}
    strategy = tmp_path / "restart-event.json"
    strategy.write_text(json.dumps(idle), encoding="utf-8")
    output = tmp_path / "restart-event-evidence"
    with fixture_run("menu-closure-restart-event", run_name="menu-board", **{"main.js": broken}) as (runs_dir, _):
        assert check_step3.main([
            "--scope", "closure", "--runs", runs_dir.relative_to(ROOT).as_posix(),
            "--only", "menu-board", "--strategy", str(strategy), "--output", str(output),
            "--wall-seconds", "8",
        ]) == 1
    report = json.loads((output / "report.json").read_text(encoding="utf-8"))
    assert report["functional"]["status"] == "failed"
    assert "requires actual input" in report["scenarios"][1]["reason"]


def test_closure_ignores_events_retained_from_the_previous_round(tmp_path) -> None:
    """An event ring that survives reset cannot certify fresh play."""
    broken = MENU_GAME["main.js"].replace(
        "    events = [];\n    roundId += 1;",
        "    roundId += 1;",
    )
    assert broken != MENU_GAME["main.js"]
    idle = {**MENU_CLOSURE_STRATEGY,
            "scenarios": [MENU_CLOSURE_STRATEGY["scenarios"][0],
                          {"expect": "RUNNING", "rules": []}]}
    strategy = tmp_path / "retained-event.json"
    strategy.write_text(json.dumps(idle), encoding="utf-8")
    output = tmp_path / "retained-event-evidence"
    with fixture_run("menu-closure-retained-event", run_name="menu-board", **{"main.js": broken}) as (runs_dir, _):
        assert check_step3.main([
            "--scope", "closure", "--runs", runs_dir.relative_to(ROOT).as_posix(),
            "--only", "menu-board", "--strategy", str(strategy), "--output", str(output),
            "--wall-seconds", "8",
        ]) == 1
    report = json.loads((output / "report.json").read_text(encoding="utf-8"))
    assert report["functional"]["status"] == "failed"
    assert "requires actual input" in report["scenarios"][1]["reason"]


def test_acceptance_strategy_is_rejected_at_closure_scope(tmp_path) -> None:
    """The scopes are not interchangeable: each stage's sequence is validated for it."""
    strategy = tmp_path / "acceptance.json"
    strategy.write_text(json.dumps(MENU_STRATEGY), encoding="utf-8")
    assert check_step3.main(["--validate-only", "--scope", "closure", "--strategy", str(strategy)]) == 1
    assert check_step3.main(["--validate-only", "--strategy", str(strategy)]) == 0


def test_closure_rejects_retained_terminal_events_even_with_fresh_input(tmp_path) -> None:
    """Fresh gameplay cannot hide a previous round's uncleared terminal event."""
    broken = MENU_GAME["main.js"].replace(
        "    events = [];\n    roundId += 1;",
        "    events = events.filter((event) => event.type === 'round.won');\n    roundId += 1;",
    )
    assert broken != MENU_GAME["main.js"]
    strategy = tmp_path / "retained-terminal.json"
    strategy.write_text(json.dumps(MENU_CLOSURE_STRATEGY), encoding="utf-8")
    output = tmp_path / "retained-terminal-evidence"
    with fixture_run("menu-closure-retained-terminal", run_name="menu-board", **{"main.js": broken}) as (runs_dir, _):
        assert check_step3.main([
            "--scope", "closure", "--runs", runs_dir.relative_to(ROOT).as_posix(),
            "--only", "menu-board", "--strategy", str(strategy), "--output", str(output),
            "--wall-seconds", "8",
        ]) == 1
    report = json.loads((output / "report.json").read_text(encoding="utf-8"))
    restarted = report["scenarios"][1]
    assert report["functional"]["status"] == "failed"
    assert restarted["interactions"], "the test must prove fresh input independently of reset"
    assert restarted["terminal"]["state"] == "RUNNING"
    assert "retained a terminal event" in restarted["reason"]


def test_closure_rechecks_terminal_count_after_settling(tmp_path, monkeypatch) -> None:
    """Inject a late counter change at the settle observation without a timer race."""
    read_snapshot = check_step3.snapshot

    def snapshot_with_late_terminal_count(page, evidence=None):
        value = read_snapshot(page, evidence)
        if (evidence is not None and evidence["expected"] == "RUNNING"
                and "terminal" in evidence and "afterTerminal" not in evidence):
            value = {**value, "terminalCount": 1}
            evidence["lastObservation"] = value
        return value

    monkeypatch.setattr(check_step3, "snapshot", snapshot_with_late_terminal_count)
    strategy = tmp_path / "late-terminal-count.json"
    strategy.write_text(json.dumps(MENU_CLOSURE_STRATEGY), encoding="utf-8")
    output = tmp_path / "late-terminal-count-evidence"
    with fixture_run("menu-closure-late-terminal-count", run_name="menu-board") as (runs_dir, _):
        assert check_step3.main([
            "--scope", "closure", "--runs", runs_dir.relative_to(ROOT).as_posix(),
            "--only", "menu-board", "--strategy", str(strategy), "--output", str(output),
            "--wall-seconds", "8",
        ]) == 1
    report = json.loads((output / "report.json").read_text(encoding="utf-8"))
    restarted = report["scenarios"][1]
    assert restarted["terminal"]["terminalCount"] == 0
    assert restarted["afterTerminal"]["terminalCount"] == 1
    assert restarted["afterTerminal"]["state"] == "RUNNING"
    assert "already recorded a terminal event" in restarted["reason"]
    assert report["functional"]["status"] == "failed"


def test_menu_board_disconnected_move_fails_behavior() -> None:
    """A keyboard event that never reaches menu state must not pass by label motion."""
    broken = MENU_GAME["main.js"].replace("parts.move(1);", "void 0;")
    assert broken != MENU_GAME["main.js"], "the disconnected-input mutation no longer applies"
    with fixture_run("menu-disconnected", run_name="broken", **{"main.js": broken}) as (runs_dir, _):
        assert check_step2.main(
            ["--runs", runs_dir.relative_to(ROOT).as_posix(), "--only", "broken", "--output", ""]
        ) == 1


def test_behavior_rejects_missing_input_cases(capsys) -> None:
    card = json.loads(MENU_GAME["step3.json"])
    del card["input_checks"]
    with fixture_run("menu-boot", run_name="boot", **{"step3.json": json.dumps(card)}) as (runs_dir, _):
        args = ["--runs", runs_dir.relative_to(ROOT).as_posix(), "--only", "boot", "--output", ""]
        assert check_step2.main(args) == 1
        assert 'unknown input check' in capsys.readouterr().err


@pytest.mark.parametrize("failure_at", ["early_start", "late_start", "replay"])
def test_acceptance_rejects_caught_fatal_errors(tmp_path, failure_at):
    failure = "deliberate caught acceptance failure"
    broken = MENU_GAME["main.js"]
    if failure_at == "early_start":
        broken = broken.replace("export async function start() {", f"export async function start() {{ throw new Error('{failure}');")
    elif failure_at == "late_start":
        # Input, observations and RAF already exist when the template catches this error.
        broken = broken.rstrip().removesuffix("}") + f"  throw new Error('{failure}');\n}}\n"
    else:
        # A caught runtime error appears only after the third scenario terminates.
        broken = broken.replace("    renderMenu();", f"""    renderMenu();
    if (roundId === 3 && parts.director.state === 'WON') {{
      const fatal = document.getElementById('fatal');
      fatal.hidden = false; fatal.style.display = 'block'; fatal.textContent = '{failure}';
    }}""")
    assert broken != MENU_GAME["main.js"]
    strategy = tmp_path / "strategy.json"
    strategy.write_text(json.dumps(MENU_STRATEGY))
    output = tmp_path / "evidence"
    with fixture_run("caught-fatal", run_name="broken", **{"main.js": broken}) as (runs_dir, _):
        assert check_step3.main([
            "--runs", runs_dir.relative_to(ROOT).as_posix(), "--only", "broken",
            "--strategy", str(strategy), "--output", str(output), "--wall-seconds", "12",
        ]) == 1
    report = json.loads((output / "report.json").read_text())
    assert report["functional"]["status"] == "failed"
    assert failure in json.dumps(report)
    if failure_at == "replay":
        assert [scenario["status"] for scenario in report["scenarios"]] == ["passed"] * 3
