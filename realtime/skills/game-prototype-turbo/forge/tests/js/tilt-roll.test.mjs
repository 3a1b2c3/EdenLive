// Headless behaviour tests for assets/actor-motion/TiltRollMotionController.js.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TiltRollMotionController } from '../../../assets/actor-motion/TiltRollMotionController.js';

test('a downhill slope accelerates and moves the ball', () => {
  const roll = new TiltRollMotionController({ acceleration: 12, friction: 0 });
  const out = roll.step(1.0, { right: 1, forward: 0 });
  assert.equal(out.velocity.right, 12);
  assert.equal(out.position.right, 12);
});

test('friction damps the velocity back to rest without reversing it', () => {
  const roll = new TiltRollMotionController({ acceleration: 0, friction: 3 });
  roll.velocity = { right: 9, forward: 0 };
  for (let i = 0; i < 30; i += 1) roll.step(1 / 60, { right: 0, forward: 0 });
  assert.ok(roll.velocity.right < 9, 'slowed by friction');
  assert.ok(roll.velocity.right >= 0, 'friction does not reverse the ball');
});

test('velocity is clamped to maxSpeed', () => {
  const roll = new TiltRollMotionController({ acceleration: 1000, friction: 0, maxSpeed: 24 });
  roll.step(0.1, { right: 1, forward: 1 });
  const mag = Math.hypot(roll.velocity.right, roll.velocity.forward);
  assert.ok(mag <= 24 + 1e-9, `capped at 24, got ${mag}`);
});

test('reset clears position and velocity', () => {
  const roll = new TiltRollMotionController({ acceleration: 12 });
  roll.step(1.0, { right: 1, forward: 1 });
  roll.reset({ right: 5, forward: 5 });
  assert.deepEqual(roll.velocity, { right: 0, forward: 0 });
  assert.deepEqual(roll.position, { right: 5, forward: 5 });
});