// Headless behaviour tests for assets/actor-motion/GridTokenMotionController.js.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GridTokenMotionController } from '../../../assets/actor-motion/GridTokenMotionController.js';

function settled(controller) {
  return controller.step(1.0, { right: 0, forward: 0 });
}

test('moves one cell in the held direction and reports the commit', () => {
  const token = new GridTokenMotionController({ startCell: { right: 0, forward: 0 } });
  const out = token.step(1.0, { right: 1, forward: 0 });
  assert.equal(out.moved, true);
  assert.deepEqual(out.cell, { right: 1, forward: 0 });
});

test('allows the 180-degree reverse a snake refuses', () => {
  const token = new GridTokenMotionController({ startCell: { right: 1, forward: 1 } });
  token.step(1.0, { right: 1, forward: 0 }); // now at (2,1)
  const out = token.step(1.0, { right: -1, forward: 0 }); // reverse back
  assert.equal(out.moved, true);
  assert.deepEqual(out.cell, { right: 1, forward: 1 });
});

test('a zero direction is a lawful stay', () => {
  const token = new GridTokenMotionController({ startCell: { right: 0, forward: 0 } });
  const out = token.step(1.0, { right: 0, forward: 0 });
  assert.equal(out.moved, false);
  assert.deepEqual(out.cell, { right: 0, forward: 0 });
});

test('refuses a blocked cell and never occupies it', () => {
  const token = new GridTokenMotionController({
    startCell: { right: 0, forward: 0 },
    canStand: (cell) => cell.right < 1,
  });
  const out = token.step(1.0, { right: 1, forward: 0 });
  assert.equal(out.moved, false);
  assert.deepEqual(out.cell, { right: 0, forward: 0 });
  assert.deepEqual(out.blocked, { right: 1, forward: 0 });
  assert.equal(out.refusalReason, 'blocked');
});

test('buffers a direction pressed mid-move and honours it on the next boundary', () => {
  const token = new GridTokenMotionController({ startCell: { right: 0, forward: 0 }, moveSeconds: 0.18 });
  token.step(1.0, { right: 1, forward: 0 }); // commit -> (1,0), progress 0
  const mid = token.step(0.09, { forward: 1 }); // still moving; queue up
  assert.equal(mid.moved, false);
  const out = token.step(0.1, {}); // cross the boundary; queued direction fires
  assert.equal(out.moved, true);
  assert.deepEqual(out.cell, { right: 1, forward: 1 });
});

test('position() lerps from the origin cell to the destination cell', () => {
  const token = new GridTokenMotionController({ startCell: { right: 0, forward: 0 }, moveSeconds: 1 });
  token.step(2.0, { right: 1, forward: 0 }); // commit -> (1,0), progress 0
  const mid = token.step(0.5, {});
  const p = mid.position;
  assert.equal(p.right, 0.5);
  assert.equal(p.forward, 0);
});