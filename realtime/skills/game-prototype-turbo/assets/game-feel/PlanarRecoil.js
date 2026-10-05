// Three.js 0.161.0. Caller owns collision and movement commit.
import { Vector3 } from 'three';
import { DEFAULT_WORLD_BASIS } from '../math/WorldBasis.js';
import { KnockbackModel } from '../gameplay/combat/KnockbackModel.js';
export class PlanarRecoil {
  constructor({ speed = 8, basis = DEFAULT_WORLD_BASIS } = {}) {
    this.basis = basis;
    this.model = new KnockbackModel({ baseKnockback: speed, damageScaling: 0, launchAngleRadians: 0, basis });
    this.velocity = new Vector3(); this._direction = new Vector3(); this._from = new Vector3(); this.reset();
  }
  push(direction, { duration = .25, strength = 1 } = {}) {
    if (!Number.isFinite(duration) || duration < 0 || !Number.isFinite(strength) || strength < 0) throw new Error('PlanarRecoil: invalid duration or strength');
    this.basis.flatten(this._direction.copy(direction));
    if (this._direction.lengthSq() < 1e-12) { this.reset(); return; }
    this.velocity.copy(this.model.applyHit({ fighterId: 'actor', direction: this._direction, hitKnockback: strength }).launchVelocity);
    this.remaining = duration;
  }
  // resolve(position, previousPosition) may clamp/slide/sweep; without it this is free-space motion only.
  step(position, dt, resolve = null) {
    if (!Number.isFinite(dt) || dt < 0) throw new Error('PlanarRecoil: invalid dt');
    const used = Math.min(dt, this.remaining);
    if (used <= 0) return;
    this._from.copy(position); position.addScaledVector(this.velocity, used);
    if (resolve) resolve(position, this._from);
    this.remaining = Math.max(0, this.remaining - used);
    if (!this.remaining) this.velocity.set(0, 0, 0);
  }
  reset() { this.remaining = 0; this.velocity.set(0, 0, 0); this.model.reset(); }
}
