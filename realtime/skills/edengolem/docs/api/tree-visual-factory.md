# Tree visual factory

[Source](../../assets/world/object/factory/TreeVisualFactory.js) implements the
[scene-visual profile](asset-factory-contract.md#scene-visual-interface-profile). It builds
simplified trees and shrubs - one trunk cylinder plus a crown assembled from a couple of
primitives - with an optional wind sway. No branches, twigs, roots, leaf clusters, fruit or
flowers, and no shape seed, so the same parameters always give the same tree. It owns no growth
simulation, wind field, collision or scattering logic. No browser globals, textures or extra
package dependencies are used. The [world-visuals catalog](../../assets/catalogs/world-visuals.md)
entry summarizes the module.

## Exports and construction

```js
buildSimpleTreeVisual(options = {})              // instance
normalizeSimpleTreeOptions(options = {})          // frozen resolved options
randomSimpleTreeOptions(seed = 1, overrides = {}) // frozen resolved options
SIMPLE_TREE_PRESETS   SIMPLE_TREE_SCHEMA   SIMPLE_TREE_MOTIONS
// Historical aliases, kept for consumers of the original module:
createTreeVisual(options = {})   buildTreeVisual(options = {})
normalizeTreeOptions(options = {})  randomTreeOptions(seed = 1, overrides = {})
TREE_PRESETS  TREE_SCHEMA  TREE_MOTIONS
```

Presets: `oak` (default), `maple`, `birch`, `pine`, `fir`, `cypress`, `palm`, `acacia`, `willow`,
`cherry`, `baobab`, `shrub`, `dead`. `SIMPLE_TREE_PRESETS`, `SIMPLE_TREE_SCHEMA` and nested
palettes are frozen. Options are copied, never mutated; changing geometry after creation requires
disposing and rebuilding rather than mutating `params`.

Normalization applies preset values, then explicit options, then per-field defaults and clamps.
Finite out-of-range numbers clamp; `step: 1` fields round to integers. Invalid number types, `NaN`
and infinities throw `TypeError`; unsupported enum values throw `RangeError`; non-boolean booleans
and malformed colors throw. `options` and `options.colors` must be plain objects. Unknown keys are
ignored. An omitted numeric field uses the preset's value; an explicit `undefined` falls back to
the per-field default. Colors merge base palette, then preset palette, then explicit per-key
colors. Normalization is idempotent.

`SIMPLE_TREE_SCHEMA` carries `when` predicates for preview field visibility only; normalization
resolves every field regardless, so `params.layers` is populated even for a broadleaf that ignores
it. The parameter table states which options actually affect which forms.

### Seeded options and determinism

- `randomTreeOptions(seed)` samples option values. It uses the shared instance-local LCG in
  [VisualFactoryUtils](../../assets/world/object/factory/VisualFactoryUtils.js), never shared
  random state, and requires an integer seed.
- Shape scatter is no longer seeded: `shapeSeed` was removed, and geometry is fully determined by
  the resolved options. Two instances with equal resolved options build identical geometry, and
  `createTreeVisual({ preset: 'oak' })` is reproducible without going through
  `randomTreeOptions` at all.

Variation across a forest therefore comes from distinct resolved options (a random preset, palette
or height per tree) rather than a shape seed. A seed alone does not pin an algorithm version, so
save resolved `params` when particular trees must be rebuildable.

## Parameters

Numbers are scene units unless noted as a ratio. Defaults below are
`normalizeSimpleTreeOptions({})`, which resolves the `oak` preset.

| Option | Default | Range / values | Effect |
| --- | --- | --- | --- |
| `shape` | `blob` | `blob`, `cone`, `layered`, `column`, `umbrella`, `fan`, `bare` | Crown assembly; decides which options apply |
| `height` | 7 | 1.2..16, step 0.1 | Nominal total height |
| `crownWidth` | 6 | 1..10, step 0.1 | Crown spread |
| `crownRatio` | 0.55 | 0.2..0.85, step 0.05 | Crown height as a fraction of `height`; ignored for `bare` |
| `trunkRadius` | 0.25 | 0.06..1.2, step 0.02 | Trunk thickness; the tip keeps 70% of the base radius |
| `layers` | 3 | 2..5, step 1 | Stacked crown tiers; `layered` only |
| `wind` | 0.45 | 0..1, step 0.05 | Sway amplitude used by `setPose`; 0 disables sway entirely |
| `colors` | See below | Per-key `0xRRGGBB` or `#RRGGBB` | Palette overrides |

Base colors: `bark: '#8b7155'`, `leaf: '#699779'`. Materials are matte flat-shaded
`MeshStandardMaterial`. Geometry and materials are cached within an instance and distinct across
instances. Meshes cast and receive shadows; lighting and renderer shadow enablement belong to the
caller.

The previous form options are gone: `type`, `crownShape`, `trunkTaper`, `trunks`, `lean`,
`branches`, `clusters`, `irregularity`, `droop`, `roots`, `fruit`, `flowers` and `shapeSeed` no
longer exist, and the palette sheds `leafLight` and `fruit`. The crown shapes are fixed: `blob` is
a scaled icosahedron, `cone`/`column`/`umbrella` are tapered cylinders, `layered` stacks shrinking
tiers, `fan` spreads four flattened fronds, and `bare` keeps three branch beams.

## Instance API

| Port | Semantics |
| --- | --- |
| `group`, `mesh` | Same `Group`; +X right, +Y up, -Z forward. A tree is radially symmetric, so forward carries no meaning. Origin is at the trunk base on the ground plane. |
| `params` | Frozen normalized options including the resolved palette. |
| `bounds`, `dimensions` | Construction-time local `Box3` and `Vector3` size in the rest pose, covering trunk and crown. `bounds.min.y` is 0: the root is seated on the ground plane. Unchanged by `setPose`. |
| `rig` | The internal `wind-rig` `Object3D` (a child of the root, holding trunk and crown) that `setPose` rotates about the ground-level origin. Exposed for inspection; treat its transform as factory-owned. |
| `motions` | `{ still: 'still', wind: 'wind sway' }` motion key map; there is no `actions` catalog and no `actionState`. |
| `setPose(motion = 'still', seconds = 0)` | Deterministic sway sample at a finite absolute time. `wind` sets `rig.rotation.z = sin(seconds * 1.35) * 0.025 * wind` and `rig.rotation.x = sin(seconds * 0.85) * 0.014 * wind`; `still` zeroes both. Rotates `rig` only; the root's position, rotation and scale are untouched. Returns the instance. |
| `reset()` | Restores the `still` rest pose. |
| `getStats()` | `{ meshes, triangles, geometries, materials }`; triangles sum mesh occurrences. Inspection only, not a performance guarantee. |
| `dispose()` | Idempotent. Detaches the root and releases owned geometries/materials once. `setPose`/`reset` after disposal throw. |

`setPose` takes absolute seconds and holds no clock of its own, so there is no `update(dt)`: pass
your accumulated time each frame and the pose follows, and pass 0 (or `reset()`) to return to rest.
A non-finite time throws `TypeError` and leaves the pose unchanged; an unknown motion throws
`RangeError`. With `wind: 0` the pose is a no-op at every time, which is the cheap way to freeze a
scene's foliage.

There is no `collisionHint`. Trunk collision is usually a small cylinder at the origin rather than
`bounds`, which covers the whole crown; choose the radius from `trunkRadius` and your own
tolerance. Local bounds do not become world bounds when the root moves; transform a copy, and note
that rotating an AABB yields a conservative AABB.

## Practical limits

This is a coarse silhouette: each tree is a handful of meshes - trunk plus one crown shape
(`blob`/`cone`/`column`/`umbrella`: 2 meshes, `bare`: 4, `fan`: 5, `layered`: `1 + layers`). There
are no individual leaves, no bark texture, no branch collision and no seasonal states beyond
swapping palettes. Sway is a whole-rig rotation about the ground-level origin with fixed constants,
not per-branch motion, and it does not respond to a wind direction or scale.

For a forest, prefer low `layers`, reuse a small set of instances, or share one instance's
`params` across placements rather than creating a distinct instance per tree, since each instance
owns its own geometry and material caches.

## Copy dependencies and usage

Copy these runtime sources preserving paths below `assets/`:

```text
assets/world/object/factory/TreeVisualFactory.js
assets/world/object/factory/VisualFactoryUtils.js
```

`assets/math/RandomUtils.js` is no longer needed by this factory: the seeded sampler lives inside
`VisualFactoryUtils.js`. Use the project's local Three.js dependency and import map. For scattered
natural props, [NaturalEnvironment](../../assets/world/environment/NaturalEnvironment.js) already
composes this factory (`buildSimpleTreeVisual`/`randomSimpleTreeOptions`) and owns its own
placement and terrain sampling.

```js
import { createTreeVisual } from '/assets/world/object/factory/TreeVisualFactory.js';

// Distinct resolved options give varied silhouettes from one intentional design:
const trees = [
  { preset: 'pine', height: 9 },
  { preset: 'oak', height: 7 },
  { preset: 'willow', crownRatio: 0.62 },
].map((options, i) => {
  const tree = createTreeVisual(options);
  tree.group.position.set(i * 6 - 9, 0, -14);   // caller owns placement
  scene.add(tree.group);
  return tree;
});

// Inside the caller's loop, after gameplay has advanced its own clock:
for (const tree of trees) tree.setPose('wind', elapsedSeconds);
// On round reset: tree.reset() restores the rest pose.
// On teardown: for (const tree of trees) tree.dispose();
```

## Verify and record

Save resolved `params` with the run's tuning data so the exact tree can be rebuilt. See the
[composition pattern](../../grimoire/patterns/parameterized-visual-factory.md) for basis
adaptation, the [browser preview](../../assets/examples/factory-preview/index.html) for a live
consumer, and [regression tests](../../forge/tests/js/world-asset-factories.test.mjs) for
construction across presets and forms, option validation, precedence, determinism from resolved
params, sway determinism, root preservation under pose, extreme legal inputs and ownership. The
preview is component evidence, not a final gameplay acceptance pass.