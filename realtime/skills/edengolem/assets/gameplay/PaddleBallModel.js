const magnitude = (v) => Math.hypot(v.x, v.y) || 0;

/**
 * Side-view paddle-and-ball physics: a ball at constant speed that reflects off
 * walls and the ceiling, and whose launch angle off the paddle is a function of
 * where on the paddle face it hit (offset reflection). `KickableBallModel` is
 * soccer-shaped -- impulse from closing speed and a goal-box test -- and does not
 * express "the further from the paddle centre, the steeper the return angle".
 *
 * This is a 2D model over { x, y }: the run maps the plane onto its own 3D basis.
 * Brick collision stays with the caller (only it knows the brick set); this owns the
 * invariant geometry that is otherwise hand-rolled once per breakout.
 */
export class PaddleBallModel {
  constructor({ position = { x: 0, y: 0 }, speed = 12, radius = 0.4, startAngleRad = Math.PI * 0.25 }) {
    this.position = { ...position };
    this.radius = radius;
    this.speed = speed;
    this.velocity = { x: 0, y: 0 };
    this.launch(startAngleRad);
  }

  /** Set velocity to `speed` at `angleRad` (0 = straight up). */
  launch(angleRad) {
    this.velocity = { x: Math.sin(angleRad) * this.speed, y: Math.cos(angleRad) * this.speed };
    return this.velocity;
  }

  /**
   * Reflect off the paddle. `offsetNormalized` is where on the paddle face it hit,
   * -1..1 from left edge to right edge; the return angle is that fraction of
   * `maxAngleRad` away from straight up, so a centre hit returns straight up.
   */
  reflectFromPaddle(offsetNormalized, maxAngleRad) {
    const clamped = Math.max(-1, Math.min(1, offsetNormalized));
    return this.launch(clamped * maxAngleRad);
  }

  /** Advance and reflect off vertical walls and the ceiling. Returns contact events. */
  step(deltaSeconds, bounds = null) {
    this.position.x += this.velocity.x * deltaSeconds;
    this.position.y += this.velocity.y * deltaSeconds;
    const events = [];
    if (!bounds) return events;

    if (this.position.x - this.radius < bounds.minX) {
      this.position.x = bounds.minX + this.radius;
      this.velocity.x = Math.abs(this.velocity.x);
      events.push('leftWall');
    } else if (this.position.x + this.radius > bounds.maxX) {
      this.position.x = bounds.maxX - this.radius;
      this.velocity.x = -Math.abs(this.velocity.x);
      events.push('rightWall');
    }
    if (bounds.ceilingY != null && this.position.y + this.radius > bounds.ceilingY) {
      this.position.y = bounds.ceilingY - this.radius;
      this.velocity.y = -Math.abs(this.velocity.y);
      events.push('ceiling');
    }
    return events;
  }

  fellBelow(floorY) {
    return this.position.y + this.radius < floorY;
  }

  setSpeed(speed) {
    this.speed = speed;
    const mag = magnitude(this.velocity);
    if (mag > 0) {
      this.velocity.x = (this.velocity.x / mag) * speed;
      this.velocity.y = (this.velocity.y / mag) * speed;
    }
    return this.velocity;
  }
}