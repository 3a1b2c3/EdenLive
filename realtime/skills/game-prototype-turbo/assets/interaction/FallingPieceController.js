import { DEFAULT_PRNG } from '../math/RandomUtils.js';

export const PIECE_ACTIONS = Object.freeze({
  MOVED: 'moved',
  BLOCKED: 'blocked',
  ROTATED: 'rotated',
  KICKED: 'kicked',
  LOCKED: 'locked',
  SPAWNED: 'spawned',
  TOPPED_OUT: 'toppedOut',
});

/**
 * The seven tetrominoes as rotation-invariant cell offsets around a pivot.
 * O never rotates; I, S and Z have two distinct states; the rest have four.
 */
export const TETROMINO_SHAPES = Object.freeze({
  I: Object.freeze([[-1, 0], [0, 0], [1, 0], [2, 0]]),
  O: Object.freeze([[0, 0], [1, 0], [0, 1], [1, 1]]),
  T: Object.freeze([[-1, 0], [0, 0], [1, 0], [0, 1]]),
  S: Object.freeze([[0, 0], [1, 0], [-1, 1], [0, 1]]),
  Z: Object.freeze([[-1, 0], [0, 0], [0, 1], [1, 1]]),
  J: Object.freeze([[-1, 0], [0, 0], [1, 0], [-1, 1]]),
  L: Object.freeze([[-1, 0], [0, 0], [1, 0], [1, 1]]),
});

// Horizontal nudges tried when a rotation would collide, in order. This is the
// simple wall-kick every falling-block game needs: without it, rotating flush
// against a wall or the stack silently fails and feels broken.
const WALL_KICK_OFFSETS = Object.freeze([0, -1, 1, -2, 2]);

/**
 * Shift / rotate / drop / lock control for a falling piece on a grid.
 *
 * Collision is delegated through `isBlocked(column, row)` -- pass
 * `BlockGridModel.isBlocked` bound to your grid, or any predicate. That keeps the
 * piece logic testable against a stub and lets the same controller drive boards
 * that are not a plain rectangle.
 *
 * The controller does not settle cells into the grid itself; it reports a LOCKED
 * action with the final cells, and the caller settles and clears rows. Locking is
 * the one step with scoring consequences, so it stays with the game, not here.
 */
export class FallingPieceController {
  constructor({
    columns = 10,
    rows = 20,
    isBlocked = null,
    shapes = TETROMINO_SHAPES,
    spawnColumn = null,
    spawnRow = null,
    dropIntervalSeconds = 0.8,
    softDropMultiplier = 8,
    lockDelaySeconds = 0,
    prng = DEFAULT_PRNG,
  } = {}) {
    if (isBlocked !== null && typeof isBlocked !== 'function') {
      throw new Error('FallingPieceController: isBlocked must be a function or null');
    }
    const names = Object.keys(shapes);
    if (names.length === 0) {
      throw new Error('FallingPieceController: shapes must contain at least one piece');
    }

    this.columns = Math.max(1, Math.floor(columns));
    this.rows = Math.max(1, Math.floor(rows));
    this.isBlockedFn = isBlocked;
    this.shapes = shapes;
    this.shapeNames = names;
    this.spawnColumn = spawnColumn === null ? Math.floor(this.columns / 2) - 1 : Math.floor(spawnColumn);
    this.spawnRow = spawnRow === null ? this.rows - 1 : Math.floor(spawnRow);
    this.dropIntervalSeconds = Math.max(1e-3, dropIntervalSeconds);
    this.softDropMultiplier = Math.max(1, softDropMultiplier);
    this.lockDelaySeconds = Math.max(0, lockDelaySeconds);
    this.prng = prng;

    this.shapeName = null;
    this.rotation = 0;
    this.column = this.spawnColumn;
    this.row = this.spawnRow;
    this.softDropping = false;
    this.dropTimer = 0;
    this.groundedTimer = 0;
    this.active = false;
    this.lockedCells = null;
  }

  /** Cell offsets for a shape at a rotation, rotated about its pivot. */
  shapeCells(shapeName, rotation) {
    const base = this.shapes[shapeName];
    if (!base) throw new Error(`FallingPieceController: unknown shape "${shapeName}"`);

    const steps = ((rotation % 4) + 4) % 4;
    return base.map(([x, y]) => {
      let cx = x;
      let cy = y;
      for (let i = 0; i < steps; i += 1) {
        // Quarter turn about the pivot: (x, y) -> (y, -x).
        const nx = cy;
        const ny = -cx;
        cx = nx;
        cy = ny;
      }
      return [cx, cy];
    });
  }

  /** Absolute cells the piece would occupy at a given placement. */
  cellsAt(column, row, rotation, shapeName = this.shapeName) {
    return this.shapeCells(shapeName, rotation).map(([dx, dy]) => ({
      column: column + dx,
      row: row + dy,
    }));
  }

  /** Absolute cells the piece occupies now. */
  cells() {
    if (!this.active) return [];
    return this.cellsAt(this.column, this.row, this.rotation);
  }

  _collides(column, row, rotation) {
    for (const cell of this.cellsAt(column, row, rotation)) {
      if (cell.column < 0 || cell.column >= this.columns) return true;
      if (cell.row < 0) return true;
      if (this.isBlockedFn && this.isBlockedFn(cell.column, cell.row)) return true;
    }
    return false;
  }

  /**
   * Spawn a piece. Returns SPAWNED, or TOPPED_OUT when the spawn placement is
   * already blocked -- the standard lose condition for the genre.
   */
  spawn(shapeName = null) {
    const name = shapeName ?? this.prng.choice(this.shapeNames);
    if (!this.shapes[name]) {
      throw new Error(`FallingPieceController: unknown shape "${name}"`);
    }

    this.shapeName = name;
    this.rotation = 0;
    this.column = this.spawnColumn;
    this.row = this.spawnRow;
    this.softDropping = false;
    this.dropTimer = 0;
    this.groundedTimer = 0;
    this.lockedCells = null;
    this.active = true;

    if (this._collides(this.column, this.row, this.rotation)) {
      this.active = false;
      return { action: PIECE_ACTIONS.TOPPED_OUT, shapeName: name, cells: [] };
    }
    return { action: PIECE_ACTIONS.SPAWNED, shapeName: name, cells: this.cells() };
  }

  /** Shift sideways by `delta` columns. */
  shift(delta = 1) {
    if (!this.active) return { action: PIECE_ACTIONS.BLOCKED, cells: [] };
    const step = Math.trunc(delta);
    if (step === 0) return { action: PIECE_ACTIONS.BLOCKED, cells: this.cells() };

    const target = this.column + step;
    if (this._collides(target, this.row, this.rotation)) {
      return { action: PIECE_ACTIONS.BLOCKED, cells: this.cells() };
    }
    this.column = target;
    // Touching down again resets the lock delay, so a piece slid along the floor
    // does not lock mid-slide.
    this.groundedTimer = 0;
    return { action: PIECE_ACTIONS.MOVED, cells: this.cells() };
  }

  /**
   * Rotate by a quarter turn, trying wall kicks when the rotation collides.
   * Returns ROTATED for a clean turn, KICKED when a nudge was needed, BLOCKED
   * when no offset fits.
   */
  rotate(direction = 1) {
    if (!this.active) return { action: PIECE_ACTIONS.BLOCKED, cells: [] };
    const step = direction >= 0 ? 1 : -1;
    const target = ((this.rotation + step) % 4 + 4) % 4;

    for (const offset of WALL_KICK_OFFSETS) {
      const column = this.column + offset;
      if (this._collides(column, this.row, target)) continue;
      this.column = column;
      this.rotation = target;
      this.groundedTimer = 0;
      return {
        action: offset === 0 ? PIECE_ACTIONS.ROTATED : PIECE_ACTIONS.KICKED,
        kickOffset: offset,
        cells: this.cells(),
      };
    }
    return { action: PIECE_ACTIONS.BLOCKED, cells: this.cells() };
  }

  /** Hold or release soft drop (accelerated fall). */
  setSoftDrop(active) {
    this.softDropping = Boolean(active);
    return this;
  }

  /** True when the piece is resting on the stack or the floor. */
  isGrounded() {
    if (!this.active) return false;
    return this._collides(this.column, this.row - 1, this.rotation);
  }

  /** Drop one row. Returns MOVED, or LOCKED when it cannot fall further. */
  stepDown() {
    if (!this.active) return { action: PIECE_ACTIONS.BLOCKED, cells: [] };
    if (!this._collides(this.column, this.row - 1, this.rotation)) {
      this.row -= 1;
      return { action: PIECE_ACTIONS.MOVED, cells: this.cells() };
    }
    return this._lock();
  }

  /** Drop to the floor and lock immediately. */
  hardDrop() {
    if (!this.active) return { action: PIECE_ACTIONS.BLOCKED, cells: [] };
    let dropped = 0;
    while (!this._collides(this.column, this.row - 1, this.rotation)) {
      this.row -= 1;
      dropped += 1;
    }
    const result = this._lock();
    result.droppedRows = dropped;
    return result;
  }

  _lock() {
    const cells = this.cells();
    this.lockedCells = cells;
    this.active = false;
    return { action: PIECE_ACTIONS.LOCKED, cells };
  }

  /**
   * Advance the gravity timer. Returns the action taken this frame, or null when
   * nothing happened -- so a caller can react only to real events.
   */
  step(deltaSeconds) {
    if (!this.active) return null;
    const delta = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);

    if (this.lockDelaySeconds > 0 && this.isGrounded()) {
      this.groundedTimer += delta;
      if (this.groundedTimer >= this.lockDelaySeconds) return this._lock();
      return null;
    }

    const interval = this.softDropping
      ? this.dropIntervalSeconds / this.softDropMultiplier
      : this.dropIntervalSeconds;

    this.dropTimer += delta;
    let last = null;
    // Catch up if a long frame covered several intervals, rather than dropping
    // only one row and drifting behind.
    while (this.dropTimer >= interval) {
      this.dropTimer -= interval;
      last = this.stepDown();
      if (last.action === PIECE_ACTIONS.LOCKED) break;
    }
    return last;
  }

  snapshot() {
    return {
      shapeName: this.shapeName,
      rotation: this.rotation,
      column: this.column,
      row: this.row,
      active: this.active,
      grounded: this.isGrounded(),
      softDropping: this.softDropping,
      cells: this.cells(),
      lockedCells: this.lockedCells,
    };
  }
}
