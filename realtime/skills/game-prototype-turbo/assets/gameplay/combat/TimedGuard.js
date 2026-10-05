// Three.js 0.161.0. Simulation time in seconds; no renderer or wall clock.
import { Vector3 } from 'three';
import { DEFAULT_WORLD_BASIS } from '../../math/WorldBasis.js';

export class TimedGuard {
  constructor({ windowSeconds = .25, halfAngleRadians = Math.PI / 3, basis = DEFAULT_WORLD_BASIS } = {}) {
    if (!Number.isFinite(windowSeconds) || windowSeconds <= 0 || !Number.isFinite(halfAngleRadians) || halfAngleRadians < 0 || halfAngleRadians > Math.PI) throw new Error('TimedGuard: invalid window or angle');
    Object.assign(this, { windowSeconds, halfAngleRadians, basis });
    this._toward = new Vector3(); this._facing = new Vector3(); this.reset();
  }
  // Aggregate all bound guard controls before calling: a second held device is not a new press.
  setHeld(held, now, enabled = true) {
    if (!Number.isFinite(now)) throw new Error('TimedGuard: now must be finite');
    const rising = Boolean(held) && !this.held;
    this.held = Boolean(held); this.enabled = enabled;
    if (!enabled) { this.startedAt = -Infinity; return false; }
    if (rising) this.startedAt = now;
    return rising;
  }
  isRaised(now) { return this.enabled && (this.held || now < this.startedAt + this.windowSeconds); }
  resolve({ now, origin, facing, source, enabled = true }) {
    if (!enabled || !this.isRaised(now)) return 'hit';
    this.basis.flatten(this._toward.copy(source).sub(origin));
    this.basis.flatten(this._facing.copy(facing));
    if (this._toward.lengthSq() < 1e-12 || this._facing.lengthSq() < 1e-12) return 'hit';
    if (this._toward.normalize().dot(this._facing.normalize()) < Math.cos(this.halfAngleRadians)) return 'hit';
    return now >= this.startedAt && now - this.startedAt < this.windowSeconds ? 'parry' : 'block';
  }
  // Cue is an opportunity, not a promise: facing, movement and enabled state still matter.
  opportunity({ attack, origin, facing, target, enabled = true }) {
    return enabled && ((attack.phase === 'windup' && attack.phaseRemainingSeconds <= this.windowSeconds) ||
      (attack.isActive && !attack.hitThisSwing.has(target))) && attack.isInArc(origin, facing, target.position);
  }
  reset() { this.held = false; this.enabled = true; this.startedAt = -Infinity; }
}
