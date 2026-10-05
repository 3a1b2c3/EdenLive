# Camera assets

Read only selected APIs; entries are candidates, not required mechanics. A `continuous_motion`
card should import one of these follow, orbit or first-person rigs or record the skip in
`implementation.catalog_skips`. The gate reads the run page's import graph, not the card
`modules` list. When movement or camera
controls affect framing, geometry can obscure relevant content, camera modes/modifiers need
coordination, or touch camera gestures share inputs, read
[camera correctness](../../grimoire/patterns/camera-correctness.md) before wiring the view.

For camera-relative WASD with a persistent orbit, pair
`OrbitFollowCameraRig` with `CameraRelativeCharacterMotionController`.
`PoseFollowCameraRig` turns with the body, `LookOffsetCameraRig` recenters when look input
stops, and `MouseLookCharacterMotionController` writes yaw into the actor, so those modules
cannot express a held orbit. The look-at is an aim point; the actor need not be screen-centered.

### `assets/camera/BaseCameraRig.js`
- Functionality: Provides base smoothing and basis-aware pose behavior for concrete camera rigs.

### `assets/camera/PositionFollowCameraRig.js`
- Functionality: Follows a target position with a fixed world-basis offset and fixed viewing angle while looking at the target.

### `assets/camera/PoseFollowCameraRig.js`
- Functionality: Follows a target position and targetFrame with a pose-relative offset and pose-relative look target so the view moves and turns with the target.

### `assets/camera/FirstPersonCameraRig.js`
- Functionality: Follows a target eye position and current forward direction to produce actor-locked first-person view motion.

### `assets/camera/LookOffsetCameraRig.js`
- Functionality: Applies temporary free-look rotation around a target and recenters the view when look input stops.

### `assets/camera/OrbitFollowCameraRig.js`
- Functionality: Persistent third-person orbit around a body-height look-at. Pass the actor origin (typically the feet); `anchorHeight` raises the look-at. Pixel look deltas match `MouseLookDelta` (screen-up positive); `yawInput`/`pitchInput` are radians per second. Look turns the camera, not the actor; releasing look leaves yaw and pitch. Optional lock-on interpolates yaw toward a target the game selects; the rig does not drop lock, so the game can clear it on look or keep it. Configurable distance, planar look-at offset, pitch range and lock blend. The look-at is an aim point, not a rule that the actor is screen-centered. Pair with `CameraRelativeCharacterMotionController` for camera-relative WASD. Call `reset()` with the round.

