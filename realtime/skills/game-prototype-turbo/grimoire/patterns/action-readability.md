# Timed actions and truthful cues

Outcome: the player can read an opportunity and act within the same window the rules resolve.
Use when timing determines success: a jump opportunity, beat, processing window, charge, defense
or other short action. Omit timing checks for untimed selection/placement; still show legal state.
Only specialized combat games need guard arcs, rear hits or resource-spend rules.

## Workflow

Inspect the action's clock, phase transitions, input semantics and prerequisites first.
Use one authoritative action state and simulation clock. Rendering reads that state after rule
resolution; do not maintain a second visual countdown. Distinguish preparation, an actionable
window, commitment and actual success. A cue can communicate opportunity without guaranteeing the
result when range, occupancy, facing or another prerequisite can still invalidate the action.

Latch press/release edges between frames; define whether holding, repeating or switching input
devices renews a window. Include the smallest real timing dependency in Stage 2 if the verb needs it.

Use visible pose, text or geometry and clear failure feedback. Prototypes stay silent: do not
generate audio, music, sound-effect or haptic assets, even as a timing cue. Cues must remain readable in
the normal camera/interface at decision time. A success indicator follows actual resolution.
Reset transient state, queued inputs and cues with the round.

Reuse selected primitives from [gameplay](../../assets/catalogs/gameplay.md),
[game feel](../../assets/catalogs/game-feel.md) and [UI](../../assets/catalogs/ui.md). TimedGuard,
MeleeAttackSystem and AttackTelegraphView are combat-specific candidates; their arcs must share the
actual attack object. WorldAnchorLabel can present world cues; caller supplies occlusion. A
resource display reads the real pool, with a capacity/threshold only if that resource has one.

## Verify and record

Test early/valid/late and the relevant hold/release or prerequisite boundary. Record simulation and
wall timing separately; slowing simulation for a test does not prove reaction fairness.
Inspect a representative active state or recording, not just the terminal banner. The browser
runner's optional frozen capture is separate from timing measurements; timer/worker-driven games
may need another capture method. Saved frames without inspection are not experience evidence.
Timing, camera, arena and cue choices belong to the game being built; nothing here prescribes a
starting balance. Tuning changes follow [revisions](../build/revisions.md).

## Troubleshooting

| Symptom | Likely cause | Remedy and recheck |
| --- | --- | --- |
| The cue says ready after the action window closes | Presentation runs its own countdown or reads before resolution | Render from authoritative action state after the rule update. Recheck both sides of each phase boundary with input and inspected cues. |
| Pause or a slow frame changes which inputs succeed | Input timestamps, action phases and cues use different clocks or delta policies | Use the same simulation timeline for acceptance and resolution; make pause behavior explicit. Recheck the boundary across pause/resume and an affected frame interval; report wall time separately. |
| Holding or pressing a second bound device renews a one-press window | Each frame/device is treated as a new logical press | Aggregate held controls before edge detection and apply the brief's renewal policy. Recheck hold, second-device press and full release/repress. |
| A success cue appears although the action fails | Opportunity or input acceptance is displayed as resolved success; another prerequisite failed | Keep opportunity, commitment and result distinct. Show success from the resolved event; recheck a valid time with an invalid range, cell or resource only where relevant. |
| Automation passes only after lengthening the action window | The driver polls too slowly or asserts an expired transient state | Restore the intended window; use lasting event evidence or an appropriate input-only driver. Recheck the real timing and review human readability separately. |
