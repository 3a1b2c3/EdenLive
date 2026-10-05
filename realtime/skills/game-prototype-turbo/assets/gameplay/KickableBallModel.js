import { Vector3 } from 'three';
import { DEFAULT_WORLD_BASIS } from '../math/WorldBasis.js';

export const GOAL_SIDES = Object.freeze({
  NONE: 'none',
  OWN: 'own',
  OPPONENT: 'opponent',
});

/**
 * A kickable ball: bodies driving into it transfer impulse, and it scores when it
 * enters a goal box.
 *
 * Vehicle-soccer needs a ball that a car can strike, which no existing module
 * covers. Two rules make the contact feel like a hit rather than a nudge:
 *
 * - Impulse scales with **closing speed along the contact normal**, not raw speed.
 *   A car driving past the ball barely moves it; a car driving into it launches it.
 * - A per-body contact cooldown, so a car resting against the ball does not
 *   re-kick it every frame and vibrate it across the pitch.
 *
 * This integrates its own simple motion (gravity, bounce, ground friction) so a
 * prototype needs no rigid-body physics for the ball. Pass Rapier-driven positions
 * instead and use only `resolveContact` if the project has real physics.
 */
export class KickableBallModel {
  constructor({
    radius = 1,
    startPosition = null,
    gravity = 18,
    bounceRestitution = 0.62,
    groundFriction = 0.6,
    airDrag = 0.06,
    maxSpeed = 60,
    minKickSpeed = 0.8,
    kickTransfer = 1.35,
    contactCooldownSeconds = 0.12,
    floorUp = 0,
    fieldHalfWidth = null,
    fieldHalfLength = null,
    wallRestitution = 0.75,
    basis = DEFAULT_WORLD_BASIS,
  } = {}) {
    if (!Number.isFinite(radius) || radius <= 0) {
      throw new Error('KickableBallModel: radius must be a finite number > 0');
    }
    if (!Number.isFinite(gravity) || gravity < 0) {
      throw new Error('KickableBallModel: gravity must be a finite number >= 0');
    }

    this.radius = radius;
    this.gravity = gravity;
    this.bounceRestitution = bounceRestitution;
    this.groundFriction = groundFriction;
    this.airDrag = airDrag;
    this.maxSpeed = maxSpeed;
    this.minKickSpeed = minKickSpeed;
    this.kickTransfer = kickTransfer;
    this.contactCooldownSeconds = Math.max(0, contactCooldownSeconds);
    this.floorUp = floorUp;
    this.fieldHalfWidth = fieldHalfWidth;
    this.fieldHalfLength = fieldHalfLength;
    this.wallRestitution = wallRestitution;
    this.basis = basis;

    this.startPosition = startPosition
      ? new Vector3().copy(startPosition)
      : this.basis.fromBasisComponents(0, floorUp + radius, 0);

    this.position = new Vector3().copy(this.startPosition);
    this.velocity = new Vector3();
    this.grounded = false;
    this.kickCount = 0;

    // Per-body cooldowns so one contact does not fire every frame.
    this.contactCooldowns = new Map();

    this._normal = new Vector3();
    this._relative = new Vector3();
    this._scratch = new Vector3();
  }

  get speed() {
    return this.velocity.length();
  }

  /**
   * Resolve a contact with a moving body. Returns the applied impulse info, or
   * null when there was no contact, the closing speed was too low, or the body is
   * still on cooldown.
   *
   * `bodyId` identifies the body for cooldown purposes; `bodyRadius` plus the
   * ball radius defines the contact distance.
   */
  resolveContact({
    bodyId,
    bodyPosition,
    bodyVelocity = null,
    bodyRadius = 1,
    transfer = this.kickTransfer,
  }) {
    if (!bodyPosition) {
      throw new Error('KickableBallModel.resolveContact requires bodyPosition');
    }
    if ((this.contactCooldowns.get(bodyId) ?? 0) > 0) return null;

    this._normal.copy(this.position).sub(bodyPosition);
    const distance = this._normal.length();
    const contactDistance = this.radius + bodyRadius;
    if (distance > contactDistance) return null;

    if (distance <= 1e-6) {
      // Concentric: push along the body's travel, or up if it is stationary.
      if (bodyVelocity) {
        this._normal.copy(bodyVelocity);
        this.basis.flatten(this._normal);
      }
      if (this._normal.lengthSq() <= 1e-12) this.basis.upVector(this._normal);
    }
    this._normal.normalize();

    // Closing speed along the contact normal is what decides the kick.
    this._relative.copy(bodyVelocity ?? this._scratch.set(0, 0, 0)).sub(this.velocity);
    const closingSpeed = this._relative.dot(this._normal);
    if (closingSpeed < this.minKickSpeed) {
      // Still separate the overlap so the ball does not sink into the body.
      this._separate(bodyPosition, contactDistance);
      return null;
    }

    this.velocity.addScaledVector(this._normal, closingSpeed * transfer);
    if (this.maxSpeed > 0 && this.velocity.length() > this.maxSpeed) {
      this.velocity.setLength(this.maxSpeed);
    }
    this._separate(bodyPosition, contactDistance);

    this.grounded = false;
    this.kickCount += 1;
    if (this.contactCooldownSeconds > 0) {
      this.contactCooldowns.set(bodyId, this.contactCooldownSeconds);
    }
    return { bodyId, closingSpeed, impulse: closingSpeed * transfer, normal: this._normal };
  }

  _separate(bodyPosition, contactDistance) {
    this._scratch.copy(this.position).sub(bodyPosition);
    const distance = this._scratch.length();
    if (distance <= 1e-6 || distance >= contactDistance) return;
    this._scratch.divideScalar(distance).multiplyScalar(contactDistance - distance + 1e-4);
    this.position.add(this._scratch);
  }

  /** Advance the ball's own motion. */
  step(deltaSeconds) {
    const delta = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);

    for (const [bodyId, remaining] of this.contactCooldowns) {
      const next = remaining - delta;
      if (next <= 0) this.contactCooldowns.delete(bodyId);
      else this.contactCooldowns.set(bodyId, next);
    }

    if (this.airDrag > 0) {
      this.velocity.multiplyScalar(Math.max(0, 1 - this.airDrag * delta));
    }
    if (this.gravity > 0) {
      this.basis.addHeight(this.velocity, -this.gravity * delta);
    }
    this.position.addScaledVector(this.velocity, delta);

    const restUp = this.floorUp + this.radius;
    if (this.basis.upComponent(this.position) <= restUp) {
      this.basis.setHeight(this.position, restUp);
      const verticalSpeed = this.basis.upComponent(this.velocity);
      if (verticalSpeed < 0) {
        const bounced = -verticalSpeed * this.bounceRestitution;
        // Below a threshold, stop bouncing: otherwise the ball jitters forever on
        // ever-smaller bounces.
        this.basis.setHeight(this.velocity, bounced < 0.6 ? 0 : bounced);
        this.grounded = bounced < 0.6;
      }
      if (this.grounded && this.groundFriction > 0) {
        const keep = Math.max(0, 1 - this.groundFriction * delta);
        const height = this.basis.upComponent(this.velocity);
        this.velocity.multiplyScalar(keep);
        this.basis.setHeight(this.velocity, height);
      }
    } else {
      this.grounded = false;
    }

    this._clampToField();
    return this.snapshot();
  }

  _clampToField() {
    const components = this.basis.toBasisComponents(this.position);
    let bounced = false;

    if (this.fieldHalfWidth !== null) {
      const limit = this.fieldHalfWidth - this.radius;
      if (components.right < -limit || components.right > limit) {
        components.right = Math.max(-limit, Math.min(limit, components.right));
        const velocity = this.basis.toBasisComponents(this.velocity);
        velocity.right *= -this.wallRestitution;
        this.basis.fromBasisComponents(velocity.right, velocity.up, velocity.forward, this.velocity);
        bounced = true;
      }
    }
    if (this.fieldHalfLength !== null) {
      const limit = this.fieldHalfLength - this.radius;
      if (components.forward < -limit || components.forward > limit) {
        components.forward = Math.max(-limit, Math.min(limit, components.forward));
        const velocity = this.basis.toBasisComponents(this.velocity);
        velocity.forward *= -this.wallRestitution;
        this.basis.fromBasisComponents(velocity.right, velocity.up, velocity.forward, this.velocity);
        bounced = true;
      }
    }
    if (bounced) {
      this.basis.fromBasisComponents(
        components.right,
        components.up,
        components.forward,
        this.position
      );
    }
  }

  /**
   * Test the ball against a goal box given as basis-aligned planar extents.
   * `goal` is `{rightMin, rightMax, forwardMin, forwardMax, upMax}`.
   */
  isInGoal(goal) {
    if (!goal) return false;
    const c = this.basis.toBasisComponents(this.position);
    if (c.right < goal.rightMin || c.right > goal.rightMax) return false;
    if (c.forward < goal.forwardMin || c.forward > goal.forwardMax) return false;
    if (goal.upMax !== undefined && c.up > goal.upMax) return false;
    return true;
  }

  /** Which of two goals the ball is in, if any. */
  checkGoals({ ownGoal = null, opponentGoal = null } = {}) {
    if (opponentGoal && this.isInGoal(opponentGoal)) return GOAL_SIDES.OPPONENT;
    if (ownGoal && this.isInGoal(ownGoal)) return GOAL_SIDES.OWN;
    return GOAL_SIDES.NONE;
  }

  snapshot() {
    return {
      position: this.position,
      velocity: this.velocity,
      speed: this.speed,
      grounded: this.grounded,
      kickCount: this.kickCount,
    };
  }

  reset({ position = null } = {}) {
    this.position.copy(position ?? this.startPosition);
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.contactCooldowns.clear();
    return this.snapshot();
  }
}
