# Quadruped visual factory

[Source](../../assets/world/object/factory/QuadrupedVisualFactory.js) is the simplified four-legged
animal factory: one body block, four rigid legs, a neck beam and a head with a snout, plus the
silhouette features that tell species apart (ears, horns, tusks, humps and a tail). Use it when this
anatomy fits the brief. It follows the
[shared scene-visual contract](asset-factory-contract.md#scene-visual-interface-profile).
The game owns movement, collision and behavior; the factory owns visual construction and motion.

## Exports and construction

```js
buildSimpleQuadrupedVisual(options = {})              // canonical instance
normalizeSimpleQuadrupedOptions(options = {})         // frozen resolved options
randomSimpleQuadrupedOptions(seed = 1, overrides = {}) // frozen resolved options
SIMPLE_QUADRUPED_PRESETS
SIMPLE_QUADRUPED_SCHEMA
// Compatibility aliases kept under the module's historical name:
createQuadrupedVisual(options = {})   // alias of buildSimpleQuadrupedVisual
buildQuadrupedVisual(options = {})    // alias of buildSimpleQuadrupedVisual
normalizeQuadrupedOptions             // alias of normalizeSimpleQuadrupedOptions
randomQuadrupedOptions                // alias of randomSimpleQuadrupedOptions
QUADRUPED_PRESETS = SIMPLE_QUADRUPED_PRESETS
QUADRUPED_SCHEMA = SIMPLE_QUADRUPED_SCHEMA
```

Presets: `dog` (default), `cat`, `fox`, `wolf`, `horse`, `deer`, `cow`, `sheep`, `goat`, `pig`,
`rabbit`, `elephant`, `giraffe`, `camel`, `turtle`. `SIMPLE_QUADRUPED_PRESETS` and
`SIMPLE_QUADRUPED_SCHEMA` are deep-frozen. Options are copied, never mutated; changing geometry after
creation requires disposing and rebuilding rather than mutating `params`.

Use the [shared normalization rules](asset-factory-contract.md#options-coordinates-and-lifetime).
Schema `when` predicates indicate preview relevance; irrelevant fields can remain in resolved
`params`. Save resolved options when a design must be rebuilt.

### Seeded option sampling

`randomSimpleQuadrupedOptions(seed, overrides)` uses the same instance-local
[seeded generator](../../assets/world/object/factory/VisualFactoryUtils.js) as every simplified
factory: it requires an integer seed, draws a preset at random unless `overrides.preset` is given,
reshuffles every enumeration and boolean field, and varies numbers by 0.65x to 1.35x around the
preset's values (fields marked `fullRange`, such as `neckAngle`, sample across the whole range).
`type` is pinned rather than resampled (`randomize: false`), because it selects the walk cadence
rather than tuning a built part, and every combat field is pinned the same way. The randomizer also
picks a palette from a five-entry color pool; the preset's own palette merges underneath and
explicit `colors` overrides win. There is no per-instance shape scatter anymore: two instances with
equal resolved options always build identical geometry, so save resolved `params` when a particular
animal must be rebuildable.

## Parameters

Numbers are scene units unless noted as a ratio. The defaults below are the schema fields
(`SIMPLE_QUADRUPED_SCHEMA`); an explicit preset overrides them, so `normalizeSimpleQuadrupedOptions({})`
resolves the `dog` preset (`bodyLength` 2.35, `legLength` 1.05, `neckAngle` 34 and similar).

| Option | Default | Range / values | Effect |
| --- | --- | --- | --- |
| `type` | `canid` | `canid`, `feline`, `equine`, `ruminant`, `small`, `pachyderm`, `reptile` | Only changes `move` cadence: `small` swings at 4.2 rad/s, every other type at 2.6. Not resampled by `randomSimpleQuadrupedOptions` |
| `bodyLength` | 2.2 | 0.8..4.5, step 0.05 | Torso length along Z |
| `bodyWidth` | 0.85 | 0.35..2.2, step 0.05 | Torso width along X; also scales leg girth, neck and tail thickness |
| `bodyHeight` | 1 | 0.35..2.4, step 0.05 | Torso height; also sets head, ear and horn sizing |
| `bodyStyle` | `round` | `round`, `box`, `shell` | Torso primitive: `round` builds a sphere, `shell` a tapered carapace frustum, otherwise a box |
| `legLength` | 1 | 0.2..2.5, step 0.05 | Hip height; one rigid leg box hangs from each corner pivot |
| `neckLength` | 0.4 | 0.05..1.9, step 0.05 | Neck beam length from shoulder to head |
| `neckAngle` | 22 | -20..70, step 1 | Neck elevation in degrees; 0 is horizontal, positive lifts the head |
| `headScale` | 0.62 | 0.3..1.25, step 0.02 | Head size as a fraction of body dimensions |
| `ears` | `point` | `none`, `point`, `round`, `long` | Ear boxes; `long` is 1.9x taller than `point` |
| `tail` | `long` | `none`, `short`, `long` | Tail beam; `none` builds no tail but keeps the mount |
| `tailLength` | 0.8 | 0.1..1.8, step 0.05 | Tail length; ignored when `tail` is `none` |
| `horns` | false | boolean | Two horn beams on the head |
| `tusks` | false | boolean | Two downward tusk beams beside the snout |
| `humps` | 0 | 0..2, step 1 | Back hump boxes in a row over the torso |
| `stride` | 0.55 | 0..1, step 0.05 | Walk swing amplitude; attacks use separate articulation |
| `colors` | See below | Per-key `0xRRGGBB` or `#RRGGBB` | Palette overrides |

The schema carries `when` predicates for preview relevance: `tailLength` needs a tail, `horns` and
`tusks` bracket ruminant/pachyderm types, and `humps` is pachyderm-only. The builder itself does not
enforce them — an intentionally odd combination such as `{ horns: true }` on a canid builds what it
says; the presets are the curated combinations.

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

Base colors: `body: '#a98061'`, `accent: '#6e806e'`, `hoof: '#514d4b'`. Presets override `body`
and `accent`; `hoof` paints horns and tusks. Materials are matte flat-shaded
`MeshStandardMaterial` (roughness 0.72, metalness 0.04). Geometry and materials are cached within an
instance and distinct across instances. The factory does not set per-mesh shadow flags; lighting and
shadow enablement belong to the caller.

## Instance API

| Port | Semantics |
| --- | --- |
| `group`, `mesh` | Same `Group`; +X right, +Y up, -Z forward (the head faces -Z). Origin is between the feet on the ground plane. |
| `params` | Frozen normalized options including the resolved palette. |
| `bounds`, `dimensions` | Construction-time local `Box3` and `Vector3` size in the rest pose, covering body, legs, neck, head, tail, ears, horns and humps. `bounds.min.y` is 0: the root is seated on the ground plane. Unchanged by `setPose`. |
| `rig` | The internal `Object3D` holding body, neck, head, tail and the leg hinges. Exposed for inspection; treat its transform as factory-owned. |
| `legs` | Four `{ root, hip, front }` entries in left-front, left-rear, right-front, right-rear order; `root === hip`, and `front` is a boolean. One rigid box per corner pivots at the hip; there is no knee. |
| `tail` | The tail mount `Object3D` that `setPose` sways; present even when `tail` is `none`. |
| `attachments` | `head`, `mouth` (the snout box) and `attack` (added by the shared action installer). Caller-mounted items stay caller-owned. |
| `actions` | Frozen `pounce`/`charge`/`death` specs `{ label, loop: false, duration }`; there is no `mode` field. `duration` is the schema duration divided by `actionSpeed`. |
| `actionState` | Getter returning `{ id, progress, finished, active, phase, heading, inPlace }` for the current sample. See the shared surface below. |
| `setPose(action, seconds = 0, { heading = 0, inPlace = false })` | Absolute named-action sample. Internal joints and visual attack travel change; placement is never touched. Returns the instance. |
| `getAttackFrame()` | World `{ origin, direction }` from `attachments.attack`, with the direction normalized along local -Z. |
| `reset()` | Restores `setPose('still', 0)`; the caller resets its own clock. |
| `getStats()` | `{ meshes, triangles, geometries, materials }`; triangles sum mesh occurrences. Inspection only, not a performance guarantee. |
| `dispose()` | Idempotent. Detaches the root and releases owned geometries/materials once. `setPose` after disposal throws. |

Actions and motions share one surface across the simplified creature factories: `still`, `idle`,
`move`, plus the combat actions `pounce`, `charge` and `death` (all `loop: false`). The detailed
factory's `run` and `graze` were removed with it — they no longer exist and `setPose('run', t)`
throws. All four creature families share exactly the `still`/`idle`/`move` motion set plus the three
combat actions. Display labels live in the shared module
([CreatureActions.js](../../assets/world/object/factory/CreatureActions.js)): `ANIMAL_MOTIONS`
extends the motion ids with `pounce (once)`, `charge (once)` and `death fall (hold)`, and
`animalMotionLabels('quadruped')` renders `move` as `walk`. The installer adds `actions`,
`actionState`, `actionRig { heading, travel }`, `attachments.attack`, `setPose`, `getAttackFrame`
and `reset`; there is no `motions` member on the simple creature APIs.

`move` is the walk: the front pair and the rear pair of hips swing in opposition — both front hips
share a phase and both rear hips mirror it — with front amplitude `stride * 0.72` and rear amplitude
`stride * 0.6`. Only the `small` body type changes cadence (4.2 rad/s against 2.6 for every other
type); the phase grouping is identical for all types. `still` reliably freezes the whole visual;
`idle` adds a small head nod on top of the tail sway. Zeroing individual motion knobs does not
disable attacks or every body part.

Shared [creature action options](asset-factory-contract.md#creature-actions) control action speed,
attack distance, rise and death side. Off the contract defaults, effective durations are 1.2 s for
`pounce`, 1.35 s for `charge` and 1.1 s for `death`; `actionSpeed` divides each, so `actionSpeed: 2`
halves them. Attack travel runs `pounceDistance`/`chargeDistance` rest lengths inside the root along
local -Z. `setPose(action, seconds, { heading, inPlace })` accepts the visual heading in radians
about local +Y; use `inPlace: true` when gameplay already supplies forward travel — the pounce rise
still applies, and `death` never travels. `actionState.phase` reports `windup`/`active`/`recover`/
`finished` (or `falling` for death), `loop` for idle motions and `still` for the frozen pose;
`active` spans progress 0.2 to 0.72 for pounce and 0.8 for charge. `setPose` throws a `RangeError`
on unknown motion names and a `TypeError` on non-finite seconds (`NaN` included), non-numeric
headings or non-boolean `inPlace`, leaving the current pose untouched. Because this family sets
`numericTime`, a bare number is `move` shorthand: `setPose(2.5)` equals `setPose('move', 2.5)`.
`attachments.attack` and `getAttackFrame()` expose a world forward frame for effects. Gameplay owns
damage and hit timing.

There is no `collisionHint`. A quadruped's collision is usually a capsule or box narrower than
`bounds`, which includes the tail and any horns; derive it from `bodyWidth`/`bodyLength` and your
own tolerance. Local bounds do not become world bounds when the root moves; transform a copy, and
note that rotating an AABB yields a conservative AABB.

## Practical limits

This is a coarse silhouette built from a sphere, frustum or box torso, box legs, a beam neck, a box
head with a box snout, and box ears and humps with beam horns, tusks and tail. There are no knees,
paws, eyes, spots, manes, fleece, beards or collars, no fur or hide texture, no facial expression
and no per-limb IK. Feet do not conform to a slope. The animal is symmetric except where a feature
option is explicitly paired left/right. For a herd, prefer no humps and reuse a small set of
instances, since each instance owns its own geometry and material caches.

## Copy dependencies and usage

Select `assets/world/object/factory/QuadrupedVisualFactory.js` with the
[transitive copier](asset-factory-contract.md#copy-and-compose); the shared creature actions
([CreatureActions.js](../../assets/world/object/factory/CreatureActions.js)) and the primitive kit
plus normalization helpers
([VisualFactoryUtils.js](../../assets/world/object/factory/VisualFactoryUtils.js)) follow
automatically.

Use the project's local Three.js 0.161.0 dependency and import map. A caller that adapts placement
with `WorldBasis` additionally copies that module.

```js
import { buildSimpleQuadrupedVisual } from '/assets/world/object/factory/QuadrupedVisualFactory.js';

const pack = [0, 1, 2].map(i => {
  const animal = buildSimpleQuadrupedVisual({ preset: 'wolf', stride: 0.6 });
  animal.group.position.set(i * 4 - 4, 0, -12);   // caller owns placement
  scene.add(animal.group);
  return animal;
});

// Inside the caller's loop, after gameplay has advanced its own clock:
for (const animal of pack) animal.setPose('move', elapsedSeconds);

// A game-owned lunge: restart the action clock, keep the root planted, face heading:
pack[0].setPose('pounce', 0.8, { inPlace: true, heading: Math.PI / 2 });
const { origin, direction } = pack[0].getAttackFrame();   // world frame for effects

// On round reset: pack[0].reset(); on teardown: for (const animal of pack) animal.dispose();
```

## Verify and record

Save resolved `params` with the run's tuning data so the exact animal can be rebuilt. See the
[composition pattern](../../grimoire/patterns/parameterized-visual-factory.md) for basis adaptation,
the [browser preview](../../assets/examples/factory-preview/index.html) for a live consumer, and
[regression tests](../../forge/tests/js/creature-factories.test.mjs) for construction across all
presets and enum/range endpoints, option validation and precedence, seeded determinism, the
front-pair/rear-pair gait, root preservation under pose, extreme legal inputs, resource ownership
and the shared combat surface. The preview is component evidence, not a final gameplay acceptance
pass.

Exercise the selected attacks at start, middle and end, then reset; sample the same time again to
check determinism. [Action regressions](../../forge/tests/js/extended-factory-actions.test.mjs)
cover attack endpoints, in-place travel and world frames. If attack displacement is doubled, enable
`inPlace`. If collision changes with the visual pose, replace a live visual box with a game-owned
body volume.