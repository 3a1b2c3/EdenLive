# Rock visual factory

[Source](../../assets/world/object/factory/RockVisualFactory.js) builds grounded rocks, ridges,
craters and crystal clusters with addressable parts. Use it for natural props that need a
recognizable silhouette, seeded variation or a short named motion. The game owns placement,
collision and scatter. Read the
[shared contract](asset-factory-contract.md) for normalization, coordinates, lifetime and action clocks.

The simplified factory replaced the original detailed factory in place and keeps this module's
historical name. The `SIMPLE_`-prefixed exports are canonical; unprefixed aliases preserve the old
consumer surface. Every preset and all six action types survived; facets, surface chips, sockets,
colour jitter and their knobs did not. The motion catalogue, action installer and state machine are
inlined in this one file, so unlike the house and building factories there is no `*Parts.js` helper
to copy or wire.

## Construct and select

Exports (canonical): `buildSimpleRockVisual`, `normalizeSimpleRockOptions`,
`randomSimpleRockOptions`, `SIMPLE_ROCK_PRESETS`, `SIMPLE_ROCK_SCHEMA`, `SIMPLE_ROCK_TYPES`,
`SIMPLE_ROCK_MOTIONS`, `SIMPLE_ROCK_PRESET_LOCKED_FIELDS`, `installRockActions`,
`rockVisibleBounds`. Compatibility aliases: `createRockVisual` / `buildRockVisual`, `ROCK_PRESETS`,
`ROCK_SCHEMA`, `ROCK_TYPES`, `ROCK_MOTIONS`, `ROCK_PRESET_LOCKED_FIELDS`, `normalizeRockOptions`,
`randomRockOptions`. The preset determines `rockShape` and `kind`; both are marked
`derived: true` and locked in `SIMPLE_ROCK_PRESET_LOCKED_FIELDS`, so an override of either is
replaced. Dimensions, colour and timing remain editable. `boulder` is the default.

All ten presets support the same six actions; `instance.actions` carries the resolved specs with
durations and periods already divided by `actionSpeed`:

| Action | Mode | Timing (after `actionSpeed`) | Effect |
| --- | --- | --- | --- |
| `still` | static | none | Rest pose |
| `rotate` | loop | `rotatePeriod / actionSpeed` | Yaw the moving body |
| `impact` | once | `impactDuration / actionSpeed` | Drop from `impactHeight` and land |
| `settle` | once | `settleDuration / actionSpeed` | Sink within remaining ground clearance |
| `scatter` | once | `settleDuration / actionSpeed` | Push fragment parts (ridge segments, rim pieces, stack rocks, crystals, tail fragments) outward |
| `pulse` | loop | `pulsePeriod / actionSpeed` | Scale the crystal core and crystals; a plain boulder is a no-op |

`scatter` deliberately reuses `settleDuration`: there is no separate scatter-duration knob.
`impact`, `settle` and `scatter` hold their endpoint. `reset()` restores `still`.

```js
import { buildSimpleRockVisual } from '/assets/world/object/factory/RockVisualFactory.js';

const rock = buildSimpleRockVisual({ preset: 'outcrop', lean: 0.12 });
scene.add(rock.group);
rock.setPose('settle', settlingSeconds);
const movingBox = rock.getPoseBounds();       // current visible WORLD bounds
// On round reset: rock.reset(); on teardown: rock.dispose();
```

There is no shape seed: construction is fully deterministic on the resolved options, so two
instances with equal resolved options build identical geometry. `randomSimpleRockOptions(seed)`
varies the editable knobs around the sampled preset for seeded variety.

## Tune shape and timing

Dimensions are metres. `referenceHeight` is scale metadata for comparison with a character; it does
not rescale the rock. Defaults and ranges below match `SIMPLE_ROCK_SCHEMA`.

| Group | Main controls and effects |
| --- | --- |
| Type and size | `rockShape` / `kind` (derived from the preset); `referenceHeight` (2.2, 0.8..3.2; `randomize: false`); `width` (2.4, 0.25..12), `height` (1.55, 0.15..8), `depth` (2.1, 0.25..12) |
| Silhouette | `lean` (0, -0.45..0.45), `buriedAmount` (0, 0..0.8) |
| Ridge | `ridgeLength` (4.8, 0.8..16), `ridgeHeight` (1.15, 0.2..5) — `ridge` only |
| Crater | `craterRadius` (1.25, 0.25..6), `craterDepth` (0.5, 0..2.8), `craterRim` (0.55, 0.05..2.5) — `impactCrater` only |
| Fragments | `meteoriteTail` (0.7, 0..5) — `meteorite` only; a boolean preprocesses to 0.7 / 0. Fragment counts, spread and the contact patch are fixed constants |
| Motion | `actionSpeed` (1, 0.2..3), `settleAmount` (0.12, 0..0.8), `settleDuration` (1.2, 0.2..4), `rotatePeriod` (4, 0.5..14), `impactHeight` (3.5, 0.2..12), `impactDuration` (1.4, 0.2..5), `scatterAmount` (0.38, 0..2), `pulsePeriod` (2.2, 0.4..10) |
| Palette | `body`, `light`, `dark`, `accent`, `crystal`, `impact` |

Finite out-of-range numbers clamp; wrong number types and non-finite values throw `TypeError`; an
unknown preset throws `RangeError` listing the ten preset names. Seeded options preserve the preset
category, keep the derived `rockShape`/`kind` and vary the relevant knobs; colours come from the
palette pool for that seed. Inspect full applicable fields through the schema or
[preview](../../assets/examples/factory-preview/index.html).

## Instance ports and ownership

The placement root is caller-owned and seated on `y = 0` in the rest pose (construction shifts the
built parts so `bounds.min.y` is 0). `setPose(action, seconds)` restores internal parts to their
neutral transform before sampling, so action switches and rewinds are deterministic; a non-finite
`seconds` throws `TypeError` and an unknown action `RangeError`. `bounds` and `dimensions` describe
the visible construction rest pose. `getPoseBounds()` returns a fresh world AABB of currently
visible meshes. Settle never puts visible geometry below `y = 0`; if a large amplitude would, the
internal motion group is nudged up without moving the caller's root.

`actionState` reports `id`, `mode`, `phase`, `progress`, `value`, `active` and `finished`, plus
per-action extras such as `angle` (rotate) and the `falling`/`landed`, `settling`/`settled`,
`scattering`/`scattered` or `pulsing` phases. These values describe presentation; gameplay clocks
and collision stay game-owned.

`attachments` always includes `base`, `center`, `surface`, `top`, `hazard`, `impact`, `focus`
(alias of `surface`) and `activation` (alias of `hazard`). Crater, stack, crystal and meteorite
presets also expose `fragment[i]` / `fragmenti` anchors that travel with their rim pieces, platform
rocks, crystals or tail fragments. `getAttachmentFrame(name)` returns `{ origin, direction }` in
world space; direction is the mount's normalized **+Y** working axis. `getAttachmentWorldPosition`
returns just the origin. Unknown names throw.

`rig` exposes the internal groups (`static`, `motion`, `body`, `fragments`, `core` and per-shape
nodes such as `ridge`, `craterRim`, `stack`, `crystalField` or `tail`); reading them is supported,
mutating them is not. `scaleInfo` carries the frozen reference and rest dimensions. Effects
attached by the caller remain caller-owned when `dispose()` releases factory resources. There are
no automatic colliders or scatter placement.

For a ready-made scatter over terrain,
[NaturalEnvironment](../../assets/world/environment/NaturalEnvironment.js) already composes
this factory with trees and grass.

## Integrate and verify

Select `assets/world/object/factory/RockVisualFactory.js` using the
[transitive copier](asset-factory-contract.md#copy-and-compose). The module is self-contained apart
from the shared [VisualFactoryUtils](../../assets/world/object/factory/VisualFactoryUtils.js), which
follows automatically. Sample every action used by the game, its endpoint and reset in the preview,
then verify the actual collision/placement integration.
[Action regressions](../../forge/tests/js/rock-actions.test.mjs) cover the ten presets, all six
actions, grounded silhouettes, deterministic seeds, attachments and disposal. Shared named-action
checks also live in
[extended factory actions](../../forge/tests/js/extended-factory-actions.test.mjs).