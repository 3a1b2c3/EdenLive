# Bird visual factory

[Source](../../assets/world/object/factory/BirdVisualFactory.js) is the simplified bird factory: a
body block, head with a wedge beak, one flat panel per wing, one tail wedge and straight legs, with
flap, attack and death poses. Use it when this anatomy fits the brief. It follows the
[shared scene-visual contract](asset-factory-contract.md#scene-visual-interface-profile).
The game owns movement, collision and behavior; the factory owns visual construction and motion.

## Exports and construction

```js
buildSimpleBirdVisual(options = {})              // canonical instance
normalizeSimpleBirdOptions(options = {})          // frozen resolved options
randomSimpleBirdOptions(seed = 1, overrides = {}) // frozen resolved options
SIMPLE_BIRD_PRESETS
SIMPLE_BIRD_SCHEMA
// Compatibility aliases kept under the module's historical name:
createBirdVisual(options = {})   // alias of buildSimpleBirdVisual
buildBirdVisual(options = {})    // alias of buildSimpleBirdVisual
normalizeBirdOptions             // alias of normalizeSimpleBirdOptions
randomBirdOptions                // alias of randomSimpleBirdOptions
BIRD_PRESETS = SIMPLE_BIRD_PRESETS
BIRD_SCHEMA = SIMPLE_BIRD_SCHEMA
```

Presets: `sparrow` (default), `crow`, `pigeon`, `eagle`, `hawk`, `parrot`, `flamingo`, `penguin`,
`owl`, `duck`, `swan`, `rooster`, `hummingbird`. `SIMPLE_BIRD_PRESETS` and `SIMPLE_BIRD_SCHEMA` are
deep-frozen. Options are copied, never mutated; changing geometry after creation requires disposing
and rebuilding rather than mutating `params`.

Use the [shared normalization rules](asset-factory-contract.md#options-coordinates-and-lifetime).
Schema `when` predicates indicate preview relevance; irrelevant fields can remain in resolved
`params`. Save resolved options when a design must be rebuilt.

### Seeded option sampling

`randomSimpleBirdOptions(seed, overrides)` uses the same instance-local
[seeded generator](../../assets/world/object/factory/VisualFactoryUtils.js) as every simplified
factory: it requires an integer seed, draws a preset at random unless `overrides.preset` is given,
reshuffles every enumeration and boolean field, and varies numbers by 0.65x to 1.35x around the
preset's values (`neckAngle`, marked `fullRange`, samples across the whole range). `type` is pinned
rather than resampled (`randomize: false`), because it names the body plan, and every combat field
is pinned the same way. The randomizer also picks a palette from a five-entry color pool; the
preset's own palette merges underneath and explicit `colors` overrides win. There is no per-instance
shape scatter anymore: two instances with equal resolved options always build identical geometry, so
save resolved `params` when a particular bird must be rebuildable.

## Parameters

Numbers are scene units unless noted as a ratio. The defaults below are the schema fields
(`SIMPLE_BIRD_SCHEMA`); an explicit preset overrides them, so `normalizeSimpleBirdOptions({})`
resolves the `sparrow` preset.

| Option | Default | Range / values | Effect |
| --- | --- | --- | --- |
| `type` | `songbird` | `songbird`, `raptor`, `tropical`, `wading`, `waterfowl`, `farmbird` | Label only in the simplified factory: the builder never reads it and every body is one sphere block. Not resampled by `randomSimpleBirdOptions` |
| `bodyLength` | 1.05 | 0.45..2.3, step 0.02 | Torso length along Z; also scales wing chord (0.5-0.68x per shape) |
| `bodyWidth` | 0.62 | 0.2..1.35, step 0.02 | Torso width along X; also scales wing mount offset, neck/leg girth and foot size |
| `bodyHeight` | 0.75 | 0.28..1.8, step 0.02 | Torso height; also sets wing panel thickness |
| `wingSpan` | 1.8 | 0.6..5.5, step 0.05 | Full tip-to-tip span; each wing is half of it, floored at `bodyWidth * 0.45` |
| `wingShape` | `rounded` | `rounded`, `point`, `swept`, `long` | Panel outline: chord and tip taper differ per shape |
| `neckLength` | 0.25 | 0.05..1.8, step 0.02 | Neck length; at or below 0.06 no neck segment is built and the head sits on the body |
| `neckAngle` | 10 | -25..55, step 1 | Neck elevation in degrees; 0 is horizontal, positive lifts the head |
| `headScale` | 0.76 | 0.42..1.25, step 0.02 | Head size as a fraction of body dimensions |
| `beakLength` | 0.28 | 0.08..0.8, step 0.02 | Wedge beak length |
| `tailLength` | 0.5 | 0.12..1.5, step 0.02 | Tail wedge length; also widens and tallens it |
| `legLength` | 0.3 | 0..1.8, step 0.02 | Leg length; at or below 0.02 no legs are built |
| `flapSpeed` | 3.2 | 0.2..12, step 0.1 | Flap angular rate in rad/s for the wing beats |
| `glide` | 0.35 | 0..1, step 0.05 | Flap amplitude scale, inverted: 0 is a full flap, 1 holds the wings at the built fold plus a 0.16 rad residual |
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

Base colors: `body: '#7b927e'`, `wing: '#4e746e'`, `accent: '#d29b61'`, `beak: '#c78b4a'`,
`leg: '#9f755b'`. Presets override several keys; the simplified builder paints nothing with
`accent` (the crest/comb parts that used it were removed). The tail wedge paints `wing`. Materials
are matte flat-shaded `MeshStandardMaterial` (roughness 0.72, metalness 0.04). Geometry and
materials are cached within an instance and distinct across instances. The factory does not set
per-mesh shadow flags; lighting and shadow enablement belong to the caller.

`glide` is an option, not an action. At 0 the wings swing 0.88 rad around the built fold; at 1 they
hold at fold plus the 0.16 rad residual. Above 0.6 the legs tuck at animation
time: during `move` they rotate to a fixed 0.6 rad fold instead of paddling. Flight stays
presentation only — `setPose` never moves the root, so altitude, banking, heading and any
relationship between `flapSpeed` and actual travel remain the caller's. A believable bird usually
needs the caller to roll the root when turning.

## Instance API

| Port | Semantics |
| --- | --- |
| `group`, `mesh` | Same `Group`; +X right, +Y up, -Z forward (the beak faces -Z). Origin is under the feet on the ground plane, or under the body when there are no legs. |
| `params` | Frozen normalized options including the resolved palette. |
| `bounds`, `dimensions` | Construction-time local `Box3` and `Vector3` size in the rest pose, covering body, spread wings, head, beak and tail. `bounds.min.y` is 0: the root is seated on the ground plane. Unchanged by `setPose`. |
| `rig` | The internal `Object3D` holding body, wings, neck, tail and legs. Exposed for inspection; treat its transform as factory-owned. |
| `wings` | Two `{ wing, baseX }` entries, negative-X side first. `baseX` is the built fold angle. The left wing group is turned a half turn about Y, so both wings share one outline and `wing.rotation.x` reads as flap on both; the two flapping phases are mirrored. |
| `legs` | Array of the leg mount `Object3D`s; empty when `legLength` is at or below 0.02. |
| `tail` | The tail mount `Object3D` that `setPose` sways. |
| `attachments` | `head`, `beak` and `attack` (added by the shared action installer). Caller-mounted items stay caller-owned. |
| `actions` | Frozen `pounce`/`charge`/`death` specs `{ label, loop: false, duration }`; there is no `mode` field. `duration` is the schema duration divided by `actionSpeed`. |
| `actionState` | Getter returning `{ id, progress, finished, active, phase, heading, inPlace }` for the current sample. See the shared surface below. |
| `setPose(action, seconds = 0, { heading = 0, inPlace = false })` | Absolute named-action sample. Internal joints and visual attack travel change; placement is never touched. Returns the instance. |
| `getAttackFrame()` | World `{ origin, direction }` from `attachments.attack`, with the direction normalized along local -Z. |
| `reset()` | Restores `setPose('still', 0)`; the caller resets its own clock. |
| `getStats()` | `{ meshes, triangles, geometries, materials }`; triangles sum mesh occurrences. Inspection only, not a performance guarantee. |
| `dispose()` | Idempotent. Detaches the root and releases owned geometries/materials once. `setPose` after disposal throws. |

Actions and motions share one surface across the simplified creature factories: `still`, `idle`,
`move`, plus the combat actions `pounce`, `charge` and `death` (all `loop: false`). The detailed
factory's `glide` and `peck` were removed with it — they no longer exist and `setPose('glide', t)`
throws, while `glide` survives only as the option above. All four creature families share exactly
the `still`/`idle`/`move` motion set plus the three combat actions. Display labels live in the
shared module
([CreatureActions.js](../../assets/world/object/factory/CreatureActions.js)): `ANIMAL_MOTIONS`
extends the motion ids with `pounce (once)`, `charge (once)` and `death fall (hold)`, and
`animalMotionLabels('bird')` renders `move` as `flap / glide` and `pounce` as `pounce / swoop
(once)`. The installer adds `actions`, `actionState`, `actionRig { heading, travel }`,
`attachments.attack`, `setPose`, `getAttackFrame` and `reset`; there is no `motions` member on the
simple creature APIs.

`move` is the flap: each wing rotates around its built fold at `flapSpeed`, the two phases mirrored
across the body, with amplitude `0.16 + (1 - glide) * 0.72`; the tail sways and the legs paddle or
tuck as described above. `idle` samples the same animation at 0.1 amplitude.
`still` reliably freezes the whole visual; zeroing individual motion knobs does not disable attacks
or every body part.

Shared [creature action options](asset-factory-contract.md#creature-actions) control action speed,
attack distance, rise and death side. Off the contract defaults, effective durations are 1.2 s for
`pounce` (a swoop), 1.35 s for `charge` and 1.1 s for `death`; `actionSpeed` divides each, so
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

There is no `collisionHint`. Bird collision is usually a small sphere on the body, while `bounds`
spans the fully spread wings; derive it from `bodyLength`/`bodyWidth` and your own tolerance. Local
bounds do not become world bounds when the root moves; transform a copy, and note that rotating an
AABB yields a conservative AABB.

## Practical limits

This is a coarse silhouette built from a sphere torso, an extruded prism tail, flat slab wings and
box head, beak and legs: there are no individual feathers, no plumage texture, no feather layers and
no per-joint wing articulation. A wing is one rigid panel rotating around the shoulder, so it does
not bend at a wrist or twist for thrust, and a large flap near the built fold can visibly intersect
the body. There are no eyes, crests, wattles, stripes or toes. For a flock, reuse a small set of
instances, since each instance owns its own geometry and material caches.

## Copy dependencies and usage

Select `assets/world/object/factory/BirdVisualFactory.js` with the
[transitive copier](asset-factory-contract.md#copy-and-compose); the shared creature actions
([CreatureActions.js](../../assets/world/object/factory/CreatureActions.js)) and the primitive kit
plus normalization helpers
([VisualFactoryUtils.js](../../assets/world/object/factory/VisualFactoryUtils.js)) follow
automatically.

Use the project's local Three.js 0.161.0 dependency and import map. A caller that adapts placement
with `WorldBasis` additionally copies that module.

```js
import { buildSimpleBirdVisual } from '/assets/world/object/factory/BirdVisualFactory.js';

const flock = [0, 1, 2].map(i => {
  const bird = buildSimpleBirdVisual({ preset: 'crow', flapSpeed: 3 + i * 0.4 });
  scene.add(bird.group);
  return bird;
});

// Inside the caller's loop, after flight motion has been evaluated:
for (const [i, bird] of flock.entries()) {
  bird.group.position.copy(flightPath[i]);        // caller owns placement
  bird.group.rotation.z = -bankAngle[i];          // and banking
  bird.setPose('move', elapsedSeconds + i * 0.3); // offset so they do not flap in lockstep
}
// A guard swooping without forward travel, facing its own heading:
flock[0].setPose('pounce', 0.7, { inPlace: true, heading: 0.4 });
const { origin, direction } = flock[0].getAttackFrame();
// On round reset: bird.reset(); on teardown: for (const bird of flock) bird.dispose();
```

## Verify and record

Save resolved `params` with the run's tuning data so the exact bird can be rebuilt. See the
[composition pattern](../../grimoire/patterns/parameterized-visual-factory.md) for basis adaptation,
the [browser preview](../../assets/examples/factory-preview/index.html) for a live consumer, and
[regression tests](../../forge/tests/js/creature-factories.test.mjs) for construction across all
presets and enum/range endpoints, option validation and precedence, seeded determinism, the
glide-1 hold and leg tuck, root preservation under pose, extreme legal inputs, resource ownership
and the shared combat surface. The preview is component evidence, not a final gameplay acceptance
pass.

Exercise the selected attacks at start, middle and end, then reset; sample the same time again to
check determinism. [Action regressions](../../forge/tests/js/extended-factory-actions.test.mjs)
cover attack endpoints, in-place travel and world frames. If attack displacement is doubled, enable
`inPlace`. If collision changes with the visual pose, replace a live visual box with a game-owned
body volume.