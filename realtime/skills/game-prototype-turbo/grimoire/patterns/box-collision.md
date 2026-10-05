# Support and side blocking for solid boxes

Outcome: box sides block movement and their tops provide support under the chosen stepping policy.
Use only when a moving actor must stand on and collide with solid box geometry. Grid occupancy,
fixed menus, open flight and arbitrary rigid-body physics need different models. Reuse
`assets/world/environment/BoxObstacleField.js` when its assumptions fit.

## Workflow

Inspect the actor footprint, movement step and shared solid geometry before selecting tolerances.
A support-height query alone allows walking through the sides of taller boxes. Floor/wall behavior
is a relationship to feet at the start of the movement, not a permanent per-box flag:

| Box top relative to starting feet plus step tolerance | Required response |
| --- | --- |
| At or below | Possible support from above |
| Above | Block side entry; do not snap the actor onto the top |

Resolve blocking before sampling support, since push-out changes the occupied footprint:

```js
field.resolve(position, {
  radius, height, referenceUp, previousPosition: intent.startPosition,
});
const support = field.supportHeightAt(position, referenceUp);
```

`previousPosition` enables swept movement. Without it, compare `maxSpeed * maxFrameDelta` with
`field.maxSafeStep()`; discrete push-out cannot catch an entire thin wall crossed in one frame.
Match collision dimensions to the actual actor footprint and chosen stepping policy.

Keep `-Infinity` for missing support when falling is possible; substituting a finite floor changes
the game's loss/recovery behavior. If a lower surface is intended, author it explicitly. Visual
cues must distinguish safe lower ground from a lethal drop when the player needs that knowledge.

Use shared box data for rendering and collision. Express supported objects relative to their
surface height; `findCoplanarTops(boxes, {groundUp})` can identify overlapping flush faces. Do not
require global ground or step tolerance in a board that only needs occupancy.

## Verify and record

Verify side approach, landing from above, a relevant thin-boundary move and unsupported motion.
Record tested geometry, observed contact/support behavior and the artifact in stage evidence.
Navigation/attack occlusion remain separate consumers: see [spatial navigation](spatial-navigation.md).
