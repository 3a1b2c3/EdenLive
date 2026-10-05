# Pure round adapter

Outcome: deterministic evidence for win, loss, terminal stability and rule replay.
Use as an optional diagnostic for complex round rules in acceptance or a revision. Do not add a
second harness for a simple game already covered by browser acceptance. When used, the browser and headless driver must use
the same rules. A round owns state and domain events without Three.js, DOM or wall-clock
dependencies. Reuse RoundDirector where it fits; another state machine can satisfy the same adapter.

## Workflow

Inspect the brief's phase order, outcome precedence and reset state before writing the adapter.
`round.mjs` exports `buildRound()` and `SCRIPTS = {win, lose, stall?}`. `buildRound()` returns
fresh parts including `director`; scripts are functions `(frame, parts) => void` or `null` for
no injected input. Scripts supply deterministic domain actions/events before each 1/60-second tick.
The director exposes:

| Member | Contract |
| --- | --- |
| `start()` | Optional transition into RUNNING |
| `step(dt)` | Advance rules, return an iterable of domain events |
| `state` | RUNNING, WON or LOST after start |
| `isResolved` | True only after a terminal outcome |
| `outcomeReason` | Stable terminal explanation |

Emit exactly one `round.won` or `round.lost` event with `reason` matching the final outcome. Hold
the terminal state through further ticks. Declare same-tick precedence and phase order explicitly.
Use an injected seeded random source when needed. Reset/reconstruction clears all round state;
the live browser must reset through the advertised input using this same initialization path.

When progress depends on encounter clearance, keys/abilities, consumable resources or irreversible
moves, review prerequisites along the existing `win` sequence: acquire requirements before using
them and retain enough resources for later required actions. Skip this review when absent; no
solver or enumeration of alternate paths is required.

Use `stall` for relevant recoverable mistakes or stranded progress not covered by win/loss scripts;
it must still reach WON or LOST through rule-defined recovery or failure. If manual restart or
advertised undo is the only recovery, verify it through actual input in
[acceptance](../build/step3-acceptance.md) instead of adding `stall`. A legal push-box dead end need not
trigger automatic defeat. This is not an idle timeout test for every game.

Each run card links `brief`; its `time_budget_seconds` bounds the entire purposeful validation
sequence, including phases after a survival countdown or encounter. The checker reports the first
terminal tick's simulation time, excluding its extra 600 stability ticks. It allows up to 300 s
and reports a brief or explicit override as the budget source; a missing source fails.
Do not add a game timer or shorten the requested objective merely to fit the checker.

If RoundClock is used with a game limit above its default 180-second constructor cap, configure
`maxRoundSeconds` explicitly. Its timer/expiry policy is gameplay, independent of the validation
allowance. No clock is required for an untimed puzzle or menu round. See the
[gameplay catalog](../../assets/catalogs/gameplay.md) for the actual modules.

## Verify and record

`check_rounds.py` constructs fresh win, loss and win-replay rounds, plus `stall` if supplied. It
checks resolution, terminal-event consistency, stable overrun and replay outcome/reason/frame.
Record the report with the current artifact. Fresh construction proves deterministic rules;
the browser gate separately proves in-page restart. Diagnose live reset failures with
[restart ownership](../patterns/loop-restart.md#troubleshooting).

Domain-script success cannot prove collision, targeting, placement or input works in the scene.
Those remain behavior checks and the acceptance real-input playthrough.
