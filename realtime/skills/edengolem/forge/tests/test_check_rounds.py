"""Tests for forge/check_rounds.py (the optional deterministic round diagnostic).

The point of the checker is that it FAILS a round that breaks the gate, so the
load-bearing tests are the failing mutations: a round that never resolves, one
whose director re-announces its outcome every frame, and one whose outcome frame
depends on unseeded randomness. Each of those passes a casual look at a HUD.

These shell out to node, which is present wherever the JS suite runs.
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "forge"))

import check_rounds  # noqa: E402
from test_validate import minimal_brief

# Per-process, because the autouse cleanup rmtree's this whole tree: two suites running at once
# against one shared path delete each other's fixtures mid-run, and the checker then errors on tests
# that have nothing wrong with them.
FIXTURES = REPO_ROOT / "forge" / "tests" / ".fixtures" / f"_step2_test_fixtures_{os.getpid()}"

# A round that behaves: two-clause objective, a health pool, both scripts drive it.
GOOD_ROUND = """
import { ObjectiveTracker, OBJECTIVE_SHAPES } from '/assets/gameplay/ObjectiveTracker.js';
import { ResourcePool } from '/assets/gameplay/ResourcePool.js';
import { RoundClock } from '/assets/gameplay/RoundClock.js';
import { RoundDirector } from '/assets/gameplay/RoundDirector.js';

export function buildRound() {
  const objective = new ObjectiveTracker({
    shape: OBJECTIVE_SHAPES.DEPLETE_ALL,
    target: 3,
    then: { shape: OBJECTIVE_SHAPES.REACH, target: 1, label: 'exit' },
  });
  const health = new ResourcePool({ id: 'health', initial: 100, max: 100 });
  const director = new RoundDirector({
    objective,
    clock: new RoundClock({ limitSeconds: 60 }),
    resources: [health],
  });
  return { director, objective, resources: { health } };
}

export const SCRIPTS = {
  win: (frame, { objective }) => {
    if (frame > 0 && frame % 10 === 0 && objective.progress < 3) objective.advance(1);
    if (objective.awaitingSecondClause) objective.noteReached();
  },
  lose: (frame, { resources }) => {
    if (frame === 20) resources.health.lose(100);
  },
};
"""

# Never resolves: the quota is unreachable and nothing drives it.
STALLING_ROUND = """
import { ObjectiveTracker, OBJECTIVE_SHAPES } from '/assets/gameplay/ObjectiveTracker.js';
import { RoundDirector } from '/assets/gameplay/RoundDirector.js';

export function buildRound() {
  const objective = new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.QUOTA, target: 99999 });
  return { director: new RoundDirector({ objective }), objective, resources: {} };
}
export const SCRIPTS = { win: null, lose: null };
"""

# Re-announces the outcome on every frame: the bug assertion 2 exists for. A HUD
# fed by this looks correct; every replay assertion built on the stream is corrupt.
REPEATING_ROUND = """
export function buildRound() {
  const director = {
    state: 'RUNNING', outcomeReason: null, elapsedSeconds: 0, isResolved: false,
    start() {},
    step(delta) {
      this.elapsedSeconds += delta;
      if (this.elapsedSeconds < 0.5) return [];
      this.state = 'WON';
      this.outcomeReason = 'objectiveComplete';
      return [{ type: 'round.won', reason: 'objectiveComplete' }];
    },
  };
  return { director, objective: null, resources: {} };
}
export const SCRIPTS = { win: null, lose: null };
"""

# Resolves, latches, but on a different frame each run.
RANDOM_ROUND = """
import { ObjectiveTracker, OBJECTIVE_SHAPES } from '/assets/gameplay/ObjectiveTracker.js';
import { RoundDirector } from '/assets/gameplay/RoundDirector.js';

export function buildRound() {
  const objective = new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.QUOTA, target: 1 });
  return { director: new RoundDirector({ objective }), objective, resources: {} };
}
export const SCRIPTS = {
  win: (frame, { objective }) => { if (Math.random() < 0.02) objective.advance(1); },
  lose: null,
};
"""

# Wins but can never lose: assertion 4 catches the untested half.
UNLOSABLE_ROUND = """
import { ObjectiveTracker, OBJECTIVE_SHAPES } from '/assets/gameplay/ObjectiveTracker.js';
import { RoundDirector } from '/assets/gameplay/RoundDirector.js';

export function buildRound() {
  const objective = new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.QUOTA, target: 1 });
  return { director: new RoundDirector({ objective }), objective, resources: {} };
}
export const SCRIPTS = {
  win: (frame, { objective }) => { if (frame === 5) objective.advance(1); },
  lose: (frame, { objective }) => { if (frame === 5) objective.advance(1); },
};
"""

# The real-world trap assertion 5 exists for, reduced to its essentials: a finite
# population of 10 shared between "cleared" and "lost", an objective that demands all
# 10 cleared, and a lives pool that only ends the round at zero.
#
# Both the win and the lose script pass. The MIXED run cannot resolve: one leak makes
# the objective permanently unreachable (a lost unit can never be cleared) while 9
# remaining lives keep the round alive forever. Unwinnable and unloseable at once.
STRANDED_OBJECTIVE_ROUND = """
import { ObjectiveTracker, OBJECTIVE_SHAPES } from '/assets/gameplay/ObjectiveTracker.js';
import { ResourcePool, RESOURCE_DEPLETION_POLICIES } from '/assets/gameplay/ResourcePool.js';
import { RoundClock, CLOCK_EXPIRY_MEANINGS } from '/assets/gameplay/RoundClock.js';
import { RoundDirector } from '/assets/gameplay/RoundDirector.js';

export function buildRound() {
  const objective = new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.DEPLETE_ALL, target: 10 });
  const lives = new ResourcePool({
    id: 'lives',
    initial: 10,
    max: 10,
    depletionPolicy: RESOURCE_DEPLETION_POLICIES.END_ROUND,
  });
  const director = new RoundDirector({
    objective,
    // NEUTRAL: no timer backstop, so nothing else can end the round.
    clock: new RoundClock({ limitSeconds: 60, expiryMeaning: CLOCK_EXPIRY_MEANINGS.NEUTRAL }),
    resources: [lives],
  });
  return { director, objective, resources: { lives } };
}

export const SCRIPTS = {
  // Clears all ten: passes.
  win: (frame, { objective }) => {
    if (frame > 0 && frame % 10 === 0 && objective.progress < 10) objective.advance(1);
  },
  // Loses all ten lives: passes.
  lose: (frame, { resources }) => {
    if (frame > 0 && frame % 10 === 0) resources.lives.lose(1);
  },
  // Nine cleared, one leaked: the objective can never reach 10 and lives never reach
  // zero. This is the run that hangs.
  stall: (frame, { objective, resources }) => {
    if (frame === 10) resources.lives.lose(1);
    if (frame > 10 && frame % 10 === 0 && objective.progress < 9) objective.advance(1);
  },
};
"""

# The same shape, fixed the way tower-defense was: the objective counts units
# RESOLVED (cleared or lost) rather than units cleared, so a leak still advances it.
RESOLVABLE_MIXED_ROUND = STRANDED_OBJECTIVE_ROUND.replace(
    """  stall: (frame, { objective, resources }) => {
    if (frame === 10) resources.lives.lose(1);
    if (frame > 10 && frame % 10 === 0 && objective.progress < 9) objective.advance(1);
  },""",
    """  stall: (frame, { objective, resources }) => {
    if (frame === 10) resources.lives.lose(1);
    // The leaked unit still counts as resolved, so the objective completes.
    if (frame > 10 && frame % 10 === 0 && objective.progress < 10) objective.advance(1);
  },""",
)


def write_round(name: str, source: str) -> Path:
    runs = FIXTURES / name
    (runs / name).mkdir(parents=True, exist_ok=True)
    (runs / name / "round.mjs").write_text(source, encoding="utf-8")
    (runs / name / "brief.json").write_text(json.dumps(minimal_brief()), encoding="utf-8")
    (runs / name / "step2.json").write_text('{"brief":"brief.json"}', encoding="utf-8")
    return runs


def run_checker(runs_dir: Path, only: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            sys.executable,
            str(REPO_ROOT / "forge" / "check_rounds.py"),
            "--runs",
            str(runs_dir.relative_to(REPO_ROOT)),
            "--only",
            only,
        ],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )


def _node_or_skip() -> None:
    if not shutil.which("node"):
        pytest.skip("node is not available on this host")


@pytest.fixture(autouse=True)
def clean_fixtures():
    yield
    shutil.rmtree(FIXTURES, ignore_errors=True)


def test_help_exits_zero() -> None:
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "forge" / "check_rounds.py"), "--help"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0


def test_missing_round_is_an_error() -> None:
    runs = write_round("good", GOOD_ROUND)
    result = run_checker(runs, "nope")
    assert result.returncode == 2
    assert "no such round" in result.stderr


def test_no_rounds_at_all_is_an_error(tmp_path) -> None:
    empty = FIXTURES / "empty"
    empty.mkdir(parents=True, exist_ok=True)
    result = run_checker(empty, "")
    assert result.returncode == 2
    assert "no round modules found" in result.stderr


# --- positional run paths -------------------------------------------------------------------
#
# Explicit paths must check the requested artifact, including copies in another stage,
# so a diagnostic cannot accidentally report evidence for a different run.

def run_positional(*paths) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(REPO_ROOT / "forge" / "check_rounds.py"),
         *(str(Path(p).relative_to(REPO_ROOT)) if Path(p).is_absolute() else str(p)
           for p in paths)],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )


def test_a_run_path_can_be_given_positionally() -> None:
    _node_or_skip()
    runs = write_round("good", GOOD_ROUND)
    result = run_positional(runs / "good")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "1/1 passed" in result.stdout


def test_several_run_paths_are_all_checked() -> None:
    _node_or_skip()
    first = write_round("good", GOOD_ROUND)
    second = write_round("second", GOOD_ROUND)
    result = run_positional(first / "good", second / "second")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "2/2 passed" in result.stdout


def test_a_positional_path_without_a_round_is_an_error() -> None:
    missing = FIXTURES / "bare" / "bare"
    missing.mkdir(parents=True, exist_ok=True)
    result = run_positional(missing)
    assert result.returncode == 2
    assert "no round.mjs" in result.stderr


def test_a_positional_path_outside_the_project_root_is_refused() -> None:
    """The default project root remains the skill repository."""
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "forge" / "check_rounds.py"), "../../etc"],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    assert result.returncode == 2
    assert "inside the project root" in result.stderr


def test_positional_paths_and_only_cannot_be_mixed() -> None:
    """Two ways to select runs, silently disagreeing, is how the wrong set gets checked."""
    runs = write_round("good", GOOD_ROUND)
    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "forge" / "check_rounds.py"),
         str((runs / "good").relative_to(REPO_ROOT)), "--only", "good"],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    assert result.returncode == 2
    assert "not both" in result.stderr


def test_a_well_behaved_round_passes() -> None:
    _node_or_skip()
    runs = write_round("good", GOOD_ROUND)
    result = run_checker(runs, "good")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "1/1 passed" in result.stdout


def test_a_round_that_never_resolves_fails() -> None:
    _node_or_skip()
    runs = write_round("stalls", STALLING_ROUND)
    result = run_checker(runs, "stalls")
    assert result.returncode == 1, result.stdout
    assert "never resolved" in result.stderr


def test_a_round_that_reannounces_its_outcome_fails() -> None:
    """The load-bearing mutation: a HUD fed by this looks perfectly fine."""
    _node_or_skip()
    runs = write_round("repeats", REPEATING_ROUND)
    result = run_checker(runs, "repeats")
    assert result.returncode == 1, result.stdout
    assert "must latch and fire exactly once" in result.stderr
    # The summary must stay readable: thousands of events, not thousands of lines.
    assert len(result.stderr.splitlines()) < 30


def test_unseeded_randomness_breaks_replay_determinism() -> None:
    """Assertions 1, 2 and 4 stay green here; only the replay check catches it."""
    _node_or_skip()
    runs = write_round("random", RANDOM_ROUND)
    result = run_checker(runs, "random")
    assert result.returncode == 1, result.stdout
    assert "replay diverged" in result.stderr


def test_a_round_with_no_reachable_loss_fails() -> None:
    _node_or_skip()
    runs = write_round("unlosable", UNLOSABLE_ROUND)
    result = run_checker(runs, "unlosable")
    assert result.returncode == 1, result.stdout
    assert "not LOST" in result.stderr


def test_a_stranded_objective_fails_even_though_win_and_lose_both_pass() -> None:
    """Assertion 5's reason to exist.

    Assertions 1-4 are all green here: the win script wins, the lose script loses,
    each fires once, and the replay matches. The defect is only visible in the mixed
    run -- a round that can neither be won nor lost and sits in RUNNING forever.
    """
    _node_or_skip()
    runs = write_round("stranded", STRANDED_OBJECTIVE_ROUND)
    result = run_checker(runs, "stranded")
    assert result.returncode == 1, result.stdout
    assert "the stall script never resolved" in result.stderr
    # The message has to name the fix, not just the symptom.
    assert "neither be won nor lost" in result.stderr


def test_the_same_round_passes_once_the_objective_counts_resolved_units() -> None:
    """The mutation that proves assertion 5 tracks the real property.

    Identical round, identical scripts, one change: leaked units still advance the
    objective. That is exactly the fix applied to tower-defense.
    """
    _node_or_skip()
    runs = write_round("resolvable", RESOLVABLE_MIXED_ROUND)
    result = run_checker(runs, "resolvable")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "1/1 passed" in result.stdout


def test_a_round_without_a_stall_script_still_passes() -> None:
    """The assertion is opt-in: rounds ended by the scene must not be forced to
    declare one, or the gate reports noise for three of the reference rounds."""
    _node_or_skip()
    runs = write_round("good", GOOD_ROUND)
    result = run_checker(runs, "good")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "1/1 passed" in result.stdout


def test_a_declared_null_stall_runs_without_injected_input() -> None:
    _node_or_skip()
    runs = write_round("idle-expiry", GOOD_ROUND + "\nSCRIPTS.stall = null;\n")
    report, error = check_rounds.drive(runs / "idle-expiry", shutil.which("node"), 120)
    assert error is None
    assert report["hasStall"] is True
    assert report["stall"]["state"] == "LOST"
    problems, _ = check_rounds.check_round(report, 120)
    assert not problems


def test_an_unresolved_null_stall_is_not_silently_omitted() -> None:
    _node_or_skip()
    source = GOOD_ROUND.replace("clock: new RoundClock({ limitSeconds: 60 }),", "")
    runs = write_round("idle-unresolved", source + "\nSCRIPTS.stall = null;\n")
    result = run_checker(runs, "idle-unresolved")
    assert result.returncode == 1, result.stdout
    assert "the stall script never resolved" in result.stderr


def test_a_round_missing_the_contract_is_reported_clearly() -> None:
    _node_or_skip()
    runs = write_round("bare", "export const NOTHING = 1;\n")
    result = run_checker(runs, "bare")
    assert result.returncode == 1, result.stdout
    assert "buildRound" in result.stderr


def test_the_resolver_hook_lets_browser_imports_run_in_node() -> None:
    """A round imports /assets/... like the page does; Node needs the hook."""
    _node_or_skip()
    hook = REPO_ROOT / "forge" / "_shared" / "register_assets.mjs"
    assert hook.is_file()
    probe = (
        "import { ObjectiveTracker } from '/assets/gameplay/ObjectiveTracker.js';"
        "console.log(typeof ObjectiveTracker);"
    )
    result = subprocess.run(
        [
            "node",
            "--import",
            "./forge/_shared/register_assets.mjs",
            "--input-type=module",
            "-e",
            probe,
        ],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "function"
    # And without the hook it fails, which is why the hook exists.
    bare = subprocess.run(
        ["node", "--input-type=module", "-e", probe],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )
    assert bare.returncode != 0
    assert "ERR_MODULE_NOT_FOUND" in bare.stderr


def test_driver_reports_are_json_parsable() -> None:
    """The checker parses the driver's last stdout line; keep that contract."""
    _node_or_skip()
    runs = write_round("good", GOOD_ROUND)
    report, error = check_rounds.drive(runs / "good", shutil.which("node"), 120)
    assert error is None, error
    assert set(report) == {"win", "lose", "replay", "stall", "hasStall"}
    assert report["win"]["state"] == "WON"
    assert report["lose"]["state"] == "LOST"
    # GOOD_ROUND declares no stall script, so the optional slot is reported as absent
    # rather than omitted -- check_round distinguishes the two.
    assert report["hasStall"] is False
    assert report["stall"] is None
    assert json.dumps(report)  # round-trips


@pytest.mark.parametrize('budget', [240, 300])
def test_linked_brief_allows_longer_round_and_excludes_stability_ticks(budget):
    _node_or_skip()
    # No clock: domain actions at the boundary complete an untimed rules model.
    source = GOOD_ROUND.replace('clock: new RoundClock({ limitSeconds: 60 }),', '')
    source = source.replace('frame > 0 && frame % 10 === 0 && objective.progress < 3',
                            f'frame >= {budget * 60 - 3} && objective.progress < 3')
    runs = write_round('long', source)
    brief = minimal_brief()
    brief['time_budget_seconds'] = budget
    (runs / 'long' / 'brief.json').write_text(json.dumps(brief))
    (runs / 'long' / 'step2.json').write_text('{"brief":"brief.json"}')
    result = run_checker(runs, 'long')
    assert result.returncode == 0, result.stdout + result.stderr
    assert f'{budget}s:' in result.stdout and 'brief.json' in result.stdout
    # One second less cannot complete the same domain sequence.
    brief['time_budget_seconds'] -= 1
    (runs / 'long' / 'brief.json').write_text(json.dumps(brief))
    result = run_checker(runs, 'long')
    assert result.returncode == 1 and 'never resolved' in result.stderr


@pytest.mark.parametrize('mutation, reason', [
    ("event.type = 'round.lost'", 'disagrees'),
    ("event.reason = 'unrelated'", 'disagrees'),
    ("director.outcomeReason = ''", 'explanation'),
])
def test_terminal_events_must_agree_with_the_explained_outcome(mutation, reason):
    _node_or_skip()
    source = GOOD_ROUND.replace(
        'return { director, objective, resources: { health } };',
        '''const step = director.step.bind(director);
        director.step = dt => step(dt).map(event => {
          if (event.type === 'round.won') { ''' + mutation + '''; }
          return event;
        });
        return { director, objective, resources: { health } };''')
    result = run_checker(write_round('bad_event', source), 'bad_event')
    assert result.returncode == 1 and reason in result.stderr
