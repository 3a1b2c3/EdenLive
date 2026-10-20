"""Check deterministic round rules: budget, terminal latch, replay and both outcomes.

A run exports buildRound() and SCRIPTS {win, lose, stall?} in round.mjs. Scripts
supply domain actions before each fixed tick; use null for no input. The director
exposes step(dt), state, isResolved and outcomeReason, plus optional start().
See grimoire/review/round-contract.md. No browser or gameplay clock is required.
The allowance comes from the linked brief or an explicit override.
A stall script covers recoverable/stranded progress where applicable, not idle play.

Usage: python forge/check_rounds.py <run> --verbose
"""

import argparse
import json
import os
from _shared.paths import resolve_inside
from _shared.run_contract import validation_budget
from _shared.attempts import stage_snapshot, record_stage
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

FRAME_SECONDS = 1 / 60
# Frames to keep stepping after the round resolves, hunting a second terminal
# event. A re-announcing director fires on the very next frame, so this is
# generous rather than tuned.
OVERRUN_FRAMES = 600

_DRIVER = r"""
import { pathToFileURL } from 'node:url';

const FRAME = %(frame)s;
const BUDGET = %(budget)s;
const OVERRUN = %(overrun)s;
// With `node -e`, argv is [node, ...args] -- there is no script path to skip, so
// the round module lands at argv[1] rather than the argv[2] a file would see.
const modulePath = process.argv[1];

const module = await import(pathToFileURL(modulePath).href);
if (typeof module.buildRound !== 'function') {
  console.log(JSON.stringify({ fatal: 'round.mjs must export buildRound()' }));
  process.exit(0);
}
if (!module.SCRIPTS || typeof module.SCRIPTS !== 'object' || !('win' in module.SCRIPTS) || !('lose' in module.SCRIPTS)) {
  console.log(JSON.stringify({ fatal: 'round.mjs must export SCRIPTS with win and lose keys' }));
  process.exit(0);
}
for (const name of ['win', 'lose', 'stall']) {
  if (name in module.SCRIPTS && module.SCRIPTS[name] !== null && typeof module.SCRIPTS[name] !== 'function') {
    console.log(JSON.stringify({ fatal: `SCRIPTS.${name} must be a function or null` }));
    process.exit(0);
  }
}

const TERMINAL = new Set(['round.won', 'round.lost']);

function play(script) {
  const parts = module.buildRound();
  const director = parts?.director;
  if (!director || typeof director.step !== 'function' || typeof director.isResolved !== 'boolean') {
    return { fatal: 'buildRound() requires a director with step() and boolean isResolved' };
  }
  director.start?.();

  let terminal = 0;
  let frame = 0;
  let resolvedFrame = null;
  const reasons = [];
  const terminalTypes = [];
  const budgetFrames = Math.ceil(BUDGET / FRAME) + 1;

  for (frame = 0; frame < budgetFrames; frame += 1) {
    script?.(frame, parts);
    for (const event of director.step(FRAME)) {
      if (!TERMINAL.has(event.type)) continue;
      terminal += 1;
      terminalTypes.push(event.type);
      reasons.push(event.reason ?? null);
      if (resolvedFrame === null) resolvedFrame = frame;
    }
    if (director.isResolved) break;
  }

  const outcome = { state: director.state, reason: director.outcomeReason };
  const resolvedSeconds = resolvedFrame === null ? BUDGET + FRAME : (resolvedFrame + 1) * FRAME;
  // Keep going well past resolution: a director that re-announces its outcome
  // shows up here and nowhere else.
  for (let extra = 0; extra < OVERRUN; extra += 1) {
    for (const event of director.step(FRAME)) {
      if (TERMINAL.has(event.type)) { terminal += 1; terminalTypes.push(event.type); reasons.push(event.reason ?? null); }
    }
  }

  return {
    state: director.state ?? null,
    outcomeReason: director.outcomeReason ?? null,
    terminal,
    isResolved: director.isResolved,
    terminalTypes,
    reasons,
    resolvedFrame,
    seconds: Number(resolvedSeconds.toFixed(6)),
    stable: director.state === outcome.state && director.outcomeReason === outcome.reason,
  };
}

const out = {
  win: play(module.SCRIPTS.win),
  lose: play(module.SCRIPTS.lose),
  // Second run of the winning script, for the determinism comparison.
  replay: play(module.SCRIPTS.win),
  // Optional: the mixed run that must still resolve. `hasStall` distinguishes
  // "declared and passed" from "not declared", which the checker reports
  // differently -- a missing stall script is not a failure.
  hasStall: 'stall' in module.SCRIPTS,
  stall: ('stall' in module.SCRIPTS)
    ? play(module.SCRIPTS.stall)
    : null,
};
console.log(JSON.stringify(out));
"""


def discover_rounds(runs_dir: Path):
    """Every immediate subfolder holding a round.mjs. Underscore folders skipped."""
    rounds = []
    if not runs_dir.is_dir():
        return rounds
    for entry in sorted(runs_dir.iterdir()):
        if not entry.is_dir() or entry.name.startswith("_"):
            continue
        if (entry / "round.mjs").is_file():
            rounds.append(entry)
    return rounds


def drive(round_dir: Path, node: str, budget, project_root=REPO_ROOT):
    """Run the Node driver against one round module; return its report or an error."""
    driver = _DRIVER % {
        "frame": repr(FRAME_SECONDS),
        "budget": budget,
        "overrun": OVERRUN_FRAMES,
    }
    project_root = Path(project_root).resolve()
    round_dir = Path(round_dir).resolve()
    try:
        result = subprocess.run(
            [
                node,
                # A round module imports the library the way the page does, with
                # absolute /assets/ specifiers. Node reads a leading slash as a
                # filesystem path, so the hook rewrites those onto the project.
                "--import",
                str(REPO_ROOT / "forge/_shared/register_assets.mjs"),
                "--input-type=module",
                "-e",
                driver,
                str(round_dir / "round.mjs"),
            ],
            capture_output=True,
            text=True,
            cwd=project_root,
            env={**os.environ, "GBU_PROJECT_ROOT": str(project_root)},
            timeout=120,
        )
    except OSError as exc:
        return None, f"could not start the round driver: {exc}"
    except subprocess.TimeoutExpired:
        return None, "the round driver timed out after 120s (an endless loop in the rules?)"

    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip().splitlines()
        tail = "\n        ".join(detail[-6:]) if detail else "no output"
        return None, f"the round module failed to run:\n        {tail}"

    payload = result.stdout.strip().splitlines()
    if not payload:
        return None, "the round driver printed nothing"
    try:
        return json.loads(payload[-1]), None
    except json.JSONDecodeError as exc:
        return None, f"could not parse the driver output: {exc}"


def check_round(report, budget):
    """Apply the five gate assertions. Returns (problems, notes)."""
    problems = []
    notes = []

    if "fatal" in report:
        return [report["fatal"]], notes

    runs = [(label, report[label]) for label in ("win", "lose", "replay")]
    if report.get("hasStall"):
        runs.append(("stall", report["stall"]))
    else:
        notes.append("stall: not declared (add when finite progress can strand the objective)")

    for label, run in runs:
        if run.get("fatal"):
            problems.append(f"{label}: {run['fatal']}")
            continue
        if run["state"] not in ("WON", "LOST"):
            problems.append(f"the {label} script never resolved: still {run['state']} "
                            f"after {budget}s of simulated time")
            if label == 'stall':
                problems.append('finite progress can neither be won nor lost; define recovery or failure')
        elif run["seconds"] > budget + 1e-6:
            problems.append(f"the {label} outcome took {run['seconds']:.1f}s, over the {budget}s gate")
        else:
            notes.append(f"{label}: {run['state']} ({run['outcomeReason']}) at "
                         f"{run['seconds']:.2f}s, frame {run['resolvedFrame']}")
        if run["terminal"] != 1:
            problems.append(f"the {label} round fired {run['terminal']} terminal events; "
                            "it must latch and fire exactly once")
        if run['isResolved'] is not True:
            problems.append(f'{label}: isResolved must be true at a terminal outcome')
        expected_type = {"WON": "round.won", "LOST": "round.lost"}.get(run["state"])
        if run["terminalTypes"] != [expected_type] or run["reasons"] != [run["outcomeReason"]]:
            problems.append(f"{label}: terminal event disagrees with outcome state or reason")
        if not isinstance(run["outcomeReason"], str) or not run["outcomeReason"].strip():
            problems.append(f"{label}: terminal explanation is missing")
        if not run["stable"]:
            problems.append(f"{label}: terminal state changed during overrun")

    win, lose, replay = report["win"], report["lose"], report["replay"]
    if not win.get("fatal") and not replay.get("fatal"):
        first = (win["state"], win["outcomeReason"], win["resolvedFrame"])
        second = (replay["state"], replay["outcomeReason"], replay["resolvedFrame"])
        if first != second:
            problems.append(f"replay diverged: {first} then {second}; check wall clocks or unseeded randomness")
        else:
            notes.append(f"replay: identical outcome and frame {first}")
    for label, expected in (("win", "WON"), ("lose", "LOST")):
        run = report[label]
        if not run.get("fatal") and run["state"] != expected:
            problems.append(f"the {label} script ended in {run['state']}, not {expected}")

    return problems, notes


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Optional deterministic round diagnostic: resolve, latch, replay, win and loss."
    )
    parser.add_argument("--project-root", type=Path,
                        help="root for run and /assets/ paths (default: skill repository)")
    # Explicit run paths bind the diagnostic to the artifact under review.
    # --runs/--only select one or more runs from a shared directory.
    parser.add_argument(
        "runs_positional", nargs="*", metavar="run",
        help="run directories to check (project-relative), e.g. runs/step3/maze-chase. "
             "Default: every run under --runs.",
    )
    parser.add_argument("--runs", default="runs/step3", help="directory of run folders")
    parser.add_argument("--only", default="", help="comma-separated run names")
    parser.add_argument("--verbose", action="store_true", help="print each assertion's numbers")
    parser.add_argument("--sim-seconds", type=float, help="explicit validation allowance override, at most 300 seconds")
    parser.add_argument("--record-attempt", action="store_true",
                        help="append hash-bound attempt records and compact reports")
    parser.add_argument('--output', default='evidence/rounds', help='recorded report directory under the project root')
    args = parser.parse_args(argv)
    project_root = (args.project_root or REPO_ROOT).resolve()
    try:
        output = resolve_inside(project_root, args.output, '--output')
    except ValueError as exc:
        print(f'error: {exc}', file=sys.stderr)
        return 2

    node = shutil.which("node")

    if args.runs_positional:
        if args.only:
            print("error: pass run paths positionally OR filter a directory with --only, "
                  "not both", file=sys.stderr)
            return 2
        rounds = []
        for entry in args.runs_positional:
            run = (project_root / entry).resolve()
            if not run.is_relative_to(project_root):
                print(f"error: run must stay inside the project root: {entry}", file=sys.stderr)
                return 2
            if not (run / "round.mjs").is_file():
                print(f"error: no round.mjs in {entry} "
                      "(each run needs one exporting buildRound and SCRIPTS)", file=sys.stderr)
                return 2
            rounds.append(run)
    else:
        runs_dir = (project_root / args.runs).resolve()
        if not runs_dir.is_relative_to(project_root):
            print(f"error: --runs must stay inside the project root: {args.runs}", file=sys.stderr)
            return 2

        rounds = discover_rounds(runs_dir)
        if args.only:
            wanted = {name.strip() for name in args.only.split(",") if name.strip()}
            rounds = [r for r in rounds if r.name in wanted]
            missing = wanted - {r.name for r in rounds}
            if missing:
                print(f"error: no such round(s): {', '.join(sorted(missing))}", file=sys.stderr)
                return 2

        if not rounds:
            print(
                f"error: no round modules found under {args.runs} "
                "(each run needs a round.mjs exporting buildRound and SCRIPTS)",
                file=sys.stderr,
            )
            return 2

    if args.project_root is not None:
        try:
            for run in rounds:
                resolve_inside(project_root, run, "run")
        except (OSError, ValueError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2

    if not node:
        if args.record_attempt:
            for run in rounds:
                record_stage(project_root, run, f'rounds:{run.name}',
                             output / f'{run.name}.json', {
                                 'functional': {'status': 'not_evaluated', 'reason': 'node is not on PATH'},
                                 'errors': ['node is not on PATH'],
                             }, stage_snapshot(project_root, run, kind='rounds', settings={'sim_seconds': args.sim_seconds}))
        print('error: node is not on PATH', file=sys.stderr)
        return 2

    print(f"checking {len(rounds)} round(s) against their validation allowances")
    failures = {}
    for round_dir in rounds:
        print(f"  {round_dir.name:24s} ", end="", flush=True)
        inputs = stage_snapshot(project_root, round_dir, kind='rounds', settings={'sim_seconds': args.sim_seconds}) if args.record_attempt else None
        budget, source, report, notes = None, None, None, []
        try:
            budget, source = validation_budget(round_dir, args.sim_seconds, project_root=args.project_root)
            print(f"[{budget:g}s: {source}] ", end="", flush=True)
            report, error = drive(round_dir, node, budget, project_root)
            problems, notes = ([error], []) if error else check_round(report, budget)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            problems = [f'{type(exc).__name__}: {exc}']
        if problems:
            failures[round_dir.name] = problems
            print("FAIL")
        else:
            print("ok")
        if args.record_attempt:
            record_stage(project_root, round_dir, f"rounds:{round_dir.name}",
                         output / f'{round_dir.name}.json', {
                             'functional': {'status': 'failed' if problems else 'passed'},
                             'validationBudget': {'seconds': budget, 'source': source},
                             'round': report, 'errors': problems,
                         }, inputs)
        if args.verbose:
            for note in notes:
                print(f"      {note}")

    print(f"\n{len(rounds) - len(failures)}/{len(rounds)} passed")
    if failures:
        print("\nfailures:", file=sys.stderr)
        for name, problems in failures.items():
            print(f"\n  {name}", file=sys.stderr)
            for problem in problems:
                print(f"    - {problem}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
