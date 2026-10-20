# Asset factory contract

Outcome: a factory can be discovered, configured, copied and composed in a generated game without
requiring the skill at runtime. Use this reference when adding a factory or integrating several
families. For one asset, start with its [catalog entry](../../assets/catalogs/world-visuals.md) and API.

## Admission and scope

A factory produces an asset from options. Its category determines its output: characters, props,
environments, textures and data structures need different capabilities. Select assets from the brief;
a board or abstract game may need none. When a generated game needs 3D structure that no skill
factory covers, compose it from simple primitives or [GreyboxKit](greybox-kit-factory.md). Imported
GLTF/FBX/OBJ packs and dense custom meshes are not a substitute for a missing factory. Runtime
modules must not attach to a global scene, install
input handlers, start a frame loop or read game state. Declare loading, browser requirements and
asynchronous readiness/failure/cleanup when those capabilities exist.

Publish an ES module under the owning asset domain, with a discoverable `*Factory.js` entrypoint,
documented options, coordinates, ownership and dependencies. Link its API from a reachable catalog.
Keep gameplay, preview UI and primitive construction separate. Extract shared parts or motion code
when several consumers need them; consumers should import public factories, not assemble internals.

## Scene-visual interface profile

The parameterized character, equipment, creature, pickup, mechanism, transport, architecture, tree
and rock factories share construction and lifetime conventions. Canonical exports are the
`SIMPLE_`-prefixed names (`buildSimpleXxxVisual`, `normalizeSimpleXxxOptions`,
`randomSimpleXxxOptions`, `SIMPLE_XXX_PRESETS`, `SIMPLE_XXX_SCHEMA`). Unprefixed historical aliases
(`createXxxVisual`, `buildXxxVisual`, `normalizeXxxOptions`, `randomXxxOptions`, `XXX_PRESETS`,
`XXX_SCHEMA`) remain on each module so existing consumers keep working.

| Member | Semantics |
| --- | --- |
| `buildSimpleXxxVisual(options = {})` | Creates a fresh instance without attaching it to a scene. Canonical entrypoint. |
| `createXxxVisual(options = {})` | Historical alias of the builder; still valid. |
| `normalizeSimpleXxxOptions(options = {})` | Resolves defaults and validation without allocating visual resources. |
| `randomSimpleXxxOptions(seed, overrides = {})` | Returns reproducible resolved options; explicit overrides win. |
| `SIMPLE_XXX_PRESETS`, `SIMPLE_XXX_SCHEMA` | Frozen preset bundles and parameter definitions. See the selected API for the export prefix. |
| `mesh` | Placement root. The caller owns its position, rotation, scale, visibility and parent. |
| `group` | Same object as `mesh` when present. Equipment, mechanism and fantasy-creature instances expose `mesh` only. |
| `params` | Frozen resolved options. Rebuild for geometry edits; character equipment swaps update its loadout record. |
| `bounds`, `dimensions` | Construction-time local rest box and size, including the initial assembly. They are not live collision volumes. |
| `attachments` | Optional named mounting nodes. Inspect availability before use; a variant may omit a mount. |
| `getStats()` | Mesh, triangle, geometry and material counts for inspection, not a performance guarantee. |
| `dispose()` | Idempotently releases owned resources and detaches the root. Caller-mounted resources remain caller-owned. |

Native helpers such as [grass](grass-visual-factory.md) intentionally return borrowed-resource
meshes, and static [houses](house-visual-factory.md) and [buildings](building-visual-factory.md)
have no animation API. Do not introduce an adapter unless a consumer needs one.

### Named actions

Characters, equipment, quadrupeds, birds, fish, fantasy creatures, pickups, vehicles, aircraft,
mechanisms, trains, trees and rocks sample with `setPose`. Place `visual.group` when it exists,
otherwise `visual.mesh`. Discover action IDs from the selected API rather than assuming an
`actions` table:

```js
const visual = createXxxVisual(options);
scene.add(visual.group ?? visual.mesh);
visual.setPose(action, 0);
// Each frame: seconds since this action started, supplied by the caller.
visual.setPose(action, actionSeconds);
// Round reset: reset the caller's action clock too.
visual.reset();
// Teardown:
visual.dispose();
```

| Member | Semantics |
| --- | --- |
| `setPose(action, seconds = 0, controls?)` | Deterministic absolute sampling; finite seconds relative to this action's start. Changes internal transforms only; returns the instance. Unsupported actions throw. |
| `motions` | Action ID to display label map when the family publishes one. Character, vehicle, train and tree instances expose this. Pickup publishes `PICKUP_MOTIONS` on the module only. Creature instances do not; labels live on the module (`ANIMAL_MOTIONS` / `SIMPLE_*_MOTIONS`). |
| `actions` | Available one-shot or catalogued action IDs when the family publishes a table (equipment, creatures, mechanisms, rocks, aircraft one-shots). Character, vehicle, train, tree and pickup instances have none. |
| `actionState` | Current visual sample when the family publishes one. It is not an event queue or a source of gameplay authority. |
| `reset()` | Restores internal pose without changing placement. Character resets to `idle`; other named-action factories reset to `still`. |

One-shot actions clamp before the start and after `actions[id].duration` when that table exists, and
hold the endpoint. Replaying means sampling again from zero. Loop actions may include a lead-in or
several oscillations; only use `period` when supplied. `duration` on a loop may describe its
lead-in, not a wrap period. There is no hidden animation clock. A consumer owns transitions, pause,
elapsed time and replay. Choose gameplay actions explicitly rather than selecting a random
available animation.

Family exceptions, all sampled through `setPose`:

- Character body motions are `idle`, `walk` and `run`. Equipment uses `hand:action`
  (for example `right:slash`); query `getEquipmentActions(hand)` after loadout changes.
- Vehicle motions are `still` and `drive`. There is no `setDrivePose`. Steering is a
  construction parameter.
- Aircraft keeps `setPose` plus `setFlightPose(seconds, controls)` for evaluated flight
  inputs; see its API for units.
- Tree uses `setPose('still'|'wind', seconds)`.
- Train uses `setPose('still'|'roll', seconds)` and exports `SIMPLE_TRAIN_SCHEMA`. There is
  no incremental `update` port.

Check those selected APIs instead of guessing arguments.

### Creature actions

Quadruped, bird, fish and fantasy factories share `still`, `idle`, `move`, `pounce`, `charge` and
`death`. There are no extra `run`, `graze`, `glide`, `peck` or `dart` motions. Fantasy creatures
add `action` for species-specific presentation. `move` means the family's gait, flap or swim;
`pounce` is displayed as swoop for birds and lunge for fish. Display labels live on the module;
creature instances have no `motions` member.

| Option | Default / range | Meaning |
| --- | --- | --- |
| `actionSpeed` | 1 / 0.2..3 | Multiplier for one-shot action timing |
| `pounceDistance`, `chargeDistance` | 0.65 / 0..2; 1 / 0..3 | Visual forward travel in rest-length multiples |
| `pounceHeight` | 0.28 / 0..1.2 | Pounce rise in rest-height multiples |
| `pounceDuration`, `chargeDuration`, `deathDuration` | 1.2, 1.35, 1.1 / 0.3..3 seconds | Effective duration is this value divided by `actionSpeed` |
| `deathSide` | `right` / `left`, `right` | Side to fall toward |

`setPose(action, seconds, { heading: 0, inPlace: false })` accepts visual heading in radians about
local +Y. Attack travel occurs inside the root along local -Z. Use `inPlace: true` when gameplay
already moves the actor forward; the visual pounce rise remains. `actionState.phase` reports
windup/active/recover/finished, or falling for death. `getAttackFrame()` returns world-space
`{ origin, direction }`, with normalized forward direction. This suggests effect placement; the
game still owns targeting, damage, hit timing and collision.

## Options, coordinates and lifetime

Normalizers apply preset values, then explicit overrides, then field defaults/clamps. Finite numeric
values clamp to the schema range; integer count fields round. Wrong types, non-finite numbers,
invalid enums, malformed colors or non-object option bundles throw. Inputs are never mutated.
Colors merge per key: base palette, preset palette, explicit palette. Runtime normalizers generally
ignore unknown keys; the option checker below rejects them. Schema `when` predicates describe
relevance in the preview; they do not generally remove fields from normalized output. Fields derived
from a preset, such as equipment kind, are documented in the corresponding API.

Query only the selected factory when exact defaults, ranges or choices are needed:

```sh
python <skill-root>/forge/factory_manifest.py --factory CharacterVisualFactory
python <skill-root>/forge/factory_manifest.py --factory CharacterVisualFactory --options '{"loadout":{"right":{"preset":"bow"},"left":null}}'
```

Constructors do not consume a random seed unless their API says so. Call the seeded option helper;
save `params` and preserve copied source versions for stable reproduction across algorithm changes.
Use instance-local random generators, never shared default or global randomness for seeded geometry.

The included scene visuals use +X right, +Y up, -Z forward and scene units interpreted as metres.
Their APIs describe the origin and sizing ratios. Adapt the root once with
[WorldBasis](../../assets/math/WorldBasis.js) when needed. Transform a copy of a local rest box for
world placement. Vehicle, aircraft, mechanism and rock `getPoseBounds()` return a visible **world-space**
AABB for the current pose; this is also a framing aid, not a registered collider.

Own caches within each instance or document an explicit shared owner. Keep bounded effects in fixed
pools and avoid rebuilding meshes per frame. Cloning a Three.js root shares resources; use a factory
constructor for independent ownership. Do not additionally traverse factory-owned caches with a
generic dispose helper. Character `equip` transfers ownership of an equipment instance until
`unequip` returns it; ordinary attachments do not transfer ownership. Release caller effects
separately, including effects mounted on aircraft exhausts.

## Copy and compose

Select public entry files; the existing copier follows their transitive imports and deduplicates
shared files. Internal geometry, action and motion modules are implementation details, not a
second API that a generated game must wire by hand. There are no wearable modules.

```sh
python <skill-root>/forge/scaffold.py assets --project-root /path/to/game \
  --asset assets/world/object/factory/CharacterVisualFactory.js \
  --asset assets/world/object/factory/MechanismVisualFactory.js
```

The project must already have its scaffold/package manifest. Use `scaffold.py init` for a new
project as described in [standalone delivery](../../grimoire/build/standalone-project.md).
The copier preserves paths, records file hashes and includes repository notices. Explicitly include
computed resource references when a future factory needs them. The manifest's `runtimeDependencies`
lists direct imports only; it is not the full copy closure. Use pinned project-local Three.js 0.161.0
and declare any additional packages. No generated import may rely on the skill or source lab path.

## Contribute and verify

1. Inspect the incoming implementation's options, ownership, axes and side effects. Adapt portable
   parts to the public contract; keep preview UI and application code outside runtime factories.
2. Add the source under its owning domain and a focused API under `docs/api/`. State useful controls,
   output, limitations and an executable integration example. Keep common semantics here.
3. Register its full repo-relative `*Factory.js` path in the owning catalog. Link new catalogs
   directly as `catalogs/<name>.md` from `assets/summary.md`; the drift checker follows one level.
4. Exercise presets, relevant extreme options, reproducible variation, action seeking/reset, root
   preservation, transformed mounts and resource ownership. Extend the component preview when
   inspecting motion or shape helps. Verify a copy with only project-local dependencies.
5. Run focused behavior tests, then `make lint`, `make test-js` and `make test-py`. The drift checker
   checks discovery, not behavior. Browser previews provide component evidence, not a gameplay pass.

Update routing only when selection guidance changes. A factory addition does not require a new
stage, registry, genre checklist or larger `SKILL.md`.

## Troubleshooting

| Symptom | Likely cause | Remedy and recheck |
| --- | --- | --- |
| Factory cannot be found | Missing or unreachable catalog entry | Register the full path in a directly linked catalog; run factory drift. |
| Copied game cannot import a helper | Only the public file was copied | Use the transitive copier and inspect project-local requests. |
| Wrong scale, orientation or collision offset | Origin, units or bounds space assumed | Apply the documented basis and transform hints; check a transformed parent. |
| One-shot repeats or never finishes | Global time or modulo used for action time | Start a caller-owned action clock; hold the endpoint until game state changes. |
| Creature travels twice during attack | Gameplay and visual both supply forward travel | Sample with `inPlace: true`; retain game-owned movement. |
| Bow action unavailable | Support hand holds another item | Query `getEquipmentActions`; unequip the support item if the game permits it. |
| Restart leaks resources or moves an entity | Placement/lifetime ownership mixed | Reset internal pose, reset game state separately and dispose each owner once. |
