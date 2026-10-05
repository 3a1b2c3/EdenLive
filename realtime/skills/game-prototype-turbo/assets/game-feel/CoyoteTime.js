import { DEFAULT_CLOCK } from '../math/TimeUtils.js';

function requireNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`CoyoteTime: ${label} must be a finite number >= 0`);
  }
  return value;
}

/**
 * Keeps a jump legal for a short window after the character walks off a ledge.
 *
 * Players press jump a frame or two late at the lip of a platform. Without a
 * grace window that press is simply dropped and the game feels unresponsive
 * rather than difficult. Feed grounded state in every tick and ask before
 * jumping.
 *
 * The window is armed only by an actual grounded -> airborne transition, so a
 * character that starts a level airborne, or that is still rising from a jump,
 * gets no free extra jump.
 */
export class CoyoteTime {
  constructor({
    coyoteMs = 100,
    clock = DEFAULT_CLOCK,
  } = {}) {
    this.coyoteMs = requireNonNegative(coyoteMs, 'coyoteMs');
    this.clock = clock;

    this.grounded = false;
    this.leftGroundAtMs = null;
    this.jumpUsed = false;
  }

  /**
   * Record this tick's grounded state. Call once per update, before allowJump.
   * Returns true when the coyote window just opened.
   */
  noteGrounded(grounded, now = this.clock.now()) {
    const wasGrounded = this.grounded;
    this.grounded = Boolean(grounded);

    if (this.grounded) {
      // Landing clears the window and re-arms the jump.
      this.leftGroundAtMs = null;
      this.jumpUsed = false;
      return false;
    }

    if (wasGrounded && !this.jumpUsed) {
      this.leftGroundAtMs = now;
      return true;
    }

    if (wasGrounded) {
      // Left the ground because of a jump we already counted; no grace window.
      this.leftGroundAtMs = null;
    }
    return false;
  }

  /** Milliseconds of grace left, 0 once the window has closed. */
  remainingMs(now = this.clock.now()) {
    if (this.grounded) return this.coyoteMs;
    if (this.jumpUsed || this.leftGroundAtMs === null) return 0;
    return Math.max(0, this.coyoteMs - (now - this.leftGroundAtMs));
  }

  /** True while a jump should be accepted: grounded, or inside the grace window. */
  allowJump(now = this.clock.now()) {
    if (this.jumpUsed) return false;
    if (this.grounded) return true;
    if (this.leftGroundAtMs === null) return false;
    return now - this.leftGroundAtMs <= this.coyoteMs;
  }

  /**
   * Spend the jump. Returns true when the jump was legal, false when it was
   * rejected; a rejected call changes nothing, so callers can branch on it.
   */
  consumeJump(now = this.clock.now()) {
    if (!this.allowJump(now)) return false;
    this.jumpUsed = true;
    this.leftGroundAtMs = null;
    return true;
  }

  reset() {
    this.grounded = false;
    this.leftGroundAtMs = null;
    this.jumpUsed = false;
    return this;
  }
}
