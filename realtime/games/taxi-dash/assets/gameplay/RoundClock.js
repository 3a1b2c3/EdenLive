export const CLOCK_EXPIRY_MEANINGS = Object.freeze({
  // Running out is a loss: finish before the timer does. The common case.
  LOSE: 'lose',
  // Surviving to zero is the win: hold out until the shift ends.
  WIN: 'win',
  // The clock only reports; something else decides. Use for a stopwatch.
  NEUTRAL: 'neutral',
});

export const CLOCK_EVENTS = Object.freeze({
  STARTED: 'clock.started',
  EXPIRED: 'clock.expired',
  WARNING: 'clock.warning',
});

/**
 * The round timer, with the one knob that stops it being two modules.
 *
 * The same countdown means opposite things depending on the game: in a race or a
 * timed service shift, running out is the loss; in a survival round, reaching zero
 * IS the win. That is a polarity (`expiryMeaning`), not a second implementation --
 * writing two timers would duplicate the whole thing to flip one boolean.
 *
 * `maxRoundSeconds` bounds this gameplay clock, defaulting to 180.
 * Configure it explicitly for longer game clocks. Validation allowance comes
 * from the brief independently; untimed games need no RoundClock.
 *
 * Time comes from the caller as a delta. The clock owns no `Date.now()`, which is
 * what makes a replay reproducible: feed the same delta sequence and get the same
 * expiry frame.
 */
export const GATE_MAX_ROUND_SECONDS = 180;

export class RoundClock {
  constructor({
    limitSeconds = 120,
    expiryMeaning = CLOCK_EXPIRY_MEANINGS.LOSE,
    warningSeconds = 10,
    countUp = false,
    maxRoundSeconds = GATE_MAX_ROUND_SECONDS,
  } = {}) {
    if (!Number.isFinite(limitSeconds) || limitSeconds <= 0) {
      throw new Error('RoundClock: limitSeconds must be a finite number > 0');
    }
    if (limitSeconds > maxRoundSeconds) {
      throw new Error(
        `RoundClock: limitSeconds ${limitSeconds} exceeds the configured clock cap of ` +
        `${maxRoundSeconds}s. Set maxRoundSeconds to the intended gameplay limit.`
      );
    }
    if (!Object.values(CLOCK_EXPIRY_MEANINGS).includes(expiryMeaning)) {
      throw new Error(`RoundClock: unknown expiryMeaning "${expiryMeaning}"`);
    }
    if (!Number.isFinite(warningSeconds) || warningSeconds < 0) {
      throw new Error('RoundClock: warningSeconds must be a finite number >= 0');
    }

    this.limitSeconds = limitSeconds;
    this.expiryMeaning = expiryMeaning;
    this.warningSeconds = warningSeconds;
    this.countUp = Boolean(countUp);

    this.elapsedSeconds = 0;
    this.running = false;
    this.expired = false;
    this._warned = false;
    this._events = [];
  }

  get remainingSeconds() {
    return Math.max(0, this.limitSeconds - this.elapsedSeconds);
  }

  /** What a HUD should show: counts down by default, up for a stopwatch. */
  get displaySeconds() {
    return this.countUp ? this.elapsedSeconds : this.remainingSeconds;
  }

  get fraction() {
    return this.limitSeconds <= 0 ? 1 : this.remainingSeconds / this.limitSeconds;
  }

  /** True when expiry means the player won (survival games). */
  get expiryIsWin() {
    return this.expiryMeaning === CLOCK_EXPIRY_MEANINGS.WIN;
  }

  start() {
    this.running = true;
    this._events.push({ type: CLOCK_EVENTS.STARTED, limitSeconds: this.limitSeconds });
    return this;
  }

  pause() {
    this.running = false;
    return this;
  }

  /**
   * Advance by real elapsed seconds. Returns the event list for this step; a
   * caller that only wants the expiry can read `expired`.
   *
   * Expiry fires exactly once. Re-firing would let a director declare the same
   * outcome on every subsequent frame, which is the bug the stage-2 gate checks
   * for by asserting a single terminal event.
   */
  step(deltaSeconds) {
    const delta = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);
    if (!this.running || this.expired) return this.drainEvents();

    this.elapsedSeconds += delta;

    if (!this._warned && this.warningSeconds > 0 && this.remainingSeconds <= this.warningSeconds) {
      this._warned = true;
      this._events.push({
        type: CLOCK_EVENTS.WARNING,
        remainingSeconds: this.remainingSeconds,
      });
    }

    if (this.elapsedSeconds >= this.limitSeconds) {
      this.elapsedSeconds = this.limitSeconds;
      this.expired = true;
      this.running = false;
      this._events.push({
        type: CLOCK_EVENTS.EXPIRED,
        meaning: this.expiryMeaning,
        isWin: this.expiryIsWin,
      });
    }
    return this.drainEvents();
  }

  drainEvents() {
    const events = this._events;
    this._events = [];
    return events;
  }

  snapshot() {
    return {
      elapsedSeconds: this.elapsedSeconds,
      remainingSeconds: this.remainingSeconds,
      displaySeconds: this.displaySeconds,
      limitSeconds: this.limitSeconds,
      fraction: this.fraction,
      running: this.running,
      expired: this.expired,
      expiryMeaning: this.expiryMeaning,
    };
  }

  reset() {
    this.elapsedSeconds = 0;
    this.running = false;
    this.expired = false;
    this._warned = false;
    this._events = [];
    return this;
  }
}
