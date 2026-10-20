import { Vector3 } from 'three';
import { DEFAULT_WORLD_BASIS } from '../math/WorldBasis.js';
import { clamp } from '../math/ScalarUtils.js';

/**
 * Impulse-driven flight: gravity pulls down constantly and each flap sets an
 * upward velocity, while forward speed runs on its own.
 *
 * The flappy-bird control model. Two details make or break the feel and are the
 * reason this is a module rather than four lines in an update loop:
 *
 * - A flap *sets* vertical velocity rather than adding to it, so mashing cannot
 *   accumulate into an escape to the ceiling. Every flap from any state produces
 *   the same recognisable arc.
 * - A minimum interval between flaps, so a held key or an autoclicker cannot
 *   hover the bird in place.
 *
 * The visual tilt (`pitch`) is derived from vertical velocity so the caller does
 * not reimplement it: nose up while rising, nose down while falling.
 */
export class FlapFlightMotionController {
  constructor({
    flapVelocity = 6.2,
    gravity = 18,
    maxFallSpeed = 14,
    maxRiseSpeed = 8,
    forwardSpeed = 7,
    minFlapIntervalSeconds = 0.09,
    ceilingUp = null,
    floorUp = null,
    startUp = 0,
    maxPitchRadians = 0.9,
    pitchPerVelocity = 0.09,
    basis = DEFAULT_WORLD_BASIS,
  } = {}) {
    if (!Number.isFinite(flapVelocity) || flapVelocity <= 0) {
      throw new Error('FlapFlightMotionController: flapVelocity must be a finite number > 0');
    }
    if (!Number.isFinite(gravity) || gravity <= 0) {
      throw new Error('FlapFlightMotionController: gravity must be a finite number > 0');
    }
    if (ceilingUp !== null && floorUp !== null && ceilingUp <= floorUp) {
      throw new Error('FlapFlightMotionController: ceilingUp must be above floorUp');
    }

    this.flapVelocity = flapVelocity;
    this.gravity = gravity;
    this.maxFallSpeed = Math.abs(maxFallSpeed);
    this.maxRiseSpeed = Math.abs(maxRiseSpeed);
    this.forwardSpeed = forwardSpeed;
    this.minFlapIntervalSeconds = Math.max(0, minFlapIntervalSeconds);
    this.ceilingUp = ceilingUp;
    this.floorUp = floorUp;
    this.startUp = startUp;
    this.maxPitchRadians = Math.abs(maxPitchRadians);
    this.pitchPerVelocity = pitchPerVelocity;
    this.basis = basis;

    this.upOffset = startUp;
    this.verticalVelocity = 0;
    this.distance = 0;
    this.sinceFlapSeconds = Number.POSITIVE_INFINITY;
    this.flapCount = 0;
    this.crashed = false;
    this.crashReason = null;

    this.position = new Vector3();
    this._syncPosition();
  }

  /** True when another flap would be accepted right now. */
  canFlap() {
    return !this.crashed && this.sinceFlapSeconds >= this.minFlapIntervalSeconds;
  }

  /**
   * Flap. Returns true when the impulse was applied, false when it was refused
   * (too soon after the last flap, or already crashed).
   */
  flap() {
    if (!this.canFlap()) return false;
    // Set, never accumulate: this is what keeps the arc constant under mashing.
    this.verticalVelocity = this.flapVelocity;
    this.sinceFlapSeconds = 0;
    this.flapCount += 1;
    return true;
  }

  /** Nose angle in radians, derived from vertical velocity for the visual. */
  get pitch() {
    return clamp(
      this.verticalVelocity * this.pitchPerVelocity,
      -this.maxPitchRadians,
      this.maxPitchRadians
    );
  }

  /**
   * Advance one frame. Once `crashed` is set the controller freezes: the caller
   * decides whether that ends the run, and `reset()` clears it.
   */
  step(deltaSeconds) {
    const delta = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);
    if (this.crashed) return this.snapshot();

    this.sinceFlapSeconds += delta;
    this.verticalVelocity = clamp(
      this.verticalVelocity - this.gravity * delta,
      -this.maxFallSpeed,
      this.maxRiseSpeed
    );
    this.upOffset += this.verticalVelocity * delta;
    this.distance += this.forwardSpeed * delta;

    if (this.floorUp !== null && this.upOffset <= this.floorUp) {
      this.upOffset = this.floorUp;
      this.verticalVelocity = 0;
      this.crashed = true;
      this.crashReason = 'floor';
    } else if (this.ceilingUp !== null && this.upOffset >= this.ceilingUp) {
      // Clamp at the ceiling rather than crashing: in this genre the sky is a
      // limit, while the ground is a loss. Callers wanting a fatal ceiling can
      // read upOffset and decide.
      this.upOffset = this.ceilingUp;
      this.verticalVelocity = Math.min(this.verticalVelocity, 0);
    }

    this._syncPosition();
    return this.snapshot();
  }

  _syncPosition() {
    this.basis.fromBasisComponents(0, this.upOffset, this.distance, this.position);
  }

  snapshot() {
    return {
      position: this.position,
      upOffset: this.upOffset,
      verticalVelocity: this.verticalVelocity,
      distance: this.distance,
      pitch: this.pitch,
      flapCount: this.flapCount,
      canFlap: this.canFlap(),
      crashed: this.crashed,
      crashReason: this.crashReason,
    };
  }

  reset({ up = this.startUp, distance = 0 } = {}) {
    this.upOffset = up;
    this.verticalVelocity = 0;
    this.distance = distance;
    this.sinceFlapSeconds = Number.POSITIVE_INFINITY;
    this.flapCount = 0;
    this.crashed = false;
    this.crashReason = null;
    this._syncPosition();
    return this.snapshot();
  }
}
