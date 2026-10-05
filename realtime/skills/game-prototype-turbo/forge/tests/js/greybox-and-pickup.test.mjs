// Headless tests for the greybox kit's stage-3 additions and PickupObject's collection.
//
// The pickup half is the load-bearing one: assets/summary.md has claimed the module does
// "collection checks" since it was written, and there was no such method -- every caller
// distance-tested `.radius` by hand and each got to invent whether collection was planar or
// spherical and whether it could fire twice. The bob makes that not a style question: a
// spherical test collects or misses the same walk-through depending on the frame it lands on.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Group, Scene } from 'three';

import {
  addKeyLight,
  createGroundLine,
  createGroundRing,
  createMarkerBox,
} from '../../../assets/world/object/factory/GreyboxKitFactory.js';
import { PickupObject } from '../../../assets/world/object/PickupObject.js';
import { DEFAULT_WORLD_BASIS as BASIS } from '../../../assets/math/WorldBasis.js';

// --- key light knobs ---------------------------------------------------------------------

test('addKeyLight defaults are unchanged, so existing calls are untouched', () => {
  const key = addKeyLight(new Scene());
  assert.equal(key.intensity, 0.85);
  assert.equal(key.color.getHex(), 0xffffff);
  assert.ok(key.position.distanceTo(BASIS.fromBasisComponents(18, 26, 14)) < 1e-6);
  assert.equal(key.shadow.camera.right, 60);
});

test('colour and direction are knobs, because stage 3 reads them from prose', () => {
  const key = addKeyLight(new Scene(), {
    color: 0x9fc6ff,
    position: { right: 0, up: 120, forward: -40 },
  });
  assert.equal(key.color.getHex(), 0x9fc6ff);
  assert.ok(key.position.distanceTo(BASIS.fromBasisComponents(0, 120, -40)) < 1e-6);
});

test('the shadow far plane grows with the extent rather than clipping at 140', () => {
  // An 84 m arena or a 9 km terrain drops most of itself out of a fixed frustum.
  const big = addKeyLight(new Scene(), { extent: 400 });
  assert.equal(big.shadow.camera.right, 400);
  assert.ok(big.shadow.camera.far >= 1000, 'far scales with extent');

  const small = addKeyLight(new Scene(), { extent: 20 });
  assert.equal(small.shadow.camera.far, 140, 'a small space keeps the original default');
});

test('shadows can be switched off', () => {
  const key = addKeyLight(new Scene(), { shadows: false });
  assert.equal(key.castShadow, false);
});

// --- marker additions -------------------------------------------------------------------

test('a marker box can glow, which only the sphere could before', () => {
  const plain = createMarkerBox({ color: 0x76f0c9 });
  assert.equal(plain.material.emissive.getHex(), 0x000000);

  const glowing = createMarkerBox({ color: 0x76f0c9, emissive: true });
  assert.ok(glowing.material.emissive.getHex() > 0, 'an emissive box actually emits');
});

test('a ground ring is an outline, not a disc', () => {
  const ring = createGroundRing({ radius: 5, thickness: 0.5 });
  assert.equal(ring.geometry.type, 'RingGeometry');
  assert.equal(ring.geometry.parameters.outerRadius, 5);
  assert.equal(ring.geometry.parameters.innerRadius, 4.5);
});

test('a ring thicker than its radius does not invert', () => {
  const ring = createGroundRing({ radius: 1, thickness: 5 });
  assert.ok(ring.geometry.parameters.innerRadius > 0);
  assert.ok(ring.geometry.parameters.innerRadius < ring.geometry.parameters.outerRadius);
});

test('a ground line spans its endpoints and is centred between them', () => {
  const line = createGroundLine({
    from: { right: -30, forward: 0 },
    to: { right: 30, forward: 0 },
    width: 0.2,
  });
  assert.ok(Math.abs(line.geometry.parameters.depth - 60) < 1e-6, 'length is the span');
  const centre = BASIS.toBasisComponents(line.position);
  assert.ok(Math.abs(centre.right) < 1e-6);
  assert.ok(Math.abs(centre.forward) < 1e-6);
});

test('a degenerate line does not produce negative geometry', () => {
  const line = createGroundLine({ from: { right: 4, forward: 4 }, to: { right: 4, forward: 4 } });
  assert.ok(line.geometry.parameters.depth > 0);
});

// --- pickup collection ------------------------------------------------------------------

function pickup({ right = 0, forward = 0, radius = 1.1 } = {}) {
  // Collection-only fixture implements the factory lifecycle; geometry is tested separately.
  return new PickupObject({
    id: 'gem',
    pickupVisual: { group: new Group(), pickupVolume: { radius }, setPose() {}, reset() {}, dispose() {} },
    position: BASIS.fromBasisComponents(right, 0, forward),
  });
}

test('a collector in reach collects, and out of reach does not', () => {
  const gem = pickup({ radius: 1.1 });
  assert.equal(gem.tryCollect(BASIS.fromBasisComponents(5, 0, 0)), false);
  assert.equal(gem.tryCollect(BASIS.fromBasisComponents(0.5, 0, 0)), true);
});

test('collection fires exactly once', () => {
  // Two colliders overlapping one pickup on the same frame is otherwise a doubled reward.
  const gem = pickup();
  const at = BASIS.fromBasisComponents(0, 0, 0);
  assert.equal(gem.tryCollect(at), true);
  assert.equal(gem.tryCollect(at), false);
  assert.equal(gem.collected, true);
  assert.equal(gem.group.visible, false);
});

test('the collector radius widens the reach', () => {
  const gem = pickup({ radius: 0.4 });
  const standingOff = BASIS.fromBasisComponents(0.8, 0, 0);
  assert.equal(gem.isWithinReach(standingOff), false);
  assert.equal(gem.isWithinReach(standingOff, 0.42), true);
});

test('collection is planar, so the bob cannot change the verdict', () => {
  // The real bug this prevents: a spherical test makes the same walk-through collect or miss
  // depending on which frame of the bob it lands on.
  const gem = pickup();
  const feet = BASIS.fromBasisComponents(0.3, 0, 0);
  const before = gem.isWithinReach(feet);
  for (let i = 0; i < 40; i += 1) gem.animate(1 / 60);
  assert.equal(gem.isWithinReach(feet), before, 'the verdict is bob-invariant');
});

test('a collector far below still collects, because the test ignores height', () => {
  const gem = pickup();
  assert.equal(gem.tryCollect(BASIS.fromBasisComponents(0, -50, 0)), true);
});

test('reset puts an uncollected pickup back into play', () => {
  const gem = pickup();
  gem.tryCollect(BASIS.fromBasisComponents(0, 0, 0));
  gem.reset();
  assert.equal(gem.collected, false);
  assert.equal(gem.group.visible, true);
  assert.equal(gem.tryCollect(BASIS.fromBasisComponents(0, 0, 0)), true);
});

test('reset restores the resting height after a bob', () => {
  const gem = pickup();
  for (let i = 0; i < 17; i += 1) gem.animate(1 / 60);
  gem.reset();
  assert.ok(Math.abs(BASIS.upComponent(gem.position)) < 1e-9);
});
