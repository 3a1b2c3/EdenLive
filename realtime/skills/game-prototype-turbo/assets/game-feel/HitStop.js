import { clamp } from '../math/ScalarUtils.js';

function requireNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`HitStop: ${label} must be a finite number >= 0`);
  }
  return value;
}

/**
 * Freezes gameplay time for a few dozen milliseconds when a hit lands, so the
 * impact reads as contact instead of the attacker sliding through the target.
 *
 * This never blocks the rAF loop. It only reports a time scale that gameplay
 * systems multiply their delta by, so rendering, camera shake and UI keep running
 * at full frame rate while simulation is held still.
 *
 * Typical use, once per frame:
 *
 *   hitStop.step(realDeltaSeconds);
 *   const gameplayDelta = realDeltaSeconds * hitStop.timeScale();
 *   world.step(gameplayDelta);
 *
 * and on a landed hit: hitStop.trigger(0.06).
 */
export class HitStop {
  constructor({
    defaultSeconds = 0.065,
    frozenTimeScale = 0,
    maxSeconds = 0.5,
  } = {}) {
    this.defaultSeconds = requireNonNegative(defaultSeconds, 'defaultSeconds');
    this.maxSeconds = requireNonNegative(maxSeconds, 'maxSeconds');
    if (!Number.isFinite(frozenTimeScale) || frozenTimeScale < 0 || frozenTimeScale > 1) {
      throw new Error('HitStop: frozenTimeScale must be a finite number in [0, 1]');
    }
    this.frozenTimeScale = frozenTimeScale;

    this.remainingSeconds = 0;
  }

  /**
   * Start a freeze. Overlapping hits take the longer of the two remaining
   * windows rather than summing, so a burst of hits cannot stall the game.
   */
  trigger(seconds = this.defaultSeconds) {
    const requested = clamp(
      Number.isFinite(seconds) ? seconds : this.defaultSeconds,
      0,
      this.maxSeconds
    );
    this.remainingSeconds = Math.max(this.remainingSeconds, requested);
    return this;
  }

  /** True while gameplay time is being held. */
  isFrozen() {
    return this.remainingSeconds > 0;
  }

  /** Multiply gameplay delta by this: frozenTimeScale while frozen, else 1. */
  timeScale() {
    return this.isFrozen() ? this.frozenTimeScale : 1;
  }

  /**
   * Advance the freeze by REAL elapsed time (not scaled time, or the freeze
   * would never end when frozenTimeScale is 0). Returns the resulting timeScale.
   */
  step(deltaSeconds) {
    const delta = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);
    if (this.remainingSeconds > 0) {
      this.remainingSeconds = Math.max(0, this.remainingSeconds - delta);
    }
    return this.timeScale();
  }

  /** Real delta scaled by the current time scale, for callers wanting one call. */
  scaleDelta(deltaSeconds) {
    const delta = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);
    return delta * this.timeScale();
  }

  clear() {
    this.remainingSeconds = 0;
    return this;
  }
}
