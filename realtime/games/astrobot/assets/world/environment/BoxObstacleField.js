import { Vector3 } from 'three';
import { DEFAULT_WORLD_BASIS } from '../../math/WorldBasis.js';

/**
 * A set of basis-aligned box obstacles that answers BOTH collision questions a
 * greybox prototype needs: "how high is the surface under me" and "am I inside
 * something solid".
 *
 * ## The bug this module exists to prevent
 *
 * Prototypes that hand-roll box collision almost always implement a support-height
 * query and stop there:
 *
 *     // WRONG -- collision on the TOP FACE ONLY
 *     function supportHeightAt(position, referenceUp) {
 *       let support = FLOOR_UP;
 *       for (const box of boxes) {
 *         if (!insideFootprint(position, box)) continue;
 *         if (box.topUp > referenceUp + TOLERANCE) continue;   // <-- the hole
 *         support = Math.max(support, box.topUp);
 *       }
 *       return support;
 *     }
 *
 * That `continue` is correct as far as it goes -- a box top above where the
 * character started the frame must not be snapped onto, or the character teleports
 * up through the side of the box. But skipping it is not the same as being BLOCKED
 * by it. Nothing else in that function stops horizontal motion, so a character who
 * walks into the SIDE of a box taller than their feet passes straight through it and
 * keeps going, standing inside the geometry.
 *
 * The symptom is very specific and easy to misread: collision "works" when you
 * approach from above (you land on the box) and fails when you approach from the
 * side (you walk through it). It also cannot be fixed by tagging boxes as walkable
 * vs solid, which is the usual next attempt -- see below.
 *
 * ## Floor or wall is a RELATIONSHIP, not a flag
 *
 * The insight worth keeping: whether a box is a floor or a wall is not a property of
 * the box. It is a property of the box top relative to the character's feet at the
 * start of the frame.
 *
 *   box top at or below the feet (+ stepTolerance) -> a FLOOR: stand on it
 *   box top above the feet                         -> a WALL: get pushed out of it
 *
 * The SAME box is both, depending on approach. A crate is a floor when you drop onto
 * it and a wall when you run at it, and any model that assigns one fixed role per box
 * gets one of those two cases wrong. Tagging boxes `stand: true / false` produces
 * exactly the reported bug in mirror image: the "walkable" ones can be walked
 * through from the side, and the "solid" ones cannot be landed on even when you jump
 * cleanly on top.
 *
 * `stepTolerance` is the one knob: how large a rise counts as a step you walk up
 * rather than a wall you must jump. Keep it small (a landing margin, ~0.1) when the
 * layout means its rises to be hops; raise it toward the intended step height when
 * they are meant to be walked up.
 *
 * ## Tunnelling
 *
 * Push-out resolution is discrete: it can only correct a position that ended up
 * INSIDE a box. A character that moves further in one frame than a box is thick
 * starts outside, ends outside, and is never corrected -- it clips through. Pass
 * `previousPosition` to `resolve()` and the move is swept against the box first,
 * which closes that hole regardless of speed. `maxSafeStep()` reports the largest
 * per-frame step the discrete path alone can survive, so a caller can assert it.
 *
 * ## Usage
 *
 *     const field = new BoxObstacleField({
 *       boxes: OBSTACLES,          // {right, forward, width, depth, bottomUp, topUp}
 *       stepTolerance: 0.12,
 *     });
 *
 *     // Blocking first: being pushed out changes which footprint you are over, so
 *     // sampling the floor before the push samples a place you do not end up.
 *     field.resolve(position, {
 *       radius: CAPSULE_RADIUS,
 *       height: CAPSULE_HEIGHT,
 *       referenceUp,
 *       previousPosition: intent.startPosition,
 *     });
 *     const support = field.supportHeightAt(position, referenceUp);
 *
 * Or hand `supportHeightAt` straight to `SupportHeightCommitResolver`.
 *
 * Pure geometry: no DOM, no per-frame allocation in the hot path.
 */
export class BoxObstacleField {
  constructor({
    boxes = [],
    basis = DEFAULT_WORLD_BASIS,
    stepTolerance = 0.12,
  } = {}) {
    if (!Number.isFinite(stepTolerance) || stepTolerance < 0) {
      throw new Error('BoxObstacleField: stepTolerance must be a finite number >= 0');
    }
    if (!Array.isArray(boxes)) {
      throw new Error('BoxObstacleField: boxes must be an array');
    }

    this.basis = basis;
    this.stepTolerance = stepTolerance;
    this.boxes = boxes.map((box, index) => normalizeBox(box, index));

    // Scratch, reused per call: resolve() runs once per character per frame.
    this._components = { right: 0, up: 0, forward: 0 };
    this._previous = { right: 0, up: 0, forward: 0 };
    this._scratch = new Vector3();
    this.lastContacts = [];
  }

  /**
   * Height of the tallest box top that can be stood on under `position`, or
   * `-Infinity` when nothing there can hold the character.
   *
   * `referenceUp` is the character's height at the START of the frame. Tops above it
   * (beyond `stepTolerance`) are walls, not floors, and are excluded here -- but
   * `resolve()` is what actually stops the character reaching them.
   *
   * -Infinity rather than a floor constant is deliberate: a caller over a void
   * should keep falling, and substituting a finite floor is how a fall that was
   * meant to be fatal turns into a survivable landing.
   */
  supportHeightAt(position, referenceUp) {
    const point = this.basis.toBasisComponents(position, this._components);
    const ceiling = referenceUp + this.stepTolerance;
    let support = -Infinity;

    for (const box of this.boxes) {
      if (!containsPlanar(point, box, 0)) continue;
      if (box.topUp > ceiling) continue; // a wall this frame, not a floor
      if (box.topUp > support) support = box.topUp;
    }
    return support;
  }

  /**
   * Push `position` out of every box it is inside, and (given `previousPosition`)
   * stop it from clipping through one it crossed.
   *
   * Mutates and returns `position`. `blocked` on the result says whether anything
   * moved it, which a caller can use for a HUD row or a bump sound.
   */
  resolve(position, {
    radius = 0,
    height = 0,
    referenceUp = null,
    previousPosition = null,
  } = {}) {
    if (!position) throw new Error('BoxObstacleField.resolve requires a position');
    if (!Number.isFinite(radius) || radius < 0) {
      throw new Error('BoxObstacleField.resolve: radius must be a finite number >= 0');
    }
    if (!Number.isFinite(height) || height < 0) {
      throw new Error('BoxObstacleField.resolve: height must be a finite number >= 0');
    }

    this.lastContacts.length = 0;
    const feetReference = Number.isFinite(referenceUp)
      ? referenceUp
      : this.basis.upComponent(position);
    const ceiling = feetReference + this.stepTolerance;

    let hadPrevious = false;
    if (previousPosition) {
      this.basis.toBasisComponents(previousPosition, this._previous);
      hadPrevious = true;
    }

    let blocked = false;
    for (const box of this.boxes) {
      // Floor this frame, not a wall: standing on it is supportHeightAt's job, and
      // pushing out of it here would shove the character off every ledge they land
      // on.
      if (box.topUp <= ceiling) continue;

      const point = this.basis.toBasisComponents(position, this._components);

      // Vertical overlap. A character whose feet clear the top has hopped it, and a
      // character entirely under it (rare in a greybox, but cheap to honour) passes
      // beneath. Either way there is no contact to resolve.
      const feetUp = point.up;
      if (feetUp >= box.topUp) continue;
      if (feetUp + height <= box.bottomUp) continue;

      if (hadPrevious && this._sweepOut(point, box, radius)) {
        blocked = true;
        this.lastContacts.push({ box, kind: 'swept' });
        this.basis.fromBasisComponents(point.right, point.up, point.forward, position);
        continue;
      }

      if (!containsPlanar(point, box, radius)) continue;

      // Shallowest-penetration push-out: slide along the face the character is least
      // deep into, rather than snapping them around a corner.
      const overlapRight = box.halfWidth + radius - Math.abs(point.right - box.right);
      const overlapForward = box.halfDepth + radius - Math.abs(point.forward - box.forward);
      if (overlapForward <= overlapRight) {
        point.forward += signAwayFrom(point.forward, box.forward) * overlapForward;
      } else {
        point.right += signAwayFrom(point.right, box.right) * overlapRight;
      }

      this.basis.fromBasisComponents(point.right, point.up, point.forward, position);
      blocked = true;
      this.lastContacts.push({ box, kind: 'pushed' });
    }

    return { position, blocked, contacts: this.lastContacts };
  }

  /**
   * Clamp a crossing move to just before the box it would have passed through.
   *
   * Returns true when `point` was moved. This is the anti-tunnelling half: the
   * discrete push-out above can only fix a position that LANDED inside a box, and a
   * fast character skips clean over a thin one.
   */
  _sweepOut(point, box, radius) {
    const fromRight = this._previous.right;
    const fromForward = this._previous.forward;
    const deltaRight = point.right - fromRight;
    const deltaForward = point.forward - fromForward;
    if (deltaRight === 0 && deltaForward === 0) return false;

    // Already inside at the start of the move: that is the push-out case, not a
    // sweep. Resolving it here would drag the character backwards along its path.
    if (containsPlanar({ right: fromRight, forward: fromForward }, box, radius)) {
      return false;
    }

    const minRight = box.right - box.halfWidth - radius;
    const maxRight = box.right + box.halfWidth + radius;
    const minForward = box.forward - box.halfDepth - radius;
    const maxForward = box.forward + box.halfDepth + radius;

    // Slab test along both planar axes; a parallel move outside the slab misses.
    let enter = 0;
    let exit = 1;
    const slabs = [
      [fromRight, deltaRight, minRight, maxRight],
      [fromForward, deltaForward, minForward, maxForward],
    ];
    for (const [origin, delta, min, max] of slabs) {
      if (Math.abs(delta) < 1e-9) {
        if (origin < min || origin > max) return false;
        continue;
      }
      let near = (min - origin) / delta;
      let far = (max - origin) / delta;
      if (near > far) [near, far] = [far, near];
      enter = Math.max(enter, near);
      exit = Math.min(exit, far);
      if (enter > exit) return false;
    }
    if (enter <= 0 || enter >= 1) return false;

    // Stop a hair short of the face, so the next frame's containment test does not
    // immediately count this as a penetration.
    const backOff = Math.max(0, enter - 1e-4);
    point.right = fromRight + deltaRight * backOff;
    point.forward = fromForward + deltaForward * backOff;
    return true;
  }

  /**
   * The largest per-frame planar step the discrete push-out can survive on its own:
   * half the thinnest box. Move further than this in one frame without passing
   * `previousPosition` and the character can clip straight through.
   *
   * Compare against `maxSpeed * maxFrameDelta`. Returns Infinity for an empty field.
   */
  maxSafeStep() {
    let smallest = Infinity;
    for (const box of this.boxes) {
      smallest = Math.min(smallest, box.halfWidth, box.halfDepth);
    }
    return smallest;
  }
}

/**
 * Box top faces that sit at the same height as another box top or a stated ground
 * plane, within `epsilon`.
 *
 * Not a collision concern at all -- it is a RENDERING one, and it is reported here
 * because this is where box tops are already declared as data. Two coplanar faces
 * give the depth buffer no way to order them, so the pair z-fights: the surfaces
 * flicker against each other every frame, at whatever rate the camera happens to
 * make them alternate. It reads as a rendering glitch rather than a layout mistake,
 * which is why it survives review.
 *
 * The usual way in: a layout authored against ground at up = 0, then re-seated onto
 * a raised surface without re-seating the objects on it, so some object's top lands
 * exactly on the new floor.
 *
 * Returns `[{ a, b, height }]`, where a `null` box means the ground plane.
 */
export function findCoplanarTops(boxes, { groundUp = null, epsilon = 1e-3 } = {}) {
  const normalized = boxes.map((box, index) => normalizeBox(box, index));
  const pairs = [];

  for (let i = 0; i < normalized.length; i += 1) {
    if (groundUp !== null && Math.abs(normalized[i].topUp - groundUp) <= epsilon) {
      pairs.push({ a: normalized[i], b: null, height: normalized[i].topUp });
    }
    for (let j = i + 1; j < normalized.length; j += 1) {
      if (Math.abs(normalized[i].topUp - normalized[j].topUp) > epsilon) continue;
      // Only a problem where the faces actually overlap in plan; two boxes of equal
      // height standing apart never draw over each other.
      if (!overlapsPlanar(normalized[i], normalized[j])) continue;
      pairs.push({ a: normalized[i], b: normalized[j], height: normalized[i].topUp });
    }
  }
  return pairs;
}

function normalizeBox(box, index) {
  if (!box || typeof box !== 'object') {
    throw new Error(`BoxObstacleField: box ${index} must be an object`);
  }
  const { right, forward, width, depth, topUp } = box;
  const bottomUp = box.bottomUp ?? 0;

  for (const [name, value] of [
    ['right', right], ['forward', forward], ['width', width],
    ['depth', depth], ['topUp', topUp], ['bottomUp', bottomUp],
  ]) {
    if (!Number.isFinite(value)) {
      throw new Error(`BoxObstacleField: box ${index} needs a finite ${name}`);
    }
  }
  if (width <= 0 || depth <= 0) {
    throw new Error(`BoxObstacleField: box ${index} needs width and depth > 0`);
  }
  // A zero-height box is invisible AND uncollidable, so it is always a mistake
  // rather than a degenerate case worth supporting quietly.
  if (topUp <= bottomUp) {
    throw new Error(
      `BoxObstacleField: box ${index} needs topUp (${topUp}) > bottomUp (${bottomUp})`
    );
  }

  return {
    ...box,
    right,
    forward,
    width,
    depth,
    topUp,
    bottomUp,
    halfWidth: width * 0.5,
    halfDepth: depth * 0.5,
  };
}

function containsPlanar(point, box, radius) {
  return Math.abs(point.right - box.right) <= box.halfWidth + radius
    && Math.abs(point.forward - box.forward) <= box.halfDepth + radius;
}

function overlapsPlanar(a, b) {
  return Math.abs(a.right - b.right) <= a.halfWidth + b.halfWidth
    && Math.abs(a.forward - b.forward) <= a.halfDepth + b.halfDepth;
}

/** Push direction along one axis, defaulting to +1 for a dead-centre overlap. */
function signAwayFrom(value, centre) {
  const delta = value - centre;
  if (delta > 0) return 1;
  if (delta < 0) return -1;
  return 1;
}
