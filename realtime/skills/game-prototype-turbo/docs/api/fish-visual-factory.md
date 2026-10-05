# Fish visual factory

[Source](../../assets/world/object/factory/FishVisualFactory.js) is the simplified aquatic factory:
one body block, a tail fin wedge, an optional dorsal wedge and two pectoral fins, with swim, attack
and death poses. Use it when this anatomy fits the brief. It follows the
[shared scene-visual contract](asset-factory-contract.md#scene-visual-interface-profile).
The game owns movement, collision and behavior; the factory owns visual construction and motion.

## Exports and construction

```js
buildSimpleFishVisual(options = {})              // canonical instance
normalizeSimpleFishOptions(options = {})          // frozen resolved options
randomSimpleFishOptions(seed = 1, overrides = {}) // frozen resolved options
SIMPLE_FISH_PRESETS
SIMPLE_FISH_SCHEMA
// Compatibility aliases kept under the module's historical name:
createFishVisual(options = {})   // alias of buildSimpleFishVisual
buildFishVisual(options = {})    // alias of buildSimpleFishVisual
normalizeFishOptions             // alias of normalizeSimpleFishOptions
randomFishOptions                // alias of randomSimpleFishOptions
FISH_PRESETS = SIMPLE_FISH_PRESETS
FISH_SCHEMA = SIMPLE_FISH_SCHEMA
```

Presets: `goldfish` (default), `koi`, `carp`, `trout`, `salmon`, `shark`, `ray`, `puffer`,
`clownfish`, `eel`, `whale`, `dolphin`, `seahorse`, `jellyfish`. `SIMPLE_FISH_PRESETS` and
`SIMPLE_FISH_SCHEMA` are deep-frozen. Options are copied, never mutated; changing geometry after
creation requires disposing and rebuilding rather than mutating `params`.

Use the [shared normalization rules](asset-factory-contract.md#options-coordinates-and-lifetime).
Schema `when` predicates indicate preview relevance; irrelevant fields can remain in resolved
`params`. Save resolved options when a design must be rebuilt.

### Seeded option sampling

`randomSimpleFishOptions(seed, overrides)` uses the same instance-local
[seeded generator](../../assets/world/object/factory/VisualFactoryUtils.js) as every simplified
factory: it requires an integer seed, draws a preset at random unless `overrides.preset` is given,
reshuffles every enumeration field, and varies numbers by 0.65x to 1.35x around the preset's values.
`type` is pinned rather than resampled (`randomize: false`), because it names the body plan, and
every combat field is pinned the same way. The randomizer also picks a palette from a five-entry
color pool; the preset's own palette merges underneath and explicit `colors` overrides win. There is
no per-instance shape scatter anymore: two instances with equal resolved options always build
identical geometry, so save resolved `params` when a particular fish must be rebuildable.

## Parameters

Numbers are scene units unless noted as a ratio. The defaults below are the schema fields
(`SIMPLE_FISH_SCHEMA`); an explicit preset overrides them, so `normalizeSimpleFishOptions({})`
resolves the `goldfish` preset.

| Option | Default | Range / values | Effect |
| --- | --- | --- | --- |
| `type` | `bony` | `bony`, `predator`, `ray`, `puffer`, `long`, `cetacean`, `seahorse`, `jellyfish` | Only `jellyfish` changes construction (tentacles appear); the body shape otherwise comes from `bodyStyle` alone, so `ray` no longer builds swept wing slabs. Also picks the shared-action family. Not resampled by `randomSimpleFishOptions` |
| `bodyLength` | 1.8 | 0.55..7, step 0.05 | Body length along Z; also positions tail, fins and tentacles |
| `bodyWidth` | 0.8 | 0.22..3.4, step 0.04 | Body width along X; also scales fin and tentacle thickness |
| `bodyHeight` | 0.85 | 0.25..2.5, step 0.04 | Body height; also sets the root's seat height (`bodyHeight * 0.72`) |
| `bodyStyle` | `torpedo` | `round`, `torpedo`, `flat`, `long` | Body primitive. `round` and `torpedo` are both spheroids; `flat` is a tapered frustum, `long` a box |
| `finSize` | 0.48 | 0.12..1.6, step 0.03 | Dorsal and pectoral fin size |
| `dorsal` | `triangle` | `none`, `triangle`, `sail` | Dorsal wedge; `sail` is 1.5x taller, `none` builds no dorsal |
| `tailShape` | `fan` | `fan`, `fork`, `round`, `ribbon`, `none` | Tail assembly: prism for `fan`/`round`, two mirror lobes for `fork`, a beam for `ribbon`; `none` builds no tail but keeps the mount |
| `tailWidth` | 0.85 | 0.25..2.2, step 0.04 | Tail fin extent; floored against body dimensions |
| `tentacles` | 5 | 2..12, step 1 | Trailing tentacle beams; built only for `type: 'jellyfish'` (preset `jellyfish` sets 7) |
| `tailSwing` | 0.5 | 0..1, step 0.05 | Tail swing amplitude used by the pose sampler; 0 keeps the tail still |
| `swimSpeed` | 2.4 | 0.2..8, step 0.1 | Base swim angular rate in rad/s; forward travel stays caller-owned |
| `colors` | See below | Per-key `0xRRGGBB` or `#RRGGBB` | Palette overrides |

Shared combat fields come from `CREATURE_ACTION_SCHEMA` in
[CreatureActions.js](../../assets/world/object/factory/CreatureActions.js) and are inlined into
this schema; every field is `randomize: false`:

| Option | Default | Range / values | Effect |
| --- | --- | --- | --- |
| `actionSpeed` | 1 | 0.2..3, step 0.05 | Divides the effective duration of pounce, charge and death |
| `pounceDistance` | 0.65 | 0..2, step 0.05 | Pounce travel in rest-length multiples along local -Z |
| `pounceHeight` | 0.28 | 0..1.2, step 0.05 | Pounce rise in rest-height multiples |
| `pounceDuration` | 1.2 | 0.3..3 s, step 0.05 | Pounce duration before `actionSpeed` |
| `chargeDistance` | 1 | 0..3, step 0.05 | Charge travel in rest-length multiples along local -Z |
| `chargeDuration` | 1.35 | 0.3..3 s, step 0.05 | Charge duration before `actionSpeed` |
| `deathDuration` | 1.1 | 0.3..3 s, step 0.05 | Death duration before `actionSpeed` |
| `deathSide` | `right` | `right`, `left` | Side to fall toward |

Base colors: `body: '#688d80'`, `fin: '#4c756f'`, `accent: '#dca860'`. Presets override `body` and
`fin`; the simplified builder paints nothing with `accent` (the dorsal spines that used it were
removed). Materials are matte flat-shaded `MeshStandardMaterial` (roughness 0.72, metalness 0.04).
Geometry and materials are cached within an instance and distinct across instances. The factory does
not set per-mesh shadow flags; lighting and shadow enablement belong to the caller.

## Instance API

| Port | Semantics |
| --- | --- |
| `group`, `mesh` | Same `Group`; +X right, +Y up, -Z forward (the head faces -Z). Origin is below the body on the ground plane, so a fish can be previewed and placed like the other scene visuals. |
| `params` | Frozen normalized options including the resolved palette. |
| `bounds`, `dimensions` | Construction-time local `Box3` and `Vector3` size in the rest pose, covering body, fins, tail and tentacles. `bounds.min.y` is 0: the root is seated on the ground plane. Unchanged by `setPose`. |
| `rig` | The internal `Object3D` holding body, fins, tail and tentacles. Exposed for inspection; treat its transform as factory-owned. |
| `fins` | Two `{ root, baseZ }` entries for the pectoral fins, negative-X side first. The negative-X member is turned a half turn about Y, so one outline serves both sides and `rotation.z` reads as the same wave on each plus the built `baseZ` tilt. There are always exactly two. |
| `dorsal` | Array of dorsal fin meshes: empty when `dorsal` is `none`, otherwise one wedge. |
| `tentacles` | `{ root, phase }` entries; `phase` is the tentacle's angular offset in radians. Built only for jellyfish. |
| `tail` | The tail mount `Object3D` that `setPose` swings; present even when `tailShape` is `none`. |
| `attachments` | `body` (the body group), `tail` and `attack` (added by the shared action installer). Caller-mounted items stay caller-owned. |
| `actions` | Frozen `pounce`/`charge`/`death` specs `{ label, loop: false, duration }`; there is no `mode` field. `duration` is the schema duration divided by `actionSpeed`. |
| `actionState` | Getter returning `{ id, progress, finished, active, phase, heading, inPlace }` for the current sample. See the shared surface below. |
| `setPose(action, seconds = 0, { heading = 0, inPlace = false })` | Absolute named-action sample. Internal joints and visual attack travel change; placement is never touched. Returns the instance. |
| `getAttackFrame()` | World `{ origin, direction }` from `attachments.attack`, with the direction normalized along local -Z. |
| `reset()` | Restores `setPose('still', 0)`; the caller resets its own clock. |
| `getStats()` | `{ meshes, triangles, geometries, materials }`; triangles sum mesh occurrences. Inspection only, not a performance guarantee. |
| `dispose()` | Idempotent. Detaches the root and releases owned geometries/materials once. `setPose` after disposal throws. |

Actions and motions share one surface across the simplified creature factories: `still`, `idle`,
`move`, plus the combat actions `pounce`, `charge` and `death` (all `loop: false`). The detailed
factory's `dart` was removed with it — it no longer exists and `setPose('dart', t)` throws. All four
creature families share exactly the `still`/`idle`/`move` motion set plus the three combat actions.
Display labels live in the shared module
([CreatureActions.js](../../assets/world/object/factory/CreatureActions.js)): `ANIMAL_MOTIONS`
extends the motion ids with `pounce (once)`, `charge (once)` and `death fall (hold)`, and
`animalMotionLabels('fish')` renders `move` as `swim` and `pounce` as `pounce / lunge (once)`. The
installer adds `actions`, `actionState`, `actionRig { heading, travel }`, `attachments.attack`,
`setPose`, `getAttackFrame` and `reset`; there is no `motions` member on the simple creature APIs.

`move` is the swim: the tail sweeps at `swimSpeed` through `tailSwing * 0.42` radians, the pectoral
fins wave around their `baseZ` tilt at 1.2x `swimSpeed`, and jellyfish tentacles sway at 1.5 rad/s
each offset by its `phase`. `idle` samples the same animation at 0.2 amplitude. `still` reliably
freezes the whole visual; zeroing individual motion knobs does not disable attacks or every body
part.

Shared [creature action options](asset-factory-contract.md#creature-actions) control action speed,
attack distance, rise and death side. Off the contract defaults, effective durations are 1.2 s for
`pounce` (a lunge), 1.35 s for `charge` and 1.1 s for `death`; `actionSpeed` divides each, so
`actionSpeed: 2` halves them. Attack travel runs `pounceDistance`/`chargeDistance` rest lengths
inside the root along local -Z. `setPose(action, seconds, { heading, inPlace })` accepts the visual
heading in radians about local +Y; use `inPlace: true` when gameplay already supplies forward
travel — the pounce rise still applies, and `death` never travels. `actionState.phase` reports
`windup`/`active`/`recover`/`finished` (or `falling` for death), `loop` for idle motions and
`still` for the frozen pose; `active` spans progress 0.2 to 0.72 for pounce and 0.8 for charge.
`setPose` throws a `RangeError` on unknown motion names and a `TypeError` on non-finite seconds
(`NaN` included), non-numeric headings or non-boolean `inPlace`, leaving the current pose untouched.
Because this family sets `numericTime`, a bare number is `move` shorthand: `setPose(2.5)` equals
`setPose('move', 2.5)`. `attachments.attack` and `getAttackFrame()` expose a world forward frame
for effects. Gameplay owns damage and hit timing.

The shared `death` poses fish differently from the other animals: ordinary fish roll a half turn
about the body axis (flat again, belly up) while jellyfish (slime-like squash family) compress in
place with their tentacles spreading; quadrupeds and birds tip 90 degrees onto the side chosen by
`deathSide`. The ground-seated origin is a deliberate consequence of sharing the
scene-visual profile: it makes the fish previewable and placeable by the same rule as a tree, but a
swimming caller places by the intended body centre minus `dimensions.y * 0.5` rather than by depth
directly. `swimSpeed` sets the animation cadence only; forward motion, depth, pitch and roll are the
caller's.

There is no `collisionHint`. Fish collision is usually a small sphere or capsule on the body, while
`bounds` spans the spread fins and any tentacles; derive it from `bodyLength`/`bodyWidth` and your
own tolerance. Local bounds do not become world bounds when the root moves; transform a copy, and
note that rotating an AABB yields a conservative AABB.

## Practical limits

This is a coarse silhouette built from a sphere, frustum or box body, extruded prism fins, a mirror
lobe or beam tail and beam tentacles: there are no scales, no skin texture, no gill or mouth
animation and no spine deformation. The tail swings from one rigid mount rather than a body wave
travelling head to tail, so a long `eel` reads less convincingly than a compact fish. Tentacles are
rigid beams that sway at the root, not ropes. For a school, reuse a small set of instances, since
each instance owns its own geometry and material caches.

## Copy dependencies and usage

Select `assets/world/object/factory/FishVisualFactory.js` with the
[transitive copier](asset-factory-contract.md#copy-and-compose); the shared creature actions
([CreatureActions.js](../../assets/world/object/factory/CreatureActions.js)) and the primitive kit
plus normalization helpers
([VisualFactoryUtils.js](../../assets/world/object/factory/VisualFactoryUtils.js)) follow
automatically.

Use the project's local Three.js 0.161.0 dependency and import map. A caller that adapts placement
with `WorldBasis` additionally copies that module.

```js
import { buildSimpleFishVisual } from '/assets/world/object/factory/FishVisualFactory.js';

const school = [0, 1, 2, 3].map(i => {
  const fish = buildSimpleFishVisual({ preset: 'clownfish' });
  scene.add(fish.group);
  return fish;
});

// Inside the caller's loop, after swim motion has been evaluated:
for (const [i, fish] of school.entries()) {
  // The root is seated on the ground plane, so offset by half the height to
  // place by body centre rather than by the lowest fin.
  fish.group.position.copy(swimPath[i]).addScaledVector(up, -fish.dimensions.y * 0.5);
  fish.setPose('move', elapsedSeconds + i * 0.25);   // offset so they do not beat in lockstep
}
// A game-owned lunge: keep the root planted, face heading, sample the attack frame:
school[0].setPose('pounce', 0.7, { inPlace: true, heading: -0.3 });
const { origin, direction } = school[0].getAttackFrame();
// On round reset: fish.reset(); on teardown: for (const fish of school) fish.dispose();
```

## Verify and record

Save resolved `params` with the run's tuning data so the exact fish can be rebuilt. See the
[composition pattern](../../grimoire/patterns/parameterized-visual-factory.md) for basis adaptation,
the [browser preview](../../assets/examples/factory-preview/index.html) for a live consumer, and
[regression tests](../../forge/tests/js/creature-factories.test.mjs) for construction across all
presets and enum/range endpoints, option validation and precedence, seeded determinism, the fixed
fin pair / single dorsal / jellyfish tents, swim determinism, root preservation under pose, extreme
legal inputs, resource ownership and the shared combat surface. The preview is component evidence,
not a final gameplay acceptance pass.

Exercise the selected attacks at start, middle and end, then reset; sample the same time again to
check determinism. [Action regressions](../../forge/tests/js/extended-factory-actions.test.mjs)
cover attack endpoints, in-place travel and world frames. If attack displacement is doubled, enable
`inPlace`. If collision changes with the visual pose, replace a live visual box with a game-owned
body volume.