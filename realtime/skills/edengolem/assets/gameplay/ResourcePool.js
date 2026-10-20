export const RESOURCE_DEPLETION_POLICIES = Object.freeze({
  // The pool hit zero and the round is over. The common case, and the default.
  END_ROUND: 'endRound',
  // The counter drops but the world carries on: a leaked enemy costs a life and
  // nothing else moves.
  DECREMENT_ONLY: 'decrementOnly',
  // Positions reset, progress survives: a caught player loses a life and everyone
  // returns to spawn, but what was already collected stays collected.
  PARTIAL_RESET: 'partialReset',
});

export const RESOURCE_EVENTS = Object.freeze({
  GAINED: 'resource.gained',
  SPENT: 'resource.spent',
  LOST: 'resource.lost',
  DEPLETED: 'resource.depleted',
  FILLED: 'resource.filled',
});

/**
 * One counter the round cares about: health, lives, stocks, score, a quota, or
 * currency.
 *
 * These look like six different systems and are one. Every countable the rules
 * consult behaves the same way -- it goes up, it goes down, and something happens
 * when it hits a bound. What differs is only who reads it and what "empty" means,
 * which is a policy rather than a code path:
 *
 *   health  depletes -> lose
 *   lives   depletes -> lose, but each loss may reset positions instead
 *   stocks  the same shape as lives, usually with a small count
 *   quota   FILLS -> win (the same counter read from the other end)
 *   score   sometimes decides the outcome, more often accumulates for feedback
 *   cash    spent on placements rather than compared
 *
 * That last row is why `spend` exists separately from `lose`: a pool that funds
 * placement is not a pool that takes damage, and conflating them makes "I was hit"
 * indistinguishable from "I bought something" in the event stream.
 *
 * Scoring is first-class here on purpose. Accumulating something is near-universal
 * even where it does not decide the outcome, and the accumulation logic is
 * identical whether the number is a win condition, an economy, or pure feedback.
 *
 * Headless and frame-rate independent: this owns no clock and no DOM.
 */
export class ResourcePool {
  constructor({
    id = 'resource',
    initial = 0,
    max = null,
    min = 0,
    depletionPolicy = RESOURCE_DEPLETION_POLICIES.END_ROUND,
    depleteAt = null,
    fillAt = null,
  } = {}) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('ResourcePool: id must be a non-empty string');
    }
    if (!Number.isFinite(initial)) {
      throw new Error(`ResourcePool ${id}: initial must be a finite number`);
    }
    if (!Number.isFinite(min)) {
      throw new Error(`ResourcePool ${id}: min must be a finite number`);
    }
    if (max !== null && (!Number.isFinite(max) || max < min)) {
      throw new Error(`ResourcePool ${id}: max must be a finite number >= min, or null`);
    }
    if (!Object.values(RESOURCE_DEPLETION_POLICIES).includes(depletionPolicy)) {
      throw new Error(`ResourcePool ${id}: unknown depletionPolicy "${depletionPolicy}"`);
    }

    this.id = id;
    this.initial = initial;
    this.max = max;
    this.min = min;
    this.depletionPolicy = depletionPolicy;
    // Depletion defaults to the floor, and filling to the ceiling when there is
    // one. A quota pool sets fillAt explicitly and leaves max null.
    this.depleteAt = depleteAt === null ? min : depleteAt;
    this.fillAt = fillAt === null ? max : fillAt;

    this.value = this._clamp(initial);
    this.totalGained = 0;
    this.totalLost = 0;
    this.totalSpent = 0;
    this.depletedCount = 0;
    this._events = [];
  }

  _clamp(value) {
    const lower = Math.max(this.min, value);
    return this.max === null ? lower : Math.min(this.max, lower);
  }

  _emit(type, amount, extra = {}) {
    this._events.push({ type, id: this.id, amount, value: this.value, ...extra });
  }

  get isDepleted() {
    return this.value <= this.depleteAt;
  }

  get isFilled() {
    return this.fillAt !== null && this.value >= this.fillAt;
  }

  /** Fraction between min and max, for a HUD bar. Null when unbounded. */
  get fraction() {
    if (this.max === null) return null;
    const span = this.max - this.min;
    return span <= 0 ? 1 : (this.value - this.min) / span;
  }

  /** Add to the pool: a pickup, a point, a cash drop, a quota tick. */
  gain(amount = 1) {
    const delta = Math.max(0, Number.isFinite(amount) ? amount : 0);
    if (delta === 0) return this.value;
    const before = this.value;
    this.value = this._clamp(this.value + delta);
    const applied = this.value - before;
    this.totalGained += applied;
    if (applied > 0) this._emit(RESOURCE_EVENTS.GAINED, applied);
    if (this.isFilled) this._emit(RESOURCE_EVENTS.FILLED, applied);
    return this.value;
  }

  /**
   * Take from the pool involuntarily: damage, a lost life, a leaked enemy.
   * Reports depletion, which is what the round director acts on.
   */
  lose(amount = 1) {
    const delta = Math.max(0, Number.isFinite(amount) ? amount : 0);
    if (delta === 0) return this.value;
    const wasDepleted = this.isDepleted;
    const before = this.value;
    this.value = this._clamp(this.value - delta);
    const applied = before - this.value;
    this.totalLost += applied;
    if (applied > 0) this._emit(RESOURCE_EVENTS.LOST, applied);
    // Only the crossing is an event. Losing again while already at zero must not
    // re-fire, or a director counting stocks would burn through them at once.
    if (this.isDepleted && !wasDepleted) {
      this.depletedCount += 1;
      this._emit(RESOURCE_EVENTS.DEPLETED, applied, { policy: this.depletionPolicy });
    }
    return this.value;
  }

  /** True when `amount` can be spent right now. */
  canSpend(amount = 1) {
    const delta = Math.max(0, Number.isFinite(amount) ? amount : 0);
    return this.value - delta >= this.min;
  }

  /**
   * Spend deliberately: buying a tower, using currency. Refused rather than
   * clamped when the pool cannot cover it -- a partial purchase is never what the
   * caller meant. Returns true when it went through.
   */
  spend(amount = 1) {
    const delta = Math.max(0, Number.isFinite(amount) ? amount : 0);
    if (!this.canSpend(delta)) return false;
    const wasDepleted = this.isDepleted;
    this.value = this._clamp(this.value - delta);
    this.totalSpent += delta;
    if (delta > 0) this._emit(RESOURCE_EVENTS.SPENT, delta);
    if (this.isDepleted && !wasDepleted) {
      this.depletedCount += 1;
      this._emit(RESOURCE_EVENTS.DEPLETED, delta, { policy: this.depletionPolicy });
    }
    return true;
  }

  /** Refund a spend (selling a tower). Same as gain, named for the intent. */
  refund(amount = 1) {
    return this.gain(amount);
  }

  /** Set the value directly, clamped. For a partial reset or a debug key. */
  set(value) {
    if (!Number.isFinite(value)) {
      throw new Error(`ResourcePool ${this.id}: set requires a finite number`);
    }
    this.value = this._clamp(value);
    return this.value;
  }

  /** Drain and return queued events. The director calls this once per step. */
  drainEvents() {
    const events = this._events;
    this._events = [];
    return events;
  }

  snapshot() {
    return {
      id: this.id,
      value: this.value,
      min: this.min,
      max: this.max,
      fraction: this.fraction,
      isDepleted: this.isDepleted,
      isFilled: this.isFilled,
      totalGained: this.totalGained,
      totalLost: this.totalLost,
      totalSpent: this.totalSpent,
      depletedCount: this.depletedCount,
      depletionPolicy: this.depletionPolicy,
    };
  }

  reset() {
    this.value = this._clamp(this.initial);
    this.totalGained = 0;
    this.totalLost = 0;
    this.totalSpent = 0;
    this.depletedCount = 0;
    this._events = [];
    return this;
  }
}
