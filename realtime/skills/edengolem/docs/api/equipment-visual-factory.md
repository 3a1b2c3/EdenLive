# Equipment visual factory

[Source](../../assets/world/object/factory/EquipmentVisualFactory.js) builds independently reusable
weapons, shields and profession tools. Use it for a display, a dropped item or a character loadout.
The [shared contract](asset-factory-contract.md) defines normalization, named action sampling,
coordinates and resource lifetime. A held item uses the
[character's equipment adapter](character-visual-factory.md#actions-and-equipment-ownership).

## Construct and select

Exports (canonical; legacy aliases in parentheses): `buildSimpleEquipmentVisual`
(`createEquipmentVisual`, `buildEquipmentVisual`), `normalizeSimpleEquipmentOptions`
(`normalizeEquipmentOptions`), `randomSimpleEquipmentOptions` (`randomEquipmentOptions`),
`SIMPLE_EQUIPMENT_PRESETS` (`EQUIPMENT_PRESETS`), `SIMPLE_EQUIPMENT_SCHEMA` (`EQUIPMENT_SCHEMA`),
`SIMPLE_EQUIPMENT_MOTIONS` (`EQUIPMENT_MOTIONS`, the `{ still, inspect }` motion map) and
`SIMPLE_EQUIPMENT_TYPES` (`EQUIPMENT_TYPES`, the per-kind preset catalogue). Each item keeps the
same grips, support points, action anchors and actions as before, drawn with a few blocks instead
of detailed parts.

| Kind | Presets |
| --- | --- |
| `blade` | `shortSword` (default), `greatSword`, `curvedSword`, `dagger` |
| `axe` | `battleAxe`, `doubleAxe` |
| `hammer` | `warHammer` |
| `mace` | `mace` |
| `spear` | `spear` |
| `staff` | `staff` |
| `wand` | `wand` |
| `bow` | `bow` |
| `crossbow` | `crossbow` |
| `shield` | `roundShield`, `kiteShield`, `towerShield` |
| `book` | `spellbook` |
| `orb` | `orb` |
| `firearm` | `rifle`, `smg`, `shotgun`, `sniperRifle`, `machineGun`, `pistol` |
| `waterNozzle`, `syringe`, `flashlight`, `radio`, `medkit`, `clipboard` | One preset each |

`preset` determines `kind` and `firearmType`; overrides of those derived (`derived: true`) fields
are replaced with the preset's values. Size, palette and timing remain configurable. Seeded options
preserve the selected equipment family; pass a preset when the game requires a specific tool.

```js
import { buildSimpleEquipmentVisual } from '/assets/world/object/factory/EquipmentVisualFactory.js';

const bow = buildSimpleEquipmentVisual({ preset: 'bow', referenceHeight: 2.2, sizeRatio: 0.6 });
scene.add(bow.mesh);
bow.setPose('draw', 0.4);        // articulated string and arrow at an absolute action time
bow.setPose('loose', 0.2);       // the caller starts a separate release action
// On teardown: bow.dispose();
```

The instance root is `mesh`; there is no `group` alias on this API.

## Size and shape

`referenceHeight * sizeRatio` sets the final rest longest side; every shape field redistributes
proportions inside it without increasing the item's overall size. The whole model is scaled so the
raw longest dimension becomes `referenceHeight * sizeRatio`.

| Option | Default / range | Applies when | Effect |
| --- | --- | --- | --- |
| `actionSpeed` | 1 / 0.25..2 | always | Action timing multiplier |
| `actionAmount` | 1 / 0.5..1.2 | always | Holder gesture and articulation strength |
| `kind` | From preset (derived) | — | Which part set builds |
| `referenceHeight` | 2.2 / 0.8..3.2 m | always | Reference character height |
| `sizeRatio` | 0.5 / 0.1..1.8; presets 0.16..1.15 | always | Rest longest side divided by reference height |
| `bladeShape` | `straight` / `straight`, `broad`, `curved` | `kind === blade` | Blade profile |
| `bladeLength`, `bladeWidth`, `gripLength` | 0.95 / 0.4..1.5; 0.16 / 0.06..0.38; 0.24 / 0.15..0.6 | blade | Blade and grip; `gripLength >= 0.3` also adds the support mount |
| `haftLength` | 1 / 0.5..1.8 | axe, hammer, mace, spear, staff, wand | Shaft length |
| `headWidth`, `headHeight` | 0.4 / 0.16..0.9; 0.3 / 0.16..0.6 | shaft kinds; all but mace | Head dimensions |
| `axeSides` | `single` / `single`, `double` | axe | Edge count |
| `staffTop` | `crystal` / `crystal`, `orb`, `cross`, `fork` | staff, wand | Top piece |
| `bowSpan` | 1.2 / 0.6..1.8 | bow, crossbow | Limb span |
| `drawAmount` | 0.1 / 0..0.45 | bow, crossbow | String rest offset |
| `shieldShape` | `round` / `round`, `kite`, `tower` | shield | Shield outline |
| `shieldWidth` | 0.8 / 0.5..1.3 | shield | Width divided by height |
| `firearmType` | From preset (derived) | firearm | Which firearm body builds |
| `barrelLength` | 1 / 0.55..1.7 | firearm | Barrel length |
| `gunStock` | `full` / `none`, `full`, `folded` | firearm and not pistol | Stock shape |
| `gunMagazine` | `straight` / `straight`, `curved`, `drum`, `box` | long gun and not shotgun | Magazine profile |
| `gunSight` | `iron` / `iron`, `reflex`, `scope` | firearm | Sight block |
| `nozzleLength` | 1 / 0.65..1.6 | waterNozzle | Nozzle length |
| `nozzleTip` | `wide` / `wide`, `narrow` | waterNozzle | Tip shape |

`colors` keys are `body`, `metal`, `grip`, `accent`, `core`, `paper`. Thicknesses, support
placement and grip positions are locked constants. Guard shapes, shield symbols, sight housings,
spikes, rings, book lines and medical marks are gone; inspect the remaining silhouette controls in
the [preview](../../assets/examples/factory-preview/index.html) or use
[the option query commands](asset-factory-contract.md#options-coordinates-and-lifetime).

## Actions and mounting

Every item has static `still` and an eight-second `inspect` rotation (`SIMPLE_EQUIPMENT_MOTIONS`).
Further actions depend on kind:

| Kind | Action IDs |
| --- | --- |
| Blade | `slash`, `thrust` |
| Axe | `chop` |
| Hammer, mace | `smash` |
| Spear | `thrust` |
| Staff, wand, orb | `cast` |
| Bow | `draw`, `loose` |
| Crossbow, firearm | `aim`, `fire` |
| Shield | `block`, `bash` |
| Book | `read`, `cast` |
| Water nozzle; syringe; flashlight | `spray`; `inject`; `scan` |
| Radio; medkit; clipboard | `talk`; `heal`; `read` |

The shared action catalog (`EquipmentActions.js`) carries `{ label, duration, loop, freeHand }`;
there is no `mode` field:

| Action | Label | Duration | Loop | Free hand |
| --- | --- | --- | --- | --- |
| `slash` | slash | 1.1 | no | no |
| `thrust` | thrust | 0.95 | no | no |
| `chop` | chop | 1.5 | no | no |
| `smash` | smash | 1.6 | no | no |
| `cast` | cast | 1.8 | no | no |
| `block` | block | 2 | yes | no |
| `bash` | bash | 1.1 | no | no |
| `aim` | aim | 2 | yes | no |
| `fire` | fire | 0.7 | no | no |
| `draw` | draw bow | 2 | yes | yes |
| `loose` | loose arrow | 1.7 | no | yes |
| `spray` | spray | 3 | yes | no |
| `inject` | inject | 2 | no | no |
| `scan` | scan | 3.5 | yes | no |
| `talk` | talk | 2.5 | yes | no |
| `heal` | open medkit | 2.6 | no | no |
| `read` | read | 3 | yes | no |

Samples use `elapsed = max(0, seconds) * actionSpeed`, so the effective one-shot duration is
`duration / actionSpeed`. One-shots clamp before the start and after the end and hold their
endpoint; loop actions may have a lead-in and a duration is not a wrap period. A `freeHand` action
is unavailable while the other hand holds something; the character adapter applies that filter in
`getEquipmentActions`. `reset()` restores `still`. Pose sampling leaves placement untouched.

`setPose` animates the item's internal parts: bowstring/arrow/limb assembly, firearm slide
recoil, nozzle valve, syringe plunger and liquid, case lid, book covers and orb rings. A rigid
sword's swing is holder choreography, exposed through `sampleAction(action, seconds)` and
`getHoldPose()` in shoulder-relative proportions of the holder's height. The character adapter
consumes both and moves its arms automatically. A custom holder can consume those samples; a
standalone rigid item does not swing its placement root just because `slash` is sampled.

| Port | Meaning |
| --- | --- |
| `mesh` | Placement root (no `group` alias). The main grip sits on the inspect rotation axis and the rest item is lifted to sit on its origin ground. |
| `attachments.grip` | Main hand mount; use the character adapter to align it |
| Other `attachments` | Conditional per-kind mounts: blade `tip`/`edgeStart`/`supportGrip`; shaft `tip`/`supportGrip` (not wand); bow `nock`/`muzzle` plus `supportGrip` on `nock`; crossbow `nock`/`supportGrip`/`muzzle`; shield `face`; book `face`; orb `tip`; firearm `supportGrip` (not pistol) and `muzzle`; water nozzle `supportGrip`/`hose`/`muzzle`; syringe `tip`; flashlight `light`; radio, medkit, clipboard `face`. `attachments.action` aliases the primary effect anchor |
| `gripBounds` | Local rest bounds with the main grip at the origin, before grounding |
| `inspectBounds` | Conservative local envelope for the rotating rest item |
| `rig` | `{ motion, model, parts }`; parts carry the articulated nodes |
| `scaleInfo` | `{ referenceHeight, sizeRatio, longestSide }` |
| `actionState` | `{ action, progress, active, finished }` of the current sample, or `null` at `still` |
| `claim(holder)` / `release(holder)` / `owner` | Exclusive ownership; claiming a held item throws `Equipment is already held`. Release leaves the item alive for another holder. |
| `disposed` | True after disposal |
| `getStats()` / `dispose()` | Mesh/geometry/material counts; dispose is idempotent but throws `Unequip the item before disposing it` while still owned |

A free item owns its geometry/materials and has idempotent `dispose()`. Equipping transfers exclusive
ownership to the character: replacing or disposing that character releases its held items. Use
`character.unequip(hand)` to recover a live, reset item before attaching it elsewhere or disposing it.
Direct disposal while equipped throws. Ordinary caller-mounted effects remain caller-owned.

## Integrate and verify

Select `assets/world/object/factory/EquipmentVisualFactory.js` in the
[transitive asset copier](asset-factory-contract.md#copy-and-compose); it includes
VisualFactoryUtils and the shared action module. Selecting CharacterVisualFactory already includes
this factory. Use the independent project's pinned local Three.js dependency.

Review item silhouette and grips in the preview, then test the actual holder's intended actions and
restart. [Action regressions](../../forge/tests/js/extended-factory-actions.test.mjs) cover equipment
ownership, action endpoints, support-hand availability and character composition. A muzzle or cast
mount locates a visual effect; projectile spawning, ammunition and damage belong to game rules.

If a character action is absent, inspect `character.getEquipmentActions('right')` (or `'left'`) for that hand:
a bow needs a free support hand. If a rigid item appears motionless in a standalone action, consume
its holder sample or equip it. If size tuning seems ineffective, check longest-side normalization.