# Terrain mesh factory

[Source](../../assets/world/environment/TerrainMeshFactory.js) turns a terrain sampler into a
vertex-colored render mesh and, separately, a matching Rapier trimesh collider. It does not implement
the [scene-visual profile](asset-factory-contract.md#scene-visual-interface-profile): there are no
presets, no normalized `params`, no `getStats()` and no factory `dispose()`. It returns a bare
`THREE.Mesh` and a `{body, collider}` pair, both owned by the caller.

Terrain height, normals and colors come from a sampler such as
[TerrainSampler.js](../../assets/world/environment/TerrainSampler.js); this module only samples it on
a grid. Rendering supplies no collision, and the collider supplies no rendering: request each one
when the mechanic needs it.

## Exports

```js
createTerrainMesh({ terrainSampler, size, segments, materialOptions })   // THREE.Mesh
createTerrainTrimeshCollider(world, rapier, mesh, friction, restitution) // { body, collider }
```

## Parameters

| Option | Default | Effect |
| --- | --- | --- |
| `terrainSampler` | required | Must expose `sample(right, forward)` returning `{height, color?}`; optional `noise2D` tints the default palette |
| `size` | 184 | Square extent in scene units, centered on the origin; clamped to at least 0.001 |
| `segments` | 220 | Grid divisions per side; floored and clamped to at least 1. Vertex count is `(segments + 1)²` |
| `materialOptions` | `{}` | Merged into a `MeshStandardMaterial` that keeps `vertexColors: true` |

A missing `terrainSampler.sample` throws. `createTerrainTrimeshCollider` throws without both `world`
and `rapier`, or when the mesh has no indexed geometry. Its `friction` defaults to 1.2 and
`restitution` to 0.

Where the sampler returns no `color`, a built-in grass-to-ridge ramp derived from height is used, so
the mesh is readable before any palette work. Vertex normals and an index buffer are computed at
build time; the index array widens to `Uint32Array` above 65535 vertices. The mesh receives shadows
and does not cast them.

## Ownership and disposal

The caller adds the mesh to a scene, positions it, and disposes its geometry and material — for
example with [Object3DUtils](../../assets/world/Object3DUtils.js). The collider is built from the
mesh's world-space vertex data at call time, so rebuild it after changing terrain or transforming the
mesh; the pair is removed through the Rapier world, not by this module. Nothing here steps physics,
streams chunks or reacts to sampler changes.

## Copy dependencies and usage

```text
assets/world/environment/TerrainMeshFactory.js
assets/world/environment/PlanarUtils.js
```

Preserve these paths in the generated project and use its local Three.js 0.161.0 dependency. The
collider entrypoint additionally needs the project's Rapier dependency.

```js
import { createTerrainMesh, createTerrainTrimeshCollider }
  from '/assets/world/environment/TerrainMeshFactory.js';

const terrain = createTerrainMesh({ terrainSampler, size: 240, segments: 160 });
scene.add(terrain);
const ground = createTerrainTrimeshCollider(world, rapier, terrain);
// On teardown: dispose the mesh resources and remove ground.body from the Rapier world.
```

See [World foundations](../../assets/catalogs/world.md) and the
[asset factory contract](asset-factory-contract.md).
