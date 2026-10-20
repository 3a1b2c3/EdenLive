# Camera-based aiming

Outcome: the visible aim, resolved target and impact feedback agree under the chosen cover rules.
Use only when a camera ray determines the aimed target or impact. Direct menu selection,
automatic targeting and non-aimed interaction skip this pattern. Movement/navigation detail lives
in [spatial navigation](spatial-navigation.md); short cues use [action readability](action-readability.md).

## Workflow

Inspect the actual camera, viewport, reticle position and target/cover consumers.
Choose the camera from the play space and controls: fixed, following, orbit, first-person or another
suitable view. No universal shoulder offset, capsule color, pitch or zoom distance is required.
A persistent camera-relative orbit uses `OrbitFollowCameraRig`; it does not require the actor to
sit in the middle of the frame.
At normal and boundary views, keep the decision area, relevant actor and cues legible. Tune from
actual geometry, not another prototype's numbers.

For reticle aim, construct the ray through the reticle's actual CSS position using the gameplay
camera. Keep CSS pixels distinct from drawing-buffer/DPR pixels. Preview and shot resolution must
use the same target ordering and cover policy. Decide whether near-muzzle obstruction can block a
camera-visible target; display feedback consistent with that rule.

`assets/gameplay/combat/CameraRayShotResolver.js` resolves camera-centered nearest hits against
live world AABBs and blocker meshes. Caller owns target lifecycle, feedback and tracer rendering.
AABB hits are an approximation; blocker mesh rays retain material sidedness. Origins inside solids,
fallen/animated targets and weapons needing a non-centered ray require an explicit fitting policy.

Read [camera catalog](../../assets/catalogs/camera.md) and the selected aiming API. When a muzzle
tracer is visual, it must lead to the resolved impact rather than a separately computed target.
Remove defeated targets consistently from preview and hit tests. A hit, block or miss needs an
observable outcome; ammo loss alone cannot establish a successful hit.

## Verify and record

Verify actual camera/reticle alignment, relevant near/far and cover cases, input direction and
pause/restart. Include moving targets only when present. Keep any stationary diagnostic target
separate from final live evidence. Numeric tuning belongs in the game's parameter source.
Record resolved hit/block/miss and inspected normal-view feedback with the current artifact.

## Troubleshooting

| Symptom | Likely cause | Remedy and recheck |
| --- | --- | --- |
| Aim is offset after resize, DPR change or canvas repositioning | CSS coordinates, canvas-relative coordinates and drawing-buffer pixels are mixed | Convert the reticle relative to the canvas CSS bounds into NDC using the gameplay camera. Recheck center and off-center positions at the affected viewport/DPR. |
| Preview marks one target but the shot hits another or crosses cover | Preview and resolution use different rays, target lists, transforms or blocking policies | Share the query policy and live data; draw the tracer to the resolved impact. Recheck overlapping targets and the relevant cover edge. |
| A nearby wall blocks a camera-visible target without explanation | Camera visibility and muzzle obstruction follow inconsistent rules | Choose the near-muzzle rule explicitly and reflect blockage in the preview/feedback. Recheck close cover and a clear shot. |
| Defeated or moving targets leave phantom hits | Stale target entries or outdated world bounds remain in a query | Update/remove targets consistently in preview and hit tests. Recheck movement, defeat and restart. |
| A correctly resolved target or cue cannot be read in normal play | Framing, occlusion or scale was inspected only in a diagnostic view | Apply [presentation diagnostics](greybox-kit.md#troubleshooting) at the actual decision state, then repeat the aim check from that view. |
