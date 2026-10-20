# Browser playthrough contract

Outcome: closure evidence for one terminal outcome and effective input after restart, or full
acceptance evidence for a win, loss and win after restart, all through the game's real controls.
Use for Stage 2 closure, Stage 3 acceptance or an integrated revision check. One checker executes a
per-game JSON keyboard/pointer strategy in Chromium at a selected `--scope`. It is an executor, not a planner. Use the real advertised inputs and unchanged game
rules. For unsupported inputs or decisions, use an equivalent input-only driver or record manual
win/loss/replay evidence; mark this automation unevaluated and assess the separate evidence.

| Scope | Scenario sequence | Proves | Stage |
| --- | --- | --- | --- |
| `closure` | one terminal outcome (`WON` or `LOST`), then `RUNNING` | The loop closes: a real terminal outcome, a same-page restart and a fresh round that still accepts effective input. The other terminal branch and the final UI are not evaluated. | `behavior` |
| `acceptance` | `WON`, `LOST`, `WON` | The whole game through real input with the final UI integrated. | `acceptance` |

Both scopes share the strategy format, the input executor, the read-only observation adapter and the
report shape; each report states its own scope. A closure pass never substitutes for acceptance,
because the final UI can change focus, click targets and input delivery. The authored strategy
travels with the run, so acceptance extends the closure draft instead of starting over.

## Workflow

Inspect the advertised controls and real state/event producers before authoring a strategy.
Prefer the current task packet for live argv. A diagnostic from the skill checkout looks like:

```sh
python <skill-root>/forge/check_step3.py --project-root <output> --runs runs/step3 --only <run> --strategy runs/step3/<run>/strategy.json --output evidence/<run>
```

For a generated project, follow the [gate commands](gates.md) with `--project-root <output>` and
that project's own run, strategy and evidence paths.

### Read-only observation

Expose `window.__gameTest = Object.freeze({read: () => snapshot})`, returning serializable copies
with no side effects. Read the actual game state, not an independent test-only outcome flag.

| Field | Meaning |
| --- | --- |
| `state`, `roundId` | RUNNING/WON/LOST; an ID changed only by the advertised restart |
| `elapsed` | Simulation seconds; zero is valid for an immediate discrete result |
| `terminalCount` | Total actual terminal events in this round, reset on restart |
| `events` | Bounded ring of `{id, type, ...}` with unique stable IDs within the round |
| `frame` | `{id, rawDt, simDt}`; unmodified frame delta and total simulation seconds advanced in that frame |
| Other fields | Real selection, board, cue, progress, resource or mode observations needed by the strategy |

Keep enough events for polling to observe them. Emit exactly one `round.won` or `round.lost`
matching the terminal state. If `outcomeReason` is exposed, it must remain stable. Restart clears
applicable round state, events and inputs. Performance polling samples only some frames;
record a bounded histogram/ring separately for exhaustive measurements.

### Strategy authoring

Stage advancement creates `strategy.json` with the scenario sequence that stage's scope requires and
empty interaction, restart and rule fields: a closure draft when entering `behavior`, the full
sequence when entering `acceptance`. An authored strategy is carried forward and never overwritten;
only an untouched draft is redrawn for the new scope. For another artifact, create a draft at the
chosen path:

```sh
python <skill-root>/forge/check_step3.py --starter --scope closure --output /path/to/game/runs/step2/behavior/strategy.json
python <skill-root>/forge/check_step3.py --validate-only --scope closure --project-root /path/to/game --strategy runs/step2/behavior/strategy.json
python <skill-root>/forge/check_step3.py --starter --output /path/to/game/runs/step3/final/strategy.json
python <skill-root>/forge/check_step3.py --validate-only --project-root /path/to/game --strategy runs/step3/final/strategy.json
```

The starter creates a new file and refuses to overwrite one. Fill its gameplay choices before
preflight: an empty draft fails validation. `--validate-only` checks syntax without a browser,
evidence writes, attempt records or gameplay budgets. It cannot resolve observation paths without
a snapshot; use the [condition checker](input-contract.md#condition-syntax) for that.

Keep the strategy beside the run it drives. Declare:

- `interaction_events`: event types representing accepted gameplay operations (a committed move,
  placement, command, serve, hazard response or resource exchange). Mere motion, spawn or decoration
  is insufficient; review the event producer's meaning.
- `restart_actions`: bound actions. Optional `start_actions` operate a
  start screen on initial load (title or pause, not a picker of independent stages). Restart must
  create a fresh round; include required menu/start inputs in the restart sequence. Normally
  observe RUNNING with zero terminal events; an immediate discrete outcome from those inputs is
  valid if the new round emits exactly one terminal event.
- `scenarios` matching the scope: exactly three with `expect` WON, LOST, WON for `acceptance`, or
  exactly two for `closure` -- one terminal outcome (`WON` or `LOST`) followed by `RUNNING`. A
  `RUNNING` scenario must not reach a terminal state, and it must show real input producing a
  meaningful gameplay event in the restarted round. Each contains rules evaluated against
  one observation snapshot. `when` maps dotted paths to literal values or numeric predicates;
  a rule may use `action` (tap/move/click/pointer input) or `hold` (the desired keyboard set),
  with optional `once` and `cooldown_ms` (default 100) on action rows only. An empty condition
  always matches. Matching hold rows are unioned, and only changed keys are sent; keys absent
  from that union are released. Dependent actions wait for the next observation. A `when` path
  that the active mode does not expose leaves that rule unmatched instead of aborting the round;
  inspect `unresolvedRules` if a rule never fires.

For example, a rule has the shape
`{"when":{"selection":1},"action":{"type":"tap","key":"Enter"},"once":true}`
or `{"when":{"car.speed":{"$lt":20}},"hold":["ArrowUp"]}`. Choose conditions and inputs from the
actual game. Actions follow the [input contract](input-contract.md): tap, move/click and pointer_down/up;
continuous keyboard intent uses `hold` rows rather than down/up edges.
This checker uses a 960 x 640 CSS-pixel viewport. Held inputs support dragging/charging; they are
released between scenarios. No JSON action can execute code or set game state. A win needs real
input and a meaningful gameplay event; a start input alone only qualifies when its actual gameplay
consequence emits such an event.

The linked brief supplies the simulation allowance; `--sim-seconds` reports an override up to 300.
`--wall-seconds` independently bounds each scenario (default 60, at most 75). Three scenarios plus
an optional capture replay share the one 300-second gate timeout, so raise it only for genuinely
real-time rounds; do not shorten the design to fit a test. A round that needs more wall time
belongs in a manual review.
Games waiting for a discrete input need no gameplay countdown.

## Verify and record

`--output` receives `report.json`, a byte copy `replay-strategy.json` and terminal screenshots. The report includes input/event traces,
sampled frame timing, terminal/reset checks and browser errors. Inspect images separately for
readability and experience. Replay uses the same page and actual restart input. Optional `check_rounds.py` diagnostics
can isolate deterministic rules when that helps diagnose a failure. Missing/invalid observations fail explicitly.

Scheduler counters report snapshot/dispatch cost and decision rate. Use them to distinguish
browser transport overhead from slow simulation; dispatch duration includes tap waits and is
not the game's input-response latency. Terminal/event/restart checks still run after dispatch.

Optional `capture_when` waits for a condition in a separate replay, driving the first scenario's
rules. Capture pauses RAF only and verifies the snapshot stays unchanged. Timer/worker-driven
games may need a different capture adapter. A frozen screenshot is visual evidence, not proof of
reaction fairness or performance; failure to capture leaves that evidence unavailable.

The report's performance `measured` status means samples exist, not that a target passed. In a
state assessment, use passed/failed only against an explicit target and evidence; otherwise use
not_evaluated with a reason. Experience remains not_evaluated until reviewed. Software rendering
cannot establish hardware performance or novice reaction timing.

## Failure reproduction and repair

Use when normal play or a checker encounters a failure. Outcome: the repair agent can locate the
failed version, repeat its input path and verify the correction. Keep this in the existing report
and refinement note; no separate bug report or extra gate is needed.

The checker retains completed and partial scenarios even if observation, input dispatch or restart
throws. `failure` locates the first detected problem by phase, 1-based scenario and input sequence;
its reason is an observation, not a diagnosed cause. Each scenario keeps its pre-start/reset state,
round start, latest available observation, observed events and actual input trace. Each input records
order, phase, wall offset, simulation time, frame/round, matching 0-based rule indices and the
condition fields already observed. This adds no observation call per action. A missing field in an
inactive mode is recorded as unavailable. `dispatched` means the browser call returned; gameplay
acceptance still needs the corresponding state/event. `dispatch_incomplete` may include a partial
tap or drag. Automatic between-round releases do not count as gameplay input.

1. Locate `report.inputs`, `replay` and the failing scenario. `replay` contains the strategy copy/hash,
   viewport, browser version, time budgets and an argv array for the same checker, using a new evidence
   directory. Source hashes identify the version but do not archive it: retain the failed artifact
   or a recoverable revision before editing. Keep the original report, strategy copy and useful images.
2. Inspect the last relevant input and before/after observations against the intended rule. If the
   cause is already supported, fix it directly; another pre-fix replay is optional. Otherwise repeat
   the saved strategy/settings on the failed version. Start from a fresh page and retain preceding
   scenarios and real restart inputs when the failure depends on them. Shorten the path only after
   the shorter sequence still reaches the same failure.
3. Hand off just the evidence path/location, expected → observed behavior and one supported cause
   or next diagnostic. Manual/input-adapter failures use the same information: starting state,
   ordered controls (including waits/hold/release when relevant), first observed discrepancy and
   version. Record only applicable state: turns/choices for a board, cues for timed actions,
   mode/transition for hybrids. Use an existing seed/configuration if available; do not require new
   randomness infrastructure or spatial/combat fields for every prototype.
4. Correct the earliest wrong source, then use the same failure path on the corrected artifact.
   Record the actual result and new evidence link in the existing refinement note or attempt fields.
   A confirmed local fix still follows the existing [affected checks and refinement bound](gate-recovery.md#bounded-refinement).
   Final integrated evidence remains the current version's WON/LOST/WON sequence.

`failure.reproduction: not_attempted` describes the captured failure, not a second run. In the
refinement note, distinguish reproduced, not reproduced and blocked/unavailable using actual results.
The saved argv reruns observation-based decisions; it does not inject recorded state or guarantee
identical frames. Browser scheduling, hidden randomness or external state can diverge. Compare the
first divergence and record it; a non-reproduction alone does not prove a repair. Inspect the argv's
paths/settings before execution and choose a fresh `--output` if its suggested directory was used.

| Symptom | Next evidence to inspect | Repair route |
| --- | --- | --- |
| Input dispatched but the expected operation never occurs | Decision fields, real event producer and latest state | [Input diagnostics](input-contract.md#troubleshooting); separate a stale strategy predicate from a disconnected game action |
| Failure appears after a mode change or restart | Prior scenario, release/restart inputs and round/mode observations | [Mixed modes](../patterns/mixed-modes.md#troubleshooting) or [reset ownership](../patterns/loop-restart.md#troubleshooting) |
| Repetition diverges around a cue or deadline | Wall offset, simulation/frame samples and actual cue state | [Timing diagnostics](../patterns/action-readability.md#troubleshooting); do not change gameplay timing just to make the strategy pass |
| Observation/transport/boot error stops play | `failure.phase`, partial trace, last available observation and browser errors | Repair the failing observation, input adapter or startup dependency; preserve the gameplay result as unresolved |
| A mode-specific rule never fires | `unresolvedRules` and the fields the current mode actually exposes | [Condition syntax](input-contract.md#condition-syntax); a missing field in an inactive mode is unmatched, not a transport error |

## Validation budgets

`brief.time_budget_seconds` bounds simulation time per scenario, including all phases of that
round. It does not bound the sum of the acceptance sequence and never adds a gameplay timer.
The task packet reports this allowance, the default per-scenario wall-clock limit and its maximum,
and the enclosing gate-process timeout. Defaults and process limits live in
`forge/_shared/constants.py`. The wall clock can expire before the simulation allowance,
especially on a slow renderer; a larger brief allowance does not extend actual execution time.

Before a formal batch, compare the required real play duration with these limits. A scenario
that cannot fit needs the actual-input/manual evidence route in [gate recovery](gate-recovery.md#manual-records).
Do not shorten requested timers or alter game rules to fit automation. Direct checker diagnostics
can set `--wall-seconds` up to its maximum; normal closeout uses the reported default.
