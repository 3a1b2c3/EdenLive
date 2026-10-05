// Headless tests for the core-mechanic primitives the sample briefs need:
// block stacking, melee with knockback, stealth detection, a kickable ball, and
// carry/station work.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';

import { BlockGridModel } from '../../../assets/gameplay/BlockGridModel.js';
import {
  FallingPieceController,
  PIECE_ACTIONS,
  TETROMINO_SHAPES,
} from '../../../assets/interaction/FallingPieceController.js';
import {
  MeleeAttackSystem,
  MELEE_PHASES,
  MELEE_SWING_RESULTS,
} from '../../../assets/gameplay/combat/MeleeAttackSystem.js';
import {
  KnockbackModel,
  RING_OUT_SIDES,
} from '../../../assets/gameplay/combat/KnockbackModel.js';
import {
  VisionConeDetector,
  ALERT_STATES,
} from '../../../assets/behavior/VisionConeDetector.js';
import {
  KickableBallModel,
  GOAL_SIDES,
} from '../../../assets/gameplay/KickableBallModel.js';
import {
  CarryStationController,
  CARRY_RESULTS,
  STATION_STATES,
} from '../../../assets/interaction/CarryStationController.js';
import { RandomGenerator } from '../../../assets/math/RandomUtils.js';

const FRAME = 1 / 60;

// --- BlockGridModel ---------------------------------------------------------

test('block grid clears a full row and drops the rows above it', () => {
  const grid = new BlockGridModel({ columns: 4, rows: 6 });
  for (let column = 0; column < 4; column += 1) grid.setCell(column, 0, 'a');
  grid.setCell(2, 1, 'marker');

  assert.deepEqual(grid.fullRows(), [0]);
  assert.deepEqual(grid.clearFullRows(), [0]);
  assert.equal(grid.clearedRowCount, 1);
  assert.equal(grid.isRowFull(0), false, 'the full row is gone');
  assert.equal(grid.valueAt(2, 0), 'marker', 'the row above dropped into the gap');
  assert.equal(grid.valueAt(2, 1), null);
});

test('block grid clears several rows at once without shifting indices wrongly', () => {
  // A four-row clear is where naive repeated splicing corrupts the board.
  const grid = new BlockGridModel({ columns: 3, rows: 8 });
  for (const row of [0, 1, 2, 3]) {
    for (let column = 0; column < 3; column += 1) grid.setCell(column, row, row);
  }
  grid.setCell(1, 4, 'survivor');

  assert.deepEqual(grid.clearFullRows(), [0, 1, 2, 3]);
  assert.equal(grid.clearedRowCount, 4);
  assert.equal(grid.valueAt(1, 0), 'survivor', 'the survivor fell all four rows');
  for (let row = 1; row < 8; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      assert.equal(grid.valueAt(column, row), null, `row ${row} must be empty`);
    }
  }
});

test('block grid clears non-adjacent rows correctly', () => {
  const grid = new BlockGridModel({ columns: 3, rows: 6 });
  for (let column = 0; column < 3; column += 1) {
    grid.setCell(column, 0, 'low');
    grid.setCell(column, 2, 'high');
  }
  grid.setCell(0, 1, 'between');
  grid.setCell(0, 3, 'top');

  assert.deepEqual(grid.clearFullRows(), [0, 2]);
  assert.equal(grid.valueAt(0, 0), 'between', 'the gap row fell by one');
  assert.equal(grid.valueAt(0, 1), 'top', 'the top row fell by two');
});

test('block grid reports top-out and column heights', () => {
  const grid = new BlockGridModel({ columns: 3, rows: 4, topOutRows: 1 });
  assert.equal(grid.isToppedOut(), false);
  grid.setCell(1, 3, 'x');
  assert.equal(grid.isToppedOut(), true, 'a cell in the top band is a top-out');

  grid.reset();
  assert.equal(grid.isToppedOut(), false);
  assert.equal(grid.columnHeight(0), 0);
  grid.setCell(0, 0, 'x');
  grid.setCell(0, 2, 'x');
  assert.equal(grid.columnHeight(0), 3, 'height is measured to the highest filled cell');
});

test('block grid treats out-of-board cells as blocked except above the ceiling', () => {
  const grid = new BlockGridModel({ columns: 3, rows: 4 });
  assert.equal(grid.isBlocked(-1, 0), true, 'left of the board');
  assert.equal(grid.isBlocked(3, 0), true, 'right of the board');
  assert.equal(grid.isBlocked(0, -1), true, 'below the floor');
  // Above the ceiling must be free, or a piece could never spawn or rotate there.
  assert.equal(grid.isBlocked(0, 99), false, 'above the board is not blocked');
});

test('block grid validates its dimensions', () => {
  assert.throws(() => new BlockGridModel({ columns: 0 }), /columns/);
  assert.throws(() => new BlockGridModel({ rows: 0 }), /rows/);
});

// --- FallingPieceController ------------------------------------------------

function pieceOnGrid(options = {}) {
  const grid = new BlockGridModel({ columns: 6, rows: 10 });
  const piece = new FallingPieceController({
    columns: 6,
    rows: 10,
    isBlocked: (column, row) => grid.isBlocked(column, row),
    prng: new RandomGenerator(7),
    ...options,
  });
  return { grid, piece };
}

test('falling piece shifts, rotates and reports blocked moves', () => {
  const { piece } = pieceOnGrid();
  assert.equal(piece.spawn('T').action, PIECE_ACTIONS.SPAWNED);

  assert.equal(piece.shift(-1).action, PIECE_ACTIONS.MOVED);
  assert.equal(piece.rotate(1).action, PIECE_ACTIONS.ROTATED);
  assert.equal(piece.shift(0).action, PIECE_ACTIONS.BLOCKED, 'a zero shift does nothing');

  // Walk into the left wall until it refuses.
  let guard = 0;
  while (piece.shift(-1).action === PIECE_ACTIONS.MOVED && guard < 20) guard += 1;
  assert.ok(guard < 20, 'shifting terminates at the wall');
  assert.equal(piece.shift(-1).action, PIECE_ACTIONS.BLOCKED);
});

test('falling piece wall-kicks a rotation that would clip the wall', () => {
  // An I piece flush against the left wall cannot rotate in place; without a
  // kick the rotation would silently fail and feel broken.
  const { piece } = pieceOnGrid();
  piece.spawn('I');
  piece.rotate(1); // vertical
  let guard = 0;
  while (piece.shift(-1).action === PIECE_ACTIONS.MOVED && guard < 20) guard += 1;

  const result = piece.rotate(1); // back to horizontal, flush to the wall
  assert.ok(
    result.action === PIECE_ACTIONS.KICKED || result.action === PIECE_ACTIONS.ROTATED,
    `rotation near a wall must resolve, got ${result.action}`
  );
  for (const cell of piece.cells()) {
    assert.ok(cell.column >= 0 && cell.column < 6, 'no cell escapes the board');
  }
});

test('falling piece locks when it cannot fall further', () => {
  const { grid, piece } = pieceOnGrid();
  piece.spawn('O');

  let result = null;
  for (let i = 0; i < 40; i += 1) {
    result = piece.stepDown();
    if (result.action === PIECE_ACTIONS.LOCKED) break;
  }
  assert.equal(result.action, PIECE_ACTIONS.LOCKED);
  assert.equal(piece.active, false);
  assert.ok(result.cells.length > 0);
  for (const cell of result.cells) {
    assert.ok(cell.row >= 0, 'locked cells rest on or above the floor');
  }

  // The caller settles the cells; the controller does not touch the grid.
  assert.equal(grid.valueAt(result.cells[0].column, result.cells[0].row), null);
  grid.settleCells(result.cells, 'x');
  assert.equal(grid.valueAt(result.cells[0].column, result.cells[0].row), 'x');
});

test('falling piece hard drop lands on the stack, not through it', () => {
  const { grid, piece } = pieceOnGrid();
  for (let column = 0; column < 6; column += 1) grid.setCell(column, 0, 'floorstack');

  piece.spawn('O');
  const result = piece.hardDrop();
  assert.equal(result.action, PIECE_ACTIONS.LOCKED);
  assert.ok(result.droppedRows > 0, 'it actually fell');
  for (const cell of result.cells) {
    assert.ok(cell.row >= 1, `must rest on top of the stack, got row ${cell.row}`);
  }
});

test('falling piece reports a top-out when the spawn is blocked', () => {
  const grid = new BlockGridModel({ columns: 6, rows: 10 });
  const piece = new FallingPieceController({
    columns: 6,
    rows: 10,
    spawnRow: 5,
    isBlocked: (column, row) => grid.isBlocked(column, row),
  });
  // Fill the spawn row so the piece has nowhere to appear.
  for (let column = 0; column < 6; column += 1) grid.setCell(column, 5, 'blocked');

  const result = piece.spawn('O');
  assert.equal(result.action, PIECE_ACTIONS.TOPPED_OUT);
  assert.equal(piece.active, false);
});

test('falling piece gravity drops on its own and soft drop accelerates it', () => {
  const { piece } = pieceOnGrid({ dropIntervalSeconds: 0.1, softDropMultiplier: 10 });
  piece.spawn('O');
  const startRow = piece.row;

  piece.step(0.1);
  assert.equal(piece.row, startRow - 1, 'one interval drops one row');

  piece.setSoftDrop(true);
  const beforeSoft = piece.row;
  piece.step(0.05); // half an interval, but 5x the soft-drop interval
  assert.ok(piece.row < beforeSoft - 1, 'soft drop covers several rows');
});

test('falling piece catches up over a long frame instead of drifting behind', () => {
  const { piece } = pieceOnGrid({ dropIntervalSeconds: 0.1 });
  piece.spawn('O');
  const startRow = piece.row;
  piece.step(0.35); // 3.5 intervals in one frame
  assert.ok(piece.row <= startRow - 3, `expected >=3 rows, fell ${startRow - piece.row}`);
});

test('falling piece lock delay lets a piece slide before settling', () => {
  const { piece } = pieceOnGrid({ dropIntervalSeconds: 0.05, lockDelaySeconds: 0.2 });
  piece.spawn('O');
  for (let i = 0; i < 200 && !piece.isGrounded(); i += 1) piece.step(FRAME);
  assert.equal(piece.isGrounded(), true);

  // Grounded but not locked yet: sliding resets the delay.
  assert.equal(piece.active, true);
  piece.step(0.15);
  piece.shift(1);
  piece.step(0.15);
  assert.equal(piece.active, true, 'sliding kept it alive past one delay');

  piece.step(0.25);
  assert.equal(piece.active, false, 'it locks once left alone');
});

test('falling piece shapes all fit the board and rotate through four states', () => {
  for (const name of Object.keys(TETROMINO_SHAPES)) {
    const { piece } = pieceOnGrid();
    const spawn = piece.spawn(name);
    assert.equal(spawn.action, PIECE_ACTIONS.SPAWNED, `${name} must spawn`);
    assert.equal(spawn.cells.length, 4, `${name} has four cells`);

    for (let turn = 0; turn < 4; turn += 1) {
      piece.rotate(1);
      const cells = piece.cells();
      assert.equal(cells.length, 4, `${name} keeps four cells after rotating`);
      const unique = new Set(cells.map((c) => `${c.column}:${c.row}`));
      assert.equal(unique.size, 4, `${name} cells must not overlap after rotating`);
    }
    assert.equal(piece.rotation, 0, 'four quarter turns return to the start');
  }
});

test('falling piece validates its collision hook and shapes', () => {
  assert.throws(() => new FallingPieceController({ isBlocked: 'nope' }), /isBlocked/);
  assert.throws(() => new FallingPieceController({ shapes: {} }), /shapes/);
  const { piece } = pieceOnGrid();
  assert.throws(() => piece.spawn('NOPE'), /unknown shape/);
});

// --- MeleeAttackSystem ----------------------------------------------------

test('melee swing runs windup then active then recovery', () => {
  const melee = new MeleeAttackSystem({
    windupSeconds: 0.1, activeSeconds: 0.1, recoverySeconds: 0.1, inputBufferSeconds: 0,
  });
  assert.equal(melee.phase, MELEE_PHASES.IDLE);
  assert.equal(melee.requestSwing(), MELEE_SWING_RESULTS.STARTED);
  assert.equal(melee.phase, MELEE_PHASES.WINDUP);
  assert.equal(melee.isActive, false, 'windup does not damage');

  melee.step(0.1);
  assert.equal(melee.phase, MELEE_PHASES.ACTIVE);
  assert.equal(melee.isActive, true);

  melee.step(0.1);
  assert.equal(melee.phase, MELEE_PHASES.RECOVERY);
  assert.equal(melee.isActive, false, 'recovery does not damage either');

  melee.step(0.1);
  assert.equal(melee.phase, MELEE_PHASES.IDLE);
});

test('melee only hits inside the arc and only during the active window', () => {
  const melee = new MeleeAttackSystem({
    range: 2, halfAngleRadians: Math.PI / 4, windupSeconds: 0.1, activeSeconds: 0.1,
    recoverySeconds: 0, inputBufferSeconds: 0,
  });
  const origin = new Vector3(0, 0, 0);
  const facing = new Vector3(0, 0, -1);
  const inFront = { position: new Vector3(0, 0, -1.5) };
  const behind = { position: new Vector3(0, 0, 1.5) };
  const tooFar = { position: new Vector3(0, 0, -5) };

  melee.requestSwing();
  assert.deepEqual(
    melee.resolveHits({ origin, facing, targets: [inFront] }),
    [],
    'no damage during windup'
  );

  melee.step(0.1);
  const hits = melee.resolveHits({ origin, facing, targets: [inFront, behind, tooFar] });
  assert.equal(hits.length, 1, 'only the target in the arc is hit');
  assert.equal(hits[0].target, inFront);
});

test('melee hits each target once per swing', () => {
  const melee = new MeleeAttackSystem({
    windupSeconds: 0, activeSeconds: 0.2, recoverySeconds: 0, cooldownSeconds: 0,
    inputBufferSeconds: 0,
  });
  const origin = new Vector3();
  const facing = new Vector3(0, 0, -1);
  const target = { position: new Vector3(0, 0, -1) };

  melee.requestSwing();
  assert.equal(melee.resolveHits({ origin, facing, targets: [target] }).length, 1);
  assert.equal(
    melee.resolveHits({ origin, facing, targets: [target] }).length,
    0,
    'standing in the arc must not re-hit every frame'
  );

  // A fresh swing may hit the same target again.
  melee.step(0.25);
  melee.requestSwing();
  assert.equal(melee.resolveHits({ origin, facing, targets: [target] }).length, 1);
});

test('melee buffers a press made during recovery', () => {
  const melee = new MeleeAttackSystem({
    windupSeconds: 0, activeSeconds: 0.05, recoverySeconds: 0.1, inputBufferSeconds: 0.2,
  });
  melee.requestSwing();
  melee.step(0.05); // -> recovery
  assert.equal(melee.requestSwing(), MELEE_SWING_RESULTS.BUFFERED);

  melee.step(0.1); // recovery ends; the buffered press should fire
  const firstCount = melee.swingCount;
  melee.step(FRAME);
  assert.ok(melee.swingCount >= firstCount, 'the buffered swing came out');
  assert.ok(melee.isSwinging, 'a second swing is running');
});

test('melee respects a cooldown and caps targets per swing', () => {
  const melee = new MeleeAttackSystem({
    windupSeconds: 0, activeSeconds: 0.05, recoverySeconds: 0, cooldownSeconds: 0.3,
    inputBufferSeconds: 0, maxTargetsPerSwing: 2,
  });
  melee.requestSwing();
  const origin = new Vector3();
  const facing = new Vector3(0, 0, -1);
  const crowd = [
    { position: new Vector3(0, 0, -1) },
    { position: new Vector3(0.3, 0, -1.1) },
    { position: new Vector3(-0.3, 0, -1.2) },
  ];
  assert.equal(melee.resolveHits({ origin, facing, targets: crowd }).length, 2, 'capped');

  melee.step(0.05);
  assert.equal(melee.requestSwing(), MELEE_SWING_RESULTS.ON_COOLDOWN);
  melee.step(0.3);
  assert.equal(melee.requestSwing(), MELEE_SWING_RESULTS.STARTED);
});

test('melee validates its timing knobs and hit arguments', () => {
  assert.throws(() => new MeleeAttackSystem({ activeSeconds: 0 }), /activeSeconds/);
  assert.throws(() => new MeleeAttackSystem({ range: -1 }), /range/);
  const melee = new MeleeAttackSystem({ windupSeconds: 0, activeSeconds: 0.1 });
  melee.requestSwing();
  assert.throws(() => melee.resolveHits({ targets: [] }), /origin and facing/);
});

// --- KnockbackModel -------------------------------------------------------

test('knockback grows with accumulated damage', () => {
  const model = new KnockbackModel({ baseKnockback: 4, damageScaling: 0.05 });
  const direction = new Vector3(1, 0, 0);

  const fresh = model.applyHit({ fighterId: 'p2', damage: 5, direction });
  const damaged = model.applyHit({ fighterId: 'p2', damage: 95, direction });
  assert.ok(
    damaged.magnitude > fresh.magnitude,
    `knockback must scale: ${fresh.magnitude} -> ${damaged.magnitude}`
  );
  assert.equal(damaged.totalDamage, 100);
  assert.equal(model.accumulatedDamage('p2'), 100);

  // Damage is per fighter.
  assert.equal(model.accumulatedDamage('p1'), 0);
});

test('knockback launch has an upward component and follows the push direction', () => {
  const model = new KnockbackModel({ launchAngleRadians: Math.PI / 4 });
  const { launchVelocity } = model.applyHit({
    fighterId: 'p2', damage: 50, direction: new Vector3(1, 0, 0),
  });
  assert.ok(launchVelocity.x > 0, 'pushed along +x');
  assert.ok(launchVelocity.y > 0, 'launched upward, not slid along the floor');
});

test('knockback handles a degenerate direction by launching straight up', () => {
  const model = new KnockbackModel({});
  const { launchVelocity, magnitude } = model.applyHit({
    fighterId: 'p2', damage: 10, direction: new Vector3(0, 0, 0),
  });
  assert.ok(launchVelocity.y > 0, 'never returns a zero vector the caller would apply');
  assert.ok(Math.abs(launchVelocity.y - magnitude) < 1e-6);
});

test('knockback is capped and resets per stock', () => {
  const model = new KnockbackModel({ maxKnockback: 10, damageScaling: 5 });
  const hit = model.applyHit({
    fighterId: 'p2', damage: 400, direction: new Vector3(1, 0, 0),
  });
  assert.ok(hit.magnitude <= 10 + 1e-9, `capped at maxKnockback, got ${hit.magnitude}`);

  model.resetFighter('p2');
  assert.equal(model.accumulatedDamage('p2'), 0);
});

test('knockback ring-out detects every blast line', () => {
  const model = new KnockbackModel({ stageHalfWidth: 10, stageFloorUp: -5, stageCeilingUp: 20 });
  assert.equal(model.ringOutSide(new Vector3(0, 0, 0)), RING_OUT_SIDES.INSIDE);
  assert.equal(model.isRingOut(new Vector3(0, 0, 0)), false);
  assert.equal(model.ringOutSide(new Vector3(-11, 0, 0)), RING_OUT_SIDES.LEFT);
  assert.equal(model.ringOutSide(new Vector3(11, 0, 0)), RING_OUT_SIDES.RIGHT);
  assert.equal(model.ringOutSide(new Vector3(0, -6, 0)), RING_OUT_SIDES.BELOW);
  assert.equal(model.ringOutSide(new Vector3(0, 21, 0)), RING_OUT_SIDES.ABOVE);
  assert.equal(model.isRingOut(new Vector3(11, 0, 0)), true);
});

test('knockback validates its stage bounds', () => {
  assert.throws(() => new KnockbackModel({ stageHalfWidth: 0 }), /stageHalfWidth/);
  assert.throws(
    () => new KnockbackModel({ stageFloorUp: 5, stageCeilingUp: 1 }),
    /stageCeilingUp/
  );
  const model = new KnockbackModel({});
  assert.throws(() => model.applyHit({ fighterId: 'x', damage: 1 }), /direction/);
});

// --- VisionConeDetector ---------------------------------------------------

test('vision cone sees only what is inside the cone', () => {
  const detector = new VisionConeDetector({ viewDistance: 10, halfAngleRadians: Math.PI / 6 });
  const observerPosition = new Vector3(0, 0, 0);
  const observerFacing = new Vector3(0, 0, -1);

  const front = detector.testVisibility({
    observerPosition, observerFacing, targetPosition: new Vector3(0, 0, -5),
  });
  assert.equal(front.visible, true);

  const behind = detector.testVisibility({
    observerPosition, observerFacing, targetPosition: new Vector3(0, 0, 5),
  });
  assert.equal(behind.visible, false, 'guards do not see through the backs of their heads');

  const side = detector.testVisibility({
    observerPosition, observerFacing, targetPosition: new Vector3(8, 0, -1),
  });
  assert.equal(side.visible, false, 'outside the cone angle');

  const far = detector.testVisibility({
    observerPosition, observerFacing, targetPosition: new Vector3(0, 0, -50),
  });
  assert.equal(far.visible, false, 'beyond view distance');
});

test('vision suspicion fills while visible and escalates through the states', () => {
  const detector = new VisionConeDetector({
    viewDistance: 10, fillSecondsAtEdge: 1, fillSecondsAtPointBlank: 1,
    suspicionThreshold: 0.3, alertHoldSeconds: 0,
  });
  const args = {
    observerId: 'guard',
    observerPosition: new Vector3(0, 0, 0),
    observerFacing: new Vector3(0, 0, -1),
    targetPosition: new Vector3(0, 0, -5),
  };

  let result = detector.step({ ...args, deltaSeconds: 0.1 });
  assert.equal(result.visible, true);
  assert.ok(result.suspicion > 0 && result.suspicion < 0.3);
  assert.equal(result.state, ALERT_STATES.UNAWARE, 'a glimpse is not an alert');

  result = detector.step({ ...args, deltaSeconds: 0.3 });
  assert.equal(result.state, ALERT_STATES.SUSPICIOUS);
  assert.equal(result.justAlerted, false);

  result = detector.step({ ...args, deltaSeconds: 1 });
  assert.equal(result.state, ALERT_STATES.ALERTED);
  assert.equal(result.justAlerted, true, 'fires exactly on the crossing frame');

  result = detector.step({ ...args, deltaSeconds: 0.1 });
  assert.equal(result.justAlerted, false, 'and only once');
});

test('vision suspicion fills faster up close than at the edge of view', () => {
  const make = () => new VisionConeDetector({
    viewDistance: 20, fillSecondsAtEdge: 4, fillSecondsAtPointBlank: 0.5, alertHoldSeconds: 0,
  });
  const base = {
    observerId: 'g',
    observerPosition: new Vector3(0, 0, 0),
    observerFacing: new Vector3(0, 0, -1),
    deltaSeconds: 0.2,
  };
  const near = make().step({ ...base, targetPosition: new Vector3(0, 0, -1) });
  const far = make().step({ ...base, targetPosition: new Vector3(0, 0, -19) });
  assert.ok(
    near.suspicion > far.suspicion,
    `proximity must matter: near ${near.suspicion} vs far ${far.suspicion}`
  );
});

test('vision suspicion drains once the target breaks line of sight', () => {
  const detector = new VisionConeDetector({
    viewDistance: 10, fillSecondsAtEdge: 0.5, fillSecondsAtPointBlank: 0.5,
    drainSeconds: 1, alertHoldSeconds: 0, suspicionThreshold: 0.3,
  });
  const observerPosition = new Vector3(0, 0, 0);
  const observerFacing = new Vector3(0, 0, -1);

  detector.step({
    observerId: 'g', observerPosition, observerFacing,
    targetPosition: new Vector3(0, 0, -5), deltaSeconds: 0.2,
  });
  const peak = detector.suspicion('g');
  assert.ok(peak > 0);

  // Step out of the cone.
  const hidden = detector.step({
    observerId: 'g', observerPosition, observerFacing,
    targetPosition: new Vector3(0, 0, 5), deltaSeconds: 0.2,
  });
  assert.ok(hidden.suspicion < peak, 'hiding lowers suspicion');
});

test('an alerted guard holds its alert through a brief break in sight', () => {
  const detector = new VisionConeDetector({
    viewDistance: 10, fillSecondsAtEdge: 0.2, fillSecondsAtPointBlank: 0.2,
    drainSeconds: 0.5, alertHoldSeconds: 1, suspicionThreshold: 0.3,
  });
  const observerPosition = new Vector3(0, 0, 0);
  const observerFacing = new Vector3(0, 0, -1);

  detector.step({
    observerId: 'g', observerPosition, observerFacing,
    targetPosition: new Vector3(0, 0, -3), deltaSeconds: 0.5,
  });
  assert.equal(detector.alertState('g'), ALERT_STATES.ALERTED);

  // One frame behind cover must not un-alert the guard.
  const ducked = detector.step({
    observerId: 'g', observerPosition, observerFacing,
    targetPosition: new Vector3(0, 0, 9), deltaSeconds: FRAME,
  });
  assert.equal(ducked.state, ALERT_STATES.ALERTED, 'the hold keeps the alarm up');
});

test('vision occlusion hook can hide a target inside the cone', () => {
  let occluded = false;
  const detector = new VisionConeDetector({
    viewDistance: 10, fillSecondsAtEdge: 0.5, fillSecondsAtPointBlank: 0.5,
    alertHoldSeconds: 0, isOccluded: () => occluded,
  });
  const args = {
    observerId: 'g',
    observerPosition: new Vector3(0, 0, 0),
    observerFacing: new Vector3(0, 0, -1),
    targetPosition: new Vector3(0, 0, -3),
    deltaSeconds: 0.1,
  };
  assert.equal(detector.step(args).visible, true);
  occluded = true;
  assert.equal(detector.step(args).visible, false, 'a wall hides a target in the cone');
});

test('vision detector tracks observers independently', () => {
  const detector = new VisionConeDetector({
    viewDistance: 10, fillSecondsAtEdge: 0.5, fillSecondsAtPointBlank: 0.5, alertHoldSeconds: 0,
  });
  const facing = new Vector3(0, 0, -1);
  detector.step({
    observerId: 'a', observerPosition: new Vector3(0, 0, 0), observerFacing: facing,
    targetPosition: new Vector3(0, 0, -2), deltaSeconds: 1,
  });
  detector.step({
    observerId: 'b', observerPosition: new Vector3(50, 0, 0), observerFacing: facing,
    targetPosition: new Vector3(0, 0, -2), deltaSeconds: 1,
  });
  assert.equal(detector.alertState('a'), ALERT_STATES.ALERTED);
  assert.equal(detector.alertState('b'), ALERT_STATES.UNAWARE, 'the distant guard saw nothing');
  assert.equal(detector.isAnyAlerted(), true);
  assert.ok(detector.peakSuspicion() >= 1);
});

test('vision detector validates its knobs', () => {
  assert.throws(() => new VisionConeDetector({ viewDistance: 0 }), /viewDistance/);
  assert.throws(() => new VisionConeDetector({ isOccluded: 5 }), /isOccluded/);
  const detector = new VisionConeDetector({});
  assert.throws(() => detector.testVisibility({}), /required/);
});

// --- KickableBallModel ----------------------------------------------------

test('a car driving into the ball kicks it', () => {
  const ball = new KickableBallModel({ radius: 1, floorUp: 0, minKickSpeed: 0.5 });
  const kick = ball.resolveContact({
    bodyId: 'car',
    bodyPosition: new Vector3(0, 1, 1.5),
    bodyVelocity: new Vector3(0, 0, -20),
    bodyRadius: 1,
  });
  assert.ok(kick, 'contact within radius + bodyRadius kicks');
  assert.ok(kick.impulse > 0);
  assert.ok(ball.speed > 0, 'the ball is moving now');
  assert.equal(ball.kickCount, 1);
});

test('the ball ignores contact beyond the combined radii', () => {
  const ball = new KickableBallModel({ radius: 1, floorUp: 0 });
  const kick = ball.resolveContact({
    bodyId: 'car',
    bodyPosition: new Vector3(0, 1, 5),
    bodyVelocity: new Vector3(0, 0, -20),
    bodyRadius: 1,
  });
  assert.equal(kick, null, 'no contact at distance 5 with radii summing to 2');
  assert.equal(ball.speed, 0);
});

test('impulse follows closing speed, so a glancing pass barely moves the ball', () => {
  const head = new KickableBallModel({ radius: 1, floorUp: 0, minKickSpeed: 0.1 });
  const headOn = head.resolveContact({
    bodyId: 'c', bodyPosition: new Vector3(0, 1, 1.5),
    bodyVelocity: new Vector3(0, 0, -20), bodyRadius: 1,
  });

  const glance = new KickableBallModel({ radius: 1, floorUp: 0, minKickSpeed: 0.1 });
  const sideways = glance.resolveContact({
    bodyId: 'c', bodyPosition: new Vector3(0, 1, 1.5),
    bodyVelocity: new Vector3(20, 0, 0), bodyRadius: 1,
  });

  assert.ok(headOn, 'a head-on hit connects');
  assert.equal(sideways, null, 'a perpendicular pass has no closing speed');
  assert.equal(glance.speed, 0);
});

test('the ball does not re-kick every frame while a car stays against it', () => {
  const ball = new KickableBallModel({
    radius: 1, floorUp: 0, contactCooldownSeconds: 0.15, minKickSpeed: 0.1, gravity: 0, airDrag: 0,
  });
  // A car pressed against a ball that cannot move away: without the cooldown this
  // re-kicks every frame and the ball vibrates across the pitch.
  const contact = () => ({
    bodyId: 'car', bodyPosition: new Vector3(0, 1, 1.5),
    bodyVelocity: new Vector3(0, 0, -5), bodyRadius: 1,
  });
  assert.ok(ball.resolveContact(contact()), 'first contact kicks');
  assert.equal(ball.resolveContact(contact()), null, 'the cooldown suppresses the next frame');
  assert.equal(ball.resolveContact(contact()), null, 'and the frame after that');
  assert.equal(ball.kickCount, 1, 'still exactly one kick');

  // Hold the ball in place so it stays in contact range, then let the cooldown
  // expire: the same car may kick it again.
  ball.velocity.set(0, 0, 0);
  ball.position.copy(ball.basis.fromBasisComponents(0, 1, 0));
  ball.step(0.2);
  ball.velocity.set(0, 0, 0);
  ball.position.copy(ball.basis.fromBasisComponents(0, 1, 0));
  assert.ok(ball.resolveContact(contact()), 'kickable again once the cooldown clears');
  assert.equal(ball.kickCount, 2);
});

test('a kicked ball travels out of contact range instead of sticking', () => {
  const ball = new KickableBallModel({
    radius: 1, floorUp: 0, minKickSpeed: 0.1, gravity: 0, airDrag: 0,
  });
  const bodyPosition = new Vector3(0, 1, 1.5);
  ball.resolveContact({
    bodyId: 'car', bodyPosition, bodyVelocity: new Vector3(0, 0, -5), bodyRadius: 1,
  });
  ball.step(0.2);
  assert.ok(
    ball.position.distanceTo(bodyPosition) > 2,
    'the ball leaves the contact envelope, so no further contact is reported'
  );
});

test('the ball falls, bounces and comes to rest on the floor', () => {
  const ball = new KickableBallModel({
    radius: 1, floorUp: 0, gravity: 18, bounceRestitution: 0.5,
  });
  ball.position.set(0, 8, 0);
  for (let i = 0; i < 600; i += 1) ball.step(FRAME);

  assert.ok(Math.abs(ball.position.y - 1) < 1e-3, `rests on radius above the floor, got ${ball.position.y}`);
  assert.equal(ball.grounded, true);
  assert.ok(Math.abs(ball.velocity.y) < 1e-6, 'stops bouncing instead of jittering forever');
});

test('the ball bounces off the field walls when bounds are set', () => {
  const ball = new KickableBallModel({
    radius: 1, floorUp: 0, fieldHalfWidth: 10, gravity: 0, airDrag: 0,
  });
  ball.velocity.set(30, 0, 0);
  for (let i = 0; i < 120; i += 1) ball.step(FRAME);
  assert.ok(Math.abs(ball.position.x) <= 10, `stays inside the field, got ${ball.position.x}`);
});

test('the ball reports which goal it entered', () => {
  const ball = new KickableBallModel({ radius: 1, floorUp: 0, gravity: 0 });
  const opponentGoal = { rightMin: -3, rightMax: 3, forwardMin: 18, forwardMax: 24 };
  const ownGoal = { rightMin: -3, rightMax: 3, forwardMin: -24, forwardMax: -18 };

  assert.equal(ball.checkGoals({ ownGoal, opponentGoal }), GOAL_SIDES.NONE);

  // The default basis has forward = -z, so the opponent goal sits at -z.
  ball.position.copy(
    ball.basis.fromBasisComponents(0, 1, 20)
  );
  assert.equal(ball.checkGoals({ ownGoal, opponentGoal }), GOAL_SIDES.OPPONENT);

  ball.position.copy(ball.basis.fromBasisComponents(0, 1, -20));
  assert.equal(ball.checkGoals({ ownGoal, opponentGoal }), GOAL_SIDES.OWN);
});

test('the ball validates its knobs and contact arguments', () => {
  assert.throws(() => new KickableBallModel({ radius: 0 }), /radius/);
  assert.throws(() => new KickableBallModel({ gravity: -1 }), /gravity/);
  const ball = new KickableBallModel({});
  assert.throws(() => ball.resolveContact({ bodyId: 'x' }), /bodyPosition/);
});

// --- CarryStationController -----------------------------------------------

function kitchen() {
  const controller = new CarryStationController({ interactRange: 2 });
  controller.registerStation({
    id: 'chop', position: new Vector3(0, 0, 0),
    accepts: ['veg'], produces: 'chopped-veg', processSeconds: 1,
  });
  controller.registerStation({
    id: 'serve', position: new Vector3(5, 0, 0), accepts: ['chopped-veg'], produces: null,
  });
  return controller;
}

test('hands hold exactly one item and refusals are reported', () => {
  const kitchenController = kitchen();
  const here = new Vector3(0, 0, 0);

  assert.equal(kitchenController.drop().result, CARRY_RESULTS.HANDS_EMPTY);
  assert.equal(
    kitchenController.pickUp({ type: 'veg', position: here }, here).result,
    CARRY_RESULTS.PICKED_UP
  );
  assert.equal(
    kitchenController.pickUp({ type: 'veg', position: here }, here).result,
    CARRY_RESULTS.HANDS_FULL,
    'a second pickup is refused, not silently swapped'
  );
  assert.equal(kitchenController.drop().result, CARRY_RESULTS.DROPPED);
  assert.equal(kitchenController.handsEmpty, true);
});

test('interacting out of range is refused', () => {
  const kitchenController = kitchen();
  const here = new Vector3(0, 0, 0);
  const faraway = new Vector3(100, 0, 0);

  assert.equal(
    kitchenController.pickUp({ type: 'veg', position: faraway }, here).result,
    CARRY_RESULTS.OUT_OF_RANGE
  );
  kitchenController.pickUp({ type: 'veg', position: here }, here);
  assert.equal(
    kitchenController.interact('chop', faraway).result,
    CARRY_RESULTS.OUT_OF_RANGE
  );
});

test('a station processes over time and hands back the product', () => {
  const kitchenController = kitchen();
  const here = new Vector3(0, 0, 0);
  kitchenController.pickUp({ type: 'veg', position: here }, here);

  assert.equal(kitchenController.interact('chop', here).result, CARRY_RESULTS.PROCESS_STARTED);
  assert.equal(kitchenController.handsEmpty, true, 'the item went into the station');
  assert.equal(kitchenController.station('chop').state, STATION_STATES.WORKING);

  // The station runs unattended: the player is free to walk away.
  assert.deepEqual(kitchenController.step(0.5), [], 'not finished yet');
  assert.equal(kitchenController.interact('chop', here).result, CARRY_RESULTS.BUSY);

  assert.deepEqual(kitchenController.step(0.6), ['chop'], 'reports the completion once');
  assert.equal(kitchenController.station('chop').state, STATION_STATES.DONE);
  assert.deepEqual(kitchenController.step(1), [], 'and only once');

  const collected = kitchenController.interact('chop', here);
  assert.equal(collected.result, CARRY_RESULTS.COLLECTED);
  assert.equal(kitchenController.heldItem.type, 'chopped-veg');
  assert.equal(kitchenController.station('chop').state, STATION_STATES.IDLE, 'free again');
});

test('a station rejects an item it does not accept', () => {
  const kitchenController = kitchen();
  const here = new Vector3(0, 0, 0);
  kitchenController.pickUp({ type: 'raw-meat', position: here }, here);

  const rejected = kitchenController.interact('chop', here);
  assert.equal(rejected.result, CARRY_RESULTS.REJECTED);
  assert.equal(kitchenController.heldItem.type, 'raw-meat', 'the item stays in hand');
});

test('collecting an output requires a free hand', () => {
  const kitchenController = kitchen();
  const here = new Vector3(0, 0, 0);
  kitchenController.pickUp({ type: 'veg', position: here }, here);
  kitchenController.interact('chop', here);
  kitchenController.step(1.1);

  kitchenController.pickUp({ type: 'veg', position: here }, here);
  assert.equal(
    kitchenController.interact('chop', here).result,
    CARRY_RESULTS.HANDS_FULL,
    'cannot collect with full hands'
  );
  assert.equal(kitchenController.station('chop').state, STATION_STATES.DONE, 'output is preserved');
});

test('a serving station consumes the dish and counts it', () => {
  const kitchenController = kitchen();
  const atServe = new Vector3(5, 0, 0);
  kitchenController.pickUp({ type: 'chopped-veg', position: atServe }, atServe);

  const served = kitchenController.interact('serve', atServe);
  assert.equal(served.result, CARRY_RESULTS.DEPOSITED);
  assert.equal(served.served, true);
  assert.equal(kitchenController.servedCount, 1);
  assert.equal(kitchenController.handsEmpty, true, 'the dish is gone');
});

test('the full cooking loop runs end to end', () => {
  const kitchenController = kitchen();
  const atChop = new Vector3(0, 0, 0);
  const atServe = new Vector3(5, 0, 0);

  for (let round = 0; round < 3; round += 1) {
    kitchenController.pickUp({ type: 'veg', position: atChop }, atChop);
    kitchenController.interact('chop', atChop);
    kitchenController.step(1.1);
    kitchenController.interact('chop', atChop);
    kitchenController.interact('serve', atServe);
  }
  assert.equal(kitchenController.servedCount, 3, 'three dishes served');
  assert.equal(kitchenController.handsEmpty, true);
});

test('nearestStation finds only stations in range', () => {
  const kitchenController = kitchen();
  assert.equal(kitchenController.nearestStation(new Vector3(0, 0, 0)), 'chop');
  assert.equal(kitchenController.nearestStation(new Vector3(5, 0, 0)), 'serve');
  assert.equal(kitchenController.nearestStation(new Vector3(50, 0, 0)), null);
});

test('the carry controller validates its registrations', () => {
  assert.throws(() => new CarryStationController({ interactRange: 0 }), /interactRange/);
  const controller = new CarryStationController({});
  assert.throws(() => controller.registerStation({ position: new Vector3() }), /id/);
  assert.throws(() => controller.registerStation({ id: 'x' }), /position/);
  assert.equal(controller.interact('missing', new Vector3()).result, CARRY_RESULTS.REJECTED);
});
