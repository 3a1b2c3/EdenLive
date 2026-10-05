# Fantasy creature visual factory

[Source](../../assets/world/object/factory/FantasyCreatureVisualFactory.js) is the simplified
fantasy creature factory. It keeps the same nine species and the same shared combat actions, drawn
with body blocks, beam limbs and flat wing panels; the detailed anatomy sliders are gone. Species
geometry lives in [FantasyCreatureParts.js](../../assets/world/object/factory/FantasyCreatureParts.js).
For a human with clothes and interchangeable equipment, use the
[character factory](character-visual-factory.md). Fantasy anatomy has its own rig and does not expose
the character loadout adapter.

Read the [shared contract](asset-factory-contract.md) for normalization, coordinates, lifetime and
[creature actions](asset-factory-contract.md#creature-actions).

## Construct and select

Exports: canonical `buildSimpleFantasyCreatureVisual`, `normalizeSimpleFantasyCreatureOptions`,
`randomSimpleFantasyCreatureOptions`, `SIMPLE_FANTASY_PRESETS`, `SIMPLE_FANTASY_SCHEMA`,
`SIMPLE_FANTASY_MOTIONS`, `SIMPLE_FANTASY_SPECIES`, `simpleFantasyMotionLabels`. Compatibility
aliases keep the historical names: `createFantasyCreatureVisual` and `buildFantasyCreatureVisual`
(both alias the simple builder), `normalizeFantasyCreatureOptions`,
`randomFantasyCreatureOptions`, `FANTASY_PRESETS`, `FANTASY_SCHEMA`, `FANTASY_MOTIONS`,
`FANTASY_SPECIES` and `fantasyMotionLabels`.

Eighteen presets across nine species; the preset determines the species:

| Species | Presets | `move` / `action` presentation |
| --- | --- | --- |
| Dragon | `dragon` (default), `wyvern`, `drake`, `hatchling` | Winged flight or four-leg walk / rearing roar |
| Zombie | `zombie` | Shambling walk / arm grab |
| Slime | `slime`, `cubeSlime` | Bounce / charge squash |
| Skeleton | `skeleton`, `skeletonGuard` | Bone walk / arm swing |
| Orc | `orc` | Heavy walk / arm raise roar |
| Vampire | `vampire` | Hover glide / cloak cast |
| Werewolf | `werewolf` | Loping run / head-up howl |
| Demon | `demon`, `imp` | Wing hover or heavy walk / wing threat |
| Elemental | `earthElemental`, `fireElemental`, `iceElemental`, `stormElemental` | Drift orbit / core surge |

`SIMPLE_FANTASY_SPECIES` lists the nine species ids (`dragon`, `zombie`, `slime`, `skeleton`, `orc`,
`vampire`, `werewolf`, `demon`, `elemental`). Four species builders in
[FantasyCreatureParts.js](../../assets/world/object/factory/FantasyCreatureParts.js) draw them:
`buildSimpleDragon` handles dragon, `buildSimpleHumanoid` the six humanoid species (zombie,
skeleton, orc, vampire, werewolf, demon), `buildSimpleSlime` slime and `buildSimpleElemental`
elemental. The shared action rig maps those to the families `dragon`, `slime`, `elemental` or
`humanoid`; slime squashes through pounce, charge and death, golem elementals topple chest-first,
and the vortex/crystal elementals sink instead of falling. Each builder exposes the same animation
signature, so `move` and `action` (the per-species signature pose) work uniformly.

`normalizeSimpleFantasyCreatureOptions` derives `species` from the selected preset, freezes it into
the resolved options, and throws a `RangeError` if an explicit `species` disagrees with the preset.
Prefer correcting the preset over overriding `species`. `randomSimpleFantasyCreatureOptions(seed,
overrides)` picks a random preset, varies only the fields applicable to that species (never the
species, `referenceHeight`, `motionSpeed` or `motionAmount`), shifts the palette hue and lightness,
and lets `overrides` win. Save resolved `params` for reproduction.

```js
import { buildSimpleFantasyCreatureVisual } from '/assets/world/object/factory/FantasyCreatureVisualFactory.js';

const dragon = buildSimpleFantasyCreatureVisual({ preset: 'wyvern', heightScale: 1.6 });
scene.add(dragon.mesh);                    // the fantasy root is `mesh`; there is no `group` alias
dragon.setPose('move', 0.5);
// When a game-owned pounce begins, restart its clock and sample each frame:
dragon.setPose('pounce', 0.6, { inPlace: true, heading: -0.4 });
const { origin, direction } = dragon.getAttackFrame();
// Use the frame for an effect; game rules own hits.
// On round reset: dragon.reset(); on teardown: dragon.dispose();
```

## Tune appearance and motion

Grouped fields from `SIMPLE_FANTASY_SCHEMA`; defaults are the schema values, and the `when`
predicates below describe which species actually uses each field (the preview shows only the
applicable ones). The combat rows repeat the shared `CREATURE_ACTION_SCHEMA` inlined from
[CreatureActions.js](../../assets/world/object/factory/CreatureActions.js); every combat field is
`randomize: false`.

| Option group | Main controls and effects |
| --- | --- |
| Size & build | `referenceHeight` (2.2, 0.8..3.2) times `heightScale` (1, 0.15..4) gives the total rest height — the factory grounds the rig, then scales it so `dimensions.y` equals this product (`scaleInfo.neutralHeight`). `bodyWidth` (1, 0.65..1.6); `headScale` (1, 0.65..1.4, skipped for slime and non-golem elementals) |
| Limbs & pose | `legLength` (1, 0.65..1.4) and `limbThickness` (1, 0.6..1.6) for humanoids and dragons; `armLength` (1, 0.7..1.4) and `hunch` (0.05, 0..0.45) for humanoids |
| Head & spikes | `hornStyle` (`none`/`swept`/`spires`/`ram`) for dragon, orc and demon; `hornSize` (1, 0.45..1.7); `spikeCount` (4, 0..7, step 1) for dragon, werewolf and demon |
| Dragon build | `dragonLegs` (`four`/`two`, wyvern-style), `bodyLength` (1, 0.65..1.7), `neckLength` (1, 0.5..1.7) |
| Wings & tail | `wings` (true) and `wingSpan` (1, 0.6..1.8) for dragon and demon; `tailLength` (1, 0.4..1.8) for dragon, demon and werewolf; `tailTip` (`point`/`club`/`arrow`) for dragon and demon |
| Clothing | `armor` (`none`/`scrap`/`plate`) for zombie, skeleton, orc and demon; `cloak` (false) with `cloakLength` (1, 0.5..1.2) and `cloakWidth` (1, 0.7..1.6) for skeleton, vampire and demon |
| Slime & elemental | `slimeShape` (`dome`/`drop`/`cube`), `core` (true), `crown` (false); `elementForm` (`golem`/`vortex`/`crystal`), `shardCount` (6, 3..10, step 1), `fragmentScale` (1, 0.6..1.5), `orbitRadius` (1, 0.6..1.5) |
| Species motion | `motionSpeed` (1, 0.2..3) and `motionAmount` (1, 0..1.5) scale the per-species idle/move/signature animation; `motionAmount: 0` suppresses it |
| Combat actions | `actionSpeed` (1, 0.2..3) divides the effective duration of `pounce` (1.2 s), `charge` (1.35 s) and `death` (1.1 s) before the division; `pounceDistance` (0.65, 0..2) and `chargeDistance` (1, 0..3) travel in rest-length multiples along local -Z; `pounceHeight` (0.28, 0..1.2) rises in rest-height multiples; `deathSide` (`right`/`left`, default `right`) chooses the fall side |

Base palette keys: `body: '#869887'`, `belly: '#c8c7a1'`, `clothing: '#737b8d'`,
`armor: '#7e9394'`, `membrane: '#9c6c7b'`, `bone: '#e6d9b8'`, `accent: '#d2b075'`,
`core: '#e0d295'`, `eye: '#d7c480'`, `mouth: '#3f4952'`. Presets override the keys their anatomy
paints. Materials are matte flat-shaded `MeshStandardMaterial` (roughness 0.72, metalness 0.04),
cached per instance; the factory does not set per-mesh shadow flags.

Use `SIMPLE_FANTASY_SCHEMA` or the [preview](../../assets/examples/factory-preview/index.html) for
fields relevant to the selected anatomy. Geometry edits require rebuilding. `motionAmount: 0`
suppresses species motion; use `still` to freeze the whole visual regardless of attack settings.

## Instance ports and integration

The instance exposes `mesh` — unlike the animal factories this builder assembles its API directly,
so there is no `group` alias; place `asset.mesh`. The rest of the surface matches the shared
creature contract: frozen `params` (including `species` and `preset`), local construction
`bounds`/`dimensions` measured after grounding and scaling (`bounds.min.y` is 0), `scaleInfo`
(`{ referenceHeight, heightScale, neutralHeight }`), `actions` (pounce/charge/death specs with
effective duration), `actionState`, `setPose`, `reset`, `getStats`, `dispose`, `getAttackFrame`
and `actionRig { heading, travel }`. The pose keys are the motion set `still`, `idle`, `move` plus
the species `action` and the combat `pounce`, `charge`, `death`; unlike quad/bird/fish there is no
numeric-time shorthand and there is no `motions` member — labels come from `SIMPLE_FANTASY_MOTIONS`
or `simpleFantasyMotionLabels(params)` instead.

`rig` carries the builder anatomy (`body`, `head`, `jaw`, `neck`, `chest`, `legs`, `arms`, `wings`,
`tail`, `cloak`, `core`, `orbit`, `fragments`, `limbs` as that species builds them) plus the shared
`motion` group. `attachments` has `body`, `head`, `mouth` (the jaw), `leftHand`, `rightHand`,
`tail`, `core` and the shared `attack` mount; hands exist only for humanoid species, `mouth` misses
on slime, and `core`/`tail` are absent or null where the anatomy lacks them — check a node before
mounting caller-owned effects. `setPose` behaves as on the animal factories: heading in radians
about local +Y, travel along local -Z, `inPlace: true` suppresses travel while pounce rise remains,
one-shot progress clamps and holds the endpoint, and unknown motions or non-finite times throw
without changing the pose.

The placement root stays under caller control; `setPose` never moves it. Local rest bounds do not
track wings, squash, falling or attack displacement; use game-owned collision shapes. There is no
navigation, targeting, breath projectile or damage system in this factory.

Select `assets/world/object/factory/FantasyCreatureVisualFactory.js` with the
[transitive copier](asset-factory-contract.md#copy-and-compose); the species parts
([FantasyCreatureParts.js](../../assets/world/object/factory/FantasyCreatureParts.js)), shared
creature actions and primitive kit follow automatically. Validate a chosen preset's silhouette,
signature action, attack and reset in the preview and then the consuming game.
[Action regressions](../../forge/tests/js/extended-factory-actions.test.mjs) cover every preset's
deterministic seeking, endpoints, grounded rest scale, seeded variation, malformed options, in-place
attack frames and cleanup.

If a monster moves twice as far as intended, disable its internal forward attack travel with
`inPlace`. If a preset changes to the wrong anatomy, select the correct preset rather than overriding
`species`. If an effect is missing, inspect conditional attachment availability for that anatomy.