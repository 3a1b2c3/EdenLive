import { clamp } from '../math/ScalarUtils.js';

export const MENU_SELECTION_STATES = Object.freeze({
  BROWSING: 'browsing',
  COMMITTED: 'committed',
  CANCELLED: 'cancelled',
});

export const MENU_TRANSITIONS = Object.freeze({
  MOVED: 'moved',
  BLOCKED: 'blocked',
  SKIPPED: 'skipped',
  COMMITTED: 'committed',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  REOPENED: 'reopened',
  IGNORED: 'ignored',
});

function normalizeOptionCount(optionCount) {
  const count = Math.floor(optionCount);
  if (!Number.isFinite(count) || count < 1) {
    throw new Error('MenuSelectionController: optionCount must be an integer >= 1');
  }
  return count;
}

/**
 * A selection state machine over a fixed list of menu options.
 *
 * Menus look trivial until a disabled entry, a wrapping edge and a commit land on
 * the same frame; then a hand-rolled index gets stuck on a disabled row or reads
 * past the end. This keeps one index plus one state, and every call returns a
 * result naming the transition it took, so nothing silently does nothing.
 *
 * There is no terminal state: after commit() or cancel() the menu is closed but
 * reopen() always returns it to browsing.
 */
export class MenuSelectionController {
  constructor({
    optionCount,
    initialIndex = 0,
    wrap = true,
    isOptionEnabled = null,
  } = {}) {
    if (isOptionEnabled !== null && typeof isOptionEnabled !== 'function') {
      throw new Error('MenuSelectionController: isOptionEnabled must be a function or null');
    }

    this.optionCount = normalizeOptionCount(optionCount);
    this.wrap = Boolean(wrap);
    this.isOptionEnabled = isOptionEnabled;
    this.initialIndex = clamp(Math.floor(initialIndex) || 0, 0, this.optionCount - 1);

    this.index = this.initialIndex;
    this.state = MENU_SELECTION_STATES.BROWSING;
    this.committedIndex = null;

    // If the starting row is disabled, step onto the first enabled one so the
    // menu never opens with an unselectable highlight.
    if (!this._enabled(this.index)) {
      const firstEnabled = this._findEnabled(this.index, 1, true);
      if (firstEnabled !== null) this.index = firstEnabled;
    }
  }

  _enabled(index) {
    if (!this.isOptionEnabled) return true;
    return Boolean(this.isOptionEnabled(index));
  }

  /** True when at least one option can be selected. */
  hasEnabledOption() {
    for (let i = 0; i < this.optionCount; i += 1) {
      if (this._enabled(i)) return true;
    }
    return false;
  }

  /**
   * First enabled index starting from `from` and stepping by `step`. Scans at
   * most optionCount slots, so a fully disabled menu terminates instead of
   * looping forever. Returns null when nothing is selectable.
   */
  _findEnabled(from, step, includeStart = false) {
    let index = from;
    if (!includeStart) {
      index = this._advance(index, step);
      if (index === null) return null;
    }

    for (let guard = 0; guard < this.optionCount; guard += 1) {
      if (this._enabled(index)) return index;
      const next = this._advance(index, step);
      if (next === null) return null;
      index = next;
    }
    return null;
  }

  /** One step with the wrap policy applied; null when it would leave the list. */
  _advance(index, step) {
    const raw = index + step;
    if (raw >= 0 && raw < this.optionCount) return raw;
    if (!this.wrap) return null;
    return ((raw % this.optionCount) + this.optionCount) % this.optionCount;
  }

  _result(transition, changed) {
    return {
      transition,
      changed,
      index: this.index,
      state: this.state,
      committedIndex: this.committedIndex,
    };
  }

  /**
   * Move the highlight by `delta` rows, skipping disabled options.
   * Returns MOVED when the index changed, SKIPPED when the only reachable
   * option was the current one, BLOCKED at a hard edge with wrap off, and
   * IGNORED when the menu is closed.
   */
  move(delta = 1) {
    if (this.state !== MENU_SELECTION_STATES.BROWSING) {
      return this._result(MENU_TRANSITIONS.IGNORED, false);
    }

    const step = Math.trunc(delta);
    if (step === 0) return this._result(MENU_TRANSITIONS.SKIPPED, false);

    const direction = step > 0 ? 1 : -1;
    const magnitude = Math.abs(step);
    let index = this.index;
    let moved = false;

    for (let i = 0; i < magnitude; i += 1) {
      const next = this._findEnabled(index, direction, false);
      if (next === null) break;
      index = next;
      moved = true;
    }

    if (!moved) {
      // Distinguish "nowhere to go" from "the only enabled row is this one".
      const anywhere = this._findEnabled(this.index, direction, false);
      return this._result(
        anywhere === null ? MENU_TRANSITIONS.BLOCKED : MENU_TRANSITIONS.SKIPPED,
        false
      );
    }

    if (index === this.index) return this._result(MENU_TRANSITIONS.SKIPPED, false);

    this.index = index;
    return this._result(MENU_TRANSITIONS.MOVED, true);
  }

  moveNext() {
    return this.move(1);
  }

  movePrevious() {
    return this.move(-1);
  }

  /** Jump straight to an index. Rejected when out of range or disabled. */
  focus(index) {
    if (this.state !== MENU_SELECTION_STATES.BROWSING) {
      return this._result(MENU_TRANSITIONS.IGNORED, false);
    }
    const target = Math.floor(index);
    if (!Number.isInteger(target) || target < 0 || target >= this.optionCount) {
      return this._result(MENU_TRANSITIONS.BLOCKED, false);
    }
    if (!this._enabled(target)) return this._result(MENU_TRANSITIONS.REJECTED, false);
    if (target === this.index) return this._result(MENU_TRANSITIONS.SKIPPED, false);

    this.index = target;
    return this._result(MENU_TRANSITIONS.MOVED, true);
  }

  /**
   * Confirm the highlighted option. COMMITTED on success, REJECTED when the
   * option is disabled, IGNORED when the menu is already closed.
   */
  commit() {
    if (this.state !== MENU_SELECTION_STATES.BROWSING) {
      return this._result(MENU_TRANSITIONS.IGNORED, false);
    }
    if (!this._enabled(this.index)) {
      return this._result(MENU_TRANSITIONS.REJECTED, false);
    }

    this.state = MENU_SELECTION_STATES.COMMITTED;
    this.committedIndex = this.index;
    return this._result(MENU_TRANSITIONS.COMMITTED, true);
  }

  /** Back out of the menu. IGNORED when it is already closed. */
  cancel() {
    if (this.state !== MENU_SELECTION_STATES.BROWSING) {
      return this._result(MENU_TRANSITIONS.IGNORED, false);
    }
    this.state = MENU_SELECTION_STATES.CANCELLED;
    this.committedIndex = null;
    return this._result(MENU_TRANSITIONS.CANCELLED, true);
  }

  /** Return a closed menu to browsing, keeping the highlight where it was. */
  reopen() {
    if (this.state === MENU_SELECTION_STATES.BROWSING) {
      return this._result(MENU_TRANSITIONS.IGNORED, false);
    }
    this.state = MENU_SELECTION_STATES.BROWSING;
    this.committedIndex = null;
    return this._result(MENU_TRANSITIONS.REOPENED, true);
  }

  isBrowsing() {
    return this.state === MENU_SELECTION_STATES.BROWSING;
  }

  isClosed() {
    return this.state !== MENU_SELECTION_STATES.BROWSING;
  }

  /** Back to construction state: initial index, browsing, nothing committed. */
  reset() {
    this.index = this.initialIndex;
    this.state = MENU_SELECTION_STATES.BROWSING;
    this.committedIndex = null;
    if (!this._enabled(this.index)) {
      const firstEnabled = this._findEnabled(this.index, 1, true);
      if (firstEnabled !== null) this.index = firstEnabled;
    }
    return this._result(MENU_TRANSITIONS.REOPENED, true);
  }

  snapshot() {
    return {
      index: this.index,
      state: this.state,
      committedIndex: this.committedIndex,
      optionCount: this.optionCount,
      wrap: this.wrap,
    };
  }
}
