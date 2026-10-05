export const GRID_CELLS = Object.freeze({ OPEN: 'open', WALL: 'wall', BLOCK: 'block' });

const cloneCell = (cell) => ({ right: Math.floor(cell.right), forward: Math.floor(cell.forward) });
const cellKey = (cell) => `${cell.right},${cell.forward}`;

const CARDINAL = [
  { right: 0, forward: 1 },
  { right: 1, forward: 0 },
  { right: 0, forward: -1 },
  { right: -1, forward: 0 },
];

/**
 * Maze/bomber occupancy grid plus the cross-shaped blast a placed bomb produces.
 * `BlockGridModel` owns stacking games (settled cells, line clears); this owns the
 * maze grid of OPEN / WALL / destructible BLOCK cells and the blast that propagates
 * through BLOCK (breaking it) but stops at WALL.
 *
 * Cells are `{ right, forward }` in `0..columns-1` / `0..rows-1`, matching
 * `SnakeMotionController` and `BoardEnvironment`. Unset cells read as `defaultCell`,
 * so a sparse map never needs a full `columns * rows` allocation.
 */
export class GridBlastModel {
  constructor({ columns, rows, defaultCell = GRID_CELLS.OPEN }) {
    if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) {
      throw new Error('GridBlastModel: columns and rows must be positive integers');
    }
    this.columns = columns;
    this.rows = rows;
    this.defaultCell = defaultCell;
    this.cells = new Map();
  }

  inBounds(cell) {
    return cell.right >= 0 && cell.right < this.columns
      && cell.forward >= 0 && cell.forward < this.rows;
  }

  get(cell) {
    return this.cells.get(cellKey(cell)) ?? this.defaultCell;
  }

  set(cell, type) {
    if (!this.inBounds(cell)) throw new Error('GridBlastModel: cell out of bounds');
    this.cells.set(cellKey(cell), type);
    return type;
  }

  breakCell(cell) {
    if (this.get(cell) !== GRID_CELLS.BLOCK) return false;
    this.set(cell, GRID_CELLS.OPEN);
    return true;
  }

  /**
   * The cells a bomb at `origin` covers, in deterministic order: origin first, then
   * each cardinal arm out to `range`. A BLOCK cell is passed through (and is a
   * candidate for breaking); a WALL cell is included but stops its arm.
   */
  blastCells(origin, range) {
    const cells = [cloneCell(origin)];
    for (const direction of CARDINAL) {
      let cursor = cloneCell(origin);
      for (let i = 0; i < range; i += 1) {
        const next = { right: cursor.right + direction.right, forward: cursor.forward + direction.forward };
        if (!this.inBounds(next)) break;
        cells.push(cloneCell(next));
        if (this.get(next) === GRID_CELLS.WALL) break;
        cursor = next;
      }
    }
    return cells;
  }

  /** Apply a blast: break every BLOCK the blast covers, return the covered + broken sets. */
  applyBlast(origin, range) {
    const covered = this.blastCells(origin, range);
    const broken = [];
    for (const cell of covered) {
      if (this.breakCell(cell)) broken.push(cell);
    }
    return { covered, broken };
  }
}