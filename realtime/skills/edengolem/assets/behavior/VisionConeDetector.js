import { Vector3 } from 'three';
import { DEFAULT_WORLD_BASIS } from '../math/WorldBasis.js';
import { clamp01 } from '../math/ScalarUtils.js';

export const ALERT_STATES = Object.freeze({
  UNAWARE: 'unaware',
  SUSPICIOUS: 'suspicious',
  ALERTED: 'alerted',
});

/**
 * Vision-cone detection with a filling suspicion meter, per observer.
 *
 * Stealth needs the gap between "seen" and "caught". A boolean line of sight makes
 * guards feel like tripwires: the player is spotted the instant a cone clips them,
 * with no chance to break away. A meter that fills while visible and drains while
 * hidden is what makes hiding a decision.
 *
 * Fill rate scales with proximity, so being seen from across the map is slower to
 * escalate than being seen up close. Occlusion is delegated through an
 * `isOccluded(observer, target)` predicate: the caller owns the walls, and the
 * detector stays headless and testable without a scene.
 *
 * Once ALERTED an observer stays alerted for `alertHoldSeconds` of continuous
 * non-visibility before decaying, so the player cannot un-alert a guard by
 * stepping behind a crate for one frame.
 */
export class VisionConeDetector {
  constructor({
    viewDistance = 18,
    halfAngleRadians = Math.PI / 5,
    verticalTolerance = 4,
    fillSecondsAtEdge = 2.2,
    fillSecondsAtPointBlank = 0.45,
    drainSeconds = 3,
    suspicionThreshold = 0.35,
    alertHoldSeconds = 1.5,
    isOccluded = null,
    basis = DEFAULT_WORLD_BASIS,
  } = {}) {
    if (!Number.isFinite(viewDistance) || viewDistance <= 0) {
      throw new Error('VisionConeDetector: viewDistance must be a finite number > 0');
    }
    if (!Number.isFinite(fillSecondsAtEdge) || fillSecondsAtEdge <= 0) {
      throw new Error('VisionConeDetector: fillSecondsAtEdge must be a finite number > 0');
    }
    if (!Number.isFinite(fillSecondsAtPointBlank) || fillSecondsAtPointBlank <= 0) {
      throw new Error('VisionConeDetector: fillSecondsAtPointBlank must be a finite number > 0');
    }
    if (isOccluded !== null && typeof isOccluded !== 'function') {
      throw new Error('VisionConeDetector: isOccluded must be a function or null');
    }

    this.viewDistance = viewDistance;
    this.halfAngleRadians = Math.abs(halfAngleRadians);
    this.verticalTolerance = Math.abs(verticalTolerance);
    this.fillSecondsAtEdge = fillSecondsAtEdge;
    this.fillSecondsAtPointBlank = fillSecondsAtPointBlank;
    this.drainSeconds = Math.max(0, drainSeconds);
    this.suspicionThreshold = clamp01(suspicionThreshold);
    this.alertHoldSeconds = Math.max(0, alertHoldSeconds);
    this.isOccludedFn = isOccluded;
    this.basis = basis;

    // Per-observer meter state, keyed by the caller's observer identity.
    this.meters = new Map();

    this._toTarget = new Vector3();
    this._facing = new Vector3();
  }

  _meter(observerId) {
    let meter = this.meters.get(observerId);
    if (!meter) {
      meter = { suspicion: 0, state: ALERT_STATES.UNAWARE, holdRemaining: 0, visible: false };
      this.meters.set(observerId, meter);
    }
    return meter;
  }

  suspicion(observerId) {
    return this._meter(observerId).suspicion;
  }

  alertState(observerId) {
    return this._meter(observerId).state;
  }

  /**
   * Geometry only: is the target inside the cone and unoccluded? Returns
   * `{visible, distance, closeness}` where closeness is 1 at point blank and 0 at
   * the edge of view.
   */
  testVisibility({ observerPosition, observerFacing, targetPosition }) {
    if (!observerPosition || !observerFacing || !targetPosition) {
      throw new Error('VisionConeDetector: observerPosition, observerFacing and targetPosition are required');
    }

    this._toTarget.copy(targetPosition).sub(observerPosition);
    if (Math.abs(this.basis.upComponent(this._toTarget)) > this.verticalTolerance) {
      return { visible: false, distance: Infinity, closeness: 0 };
    }

    this._facing.copy(observerFacing);
    this.basis.flatten(this._facing);
    this.basis.flatten(this._toTarget);

    const distance = this._toTarget.length();
    if (distance > this.viewDistance) return { visible: false, distance, closeness: 0 };
    if (this._facing.lengthSq() <= 1e-12) return { visible: false, distance, closeness: 0 };

    const closeness = clamp01(1 - distance / this.viewDistance);
    // A target at the observer's own position is visible regardless of angle.
    if (distance > 1e-6) {
      this._toTarget.divideScalar(distance);
      this._facing.normalize();
      if (this._toTarget.dot(this._facing) < Math.cos(this.halfAngleRadians)) {
        return { visible: false, distance, closeness };
      }
    }

    return { visible: true, distance, closeness };
  }

  /**
   * Advance one observer's meter by `deltaSeconds`. Returns the meter snapshot
   * plus `justAlerted`, true only on the frame the observer crosses into ALERTED
   * (so a caller can raise the alarm exactly once).
   */
  step({
    observerId,
    observerPosition,
    observerFacing,
    targetPosition,
    deltaSeconds,
  }) {
    const delta = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);
    const meter = this._meter(observerId);
    const previousState = meter.state;

    let { visible, distance, closeness } = this.testVisibility({
      observerPosition,
      observerFacing,
      targetPosition,
    });
    if (visible && this.isOccludedFn && this.isOccludedFn(observerId, targetPosition)) {
      visible = false;
    }
    meter.visible = visible;

    if (visible) {
      // Interpolate the fill rate between the edge and point-blank speeds.
      const seconds = this.fillSecondsAtEdge
        + (this.fillSecondsAtPointBlank - this.fillSecondsAtEdge) * closeness;
      meter.suspicion = clamp01(meter.suspicion + delta / Math.max(1e-6, seconds));
      meter.holdRemaining = this.alertHoldSeconds;
    } else if (meter.holdRemaining > 0) {
      // Alerted guards keep their meter while the hold lasts.
      meter.holdRemaining = Math.max(0, meter.holdRemaining - delta);
    } else if (this.drainSeconds > 0) {
      meter.suspicion = clamp01(meter.suspicion - delta / this.drainSeconds);
    } else {
      meter.suspicion = 0;
    }

    if (meter.suspicion >= 1) {
      meter.state = ALERT_STATES.ALERTED;
    } else if (meter.suspicion >= this.suspicionThreshold) {
      meter.state = ALERT_STATES.SUSPICIOUS;
    } else {
      meter.state = ALERT_STATES.UNAWARE;
    }

    return {
      observerId,
      visible,
      distance,
      suspicion: meter.suspicion,
      state: meter.state,
      justAlerted: meter.state === ALERT_STATES.ALERTED && previousState !== ALERT_STATES.ALERTED,
    };
  }

  /** True when any tracked observer is fully alerted. */
  isAnyAlerted() {
    for (const meter of this.meters.values()) {
      if (meter.state === ALERT_STATES.ALERTED) return true;
    }
    return false;
  }

  /** Highest suspicion across observers, for a single HUD indicator. */
  peakSuspicion() {
    let peak = 0;
    for (const meter of this.meters.values()) peak = Math.max(peak, meter.suspicion);
    return peak;
  }

  forgetObserver(observerId) {
    this.meters.delete(observerId);
    return this;
  }

  reset() {
    this.meters.clear();
    return this;
  }
}
