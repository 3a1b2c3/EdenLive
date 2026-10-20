import { DEFAULT_CLOCK } from '../math/TimeUtils.js';

function requireNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`JumpBuffer: ${label} must be a finite number >= 0`);
  }
  return value;
}

/**
 * Remembers a jump pressed slightly before landing and fires it on touchdown.
 *
 * The mirror image of coyote time: a player descending toward the ground presses
 * jump a few frames early, the character is still airborne, and the input is
 * discarded. Buffering it means the jump comes out the instant they land, which
 * is what the player believes they asked for.
 *
 * Pair with CoyoteTime: this one covers early presses, that one covers late ones.
 */
export class JumpBuffer {
  constructor({
    bufferMs = 100,
    clock = DEFAULT_CLOCK,
  } = {}) {
    this.bufferMs = requireNonNegative(bufferMs, 'bufferMs');
    this.clock = clock;

    this.pressedAtMs = null;
  }

  /** Record a jump press. A newer press replaces an older unconsumed one. */
  queueJump(now = this.clock.now()) {
    this.pressedAtMs = now;
    return this;
  }

  /** True when a press is buffered and still fresh, without consuming it. */
  hasBufferedJump(now = this.clock.now()) {
    if (this.pressedAtMs === null) return false;
    if (now - this.pressedAtMs > this.bufferMs) {
      // Stale press: drop it so it cannot fire after an unrelated later landing.
      this.pressedAtMs = null;
      return false;
    }
    return true;
  }

  /** Milliseconds the buffered press stays valid, 0 when nothing is buffered. */
  remainingMs(now = this.clock.now()) {
    if (!this.hasBufferedJump(now)) return 0;
    return Math.max(0, this.bufferMs - (now - this.pressedAtMs));
  }

  /**
   * Consume the buffered press. Call on the frame the character lands: returns
   * true exactly once per press, false when nothing fresh is buffered.
   */
  takeBufferedJump(now = this.clock.now()) {
    if (!this.hasBufferedJump(now)) return false;
    this.pressedAtMs = null;
    return true;
  }

  clear() {
    this.pressedAtMs = null;
    return this;
  }
}
