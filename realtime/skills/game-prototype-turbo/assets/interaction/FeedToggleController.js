import { DEFAULT_CLOCK } from '../math/TimeUtils.js';

export const TOGGLE_RESULTS = Object.freeze({
  APPLIED: 'applied',
  QUEUED: 'queued',
  IGNORED: 'ignored',
});

function normalizeFeedCount(feedCount) {
  const count = Math.floor(feedCount);
  if (!Number.isFinite(count) || count < 1) {
    throw new Error('FeedToggleController: feedCount must be an integer >= 1');
  }
  return count;
}

function requireNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`FeedToggleController: ${label} must be a finite number >= 0`);
  }
  return value;
}

/**
 * Switches between camera feeds and drives a debounced door or power toggle.
 *
 * This is the surveillance-horror control scheme: the player flips through a bank
 * of cameras while slamming a door button, and the door has a mechanical cooldown.
 * The trap is dropping presses during that cooldown -- the player pressed the
 * button, saw nothing happen, and blames the game. Here a press inside the
 * cooldown is QUEUED and fires the moment the cooldown expires, so no input is
 * ever lost.
 *
 * Call step() once per frame to drain queued presses.
 */
export class FeedToggleController {
  constructor({
    feedCount,
    initialFeedIndex = 0,
    wrap = true,
    toggleCooldownMs = 250,
    initialToggleOn = false,
    powered = true,
    clock = DEFAULT_CLOCK,
  } = {}) {
    this.feedCount = normalizeFeedCount(feedCount);
    this.wrap = Boolean(wrap);
    this.toggleCooldownMs = requireNonNegative(toggleCooldownMs, 'toggleCooldownMs');
    this.clock = clock;

    const startIndex = Math.floor(initialFeedIndex) || 0;
    this.feedIndex = Math.min(Math.max(startIndex, 0), this.feedCount - 1);
    this.toggleOn = Boolean(initialToggleOn);
    this.powered = Boolean(powered);

    this.lastToggleAtMs = null;
    this.pendingToggle = false;
    this.toggleCount = 0;
    this.droppedToggleCount = 0;
  }

  /** Switch to an explicit feed index. Out-of-range indices are rejected. */
  select(index) {
    const target = Math.floor(index);
    if (!Number.isInteger(target) || target < 0 || target >= this.feedCount) {
      return { result: TOGGLE_RESULTS.IGNORED, feedIndex: this.feedIndex, changed: false };
    }
    if (!this.powered) {
      return { result: TOGGLE_RESULTS.IGNORED, feedIndex: this.feedIndex, changed: false };
    }
    const changed = target !== this.feedIndex;
    this.feedIndex = target;
    return { result: TOGGLE_RESULTS.APPLIED, feedIndex: this.feedIndex, changed };
  }

  /** Step the active feed by `delta`, honouring the wrap policy. */
  cycle(delta = 1) {
    const step = Math.trunc(delta);
    if (step === 0 || !this.powered) {
      return { result: TOGGLE_RESULTS.IGNORED, feedIndex: this.feedIndex, changed: false };
    }

    const raw = this.feedIndex + step;
    let target = raw;
    if (raw < 0 || raw >= this.feedCount) {
      if (!this.wrap) {
        target = Math.min(Math.max(raw, 0), this.feedCount - 1);
      } else {
        target = ((raw % this.feedCount) + this.feedCount) % this.feedCount;
      }
    }
    return this.select(target);
  }

  nextFeed() {
    return this.cycle(1);
  }

  previousFeed() {
    return this.cycle(-1);
  }

  /** Milliseconds until the toggle accepts a press again, 0 when ready. */
  toggleCooldownRemainingMs(now = this.clock.now()) {
    if (this.lastToggleAtMs === null) return 0;
    return Math.max(0, this.toggleCooldownMs - (now - this.lastToggleAtMs));
  }

  canToggle(now = this.clock.now()) {
    return this.powered && this.toggleCooldownRemainingMs(now) <= 0;
  }

  /**
   * Press the door/power toggle. APPLIED when it flips immediately, QUEUED when
   * the cooldown is still running (it will flip on the next step past the
   * cooldown), IGNORED only when unpowered.
   *
   * A press arriving while one is already queued is folded into that queued
   * press rather than dropped silently; droppedToggleCount records those so a
   * caller can surface a "jammed" cue.
   */
  toggle(now = this.clock.now()) {
    if (!this.powered) {
      return { result: TOGGLE_RESULTS.IGNORED, toggleOn: this.toggleOn, changed: false };
    }

    if (this.canToggle(now)) {
      this._applyToggle(now);
      return { result: TOGGLE_RESULTS.APPLIED, toggleOn: this.toggleOn, changed: true };
    }

    if (this.pendingToggle) this.droppedToggleCount += 1;
    this.pendingToggle = true;
    return { result: TOGGLE_RESULTS.QUEUED, toggleOn: this.toggleOn, changed: false };
  }

  _applyToggle(now) {
    this.toggleOn = !this.toggleOn;
    this.lastToggleAtMs = now;
    this.pendingToggle = false;
    this.toggleCount += 1;
  }

  /**
   * Release any queued press whose cooldown has expired. Call once per frame.
   * Returns true when a queued toggle fired on this step.
   */
  step(now = this.clock.now()) {
    if (!this.pendingToggle || !this.powered) return false;
    if (this.toggleCooldownRemainingMs(now) > 0) return false;
    this._applyToggle(now);
    return true;
  }

  /**
   * Cut or restore power. Losing power forces the toggle off and clears any
   * queued press, because the mechanism itself is dead.
   */
  setPowered(powered) {
    const next = Boolean(powered);
    if (next === this.powered) return this.snapshot();
    this.powered = next;
    if (!this.powered) {
      this.toggleOn = false;
      this.pendingToggle = false;
    }
    return this.snapshot();
  }

  snapshot() {
    return {
      feedIndex: this.feedIndex,
      feedCount: this.feedCount,
      toggleOn: this.toggleOn,
      powered: this.powered,
      pendingToggle: this.pendingToggle,
      toggleCount: this.toggleCount,
      droppedToggleCount: this.droppedToggleCount,
    };
  }

  reset() {
    this.feedIndex = 0;
    this.toggleOn = false;
    this.powered = true;
    this.lastToggleAtMs = null;
    this.pendingToggle = false;
    this.toggleCount = 0;
    this.droppedToggleCount = 0;
    return this.snapshot();
  }
}
