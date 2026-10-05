# Pickup visual factory

[Source](../../assets/world/object/factory/PickupVisualFactory.js) creates collectible props with
consistent size, grouped layouts and idle/transition animation. Use it for currency, resources,
food, keys and quest items. Read the [shared contract](asset-factory-contract.md) for normalization,
coordinates and lifetime. Collection rules stay with the game or the optional PickupObject wrapper.

## Construct and select

Exports (canonical; legacy aliases in parentheses): `buildSimplePickupVisual`
(`createPickupVisual`, `buildPickupVisual`), `normalizeSimplePickupOptions`
(`normalizePickupOptions`), `randomSimplePickupOptions` (`randomPickupOptions`),
`SIMPLE_PICKUP_PRESETS` (`PICKUP_PRESETS`), `SIMPLE_PICKUP_SCHEMA` (`PICKUP_SCHEMA`) and
`PICKUP_MOTIONS` (also exported as `SIMPLE_PICKUP_MOTIONS`).

Twenty-three presets supply a recognizable starting shape and palette, without defining reward
values: `coin` (default), `coinStack` (five coins, flat stack), `ring`, `gem` (diamond),
`crystal` (cluster), `star`, `heart`, `healthPotion` (round bottle), `manaPotion` (flask),
`medkit`, `apple`, `bread`, `drumstick`, `ammoBox` (hard case), `shells` (loose bundle),
`battery`, `energyOrb`, `key` (round bow), `bossKey` (diamond bow), `keycard`, `scroll`, `tome`,
`relic`. They span sixteen editable `kind` values: `coin`, `ring`, `gem`, `star`, `heart`,
`potion`, `medkit`, `food`, `ammo`, `battery`, `orb`, `key`, `keycard`, `scroll`, `book`,
`relic`. Unlike derived equipment fields, an explicit `kind` override replaces the preset's kind;
silhouette choices and palette move with it.

Each item is one or two primitives; faces, symbols, gauges, straps, handles, stripes, chips,
knobs and cartridges are gone. Sizing, layout and the hover/appear/collect animation are unchanged.

```js
import { buildSimplePickupVisual } from '/assets/world/object/factory/PickupVisualFactory.js';

const reward = buildSimplePickupVisual({ preset: 'gem', count: 3, layout: 'cluster', shapeSeed: 12 });
scene.add(reward.group);
reward.setPose('idle', elapsedSeconds);
// After game rules accept collection, sample time since that transition began:
reward.setPose('collect', collectSeconds);
// On round reset: reward.reset(); on teardown: reward.dispose();
```

## Size, layout and animation

| Option | Default / range | Applies when | Effect |
| --- | --- | --- | --- |
| `referenceHeight` | 2.2 / 0.8..3.2 m | always | Reference character height |
| `sizeRatio` | 0.24 / 0.05..0.8; `coin` preset 0.18 | always | Each item's rest longest side divided by reference height |
| `resting` | `upright` / `upright`, `flat` | always | Rest orientation |
| `kind` | `coin` / sixteen kinds | always | Item type; explicit value wins over the preset's kind |
| `count` | 1 / 1..9, integer | always | One visual group with repeated items |
| `layout` | `row` / `row`, `stack`, `cluster` | `count > 1` | Arrangement: rows along X, stacks along Y or a seeded grid |
| `spacing` | 0.18 / 0..0.8 | `count > 1` | Item gap as a size-ratio multiple |
| `shapeSeed` | 42 / 0..999999, integer | `count > 1` and not `row` | Fixed layout scatter seed |
| `gemShape` | `diamond` / `diamond`, `crystal`, `cluster` | kind gem | Gem profile |
| `bottleShape` | `round` / `round`, `square`, `flask` | kind potion | Bottle profile |
| `packShape` | `box` / `box`, `pouch`, `bundle` | kind medkit, ammo | Supply packaging |
| `foodShape` | `apple` / `apple`, `bread`, `drumstick` | kind food | Food shape |
| `keyHead` | `round` / `round`, `square`, `diamond` | kind key | Key bow profile |
| `hoverHeight` | 0.4 / 0..2 | always | Hover clearance in single-item size ratios |
| `bobAmount` | 0.12 / 0..0.5 | always | Bob travel in single-item size ratios |
| `spinSpeed` | 0.2 / -1..1 turns per second | always | Rotation; negative reverses direction |
| `motionSpeed` | 1 / 0.2..3 | always | Animation speed multiplier |
| `transitionDuration` | 0.7 / 0.2..2 s | always | Appear/collect duration before the speed multiplier |
| `pickupPadding` | 0.25 / 0..1 | always | Collection volume padding in single-item size ratios |

`colors` keys are `body`, `accent`, `trim`, `liquid`. Silhouette proportions, the 12-sided disc
profile, bottle fill, cartridge count and key teeth are locked constants. Seeded options preserve
the chosen item identity and palette while varying `sizeRatio`, spacing and count for multi-item
presets, potion/key silhouettes and color tint; `shapeSeed` becomes the seed, so reproducible
seeds build reproducible scatter. A stack or cluster's overall bounds can grow with count even
though each item keeps the requested size.

| Action | Behavior |
| --- | --- |
| `still` | Grounded rest assembly; also the reset state |
| `idle` | Internal hover, bob and spin, sampled from absolute seconds |
| `appear` | One-shot reveal into the hovering pose |
| `collect` | One-shot rise/shrink, then hides the internal model and holds the endpoint |

Pose keys are exactly `still`, `idle`, `appear`, `collect` (`PICKUP_MOTIONS`); anything else
throws and names them. Every sample restores the motion group first, so seeking is deterministic.
`idle` adds `hover + (sin(phase(motionSpeed)) + 1) * 0.5 * bob` to the rest height and rotates by
`phase(motionSpeed * spinSpeed)`, where `phase(rate)` is `0` for rate zero and otherwise
`(elapsed % (1 / |rate|)) * rate * 2π` — the bob period is `1 / motionSpeed` seconds and the spin
period `1 / (motionSpeed * |spinSpeed|)`. `appear` scales the group `0 → 1` and `collect` `1 → 0`
with a smoothstep over `transitionDuration / motionSpeed` seconds, rising up to `0.7 * itemSize`
and rotating by `progress * transitionDuration * 2π * spinSpeed`; the group is hidden at
scale zero. The factory never hides or moves the placement root. There is no `actions` table, no
`motions` property and no `actionState` on the instance; the caller owns each transition clock.

## Bounds, mounts and optional collection wrapper

`bounds` and `dimensions` describe the grounded construction rest assembly. `pickupVolume` is a
frozen local cylinder descriptor `{ shape: 'cylinder', center: [x, y, z], radius, height }` whose
radius is half the assembly diagonal plus padding and whose height spans the assembly plus hover,
bob and padding. Transform a copy of it through placement for a custom overlap test.
`attachments.pickup` is its fixed center, `focus` follows the animated group, and `items` contains
the item nodes. The collection volume is a hint, not a physics collider.

[PickupObject](../../assets/world/object/PickupObject.js) is an optional lightweight owner:

```js
import { PickupObject } from '/assets/world/object/PickupObject.js';

const pickup = new PickupObject({
  id: 'health-1', type: 'health',
  pickupVisual: buildSimplePickupVisual({ preset: 'healthPotion' }),
  position: spawnPosition, scale: 1, basis: worldBasis,
});
scene.add(pickup.group);
// Each frame:
pickup.animate(dt);
if (pickup.tryCollect(playerPosition, playerRadius)) health += 25;
// Round reset: pickup.reset(); teardown: pickup.dispose();
```

The wrapper owns placement, basis conversion, uniform scale and a finite nonnegative idle clock;
`animate` feeds it into `setPose('idle', phase)`. `tryCollect` uses planar reach, ignoring height
so hover cannot change eligibility; it returns true exactly once and immediately hides the root.
`reset` makes it available again and resets the visual. Use a game-owned collection transition if
the `collect` animation should remain visible. The wrapper owns the supplied visual and disposes
it; do not share that instance between wrappers.

## Integrate and verify

Select `assets/world/object/factory/PickupVisualFactory.js` with the
[transitive copier](asset-factory-contract.md#copy-and-compose); VisualFactoryUtils follows
automatically. If using PickupObject, select `assets/world/object/PickupObject.js` too; its basis
helper is copied automatically. The wrapper receives a factory instance at runtime and does not
import a specific visual factory.

Inspect the chosen shape, count and hover in the [preview](../../assets/examples/factory-preview/index.html).
[Pickup behavior checks](../../forge/tests/js/greybox-and-pickup.test.mjs) cover exactly-once collection,
height-independent reach and reset; [action checks](../../forge/tests/js/extended-factory-actions.test.mjs)
cover factory transitions, scale and ownership. Verify the game's actual reward and restart separately.

If a collectible disappears before its transition, check whether PickupObject has already hidden
the root. If the group is larger than expected, `sizeRatio` applies to each item. If an airborne
collector can reach a floor pickup, use a height-aware game overlap test instead of planar reach.