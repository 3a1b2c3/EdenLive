# Actor Motion assets

Read only selected APIs; entries are candidates, not required mechanics.

### `assets/actor-motion/KinematicBatchResolver.js`
- Functionality: Resolves many kinematic movement requests through Rapier collision and returns grounded/collision outcomes.

### `assets/actor-motion/GeneralVehicleMotionController.js`
- Functionality: Converts local vehicle controls into general-purpose motion with six-axis shifting, four-way path steering, independent body yaw rotation, optional body banking, and instant or acceleration-based response. Supports a wide range of vehicles across aircraft, watercraft, spacecraft, and landcraft.

### `assets/actor-motion/GeneralObjectModelController.js`
- Functionality: Applies caller-provided position and pose frame to object model transforms, with configurable mesh forward direction and optional keep-basis-up alignment.

### `assets/actor-motion/aircraft/AirplaneModelController.js`
- Functionality: Applies flight motion state to airplane visual transforms, including position, yaw, pitch, and roll.

### `assets/actor-motion/aircraft/AirplaneMotionController.js`
- Functionality: Converts local pilot controls for steering, throttle, and boost into fixed-wing airplane motion.

### `assets/actor-motion/character/SupportHeightCommitResolver.js`
- Functionality: Resolves a planned character move against a caller-supplied support height instead of a physics engine, snapping to the surface and reporting the grounded-to-airborne transition when the character walks off a ledge (without which gravity never resumes and coyote time never arms).

### `assets/actor-motion/character/BaseCharacterMotionController.js`
- Functionality: Provides shared grounded character locomotion for position, velocity, yaw/pitch, sprint, crouch, jump, gravity, resolver intent creation, and commit behavior.

### `assets/actor-motion/character/WorldTargetCharacterMotionController.js`
- Functionality: Converts world-space move and face target points into shared character locomotion. Recommended camera pairing: `PositionFollowCameraRig`.

### `assets/actor-motion/character/WorldCardinalCharacterMotionController.js`
- Functionality: Converts world-space left/right/forward/backward movement and rotateCCW/rotateCW input into shared character locomotion. Recommended camera pairing: `PositionFollowCameraRig`.

### `assets/actor-motion/character/HeadingRelativeCharacterMotionController.js`
- Functionality: Converts character-heading-relative forward/backward movement, strafeLeft/strafeRight movement, and turnLeft/turnRight input into shared character locomotion. Recommended camera pairing: `PoseFollowCameraRig`.

### `assets/actor-motion/character/MouseLookCharacterMotionController.js`
- Functionality: Converts local left/right/forward/backward movement plus mouse-look yaw/pitch deltas into shared character locomotion. Recommended camera pairing: `FirstPersonCameraRig` for first-person view or `PoseFollowCameraRig` for third-person chase view. Look yaw is written into the actor, so a camera-relative orbit needs `CameraRelativeCharacterMotionController` instead.

### `assets/actor-motion/character/CameraRelativeCharacterMotionController.js`
- Functionality: Converts WASD in the camera's planar frame, using the orbit yaw each step. Facing is separate: travel direction, an optional lock `faceTarget`, or the current yaw. Recommended camera pairing: `OrbitFollowCameraRig`.

### `assets/actor-motion/ground-vehicle/DriftingPlugin.js`
- Functionality: Adds drift response to dynamic car physics by detecting slip and modifying car control behavior.

### `assets/actor-motion/ground-vehicle/DynamicCarBatchResolver.js`
- Functionality: Resolves dynamic Rapier car physics for multiple actors and returns synchronized car state.

### `assets/actor-motion/ground-vehicle/DynamicCarMotionController.js`
- Functionality: Converts local driver controls for steering, throttle, reverse, brake, handbrake, and boost into dynamic car control intent for full wheel-physics simulation.

### `assets/actor-motion/ground-vehicle/DynamicCarRapierConfig.js`
- Functionality: Builds basis-aware dynamic car setup data for Rapier vehicle controllers.

### `assets/actor-motion/ground-vehicle/CarModelController.js`
- Functionality: Applies car motion state to visual transforms, including vehicle body pose and wheel animation.

### `assets/actor-motion/ground-vehicle/ArcadeCarMotionController.js`
- Functionality: Converts local driver controls for steering, throttle, reverse, and boost into lightweight arcade car motion with basic terrain height/normal following.

### `assets/actor-motion/PlateTiltController.js`
- Functionality: Converts directional tilt controls into smoothed plate rotations and gameplay slope values.

### `assets/actor-motion/LaneRunnerMotionController.js`
- Functionality: Auto-running locomotion across a fixed set of discrete lanes, with interpolated lane changes, a grounded jump, and a timed duck that shortens the collider. Set laneCount to 1 for a plain auto-runner.

### `assets/actor-motion/FlapFlightMotionController.js`
- Functionality: Impulse-driven flight where each flap sets (never accumulates) upward velocity against constant gravity, with a minimum flap interval, optional floor crash and ceiling clamp, and a pitch angle derived from vertical velocity.

### `assets/actor-motion/AutoHopMotionController.js`
- Functionality: Continuous automatic hopping with live mid-air horizontal steering; the caller reports landings to trigger the next hop and may override the bounce per landing for spring pads.

### `assets/actor-motion/TwinStickAimController.js`
- Functionality: Aim direction decoupled from movement, driven by stick, pointer or lock-on target, with a deadzone that holds the last aim, rate-limited turning, and interval-gated manual or automatic fire.

### `assets/actor-motion/SnakeMotionController.js`
- Functionality: Converts snake turn and growth input into updated grid-cell direction and segment state.

### `assets/actor-motion/GridTokenMotionController.js`
- Functionality: A single-cell grid token (push-block mover, grid bomber) that reverses, holds still, buffers a direction between ticks, and refuses a blocked cell; the missing non-serpentine grid mover that `SnakeMotionController` cannot express.

### `assets/actor-motion/TiltRollMotionController.js`
- Functionality: Integrates a ball rolling downhill from a tilt `slopeSignal` against friction, with a max speed clamp; the ball half of a tilt-board game (`PlateTiltController` owns the board).

