# Gameplay assets

Read only selected APIs; entries are candidates, not required mechanics. A card that declares
`aiming` or `resources` should import a matching combat/resource module or record the skip in
`implementation.catalog_skips`. The gate reads the run page's import graph, not the card
`modules` list. WaveSpawnDirector is a candidate for `autonomous_agents`.

### `assets/gameplay/AimResolver.js`
- Functionality: Resolves screen/camera aiming or explicit ray aiming into hit position, aim direction, matched target, and launch-to-hit shooting direction.

### `assets/gameplay/CombatPlay.js`
- Functionality: Owns team combat player state, health and armor changes, death events, winner resolution, and reset behavior.

### `assets/gameplay/FlightPlay.js`
- Functionality: Owns flight player state, terrain crash checks, hit-ground events, finish state, and reset behavior.

### `assets/gameplay/RaceCheckpointLapPlay.js`
- Functionality: Owns checkpoint-lap race state, countdown start, player progress, lap completion, finish order, standings, race events, and reset behavior.

### `assets/gameplay/BlockGridModel.js`
- Functionality: Occupancy grid for stacking games, indexed from the bottom row: set cells, query blocking, find and clear full rows (compacting several at once), measure column heights, and detect top-out.

### `assets/gameplay/KickableBallModel.js`
- Functionality: A kickable ball whose impulse scales with closing speed along the contact normal, with a per-body contact cooldown, its own gravity/bounce/friction motion, optional field walls, and goal-box tests.

### `assets/gameplay/PaddleBallModel.js`
- Functionality: Side-view paddle-and-ball physics: a constant-speed ball with offset reflection off the paddle (centre hit straight up, edge hit at the max angle), wall and ceiling bounces, and a fell-below-paddle test.

### `assets/gameplay/GridBlastModel.js`
- Functionality: A maze/bomber occupancy grid of OPEN/WALL/BLOCK cells plus the cross-shaped blast a placed bomb produces -- propagating through (and breaking) BLOCK, stopping at WALL.

### `assets/gameplay/SnakePlay.js`
- Functionality: Owns snake player and item state, wall collisions, self collisions, snake collisions, item pickups, death events, and reset behavior.

### `assets/gameplay/WaveSpawnDirector.js`
- Functionality: Schedules and spawns enemy waves, escalates spawn pressure, and advances waves as active units are cleared.

### `assets/gameplay/combat/MeleeAttackSystem.js`
- Functionality: Melee swing as a windup/active/recovery state machine with a wedge-shaped hit test, damage only during the active window, one hit per target per swing, a cooldown, and input buffering for presses made mid-swing.

### `assets/gameplay/combat/KnockbackModel.js`
- Functionality: Accumulating per-fighter damage that scales launch magnitude, producing a launch velocity with an upward component, plus a ring-out test against the stage blast lines.

### `assets/gameplay/combat/ProjectileWeaponSystem.js`
- Functionality: Manages gun and missile weapon selection, ammo, cooldowns, gun heat, missile lock-on targeting, and fire decisions with launch position, direction, and speed.

### `assets/gameplay/combat/ProjectileManager.js`
- Functionality: Manages live projectile objects, removes inactive projectiles, and returns projectile hit events.

### `assets/gameplay/ResourcePool.js`
- Functionality: One counter the round consults - health, lives, stocks, score, a quota, or currency - with gain/lose/spend separated, depletion reported once at the crossing, and a policy saying whether empty ends the round, only decrements, or triggers a partial reset.

### `assets/gameplay/RoundClock.js`
- Functionality: Optional simulation-time game countdown; configurable expiry behavior. Constructor `maxRoundSeconds` defaults to 180 and can be raised explicitly. This game timer is separate from the brief validation allowance; untimed rounds need no clock.

### `assets/gameplay/ObjectiveTracker.js`
- Functionality: What winning means as data: deplete-all, quota, reach, survive or score-lead, with an optional second clause ("clear the room, then reach the exit") that stays locked until the primary is met.

### `assets/gameplay/RoundDirector.js`
- Functionality: Resolves an objective, a clock and any resources into exactly one outcome, latching so a terminal event fires once; deterministic given the same delta and event sequence, which is what makes replay consistency checkable.


### `assets/gameplay/combat/TimedGuard.js`
- Functionality: Simulation-time frontal guard/parry; input edges and reset. Caller supplies action, facing and clock.

### `assets/gameplay/combat/CameraRayShotResolver.js`
- Functionality: Camera-centered nearest hit over live target world AABBs and mesh blockers; caller owns lifecycle/feedback. Mesh sidedness and solid-inside-origin policy need explicit handling.
