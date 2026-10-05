# Character visual factory

Use [CharacterVisualFactory](../../assets/world/object/factory/CharacterVisualFactory.js) for a
simplified humanoid: head, torso, two arms and two legs, with interchangeable handheld equipment.
Clothing layers, armor, hats, hair and shoes are gone; limb proportions except overall height and
girth are locked. Handheld items come from the independent
[equipment factory](equipment-visual-factory.md); the same body can change equipment without
rebuilding. The game owns movement, collision and action choice.

The `SIMPLE_`-prefixed exports are canonical. Unprefixed aliases at the end of the module keep the
historical consumer surface.

## Construction and options

Canonical exports: `buildSimpleCharacterVisual`, `normalizeSimpleCharacterOptions`,
`randomSimpleCharacterOptions`, `SIMPLE_CHARACTER_PRESETS`, `SIMPLE_CHARACTER_SCHEMA`,
`SIMPLE_CHARACTER_MOTIONS`. Compatibility aliases: `createCharacterVisual`, `buildCharacterVisual`,
`normalizeCharacterOptions`, `randomCharacterOptions`, `CHARACTER_PRESETS`, `CHARACTER_SCHEMA`,
`CHARACTER_MOTIONS`. The normalizer and seeded helper follow the
[common contract](asset-factory-contract.md).

The default `runner` has empty hands. Thirty presets keep the earlier keys; outfits are dropped, and
profession weapons feed the shared loadout adapter:

- Everyday: `runner`, `child`, `tall`, `stocky`, `heavy`, `sprinter`, `worker`, `hiker`, `commuter`, `blocky`.
- Fantasy: `mage`, `warrior`, `rogue`, `soldier`, `paladin`, `ranger`, `cleric`, `barbarian`, `monk`, `necromancer`.
- Professions: `modernSoldier`, `commando`, `marksman`, `supportGunner`, `breacher`, `police`,
  `firefighter`, `nurse`, `doctor`, `paramedic`.

There is no `knight` preset; use `warrior`. Omitted loadout slots inherit the preset's legacy
`weapon`/`offhand`; `null` clears that hand. Each populated slot accepts equipment options. Its
`referenceHeight` defaults to the character's `height` unless explicitly supplied. Equipment palettes
are independent of body colors.

```js
import { createCharacterVisual }
  from '/assets/world/object/factory/CharacterVisualFactory.js';

const actor = createCharacterVisual({
  preset: 'worker', height: 2.2, holdPose: 'ready',
  loadout: { right: { preset: 'flashlight' }, left: null },
  colors: { top: '#497a91' },
});
scene.add(actor.group);
actor.setPose('walk', 0.5);
actor.setPose('right:scan', 0.8);
```

| Controls | Defaults / ranges | Effect |
| --- | --- | --- |
| `height` | 2.2 / 0.8..3.2 m | Overall body height; locked limb ratios scale with it |
| `build` | 1 / 0.6..1.7 | Torso girth and matching leg thickness |
| `headShape` | `round`; `round`, `box` | Head primitive |
| `stride` | 1 / 0.4..1.3 | Walk/run swing amount |
| `holdPose` | `swing`; `swing`, `ready`, `twoHand` | Walk-cycle hold, ready hold or support-hand request; relevant when a hand is occupied |
| `loadout` | `{ left: null, right: null }` for runner | Per-hand equipment options; omitted slots inherit the preset's weapon/offhand |
| `colors` | Per-key hex colors | `skin`, `top`, `pants`, `accent`; inspect normalized defaults |

Locked construction constants, not schema sliders: leg ratio 0.46, head ratio 0.2, torso depth 0.62,
arm ratio 0.32. Wearable controls (`torso`, `sleeves`, `robeLength`, `armor`, `pauldrons`, `hat`,
`hair`, `cape`, `backpack` and similar) no longer exist. `hose` / `hoseLength` / `actionSpeed` are
not schema fields; a firefighter nozzle still exposes `attachments.hose` on the item for caller
effects, but the body does not build a trailing hose.

Profession presets may still pass legacy construction keys (`weapon`, `offhand`, `weaponScale`,
`staffTop`, `gunSight`, and similar) through the loadout adapter. `sword` maps to `shortSword`,
`axe` to `battleAxe`, `hammer` to `warHammer`, `book` to `spellbook`. Those keys are not body
schema fields.

Read the selected schema for exact choices:

```sh
python <skill-root>/forge/factory_manifest.py --factory CharacterVisualFactory
```

`randomCharacterOptions(seed, overrides)` preserves the selected preset and its loadout identity
while varying height, build, head shape, stride and palette. Explicit overrides win. Save `params`
after equipment changes to retain the current body and loadout together.

## Actions and equipment ownership

Body motions use `setPose(motion, seconds)` with the
[named-action timing contract](asset-factory-contract.md#named-actions).
`SIMPLE_CHARACTER_MOTIONS` is `{ idle, walk, run }`. There is no instance `actions` member and no
body combat/traversal catalog: jump, crouch, slide, sit, crawl, climb, swim, wave, cheer, punch,
kick, hit and death are gone. Gameplay owns those states.

An equipment action is `setPose('right:slash', seconds)` (or `left:…`). The first token is the hand,
the second is an item action from the [equipment factory](equipment-visual-factory.md). Extra colons
throw. Sampling an equipment action presents an idle body plus the item's holding/action
choreography; it does not blend with a simultaneous walk or run.

| Port | Semantics |
| --- | --- |
| `equip(hand, optionsOrEquipment)` | Installs options or a live standalone item in `left` or `right`; returns it and resets the actor pose. A replaced item is disposed. `null` clears the slot. |
| `unequip(hand)` | Detaches and resets the item, returns it alive and transfers ownership to the caller. Empty slot returns `null`. |
| `equipment` | Current left/right equipment instances. Use equip/unequip to change them. |
| `getEquipmentActions(hand)` | Available item actions, excluding those that need an unavailable support hand. |
| `setEquipmentAction(hand, action, seconds)` | Equivalent to `setPose('right:fire', seconds)` for the corresponding hand/action. |
| `gripStatus` | Primary/support grip error and reachability diagnostics for the current pose. |
| `motions` | `{ idle, walk, run }` display labels. |
| `actionState` | Current equipment-action sample, or `null` during body-only poses. Query again after swapping equipment. |

A character exclusively owns each equipped item's lifetime. It disposes equipped items on teardown;
calling an equipped item's `dispose()` directly throws. To retain or transfer an old item, unequip
it **before** replacing it:

```js
const retained = actor.unequip('right');
actor.equip('right', { preset: 'bow' });
actor.setPose('right:draw', 0.4); // support hand is empty
actor.setPose('right:loose', 0.6);
actor.unequip('right').dispose();
actor.equip('right', retained);
// Teardown releases body and the currently equipped item:
actor.dispose();
```

Two-bone IK preserves limb lengths and clamps reach. A support grip is used only when the item
provides one and the other hand is free. `twoHand` is a request; a pistol or occupied second hand
falls back to a one-handed hold. Bow draw/loose require a free support hand and are omitted otherwise.
Arbitrary external rigs cannot be equipped through this port; use ordinary attachments and own
any custom animation/lifetime adapter.

## Placement and lifetime

`group === mesh` uses +X right, +Y up, -Z forward, with origin between the feet. `rig` exposes body,
chest, head, arms and legs for inspection. `attachments` includes `head`, `leftHand`, `rightHand`,
and current `weapon`/`offhand` roots when those slots are filled. Attach a muzzle effect to
`actor.equipment.right?.attachments.muzzle` when that item supplies it. Caller effects remain
caller-owned and must be released separately.

`bounds` and `dimensions` are construction-time local rest measurements including the initial
loadout; swaps do not recalculate them. There is no `collisionHint`. `reset()` restores idle at zero
without moving the placement root. Pose/reset/equipment mutation after disposal throws. Each instance
owns its own geometry/material caches; `getStats()` includes the currently equipped items. Cloth is
absent; no terrain foot planting, skeletal retargeting, ragdoll or gameplay weapon system is supplied.

## Copy and verify

Pass `assets/world/object/factory/CharacterVisualFactory.js` to the
[transitive copier](asset-factory-contract.md#copy-and-compose). It includes CharacterLoadout,
CharacterEquipmentController, EquipmentVisualFactory, EquipmentActions and VisualFactoryUtils.
No wearable or CharacterActions module exists. Use project-local Three.js 0.161.0.

Check the chosen silhouette/loadout at the gameplay camera distance, swap and transfer equipment,
sample idle/walk/run and item actions at start/middle/end, and reset. Verify grip alignment under
the actor's actual parent transform and release caller effects separately. The
[preview](../../assets/examples/factory-preview/index.html) is component evidence; movement,
collision, damage and restart need verification in the consuming game.
