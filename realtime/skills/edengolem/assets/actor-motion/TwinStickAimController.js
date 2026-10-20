import { Vector3 } from 'three';
import { DEFAULT_WORLD_BASIS } from '../math/WorldBasis.js';
import { smoothToward } from '../math/ScalarUtils.js';

export const AIM_SOURCES = Object.freeze({
  STICK: 'stick',
  POINTER: 'pointer',
  TARGET: 'target',
  HELD: 'held',
});

/**
 * Aim direction decoupled from movement direction, with optional auto-fire.
 *
 * The twin-stick model: the left stick moves, the right stick aims, and the two
 * are independent -- strafing around an enemy while keeping the gun on it is the
 * entire skill of the genre. A `heading_relative` or `top_down` controller turns
 * the body toward travel, which cannot express that, so aim needs its own state.
 *
 * Three aim sources feed the same output, so one controller serves a gamepad, a
 * mouse and a lock-on:
 *
 * - `aimWithStick(right, forward)` -- right-stick vector.
 * - `aimAtPoint(worldPoint)` -- mouse/pointer ground hit.
 * - `aimAtTarget(position)` -- lock-on or auto-aim.
 *
 * When no input arrives, the last aim is HELD rather than snapping back to the
 * movement direction: a player who stops pushing the stick expects the gun to stay
 * put. Aim turning is rate-limited so it sweeps rather than teleports.
 */
export class TwinStickAimController {
  constructor({
    deadzone = 0.22,
    turnLag = 0.05,
    fireIntervalSeconds = 0.16,
    autoFire = false,
    initialAim = null,
    basis = DEFAULT_WORLD_BASIS,
  } = {}) {
    if (!Number.isFinite(deadzone) || deadzone < 0 || deadzone >= 1) {
      throw new Error('TwinStickAimController: deadzone must be a finite number in [0, 1)');
    }
    if (!Number.isFinite(fireIntervalSeconds) || fireIntervalSeconds <= 0) {
      throw new Error('TwinStickAimController: fireIntervalSeconds must be a finite number > 0');
    }

    this.deadzone = deadzone;
    this.turnLag = Math.max(0, turnLag);
    this.fireIntervalSeconds = fireIntervalSeconds;
    this.autoFire = Boolean(autoFire);
    this.basis = basis;

    // Aim is stored as a yaw angle so smoothing takes the short way round; the
    // vector form is derived on demand.
    this.aimYaw = 0;
    this.targetAimYaw = 0;
    this.aimSource = AIM_SOURCES.HELD;
    this.aimMagnitude = 0;
    this.fireHeld = false;
    this.cooldownRemainingSeconds = 0;
    this.shotsFired = 0;

    this.aimDirection = new Vector3();
    this._scratch = new Vector3();

    if (initialAim) {
      this.aimYaw = this.basis.forwardToYaw(initialAim);
      this.targetAimYaw = this.aimYaw;
    } else {
      this.aimYaw = this.basis.forwardToYaw(this.basis.forwardVector(this._scratch));
      this.targetAimYaw = this.aimYaw;
    }
    this._syncAimDirection();
  }

  /** Right-stick input. Below the deadzone the aim is held, not zeroed. */
  aimWithStick(right = 0, forward = 0) {
    const x = Number.isFinite(right) ? right : 0;
    const z = Number.isFinite(forward) ? forward : 0;
    const magnitude = Math.hypot(x, z);
    this.aimMagnitude = magnitude;

    if (magnitude < this.deadzone) {
      this.aimSource = AIM_SOURCES.HELD;
      return false;
    }

    this.basis.fromBasisComponents(x, 0, z, this._scratch);
    this.targetAimYaw = this.basis.forwardToYaw(this._scratch);
    this.aimSource = AIM_SOURCES.STICK;
    return true;
  }

  /** Aim at a world point, e.g. the pointer's ground intersection. */
  aimAtPoint(worldPoint, fromPosition) {
    if (!worldPoint || !fromPosition) {
      throw new Error('TwinStickAimController.aimAtPoint requires worldPoint and fromPosition');
    }
    this._scratch.copy(worldPoint).sub(fromPosition);
    this.basis.flatten(this._scratch);
    if (this._scratch.lengthSq() <= 1e-12) {
      // Pointer directly on the player: nothing meaningful to aim at, hold.
      this.aimSource = AIM_SOURCES.HELD;
      return false;
    }
    this.targetAimYaw = this.basis.forwardToYaw(this._scratch);
    this.aimSource = AIM_SOURCES.POINTER;
    this.aimMagnitude = 1;
    return true;
  }

  /** Aim at a target's position (lock-on / auto-aim). */
  aimAtTarget(targetPosition, fromPosition) {
    const aimed = this.aimAtPoint(targetPosition, fromPosition);
    if (aimed) this.aimSource = AIM_SOURCES.TARGET;
    return aimed;
  }

  setFireHeld(held) {
    this.fireHeld = Boolean(held);
    return this;
  }

  setAutoFire(enabled) {
    this.autoFire = Boolean(enabled);
    return this;
  }

  /** Current aim yaw in radians. */
  get yaw() {
    return this.aimYaw;
  }

  /** True when the aim has essentially reached its requested direction. */
  get settled() {
    return Math.abs(this._shortestDelta(this.targetAimYaw - this.aimYaw)) < 1e-3;
  }

  _shortestDelta(delta) {
    // Wrap to [-PI, PI] so smoothing never takes the long way round the circle.
    let value = delta;
    while (value > Math.PI) value -= Math.PI * 2;
    while (value < -Math.PI) value += Math.PI * 2;
    return value;
  }

  _syncAimDirection() {
    const frame = this.basis.yawPitchRollFrame(this.aimYaw, 0, 0);
    this.aimDirection.copy(frame.forward);
  }

  /**
   * Advance aim smoothing and the fire cooldown.
   *
   * Returns `{aimDirection, shouldFire, ...}`. `shouldFire` is true on exactly the
   * frames a shot should leave the muzzle; the caller spawns the projectile, so
   * this module stays independent of the weapon.
   */
  step(deltaSeconds) {
    const delta = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);

    const difference = this._shortestDelta(this.targetAimYaw - this.aimYaw);
    if (this.turnLag <= 0) {
      this.aimYaw += difference;
    } else {
      this.aimYaw += smoothToward(0, difference, this.turnLag, delta);
    }
    this._syncAimDirection();

    if (this.cooldownRemainingSeconds > 0) {
      this.cooldownRemainingSeconds = Math.max(0, this.cooldownRemainingSeconds - delta);
    }

    const wantsToFire = this.autoFire || this.fireHeld;
    let shouldFire = false;
    if (wantsToFire && this.cooldownRemainingSeconds <= 0) {
      shouldFire = true;
      this.cooldownRemainingSeconds = this.fireIntervalSeconds;
      this.shotsFired += 1;
    }

    return {
      aimDirection: this.aimDirection,
      aimYaw: this.aimYaw,
      aimSource: this.aimSource,
      shouldFire,
      settled: this.settled,
      cooldownRemainingSeconds: this.cooldownRemainingSeconds,
      shotsFired: this.shotsFired,
    };
  }

  snapshot() {
    return {
      aimDirection: this.aimDirection,
      aimYaw: this.aimYaw,
      targetAimYaw: this.targetAimYaw,
      aimSource: this.aimSource,
      aimMagnitude: this.aimMagnitude,
      fireHeld: this.fireHeld,
      autoFire: this.autoFire,
      settled: this.settled,
      shotsFired: this.shotsFired,
    };
  }

  reset({ aimYaw = null } = {}) {
    if (aimYaw !== null && Number.isFinite(aimYaw)) {
      this.aimYaw = aimYaw;
    }
    this.targetAimYaw = this.aimYaw;
    this.aimSource = AIM_SOURCES.HELD;
    this.aimMagnitude = 0;
    this.fireHeld = false;
    this.cooldownRemainingSeconds = 0;
    this.shotsFired = 0;
    this._syncAimDirection();
    return this.snapshot();
  }
}
