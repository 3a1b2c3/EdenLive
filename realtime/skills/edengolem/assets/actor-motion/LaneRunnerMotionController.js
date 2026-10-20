import { Vector3 } from 'three';
import { DEFAULT_WORLD_BASIS } from '../math/WorldBasis.js';
import { clamp, smoothToward } from '../math/ScalarUtils.js';

export const LANE_SHIFT_RESULTS = Object.freeze({
  MOVED: 'moved',
  BLOCKED: 'blocked',
  IGNORED: 'ignored',
});

/**
 * Auto-running locomotion across a fixed set of discrete lanes, with a jump and a
 * timed duck.
 *
 * This is the endless-running control model: forward speed is not the player's to
 * choose, so the only inputs are "which lane", "jump" and "duck". Lane changes
 * interpolate rather than teleport, because a snap reads as a rendering glitch
 * instead of a movement.
 *
 * Set `laneCount: 1` for a pure auto-runner (tap-to-jump platformer) -- the lane
 * machinery then costs nothing and the jump/duck behaviour is unchanged.
 *
 * The controller owns position, not collision: feed the resulting position to a
 * resolver or a simple bounds check. Compose `game-feel/CoyoteTime` and
 * `game-feel/JumpBuffer` on top rather than wiring grace windows in here.
 */
export class LaneRunnerMotionController {
  constructor({
    laneCount = 3,
    laneWidth = 2.2,
    startLane = null,
    forwardSpeed = 14,
    laneChangeLag = 0.08,
    jumpVelocity = 9,
    gravity = 26,
    maxFallSpeed = 40,
    duckDurationSeconds = 0.45,
    standingHeight = 1.8,
    duckHeight = 0.9,
    floorUp = 0,
    wrapLanes = false,
    basis = DEFAULT_WORLD_BASIS,
  } = {}) {
    const lanes = Math.floor(laneCount);
    if (!Number.isFinite(lanes) || lanes < 1) {
      throw new Error('LaneRunnerMotionController: laneCount must be an integer >= 1');
    }
    if (!Number.isFinite(laneWidth) || laneWidth <= 0) {
      throw new Error('LaneRunnerMotionController: laneWidth must be a finite number > 0');
    }
    if (!Number.isFinite(duckHeight) || duckHeight <= 0 || duckHeight > standingHeight) {
      throw new Error('LaneRunnerMotionController: duckHeight must be > 0 and <= standingHeight');
    }

    this.laneCount = lanes;
    this.laneWidth = laneWidth;
    this.forwardSpeed = forwardSpeed;
    this.laneChangeLag = Math.max(0, laneChangeLag);
    this.jumpVelocity = jumpVelocity;
    this.gravity = gravity;
    this.maxFallSpeed = Math.abs(maxFallSpeed);
    this.duckDurationSeconds = Math.max(0, duckDurationSeconds);
    this.standingHeight = standingHeight;
    this.duckHeight = duckHeight;
    this.floorUp = floorUp;
    this.wrapLanes = Boolean(wrapLanes);
    this.basis = basis;

    // Middle lane by default; with an even lane count this picks the lower middle.
    const middle = Math.floor((this.laneCount - 1) / 2);
    const requested = startLane === null ? middle : Math.floor(startLane);
    this.laneIndex = clamp(requested, 0, this.laneCount - 1);
    this.targetLaneIndex = this.laneIndex;

    this.lateralOffset = this.laneOffset(this.laneIndex);
    this.upOffset = floorUp;
    this.verticalVelocity = 0;
    this.grounded = true;
    this.duckRemainingSeconds = 0;
    this.distance = 0;

    this.position = new Vector3();
    this._syncPosition();
  }

  /** Lateral offset of a lane centre, measured on the basis `right` axis. */
  laneOffset(laneIndex) {
    return (laneIndex - (this.laneCount - 1) * 0.5) * this.laneWidth;
  }

  get ducking() {
    return this.duckRemainingSeconds > 0;
  }

  /** Height of the character's collider right now: shorter while ducking. */
  get colliderHeight() {
    return this.ducking ? this.duckHeight : this.standingHeight;
  }

  /** True once the lateral position has essentially settled on the target lane. */
  get settled() {
    return Math.abs(this.lateralOffset - this.laneOffset(this.targetLaneIndex)) < 1e-3;
  }

  /**
   * Step the target lane by `delta` lanes (-1 = left, +1 = right). Returns a
   * LANE_SHIFT_RESULTS: BLOCKED at an edge when wrapping is off, IGNORED for a
   * zero step. The lateral move then interpolates over the next few frames.
   */
  requestLane(delta = 1) {
    const step = Math.trunc(delta);
    if (step === 0) return LANE_SHIFT_RESULTS.IGNORED;

    const raw = this.targetLaneIndex + step;
    if (raw < 0 || raw > this.laneCount - 1) {
      if (!this.wrapLanes) return LANE_SHIFT_RESULTS.BLOCKED;
      this.targetLaneIndex = ((raw % this.laneCount) + this.laneCount) % this.laneCount;
      return LANE_SHIFT_RESULTS.MOVED;
    }

    this.targetLaneIndex = raw;
    return LANE_SHIFT_RESULTS.MOVED;
  }

  /** Jump to an explicit lane index. Rejected when out of range. */
  setLane(laneIndex) {
    const target = Math.floor(laneIndex);
    if (!Number.isInteger(target) || target < 0 || target >= this.laneCount) {
      return LANE_SHIFT_RESULTS.BLOCKED;
    }
    if (target === this.targetLaneIndex) return LANE_SHIFT_RESULTS.IGNORED;
    this.targetLaneIndex = target;
    return LANE_SHIFT_RESULTS.MOVED;
  }

  /**
   * Jump. Only legal while grounded, so holding the key cannot fly. Ducking is
   * cancelled by a jump rather than blocking it -- the player pressing jump wants
   * to leave the ground, not to be told they are still crouched.
   */
  requestJump() {
    if (!this.grounded) return false;
    this.duckRemainingSeconds = 0;
    this.verticalVelocity = this.jumpVelocity;
    this.grounded = false;
    return true;
  }

  /**
   * Duck for `duckDurationSeconds`. Re-pressing refreshes the window instead of
   * stacking. Airborne presses are refused: a duck that starts mid-air would
   * shrink the collider where the player cannot see the consequence.
   */
  requestDuck() {
    if (!this.grounded) return false;
    this.duckRemainingSeconds = this.duckDurationSeconds;
    return true;
  }

  /** Cancel an active duck early (key released). */
  releaseDuck() {
    this.duckRemainingSeconds = 0;
    return this;
  }

  /**
   * Advance one frame. Returns the state snapshot; the caller applies
   * `position` to its visual and collider.
   */
  step(deltaSeconds) {
    const delta = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);

    this.distance += this.forwardSpeed * delta;

    // Lateral: ease toward the target lane centre, then commit the lane index
    // once we have arrived so callers can test "which lane am I in" reliably.
    const targetOffset = this.laneOffset(this.targetLaneIndex);
    this.lateralOffset = this.laneChangeLag <= 0
      ? targetOffset
      : smoothToward(this.lateralOffset, targetOffset, this.laneChangeLag, delta);
    if (Math.abs(this.lateralOffset - targetOffset) < 1e-3) {
      this.lateralOffset = targetOffset;
      this.laneIndex = this.targetLaneIndex;
    }

    // Vertical: integrate gravity, then land on the floor plane.
    if (!this.grounded) {
      this.verticalVelocity = Math.max(
        -this.maxFallSpeed,
        this.verticalVelocity - this.gravity * delta
      );
      this.upOffset += this.verticalVelocity * delta;
      if (this.upOffset <= this.floorUp) {
        this.upOffset = this.floorUp;
        this.verticalVelocity = 0;
        this.grounded = true;
      }
    }

    if (this.duckRemainingSeconds > 0) {
      this.duckRemainingSeconds = Math.max(0, this.duckRemainingSeconds - delta);
    }

    this._syncPosition();
    return this.snapshot();
  }

  _syncPosition() {
    this.basis.fromBasisComponents(
      this.lateralOffset,
      this.upOffset,
      this.distance,
      this.position
    );
  }

  snapshot() {
    return {
      position: this.position,
      laneIndex: this.laneIndex,
      targetLaneIndex: this.targetLaneIndex,
      lateralOffset: this.lateralOffset,
      distance: this.distance,
      upOffset: this.upOffset,
      verticalVelocity: this.verticalVelocity,
      grounded: this.grounded,
      ducking: this.ducking,
      colliderHeight: this.colliderHeight,
      settled: this.settled,
    };
  }

  reset({ lane = null, distance = 0 } = {}) {
    const middle = Math.floor((this.laneCount - 1) / 2);
    this.laneIndex = clamp(lane === null ? middle : Math.floor(lane), 0, this.laneCount - 1);
    this.targetLaneIndex = this.laneIndex;
    this.lateralOffset = this.laneOffset(this.laneIndex);
    this.upOffset = this.floorUp;
    this.verticalVelocity = 0;
    this.grounded = true;
    this.duckRemainingSeconds = 0;
    this.distance = distance;
    this._syncPosition();
    return this.snapshot();
  }
}
