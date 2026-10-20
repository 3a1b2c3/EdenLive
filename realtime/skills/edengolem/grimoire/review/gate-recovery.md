# Recover a failed or manually reviewed gate

Outcome: resume from the earliest unresolved cause with retained evidence and valid state.
Read only after a failed/interrupted gate, an unavailable review channel, or a custom/manual check.
Normal closeout uses [gates](gates.md#stage-closeout) and the [shared contract](shared-contract.md).

## Diagnose the failure first

Use retained errors, input/state observations and event traces to distinguish game, assertion and
environment/tool failures before choosing a correction. A failed assertion alone does not identify
which one is wrong.

| Observation | Cause to distinguish | Next step |
| --- | --- | --- |
| Page errors, or state does not update after input that should change it | Startup, clock or input wiring | Inspect the failing import or accepted-input/update path for the chosen update model. Use the [runtime preflight](input-contract.md#runtime-preflight-and-clock) for startup diagnosis; repair the cause and recheck the affected input. |
| Expected event has not occurred and simulation time lags behind wall time | Rendering/environment limits, paused time or lost simulation time | Inspect the actual renderer, RAF deltas and clock accounting (simulated, paused, backlog and dropped time). Resolve the measured cause or use an appropriate bounded wait; do not infer a rules failure from elapsed wall time alone. |
| The event occurred, but the assertion failed | Assertion timing/meaning versus an actual rule violation | Compare the event's identity and state with the intended rule at both samples. Correct an inaccurate assertion; if the event violates the rule, fix the game. Later legitimate events may increase aggregate counts; use [event-specific evidence](../patterns/interaction-tags.md#verify-and-record). |
| A field path cannot be resolved, or a comparison is rejected | Unsupported checker syntax versus a missing observation | Check the [supported condition syntax](input-contract.md#condition-syntax) and actual snapshot shape. Use supported paths/read-only derived fields or an appropriate input-only driver; do not change game rules to fit unsupported syntax. |

## Bounded refinement

After a gate review, choose one next action from the evidence. If evidence is missing, run the
applicable check or review first. For a failed gate, identify the blocking cause before changing
the specification or implementation. If the cause is unclear, inspect the failure or run a
focused diagnostic first. For a failure encountered during play, follow the compact
[reproduction and repair route](playthrough-contract.md#failure-reproduction-and-repair): retain
the failed input path and version, then attach the corrected path's actual result to the same
refinement record. Replay before editing is optional when the existing evidence already explains
the cause; this does not add a review round.

| Action | When to choose it and what to do |
| --- | --- |
| `continue` | Required checks and reviews pass. Submit the generated review with `python <skill-root>/forge/finish.py --project-root <output> --review <printed-review-path>`; it records and advances. |
| `refine-spec` | The brief or current rules source conflicts with established intent or omits a prerequisite that can be resolved from context. Correct that source first; validate a changed brief and recheck dependent behavior. |
| `refine-implementation` | The specification is sound, but code, module wiring, input, rules or presentation fails it. Fix the implementation and rerun the affected checks. |
| `request-input` | Available context leaves multiple interpretations that change defining gameplay or scope. Ask the smallest necessary question and leave dependent work unresolved; infer routine details as recorded assumptions. |
| `stop` | Defining gameplay is outside scope, required evidence remains unavailable after applicable automation/manual alternatives, or the stage/revision still fails at the three-round cap. Preserve state and report the blocker, evidence and what would enable resumption. |

Record the action and supporting observations in the active stage or revision's existing `evidence`
entries or a linked review note. For a refinement, include the failure, cause, correction and actual
recheck result. Action names are review labels; retain the existing state statuses and keep
unresolved work `in_progress`.

Count each correction-and-recheck cycle once in that stage or revision's `loop_count`. An evaluated failed
`python <skill-root>/forge/finish.py --project-root <output> --check` batch spends that stage's
round itself and reports the new count in its receipt;
manual checks and revisions are counted by whoever records them. Specification and implementation
fixes share its three-round budget. Changing the diagnosis does not reset the count; do not create a
revision just to renew a failed stage's budget. A passing third round may advance; otherwise stop and
report the unresolved issue without another refinement.

A process that cannot be launched produces a `not_evaluated` receipt and does not spend
`loop_count`. Its consecutive launch failures are counted in receipts, bounded by
`LAUNCH_RETRY_CAP` in `forge/_shared/constants.py`. At that cap, stop automatic batches; after
repairing the environment, use the manual check/record route below with actual new evidence.
Timeouts and nonzero exits still consume a refinement round: they may indicate a game defect,
so do not automatically classify them as environment failures. Record the diagnosed cause.

Fix the earliest incorrect source without changing the requested game or weakening its gate. If
current work changes behavior covered by an earlier pass, recheck that behavior on the current
artifact and retain the earlier evidence as history. Changes to a completed game follow
[revisions](../build/revisions.md), preserving the original brief and recording current rules separately.

## Image channel and readable HUD

Scene/behavior and acceptance checks try a PNG capture with at most three attempts, each bounded to five
seconds. Acceptance stops trying after a channel failure and skips its optional capture replay; later
captures after a successful preflight get one attempt. Completed functional evidence is retained
if an optional image fails. Browser/runtime errors still fail function.

`channel_ready` proves PNG capture only. Display and inspect the image through the available
viewing tool before recording a visual verdict; if that channel fails, keep image/experience review
`not_evaluated` and stop repeating equivalent captures. Resume review when the channel changes or
use available actual-player review. A file, pixel metric or smaller viewport cannot supply a missing
normal-view judgment. The template's opaque HUD background reduces scene-dependent contrast
failures; still inspect text, wrapping and cues at the intended player viewport.

## Manual records

- Evidence identifies artifact/version, command and observed result, or actual input sequence and
  observations for manual checks. A saved image needs an inspection verdict; a planned test is not evidence.
- Use the [capability matrix](capability-matrix.md) and [judge questions](judge-rubric.md) to select
  relevant checks. Record why omitted subtasks do not apply; boards and menus still require presentation
  and integrated play.
- Record `artifact` as a path relative to the state file (an absolute path also works). Each
  passed stage must name its artifact explicitly.
- Before marking Stage 1–3 (`scene`, `behavior`, `acceptance`) or a revision `passed`, include the existing
  `assessments` object with functional, experience and performance entries; omission blocks the pass.
  Intake and unfinished records do not require this object. Reuse the stage's relevant
  evidence and review verdicts when recording assessments; no additional review round is required.
  Evaluated fields need evidence; unevaluated/inapplicable fields need reasons. Failed fields and
  unevaluated function/experience block `passed`. Performance may remain unmeasured without a required target budget.
- Every predecessor of `current_stage` must be passed; `done` requires this
  for all stages. A later stage cannot start or complete across an unfinished predecessor.

Active revisions and equivalent manual/custom checks keep their existing record workflow: run
the relevant tools, retain actual evidence, update state assessments and run
`python <skill-root>/forge/next.py <output>/.state.json` once (it validates internally). For a stage transition use
`python <skill-root>/forge/scaffold.py advance --project-root <output>`
after recording; intake and final acceptance update `current_stage` directly. `validate.py` remains available
when only validation is needed. These low-level state tools validate records, not evidence truth.
Do not convert a failed or unsupported automatic batch into a pass by editing its receipt.

## Troubleshooting

| Symptom | Cause to inspect | Remedy and recheck |
| --- | --- | --- |
| Receipt is stale | Source, check configuration, tool/environment or evidence changed | Rebuild the batch; unchanged individual gates can reuse their valid evidence. |
| A newer failed batch blocks an old pass | The latest attempt is authoritative | Repair the recorded failure and check again; do not restore an older green receipt. |
| Evidence reuse is refused | Gameplay dependencies changed or cannot be resolved | Run the affected check; use full play regression for broad outcome/reset changes. |
| Process stopped during a batch | The batch remains unevaluated | Inspect retained logs, then rerun `python <skill-root>/forge/finish.py --project-root <output> --check`; do not edit its receipt to pass. |
