# Character controller integration

Outcome: character motion, support and any selected look/jump behavior agree with the brief.
Use only for character locomotion. Vehicles, indirect control, automatic movement, grid tokens
and menus use their own contracts in [continuous controls](../build/continuous-controls.md) or
[discrete interactions](../build/discrete-interactions.md). Do not add a capsule to satisfy this file.

## Workflow

`BaseCharacterMotionController` plans motion; it does not keep an actor on a floor by itself.
For supported characters, compose `SupportHeightCommitResolver` and the actual support query.
Inspect the module's plan/resolve/commit signature. Preserve the grounded -> airborne edge at
ledges and a missing support value; a fallback floor changes fall rules. With solid boxes, resolve
side blocking before querying support: see [box collision](box-collision.md).

Use one WorldBasis for movement, collision and presentation. Mesh facing may follow travel,
aim, opponent or fixed orientation according to the verb. `GeneralObjectModelController` can
align mesh axes; do not assume every actor faces its travel direction.

### Mouse look, only when selected

`MouseLookCharacterMotionController` consumes pixel deltas, not NDC.
`PrototypeShell.MouseLookDelta` captures the mouse on a canvas click by default. While locked,
`consume()` returns relative pixel deltas `{x, y}` with screen-up-positive Y; before capture and
after Escape it returns zero. Keep a shooting crosshair centered and apply the deltas to camera
rotation with the chosen sensitivity, once per consumption (no extra `dt` multiplier). A visible
desktop cursor's screen position is not the aim direction, and hiding it with CSS alone leaves
movement constrained by screen edges. Show the click-to-capture and Escape-to-release controls.

Check the actual shell/controller/basis pairing: moving upward must raise the view when that is
the selected mapping. Verify first movement, repeated turns beyond the viewport, release and
recapture without jumps or duplicate deltas. Wire `onLockChange: locked => { if (!locked)
input.clear(); }` to clear held keys, fire and queued pointer actions on release or capture failure;
clear them on blur too. Release Pointer Lock for terminal/menu buttons and apply the chosen pause
policy consistently. Capture failure keeps the cursor visible and look inactive. Only choose
`{ pointerLock: false }` for an intentional free-cursor look scheme; use `PointerState` for
cursor-position aiming or selection.

### Camera-relative orbit, only when selected

`MouseLookCharacterMotionController` writes look yaw into the actor. For a third-person orbit
where look turns the camera and WASD follows that camera, use
`CameraRelativeCharacterMotionController` with `OrbitFollowCameraRig` instead. Pass the rig's
`yaw` as `cameraYaw` every step. Facing is a separate choice: travel direction, an optional
lock `faceTarget`, or the current yaw. Tune the rig's distance, `anchorHeight`, planar look-at
offset, pitch range and lock interpolation from the actual geometry. The look-at is a body-height
aim point; the actor does not have to be screen-centered. Call `reset()` with the round so the
orbit does not keep the previous yaw.

### Jump assistance, only when intended

CoyoteTime, JumpBuffer and DoubleJump change accepted inputs. Select them from the brief or a
recorded design choice; their availability is not a requirement. If combined, assign first/air
jump ownership explicitly: ground buffering and an accepted air jump must not both consume one
press, and consuming an air jump must not queue an unintended jump on landing. Reset air-jump
allowance on the grounded transition; preserve intended early landing presses.

## Verify and record

Verify the selected movement frame, support/release response and any mouse-look or camera-relative
orbit transitions. For an orbit, releasing look must leave yaw, and forward must follow the camera
rather than the actor heading.

For jumping characters, add the actual jump model's relevant early/late/air/landing cases. For
automatic hopping or flapping use that controller's action semantics; normal jump equations and
stop tests may not apply. Record the observed behavior with the current artifact; use
[input diagnostics](../review/input-contract.md#troubleshooting) for lost or duplicated action edges.
