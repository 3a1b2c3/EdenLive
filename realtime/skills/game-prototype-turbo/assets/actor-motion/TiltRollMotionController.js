const clampMagnitude = (v, max) => {
  const mag = Math.hypot(v.right, v.forward);
  if (mag > max && mag > 0) {
    const scale = max / mag;
    return { right: v.right * scale, forward: v.forward * scale };
  }
  return { right: v.right, forward: v.forward };
};

/**
 * A ball rolling on a board the player tilts. `PlateTiltController` produces the tilt
 * state and its `slopeSignal()` ({ right, forward } in [-1, 1], downhill); this owns
 * the missing other half -- integrate downhill acceleration against friction into the
 * ball's velocity and position. No rapier: the same kinematic integrator a
 * tilt-board run otherwise hand-writes.
 *
 *   const move = tilt.move({ left, right, forward, backward, deltaSeconds });
 *   const rollout = roll.step(deltaSeconds, move.slope);
 *   // rollout.position / rollout.velocity feed the ball mesh; boundary handled by caller
 */
export class TiltRollMotionController {
  constructor({ acceleration = 12, friction = 3, maxSpeed = 24, position = { right: 0, forward: 0 } }) {
    this.acceleration = acceleration;
    this.friction = friction;
    this.maxSpeed = maxSpeed;
    this.reset(position);
  }

  reset(position = { right: 0, forward: 0 }) {
    this.position = { right: position.right, forward: position.forward };
    this.velocity = { right: 0, forward: 0 };
    return this.snapshot();
  }

  step(deltaSeconds, slope = { right: 0, forward: 0 }) {
    this.velocity.right += (slope.right * this.acceleration - this.velocity.right * this.friction) * deltaSeconds;
    this.velocity.forward += (slope.forward * this.acceleration - this.velocity.forward * this.friction) * deltaSeconds;
    this.velocity = clampMagnitude(this.velocity, this.maxSpeed);

    this.position.right += this.velocity.right * deltaSeconds;
    this.position.forward += this.velocity.forward * deltaSeconds;
    return this.snapshot();
  }

  snapshot() {
    return {
      position: { right: this.position.right, forward: this.position.forward },
      velocity: { right: this.velocity.right, forward: this.velocity.forward },
    };
  }
}