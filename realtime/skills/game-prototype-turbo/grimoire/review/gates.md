# Acceptance and evidence

Outcome: close the current stage using focused checks and explicit review.
Use at a stage boundary. The [shared contract](shared-contract.md) applies; read the current
stage prompt and only its applicable contracts. Gate IDs and command templates come from
`forge/_shared/constants.py`; a project's live paths and argv come from the current task packet.

## Stage closeout

Finish the current stage's edits, then run one formal batch. Prefer the packet's `closeout`
commands over handwritten copies. Authoring tools stay in the skill checkout; generated
projects have no `forge/` and launch only through `<output>/launch.sh`.

```sh
python <skill-root>/forge/next.py <output>/.state.json --task-packet
# Execute closeout.check from that packet (includes --strategy when required).
# Inspect evidence and complete the printed review.json, then:
python <skill-root>/forge/finish.py --project-root <output> --review <printed-review-path>
```

Behavior and acceptance both require `--strategy <project-relative-path>` on `--check`, because both
replay real inputs: behavior at `closure` scope, acceptance at full scope. The acceptance batch also
includes integrated UI and independent relocation. Use `--artifact` when a manual run is not named in
state. `--width`, `--height`, `--hardware` and the playthrough scopes' `--sim-seconds` configure
applicable checks. Individual gates, strategy preflight and UI/rules diagnostics are for locating a
problem; do not pre-run the same full batch routinely.

`--check` does not mark the current stage as passed and does not advance
`current_stage`. A successful batch leaves `.state.json` unchanged. An evaluated failed
batch records one refinement round and increments that stage's `loop_count`,
subject to the cap in `forge/_shared/constants.py`. Interrupted or unevaluated
batches retain their evidence but cannot be submitted as a pass. `--check`
stops on failure and retains commands, logs, reports, images and source hashes
under `evidence/finish/<batch>/`. Inspect actual images or play before an
experience verdict. For intake, fill `intent.status` and `intent.reason`.
For build stages, fill `experience` and `performance` with status, evidence paths and reasons.
Performance may remain `not_evaluated` without a required target; samples alone are not a pass.
Functional results and evidence bookkeeping come from the tools.

`--review` verifies the latest batch and current source/evidence hashes, retains the accepted
review, validates state and prepares the next artifact atomically. It does not rerun gates.
Duplicate submission does not copy again. `--name` chooses the next run slug. `--record-only`
records the pass; resubmitting without that flag advances. No extra validate/next/advance call
is needed on the normal path. Keep observations under `evidence/` so they do not alter sources.

Process-launch failures stay unevaluated under a separate bounded retry count; see
[recovery](gate-recovery.md#bounded-refinement). Timeouts and nonzero gate exits remain failures.

All three build stages apply to every game. Interfaces and boards have static scenes; explicit
no-UI briefs still require acceptance. An evaluated failed batch spends one `loop_count` round for its stage and
reports the new count; a passing third round can close, but another automatic refinement after the cap
is refused. For custom/manual checks, revisions or failures, use [gate recovery](gate-recovery.md).

## Stage outcomes

| Stage | Automatic checks | Explicit review and passing outcome |
| --- | --- | --- |
| Intake | Brief schema validation | Intent review: concrete theme inventory, signature actions and explicit requirements preserved. |
| Scene / step1 | Metadata plus static browser check: boot, framing, WebGL canvas CSS matching `#app` at DPR 2, theme coverage, and a considered catalog path on each custom 3D `setting`. The checker does not count meshes or require a centered player. | Experience/performance review of recognition, coverage, composition and geometric simplicity. Inventory bound to real objects, assets available, startup/framing valid, sampled scene frozen. No gameplay adapter is required. |
| Behavior / step2 | Real-input browser check plus a `closure` playthrough. Declared locomotion, aiming, resources or autonomous agents must import a catalog module (the run page's import graph) or record it in `implementation.catalog_skips`. The card `modules` list is provenance, not that proof. | Experience/performance review of controls, feedback and the playable loop. Current metadata/bindings/startup, declared capabilities and signature actions, accepted inputs and persistent gameplay effects, then one representative terminal outcome, a real same-page restart and a fresh round that still accepts input. Both terminal branches must be implemented; the unexercised branch and final-UI integration stay unevaluated. |
| Acceptance / step3 | Integrated real-input play and relocation | Experience/performance review of presentation, outcomes, restart and standalone launch. Win, loss, same-page restart and second win with the final UI integrated; stable terminal reason/events, current UI bounds/focus, player-view review and standalone launch. A closure pass does not substitute for this batch. |

Use the [input contract](input-contract.md) for behavior's declared inputs and the
[playthrough contract](playthrough-contract.md) for both playthrough scopes. The
[round adapter](round-contract.md) is an optional deterministic diagnostic, useful for complex
rules; it is not a separate mandatory stage. `time_budget_seconds` bounds purposeful validation,
not player idle time. Unsupported automation needs equivalent actual-input/manual evidence;
keep unavailable portions unevaluated instead of substituting direct state changes.

## Incremental checks

Closeout reuses only matching dependency-bound scene or behavior evidence. It records the source
report and scope in the receipt. A scene report cannot count as behavior, and acceptance still
executes its complete input sequence and relocation. `--force` disables automatic reuse when a
fresh batch is needed. There are no presentation waivers, scope-review files or stage skips.

| Change | Verification |
| --- | --- |
| Unreferenced notes/resources | Existing precise dependency evidence can remain valid. |
| Scene/material/UI sources | Review changed presentation and rerun its affected gate; do not infer identical behavior from a visual label. |
| Controls, camera, collisions, navigation or local rules | Check affected inputs and boundaries, then final acceptance on the deliverable. |
| Global outcomes, timing, restart or input ownership | Recheck real-input outcomes/restart; use deterministic diagnostics if they clarify complex rules. |

Snapshots bind the entry and reachable resource closure, linked brief/parameters, consumed run
metadata, pinned and installed packages, relevant launch files, settings, tools and environment.
The graph is rebuilt to detect added or removed imports. Unresolved dynamic loaders use
conservative hashing and disable automatic reuse. Evidence outputs remain separately hash-bound.
A latest failed/unevaluated attempt blocks an older pass. Manual gates can use `--record-attempt`
and the [recovery queries](recovery-and-manifest.md). Finish with the
[pre-ship checklist](pre-ship.md).
