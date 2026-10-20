# Train visual factory

[Source](../../assets/world/object/factory/TrainVisualFactory.js) implements the
[scene-visual profile](asset-factory-contract.md#scene-visual-interface-profile). It builds straight
simplified train consists - one box per car on plain wheels - with a rolling wheel pose. No side
windows, doors, livery bands, cab glazing, lamps, pantograph, connecting rods, boiler bands, water
tanks, cowcatcher or steam puffs; the head car keeps just enough massing to tell a steam engine
from a metro or a high-speed nose. Route following, acceleration, track collision and game rules
belong to callers. Imports need only Three.js and the copied utilities; no DOM or external media.
The [world-visuals catalog](../../assets/catalogs/world-visuals.md) entry summarizes the module.

## Exports and construction

```js
buildSimpleTrainVisual(options = {})              // instance
normalizeSimpleTrainOptions(options = {})          // frozen resolved options
randomSimpleTrainOptions(seed = 1, overrides = {}) // frozen resolved options
SIMPLE_TRAIN_PRESETS   SIMPLE_TRAIN_SCHEMA   SIMPLE_TRAIN_MOTIONS
// Historical aliases, kept for consumers of the original module:
createTrainVisual(options = {})   buildTrainVisual(options = {})
normalizeTrainOptions(options = {})  randomTrainOptions(seed = 1, overrides = {})
TRAIN_PRESETS  TRAIN_SCHEMA  TRAIN_MOTIONS  TRAIN_TYPES
```

Presets: `subway` (default), `commuter`, `bullet`, `streetcar`, `diesel`, `freight`, `steam`,
`tank`, `express`. `TRAIN_TYPES` is the frozen array
`['steam', 'diesel', 'metro', 'tram', 'highspeed']`. Presets bundle design choices; `type` chooses
construction branches. In particular, metro/tram share a plain passenger body construction and
differ through their preset proportions/options. A type name is not a different physics model.

Normalization uses preset values, explicit options and then per-field defaults/clamps. Palette
keys merge base, preset and explicit colors. Finite numeric values clamp; counts round after
clamping. Invalid numeric types/NaN/infinity, enums, booleans and colors throw. Options/colors must
be objects. Unknown keys are ignored. Omitted fields use preset values; explicit `undefined`
numeric fields use the per-field fallback.

`randomSimpleTrainOptions` samples preset, dimensions and assembly using the shared
instance-local LCG in [VisualFactoryUtils](../../assets/world/object/factory/VisualFactoryUtils.js),
applies explicit overrides and normalizes. Integer seeds map to 32-bit state; non-integer seeds
throw. Use `createTrainVisual(randomTrainOptions(7, { cars: 2 }))`; constructors do not randomize
from a `seed` option. Each call creates its own generator and does not consume shared random
state. Keep resolved `params` and copied sources for long-lived design records.

## Parameters

Defaults below are the resolved `subway` preset; dimension values are scene units.

| Option | Default | Range / values | Effect |
| --- | --- | --- | --- |
| `type` | `metro` | `steam`, `diesel`, `metro`, `tram`, `highspeed` | Head/body construction branch |
| `width` | 2.15 | 1.5..3.6, step 0.05 | Nominal body width |
| `height` | 3.25 | 2.3..5, step 0.05 | Nominal height; the steam boiler may extend higher |
| `length` | 8.5 | 5..15, step 0.25 | Nominal length of each car, not the whole train |
| `cars` | 2 | 1..6, step 1 | Total cars including the head |
| `gap` | 0.65 | 0.35..1.6, step 0.05 | Nominal gap between car envelopes |
| `coach` | `passenger` | `passenger`, `freight` | Trailing-car body; `freight` builds a cargo container |
| `nose` | 2 | 0.6..4, step 0.1 | High-speed nose, built on both end cars; effective length capped at one third of car length |
| `driveWheels` | 3 | 2..5, step 1 | Steam driver count per side |
| `chimney` | 0.6 | 0.3..1.2, step 0.05 | Steam chimney height multiplier |
| `wheelScale` | 1 | 0.7..1.25, step 0.05 | Wheel radius multiplier |
| `colors` | See below | Per-key `0xRRGGBB` or `#RRGGBB` | Palette |

Base colors: `body: '#dbe6de'`, `chassis: '#293c4c'`, `wheel: '#425465'`. Lamps are gone: no
colored lamp geometry and no light sources. No effect geometry is allocated at all - the steam
puff pool and its options (`smoke`, `boiler`, `tank`, `pantograph`, `windows`, `roof`) no longer
exist. Smoke, light and steam effects are entirely caller-owned.

A steam head builds a boiler cylinder, cab box and chimney plus drive wheels; a diesel head builds
a hood and cab; a high-speed consist gets a streamlined nose on both end cars. Everything else is a
plain body box. Cars sit on radius `min(height * 0.12 * wheelScale, width * 0.24)` bogie wheels,
with the steam driver radius also capped by car length. Nominal consist length is
`cars * length + (cars - 1) * gap`. Use measured bounds for camera framing; wheels, couplers and
the high-speed nose may exceed nominal dimensions. Each car is rigid; curved rail articulation is
outside this factory's behavior.

## Instance API

| Port | Semantics |
| --- | --- |
| `group`, `mesh` | Same `Group`; +X right, +Y up, -Z forward. Origin at rail height and midpoint of the nominal full consist length; the front car points toward -Z. |
| `params` | Frozen resolved options; rebuild to change dimensions/assembly. |
| `bounds`, `dimensions` | Root-local construction-time rest bounds and size of the solid consist, including couplers. Not live bounds during animation. |
| `cars` | Array of `{ mesh, index, centerZ }`; index 0 is the front. `mesh` is a child Group, `centerZ` is root-local. **No `collisionHint` field exists anymore**; the old per-car hints were removed. |
| `collisionHints` | **Absent.** Derive collision volumes yourself from `params` and `cars[i].centerZ`, or measure the car meshes; the factory exports no hints. |
| `wheels` | Array of `{ pivot, radius }` for visual wheel rotation, in build order. |
| `rods` | **Absent.** Connecting rods and piston motion were removed with the previous factory. |
| `attachments` | `front`, `rear` coupling mounts only; the former steam `exhaust` mount is gone. Named `Object3D` children, not world-space points. |
| `setPose(motion = 'still', seconds = 0)` | Absolute visual sample: `roll` rotates every wheel to `-seconds * 4 / radius` (a fixed 4 model units/s wheel phase); `still` zeroes the wheels. Finite seconds required. |
| `update(dt, ...)` | **Absent.** There is no incremental clock and no `update` method; sampling is always absolute seconds. Callers must integrate their own travel clock and pass it in. |
| `reset()` | Restores the `still` pose (wheels zeroed); preserves root transform/parent. |
| `getStats()` | Mesh/triangle/owned geometry/material counts. |
| `dispose()` | Idempotent detach and owned-resource release. Borrowed/caller attachments are not disposed. Pose/reset after disposal throw. |

The instance exposes the two motion keys `still` and `roll` in `motions` (the display label of
`roll` is `drive`), no `actions` catalog and no `actionState`. Pose/reset return the instance.
`seconds` must be finite; invalid or overflowing values throw without committing the sample.
`setPose` uses no time origin of its own, so repeated seconds are idempotent - choose one driving
method (absolute pose) and keep the clock yourself. Scaling the root also scales wheels visually;
convert world distance into model units when sampling wheel motion under scale.

## Copy dependencies and usage

```text
assets/world/object/factory/TrainVisualFactory.js
assets/world/object/factory/VisualFactoryUtils.js
```

The former `RandomUtils.js` dependency is gone: the seeded sampler lives inside
`VisualFactoryUtils.js`. Preserve these paths in the generated project and use its local Three.js
dependency.

```js
import { createTrainVisual } from '/assets/world/object/factory/TrainVisualFactory.js';

const train = createTrainVisual({ preset: 'steam', cars: 3 });
scene.add(train.group);
// After the caller updates actual movement and integrates its own clock:
train.group.position.copy(trainPosition);
train.setPose('roll', trainSeconds);
// Build caller-owned collision boxes from train params and car positions; none are provided.
// On reset: train.reset(); reset actual movement separately.
// On teardown: train.dispose(); release caller-owned colliders/attachments separately.
```

See [composition](../../grimoire/patterns/parameterized-visual-factory.md), the
[browser preview](../../assets/examples/factory-preview/index.html) and
[regression tests](../../forge/tests/js/visual-factories.test.mjs).