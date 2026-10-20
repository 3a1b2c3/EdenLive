# House visual factory

[Source](../../assets/world/object/factory/HouseVisualFactory.js) implements the
[scene-visual profile](asset-factory-contract.md#scene-visual-interface-profile). It builds coarse
rural houses from stacked boxes plus one roof primitive per block. It is static: there is no pose,
update or reset, and it owns no travel, collision, interior space or door logic. No browser globals,
textures or extra package dependencies are used.

The simplified factory replaced the original detailed factory in place and keeps this module's
historical name. The `SIMPLE_`-prefixed exports are canonical; unprefixed aliases preserve the old
consumer surface. Facade windows, doors as surface detail, shutters, beams, dormers, eaves and the
gambrel roof are gone; the five layouts, five roof silhouettes, chimney, stilts and porch survive
as their coarsest readable shapes.

## Exports and construction

```js
buildSimpleHouseVisual(options = {})               // instance, canonical
normalizeSimpleHouseOptions(options = {})          // frozen resolved options, canonical
randomSimpleHouseOptions(seed = 1, overrides = {}) // frozen resolved options, canonical
SIMPLE_HOUSE_PRESETS                               // frozen
SIMPLE_HOUSE_SCHEMA                                 // frozen
// Compatibility aliases (same functions and records):
// createHouseVisual, buildHouseVisual, normalizeHouseOptions, randomHouseOptions,
// HOUSE_PRESETS, HOUSE_SCHEMA
```

Presets: `cottage` (default), `farmhouse`, `barn`, `chalet`, `cabin`, `stilt`, `longhouse`,
`courtyard`, `twin`, `villa`, `adobe`, `pavilion`. `SIMPLE_HOUSE_PRESETS`, `SIMPLE_HOUSE_SCHEMA`
and nested palettes are frozen. Options are copied, never mutated; changing geometry after creation
requires disposing and rebuilding rather than mutating `params`.

Normalization applies preset values, then explicit options, then per-field defaults and clamps.
Finite out-of-range numbers clamp to the range; fields with `step: 1` round to an integer. Invalid
number types, `NaN` and infinities throw `TypeError`; unsupported enum values and unknown presets
throw `RangeError`; non-boolean booleans and malformed colors throw. Unknown keys are ignored. An
omitted numeric field uses the selected preset's value; an explicit `undefined` falls back to the
per-field default instead. Colors merge base palette, then preset palette, then explicit per-key
colors, so `colors: { roof }` keeps the preset's wall color. `normalizeSimpleHouseOptions` is
idempotent: feeding resolved `params` back returns an equal record.

`SIMPLE_HOUSE_SCHEMA` carries `when` predicates for the preview's field visibility only.
Normalization resolves every field regardless, so `params.roofHeight` is populated even when
`roof: 'flat'` ignores it. Read the parameter table for which options actually affect geometry.

Randomization uses the instance-local seeded generator inside
[VisualFactoryUtils](../../assets/world/object/factory/VisualFactoryUtils.js) and does not consume
shared random state. Seeds must be integers (`1.5` throws). `layout` keeps the sampled preset's
value rather than being randomized, because layout drives which blocks exist. Explicit overrides
win over sampled values. The same seed and factory version give the same resolved options; a seed
alone does not pin an algorithm version, so save resolved `params` when a particular design must be
rebuildable.

## Parameters

Numbers are scene units unless noted as a ratio. Table defaults are the schema defaults;
`normalizeSimpleHouseOptions({})` resolves the `cottage` preset first, so its result is
`width: 4.8`, `depth: 4.2` and `porch: true`.

| Option | Default | Range / values | Effect |
| --- | --- | --- | --- |
| `layout` | `single` | `single`, `lshape`, `tshape`, `courtyard`, `twin` | Which blocks are built |
| `width` | 5 | 3..12 | Main block width (+X) |
| `depth` | 5 | 3..14 | Main block depth (Z) |
| `floors` | 1 | 1..3 | Storeys; main and wings share this count |
| `floorHeight` | 2.6 | 2..4 | Storey height |
| `roof` | `gable` | `gable`, `hip`, `shed`, `flat`, `pyramid` | Roof silhouette; one primitive per block |
| `roofAxis` | `along` | `along`, `cross` | Rotates the ridge 90 degrees, swapping the roof footprint |
| `roofHeight` | 1.7 | 0.6..4.5 | Roof rise; ignored when `roof: 'flat'` |
| `porch` | false | boolean | Rain-shelter slab on two posts toward -Z; suppressed for `courtyard` |
| `chimney` | true | boolean | Chimney block on the main block |
| `stiltHeight` | 0 | 0..3 | Raises every block on four corner posts |
| `colors` | See below | Per-key `0xRRGGBB` or `#RRGGBB` | Palette overrides |

Base colors: `wall: '#e4d2aa'`, `roof: '#718a7b'`. Materials are matte flat-shaded
`MeshStandardMaterial`. Geometry and materials are cached within an instance and distinct across
instances. The factory sets no shadow flags; lighting and renderer shadow enablement belong to the
caller.

## Instance API

| Port | Semantics |
| --- | --- |
| `group`, `mesh` | Same `Group`; +X right, +Y up, entrance faces -Z. The root sits on the ground plane: the construction is shifted so `bounds.min.y` is 0, with `stiltHeight` raising the house inside the root. |
| `params` | Frozen normalized options including the resolved palette. |
| `bounds`, `dimensions` | Construction-time local `Box3` and `Vector3` size covering every block, roof, chimney and porch. |
| `attachments` | `{ entrance }`, an `Object3D` under the root at the main door, floor level (`stiltHeight`; the `courtyard` layout anchors it at the front court). Caller-mounted items stay caller-owned. |
| `getStats()` | `{ meshes, triangles, geometries, materials }`; triangles sum mesh occurrences. Inspection only, not a performance guarantee. |
| `dispose()` | Idempotent. Detaches the root and releases owned geometries/materials once. Caller attachments are not disposed. |

There is no `setPose`, `update` or `reset` because nothing animates. There is no `collisionHint`
either: build collision from `bounds` or from your own boxes per block. Local bounds do not become
world bounds when the root moves or rotates; transform a copy, and remember that rotating an AABB
yields a conservative AABB.

## Practical limits

Walls are solid: there is no interior, and the simplified factory draws no windows or doors at all.
A wing is a second box, not a resolved intersection, so wing and main roofs overlap rather than
mitre. Wing size is a fixed 0.62 of the main block (no longer an option) and wings share the main
block's `floors`. `courtyard` builds a rear hall plus two side blocks and suppresses the porch.
Stilts are plain posts with no entry steps. Each block contributes one walls box, one roof primitive
and, when enabled, four stilt posts and one chimney; the porch adds three meshes. The largest legal
configuration (a stilted `courtyard` with chimneys) is about 21 meshes, against several hundred in
the old detailed factory, so a village of distinct instances stays cheap even though geometry and
material caches still multiply per instance.

## Copy dependencies and usage

Copy these runtime sources preserving paths below `assets/`:

```text
assets/world/object/factory/HouseVisualFactory.js
assets/world/object/factory/ArchitectureParts.js
assets/world/object/factory/VisualFactoryUtils.js
```

`ArchitectureParts.js` is easy to miss because it is not named `*Factory.js`: it supplies the shared
`addSimpleRoof` primitive, and omitting it makes the copied project fail at import. RandomUtils is
no longer a direct dependency; the option helpers use the seeded generator inside
`VisualFactoryUtils`. Use the project's local Three.js 0.161.0 dependency and import map. A caller
that adapts placement with `WorldBasis` additionally copies that module.

```js
import { buildSimpleHouseVisual, randomSimpleHouseOptions }
  from '/assets/world/object/factory/HouseVisualFactory.js';

const house = buildSimpleHouseVisual(randomSimpleHouseOptions(42, { preset: 'farmhouse', floors: 2 }));
house.group.position.set(12, 0, -8);   // caller owns placement
scene.add(house.group);

// Caller-owned collision, in world space, from the local snapshot:
const worldBox = house.bounds.clone().applyMatrix4(house.group.matrixWorld);

// Mount a caller-owned marker at the door:
house.attachments.entrance.add(questMarker);
// On teardown: house.dispose(); remove and release questMarker separately.
```

## Verify and record

Save resolved `params` with the run's tuning data so the exact house can be rebuilt. See the
[composition pattern](../../grimoire/patterns/parameterized-visual-factory.md) for basis adaptation,
the [browser preview](../../assets/examples/factory-preview/index.html) for a live consumer, and
[regression tests](../../forge/tests/js/world-asset-factories.test.mjs) for construction across
presets, option validation, precedence, seeded reproducibility, bounded private resources and
ownership. The preview is component evidence, not a final gameplay acceptance pass.