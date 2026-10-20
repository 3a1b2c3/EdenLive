# World bounds collider factory

[Source](../../assets/world/environment/WorldBoundsColliderFactory.js) builds four fixed Rapier wall
colliders around a planar play area, so nothing physical leaves it. It is collision only: no meshes,
no materials and no rendering, so it does not implement the
[scene-visual profile](asset-factory-contract.md#scene-visual-interface-profile). Visible walls, if the
game needs them, are separate geometry.

Walls are placed through a [WorldBasis](../../assets/math/WorldBasis.js), so the same call is correct
under any axis convention. Non-physical actors are unaffected; keep out-of-bounds rules for those in
game code.

## Exports

```js
createWorldBoundsColliders({ world, rapier, ... })  // [{ body, collider }, ...] of length 4
```

## Parameters

| Option | Default | Effect |
| --- | --- | --- |
| `world`, `rapier` | required | Rapier world and module; either missing throws |
| `minRight`, `maxRight` | -88, 88 | Extent along the basis right axis |
| `minForward`, `maxForward` | -88, 88 | Extent along the basis forward axis |
| `wallThickness` | 1.6 | Wall depth; walls sit fully outside the bounds and overlap at the corners |
| `wallHeight` | 16 | Vertical span; a fast or airborne actor can pass over a short wall |
| `centerUp` | 0 | Vertical center of the walls along the basis up axis |
| `friction` | 1 | Collider friction |
| `restitution` | 0 | Collider restitution; raise it for a bouncing arena |
| `basis` | `DEFAULT_WORLD_BASIS` | Axis convention used to place and rotate the walls |

A `max` that is not greater than its `min` throws, so an inverted or degenerate area fails at build
time instead of producing walls that let actors through. Corner overlap is intentional: side walls
extend by `wallThickness`, leaving no gap at the corners.

## Ownership and disposal

The returned bodies and colliders belong to the Rapier world. Remove them through that world when the
area changes or the prototype tears down; this module has no `dispose()` and holds no references. The
walls are static, so changing the play area means removing and rebuilding them.

## Copy dependencies and usage

```text
assets/world/environment/WorldBoundsColliderFactory.js
assets/math/WorldBasis.js
```

Preserve these paths in the generated project and use its local Rapier dependency.

```js
import { createWorldBoundsColliders }
  from '/assets/world/environment/WorldBoundsColliderFactory.js';

const walls = createWorldBoundsColliders({
  world, rapier, minRight: -40, maxRight: 40, minForward: -60, maxForward: 60, wallHeight: 24,
});
// On teardown: for (const wall of walls) world.removeRigidBody(wall.body);
```

See [World foundations](../../assets/catalogs/world.md) and the
[asset factory contract](asset-factory-contract.md).
