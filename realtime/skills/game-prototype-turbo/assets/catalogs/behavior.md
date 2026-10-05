# Behavior assets

Read only selected APIs; entries are candidates, not required mechanics. A card that declares
`autonomous_agents` should import CombatBehaviorDirector or WaveSpawnDirector, or record the skip
in `implementation.catalog_skips`. The gate reads the run page's import graph, not the card
`modules` list.

### `assets/behavior/NearbyAvoidanceSteering.js`
- Functionality: Adjusts planar movement intent to steer an actor away from nearby agents while preserving intended travel direction.

### `assets/behavior/GridPathPlanner.js`
- Functionality: Plans grid-board routes and reachable cells with blocked cells and wrapping or bounded edges. Exports `CARDINAL_NAVIGATION`, the four-way vector table, which is also the `navigation` default — previously every caller hand-rolled it, in the one table where a wrong sign makes a flood fill silently explore the wrong cells.

### `assets/behavior/AgentPathNavigator.js`
- Functionality: Converts character position, current waypoint, and speed limit into planar movement intent, including direction, desired speed, waypoint, and distance.

### `assets/behavior/VisionConeDetector.js`
- Functionality: Per-observer vision-cone detection with a suspicion meter that fills faster at close range, drains when sight is broken, holds an alert briefly through short breaks in cover, and reports the frame an observer becomes alerted. Occlusion is delegated to a caller predicate.

### `assets/behavior/WaypointProgressTracker.js`
- Functionality: Tracks route progress by advancing waypoints after the reach distance is met and reporting the current waypoint, progress, and corner profile.

### `assets/behavior/WaypointDriver.js`
- Functionality: Converts waypoint, vehicle pose, speed, and corner profile into AI vehicle controls, including throttle, reverse, brake, left/right steering, and boost.

### `assets/behavior/CombatBehaviorDirector.js`
- Functionality: Maintains tactical state for shooter agents as they idle, patrol, chase, attack, or die.


### `assets/behavior/PlanarObstacleNavigator.js`
- Functionality: Y-up routes around static yawed boxes. Caller follows and collision-checks waypoints, handles neighbors and refreshes obstacles. Empty route is safe failure, not proof of physical unreachability.
