# Core input evidence

Outcome: evidence that advertised browser inputs change real gameplay state.
Use when wiring Stage 2 or changing controls. The checker executes declared browser inputs and
asserts read-only gameplay observations. It does not require WASD, an avatar, a changing HUD,
pointer lock, or a particular camera. Human-readable `controls` text does not drive the test.

## Workflow

### Runtime preflight and clock

The behavior checker validates metadata, scene bindings, startup and framing before driving
declared input in the same page. Fatal, console, runtime and failed-request errors block input.
Startup results are retained under `preflight`. The static scene gate has its own evidence scope;
passing it never supplies behavior proof. No separate startup run is required.

`preflight.frame` checks exposed frame values: a nonnegative integer `id` and finite, nonnegative
`rawDt`. An initial `id: 0` is allowed for games awaiting their first accepted input; frame validation
remains `not_evaluated` until a frame has advanced. With no exposed frame, passive browser RAF
samples are labelled as observations that do not validate the game clock. Neither case blocks
otherwise valid startup. After input, `runtime.frame` samples again and malformed values fail the
check. These samples do not prove clock progression: when timing affects the mechanic, declare
input cases that verify its actual timed state/effect, using equivalent observations for custom
clocks. A missing observation or image review is not a pass for that requirement.

When using the template helpers, import `createRenderer`, `installResize` and optional `KeyState`
from [PrototypeShell.js](../../assets/user-interface/PrototypeShell.js), and `FrameStepper` from
[TimeUtils.js](../../assets/math/TimeUtils.js). CSS owns the canvas display size
(`#app canvas { width:100%; height:100% }`); `installResize` calls `setSize(width, height, false)`
and observes both the window and the `#app` container, so a pixel ratio above 1 cannot overflow
the window and a container-only resize still updates the drawing buffer. Scene and playthrough
checkers open the page at `device_scale_factor=2` and fail a WebGL play canvas whose CSS box does
not match `#app`. The
[scaffold](../../assets/template/main.js) provides
discrete input ownership and optional RAF accounting. Adapt its input and update model to the game;
it does not prescribe keyboard controls or a continuous simulation.

The copied [game-loop.mjs](../../assets/template/game-loop.mjs) is an optional wrapper over
`FrameStepper` for games that keep one clock owner. It never chooses controls or a simulation model:

```js
const loop = createGameLoop(game, {mode: 'fixed', input, isActive: () => game.state === 'RUNNING'});
// per RAF callback: input -> simulation -> camera/visual/UI sync -> render
const frame = loop.tick(now, {active: !paused});
syncVisuals(frame); renderer.render(scene, camera);
window.__gameTest = Object.freeze({read: () => loop.read({selection: game.selection})});
```

`mode: 'static'` accounts frames only, `'discrete'` calls `game.handleInput(input)` once per enabled
frame without simulating time, and `'fixed'` adds fixed-step `game.update(dt, input)`. `isActive()`
is the game's own pause/terminal policy: substeps stop when it turns false, when `update` returns
`false`, or when `suspend()` runs. Call `suspend()` from pause, restart, blur and visibility handlers
so pending input is cleared and the interrupted interval is not owed simulation; the loop does not
detect a reset by itself. `read(observations)` returns a structured clone with authoritative `frame`
and `clock` that supplied observations cannot override.

Event-driven DOM or board games may skip the wrapper's input step and call `game.handleInput(action)`
from pointer/keyboard handlers directly; no keyboard model is imposed.

When using `FrameStepper` directly, select its mode by the game's update model:

- `fixed`: pass the unmodified RAF delta to `advance(rawDt, update, {active})`; fixed substeps
  drive continuous motion/physics. Return `false` from `update` at a terminal/pause transition.
- `discrete`: commit turns, selections or placements from accepted inputs; `advance()` accounts
  time without calling `update`. Handle accepted inputs separately, then render on demand or per
  frame as needed. No simulation tick or gameplay countdown is introduced.
- Timer/worker or hybrid models: keep one owner per clock and transition. Reuse the appropriate
  parts or supply equivalent timing/input observations; skip RAF simulation where it does not apply.

For RAF accounting, use zero delta for the first callback, then unmodified timestamp differences
in seconds. Set `active=false` while paused/hidden under the game's policy; account the resume gap
as inactive rather than feeding it into updates, including transitions between two callbacks.
Expose `frame: { ...stepper.frame }` and `clock: stepper.read()` in the snapshot when using the
helper. Bounded catch-up records backlog and dropped time; do not hide slow execution by clipping
the input delta. These diagnostics explain timing behavior and do not establish a performance target pass.

For keyboard input, read held intent with `KeyState.isDown()`/`axis()`. Consume short press edges
with `consumePress()` at their intended update, or use `onPress()` as that action's sole owner.
Keep mouse/pointer when it fits; skip keyboard helpers when unused. Do not add gamepad, joystick
or touch-layout controls. Clear pending
inputs at terminal/reset and handle focus/visibility transitions under the game's pause policy.

### Declare observations and cases

Inspect the input -> accepted transition -> feedback path before choosing observation fields.
Expose `window.__scene = {scene, camera}` for framing and
`window.__gameTest = Object.freeze({read: () => snapshot})` for observations. Return serializable
copies of real game state with no side effects. Assert accepted operations, focus, placement,
position region or action state; a debug key log or decorative animation cannot establish gameplay.
Inspect this mapping when reviewing the run: automation cannot infer the meaning of an arbitrary field.

In the stage's run card, link `brief` (relative to the run directory or absolute), record
`capabilities` and `implementation`, declare `signature_actions` derived from the brief, then
declare cases such as:

```json
{
  "input_checks": [
    {"name": "select next command", "before": {"selection": 0},
     "actions": [{"type": "tap", "key": "ArrowDown"}],
     "expect": {"selection": 1}, "settle_ms": 100, "persist_ms": 100},
    {"name": "confirm selected command", "actions": [{"type": "tap", "key": "Enter"}],
     "expect": {"resolvedCommand": "defend"}}
  ]
}
```

Cases run sequentially in the same page. `before` is optional; `expect` is nonempty. Both use the
condition syntax below.
Rejection, repeat and release cases may remain unchanged. Both waits default to 100 ms and allow
0..5000 ms; the checker asserts after each. For a
transient action, expose its lasting result/count or use a suitable timing driver; do not stretch
the actual game window for the check. Fixed coordinates use a 960 x 600 CSS-pixel viewport.

Allowed actions: `tap`, `down`, `up` with a Playwright `key`; `move` or `click` with CSS `x`, `y`;
`pointer_down`, `pointer_up` with optional `button` (`left`, `middle`, `right`). A click may also
name `button`. Taps hold for 35 ms; games must latch press edges. Use separate held/release cases
for drag, steering or charging. No action can execute JavaScript or set game state.

#### Condition syntax

Check conditions against the actual snapshot shape while authoring cases, before launching the
browser. The shared matcher in [browser_input.py](../../forge/_shared/browser_input.py) also serves
playthrough `when` conditions, with one deliberate difference: an asserted `expect`/`before` field
must resolve, while a playthrough `when` field that the active mode does not expose simply leaves
that rule unmatched, so one mode's observations cannot end another mode's round. Unmatched rules are
listed per scenario as `unresolvedRules`; inspect that list when a rule never fires. Run-card schema
validation checks case structure; it does not prove that observation paths resolve or comparison
operators are supported.

```sh
python <skill-root>/forge/validate_condition.py condition.json                        # syntax only
python <skill-root>/forge/validate_condition.py condition.json --snapshot snapshot.json  # also paths and values
```

Exit `0` means valid syntax and, with a snapshot, a match; `1` means a syntactically valid condition
that did not match; `2` means malformed input, an unsupported operator, an unresolved observation path
or an I/O error. Save a snapshot from `__gameTest.read()` to use the second form. Neither form
establishes gameplay correctness.

| Form | Supported meaning |
| --- | --- |
| `car.speed`, `packsById.packA.consumed` | Dot-separated **object keys only**, relative to `__gameTest.read()`. In an asserted `expect`/`before` condition every segment must exist; a missing field is an error even with `$ne`. |
| `{"state": "RUNNING"}` | Literal JSON equality, including whole arrays/objects; booleans are distinct from numbers. |
| `{"state": {"$eq": "RUNNING"}}`, `{"state": {"$ne": "LOST"}}` | Explicit equality or inequality against a literal value. |
| `{"car.speed": {"$gte": 20, "$lt": 40}}` | Ordered comparisons: `$gt`, `$gte`, `$lt`, `$lte`. Both observed value and operand must be finite numbers. All fields and operators in a condition must match (AND). |

There is no array indexing (`packs.0`, `packs[0]`), computed `.length`, wildcard/filter, JavaScript
expression, field-to-field comparison or other operator such as `$in`. For array items, expose
needed values as read-only object fields keyed by stable ID, or derive a count/boolean from real
state; do not add independent test-only success flags.

For a one-shot rule, identify the event instance, verify its actual effect and repeat the triggering
input to check for duplicate application. Later legitimate events may change aggregate counts;
see [event-specific evidence](../patterns/interaction-tags.md#verify-and-record) when relevant.

#### Optional control probes

[probe_controls.py](../../forge/probe_controls.py) explains a suspected control or camera fault. It is
a diagnostic, never a gate, and no game is required to satisfy any mode. Each mode only works when the
run already exposes the observation it measures, so route by actual capability:

| Mode | Use when | Requires on `window.__scene` |
| --- | --- | --- |
| `dirs --hold KeyA:left,KeyD:right [--hold-ms 800]` | Held movement whose screen direction is in doubt | A recognized actor position (`actor`, `player`, `fighter`, `headMesh`, `plane`) that the camera can see |
| `heading --press ArrowLeft:left [--tick-ms 600]` | Grid/snake steering that advances without input | `snake` with a direction and head, plus `board.cellToWorldPoint` |
| `camera --keys ArrowLeft,ArrowUp --frames 120 --every 20 [--max-speed]` | A following camera that appears to lurch | `camera` |

All modes take `--runs` (default `runs/step2`), `--project-root` and `--settle-ms`. `dirs` fails on a
first-person camera sitting on the actor, where the projection is degenerate; probe the camera's own
forward direction instead. There is no generic first-person heading mode.

### Signature acceptance

Each `signature_actions` row links one defining operation to JSON-pointer `brief_refs`, one or
more successful input cases, a visible `feedback` description, and boundary/repeat/release checks
or an explicit `skip_reason`. A skeleton may contain an empty draft row, but behavior readiness fails
until the row is completed. This keeps acceptance tied to the requested game instead of a generic
score or terminal flag.

For each row, at least one linked success case must change an asserted defining gameplay field
between its pre-input and final (`persist_ms`) observations. Generic outcome, score or clock/frame
changes and boundary cases cannot supply that proof. Other linked success cases may remain unchanged.
The checker reuses existing input observations without additional browser actions, reads or waits;
the field's meaning and rendered feedback still need the input/state mapping review above.

### Diagnose contact, activation and reachability when present

Use optional `diagnostics` in the same read-only snapshot when `solid_space`, `navigation`,
`aiming` or `autonomous_agents` applies and a failure needs explanation. Reuse input before/after
observations and existing playthrough reads; Acceptance retains at most 64 changed diagnostic samples
per round, aligned by `elapsed` with `inputTrace`, without another browser round trip.

| Field | Observe only when relevant |
| --- | --- |
| `inputApplied` / `displacement` | Accepted action or controller intent, and its actual effect on the controlled object; indirect control may need the ball's displacement |
| `contact` | Support, collision or obstruction involved in that action |
| `activation` | Whether the required actor, encounter or automation has started |
| `attackWindow` | The effective action/hit window, when the game has one |
| `reachableTargets` / `blockedSeconds` | Available routes/targets and time unable to make intended progress; no-route is distinct from healthy idle |
| `targetFilter` | Why an actual candidate was accepted or refused, such as range, obstruction or eligibility |

Expose only needed sensors from real state. A field may carry
`{"status":"not_applicable","reason":"fixed encounter; no route planning"}`.
Without a relevant capability the optional diagnostic block is `not_applicable`; a relevant block
with no recognized sensors is `not_evaluated`. `observed` covers only supplied fields, not a pass
for omitted ones. Autonomous turns or scripted threats do not imply navigation or an attack window.
Boards/menus still use their normal accepted/rejected input evidence without adding spatial sensors.

Before changing HP, damage or victory thresholds, compare the input, contact, activation, target
eligibility and any effective action window against the failed operation. Fix the first broken link
and rerun that operation. Missing diagnostics call for focused observation, not easier game rules.

## Verify and record

Cover one meaningful successful operation and the relevant rejection, limit, repeat, persistence
or release case. Add a specific test for a mode switch or secondary input central to the brief.
Omit irrelevant cases instead of creating actions the game never advertised. Clear held/queued
input on blur, terminal transitions and restart according to the chosen pause policy.

Cards without declared cases fail the input portion explicitly. For an equivalent input-only/manual
review, retain startup observations and attach actual input evidence with its scope and limitations.
Record the checker report and inspected input/state mapping with the artifact in stage evidence.

## Troubleshooting

| Symptom | Likely cause | Remedy and recheck |
| --- | --- | --- |
| A short tap sometimes does nothing | Only current held state is sampled; press and release occur between ticks | Latch the press until its intended consumer handles it. Recheck the 35 ms tap and the actual committed result. |
| One held key commits several operations | A discrete action runs every frame or on browser key repeat | Use a consumed edge, or the brief's explicit repeat cadence. Recheck tap, hold and release without duplicate commits. |
| Movement or an action continues after blur or restart | Held state, queued edges or pointer deltas survive the transition | Clear the input adapter and pending commands under the pause/reset policy; handle lock loss where used. Recheck blur/resume and same-page restart while input was held. |
| The HUD reacts but the objective or board does not | The observation tracks a key log, preview or animation instead of the accepted transition | Route input through real rules and observe the committed result. Recheck a legal operation and a refused one; neither may be inferred from decoration. |
| A valid short action fails after the check's wait | The assertion samples a transient window after it closes | Observe a durable consequence/event count, or use a suitable timing driver. Keep the game window unchanged; see [timing diagnostics](../patterns/action-readability.md#troubleshooting). |
| A mode-switch press also acts in the new mode | Both modes consume the same input edge | Assign an owner for the transition and consume it once; follow [mixed modes](../patterns/mixed-modes.md). Recheck press, hold and release across the handoff. |
