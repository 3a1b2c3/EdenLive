import { Vector3 } from 'three';
import { DEFAULT_CLOCK } from '../../math/TimeUtils.js';
import { DEFAULT_WORLD_BASIS } from '../../math/WorldBasis.js';

export const MELEE_PHASES = Object.freeze({
  IDLE: 'idle',
  WINDUP: 'windup',
  ACTIVE: 'active',
  RECOVERY: 'recovery',
});

export const MELEE_SWING_RESULTS = Object.freeze({
  STARTED: 'started',
  BUFFERED: 'buffered',
  ON_COOLDOWN: 'onCooldown',
  BUSY: 'busy',
});

/**
 * A melee swing as a three-phase state machine with a wedge-shaped hit test.
 *
 * Beat-em-ups and platform fighters need contact attacks, which the projectile
 * weapons do not cover. The three phases are what make a swing readable: a windup
 * the opponent can react to, a short active window that actually hits, and a
 * recovery the attacker is committed to. Damage only lands during ACTIVE.
 *
 * The hit volume is a wedge: within `range`, within `halfAngleRadians` of facing,
 * and within `verticalReach` in height. Each target is hit at most once per swing,
 * tracked by identity, so a target standing inside the arc is not hit every frame.
 *
 * Headless: `resolveHits` takes plain `{position}` objects.
 */
export class MeleeAttackSystem {
  constructor({
    range = 2.4,
    halfAngleRadians = Math.PI / 3,
    verticalReach = 1.8,
    damage = 24,
    windupSeconds = 0.08,
    activeSeconds = 0.12,
    recoverySeconds = 0.18,
    cooldownSeconds = 0,
    maxTargetsPerSwing = 0,
    inputBufferSeconds = 0.15,
    clock = DEFAULT_CLOCK,
    basis = DEFAULT_WORLD_BASIS,
  } = {}) {
    for (const [label, value] of [
      ['range', range],
      ['windupSeconds', windupSeconds],
      ['activeSeconds', activeSeconds],
      ['recoverySeconds', recoverySeconds],
      ['cooldownSeconds', cooldownSeconds],
    ]) {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`MeleeAttackSystem: ${label} must be a finite number >= 0`);
      }
    }
    if (!Number.isFinite(activeSeconds) || activeSeconds <= 0) {
      throw new Error('MeleeAttackSystem: activeSeconds must be a finite number > 0');
    }

    this.range = range;
    this.halfAngleRadians = Math.abs(halfAngleRadians);
    this.verticalReach = Math.abs(verticalReach);
    this.damage = damage;
    this.windupSeconds = windupSeconds;
    this.activeSeconds = activeSeconds;
    this.recoverySeconds = recoverySeconds;
    this.cooldownSeconds = cooldownSeconds;
    this.maxTargetsPerSwing = Math.max(0, Math.floor(maxTargetsPerSwing));
    this.inputBufferSeconds = Math.max(0, inputBufferSeconds);
    this.clock = clock;
    this.basis = basis;

    this.phase = MELEE_PHASES.IDLE;
    this.phaseRemainingSeconds = 0;
    this.cooldownRemainingSeconds = 0;
    this.bufferRemainingSeconds = 0;
    this.swingCount = 0;
    this.hitThisSwing = new Set();

    // Scratch: resolveHits runs per swing frame against every candidate.
    this._toTarget = new Vector3();
    this._facing = new Vector3();
  }

  get isSwinging() {
    return this.phase !== MELEE_PHASES.IDLE;
  }

  /** Damage lands only in this window. */
  get isActive() {
    return this.phase === MELEE_PHASES.ACTIVE;
  }

  /**
   * Request a swing. Starts one when idle and off cooldown; otherwise buffers the
   * press (so an attack queued during recovery comes out, matching how players
   * actually mash) or reports why it was refused.
   */
  requestSwing() {
    if (this.isSwinging) {
      if (this.inputBufferSeconds > 0) {
        this.bufferRemainingSeconds = this.inputBufferSeconds;
        return MELEE_SWING_RESULTS.BUFFERED;
      }
      return MELEE_SWING_RESULTS.BUSY;
    }
    if (this.cooldownRemainingSeconds > 0) {
      if (this.inputBufferSeconds > 0) {
        this.bufferRemainingSeconds = this.inputBufferSeconds;
        return MELEE_SWING_RESULTS.BUFFERED;
      }
      return MELEE_SWING_RESULTS.ON_COOLDOWN;
    }
    this._beginSwing();
    return MELEE_SWING_RESULTS.STARTED;
  }

  _beginSwing() {
    this.hitThisSwing.clear();
    this.swingCount += 1;
    this.bufferRemainingSeconds = 0;
    if (this.windupSeconds > 0) {
      this.phase = MELEE_PHASES.WINDUP;
      this.phaseRemainingSeconds = this.windupSeconds;
    } else {
      this.phase = MELEE_PHASES.ACTIVE;
      this.phaseRemainingSeconds = this.activeSeconds;
    }
  }

  /**
   * Advance the phase machine. Returns the phase entered this step, or null when
   * the phase did not change.
   */
  step(deltaSeconds) {
    const delta = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);

    if (this.cooldownRemainingSeconds > 0) {
      this.cooldownRemainingSeconds = Math.max(0, this.cooldownRemainingSeconds - delta);
    }
    if (this.bufferRemainingSeconds > 0) {
      this.bufferRemainingSeconds = Math.max(0, this.bufferRemainingSeconds - delta);
    }

    if (!this.isSwinging) {
      // A buffered press fires as soon as the cooldown clears.
      if (this.bufferRemainingSeconds > 0 && this.cooldownRemainingSeconds <= 0) {
        this._beginSwing();
        return this.phase;
      }
      return null;
    }

    this.phaseRemainingSeconds -= delta;
    if (this.phaseRemainingSeconds > 0) return null;

    // Carry the overshoot into the next phase so a long frame cannot stretch a
    // swing beyond its configured length.
    const overshoot = -this.phaseRemainingSeconds;
    if (this.phase === MELEE_PHASES.WINDUP) {
      this.phase = MELEE_PHASES.ACTIVE;
      this.phaseRemainingSeconds = Math.max(0, this.activeSeconds - overshoot);
      return this.phase;
    }
    if (this.phase === MELEE_PHASES.ACTIVE) {
      if (this.recoverySeconds > 0) {
        this.phase = MELEE_PHASES.RECOVERY;
        this.phaseRemainingSeconds = Math.max(0, this.recoverySeconds - overshoot);
        return this.phase;
      }
      this._endSwing();
      return this.phase;
    }
    this._endSwing();
    return this.phase;
  }

  _endSwing() {
    this.phase = MELEE_PHASES.IDLE;
    this.phaseRemainingSeconds = 0;
    this.cooldownRemainingSeconds = this.cooldownSeconds;
    this.hitThisSwing.clear();
  }

  /** True when `target` lies inside the swing wedge from `origin` facing `facing`. */
  isInArc(origin, facing, targetPosition) {
    this._toTarget.copy(targetPosition).sub(origin);
    if (Math.abs(this.basis.upComponent(this._toTarget)) > this.verticalReach) return false;

    this._facing.copy(facing);
    this.basis.flatten(this._facing);
    this.basis.flatten(this._toTarget);

    const distance = this._toTarget.length();
    if (distance > this.range) return false;
    // A target at the exact origin counts as hit: there is no meaningful angle.
    if (distance <= 1e-6) return true;
    if (this._facing.lengthSq() <= 1e-12) return false;

    this._toTarget.divideScalar(distance);
    this._facing.normalize();
    return this._toTarget.dot(this._facing) >= Math.cos(this.halfAngleRadians);
  }

  /**
   * Resolve hits for this frame. Returns `[]` unless the swing is ACTIVE, so a
   * caller can call it unconditionally every frame.
   *
   * Each entry is `{target, damage, distance}`. Targets already hit by this swing
   * are skipped.
   */
  resolveHits({ origin, facing, targets = [], damage = this.damage }) {
    // Outside the active window there is nothing to resolve, and callers are
    // expected to call this every frame -- so that check comes first and stays
    // cheap. Argument validation runs before the empty-target early-out, or a
    // caller that forgot `origin` would be silently fine on every frame where
    // the target list happened to be empty.
    if (!this.isActive) return [];
    if (!origin || !facing) {
      throw new Error('MeleeAttackSystem.resolveHits requires origin and facing');
    }
    if (targets.length === 0) return [];

    const hits = [];
    for (const target of targets) {
      if (!target?.position) continue;
      if (this.hitThisSwing.has(target)) continue;
      if (!this.isInArc(origin, facing, target.position)) continue;

      this.hitThisSwing.add(target);
      hits.push({
        target,
        damage,
        distance: this.basis.planarLength(
          this._toTarget.copy(target.position).sub(origin)
        ),
      });
      if (this.maxTargetsPerSwing > 0 && hits.length >= this.maxTargetsPerSwing) break;
    }
    return hits;
  }

  snapshot() {
    return {
      phase: this.phase,
      isSwinging: this.isSwinging,
      isActive: this.isActive,
      phaseRemainingSeconds: this.phaseRemainingSeconds,
      cooldownRemainingSeconds: this.cooldownRemainingSeconds,
      bufferedSwing: this.bufferRemainingSeconds > 0,
      swingCount: this.swingCount,
      hitsThisSwing: this.hitThisSwing.size,
    };
  }

  reset() {
    this.phase = MELEE_PHASES.IDLE;
    this.phaseRemainingSeconds = 0;
    this.cooldownRemainingSeconds = 0;
    this.bufferRemainingSeconds = 0;
    this.swingCount = 0;
    this.hitThisSwing.clear();
    return this;
  }
}
