# Compose parameterized scene assets

Outcome: a generated game uses a reusable visual factory with consistent placement, animation,
cleanup and local dependencies, while gameplay systems retain control of actions and rules.
Use from Stage 1, or a revision affecting visual integration, when configurable characters, vehicles,
props or other scene visuals fit the brief. Skip for
abstract pieces adequately represented by UI or intentional primitives; when no factory covers a 3D
role, compose simple geometry instead of importing a dense mesh. Menu input can still control
a depicted scene needing factories. Asset coverage does not determine the game's mechanics.

## Workflow

1. Select a candidate for a role in the intended scene composition through the
   [visual catalog](../../assets/catalogs/world-visuals.md). Read its API for exports, shape options,
   axes, units, lifetime, dependencies and supported capabilities. Scene-visual factories, older
   modules and shared-resource helpers have different interfaces; check the chosen API.
2. Pass selected public entrypoints to the asset copier (repeat `--asset` for more):

   ```sh
   python <skill-root>/forge/scaffold.py assets --project-root /path/to/game --asset assets/world/object/factory/CharacterVisualFactory.js
   ```

   The copier follows transitive imports, copies shared helpers once and preserves paths. Use the
   project's pinned local packages and import map following [standalone delivery](../build/standalone-project.md).
3. Choose intentional shape and palette options. Use a preset as a starting point, or a seeded
   option helper when variety is useful; explicit overrides win. Save resolved `params` with the
   run's tuning data so the design can be rebuilt. A seed alone does not pin an algorithm version.
4. Create the visual and attach its `group` to a caller-owned scene/entity. Adapt the documented
   local frame once. The included factories face -Z with +Y up and +X right; placement/root motion
   belongs to the caller. If an existing controller already adapts its model, use that owner.
   Bind visuals to game-owned state and semantic roles in the chosen composition. Visual grouping
   and entity bindings may be reorganized; keep consumers and reset paths wired to the current
   entities. Follow [Stage 1](../build/step1-static-scene.md) for layout changes and affected regressions.
5. In Stage 1, sample a fixed pose once. In Stage 2, drive supported animation from evaluated game
   state. Named-action factories expose `setPose(action, seconds)`: seconds belong to the current
   action, with no hidden clock. Reset the caller's time origin when an action starts; one-shots hold
   their endpoint. Discover IDs from the selected API: characters use `idle`/`walk`/`run` plus
   `hand:action`; vehicles use `still`/`drive`; trees use `still`/`wind`; trains use `still`/`roll`;
   creatures share `still`/`idle`/`move` plus combat one-shots. Read equipment actions from
   `getEquipmentActions(hand)` after loadout changes. Aircraft `setFlightPose` accepts evaluated
   controls when matching actual flight matters. Creature attacks use `{ inPlace: true }` when
   gameplay already supplies forward travel. Static assets have no pose port. See the
   [common action contract](../../docs/api/asset-factory-contract.md#named-actions) for timing.
6. Treat rest bounds as local snapshots for placement/framing and collision hints as suggestions.
   The game chooses collision tolerances, stance volumes, roof support and traversable gaps. Keep
   physics, navigation and scoring outside the factory. Use named attachments for caller-owned
   items; document any adapter that introduces additional ownership.
7. Reset internal visual state alongside the existing [round reset](loop-restart.md). For geometry
   edits, create a new instance and dispose the old one. On teardown, release caller-owned mounts,
   colliders and other systems separately. Do not double-dispose factory-owned cached resources.

### Placement and animation example

This fragment assumes a Three.js scene and a caller-owned loop. It also copies
[WorldBasis](../../assets/math/WorldBasis.js) in addition to the character entrypoint.
The Z-up example demonstrates a placement adapter; Y-up games can keep the default visual frame.

```js
import { Box3, Group } from 'three';
import { WorldBasis } from '/assets/math/WorldBasis.js';
import { createCharacterVisual, randomCharacterOptions }
  from '/assets/world/object/factory/CharacterVisualFactory.js';

const basis = new WorldBasis({ right: '+x', up: '+z', forward: '+y' });
const entity = new Group();
scene.add(entity);
const visual = createCharacterVisual(randomCharacterOptions(42, { height: 2.2 }));
entity.add(visual.group);
visual.group.quaternion.copy(basis.threeObjectCanonicalToBasisQuaternion());
const worldRestBounds = new Box3();
let previousAction = null;
let actionStarted = 0;

function present(nowSeconds, state) {
  entity.position.copy(state.position);
  entity.quaternion.copy(state.orientation);
  const motion = state.moving ? (state.sprinting ? 'run' : 'walk') : 'idle';
  if (motion !== previousAction) { previousAction = motion; actionStarted = nowSeconds; }
  visual.setPose(motion, nowSeconds - actionStarted);
  visual.group.updateWorldMatrix(true, false);
  worldRestBounds.copy(visual.bounds).applyMatrix4(visual.group.matrixWorld);
  // This is a conservative transformed REST box, not animated collision geometry.
}
```

On restart, call `visual.reset()` and clear `previousAction` and `actionStarted`. If the same
one-shot can retrigger without changing its name, reset its time origin on that game event too.

`state.orientation` above is the entity's rotation relative to its basis-aligned neutral pose;
do not apply the canonical-to-basis rotation there a second time. With scaled roots, convert train
world travel into model units before driving wheel rotation. Never overwrite a factory's local
`bounds` with a world-space result.

## Verify and record

- Inspect the selected shapes from the normal gameplay view, including the most compressed pose,
  tallest accessory, longest consist or other relevant extreme. Check readability and clearance.
- Check placement under actual parent transforms. Verify mounts and any game-owned collision
  against their documented coordinate spaces; visual bounds alone do not validate collision.
- Exercise the chosen action states, restart and rebuild. Confirm root motion remains controlled
  by gameplay and that repeated updates/rebuilds do not grow resource counts indefinitely.
- Save the factory/API version or copied sources and resolved parameters with the run. Keep shared
  dependencies stable for earlier stages, or version a changed copy when behavior changes.
- Launch using only the output project's files; inspect module/resource requests. The
  [factory preview](../../assets/examples/factory-preview/index.html) demonstrates components,
  not a game's final acceptance. Continue the actual game's applicable gates.

## Troubleshooting

| Symptom | Likely cause | Remedy and recheck |
| --- | --- | --- |
| Running legs but no displacement | A visual pose was used as a motion controller | Update game position first; present that state through the root and animation. |
| Crouch or jump looks correct but still collides at standing height | A rest hint was treated as a live collider, or a body pose the factory no longer ships was assumed | Character motions are idle/walk/run; derive collision height from the game's stance and test the actual obstacle clearance. |
| Model lies sideways or heading is reversed | Coordinate adaptation is missing or applied twice | Give one owner the documented basis transform; verify forward and up with a simple pose. |
| One train box blocks an apparent gap | Full-consist bounds were used as collision | Choose per-car hints or game-authored volumes and decide whether couplers block. |
| Rebuilt scene fails or GPU resources grow | Missing dependency or unclear disposal ownership | Verify the copy list and rebuild/teardown lifecycle; avoid cloning owned roots without a sharing contract. |
