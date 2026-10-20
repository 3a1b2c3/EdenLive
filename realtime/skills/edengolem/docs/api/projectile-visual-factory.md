# Projectile visual factory

[Source](../../assets/world/object/factory/ProjectileVisualFactory.js) builds two projectile
presentations — a tracer bullet and a missile with flame and trail — and a `step()` that poses them
from caller-supplied flight state. It does not implement the
[scene-visual profile](asset-factory-contract.md#scene-visual-interface-profile): there are no presets,
no normalized `params`, no `bounds`/`dimensions`, no `getStats()` and no `dispose()`.

This module is presentation only. Flight, homing, hit checks and expiry belong to
[ProjectileObject.js](../../assets/world/object/ProjectileObject.js) or the game's own rules; nothing
here integrates motion or decides whether something was hit.

## Exports

```js
createBulletProjectileVisual()   // { group, mesh, step }
createMissileProjectileVisual()  // { group, mesh, flame, trail, step }
```

Neither entrypoint takes options; sizes and colors are fixed. Rebuild or replace the material for a
different look.

## Instance API

| Port | Semantics |
| --- | --- |
| `group` | Scene root, named `ProjectileObject.bullet` / `.missile`. Add it once and leave it in place; `step()` positions the children in that group's space |
| `mesh` | The projectile body: an unlit sphere for the bullet, an emissive cone for the missile |
| `flame`, `trail` | Missile only. The flame sits 7.5 units behind the tip; the trail is a stretched cylinder spanning 84 to 9 units behind it |
| `step(state)` | Absolute visual sample from the caller's flight state |

`step()` reads the fields each visual needs:

| Field | Bullet | Missile |
| --- | --- | --- |
| `position` | required | required |
| `direction` | unused | required, expected normalized |
| `ageSeconds` | required, fades opacity | required, drives flame flicker |
| `lifetimeSeconds` | required, the fade denominator | unused |

The bullet fades linearly from 0.95 opacity to 0 across its lifetime, and renders with depth test and
depth write off at `renderOrder` 7, so a tracer stays visible through geometry. The missile flickers
its flame at 60 rad/s and scales it with the flicker. Both are absolute samples: calling `step()` twice
with the same state is idempotent, and skipping a frame does not accumulate error.

## Ownership and disposal

The caller adds `group` to the scene and disposes its geometry and material at teardown, for example
with [Object3DUtils](../../assets/world/Object3DUtils.js). There is no `dispose()`, no pooling and no
lifetime tracking: when a projectile expires, the caller hides or removes the group. `step()` reuses
module-level scratch vectors rather than allocating, because it runs once per projectile per frame;
that makes it single-threaded and non-reentrant, which browser frame code already is.

## Copy dependencies and usage

```text
assets/world/object/factory/ProjectileVisualFactory.js
assets/math/ScalarUtils.js
```

Preserve these paths in the generated project and use its local Three.js 0.161.0 dependency.

```js
import { createMissileProjectileVisual }
  from '/assets/world/object/factory/ProjectileVisualFactory.js';

const visual = createMissileProjectileVisual();
scene.add(visual.group);
// After the caller advances actual flight:
visual.step({ position: shot.position, direction: shot.direction, ageSeconds: shot.age });
// On expiry: remove or hide visual.group and release its resources.
```

See [World visuals](../../assets/catalogs/world-visuals.md) and the
[asset factory contract](asset-factory-contract.md).
