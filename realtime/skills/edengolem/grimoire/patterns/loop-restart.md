# Restart ownership

Outcome: the advertised restart restores the chosen initial playable state in the same page.
Use when wiring the playable loop in Stage 2, and for any revision that changes reset-sensitive
systems. Stage 3 keeps this ownership when it composes the final UI instead of adding a second path.
Do not require respawning, score reset or a timer when
the game has none. Restart input and its feedback remain available after gameplay stops.

## Workflow

Inspect the live state owners, pending work and initial playable state before wiring reset.
Use one initialization/reset path for a new round and replay. Keep the terminal outcome latched
until that path runs. Assign reset ownership for the systems that exist:

| State | Reset or preserve intentionally |
| --- | --- |
| Rules | Outcome/reason, phase/turn, objectives, relevant resources and timers |
| Interaction | Held keys/buttons, press/turn queues, selections, previews, carries and mode focus |
| World/board | Positions/velocities or occupancy/pieces; consumed objects and trigger flags |
| Automation | Actors, routes, spawn schedules, cooldowns, projectiles and bounded pools |
| Presentation | Camera, labels, overlays and resource views read the new state. An `OrbitFollowCameraRig` resets yaw/pitch so the previous orbit does not carry into the new round. |
| Observation | New round ID, zero terminal count, fresh bounded event history |

Listeners and animation loops are usually installed once, not once per restart. Dispose objects
that are replaced and clear references held by hit tests, UI and navigation. Preserve settings
or intentional progression only when specified; they must not leak terminal state into a new round.

## Verify and record

The headless gate constructs fresh rounds. The browser gate restarts in the same page and waits
for a new round ID, covering deferred resets and immediate discrete outcomes from startup inputs.
Verify win -> restart -> loss -> restart -> win, plus one reset-sensitive action for the game's
capabilities. A new banner or page refresh alone does not prove the advertised restart works.
Record the input sequence, new round IDs and observed fresh state in the active artifact's evidence.

## Troubleshooting

| Symptom | Likely cause | Remedy and recheck |
| --- | --- | --- |
| The banner clears but the next round cannot progress | Only the terminal flag or director was reset; another owner kept consumed or completed state | Walk the ownership table and reset each existing owner through the shared path. Recheck an action that previously consumed an object, resource or phase. |
| Each restart speeds up play or multiplies events | Reset installs another listener, timer or animation loop | Install persistent listeners/loops once and dispose replaced work. Recheck several same-page restarts and count accepted actions and terminal events. |
| Hits, labels or routes still refer to the previous round | Consumers retain replaced objects or a delayed callback belongs to an old round | Rebind live collections, clear caches and cancel or reject stale work by round identity. Recheck the first new target/operation and any delayed effect. |
| The new round moves, commits or opens in the wrong mode | Held inputs, command queues, selection or mode focus survive reset | Reset interaction and mode owners with the rules; use [mixed modes](mixed-modes.md) when applicable. Recheck restart while a gameplay input was held and confirm a fresh deliberate input works. |
| Headless replay passes but the browser restart fails | Fresh construction bypasses the actual reset handler | Run win -> restart -> loss -> restart -> win in one page using the advertised control. Record that trace separately from rule reconstruction. |
