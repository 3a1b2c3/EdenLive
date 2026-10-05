// Headless tests for assets/interaction/CursorPlacementController.js.
// three's Raycaster/Plane/Camera math runs without a browser, so a known screen
// ray can be asserted to land on an expected cell with no renderer at all.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';

import {
  CursorPlacementController,
  PLACEMENT_STATUS,
} from '../../../assets/interaction/CursorPlacementController.js';

// A camera 10 units up looking straight down at the origin. With this pose the
// screen centre maps to planar (0, 0), which is cell (0, 0) by construction.
function topDownCamera() {
  const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 10, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

test('a known screen ray maps to the expected cell', () => {
  const controller = new CursorPlacementController({ cellSize: 1, columns: 8, rows: 8 });
  const camera = topDownCamera();

  // Screen centre, straight down the camera axis, onto the origin.
  const centre = controller.updateFromScreen({ x: 0, y: 0 }, camera);
  assert.equal(centre.hasHit, true, 'centre ray must hit the ground plane');
  assert.deepEqual(centre.cell, { right: 0, forward: 0 });
  assert.equal(centre.status, PLACEMENT_STATUS.VALID);
  assert.equal(centre.valid, true);

  // The preview position is the cell centre on the placement plane.
  assert.ok(centre.position.distanceTo(new Vector3(0, 0, 0)) < 1e-9);
});

test('an explicit world ray snaps to the nearest cell centre', () => {
  const controller = new CursorPlacementController({ cellSize: 2, columns: 0, rows: 0 });

  // The default basis has forward = -z, so world z=-3.4 is planar forward=+3.4.
  // With cellSize 2 that is cell (round(5.2/2), round(3.4/2)) = (3, 2), whose
  // centre is planar (6, 4) and therefore world (6, 0, -4).
  const preview = controller.updateFromRay(new Vector3(5.2, 9, -3.4), new Vector3(0, -1, 0));
  assert.equal(preview.hasHit, true);
  assert.deepEqual(preview.cell, { right: 3, forward: 2 });
  assert.ok(Math.abs(preview.position.x - 6) < 1e-9, `x was ${preview.position.x}`);
  assert.ok(Math.abs(preview.position.z - (-4)) < 1e-9, `z was ${preview.position.z}`);
});

test('a ray parallel to the ground plane reports no hit', () => {
  const controller = new CursorPlacementController({ cellSize: 1 });
  const preview = controller.updateFromRay(new Vector3(0, 5, 0), new Vector3(1, 0, 0));
  assert.equal(preview.hasHit, false);
  assert.equal(preview.status, PLACEMENT_STATUS.NO_HIT);
  assert.equal(preview.cell, null);
  assert.equal(controller.commit(), null, 'nothing to commit without a hit');
});

test('placement outside the grid bounds is rejected before occupancy is consulted', () => {
  let occupancyCalls = 0;
  const controller = new CursorPlacementController({
    cellSize: 1,
    columns: 4,
    rows: 4,
    isCellOccupied: () => {
      occupancyCalls += 1;
      return false;
    },
  });

  const preview = controller.updateFromRay(new Vector3(9, 5, 0), new Vector3(0, -1, 0));
  assert.deepEqual(preview.cell, { right: 9, forward: 0 });
  assert.equal(preview.status, PLACEMENT_STATUS.OUT_OF_BOUNDS);
  assert.equal(preview.valid, false);
  assert.equal(occupancyCalls, 0, 'out-of-bounds cells must not reach the occupancy lookup');
});

test('occupancy and cost gate a placement independently', () => {
  const occupied = new Set(['1,1']);
  const controller = new CursorPlacementController({
    cellSize: 1,
    columns: 6,
    rows: 6,
    isCellOccupied: (cell) => occupied.has(`${cell.right},${cell.forward}`),
    cellCost: () => 50,
    availableFunds: 40,
  });

  // Occupied cell.
  const onOccupied = controller.updateFromRay(new Vector3(1, 5, -1), new Vector3(0, -1, 0));
  assert.deepEqual(onOccupied.cell, { right: 1, forward: 1 });
  assert.equal(onOccupied.status, PLACEMENT_STATUS.OCCUPIED);

  // Free cell, but too expensive.
  const tooPoor = controller.updateFromRay(new Vector3(2, 5, -2), new Vector3(0, -1, 0));
  assert.equal(tooPoor.status, PLACEMENT_STATUS.UNAFFORDABLE);
  assert.equal(controller.commit(), null);

  // Same cell once the player can afford it.
  controller.setAvailableFunds(50);
  const afford = controller.updateFromRay(new Vector3(2, 5, -2), new Vector3(0, -1, 0));
  assert.equal(afford.status, PLACEMENT_STATUS.VALID);

  const committed = controller.commit();
  assert.deepEqual(committed.cell, { right: 2, forward: 2 });
  assert.equal(committed.cost, 50);
  assert.ok(committed.position instanceof Vector3);
});

test('commit returns an independent position and cancel clears the preview', () => {
  const controller = new CursorPlacementController({ cellSize: 1, columns: 4, rows: 4 });
  controller.updateFromRay(new Vector3(1, 5, -1), new Vector3(0, -1, 0));

  const first = controller.commit();
  // Move the cursor: a previously committed placement must not follow it.
  controller.updateFromRay(new Vector3(3, 5, -3), new Vector3(0, -1, 0));
  assert.deepEqual(first.cell, { right: 1, forward: 1 }, 'committed cell is a copy');
  assert.ok(Math.abs(first.position.x - 1) < 1e-9, 'committed position is a copy');

  const cancelled = controller.cancel();
  assert.equal(cancelled.valid, false);
  assert.equal(cancelled.status, PLACEMENT_STATUS.NO_HIT);
  assert.equal(controller.commit(), null, 'cannot commit a cancelled preview');
});

test('the placement plane can be raised off the ground', () => {
  const controller = new CursorPlacementController({ cellSize: 1, planeHeight: 3 });
  const preview = controller.updateFromRay(new Vector3(0, 20, 0), new Vector3(0, -1, 0));
  assert.equal(preview.hasHit, true);
  assert.ok(Math.abs(preview.position.y - 3) < 1e-9, `y was ${preview.position.y}`);

  controller.setPlaneHeight(-2);
  const lowered = controller.updateFromRay(new Vector3(0, 20, 0), new Vector3(0, -1, 0));
  assert.ok(Math.abs(lowered.position.y - (-2)) < 1e-9);
});

test('an origin offset shifts which cell a point falls in', () => {
  const controller = new CursorPlacementController({
    cellSize: 1,
    originRight: 0.5,
    originForward: 0.5,
  });
  // planar (0.5, 0.5) is exactly cell (0, 0) once the origin moves there.
  const preview = controller.updateFromRay(new Vector3(0.5, 5, -0.5), new Vector3(0, -1, 0));
  assert.deepEqual(preview.cell, { right: 0, forward: 0 });
});

test('updateFromScreen and a degenerate ray fail loud', () => {
  const controller = new CursorPlacementController({ cellSize: 1 });
  assert.throws(() => controller.updateFromScreen({ x: 0, y: 0 }, null), /camera/);
  assert.throws(() => controller.updateFromRay(new Vector3(), new Vector3(0, 0, 0)), /non-zero/);
  assert.throws(() => new CursorPlacementController({ cellSize: 0 }), /cellSize/);
  assert.throws(
    () => new CursorPlacementController({ cellSize: 1, isCellOccupied: 'nope' }),
    /isCellOccupied/
  );
});

test('preview updates allocate no new vectors per move', () => {
  const controller = new CursorPlacementController({ cellSize: 1, columns: 64, rows: 64 });
  const first = controller.updateFromRay(new Vector3(1, 5, -1), new Vector3(0, -1, 0));
  const firstPosition = first.position;

  for (let i = 0; i < 500; i += 1) {
    controller.updateFromRay(new Vector3(i % 60, 5, -(i % 60)), new Vector3(0, -1, 0));
  }
  // The preview reuses one scratch Vector3 across pointer moves.
  assert.equal(controller.preview().position, firstPosition, 'preview position is reused scratch');
});
