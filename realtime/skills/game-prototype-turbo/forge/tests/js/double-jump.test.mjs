// Headless behaviour tests for assets/game-feel/DoubleJump.js.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DoubleJump } from '../../../assets/game-feel/DoubleJump.js';

test('grants exactly one air jump by default', () => {
  const jump = new DoubleJump();
  assert.equal(jump.airJumpsLeft, 1);
  assert.equal(jump.consumeAirJump(), true);
  assert.equal(jump.consumeAirJump(), false, 'budget is spent');
  assert.equal(jump.airJumpsLeft, 0);
});

test('only a grounded frame re-arms the budget', () => {
  const jump = new DoubleJump();
  jump.consumeAirJump();
  jump.noteGrounded(false);
  assert.equal(jump.airJumpsLeft, 0, 'airborne frames do not reset');
  jump.noteGrounded(true);
  assert.equal(jump.airJumpsLeft, 1, 'landing re-arms');
});

test('honours a larger maxAirJumps', () => {
  const jump = new DoubleJump({ maxAirJumps: 2 });
  assert.equal(jump.consumeAirJump(), true);
  assert.equal(jump.consumeAirJump(), true);
  assert.equal(jump.consumeAirJump(), false);
});

test('rejects a negative budget', () => {
  assert.throws(() => new DoubleJump({ maxAirJumps: -1 }), /maxAirJumps/);
});