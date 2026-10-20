// Headless tests for assets/world/environment/BoxObstacleField.js.
//
// The load-bearing property, and the bug that motivated the module: a box top above
// the character's feet must BLOCK horizontal motion, not merely be skipped by the
// support query. Top-face-only collision passes an "I can stand on it" test while
// letting the character walk through the side, so the walk-through cases below are
// the ones worth keeping.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';

import {
  BoxObstacleField,
  findCoplanarTops,
} from '../../../assets/world/environment/BoxObstacleField.js';
import { DEFAULT_WORLD_BASIS as BASIS } from '../../../assets/math/WorldBasis.js';

const RADIUS = 0.42;
const HEIGHT = 1.7;

/** A 2x2 box from bottomUp to topUp, centred on the given planar spot. */
function box({ right = 0, forward = 0, width = 2, depth = 2, bottomUp = 0, topUp = 1 } = {}) {
  return { right, forward, width, depth, bottomUp, topUp };
}

function at(right, up, forward) {
  return BASIS.fromBasisComponents(right, up, forward, new Vector3());
}

function planar(position) {
  const c = BASIS.toBasisComponents(position);
  return { right: +c.right.toFixed(4), forward: +c.forward.toFixed(4), up: +c.up.toFixed(4) };
}

test('a box top above the feet blocks horizontal motion (the walk-through bug)', () => {
  // A 1m-tall box while the character stands on the floor: too tall to step onto,
  // so it is a wall this frame and must stop the move.
  const field = new BoxObstacleField({ boxes: [box({ topUp: 1 })], stepTolerance: 0.12 });

  // Walked from outside straight into the middle of the box.
  const position = at(0, 0, 0);
  const result = field.resolve(position, { radius: RADIUS, height: HEIGHT, referenceUp: 0 });

  assert.equal(result.blocked, true, 'entering a tall box must report blocked');
  // Pushed back out along the shallowest axis, to the face plus the capsule radius.
  const after = planar(position);
  const distance = Math.max(Math.abs(after.right), Math.abs(after.forward));
  assert.ok(
    distance >= 1 + RADIUS - 1e-6,
    `expected to be pushed clear of the face, got ${distance}`
  );
});

test('the same box is a floor when approached from above', () => {
  // Identical box, but the character's feet start level with its top: now it is a
  // step, not a wall. This is the pair that proves floor-vs-wall is a relationship
  // rather than a flag on the box.
  const field = new BoxObstacleField({ boxes: [box({ topUp: 1 })], stepTolerance: 0.12 });

  const support = field.supportHeightAt(at(0, 1, 0), 1);
  assert.equal(support, 1, 'a top at the feet is standable');

  const position = at(0, 1, 0);
  const result = field.resolve(position, { radius: RADIUS, height: HEIGHT, referenceUp: 1 });
  assert.equal(result.blocked, false, 'standing on a box must not push the character off it');
  assert.deepEqual(planar(position), { right: 0, forward: 0, up: 1 });
});

test('a top above the feet is excluded from support (never snapped up through)', () => {
  const field = new BoxObstacleField({ boxes: [box({ topUp: 1 })], stepTolerance: 0.12 });
  // Feet on the floor, box top 1m up: not a surface this frame.
  assert.equal(field.supportHeightAt(at(0, 0, 0), 0), -Infinity);
});

test('stepTolerance decides step vs wall', () => {
  const small = box({ topUp: 0.2 });
  const stepUp = new BoxObstacleField({ boxes: [small], stepTolerance: 0.25 });
  const wall = new BoxObstacleField({ boxes: [small], stepTolerance: 0.1 });

  assert.equal(stepUp.supportHeightAt(at(0, 0, 0), 0), 0.2, 'inside tolerance: a step');
  assert.equal(wall.supportHeightAt(at(0, 0, 0), 0), -Infinity, 'outside tolerance: a wall');

  const blockedPosition = at(0, 0, 0);
  wall.resolve(blockedPosition, { radius: RADIUS, height: HEIGHT, referenceUp: 0 });
  assert.notDeepEqual(
    planar(blockedPosition),
    { right: 0, forward: 0, up: 0 },
    'a wall must push out even when it is short'
  );
});

test('a hopped box does not shove the character mid-air', () => {
  const field = new BoxObstacleField({ boxes: [box({ topUp: 1 })], stepTolerance: 0.12 });
  // Feet above the top: cleared it.
  const position = at(0, 1.4, 0);
  const result = field.resolve(position, { radius: RADIUS, height: HEIGHT, referenceUp: 1.4 });
  assert.equal(result.blocked, false);
  assert.deepEqual(planar(position), { right: 0, forward: 0, up: 1.4 });
});

test('supportHeightAt returns the TALLEST standable top under the point', () => {
  const field = new BoxObstacleField({
    boxes: [box({ topUp: 0.5 }), box({ topUp: 0.9 }), box({ topUp: 3 })],
    stepTolerance: 0.12,
  });
  // Feet at 1: the 3m top is a wall, the other two are floors.
  assert.equal(field.supportHeightAt(at(0, 1, 0), 1), 0.9);
});

test('a fast move is swept, not tunnelled through', () => {
  // A thin box and a step far larger than it: the discrete push-out alone cannot
  // catch this, because the move starts and ends outside the box.
  const thin = box({ depth: 0.4, topUp: 1 });
  const field = new BoxObstacleField({ boxes: [thin], stepTolerance: 0.12 });

  const from = at(0, 0, -5);
  const position = at(0, 0, 5);

  // Without the previous position: clips clean through, which is what maxSafeStep
  // warns about.
  const naive = at(0, 0, 5);
  const naiveResult = field.resolve(naive, { radius: RADIUS, height: HEIGHT, referenceUp: 0 });
  assert.equal(naiveResult.blocked, false, 'discrete resolution cannot catch a 10m step');
  assert.equal(planar(naive).forward, 5, 'and so the character ends up past the box');

  // With it: stopped on the near face.
  const result = field.resolve(position, {
    radius: RADIUS,
    height: HEIGHT,
    referenceUp: 0,
    previousPosition: from,
  });
  assert.equal(result.blocked, true, 'a swept move into a box must be blocked');
  const after = planar(position);
  assert.ok(after.forward < 0, `expected to stop before the box, got forward ${after.forward}`);
  assert.ok(
    after.forward <= -(thin.depth * 0.5) - RADIUS + 1e-3,
    `expected to stop outside the near face, got ${after.forward}`
  );
});

test('maxSafeStep reports half the thinnest box', () => {
  const field = new BoxObstacleField({
    boxes: [box({ width: 4, depth: 4 }), box({ width: 0.6, depth: 3 })],
    stepTolerance: 0.12,
  });
  assert.equal(field.maxSafeStep(), 0.3);
  assert.equal(new BoxObstacleField({ boxes: [] }).maxSafeStep(), Infinity);
});

test('an empty field supports nothing rather than inventing a floor', () => {
  // -Infinity, not 0: a caller over a void must keep falling, so that a fall meant
  // to be fatal cannot quietly become a survivable landing.
  assert.equal(new BoxObstacleField({ boxes: [] }).supportHeightAt(at(0, 5, 0), 5), -Infinity);
});

test('findCoplanarTops catches a box top flush with the ground plane', () => {
  // The z-fighting flicker: a layout authored against ground 0 and re-seated onto a
  // raised floor without re-seating what stands on it.
  const groundUp = 0.4943;
  const flush = box({ topUp: groundUp });
  const clear = box({ right: 20, topUp: groundUp + 0.25 });

  const pairs = findCoplanarTops([flush, clear], { groundUp });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].b, null, 'a ground-plane conflict reports b === null');
  assert.equal(pairs[0].height, groundUp);

  assert.equal(findCoplanarTops([clear], { groundUp }).length, 0, 'a raised top is fine');
});

test('findCoplanarTops only flags tops that actually overlap in plan', () => {
  const a = box({ right: 0, topUp: 1 });
  const b = box({ right: 1, topUp: 1 });   // overlapping footprints, equal tops
  const far = box({ right: 50, topUp: 1 }); // equal top, nowhere near

  const pairs = findCoplanarTops([a, b, far]);
  assert.equal(pairs.length, 1, 'only the overlapping pair z-fights');
  assert.equal(pairs[0].height, 1);
});

test('a degenerate box is rejected rather than silently uncollidable', () => {
  // A zero-height box draws nothing and collides with nothing, so it is always an
  // authoring mistake -- fail loud instead of quietly doing nothing.
  assert.throws(
    () => new BoxObstacleField({ boxes: [box({ bottomUp: 1, topUp: 1 })] }),
    /topUp .* > bottomUp/
  );
  assert.throws(
    () => new BoxObstacleField({ boxes: [box({ width: 0 })] }),
    /width and depth > 0/
  );
  assert.throws(
    () => new BoxObstacleField({ boxes: [{ right: 0, forward: 0, width: 1, depth: 1 }] }),
    /finite topUp/
  );
});
