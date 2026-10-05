# Aircraft visual factory

[Source](../../assets/world/object/factory/AircraftVisualFactory.js) builds simplified fixed-wing
aircraft: a block fuselage, flat hinged wing panels, tail, engines and landing gear, with optional
cannon and missile presentation on the fighter presets. The full flight action set of the previous
full-featured factory still runs on these simpler airframes; cabin windows, liveries, fighter
intakes, wing-root extensions, winglets, biplane struts, gear door panels, rotor hubs and missile
fins are gone. Use it when these silhouettes fit the brief. The game owns flight, taxi travel,
ammunition and collision. Read the [shared contract](asset-factory-contract.md) for normalization,
coordinates and lifetime, and the [world-visuals catalog](../../assets/catalogs/world-visuals.md)
entry for the module summary.

## Exports and construction

```js
buildSimpleAircraftVisual(options = {})              // instance
normalizeSimpleAircraftOptions(options = {})          // frozen resolved options
randomSimpleAircraftOptions(seed = 1, overrides = {}) // frozen resolved options
SIMPLE_AIRCRAFT_PRESETS              SIMPLE_AIRCRAFT_SCHEMA
SIMPLE_AIRCRAFT_PRESET_LOCKED_FIELDS SIMPLE_AIRCRAFT_MOTIONS
// Historical aliases, kept for consumers of the original module:
createAircraftVisual(options = {})   buildAircraftVisual(options = {})
normalizeAircraftOptions(options = {})  randomAircraftOptions(seed = 1, overrides = {})
AIRCRAFT_PRESETS  AIRCRAFT_SCHEMA  AIRCRAFT_MOTIONS  AIRCRAFT_PRESET_LOCKED_FIELDS
```

Presets: `trainer` (default), `biplane`, `seaplane`, `twinprop`, `turboprop`, `glider`, `business`,
`airliner`, `jumbo`, `cargo`, `delta`, `flyingwing`, `helicopter`, `lightFighter`, `twinFighter`,
`canardFighter`, `stealthFighter`, `forwardFighter`. `SIMPLE_AIRCRAFT_PRESETS`,
`SIMPLE_AIRCRAFT_SCHEMA` and nested palettes are frozen. Options are copied, never mutated; changing
geometry after creation requires disposing and rebuilding rather than mutating `params`.

The [shared normalization rules](asset-factory-contract.md#options-coordinates-and-lifetime)
apply. When an explicit preset is named, the silhouette fields listed in
`SIMPLE_AIRCRAFT_PRESET_LOCKED_FIELDS` are fixed to the preset even if the caller passes them;
`length`, `width`, `wingspan` and `dihedral` remain overridable. Without an explicit preset the
`trainer` preset resolves incidentally, and explicit overrides are honored without locking.
`randomSimpleAircraftOptions` picks a random preset, keeps every locked and motion field, and
randomizes only `length`, `width`, `wingspan` and `dihedral` before applying overrides. Save
resolved `params` for reproduction. Schema `when` predicates indicate applicable fields;
`derived: true` means preset-set, never randomized.

## Parameters

Numbers are scene units unless noted as a ratio or degrees. Defaults below are
`normalizeSimpleAircraftOptions({})`, which resolves the `trainer` preset.

| Option | Default | Range / values | Effect |
| --- | --- | --- | --- |
| `type` | `propeller` | `propeller`, `biplane`, `jet`, `glider`, `flyingwing`, `helicopter` | Airframe assembly and which options apply; preset-set |
| `length` | 7 | 4..42, step 0.25 | Fuselage length (Z) |
| `width` | 1.2 | 0.65..5, step 0.05 | Fuselage diameter; also scales engines, gear and detail |
| `wingspan` | 9 | 5..42, step 0.25 | Main wing span, floored at `width * 1.8` at build time |
| `bodyStyle` | `round` | `round`, `box`, `tapered` | Fuselage cross section; preset-set |
| `wingChord` | 0.24 | 0.1..0.7, step 0.01 | Wing root chord as a fraction of `length`; not `helicopter`; preset-set |
| `wingTaper` | 0.46 | 0.1..1, step 0.02 | Tip chord as a fraction of root chord; not `helicopter`; preset-set |
| `wingSweep` | 0.12 | -0.45..0.8, step 0.02 | Tip offset toward +Z as a fraction of half-span; negative is forward-swept; not `helicopter`; preset-set |
| `wingPosition` | 0 | -0.12..0.2, step 0.01 | Wing offset along Z as a fraction of `length`; not `helicopter`; preset-set |
| `wingLevel` | `high` | `low`, `mid`, `high` | Wing height on the fuselage; not `biplane`, `helicopter`; preset-set |
| `dihedral` | 4 | -5..18 degrees, step 1 | Wing upward angle; negative is anhedral; not `helicopter` |
| `engines` | 1 | 1..4, step 1 | Engine count; the build ignores it for `glider` and `helicopter`; preset-set |
| `engineMount` | `wing` | `wing`, `rear` | Rear-fuselage mounting, applied to jets only; preset-set |
| `tail` | `standard` | `standard`, `t`, `twin`, `v`, `none` | Tail form; not `flyingwing`, `helicopter`; preset-set |
| `tailSpan` | 0.3 | 0.15..0.5, step 0.02 | Tailplane span as a fraction of `wingspan`; not `flyingwing`; preset-set |
| `tailHeight` | 1.15 | 0.6..2.2, step 0.05 | Fin height as a multiple of `width`; not `flyingwing`; preset-set |
| `landingGear` | `wheels` | `wheels`, `floats`, `skids`, `retracted` | Gear form; `retracted` builds wheels initially hidden, which can deploy; preset-set |
| `propellerBlades` | 3 | 2..5, step 1 | Blades per propeller; `propeller` and `biplane` only; preset-set |
| `rotorBlades` | 4 | 2..6, step 1 | Main rotor blades; `helicopter` only; preset-set |
| `canards` | false | boolean | Forward canard pair; not `helicopter`, `flyingwing`; preset-set |
| `finCant` | 0 | 0..35 degrees, step 1 | Twin fin cant; `tail: 'twin'` only; preset-set |
| `cannon` | false | boolean | Nose cannon presentation; preset-set |
| `weaponPairs` | 0 | 0..3, step 1 | Missile pairs on wing hardpoints; preset-set |
| `colors` | See below | Per-key `0xRRGGBB` or `#RRGGBB` | Palette overrides |

Base colors: `body: '#e0e5d4'`, `wing: '#ccd5c6'`, `window: '#345368'`, `accent: '#6ca699'`,
`engine: '#657e83'`, `wheel: '#3e4c53'`, `propeller: '#b77f5d'`. All materials are matte
flat-shaded `MeshStandardMaterial`. Geometry and materials are cached within an instance and
distinct across instances. Meshes cast and receive shadows; lighting and renderer shadow enablement
belong to the caller.

Nose length, cockpit rise, engine and weapon size are fixed construction constants (`0.17`, `0.06`
and `1` respectively) - the previous proportions options are gone. Select applicable fields in the
schema or in the [preview](../../assets/examples/factory-preview/index.html).

## Flight actions and controls

`motions` lists `still`, `fly`, `bank`, `pitch`, `yaw`, `controls`, plus `gearUp`, `gearDown`,
`fire` and `launch` when those parts exist. `actions` catalogs only the one-shots
(`gearUp`/`gearDown`/`fire`/`launch`) with `{ label, loop: false, duration }`. Floats/skids build no
gear units, so their gear motion keys and actions are deleted; an unarmed aircraft has no
`fire`, and one without weapon pairs has no `launch`.

| Motion option | Default / range | Meaning |
| --- | --- | --- |
| `surfaceAngle` | 26 / 0..45 degrees | Control surface deflection limit |
| `bankAngle`, `pitchAngle`, `yawAngle` | 24 / 0..60; 12 / 0..35; 15 / 0..35 degrees | Internal airframe attitude amounts |
| `maneuverPeriod` | 4 / 0.5..12 seconds | Named bank/pitch/yaw oscillation period |
| `rotorSpeed` | 1 / 0..3 | Rotor angular rate multiplier |
| `gearDuration` | 1.8 / 0.3..5 seconds | Retraction/deployment time |
| `fireDuration` | 0.9 / 0.3..3 seconds | Bounded cannon burst presentation |
| `launchDuration` | 1.5 / 0.5..4 seconds | Missile launch presentation |
| `launchDistance` | 0.65 / 0.2..1.5 | Visual missile travel in aircraft-length multiples |

These motion fields live in
[AircraftMotion.js](../../assets/world/object/factory/AircraftMotion.js) and are merged into
`SIMPLE_AIRCRAFT_SCHEMA`; they are never randomized.

`setPose(action = 'fly', seconds = 0, controls = {})` supplies absolute sampling. Throwing a number
as the first argument is a shorthand for `('fly', seconds)`. Named `bank`/`pitch`/`yaw` oscillate
the matching attitude input as `sin(seconds * 2π / maneuverPeriod)`; `gearUp`/`gearDown` smooth the
gear extension between endpoints over `gearDuration`; `still` zeroes the rotor phase (engine 0) and
restores the neutral pose. `controls` is the manual-sampling action: it applies only the passed
controls.

**Jets, gliders and flying wings have no rotors, and the plain `fly` motion adds no attitude, so
`setPose('fly', t)` moves nothing on those airframes except the propulsion rotors of propeller
types.** Use `bank`, `pitch` or `yaw` to exercise their control surfaces, or `controls` with a
real control sample.

Use `setFlightPose(seconds, controls)` for evaluated game controls:

| Control | Units and behavior |
| --- | --- |
| `roll`, `pitch`, `yaw` | -1..1; internal attitude and matching control surfaces; default 0 |
| `flaps` | 0..1 deflection; default 0 |
| `gear` | 0..1 extension; defaults to the built state (0 when `retracted`) |
| `distance` | Signed absolute taxi travel in model units for wheel spin; default 0 |
| `engine` | 0..3 rotor rate multiplier; default 1 |

Ailerons, flaps, elevons, ruddervs, canards, elevators and rudders are hinged where the airframe
has them; each side gets its own hinge, and mirrored surfaces move symmetrically. Gear folds rotate
between down and stowed about their folding joints, wheels spin from `distance`, and the (now
doorless) gear nodes still swing through the extension cycle. Propellers and helicopter rotors spin
at an absolute phase of `seconds * 24 * rotorSpeed * engine` (16 for a helicopter) in alternating
directions; this does not integrate changing RPM, so changing `engine` changes phase. Freeze with
`still`.

`setPose` also accepts the third `controls` argument for one-shot samples, so a real flight sample
can accompany a fire burst. Each sample restores the captured neutral pose first; named one-shots
clamp and hold their endpoint, and restarting the clock replays them. `actionState` reports
`{ id, roll, pitch, yaw, flaps, gear, progress, active, finished, phase }`, with `phase` one of
`still`, `loop`, `moving`, `active`, `ready` or `finished`.

## Instance ports, mounts and limits

Shared ports include `group === mesh`, frozen `params`, `actions`, `motions`, `actionState`,
construction local `bounds`/`dimensions`, stats, `reset` and idempotent `dispose`. The airframe uses
+Y up and nose -Z forward, and the root rests so the lowest visible part sits at y = 0 in the
neutral build pose (stowed gear is hidden and excluded from the measured bounds, so it neither
lifts the aircraft nor enlarges the box). Pose sampling leaves the placement root untouched.
`getPoseBounds()` measures a fresh visible world AABB for the current articulation, including
visible gear and effects. Use designed game collision shapes for flight and hit tests.

`rotors` holds the spinning-groups of the propellers, or the main and tail helicopter rotors. There
are no exhaust mounts: the previous empty engine exhaust points and matte nozzles are gone, and
gliders still have neither. Parent any caller-owned exhaust effect to an engine node directly.
`rig` exposes `{ fuselage, surfaces, gear, cannons, missiles }` for inspection; surface records are
`{ root, kind, side }`, gear records `{ root, fold, wheel, radius, door, side }`.

`attachments.muzzles` and `attachments.hardpoints` locate weapons. `getWeaponFrames()` returns
`{ id, kind, origin, direction }` records in world space, with normalized -Z forward direction.
Cannon flash/tracer/recoil and visual missile travel are bounded presentation: the burst pulses
four times inside its duration, and launched missiles dip, travel `launchDistance` body lengths and
disappear at their endpoint. No projectiles with collision, ammunition, targeting or damage are
created; the caller can use frames to spawn its own. There is no cargo door, cockpit interior,
rotor blade flex or aerodynamic simulation.

## Copy and verify

```text
assets/world/object/factory/AircraftVisualFactory.js
assets/world/object/factory/AircraftMotion.js
assets/world/object/factory/TransportMotionUtils.js
assets/world/object/factory/VisualFactoryUtils.js
```

Select the factory with the [transitive copier](asset-factory-contract.md#copy-and-compose); the
motion and primitive helpers follow automatically. Select any caller-owned exhaust effect
separately. Use the independent project's pinned local Three.js dependency.

Inspect the selected airframe, surfaces, gear endpoints, weapon sequence and reset in the
[preview](../../assets/examples/factory-preview/index.html). Verify actual flight integration in the
game. [Action regressions](../../forge/tests/js/extended-factory-actions.test.mjs) and
[world factory checks](../../forge/tests/js/world-asset-factories.test.mjs) cover part availability,
control articulation, endpoint determinism, world frames, bounds and ownership.

```js
import { createAircraftVisual } from '/assets/world/object/factory/AircraftVisualFactory.js';

const plane = createAircraftVisual({ preset: 'lightFighter' });
scene.add(plane.group);
// Each frame after the game evaluates flight state:
plane.group.position.copy(planePosition);
plane.group.quaternion.copy(planeOrientation);
plane.setFlightPose(elapsedSeconds, { roll: aileron, pitch: elevator, yaw: rudder, gear: gearExtension });
// A separate visual attack sample, using seconds since the burst began:
plane.setPose('fire', burstSeconds, { roll: aileron, pitch: elevator, gear: gearExtension });
// Round reset: plane.reset(); teardown: plane.dispose();
```

Choose one sample per frame. When root orientation already includes the full bank/pitch/yaw, keep
internal attitude inputs at zero or account for the additional presentation rotation. If gear
actions are absent, select wheels or retracted wheels rather than floats/skids. If a fighter banks
twice, check root orientation plus internal attitude. If a jet looks frozen under `fly`, switch to
`bank`/`pitch`/`yaw` or evaluated `controls`. If a visual missile disappears, its bounded launch has
finished; create a game projectile when continued travel and hit rules are needed.