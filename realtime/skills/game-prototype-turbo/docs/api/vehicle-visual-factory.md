# Vehicle visual factory

[Source](../../assets/world/object/factory/VehicleVisualFactory.js) builds simplified road
vehicles: a body box, a cabin box and plain wheels. No windows, pillars, lamps, mirrors, bumpers,
livery stripes, spoilers, roof racks, signs, exhaust stacks or fenders, and no suspension or
body-roll rig; cargo variants keep one extra shape so a truck still reads as a truck. Use it for
cars, trucks, buses, tractors and motorcycles fitting the brief. The game supplies travel and
driving state. Read the [shared contract](asset-factory-contract.md) for normalization, coordinates
and lifetime, and the [world-visuals catalog](../../assets/catalogs/world-visuals.md) entry for the
module summary.

## Exports and construction

```js
buildSimpleVehicleVisual(options = {})              // instance
normalizeSimpleVehicleOptions(options = {})          // frozen resolved options
randomSimpleVehicleOptions(seed = 1, overrides = {}) // frozen resolved options
SIMPLE_VEHICLE_PRESETS   SIMPLE_VEHICLE_SCHEMA   SIMPLE_VEHICLE_MOTIONS
// Historical aliases, kept for consumers of the original module:
createVehicleVisual(options = {})   buildVehicleVisual(options = {})
normalizeVehicleOptions(options = {})  randomVehicleOptions(seed = 1, overrides = {})
VEHICLE_PRESETS  VEHICLE_SCHEMA  VEHICLE_MOTIONS
```

Presets: `sedan` (default), `hatchback`, `coupe`, `suv`, `taxi`, `pickup`, `van`, `minibus`, `bus`,
`boxtruck`, `tanker`, `tipper`, `tractor`, `motorcycle`, `scooter`. `SIMPLE_VEHICLE_PRESETS`,
`SIMPLE_VEHICLE_SCHEMA` and nested palettes are frozen. Options are copied, never mutated; changing
geometry after creation requires disposing and rebuilding rather than mutating `params`.

The [shared normalization rules](asset-factory-contract.md#options-coordinates-and-lifetime)
apply. Unlike the aircraft factory there are no preset-locked fields: every schema option can
override its preset value. `type` and `steering` are never randomized. Save resolved `params` to
reproduce geometry and palette. Schema `when` predicates indicate which shape fields affect the
selected type.

## Parameters

Numbers are scene units unless noted as a ratio or degrees. Defaults below are
`normalizeSimpleVehicleOptions({})`, which resolves the `sedan` preset.

| Option | Default | Range / values | Effect |
| --- | --- | --- | --- |
| `type` | `car` | `car`, `pickup`, `van`, `bus`, `boxtruck`, `tanker`, `tractor`, `motorcycle` | Body structure and which options apply |
| `width` | 1.95 | 0.65..3.3, step 0.05 | Track width (+X) |
| `length` | 4.6 | 1.8..12, step 0.1 | Body length (Z) |
| `height` | 1.7 | 1..4.2, step 0.05 | Nominal height; cab and cargo shapes scale against it |
| `cabinRatio` | 0.5 | 0.3..0.72, step 0.02 | Cabin length as a fraction of `length`; `car` only |
| `wheelScale` | 1 | 0.65..1.8, step 0.05 | Wheel radius multiplier |
| `wheelbase` | 0.63 | 0.45..0.8, step 0.01 | Axle separation as a fraction of `length` |
| `rearWheelScale` | 1 | 0.8..1.8, step 0.05 | Rear tire radius multiplier; `tractor` only |
| `axles` | 2 | 2..4, step 1 | Axle count; fixed at 2 for `car`, `motorcycle` and `tractor`; extra axles are placed behind the rear axle |
| `steering` | 0 | -40..40 degrees, step 1 | Front wheel yaw applied at construction; positive steers left |
| `colors` | See below | Per-key `0xRRGGBB` or `#RRGGBB` | Palette overrides |

Base colors: `body: '#80aba0'`, `chassis: '#354852'`, `wheel: '#3f4c51'`, `cargo: '#b7c5b6'`.
Materials are matte flat-shaded `MeshStandardMaterial`. Geometry and materials are cached within an
instance and distinct across instances. Meshes cast and receive shadows; lighting and renderer
shadow enablement belong to the caller.

The previous silhouette options are gone: `bodyStyle`, `cabinPosition`, `cabinWidth`, `windows`,
`cargoHeight`, `bedTilt`, `roofRack`, `roofSign`, `spoiler`, `bumpers`, `mirrors`, `exhaust` and
`stripe` no longer exist. Each structure is fixed - body plus cabin, with one cargo box for
`pickup` (bed), `boxtruck` (box) and `tanker` (cylinder), a saddle-frame build for `motorcycle`,
and a hood-forward cabin for `tractor`. The `tipper` preset uses the `pickup` structure with three
axles; `scooter` shares the `motorcycle` structure.

## Driving actions and controls

`setPose(id = 'still', seconds = 0)` supports exactly two motions, `still` and `drive`. `drive`
converts time to travel at a fixed 6 model units per second and sets each `wheel.pivot` to
`-seconds * 6 / wheel.radius`; `still` zeroes every wheel. There is no `setDrivePose`, no
`turnLeft`/`turnRight`/`slalom`/`bumps` demonstrations, no differential wheel travel, no body
lean, no suspension and no `getWheelTravelRatios`. The placement root is never moved.

Steering is a construction parameter, not a pose input: at build time the axle-0 wheel carriers are
yawed once by `params.steering` degrees about +Y (positive left) and exposed as `steeringPivots`.
The rolling `wheel.pivot` groups hang beneath those carriers, so posing spins wheels on the already
steered mounts; wheel pivots never yaw during posing. To steer in a game, rebuild with a new
`steering` value or yaw the placement root yourself; the factory guarantees neither.

```js
import { createVehicleVisual } from '/assets/world/object/factory/VehicleVisualFactory.js';

const car = createVehicleVisual({ preset: 'suv', colors: { body: '#c0553f' } });
scene.add(car.group);
// Each frame, after the game computes movement:
car.group.position.copy(carPosition);
car.group.rotation.y = carHeading;       // the game owns steering/turn rate
car.setPose('drive', elapsedSeconds);    // fixed 6 units/s wheel phase
// Round reset: car.reset(); reset game motion/odometer separately.
// Teardown: car.dispose();
```

`seconds` is an absolute sample; passing `odometer / 6` reproduces a distance-based phase, but
changing the odometer changes phase. With a scaled root, convert world distance/speed into model
units. The motion is absolute sampling with no hidden clock: there is no `update(dt)` to integrate
into, and repeated identical seconds are idempotent. Non-finite seconds and unknown motion ids
throw and leave the pose untouched.

## Instance ports and limits

Shared ports include `group === mesh`, frozen `params`, `motions`, local construction
`bounds`/`dimensions`, stats, `reset` and idempotent `dispose`. There is no `actions` catalog, no
`actionState` and no `getPoseBounds`. The origin is centered on the vehicle at ground level, +Y up
and -Z forward.

`wheels` contains one record per wheel, `{ pivot, steer, radius, axle, side }`, with the front
axle first and the -X side before the +X side on each axle; motorcycles have one wheel per axle
(`side: 0`). `steeringPivots` holds the axle-0 `steer` groups that were yawed at construction.
Pose sampling owns the `pivot` rotations; direct writes are replaced by the next sample.

`bounds`/`dimensions` are construction-time local rest values; cargo shapes and cabs enlarge them
beyond a typical driving collider, so choose a game-owned body volume and test road clearance.
`getStats()` supports inspection, not a traffic performance guarantee. Each instance has separate
resource caches.

The factory has no opening doors, animated cargo-bed control, trailers or tracked vehicle form.
Steering, lean, suspension travel and wheel ratios were removed with the full-featured factory; the
visual wheel speed is always the fixed 6 units/s of `drive`.

## Copy and verify

```text
assets/world/object/factory/VehicleVisualFactory.js
assets/world/object/factory/VisualFactoryUtils.js
```

Select the factory with the [transitive copier](asset-factory-contract.md#copy-and-compose); the
primitive-helper module follows automatically. Use the independent project's pinned local Three.js
dependency.

Inspect the chosen body, the built-in steering yaw and the fixed-rate drive in the
[preview](../../assets/examples/factory-preview/index.html). Verify actual distance units, steering,
restart and collision in the game. [Action regressions](../../forge/tests/js/extended-factory-actions.test.mjs)
and [world factory checks](../../forge/tests/js/world-asset-factories.test.mjs) cover wheel travel,
steering geometry, deterministic sampling, ground clearance and resource ownership.

If wheels spin too fast under a scaled root, convert travel to model units. If the steering looks
static during `drive`, that is by design - only the construction-time `steering` parameter yaws
the wheels. If you need speed-varying wheel spin, drive the phase yourself with
`setPose('drive', odometer / 6)` and accept the absolute phase, or integrate your odometer at the
fixed rate.