# Mechanism visual factory

[Source](../../assets/world/object/factory/MechanismVisualFactory.js) builds switches, hazards,
platforms and gates with addressable moving parts. Use it when the game needs their visible states
or motion. The game owns activation, collision, damage and passenger movement. Read the
[shared contract](asset-factory-contract.md) for normalization, coordinates, lifetime and action clocks.

The simplified factory replaced the original detailed factory in place and keeps this module's
historical name. The `SIMPLE_`-prefixed exports are canonical except for the motion catalogues,
which keep their historical `MECHANISM_*` names. Every preset keeps its states, timings and
attachment frames; hazard stripes, sockets, saw teeth, direction arrows and multi-part plates are
gone, drawn as plain blocks instead. The motion catalogue and state machine are inlined in this one
file, so there is no `*Actions.js` helper to copy or wire. Unlike the rock factory, the returned API
exposes its root only as `mesh`: there is no `group` key.

## Construct and select

Exports (canonical): `buildSimpleMechanismVisual`, `normalizeSimpleMechanismOptions`,
`randomSimpleMechanismOptions`, `SIMPLE_MECHANISM_PRESETS`, `SIMPLE_MECHANISM_SCHEMA`,
`SIMPLE_MECHANISM_PRESET_LOCKED_FIELDS`, `MECHANISM_MOTIONS`, `MECHANISM_TYPES`,
`MECHANISM_MOTION_BY_KIND`, `installMechanismActions`, `mechanismVisibleBounds`. Compatibility
aliases: `createMechanismVisual` / `buildMechanismVisual`, `MECHANISM_PRESETS`, `MECHANISM_SCHEMA`,
`MECHANISM_PRESET_LOCKED_FIELDS`, `normalizeMechanismOptions`, `randomMechanismOptions`, and the
`SIMPLE_MECHANISM_MOTIONS` / `SIMPLE_MECHANISM_TYPES` / `SIMPLE_MECHANISM_MOTION_BY_KIND` spellings
of the catalogues. The preset determines `kind`; it is marked `derived: true` and locked in
`SIMPLE_MECHANISM_PRESET_LOCKED_FIELDS`, so an override is replaced. Dimensions, appearance and
timing remain editable. `pressurePlate` is the default.

All ten presets support `still`. Additional actions are available per kind; `instance.motions`
holds the per-kind catalogue and `instance.actions` the resolved specs, with durations and periods
already divided by `actionSpeed`:

| Preset | Static states | Motion actions |
| --- | --- | --- |
| `pressurePlate`, `button` | `released`, `pressed` | `press` once, `switchDuration / actionSpeed` |
| `lever` | `off`, `on` | `toggle` once, `switchDuration / actionSpeed` |
| `spikes` | `retracted`, `extended` | `warning` blink loop, `(1 / warningBlink) / actionSpeed`; `cycle` loop, `(retractedDuration + warningDuration + 2 * spikeMoveDuration + extendedDuration) / actionSpeed` |
| `pendulum` | — | `swing` loop, `swingPeriod / actionSpeed` |
| `liftPlatform` | `down`, `up` | `travel` loop, `motionPeriod / actionSpeed` |
| `rotatingPlatform` | — | `rotate` loop, `rotatePeriod / actionSpeed` |
| `launchPad` | — | `charge` loop, `motionPeriod / actionSpeed`; `launch` once, `launchDuration / actionSpeed` |
| `saw` | — | `spin` loop, `(1 / abs(sawSpeed)) / actionSpeed`; static when `sawSpeed` is zero |
| `gate` | `closed`, `open` | `operate` once, `switchDuration / actionSpeed` |

Static states are keyframes, not clips: `setPose('extended')` or `setPose('open')` samples the
state in full regardless of the seconds argument, so `setPose('extended')` with no time fully
extends the spikes and `setPose('retracted')` returns them. `press`, `toggle` and `operate` move
from released/off/closed to pressed/on/open and hold the endpoint. To return directly, sample the
corresponding static state. For a reversed transition, sample that same one-shot with time
decreasing from its duration toward zero.

```js
import { buildSimpleMechanismVisual } from '/assets/world/object/factory/MechanismVisualFactory.js';

const gate = buildSimpleMechanismVisual({ preset: 'gate', gateLength: 2, switchDuration: 0.8 });
scene.add(gate.mesh);           // this API exposes mesh only; there is no group key
// Game logic starts the opening action and supplies its elapsed time:
gate.setPose('operate', openingSeconds);
const movingBox = gate.getPoseBounds();       // current visible WORLD bounds
// On round reset: gate.reset(); on teardown: gate.dispose();
```

## Tune shape and timing

Dimensions are metres. `referenceHeight` is scale metadata for comparison with a character; it does
not rescale the mechanism. Use the explicit dimensions or caller-owned root scale. Defaults and
ranges below match `SIMPLE_MECHANISM_SCHEMA`; per-kind fields apply only to their kind.

| Group | Main controls and effects |
| --- | --- |
| Kind and size | `kind` (derived from the preset); `referenceHeight` (2.2, 0.8..3.2; `randomize: false`); `width` (1.2, 0.35..5), `depth` (1, 0.35..5), `height` (0.18, 0.08..1.2) |
| Plate and button | `plateTravel` (0.16, 0.02..0.7); `buttonRadius` (0.24, 0.08..0.6), button only |
| Lever | `leverLength` (0.72, 0.3..1.8), `leverAmplitude` (42, 15..80 deg) |
| Spikes | `spikeCount` (5, 2..12), `spikeHeight` (0.62, 0.18..1.8), `retractedDuration` (1, 0.2..4), `warningDuration` (0.8, 0.2..3), `spikeMoveDuration` (0.25, 0.1..1), `extendedDuration` (0.7, 0.2..4), `warningBlink` (4, 0.5..12 Hz) |
| Pendulum | `pendulumLength` (1.45, 0.45..4), `pendulumHead` (0.55, 0.12..1.2), `swingAmplitude` (38, 5..80 deg), `swingPeriod` (2.4, 0.5..8) |
| Lift platform | `platformTravel` (1.05, 0.1..4) |
| Rotating platform | `platformRadius` (0.68, 0.3..2.5), `rotatePeriod` (3.5, 0.5..12) |
| Launch pad | `launchAngle` (24, 5..55 deg), `launchTravel` (0.7, 0.1..3), `launchDuration` (0.9, 0.2..3) |
| Saw | `sawRadius` (0.42, 0.16..1.2), `sawArm` (0.32, 0.1..1.5), signed `sawSpeed` (1.2, -4..4 rev/s) |
| Gate | `gateLength` (1.35, 0.5..4), `gateAngle` (82, 30..110 deg) |
| Shared timing | `actionSpeed` (1, 0.2..3), `switchDuration` (0.6, 0.1..3; plate/button/lever/gate), `motionPeriod` (2.6, 0.5..10; lift/launch) |
| Palette | `body` (#788f8a), `accent` (#d9b769), `warning` (#df7659), `metal` (#b9c6bd), `dark` (#4f6764) |

`actionSpeed` divides action durations and periods. Spikes cycle through retracted, warning,
extending, extended and retracting; the cycle period includes two move durations. Select a static
state when game rules own the phase. `randomSimpleMechanismOptions` preserves the preset kind,
varies the relevant knobs around the preset base within the schema ranges, jitters palette hue and
lightness, and lets explicit overrides win. Inspect full applicable fields through the schema or
[preview](../../assets/examples/factory-preview/index.html).

## Instance ports and ownership

The exposed root is `mesh`, a `Group` named `simple-mechanism-<preset>`, and there is no `group`
alias: consumers that assumed one must be updated. The root is caller-owned and its rest origin sits
on the ground plane (`bounds.min.y` is 0). `setPose(action, seconds)` restores internal parts
before sampling, so action switches and rewinds are deterministic; a non-finite time throws
`TypeError` and an action unknown for the kind throws `RangeError`. `reset()` restores `still`.
`bounds` and `dimensions` describe the visible construction rest pose; hidden retracted parts
(spike field, warning lamps, indicators) are excluded. `getPoseBounds()` returns a fresh world AABB
of currently visible meshes, including any visible caller attachments. It is a conservative
measurement, not a supplied collider or swept volume.

`actionState` reports `id`, `mode`, `phase`, `progress`, `value`, `active` and `finished`, plus
kind-specific extras such as `pressed`, `switched`, `warning`/`warningLit`, `extended`, `height`,
`launched` or `open`, and `angle` where a part rotates. Read only fields relevant to the kind.
These values describe presentation; authoritative switch state and damage windows belong to the
game and should drive the chosen action. Sampling can rewind or skip frames, so do not count an
event whenever a visual boolean is true.

`attachments` includes `base`, `trigger` and its `activation` alias on every kind, plus
working-part mounts: `press` (plates and buttons, pointing -Y), `handle` and `toggle` (lever),
`warning` and `hazard` (spikes), `pivot` and `hazard` (pendulum), `platform` (both platforms),
`launch` (launch pad, pointing -Z), `axis`, `hazard` and its `edge` alias (saw), and `barrier`
(gate, pointing +X). Inspect availability before use. `getAttachmentFrame(name)` returns
`{ origin, direction }` in world space; direction is the mount's normalized **+Y** working axis
transformed by the mount's orientation, such as a downward press. `getAttachmentWorldPosition(name)`
returns just the origin. These differ from creature/aircraft forward attack frames. Unknown mount
names throw.

Effects attached by the caller remain caller-owned when `dispose()` releases factory resources.
There are no automatic triggers, physics colliders, passenger transport, launch impulses or damage.

## Integrate and verify

Select `assets/world/object/factory/MechanismVisualFactory.js` using the
[transitive copier](asset-factory-contract.md#copy-and-compose). The module is self-contained apart
from the shared [VisualFactoryUtils](../../assets/world/object/factory/VisualFactoryUtils.js), which
follows automatically. Sample every action used by the game, its endpoint and reset in the
preview, then verify the actual collision/activation integration.
[Action regressions](../../forge/tests/js/extended-factory-actions.test.mjs) cover phase timing,
endpoints, world attachment frames, visible bounds and resource ownership.

If a rider stays behind, apply the platform's game-owned movement to passengers. If a trap's rest
box misses extended parts, inspect `getPoseBounds()` or use a designed gameplay volume. If an effect
points the wrong way, use the mount's +Y frame instead of assuming actor forward is its working axis.