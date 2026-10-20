import { DEFAULT_WORLD_BASIS } from '../../math/WorldBasis.js';

export class PickupObject {
  constructor({
    id = null,
    type = null,
    pickupVisual,
    position,
    floorUp = null,
    scale = 1,
    basis = DEFAULT_WORLD_BASIS
  }) {
    if (!position) throw new Error('PickupObject: position is required');

    this.id = id;
    this.type = type;
    this.basis = basis;
    this.up = this.basis.upVector();

    this.pickupVisual = pickupVisual;
    this.group = pickupVisual.group;
    this.group.quaternion.copy(basis.threeObjectCanonicalToBasisQuaternion());
    this.group.position.copy(position);
    // Factory geometry is grounded at its origin; internal animation owns hover.
    if (floorUp != null) this.basis.setHeight(this.group.position, floorUp);
    this.group.scale.setScalar(scale);

    this.position = this.group.position;
    this.radius = pickupVisual.pickupVolume.radius * scale;
    this.phase = 0;
    this.collected = false;
  }

  /**
   * Whether `position` is close enough to collect this pickup, ignoring height.
   *
   * Planar, because a pickup bobs (see `animate`) and a collector's origin sits at its feet: a
   * spherical test would make collection depend on the bob phase, so the same walk-through
   * collects or misses depending on the frame it lands.
   */
  isWithinReach(position, collectorRadius = 0) {
    const dRight = this.basis.rightComponent(position) - this.basis.rightComponent(this.position);
    const dForward =
      this.basis.forwardComponent(position) - this.basis.forwardComponent(this.position);
    const reach = this.radius + collectorRadius;
    return dRight * dRight + dForward * dForward <= reach * reach;
  }

  /**
   * Collect this pickup if `position` is in reach and it is not already collected.
   *
   * Returns true exactly once per pickup, so a caller can add to a pool on a true without
   * guarding against double-collection itself -- two colliders overlapping one pickup on the
   * same frame is otherwise a duplicated reward.
   *
   */
  tryCollect(position, collectorRadius = 0) {
    if (this.collected) return false;
    if (!this.isWithinReach(position, collectorRadius)) return false;
    this.collected = true;
    this.group.visible = false;
    return true;
  }

  /** Put an uncollected pickup back into play (a partial reset between attempts). */
  reset() {
    this.collected = false;
    this.group.visible = true;
    this.phase = 0;
    this.pickupVisual.reset();
  }

  animate(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('deltaSeconds must be finite and nonnegative');
    if (this.collected) return;
    this.phase += deltaSeconds;
    this.pickupVisual.setPose('idle', this.phase);
  }

  dispose() {
    this.pickupVisual.dispose();
  }
}
