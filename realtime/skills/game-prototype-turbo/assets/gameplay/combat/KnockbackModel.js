import { Vector3 } from 'three';
import { DEFAULT_WORLD_BASIS } from '../../math/WorldBasis.js';
import { clamp } from '../../math/ScalarUtils.js';

export const RING_OUT_SIDES = Object.freeze({
  INSIDE: 'inside',
  LEFT: 'left',
  RIGHT: 'right',
  BELOW: 'below',
  ABOVE: 'above',
});

/**
 * Accumulating knockback with a ring-out test.
 *
 * The platform-fighting damage model: a fighter has no health bar, it carries a
 * damage percentage that never heals during a stock, and each hit launches it
 * further than the last. Losing is being launched off the stage, not running out
 * of hit points -- so the lose condition is geometric, which is why the boundary
 * test lives here next to the launch math.
 *
 * Knockback magnitude grows with accumulated damage:
 *
 *   magnitude = baseKnockback + accumulatedDamage * damageScaling * hitKnockback
 *
 * `hitKnockback` is the move's own multiplier, so a jab and a smash share one
 * model. Launch velocity is applied by the caller to whatever integrates motion.
 */
export class KnockbackModel {
  constructor({
    baseKnockback = 4,
    damageScaling = 0.045,
    maxKnockback = 60,
    launchAngleRadians = Math.PI / 5,
    stageHalfWidth = 12,
    stageFloorUp = -8,
    stageCeilingUp = 22,
    damageCap = 999,
    basis = DEFAULT_WORLD_BASIS,
  } = {}) {
    if (!Number.isFinite(baseKnockback) || baseKnockback < 0) {
      throw new Error('KnockbackModel: baseKnockback must be a finite number >= 0');
    }
    if (!Number.isFinite(stageHalfWidth) || stageHalfWidth <= 0) {
      throw new Error('KnockbackModel: stageHalfWidth must be a finite number > 0');
    }
    if (stageCeilingUp <= stageFloorUp) {
      throw new Error('KnockbackModel: stageCeilingUp must be above stageFloorUp');
    }

    this.baseKnockback = baseKnockback;
    this.damageScaling = damageScaling;
    this.maxKnockback = maxKnockback;
    this.launchAngleRadians = launchAngleRadians;
    this.stageHalfWidth = stageHalfWidth;
    this.stageFloorUp = stageFloorUp;
    this.stageCeilingUp = stageCeilingUp;
    this.damageCap = damageCap;
    this.basis = basis;

    // Damage per fighter, keyed by whatever identity the caller uses.
    this.damageByFighter = new Map();

    this._launch = new Vector3();
    this._planarDirection = new Vector3();
  }

  accumulatedDamage(fighterId) {
    return this.damageByFighter.get(fighterId) ?? 0;
  }

  /** Add damage and return the new total. */
  addDamage(fighterId, damage) {
    const amount = Math.max(0, Number.isFinite(damage) ? damage : 0);
    const total = clamp(this.accumulatedDamage(fighterId) + amount, 0, this.damageCap);
    this.damageByFighter.set(fighterId, total);
    return total;
  }

  /** Reset a fighter's damage (new stock). */
  resetFighter(fighterId) {
    this.damageByFighter.set(fighterId, 0);
    return this;
  }

  /** Knockback magnitude for a fighter at its current damage. */
  knockbackMagnitude(fighterId, hitKnockback = 1) {
    const damage = this.accumulatedDamage(fighterId);
    const multiplier = Number.isFinite(hitKnockback) ? hitKnockback : 1;
    const magnitude = this.baseKnockback + damage * this.damageScaling * multiplier;
    return Math.min(this.maxKnockback, magnitude * multiplier);
  }

  /**
   * Apply a hit: accumulate damage, then return the launch velocity.
   *
   * `direction` is the horizontal push direction (typically attacker -> target).
   * It is flattened and combined with `launchAngleRadians` so every launch has an
   * upward component -- a purely horizontal launch slides the target along the
   * floor instead of sending it off the stage.
   */
  applyHit({
    fighterId,
    damage = 0,
    direction,
    hitKnockback = 1,
    launchAngleRadians = this.launchAngleRadians,
  }) {
    if (!direction) {
      throw new Error('KnockbackModel.applyHit requires a direction');
    }

    const totalDamage = this.addDamage(fighterId, damage);
    const magnitude = this.knockbackMagnitude(fighterId, hitKnockback);

    this._planarDirection.copy(direction);
    this.basis.flatten(this._planarDirection);
    if (this._planarDirection.lengthSq() <= 1e-12) {
      // Degenerate direction (attacker exactly on target): launch straight up
      // rather than producing a zero vector the caller would silently apply.
      this.basis.upVector(this._launch).multiplyScalar(magnitude);
      return { launchVelocity: this._launch, magnitude, totalDamage };
    }
    this._planarDirection.normalize();

    const horizontal = Math.cos(launchAngleRadians) * magnitude;
    const vertical = Math.sin(launchAngleRadians) * magnitude;
    const planar = this.basis.toPlanar(this._planarDirection);
    this.basis.fromBasisComponents(
      planar.right * horizontal,
      vertical,
      planar.forward * horizontal,
      this._launch
    );

    return { launchVelocity: this._launch, magnitude, totalDamage };
  }

  /**
   * Which boundary (if any) a position is past. Horizontal blast lines use the
   * basis `right` axis; vertical uses `up`.
   */
  ringOutSide(position) {
    if (!position) throw new Error('KnockbackModel.ringOutSide requires a position');
    const components = this.basis.toBasisComponents(position);
    if (components.up < this.stageFloorUp) return RING_OUT_SIDES.BELOW;
    if (components.up > this.stageCeilingUp) return RING_OUT_SIDES.ABOVE;
    if (components.right < -this.stageHalfWidth) return RING_OUT_SIDES.LEFT;
    if (components.right > this.stageHalfWidth) return RING_OUT_SIDES.RIGHT;
    return RING_OUT_SIDES.INSIDE;
  }

  isRingOut(position) {
    return this.ringOutSide(position) !== RING_OUT_SIDES.INSIDE;
  }

  snapshot() {
    return {
      fighters: [...this.damageByFighter.entries()].map(([fighterId, damage]) => ({
        fighterId,
        damage,
        knockbackMagnitude: this.knockbackMagnitude(fighterId),
      })),
    };
  }

  reset() {
    this.damageByFighter.clear();
    return this;
  }
}
