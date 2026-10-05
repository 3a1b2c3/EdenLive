# World foundations

Use for intentional simple geometry, mechanical space and functional feedback. Assemble these
alongside fitting [visual factories](world-visuals.md) in Stage 1; wire mechanical behavior in
Stage 2. Menus and boards need their actual pieces, controls and cues. GreyboxKitFactory and
direct Three.js primitives suit abstract shapes, missing small parts and any 3D role the visual
factories do not cover. Prefer box, sphere, cylinder, capsule and plane massing over imported
models or dense custom meshes, without requiring a temporary placeholder version of every actor
or prop. A few large masses and one landmark read better than stacked rings, over-tessellated
cylinders or a field of unique props. Instancing is not a substitute for that judgment; the
gate does not count meshes.

Keep game state, collision and triggers independent of replaceable visuals. A helper below is a
candidate, not a required system. Select terrain sampling and collision when the mechanic needs
them; rendering alone supplies neither. Follow the [asset router](../summary.md) by capability.

### `assets/world/object/factory/GreyboxKitFactory.js`
- Functionality: Art-free building blocks for an early prototype: key light plus ambient, ground grid, lane stripes, a capsule avatar whose height can change for ducking without rebuilding geometry, and box/sphere/ground markers. Pure three, no DOM; every placement goes through WorldBasis. `addKeyLight` takes `color`, `position` and `extent`, so lighting can follow the scene prose and the shadow frustum can cover a space larger than 60 units; `createMarkerBox` takes `emissive` for anything the prose calls glowing; `createGroundRing` and `createGroundLine` draw outlines and pitch markings. A candidate for a custom 3D setting when no specialized environment fits; do not restack its helpers into concentric decoration. Read [Greybox kit API](../../docs/api/greybox-kit-factory.md).

### `assets/world/environment/BoardEnvironment.js`
- Functionality: Builds board scene visuals with grid cells and lighting, supports cell/world coordinate helpers, and exposes grid bounds. Any `cellSize` works (the ground and grid were previously offset by a factor of cellSize at every value but 1); `grid: false` suppresses the cell lines for a board whose walls are the visual.

### `assets/world/environment/BoxObstacleField.js`
- Functionality: Answers BOTH collision questions a greybox layout needs from one set of basis-aligned boxes: `supportHeightAt(position, referenceUp)` for the surface underfoot, and `resolve(position, {radius, height, referenceUp, previousPosition})` to push a character out of anything solid. Whether a box is a floor or a wall is treated as a relationship rather than a flag -- a top at or below the feet (within `stepTolerance`) is standable, a top above them blocks horizontally -- so the same box is a floor when landed on and a wall when run at, which a per-box `stand: true/false` tag always gets wrong in one of those two cases. A support-height query alone gives collision on the TOP FACE ONLY and lets characters walk through the sides of raised boxes. Passing `previousPosition` sweeps the move so fast characters cannot tunnel through thin boxes; `maxSafeStep()` reports the largest per-frame step the discrete path survives without it. Returns `-Infinity` where nothing supports a point, so a fall meant to be fatal is never silently converted into a survivable landing. `findCoplanarTops(boxes, {groundUp})` reports box tops flush with another top or the ground plane -- the z-fighting flicker that appears when a layout authored against ground 0 is re-seated onto a raised floor without re-seating what stands on it.

### `assets/world/environment/PlanarObstacleCollision.js`
- Functionality: Y-up circular-footprint motion against unit-scale yawed box roots with vertical overlap. No slopes, steps or arbitrary rigid-body solver.

### `assets/world/environment/WorldBoundsColliderFactory.js`
- Functionality: Builds physical boundary wall colliders around a basis-aware planar world area. Collision only; visible walls are separate geometry. Read [World bounds API](../../docs/api/world-bounds-collider-factory.md).

### `assets/world/environment/SpawnAreaSampler.js`
- Functionality: Samples planar spawn positions inside optional allowed regions while rejecting blocked regions, using simple rect, circle, polygon, and segment-corridor shape contracts.

### `assets/world/environment/PlanarUtils.js`
- Functionality: Provides shared basis-aware planar geometry and terrain helpers.

### `assets/world/environment/TerrainSampler.js`
- Functionality: Provides terrain sampler classes that expose `heightAt`, `normalAt`, `colorAt`, and `sample(right, forward)` for procedural worlds. Includes natural grassland terrain, archipelago terrain, and road terrain via road flattening.

### `assets/world/environment/TerrainMeshFactory.js`
- Functionality: Builds vertex-colored terrain meshes from terrain sampler output and matching Rapier trimesh colliders. Mesh and collider are requested separately. Read [Terrain mesh API](../../docs/api/terrain-mesh-factory.md).

### `assets/world/object/PickupObject.js`
- Functionality: Updates pickup world state: bob/spin animation, and collection via `tryCollect(position, collectorRadius)` which fires exactly once, plus `isWithinReach` and `reset`. The reach test is planar, so a bobbing pickup does not collect or miss depending on the frame.

### `assets/world/object/ProjectileObject.js`
- Functionality: Updates projectile world state, including linear or homing motion, hit checks, visual updates, and expiry.

### `assets/world/object/HealthBarView.js`
- Functionality: Updates floating world-space health presentation above an entity.

### `assets/world/object/AttackTelegraphView.js`
- Functionality: Attack arc geometry reads the same MeleeAttackSystem object used for hits. Planar arc is not vertical reach or obstruction.

### `assets/world/visual-effects/GroundClickIndicator.js`
- Functionality: Renders a fading ground marker for click or target feedback.

### `assets/world/Object3DUtils.js`
- Functionality: Removes and disposes Three.js object hierarchies, including geometry and material resources.
