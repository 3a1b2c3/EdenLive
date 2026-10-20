# Building visual factory

[Source](../../assets/world/object/factory/BuildingVisualFactory.js) implements the
[scene-visual profile](asset-factory-contract.md#scene-visual-interface-profile). It builds coarse
city buildings from box massing plus one roof primitive per topped block. It is static: there is no
pose, update or reset, and it owns no interiors, entrances, occupancy or collision. No browser
globals, textures or extra package dependencies are used.

The simplified factory replaced the original detailed factory in place and keeps this module's
historical name. The `SIMPLE_`-prefixed exports are canonical; unprefixed aliases preserve the old
consumer surface. Facade grids, windows, floor bands, balconies, storefronts, awnings, parapets and
rooftop furniture are gone; the six massing forms, three roof silhouettes and the entrance canopy
survive as their coarsest shapes, and `floors * floorHeight` still sets the real height.

## Exports and construction

```js
buildSimpleBuildingVisual(options = {})               // instance, canonical
normalizeSimpleBuildingOptions(options = {})          // frozen resolved options, canonical
randomSimpleBuildingOptions(seed = 1, overrides = {}) // frozen resolved options, canonical
SIMPLE_BUILDING_PRESETS                               // frozen
SIMPLE_BUILDING_SCHEMA                                 // frozen
// Compatibility aliases (same functions and records):
// createBuildingVisual, buildBuildingVisual, normalizeBuildingOptions, randomBuildingOptions,
// BUILDING_PRESETS, BUILDING_SCHEMA
```

Presets: `apartment` (default), `office`, `skyscraper`, `shop`, `hotel`, `warehouse`, `townhouse`,
`mall`, `tower`, `civic`, `terraces`, `arcade`. `SIMPLE_BUILDING_PRESETS`,
`SIMPLE_BUILDING_SCHEMA` and nested palettes are frozen. Options are copied, never mutated; changing
geometry after creation requires disposing and rebuilding rather than mutating `params`.

Normalization applies preset values, then explicit options, then per-field defaults and clamps.
Finite out-of-range numbers clamp; `step: 1` fields round to integers. Invalid number types, `NaN`
and infinities throw `TypeError`; unsupported enum values and unknown presets throw `RangeError`;
non-boolean booleans and malformed colors throw. Unknown keys are ignored. An omitted numeric field
uses the preset's value; an explicit `undefined` falls back to the per-field default. Colors merge
base palette, then preset palette, then explicit per-key colors. Normalization is idempotent.

`SIMPLE_BUILDING_SCHEMA` carries `when` predicates for preview field visibility only; normalization
resolves every field regardless, so `params.tiers` is populated even when `massing` is not
`setback`. The parameter table below states which options actually affect geometry.

Randomization uses the instance-local seeded generator inside
[VisualFactoryUtils](../../assets/world/object/factory/VisualFactoryUtils.js) and does not consume
shared random state. Seeds must be integers. `massing` keeps the sampled preset's value rather than
being randomized, because it decides which blocks exist. Explicit overrides win. The same seed and
factory version give the same resolved options; save resolved `params` when a design must be
rebuildable.

## Parameters

Numbers are scene units unless noted as a ratio. Table defaults are the schema defaults;
`normalizeSimpleBuildingOptions({})` resolves the `apartment` preset, whose overrides match those
defaults.

| Option | Default | Range / values | Effect |
| --- | --- | --- | --- |
| `massing` | `block` | `block`, `setback`, `podium`, `twins`, `row`, `courtyard` | Which volumes are built |
| `width` | 8 | 4..20 | Footprint width (+X) |
| `depth` | 7 | 4..22 | Footprint depth (Z) |
| `floors` | 6 | 1..30 | Storey count; total height is actually `floors * floorHeight` |
| `floorHeight` | 2.8 | 2.2..5 | Storey height |
| `tiers` | 3 | 2..5 | Stacked setback tiers; `setback` only, clamped to `floors` |
| `taper` | 0.15 | 0.05..0.25 | Per-tier shrink ratio; `setback` only |
| `blocks` | 3 | 2..6 | Row units; `row` only |
| `spacing` | 0.5 | 0.2..4 | Gap between units; `row` and `twins` only |
| `podiumScale` | 1.4 | 1.1..1.8 | Podium footprint multiplier; `podium` only |
| `roof` | `flat` | `flat`, `gable`, `pyramid` | Rooftop treatment; `flat` adds a thin slab |
| `roofHeight` | 2 | 0.8..6 | Rooftop element rise; ignored when `roof: 'flat'` |
| `canopy` | false | boolean | Entrance-canopy slab on two posts at the -Z face |
| `colors` | See below | Per-key `0xRRGGBB` or `#RRGGBB` | Palette overrides |

Base colors: `wall: '#c9c6ab'`, `roof: '#526e71'`. Materials are matte flat-shaded
`MeshStandardMaterial`. Geometry and materials are cached within an instance and distinct across
instances. The factory sets no shadow flags; lighting and renderer shadow enablement belong to the
caller.

## Instance API

| Port | Semantics |
| --- | --- |
| `group`, `mesh` | Same `Group`; +X right, +Y up. The entrance canopy faces -Z, but the massing is otherwise symmetric and has no strong forward axis. The root is seated on the ground plane (`bounds.min.y` is 0). |
| `params` | Frozen normalized options including the resolved palette. |
| `bounds`, `dimensions` | Construction-time local `Box3` and `Vector3` size covering every volume, roof and canopy. |
| `getStats()` | `{ meshes, triangles, geometries, materials }`; triangles sum mesh occurrences. Inspection only, not a performance guarantee. |
| `dispose()` | Idempotent. Detaches the root and releases owned geometries/materials once. |

There is no `setPose`, `update`, `reset`, `attachments` or `collisionHint`. Build collision from
`bounds` for a single volume, or from your own per-volume boxes for `row`, `twins` and `courtyard`
massings, whose footprints extend well beyond `width`/`depth`. Local bounds do not become world
bounds when the root moves; transform a copy, and note that rotating an AABB yields a conservative
AABB.

## Practical limits

Solid boxes with no interior and no facade detail: nothing stands in for windows, entrances or
storefronts beyond the optional canopy. Massing that multiplies volumes also multiplies footprint:
`row` spans roughly `blocks * (width + spacing)` on X and alternates unit storeys between `floors`
and `floors - 1` so the skyline reads as a row, `twins` spans about `2 * width + spacing`, and
`courtyard` wraps four blocks around a yard, so place against `dimensions` rather than `width`.
`podium` needs `floors > 1` to build its podium (the tower steps back from the -Z front) and
`setback` clamps `tiers` to `floors`, distributing storeys across tiers; only the top tier carries a
roof.

Each massing block contributes one structure box plus, when topped, one roof primitive, and the
canopy adds three meshes; the worst legal configuration is a `row` with 6 blocks plus a canopy at 15
meshes. The old facade cell budget and its degradation path are gone entirely: what you request is
what you get, so check `getStats()` only if you are comparing presets.

## Copy dependencies and usage

Copy these runtime sources preserving paths below `assets/`:

```text
assets/world/object/factory/BuildingVisualFactory.js
assets/world/object/factory/ArchitectureParts.js
assets/world/object/factory/VisualFactoryUtils.js
```

`ArchitectureParts.js` is easy to miss because it is not named `*Factory.js`: it supplies the shared
`addSimpleRoof` primitive, and omitting it makes the copied project fail at import. RandomUtils is
no longer a direct dependency; the option helpers use the seeded generator inside
`VisualFactoryUtils`. Use the project's local Three.js 0.161.0 dependency and import map. A caller
that adapts placement with `WorldBasis` additionally copies that module.

```js
import { buildSimpleBuildingVisual, randomSimpleBuildingOptions }
  from '/assets/world/object/factory/BuildingVisualFactory.js';

const tower = buildSimpleBuildingVisual(randomSimpleBuildingOptions(7, { preset: 'office', floors: 10 }));
tower.group.position.set(-20, 0, 30);   // caller owns placement
scene.add(tower.group);

// Check the real footprint before spacing a block of buildings:
const { x: spanX, z: spanZ } = tower.dimensions;
// Caller-owned collision, in world space, from the local snapshot:
const worldBox = tower.bounds.clone().applyMatrix4(tower.group.matrixWorld);
// On teardown: tower.dispose();
```

## Verify and record

Save resolved `params` with the run's tuning data so the exact building can be rebuilt. See the
[composition pattern](../../grimoire/patterns/parameterized-visual-factory.md) for basis adaptation,
the [browser preview](../../assets/examples/factory-preview/index.html) for a live consumer, and
[regression tests](../../forge/tests/js/world-asset-factories.test.mjs) for construction across
presets and massings, option validation, precedence, seeded reproducibility, bounded private
resources and ownership. The preview is component evidence, not a final gameplay acceptance pass.