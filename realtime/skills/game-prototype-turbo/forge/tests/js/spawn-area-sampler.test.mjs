// Headless tests for assets/world/environment/SpawnAreaSampler.js.
//
// The load-bearing shape is `ring`, and the reason is a real spawn-clearance defect. Enemies sampled from
// a rect or a circle centred on the player land inside the one-second spawn clearance some
// fraction of the time: survivors samples uniform(-20, 20) on both axes at WALK_SPEED 6.5 and
// ENEMY_COUNT 10, so the clearance is 6.5 m and pi * 6.5^2 / 40^2 = 8.30% of the square lies inside
// it. That is 0.83 expected enemies per round -- and 1 - (1 - 0.083)^10 = 57.9% of ROUNDS with at
// least one. Nothing overlaps at frame 0, every coordinate is legal, and the round can still end
// before the player has oriented.
//
// A ring whose hole exceeds the clearance cannot produce that defect at all. Test `innerRadius`
// so callers can rely on guaranteed clearance instead of hand-rolling their own sampling.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SpawnAreaSampler,
  SPAWN_REGION_TYPES,
} from '../../../assets/world/environment/SpawnAreaSampler.js';
import { RandomGenerator } from '../../../assets/math/RandomUtils.js';

const BOUNDS = { rightMin: -25, rightMax: 25, forwardMin: -25, forwardMax: 25 };

/** A ring centred on the origin: the survivors case. */
function ring(innerRadius, outerRadius, center = { right: 0, forward: 0 }) {
  return { type: SPAWN_REGION_TYPES.RING, center, innerRadius, outerRadius };
}

function distance(point, center = { right: 0, forward: 0 }) {
  return Math.hypot(point.right - center.right, point.forward - center.forward);
}

// The sampler takes the project's PRNG object (it calls `prng.uniform(min, max)`), not a bare
// function. Seeded per test so a failure reproduces exactly rather than "sometimes".
function seeded(seed) {
  return new RandomGenerator(seed);
}

test('a ring accepts the band and rejects its own hole', () => {
  const sampler = new SpawnAreaSampler({ bounds: BOUNDS, spawnRegions: [ring(18, 24)] });

  assert.equal(sampler.allows({ right: 0, forward: 0 }), false, 'the centre is the hole');
  assert.equal(sampler.allows({ right: 17, forward: 0 }), false, 'inside the hole');
  assert.equal(sampler.allows({ right: 21, forward: 0 }), true, 'in the band');
  assert.equal(sampler.allows({ right: 0, forward: -21 }), true, 'the band is all bearings');
  assert.equal(sampler.allows({ right: 25, forward: 0 }), false, 'past the outer edge');
});

test('every sampled point lands in the band, over many draws', () => {
  // The defect this shape exists to prevent is statistical, so one sample proves nothing.
  const sampler = new SpawnAreaSampler({
    bounds: BOUNDS,
    spawnRegions: [ring(18, 24)],
    maxAttempts: 200,
  });
  const prng = seeded(20260908);

  let drawn = 0;
  for (let i = 0; i < 2000; i += 1) {
    const point = sampler.sample(prng);
    if (point === null) continue;
    drawn += 1;
    const d = distance(point);
    assert.ok(d >= 18 - 1e-9 && d <= 24 + 1e-9, `sample at ${d} is outside the 18..24 band`);
  }
  // Rejection sampling from the bounding box of an annulus keeps roughly (24^2-18^2)/50^2 = 10%
  // of draws per attempt, so 200 attempts per sample makes an empty result vanishingly unlikely.
  assert.ok(drawn > 1900, `only ${drawn} of 2000 draws produced a point`);
});

test("a ring's hole is what keeps runtime spawns off the player", () => {
  // The whole point, stated as the property the stage-3 gate checks: with the player at the
  // origin and a 6 m one-second clearance, NOTHING the sampler produces may land inside it.
  const clearance = 6;
  const sampler = new SpawnAreaSampler({
    bounds: BOUNDS,
    spawnRegions: [ring(18, 24)],
    maxAttempts: 200,
  });
  const prng = seeded(7);

  for (let i = 0; i < 2000; i += 1) {
    const point = sampler.sample(prng, 0.42);
    if (point === null) continue;
    assert.ok(
      distance(point) > clearance,
      `spawned ${distance(point)} from the player, inside the ${clearance} m clearance`,
    );
  }
});

test('a circle centred on the player does produce the defect', () => {
  // The companion: if this passed too, the ring would be buying nothing. A disc of the same outer
  // radius puts enemies on the player, which is exactly the shape the gate fails.
  const sampler = new SpawnAreaSampler({
    bounds: BOUNDS,
    spawnRegions: [{
      type: SPAWN_REGION_TYPES.CIRCLE, center: { right: 0, forward: 0 }, radius: 24,
    }],
    maxAttempts: 200,
  });
  const prng = seeded(7);

  let inside = 0;
  for (let i = 0; i < 2000; i += 1) {
    const point = sampler.sample(prng, 0.42);
    if (point !== null && distance(point) <= 6) inside += 1;
  }
  assert.ok(inside > 0, 'a disc on the player should sometimes spawn on the player');
});

test('a ring as a block region excludes the band, keeping the hole usable', () => {
  // Inverted use: "enemies anywhere in the arena EXCEPT this corridor annulus". The band is what
  // gets excluded, and the hole stays available -- the opposite of the spawn-region reading.
  const sampler = new SpawnAreaSampler({
    bounds: BOUNDS,
    blockRegions: [ring(10, 16)],
  });

  assert.equal(sampler.allows({ right: 0, forward: 0 }), true, 'the hole is not blocked');
  assert.equal(sampler.allows({ right: 13, forward: 0 }), false, 'the band is blocked');
  assert.equal(sampler.allows({ right: 20, forward: 0 }), true, 'outside the ring is free');
});

test('a body radius narrows the band from both edges', () => {
  // Negative padding on a spawn region: the actor has to FIT. A point 0.2 m inside the outer edge
  // does not fit a 1 m body, and neither does one 0.2 m outside the hole.
  const sampler = new SpawnAreaSampler({ bounds: BOUNDS, spawnRegions: [ring(18, 24)] });

  assert.equal(sampler.allows({ right: 23.9, forward: 0 }, 1), false, 'overhangs the outer edge');
  assert.equal(sampler.allows({ right: 18.1, forward: 0 }, 1), false, 'overhangs into the hole');
  assert.equal(sampler.allows({ right: 21, forward: 0 }, 1), true, 'fits mid-band');
});

test('an inverted ring encloses nothing rather than everything', () => {
  // innerRadius > outerRadius is an authoring error. It must reject, not silently invert into a
  // shape that accepts every point -- the stage-3 gate fails such a region for the same reason.
  const sampler = new SpawnAreaSampler({ bounds: BOUNDS, spawnRegions: [ring(20, 8)] });

  assert.equal(sampler.allows({ right: 0, forward: 0 }), false);
  assert.equal(sampler.allows({ right: 14, forward: 0 }), false);
  assert.equal(sampler.sample(seeded(1)), null, 'nothing can be sampled from an empty region');
});

test('the sample box comes from the outer radius, not the hole', () => {
  // boundsForRegions drives rejection sampling; if the ring reported no extent the sampler would
  // fall back to the whole arena and waste every attempt, or miss the band entirely.
  const sampler = new SpawnAreaSampler({
    bounds: BOUNDS,
    spawnRegions: [ring(18, 24, { right: 5, forward: -5 })],
  });

  assert.deepEqual(sampler.sampleBounds, {
    rightMin: -19, rightMax: 29, forwardMin: -29, forwardMax: 19,
  });
});
