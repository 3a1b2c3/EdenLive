# Camera correctness

Outcome: predictable framing and input preserve the information and visibility rules intended by
the game. Use when movement or camera controls affect framing, geometry can obscure relevant
content, camera modes/modifiers need coordination, or touch camera gestures share inputs.
Skip stable, unobstructed views with none of these needs; omit checks for absent capabilities.

## Workflow

Inspect the actual views and camera/input consumers before wiring; use the
[camera catalog](../../assets/catalogs/camera.md) when a supplied rig fits. A rig supplies motion;
the game owns framing, visibility rules and mode transitions.

1. Assign one final camera owner per view. Compose position and look direction from the needed
   subjects or controls; multi-subject bounds and separate follow/aim sources are valid. Give each
   modifier an owner and an explicit composition order. Keep pose sources and update timing
   consistent; intentionally interpolated render poses are valid. Avoid stale data or decorative
   motion accidentally driving the view.
2. Choose an occlusion policy where geometry can block the view. Distinguish accidental framing
   obstruction from intentional cover, concealment or room separation. For framing obstructions,
   combine camera repositioning, distance/offset changes or local fading as appropriate. Preserve
   intentional occlusion and apply the game's lock retention, suspension/loss or blocked-feedback
   rules. Scope visual hiding/fading to the affected view, including first-person body visibility or
   separate camera feeds. Visual changes must not silently alter collision, shot blocking or AI
   detection.
3. Bound only the controls that need limits. Derive constraints from the chosen camera and the
   information needed for the current decision; full yaw rotation, free observation and flight
   attitude remain valid. Actors and objectives need not stay on screen. In automatic scrolling,
   prioritize upcoming actionable space. Record relevant bounds in the game's parameter source.
4. Define release/handoff for temporary lock-on, scripted views, shake or look offsets that exist.
   Return to the intended framing, which may retain the player's orientation. Keep temporary look
   offsets separate from actor attitude. `LookOffsetCameraRig` clamps added pitch and recenters
   look offsets when look input stops; target attitude remains separate. Choose that behavior only
   when it fits the game. `OrbitFollowCameraRig` is the opposite contract: look input turns a
   persistent yaw/pitch around a body-height look-at, and releasing look leaves that orbit. Optional
   lock-on interpolates yaw toward a target; it does not require the actor to sit in the middle of
   the frame. Pair it with `CameraRelativeCharacterMotionController` when WASD should follow the
   camera rather than the body.
5. Arbitrate touch input when camera gestures exist. Use separate regions or shared-area gesture
   rules, such as tap versus drag or finger count. Keep gesture ownership clear through movement,
   end, cancellation and mode handoff so a camera gesture cannot also commit an unintended action.
   Provide a reset-framing control only when the adjustable view needs one.

Aiming-specific shot and cover resolution stays in [camera aiming](camera-combat-navigation.md);
this pattern covers framing and view behavior under the game's visibility rules.

## Verify and record

Choose checks from the game's actual geometry, controls and modes at the desktop play viewport.
Include corners, tall props, tunnels, target switching or pause only when present.
Inspect readability from the normal play view under the intended visibility rules.

| Condition | Check |
| --- | --- |
| Framing/bounds | Required decision cues remain readable at supported control extremes and during motion; multi-subject views use consistent poses |
| Occlusion | Obstructions follow the declared policy, including intentional concealment and expected lock retention/loss; view changes preserve collision and targeting rules |
| Modes/modifiers | Existing transitions and modifier releases hand off to the intended framing without stale offsets or competing writers |
| Touch | Existing gestures reach the intended controls without unintended actions on movement, end, cancellation or mode handoff |
| Restart | [Restart](loop-restart.md) reinitializes existing transient camera state and live references for the new round while preserving explicitly retained settings |

Record the chosen policy, checked cases and observed outcomes in the current artifact's existing
evidence. Omit inapplicable cases; an unperformed applicable check remains unevaluated.

## Troubleshooting

| Symptom | Likely cause | Remedy and recheck |
| --- | --- | --- |
| The view hides information the declared policy requires, or reveals a concealed target | Framing or visibility changes conflict with the occlusion policy | Adjust framing, per-view visibility or lock feedback to match the policy; recheck the obstruction and preserve intentional concealment |
| Following or mode changes cause jitter | Competing writers, stale poses or mismatched update timing | Route the final pose through one owner per view, align sampling/interpolation and check modifier order; recheck motion and handoff |
| Camera controls lose required decision cues | Bounds, follow offset or handoff do not fit the game | Tune the relevant axes, distance or framing response; recheck supported extremes and the intended release behavior |
| The orbit recenters when look input stops, or WASD ignores the camera | `LookOffsetCameraRig` or a heading-relative controller was used for a persistent camera-relative view | Use `OrbitFollowCameraRig` and `CameraRelativeCharacterMotionController`; recheck release yaw and camera-forward travel |
| A camera drag also activates an action | Gesture ownership is ambiguous or leaks at release | Separate regions or arbitrate shared gestures; recheck tap/drag, end, cancellation and mode handoff as applicable |
