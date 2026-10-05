import { stepSnakeCell } from './SnakeMotionController.js';

const cloneCell = (cell) => ({ right: Math.floor(cell.right), forward: Math.floor(cell.forward) });

/**
 * A single-cell grid token -- a push-block mover or a grid bomber -- as distinct from
 * a serpentine actor. `SnakeMotionController` is snake-shaped: `initialLength` is
 * clamped to >= 2, `move()` in cardinal mode refuses the 180-degree reverse, and
 * there is no "stay still". A player who must back away the way they came (dodge the
 * blast) or hold still (time the dodge) cannot be expressed by it, and a push-block
 * mover is one cell, four ways, reversible. This controller fills that gap.
 *
 * The step contract:
 *   - a held camera-relative direction `{ right, forward }` in {-1, 0, 1} is buffered
 *     and acted on at the next cell boundary, so a press between ticks is not dropped;
 *   - `canStand(next)` refuses a move -- the token never occupies a blocked cell, and
 *     the refusal is reported so a caller can show why (matches the grid rules in
 *     `grimoire/patterns/genre-controls.md`);
 *   - a zero direction is a lawful "stay";
 *   - `cell` updates to the destination IMMEDIATELY on commit (grid logic), while
 *     `position()` lerps `from -> to` for the visual layer.
 */
export class GridTokenMotionController {
  constructor({ startCell = { right: 0, forward: 0 }, canStand = () => true, moveSeconds = 0.18 }) {
    this.canStand = canStand;
    this.moveSeconds = Math.max(1e-3, moveSeconds);
    this.reset(startCell);
  }

  reset(cell = { right: 0, forward: 0 }) {
    this.cell = cloneCell(cell);
    this.from = this.cell;
    this.to = this.cell;
    this.progress = 1; // settled
    this.queued = null;
    this.lastRefusal = null;
    return this.cell;
  }

  step(deltaSeconds, dir = { right: 0, forward: 0 }) {
    this.lastRefusal = null;

    const right = dir.right ?? 0;
    const forward = dir.forward ?? 0;
    if (right !== 0 || forward !== 0) {
      this.queued = { right: Math.sign(right), forward: Math.sign(forward) };
    }

    this.progress += deltaSeconds / this.moveSeconds;
    const moved = this.progress >= 1 ? this._settleAndTryMove() : false;
    return this.snapshot(moved);
  }

  _settleAndTryMove() {
    this.progress = 1;
    this.cell = cloneCell(this.to);

    const want = this.queued;
    this.queued = null;
    if (!want) return false;

    const next = stepSnakeCell(this.cell, want);
    if (!this.canStand(next)) {
      this.lastRefusal = { reason: 'blocked', from: cloneCell(this.cell), to: cloneCell(next) };
      return false;
    }

    this.from = cloneCell(this.cell);
    this.to = cloneCell(next);
    this.cell = cloneCell(next);
    this.progress = 0;
    return true;
  }

  /** The interpolated drawing position between the last committed cell and the next. */
  position() {
    const t = Math.max(0, Math.min(1, this.progress));
    return {
      right: this.from.right + (this.to.right - this.from.right) * t,
      forward: this.from.forward + (this.to.forward - this.from.forward) * t,
    };
  }

  get heading() {
    return {
      right: Math.sign(this.to.right - this.from.right),
      forward: Math.sign(this.to.forward - this.from.forward),
    };
  }

  snapshot(moved = false) {
    return {
      moved,
      blocked: this.lastRefusal ? cloneCell(this.lastRefusal.to) : null,
      refusalReason: this.lastRefusal ? this.lastRefusal.reason : null,
      cell: cloneCell(this.cell),
      from: cloneCell(this.from),
      to: cloneCell(this.to),
      position: this.position(),
      progress: this.progress,
    };
  }
}