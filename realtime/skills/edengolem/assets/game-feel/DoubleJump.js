/**
 * The air-jump budget of a double/triple jump. `CoyoteTime` and `JumpBuffer` own the
 * FIRST jump (the late press off a ledge and the early press before landing); this
 * owns the extra jumps once airborne. The three compose -- see
 * `grimoire/patterns/player-controller.md` for the ordering that keeps a mid-air
 * press from re-arming the ground buffer.
 *
 * The invariant worth a module rather than a `let airJumps = 1` in the run: the
 * counter resets on the GROUNDED edge (never while airborne), and `consumeAirJump`
 * is refused once the budget is spent -- a spent double-jump press must not read as
 * a first-jump press into the buffer.
 */
export class DoubleJump {
  constructor({ maxAirJumps = 1 } = {}) {
    if (!Number.isInteger(maxAirJumps) || maxAirJumps < 0) {
      throw new Error('DoubleJump: maxAirJumps must be a non-negative integer');
    }
    this.maxAirJumps = maxAirJumps;
    this.airJumpsUsed = 0;
  }

  /** Feed the grounded state every tick; only a grounded frame re-arms the budget. */
  noteGrounded(grounded) {
    if (grounded) this.airJumpsUsed = 0;
  }

  canAirJump() {
    return this.airJumpsUsed < this.maxAirJumps;
  }

  consumeAirJump() {
    if (!this.canAirJump()) return false;
    this.airJumpsUsed += 1;
    return true;
  }

  get airJumpsLeft() {
    return this.maxAirJumps - this.airJumpsUsed;
  }
}