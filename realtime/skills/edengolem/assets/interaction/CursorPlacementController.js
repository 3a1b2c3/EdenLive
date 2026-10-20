import { Plane, Raycaster, Vector3 } from 'three';
import { DEFAULT_WORLD_BASIS } from '../math/WorldBasis.js';
import { toVec3 } from '../math/Vector3Utils.js';

export const PLACEMENT_STATUS = Object.freeze({
  VALID: 'valid',
  NO_HIT: 'noHit',
  OUT_OF_BOUNDS: 'outOfBounds',
  OCCUPIED: 'occupied',
  UNAFFORDABLE: 'unaffordable',
});

const CENTER_NDC = Object.freeze({ x: 0, y: 0 });

// Math.round returns -0 for inputs in [-0.5, 0), and -0 formats as "-0" in a
// template string. A caller keying occupancy by `${cell.right},${cell.forward}`
// would treat "0,-0" and "0,0" as different cells, so collapse -0 to 0 here.
function normalizeCellIndex(value) {
  return value === 0 ? 0 : value;
}

/**
 * Turns a cursor ray into a grid cell you can preview, validate and commit.
 *
 * This is the build-placement half of tower defense, city builders and any
 * click-to-place mechanic: cast the cursor onto the ground plane, snap to the
 * nearest cell, and report whether placing there is legal before the player
 * commits. Occupancy and cost stay outside this module -- pass predicates -- so
 * the same controller serves grids backed by an array, a Map or a game state
 * object.
 *
 * Cell (0, 0) is centred on planar (originRight, originForward). Set columns or
 * rows to 0 to leave that axis unbounded.
 */
export class CursorPlacementController {
  constructor({
    cellSize = 1,
    columns = 0,
    rows = 0,
    originRight = 0,
    originForward = 0,
    planeHeight = 0,
    isCellOccupied = null,
    cellCost = null,
    availableFunds = Number.POSITIVE_INFINITY,
    basis = DEFAULT_WORLD_BASIS,
  } = {}) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new Error('CursorPlacementController: cellSize must be a finite number > 0');
    }
    if (isCellOccupied !== null && typeof isCellOccupied !== 'function') {
      throw new Error('CursorPlacementController: isCellOccupied must be a function or null');
    }
    if (cellCost !== null && typeof cellCost !== 'function') {
      throw new Error('CursorPlacementController: cellCost must be a function or null');
    }

    this.cellSize = cellSize;
    this.columns = Math.max(0, Math.floor(columns));
    this.rows = Math.max(0, Math.floor(rows));
    this.originRight = originRight;
    this.originForward = originForward;
    this.planeHeight = planeHeight;
    this.isCellOccupied = isCellOccupied;
    this.cellCost = cellCost;
    this.availableFunds = availableFunds;
    this.basis = basis;

    this.raycaster = new Raycaster();
    this.plane = new Plane(this.basis.upVector(), -planeHeight);

    // Scratch reused across frames: this runs on every pointer move.
    this._hitPoint = new Vector3();
    this._planarScratch = { right: 0, forward: 0 };
    this._previewPosition = new Vector3();

    this.previewState = this._emptyPreview();
  }

  _emptyPreview() {
    return {
      status: PLACEMENT_STATUS.NO_HIT,
      valid: false,
      cell: null,
      position: null,
      cost: 0,
      hasHit: false,
    };
  }

  setAvailableFunds(availableFunds) {
    this.availableFunds = availableFunds;
    return this;
  }

  setPlaneHeight(planeHeight) {
    this.planeHeight = planeHeight;
    this.plane.set(this.basis.upVector(), -planeHeight);
    return this;
  }

  /** Planar centre of a cell, as basis-aware planar components. */
  cellToPlanar(cell) {
    return {
      right: this.originRight + cell.right * this.cellSize,
      forward: this.originForward + cell.forward * this.cellSize,
    };
  }

  /** World-space centre of a cell, on the placement plane. */
  cellToWorld(cell, target = new Vector3()) {
    const planar = this.cellToPlanar(cell);
    return this.basis.fromBasisComponents(planar.right, this.planeHeight, planar.forward, target);
  }

  /** Nearest cell to a planar point. Never null; bounds are checked separately. */
  planarToCell(right, forward) {
    return {
      right: normalizeCellIndex(Math.round((right - this.originRight) / this.cellSize)),
      forward: normalizeCellIndex(Math.round((forward - this.originForward) / this.cellSize)),
    };
  }

  isCellInBounds(cell) {
    if (this.columns > 0 && (cell.right < 0 || cell.right >= this.columns)) return false;
    if (this.rows > 0 && (cell.forward < 0 || cell.forward >= this.rows)) return false;
    return true;
  }

  costAt(cell) {
    if (!this.cellCost) return 0;
    const cost = this.cellCost(cell);
    return Number.isFinite(cost) ? cost : 0;
  }

  /**
   * Classify a cell without touching preview state: returns a PLACEMENT_STATUS.
   * Checks run cheapest-first, and bounds before occupancy so an out-of-range
   * cell never reaches a caller's occupancy lookup.
   */
  statusAt(cell) {
    if (!cell) return PLACEMENT_STATUS.NO_HIT;
    if (!this.isCellInBounds(cell)) return PLACEMENT_STATUS.OUT_OF_BOUNDS;
    if (this.isCellOccupied && this.isCellOccupied(cell)) return PLACEMENT_STATUS.OCCUPIED;
    if (this.costAt(cell) > this.availableFunds) return PLACEMENT_STATUS.UNAFFORDABLE;
    return PLACEMENT_STATUS.VALID;
  }

  /** Update the preview from a screen-space NDC point and a camera. */
  updateFromScreen(ndc = CENTER_NDC, camera) {
    if (!camera) {
      throw new Error('CursorPlacementController: updateFromScreen requires a camera');
    }
    this.raycaster.setFromCamera(ndc, camera);
    return this._updateFromRaycaster();
  }

  /** Update the preview from an explicit world-space ray. */
  updateFromRay(origin, direction) {
    const rayDirection = toVec3(direction);
    if (rayDirection.lengthSq() <= 0) {
      throw new Error('CursorPlacementController: ray direction must be non-zero');
    }
    this.raycaster.set(toVec3(origin), rayDirection.normalize());
    return this._updateFromRaycaster();
  }

  _updateFromRaycaster() {
    const hit = this.raycaster.ray.intersectPlane(this.plane, this._hitPoint);
    if (!hit) {
      // Ray parallel to the plane, or pointing away from it: no cell under cursor.
      this.previewState = this._emptyPreview();
      return this.previewState;
    }

    const planar = this.basis.toPlanar(hit, this._planarScratch);
    const cell = this.planarToCell(planar.right, planar.forward);
    const status = this.statusAt(cell);
    this.cellToWorld(cell, this._previewPosition);

    this.previewState = {
      status,
      valid: status === PLACEMENT_STATUS.VALID,
      cell,
      position: this._previewPosition,
      cost: this.costAt(cell),
      hasHit: true,
    };
    return this.previewState;
  }

  /** The most recent preview. Safe to read every frame. */
  preview() {
    return this.previewState;
  }

  /**
   * Commit the previewed placement. Returns a committed placement with its own
   * Vector3 (so callers can keep it) or null when the preview is not valid.
   * Committing does not mutate occupancy: the caller owns that, and calls
   * cancel() or re-previews afterwards.
   */
  commit() {
    if (!this.previewState.valid) return null;
    const cell = this.previewState.cell;
    return {
      cell: { right: cell.right, forward: cell.forward },
      position: this.cellToWorld(cell),
      cost: this.previewState.cost,
    };
  }

  /** Drop the preview. The next update rebuilds it from scratch. */
  cancel() {
    this.previewState = this._emptyPreview();
    return this.previewState;
  }
}
