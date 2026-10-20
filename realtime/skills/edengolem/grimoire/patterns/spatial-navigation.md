# Collision, occlusion and route planning

Outcome: actual movement and attacks respect the intended obstacle model, with routes when needed.
Use when actors move around solids, agents choose routes or attacks depend on line of sight.
Skip route planning for fixed interactions and agents that only need a prescribed unobstructed
path. Grid worlds can use cell occupancy and GridPathPlanner; general terrain may need a different
planner or physics model. No universal arena, path graph or enemy is required.

## Workflow

Inspect actor footprints, obstacle changes and which consumers need collision, planning or occlusion.
Keep a shared obstacle source for the consumers that exist: rendering, movement, route planning
and attack/detection occlusion. Specify exceptions such as non-solid zone paint or one-way cover.
Refresh consumers when doors, obstacles or live targets change.

Collision constrains actual displacement; planning finds a path around obstacles. A direct chase
with collision can remain stuck at a wall. A route without collision can cross it. Follow useful
waypoints and collision-check every step, sized for the whole actor footprint. Use a sweep or
sufficient substeps where one frame could cross a thin barrier.

For small flat Y-up scenes with static, unit-scale yawed boxes, candidates are
`PlanarObstacleCollision` and `PlanarObstacleNavigator`. The collision module resolves circular
footprints with vertical overlap; it is not a slope, step or general rigid-body solver. The
navigator uses expanded obstacle corners and bounded replanning. Empty output is a safe failure,
not proof no physical route exists; overlapping geometry may hide valid routes from this model.
Use another representation when necessary. See [world](../../assets/catalogs/world.md) and
[behavior](../../assets/catalogs/behavior.md) catalogs.

Choose reachable approach positions when the target stands closer to a wall than an agent can.
Handle no-route explicitly without bypassing collision. Dynamic neighbors need local avoidance or
separation; a static route does not solve crowd congestion or moving platforms. Near-range attacks
may still need obstruction tests; distance alone can allow damage through walls.

## Verify and record

Verify an actual completed detour, safe blocked/no-route behavior and an applicable obstacle update
or fast-motion boundary. For no route-planning requirement, substitute the relevant contact,
occupancy or occlusion check. Reset cached routes and transient movement with the round.
Record the relevant route/contact observations and model limits with the current artifact.
