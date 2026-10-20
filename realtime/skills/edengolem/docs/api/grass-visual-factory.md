# Grass visual factory

[Source](../../assets/world/object/factory/GrassVisualFactory.js) provides three low-level helpers
for grass fields. It deliberately does **not** implement the
[scene-visual profile](asset-factory-contract.md#scene-visual-interface-profile): there are no
presets, no normalized `params`, no seeded option helper, no `group`, no `bounds`/`dimensions`, no
`getStats()` and no factory `dispose()`. It returns a bare `THREE.Mesh` per blade and leaves the
shared geometry and material in the caller's ownership.

That is the point of the module. A grass field is hundreds of near-identical blades, so the useful
contract is "share one geometry and one material across the whole field" rather than "one owned
instance per blade". The contract's
[admission and scope](asset-factory-contract.md#admission-and-scope) section allows this: category
determines output, and a material/primitive helper need not return a scene root or collision
metadata. Use [TreeVisualFactory](tree-visual-factory.md) or another parameterized visual when you
want a self-owning instance.

For a ready-made scattered field, [NaturalEnvironment](../../assets/world/environment/NaturalEnvironment.js)
already composes these helpers with terrain sampling and placement, and owns the shared pair for you.
Reach for this module directly only when you are scattering grass yourself.

## Exports

```js
createGrassMaterial(color = 0xa2b86a)                     // THREE.MeshStandardMaterial
createGrassBladeGeometry(radius = 0.08, radialSegments = 4) // THREE.ConeGeometry
createGrassBladeVisual({ material, geometry, prng })       // THREE.Mesh
```

There is no `create*Visual(options)` entrypoint returning an instance object, and no
`normalize*`/`random*` pair. These are plain constructors.

| Export | Returns | Ownership |
| --- | --- | --- |
| `createGrassMaterial(color)` | `MeshStandardMaterial` with `roughness: 0.92`. `color` is any Three.js color argument; default `0xa2b86a`. | Caller owns it and must call `.dispose()`. |
| `createGrassBladeGeometry(radius, radialSegments)` | `ConeGeometry(radius, 1, radialSegments)` — a **unit-height** cone centered on its own origin. Defaults 0.08 and 4. | Caller owns it and must call `.dispose()`. |
| `createGrassBladeVisual({ material, geometry, prng })` | A `Mesh` using the supplied geometry and material, with randomized `scale.y` in 0.45..1.2 and `rotation.y` in 0..2π. | The mesh is caller-owned; it borrows the geometry and material and disposes neither. |

All three arguments to `createGrassBladeVisual` are optional and destructured from a required object
argument. `createGrassBladeVisual()` with no argument throws, because there is no default for the
options object itself; pass at least `{}`. Omitting `material` or `geometry` builds a fresh private
one per blade, which defeats the sharing this module exists for — pass both for any field larger
than a few blades. Omitting `prng` uses the shared `DEFAULT_PRNG` from
[RandomUtils](../../assets/math/RandomUtils.js), which consumes shared random state and so is not
reproducible alongside other consumers; pass your own `RandomGenerator` when a field must be
reproducible.

Height variation comes from `scale.y` rather than from per-blade geometry. That is what lets a whole
field share one geometry, and it is why the geometry is built at unit height.

## Coordinates and bounds

A blade is +Y up. The cone is centered on its own origin, so with `scale.y = s` the mesh spans
`-s/2 .. +s/2` in Y: **the origin is at mid-height, not at the base**. Seating a blade on terrain
means offsetting by half its scaled height, or accepting that the lower half sinks below the surface
(which is what `NaturalEnvironment` does, and it reads fine for greybox grass). There is no `bounds`
port; compute one with `Box3.setFromObject` if a consumer needs it.

Blades set `receiveShadow = true` and leave `castShadow` at its default `false`. A few hundred tiny
shadow casters cost far more than they add to a greybox scene. Set `castShadow` yourself on the
returned mesh if a specific shot needs it.

## Lifecycle

There is no `dispose()` on the returned mesh, because it owns nothing. Release resources in the
caller:

- Dispose the shared geometry and material once per field, after removing the blades.
- Remove blades from their parent (or remove the parent group) to drop them from the scene.
- Never dispose the shared pair while other blades still reference it.

Disposing a blade's `geometry`/`material` directly would break every other blade sharing them, which
is the one real failure mode of this design. Keep the shared pair in the field owner, not in a
per-blade helper.

## Practical limits

A blade is a 4-sided cone: there is no bending, wind animation, per-blade color variation, instanced
draw path or LOD. There is no field builder, no scatter or density control and no terrain query here;
placement, spacing and ground following belong to the caller. For animated or dense grass, prefer
`InstancedMesh` or a shader, neither of which this module provides. Practical greybox budgets run to
a few hundred blades per field; `NaturalEnvironment` uses this ceiling with its own count option.

## Copy dependencies and usage

Copy these runtime sources preserving paths below `assets/`:

```text
assets/world/object/factory/GrassVisualFactory.js
assets/math/RandomUtils.js
```

This module does **not** depend on `VisualFactoryUtils.js`, unlike the parameterized visual
factories. Use the project's local Three.js 0.161.0 dependency and import map.

```js
import { Group } from 'three';
import {
  createGrassBladeGeometry, createGrassBladeVisual, createGrassMaterial,
} from '/assets/world/object/factory/GrassVisualFactory.js';
import { RandomGenerator } from '/assets/math/RandomUtils.js';

// One shared pair per field, owned here:
const geometry = createGrassBladeGeometry();
const material = createGrassMaterial('#9fbe6d');
const prng = new RandomGenerator(11);       // reproducible field
const field = new Group();

for (let i = 0; i < 260; i += 1) {
  const blade = createGrassBladeVisual({ geometry, material, prng });
  // Caller owns placement; lift by half the scaled height to seat it on the ground:
  blade.position.set(randomX(), blade.scale.y / 2, randomZ());
  field.add(blade);
}
scene.add(field);

// On teardown, in this order:
scene.remove(field);
geometry.dispose();
material.dispose();
```

## Verify and record

Record the field's seed, blade count and shared-pair colors so the field can be rebuilt; there are no
resolved `params` to save. [Regression tests](../../forge/tests/js/visual-regressions.test.mjs) check
that many blades share one geometry, that height varies, that the default `prng` path works without an
explicit generator, and that blades receive but do not cast shadows.
