// Headless tests for assets/world/environment/ArenaEnvironment.js.
//
// Three defects motivated these, each found by a stage-3 probe on a different genre:
//
// 1. create() built eight pillars and three ramps unconditionally, and the default layout places
//    them at FRACTIONS of worldSize -- so a small arena collapses all eight onto the spawn, and a
//    scene whose prose says "never blocking movement" could not use the module at all.
// 2. worldSize was a single scalar, so a 60x88 pitch was inexpressible.
// 3. The perimeter was four solid slabs with no way to cut an exit, so "a sealed gate marks the
//    exit" had nowhere to go.
//
// The suppression tests matter most: a pillar that is not drawn but still blocks spawn sampling
// is a disagreement between what renders and what the checker sees.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Scene } from 'three';

import {
  ArenaEnvironment,
  defaultWallLayout,
} from '../../../assets/world/environment/ArenaEnvironment.js';
import { DEFAULT_WORLD_BASIS as BASIS } from '../../../assets/math/WorldBasis.js';

function arena(options = {}) {
  return new ArenaEnvironment({ scene: new Scene(), ...options });
}

test('a square arena keeps its one-knob call', () => {
  const env = arena({ worldSize: 50 });
  assert.equal(env.worldSize, 50);
  assert.equal(env.worldSizeForward, 50);
  assert.equal(env.wallLayout.length, 4);
});

test('a rectangular arena bounds each axis independently', () => {
  // vehicle-soccer's 60x88 pitch, which a single scalar could not express.
  const env = arena({ worldSize: 60, worldSizeForward: 88 });
  assert.equal(env.bounds.maxRight, 60 * 0.5 - 1.2);
  assert.equal(env.bounds.maxForward, 88 * 0.5 - 1.2);
  assert.notEqual(env.bounds.maxRight, env.bounds.maxForward);
});

test('rectangular walls span the side they run along', () => {
  const walls = defaultWallLayout(60, 0, 3, 0.7, 88);
  assert.equal(walls.length, 4);
  const ends = walls.filter((wall) => Math.abs(wall.forward) > 1e-6);
  const sides = walls.filter((wall) => Math.abs(wall.right) > 1e-6);
  for (const wall of ends) {
    assert.equal(wall.spanRight, 60, 'an end wall spans the pitch width');
    assert.equal(Math.abs(wall.forward), 44, 'and sits at half the pitch length');
  }
  for (const wall of sides) {
    assert.equal(wall.spanForward, 88, 'a side wall spans the pitch length');
    assert.equal(Math.abs(wall.right), 30);
  }
});

test('cover is suppressible, and the suppressed layout is empty too', () => {
  // The load-bearing half: isPlanarPointBlockedByGeometry and the physics colliders both read
  // the layouts, so a suppressed pillar must not still block spawn sampling.
  const env = arena({ worldSize: 46, pillars: false, ramps: false });
  assert.deepEqual(env.pillarLayout, []);
  assert.deepEqual(env.rampLayout, []);
  assert.equal(env.isPlanarPointBlockedByGeometry(0, 0), false);
  assert.equal(env.isPlanarPointBlockedByGeometry(10, -8), false);
});

test('cover is still built by default, and blocks where it stands', () => {
  const env = arena({ worldSize: 46 });
  assert.equal(env.pillarLayout.length, 8);
  assert.equal(env.rampLayout.length, 3);
  // At a pillar's own position, not at the origin: the default ring sits at a fraction of
  // worldSize, so it never reaches the centre at any size.
  const pillar = env.pillarLayout[0];
  assert.equal(env.isPlanarPointBlockedByGeometry(pillar.right, pillar.forward), true);
});

test('create() honours the suppression flags', () => {
  const withCover = arena({ worldSize: 46 });
  withCover.create();
  const bare = arena({ worldSize: 46, pillars: false, ramps: false, grid: false });
  bare.create();
  assert.ok(
    bare.group.children.length < withCover.group.children.length,
    'a prop-free arena builds fewer objects'
  );
});

test('the grid flag survives create() rather than being overwritten by the mesh', () => {
  // this.grid is the caller's flag; storing the mesh there would make a second create() skip
  // the grid it had just built.
  const env = arena({ worldSize: 20 });
  env.create();
  assert.equal(env.grid, true);
  assert.ok(env.gridMesh, 'the mesh lands on its own field');
});

test('a wall opening splits one slab into two segments with a hole between', () => {
  // fps-arena: "a sealed iron gate marks the exit".
  const walls = defaultWallLayout(
    40, 0, 3, 0.7, 40,
    [{ side: 'forward', centre: 0, width: 8 }]
  );
  assert.equal(walls.length, 5, 'three intact walls plus two segments');

  const front = walls.filter((wall) => Math.abs(wall.forward - 20) < 1e-6);
  assert.equal(front.length, 2);
  const total = front.reduce((sum, wall) => sum + wall.spanRight, 0);
  assert.ok(Math.abs(total - 32) < 1e-6, 'the 8 m opening is missing from the 40 m span');

  // Nothing spans the gap itself.
  for (const wall of front) {
    const inner = Math.abs(wall.right) - wall.spanRight * 0.5;
    assert.ok(inner >= 4 - 1e-6, 'each segment stops at the edge of the opening');
  }
});

test('an off-centre opening puts the hole where it was asked for', () => {
  const walls = defaultWallLayout(40, 0, 3, 0.7, 40, [{ side: 'back', centre: 10, width: 4 }]);
  const back = walls.filter((wall) => Math.abs(wall.forward + 20) < 1e-6);
  assert.equal(back.length, 2);
  const spans = back.map((wall) => [wall.right - wall.spanRight * 0.5, wall.right + wall.spanRight * 0.5]);
  // The hole is 8..12; no segment may cover it.
  for (const [from, to] of spans) {
    assert.ok(to <= 8 + 1e-6 || from >= 12 - 1e-6, `segment ${from}..${to} must not cross the hole`);
  }
});

test('an opening wider than the wall leaves that side open rather than inverted', () => {
  const walls = defaultWallLayout(40, 0, 3, 0.7, 40, [{ side: 'left', centre: 0, width: 999 }]);
  const left = walls.filter((wall) => Math.abs(wall.right + 20) < 1e-6);
  assert.equal(left.length, 0, 'the side is fully open, and no negative-span box is emitted');
  for (const wall of walls) {
    assert.ok(wall.spanRight > 0 && wall.spanForward > 0, 'every emitted wall has a real size');
  }
});

test('a zero-width opening is ignored', () => {
  const walls = defaultWallLayout(40, 0, 3, 0.7, 40, [{ side: 'forward', centre: 0, width: 0 }]);
  assert.equal(walls.length, 4);
});

test('two openings in one wall leave three segments', () => {
  const walls = defaultWallLayout(
    60, 0, 3, 0.7, 60,
    [{ side: 'forward', centre: -15, width: 6 }, { side: 'forward', centre: 15, width: 6 }]
  );
  const front = walls.filter((wall) => Math.abs(wall.forward - 30) < 1e-6);
  assert.equal(front.length, 3);
});

test('transparent walls are opt-in', () => {
  const opaque = arena({ worldSize: 30 });
  opaque.create();
  const clear = arena({ worldSize: 30, wallOpacity: 0.25 });
  clear.create();
  const wallOf = (env) => env.group.children.find(
    (child) => child.material && child.material.transparent !== undefined
      && child.geometry?.type === 'BoxGeometry'
  );
  assert.equal(wallOf(opaque).material.transparent, false);
  assert.equal(wallOf(clear).material.transparent, true);
  assert.equal(wallOf(clear).material.opacity, 0.25);
});

test('every wall is placed through the basis', () => {
  // The axis-sign trap: a perimeter laid out with hand-written signs can end up behind the
  // camera, and the scene still renders.
  const env = arena({ worldSize: 20, worldSizeForward: 40 });
  env.create();
  for (const wall of env.wallLayout) {
    const expected = BASIS.fromBasisComponents(wall.right, wall.up, wall.forward);
    const match = env.group.children.some(
      (child) => child.position.distanceTo(expected) < 1e-6
    );
    assert.ok(match, `a mesh sits at the basis point for wall at forward ${wall.forward}`);
  }
});
