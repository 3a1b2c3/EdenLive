// Headless behaviour tests for assets/gameplay/GridBlastModel.js.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GridBlastModel, GRID_CELLS } from '../../../assets/gameplay/GridBlastModel.js';

test('blast covers the origin plus each arm up to range, stopped by a wall', () => {
  const grid = new GridBlastModel({ columns: 7, rows: 7 });
  // +forward arm is capped by a wall 2 cells away.
  grid.set({ right: 3, forward: 5 }, GRID_CELLS.WALL);

  const covered = grid.blastCells({ right: 3, forward: 3 }, 3);
  assert.deepEqual(covered[0], { right: 3, forward: 3 }, 'origin first');

  // +forward arm: (3,4), (3,5 wall, included) and stops -- (3,6) must be absent.
  const keys = covered.map((c) => `${c.right},${c.forward}`);
  assert.ok(keys.includes('3,4'));
  assert.ok(keys.includes('3,5'), 'the wall cell itself is covered');
  assert.ok(!keys.includes('3,6'), 'nothing past the wall');
});

test('blast passes through and breaks destructible blocks', () => {
  const grid = new GridBlastModel({ columns: 5, rows: 5 });
  grid.set({ right: 1, forward: 1 }, GRID_CELLS.BLOCK);
  grid.set({ right: 2, forward: 1 }, GRID_CELLS.BLOCK);

  const { covered, broken } = grid.applyBlast({ right: 0, forward: 1 }, 3);

  assert.ok(covered.some((c) => c.right === 2 && c.forward === 1), 'range reaches past the first block');
  assert.deepEqual(broken, [{ right: 1, forward: 1 }, { right: 2, forward: 1 }]);
  assert.equal(grid.get({ right: 1, forward: 1 }), GRID_CELLS.OPEN, 'first block is now open');
});

test('blast stops at the grid edge and is deterministic', () => {
  const grid = new GridBlastModel({ columns: 3, rows: 3 });
  const a = grid.blastCells({ right: 1, forward: 1 }, 5);
  const b = grid.blastCells({ right: 1, forward: 1 }, 5);
  // A CROSS blast from the centre of a 3x3 covers the origin + the four cardinal
  // neighbours only -- the corners are diagonal and never reached.
  assert.deepEqual(a, [{ right: 1, forward: 1 },
    { right: 1, forward: 2 }, { right: 2, forward: 1 },
    { right: 1, forward: 0 }, { right: 0, forward: 1 }]);
  assert.equal(a.length, 5);
  assert.deepEqual(a, b, 'order is deterministic');
});

test('rejects a non-positive grid size', () => {
  assert.throws(() => new GridBlastModel({ columns: 0, rows: 3 }), /positive integers/);
});