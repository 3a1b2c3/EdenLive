import { Vector3 } from 'three';
import { DEFAULT_WORLD_BASIS } from '../../math/WorldBasis.js';

/**
 * Resolves a planned character move against a support height instead of Rapier.
 *
 * `BaseCharacterMotionController.commitMovement(intent, resolved)` accepts a null
 * resolver, but then nothing ever stops a falling capsule and it drops through the
 * floor forever. A greybox prototype usually has no physics engine and no need for
 * one -- the ground is a plane, or a handful of boxes -- so it only needs an answer
 * to "how high is the surface under this point".
 *
 * The load-bearing detail, and the reason this is a module rather than four lines
 * inlined per game: **walking off a ledge has to be reported as leaving the
 * ground.** `BaseCharacterMotionController` only applies gravity to a character it
 * already believes is airborne, so a resolver that just clamps upward and leaves
 * `grounded` true floats the character off the edge at platform height. Coyote time
 * never arms either, because the grounded-to-airborne transition that triggers it
 * never happens.
 *
 * That case is invisible on flat ground, which is why three of the four prototypes
 * that hand-rolled this got away without it: their floors had no ledge to walk off.
 * The bug was latent, waiting for anyone to add a platform.
 *
 * Usage -- flat floor:
 *
 *     const resolver = new SupportHeightCommitResolver({ floorUp: 0 });
 *     const state = resolver.commit(controller, intent);
 *
 * Usage -- boxes to stand on:
 *
 *     const resolver = new SupportHeightCommitResolver({
 *       floorUp: 0,
 *       supportHeightAt: (position, referenceUp) => tallestTopUnder(position, referenceUp),
 *     });
 *
 * `supportHeightAt` receives the planned position and the character's height at the
 * START of the frame. Use that reference to ignore surfaces above it: a box top
 * higher than where the character began the frame is a wall, and snapping up to it
 * teleports the character through the side of the box.
 */
export class SupportHeightCommitResolver {
  constructor({
    floorUp = 0,
    supportHeightAt = null,
    basis = DEFAULT_WORLD_BASIS,
  } = {}) {
    if (!Number.isFinite(floorUp)) {
      throw new Error('SupportHeightCommitResolver: floorUp must be a finite number');
    }
    if (supportHeightAt !== null && typeof supportHeightAt !== 'function') {
      throw new Error(
        'SupportHeightCommitResolver: supportHeightAt must be a function or null'
      );
    }

    this.floorUp = floorUp;
    this.supportHeightAtFn = supportHeightAt;
    this.basis = basis;

    // Scratch reused every frame: this runs once per character per frame.
    this._position = new Vector3();
    this._correctedDelta = new Vector3();
    this._resolved = {
      position: this._position,
      velocity: null,
      correctedDelta: this._correctedDelta,
      grounded: false,
    };

    this.lastSupport = floorUp;
    this.lastLeftLedge = false;
  }

  /** Surface height under a planned position, never below `floorUp`. */
  supportHeight(position, referenceUp) {
    if (!this.supportHeightAtFn) return this.floorUp;
    const support = this.supportHeightAtFn(position, referenceUp);
    return Number.isFinite(support) ? Math.max(this.floorUp, support) : this.floorUp;
  }

  /**
   * Resolve `intent` and hand it to the controller.
   *
   * Returns whatever `commitMovement` returns, so this drops in where a null
   * resolver was. `lastSupport` and `lastLeftLedge` carry the extra detail a HUD
   * usually wants, without widening the return type.
   */
  commit(controller, intent) {
    if (!controller || typeof controller.commitMovement !== 'function') {
      throw new Error('SupportHeightCommitResolver.commit requires a motion controller');
    }
    if (!intent?.position || !intent?.startPosition) {
      throw new Error('SupportHeightCommitResolver.commit requires a movement intent');
    }

    const referenceUp = this.basis.upComponent(intent.startPosition);
    const support = this.supportHeight(intent.position, referenceUp);
    const position = this._position.copy(intent.position);

    let grounded = intent.grounded;
    let leftLedge = false;
    if (this.basis.upComponent(position) <= support) {
      this.basis.setHeight(position, support);
      grounded = true;
    } else if (grounded) {
      // Walked off a ledge. Reporting this is what makes gravity resume and what
      // arms coyote time; see the class comment.
      grounded = false;
      leftLedge = true;
    }

    this.lastSupport = support;
    this.lastLeftLedge = leftLedge;

    this._correctedDelta.copy(position).sub(intent.startPosition);
    this._resolved.velocity = intent.velocity;
    this._resolved.grounded = grounded;
    return controller.commitMovement(intent, this._resolved);
  }
}
