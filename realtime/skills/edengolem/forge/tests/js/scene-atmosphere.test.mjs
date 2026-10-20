// Headless tests for assets/world/environment/SceneAtmosphere.js.
//
// The load-bearing property is that fog far is a LEGIBILITY BUDGET, not a look: two earlier
// prototypes shipped a goal behind the fog plane (a boss at forward 7200 with fog at 7000, and a
// 180 m climb with fog at 85). Both screenshot fine and cannot be finished, so fogFarForGoal
// keeping the goal strictly inside the fog is the test worth keeping.
//
// The other one is the axis-sign trap: a key light positioned by hand-written signs can end up
// behind the play space, lighting nothing the camera sees.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Scene, Fog, FogExp2 } from 'three';

import {
  applyAtmosphere,
  fogFarForGoal,
  lightPositionFromAngles,
} from '../../../assets/world/environment/SceneAtmosphere.js';
import { DEFAULT_WORLD_BASIS as BASIS } from '../../../assets/math/WorldBasis.js';

test('fog far keeps the goal strictly inside the legible band', () => {
  // Linear fog reaches full opacity AT `far`, so a goal sitting exactly there is invisible.
  for (const goal of [26, 131, 180, 7200]) {
    const far = fogFarForGoal(goal);
    assert.ok(far > goal, `goal ${goal} must be inside fog far ${far}`);
  }
});

test('the two real prototype failures would be caught', () => {
  // flight-combat: boss at 7200, fog authored at 7000.
  assert.ok(fogFarForGoal(7200) > 7000);
  // a 180 m climb with fog authored at 85.
  assert.ok(fogFarForGoal(180) > 85);
});

test('fogFarForGoal clamps a degenerate margin rather than hiding the goal', () => {
  // margin 1.0 would put the goal exactly on the fog plane; the floor keeps it visible.
  assert.ok(fogFarForGoal(100, 1.0) > 100);
  assert.equal(fogFarForGoal(0), 0);
  assert.equal(fogFarForGoal(-5), 0);
});

test('an overhead light is above the space, and a horizon light is not', () => {
  const overhead = lightPositionFromAngles({ elevationDeg: 90, distance: 60 });
  const up = BASIS.toBasisComponents(overhead);
  assert.ok(Math.abs(up.up - 60) < 1e-6, 'elevation 90 puts the key directly overhead');

  const low = lightPositionFromAngles({ elevationDeg: 5, distance: 60 });
  const lowComponents = BASIS.toBasisComponents(low);
  assert.ok(lowComponents.up > 0, 'a low sun is still above the horizon');
  assert.ok(lowComponents.up < 10, 'a low sun grazes rather than beams down');
});

test('azimuth 0 puts the key ahead, 90 to the right (the axis-sign trap)', () => {
  const ahead = BASIS.toBasisComponents(
    lightPositionFromAngles({ elevationDeg: 0, azimuthDeg: 0, distance: 10 })
  );
  assert.ok(ahead.forward > 9.9, 'azimuth 0 is basis-forward, not behind the scene');
  assert.ok(Math.abs(ahead.right) < 1e-6);

  const right = BASIS.toBasisComponents(
    lightPositionFromAngles({ elevationDeg: 0, azimuthDeg: 90, distance: 10 })
  );
  assert.ok(right.right > 9.9, 'azimuth 90 is basis-right');
  assert.ok(Math.abs(right.forward) < 1e-6);
});

test('applyAtmosphere sets background, fog and both lights', () => {
  const scene = new Scene();
  const { sun, ambient, fog } = applyAtmosphere(scene, {
    skyColor: 0x89b7e0,
    fogFar: 240,
    keyElevationDeg: 20,
  });

  assert.ok(scene.background, 'background is set');
  assert.ok(fog instanceof Fog, 'linear fog when fogFar is given');
  assert.equal(scene.fog, fog);
  assert.ok(sun, 'a key light exists');
  assert.ok(ambient, 'an ambient fill exists');
  assert.ok(scene.children.includes(sun));
  assert.ok(scene.children.includes(ambient));
});

test('fog colour defaults to the sky so the horizon has no seam', () => {
  const scene = new Scene();
  const { fog } = applyAtmosphere(scene, { skyColor: 0x123456, fogFar: 100 });
  assert.equal(fog.color.getHex(), 0x123456);
});

test('no fogFar means no fog, which is a choice rather than an omission', () => {
  const scene = new Scene();
  const { fog } = applyAtmosphere(scene, { skyColor: 0x000000 });
  assert.equal(fog, null);
  assert.equal(scene.fog, null);
});

test('fogDensity selects exponential fog', () => {
  const scene = new Scene();
  const { fog } = applyAtmosphere(scene, { fogDensity: 0.02 });
  assert.ok(fog instanceof FogExp2);
});

test('the shadow frustum covers the fog distance, not a fixed 60 units', () => {
  // The greybox kit's hardcoded extent of 60 drops most of a large space out of shadow.
  const scene = new Scene();
  const { sun } = applyAtmosphere(scene, { fogFar: 400, keyDistance: 120 });
  assert.ok(sun.shadow.camera.right >= 300, 'extent scales with the visible space');

  const small = applyAtmosphere(new Scene(), { fogFar: 20, keyDistance: 30 });
  assert.ok(small.sun.shadow.camera.right >= 30, 'a small space still gets a usable minimum');
});

test('an explicit shadowExtent wins over the derived one', () => {
  const { sun } = applyAtmosphere(new Scene(), { fogFar: 400, shadowExtent: 42 });
  assert.equal(sun.shadow.camera.right, 42);
});

test('shadows can be turned off without losing the light', () => {
  const { sun } = applyAtmosphere(new Scene(), { shadows: false });
  assert.equal(sun.castShadow, false);
});

test('dispose removes what it added', () => {
  const scene = new Scene();
  const atmosphere = applyAtmosphere(scene, { fogFar: 100 });
  atmosphere.dispose();
  assert.equal(scene.fog, null);
  assert.ok(!scene.children.includes(atmosphere.sun));
  assert.ok(!scene.children.includes(atmosphere.ambient));
});

test('a scene is required rather than silently skipped', () => {
  assert.throws(() => applyAtmosphere(null, {}), /needs a scene/);
});
