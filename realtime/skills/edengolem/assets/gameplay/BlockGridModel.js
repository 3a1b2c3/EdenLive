/**
 * Occupancy grid for stacking games: set cells, find full rows, clear them,
 * detect top-out.
 *
 * Deliberately separate from `FallingPieceController`: the piece owns "where am I
 * and can I move", the grid owns "what is settled and what does that score". A
 * caller can drive this grid from something other than a tetromino, and the piece
 * controller can be tested against a stub collision predicate.
 *
 * Rows are indexed from the bottom (row 0 is the floor), matching how the board is
 * built upward in world space.
 */
export class BlockGridModel {
  constructor({
    columns = 10,
    rows = 20,
    topOutRows = 1,
  } = {}) {
    const safeColumns = Math.floor(columns);
    const safeRows = Math.floor(rows);
    if (!Number.isFinite(safeColumns) || safeColumns < 1) {
      throw new Error('BlockGridModel: columns must be an integer >= 1');
    }
    if (!Number.isFinite(safeRows) || safeRows < 1) {
      throw new Error('BlockGridModel: rows must be an integer >= 1');
    }

    this.columns = safeColumns;
    this.rows = safeRows;
    this.topOutRows = Math.max(1, Math.floor(topOutRows));

    // Flat array of null | value, indexed row-major from the bottom row.
    this.cells = new Array(safeColumns * safeRows).fill(null);
    this.clearedRowCount = 0;
  }

  _index(column, row) {
    return row * this.columns + column;
  }

  isInside(column, row) {
    return column >= 0 && column < this.columns && row >= 0 && row < this.rows;
  }

  /** True when the cell is outside the board or already filled. */
  isBlocked(column, row) {
    if (column < 0 || column >= this.columns) return true;
    if (row < 0) return true;
    // Above the board is not blocked: a piece may spawn or rotate partly above
    // the ceiling and still be legal, which is how tetromino spawning works.
    if (row >= this.rows) return false;
    return this.cells[this._index(column, row)] !== null;
  }

  isOccupied(column, row) {
    if (!this.isInside(column, row)) return false;
    return this.cells[this._index(column, row)] !== null;
  }

  valueAt(column, row) {
    if (!this.isInside(column, row)) return null;
    return this.cells[this._index(column, row)];
  }

  /** Fill one cell. Cells outside the board are ignored, not an error: a piece
   *  locking partly above the ceiling is a normal top-out, not a crash. */
  setCell(column, row, value = true) {
    if (!this.isInside(column, row)) return false;
    this.cells[this._index(column, row)] = value;
    return true;
  }

  /**
   * Settle a set of `{column, row}` cells into the grid. Returns how many landed
   * outside the board (which the caller reads as a top-out signal).
   */
  settleCells(cells, value = true) {
    let outside = 0;
    for (const cell of cells) {
      if (!this.setCell(cell.column, cell.row, value)) outside += 1;
    }
    return outside;
  }

  isRowFull(row) {
    if (!this.isInside(0, row)) return false;
    const base = row * this.columns;
    for (let column = 0; column < this.columns; column += 1) {
      if (this.cells[base + column] === null) return false;
    }
    return true;
  }

  /** Indices of every complete row, ascending. */
  fullRows() {
    const rows = [];
    for (let row = 0; row < this.rows; row += 1) {
      if (this.isRowFull(row)) rows.push(row);
    }
    return rows;
  }

  /**
   * Remove every full row and drop the rows above down into the gap. Returns the
   * removed row indices (as they were before clearing), so a caller can play one
   * effect per cleared line.
   *
   * Implemented as a compaction pass rather than repeated splices: clearing four
   * rows at once must not shift indices out from under the loop.
   */
  clearFullRows() {
    const cleared = this.fullRows();
    if (cleared.length === 0) return cleared;

    const removed = new Set(cleared);
    const kept = [];
    for (let row = 0; row < this.rows; row += 1) {
      if (removed.has(row)) continue;
      const base = row * this.columns;
      kept.push(this.cells.slice(base, base + this.columns));
    }
    while (kept.length < this.rows) {
      kept.push(new Array(this.columns).fill(null));
    }

    this.cells = kept.flat();
    this.clearedRowCount += cleared.length;
    return cleared;
  }

  /**
   * True when the stack has reached the top band. Check after settling a piece:
   * this is the lose condition for the genre.
   */
  isToppedOut() {
    for (let offset = 0; offset < this.topOutRows; offset += 1) {
      const row = this.rows - 1 - offset;
      if (row < 0) break;
      for (let column = 0; column < this.columns; column += 1) {
        if (this.cells[this._index(column, row)] !== null) return true;
      }
    }
    return false;
  }

  /** Height of the tallest occupied cell in a column, 0 when empty. */
  columnHeight(column) {
    if (column < 0 || column >= this.columns) return 0;
    for (let row = this.rows - 1; row >= 0; row -= 1) {
      if (this.cells[this._index(column, row)] !== null) return row + 1;
    }
    return 0;
  }

  /** Row-major rows from the bottom up, each a copy. For rendering or tests. */
  toRows() {
    const rows = [];
    for (let row = 0; row < this.rows; row += 1) {
      const base = row * this.columns;
      rows.push(this.cells.slice(base, base + this.columns));
    }
    return rows;
  }

  reset() {
    this.cells.fill(null);
    this.clearedRowCount = 0;
    return this;
  }
}
