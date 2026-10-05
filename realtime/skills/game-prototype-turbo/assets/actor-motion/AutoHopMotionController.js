import { Vector3 } from 'three';
import { DEFAULT_WORLD_BASIS } from '../math/WorldBasis.js';
import { clamp } from '../math/ScalarUtils.js';

/**
 * Continuous automatic hopping with mid-air horizontal steering.
 *
 * The vertical-climbing control model: the character re-jumps the instant it
 * lands, so the player never presses jump at all. Their only input is
 * horizontal steering, which stays live in mid-air -- that is the whole game, and
 * it is why a normal grounded controller cannot express it.
 *
 * Landing detection is delegated: the caller knows where its platforms are and
 * calls `noteLanding(platformUp)` when the character touches one, which triggers
 * the next hop. `bounceVelocity` can be overridden per landing so a spring pad or
 * a weak platform changes the arc without reconfiguring the controller.
 */
export class AutoHopMotionController {
  constructor({
    bounceVelocity = 12,
    gravity = 26,
    maxFallSpeed = 30,
    steerSpeed = 7,
    steerLag = 0.06,
    horizontalBound = null,
    wrapHorizontally = false,
    startUp = 0,
    startRight = 0,
    basis = DEFAULT_WORLD_BASIS,
  } = {}) {
    if (!Number.isFinite(bounceVelocity) || bounceVelocity <= 0) {
      throw new Error('AutoHopMotionController: bounceVelocity must be a finite number > 0');
    }
    if (!Number.isFinite(gravity) || gravity <= 0) {
      throw new Error('AutoHopMotionController: gravity must be a finite number > 0');
    }
    if (horizontalBound !== null && (!Number.isFinite(horizontalBound) || horizontalBound <= 0)) {
      throw new Error('AutoHopMotionController: horizontalBound must be a finite number > 0 or null');
    }

    this.bounceVelocity = bounceVelocity;
    this.gravity = gravity;
    this.maxFallSpeed = Math.abs(maxFallSpeed);
    this.steerSpeed = steerSpeed;
    this.steerLag = Math.max(0, steerLag);
    this.horizontalBound = horizontalBound;
    this.wrapHorizontally = Boolean(wrapHorizontally);
    this.startUp = startUp;
    this.startRight = startRight;
    this.basis = basis;

    this.rightOffset = startRight;
    this.upOffset = startUp;
    // Start rising, so a fresh run begins with a hop rather than a fall.
    this.verticalVelocity = bounceVelocity;
    this.horizontalVelocity = 0;
    this.steerInput = 0;
    this.hopCount = 0;
    this.highestUp = startUp;

    this.position = new Vector3();
    this._syncPosition();
  }

  /** Steering input in [-1, 1]; stays in effect until changed. */
  setSteer(input) {
    const value = Number.isFinite(input) ? input : 0;
    this.steerInput = clamp(value, -1, 1);
    return this;
  }

  get rising() {
    return this.verticalVelocity > 0;
  }

  /**
   * Report a landing, which starts the next hop. Pass `platformUp` to snap the
   * character onto the platform surface first, and `bounceVelocity` to override
   * the arc for this hop only (spring pads, crumbling platforms).
   *
   * Refused while rising: a platform overlap detected on the way up is the
   * character passing through it, not landing on it.
   */
  noteLanding(platformUp = null, bounceVelocity = this.bounceVelocity) {
    if (this.rising) return false;
    if (platformUp !== null && Number.isFinite(platformUp)) {
      this.upOffset = platformUp;
    }
    this.verticalVelocity = Math.abs(bounceVelocity);
    this.hopCount += 1;
    return true;
  }

  step(deltaSeconds) {
    const delta = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);

    // Horizontal: ease toward the requested velocity so steering has weight
    // rather than snapping the character sideways.
    const targetVelocity = this.steerInput * this.steerSpeed;
    if (this.steerLag <= 0) {
      this.horizontalVelocity = targetVelocity;
    } else {
      const alpha = 1 - Math.exp(-delta / this.steerLag);
      this.horizontalVelocity += (targetVelocity - this.horizontalVelocity) * alpha;
    }
    this.rightOffset += this.horizontalVelocity * delta;

    if (this.horizontalBound !== null) {
      const bound = this.horizontalBound;
      if (this.wrapHorizontally) {
        // Wrap around the arena: leaving the right edge re-enters on the left.
        const span = bound * 2;
        this.rightOffset = ((this.rightOffset + bound) % span + span) % span - bound;
      } else if (this.rightOffset < -bound || this.rightOffset > bound) {
        this.rightOffset = clamp(this.rightOffset, -bound, bound);
        this.horizontalVelocity = 0;
      }
    }

    this.verticalVelocity = Math.max(
      -this.maxFallSpeed,
      this.verticalVelocity - this.gravity * delta
    );
    this.upOffset += this.verticalVelocity * delta;
    this.highestUp = Math.max(this.highestUp, this.upOffset);

    this._syncPosition();
    return this.snapshot();
  }

  _syncPosition() {
    this.basis.fromBasisComponents(this.rightOffset, this.upOffset, 0, this.position);
  }

  snapshot() {
    return {
      position: this.position,
      rightOffset: this.rightOffset,
      upOffset: this.upOffset,
      verticalVelocity: this.verticalVelocity,
      horizontalVelocity: this.horizontalVelocity,
      rising: this.rising,
      hopCount: this.hopCount,
      highestUp: this.highestUp,
    };
  }

  reset({ right = this.startRight, up = this.startUp } = {}) {
    this.rightOffset = right;
    this.upOffset = up;
    this.verticalVelocity = this.bounceVelocity;
    this.horizontalVelocity = 0;
    this.steerInput = 0;
    this.hopCount = 0;
    this.highestUp = up;
    this._syncPosition();
    return this.snapshot();
  }
}
