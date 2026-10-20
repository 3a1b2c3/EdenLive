# Greybox kit factory

[Source](../../assets/world/object/factory/GreyboxKitFactory.js) supplies art-free building blocks for
an early prototype: lighting, a ground grid, lane stripes, a capsule avatar and flat ground markers.
It does not implement the [scene-visual profile](asset-factory-contract.md#scene-visual-interface-profile):
there are no presets, no normalized `params`, no `bounds`, no `getStats()` and no `dispose()`. Each
export returns a plain Three.js object the caller owns.

The point of a greybox is legibility, not looks: a capsule that shows which way it faces, a marker
that reads against the floor, a grid that makes speed visible. Reach for a
[parameterized visual factory](../../assets/catalogs/world-visuals.md) when a themed actor or prop is
what the brief asks for; use this kit for abstract shapes, small missing parts and any 3D structure
the visual factories do not cover, so a street, lamp or gate can be boxes and cylinders rather than
an imported model. No placeholder version of every actor has to be built first.

Every placement goes through the shared [WorldBasis](../../assets/math/WorldBasis.js). These builders
are pure Three.js: no DOM, no input, no per-frame state. The DOM half of a prototype shell lives in
[PrototypeShell.js](../../assets/user-interface/PrototypeShell.js).

## Exports

```js
addKeyLight(scene, options)      // DirectionalLight (also adds an AmbientLight)
addGroundGrid(scene, options)    // GridHelper
createLaneStripes(options)       // LineSegments
createCapsuleActor(options)      // { group, body, nose, setHeight, baseHeight }
createMarkerBox(options)         // THREE.Mesh
createMarkerSphere(options)      // THREE.Mesh
createGroundRing(options)        // THREE.Mesh
createGroundLine(options)        // THREE.Mesh
createGroundMarker(options)      // THREE.Group (disc + ring)
```

`addKeyLight` and `addGroundGrid` add to the scene they are given; the other builders return an object
for the caller to place and add.

## Parameters

| Export | Options | Notes |
| --- | --- | --- |
| `addKeyLight` | `intensity` 0.85, `ambient` 0.55, `color`, `ambientColor`, `position` `{right: 18, up: 26, forward: 14}`, `extent` 60, `shadowFar` null, `shadows` true | `color`/`position` let lighting follow the scene prose. The shadow frustum uses `extent`; `far` defaults to `max(140, extent * 2.5)` so a space larger than 60 units is not clipped. For sky color and fog, prefer [SceneAtmosphere](../../assets/world/environment/SceneAtmosphere.js) |
| `addGroundGrid` | `size` 120, `divisions` 60, `up` 0 | Translucent, no depth write, lifted 0.01 above `up` |
| `createLaneStripes` | `laneCount` 3, `laneWidth` 2.4, `length` 300, `behind` 20, `up` 0.02 | Stripes run ahead of the origin at positive forward values, with a short tail behind the spawn |
| `createCapsuleActor` | `height` 1.7, `radius` 0.42, `color` | `setHeight(current)` scales and re-seats the body so its feet stay on the ground, no geometry rebuild. `nose` shows facing, which is otherwise invisible on a capsule |
| `createMarkerBox` | `width`/`height`/`depth` 1, `color`, `opacity` 1, `emissive` false, `emissiveIntensity` 0.35 | Pass `emissive: true` for anything the prose calls glowing |
| `createMarkerSphere` | `radius` 0.5, `color`, `emissive` true | Casts shadows |
| `createGroundRing` | `radius` 1, `thickness` 0.12, `color`, `opacity` 0.75 | A flat outline: kickoff circle, capture zone, telegraph |
| `createGroundLine` | `from`/`to` as `{right, forward}`, `width` 0.12, `up` 0.02, `color`, `opacity` 0.75 | A midline, start line or boundary meant to read but not collide |
| `createGroundMarker` | `radius` 1, `color`, `opacity` 0.35 | Filled disc plus ring, for goals, pads and aim indicators |

Flat ground pieces are oriented by the basis plane quaternion, use `renderOrder` 1..2 and skip depth
writes, so they layer over the ground without z-fighting.

## Ownership and disposal

Nothing here tracks or frees resources. The caller adds the returned objects, positions them, and
disposes their geometry and material at teardown — for example with
[Object3DUtils](../../assets/world/Object3DUtils.js). `setHeight` only changes the visual pose; the
collision capsule, movement and ducking rules stay in game code. None of these builders supply
collision or hit volumes.

## Copy dependencies and usage

```text
assets/world/object/factory/GreyboxKitFactory.js
assets/math/WorldBasis.js
```

Preserve these paths in the generated project and use its local Three.js 0.161.0 dependency.

```js
import { addKeyLight, addGroundGrid, createCapsuleActor, createGroundRing }
  from '/assets/world/object/factory/GreyboxKitFactory.js';

addKeyLight(scene, { color: 0xbfd4ff, position: { right: -30, up: 40, forward: 10 }, extent: 120 });
addGroundGrid(scene, { size: 200, divisions: 80 });
const actor = createCapsuleActor({ height: 1.8 });
scene.add(actor.group, createGroundRing({ radius: 3 }));
// While ducking, after the caller updates real movement:
actor.setHeight(duckHeight);
actor.group.position.copy(playerPosition);
```

See [World foundations](../../assets/catalogs/world.md) and the
[asset factory contract](asset-factory-contract.md).
