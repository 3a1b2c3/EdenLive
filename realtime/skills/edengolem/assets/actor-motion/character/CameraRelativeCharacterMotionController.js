import { Vector3 } from 'three';
import { BaseCharacterMotionController } from './BaseCharacterMotionController.js';
import { toVec3 } from '../../math/Vector3Utils.js';

// WASD in the camera's planar frame, not the actor's heading.
//
// HeadingRelative and MouseLook both build the move frame from `this.yaw`, so
// orbiting a third-person camera cannot steer the actor without also turning
// the body. This controller reads the orbit yaw each step. Facing is separate:
// travel direction, an optional lock `faceTarget`, or the current yaw.
export class CameraRelativeCharacterMotionController extends BaseCharacterMotionController {
  constructor({
    turnToMove = true,
    ...config
  } = {}) {
    super(config);
    this.cfg.turnToMove = turnToMove;
  }

  // forward/backward, strafeLeft/strafeRight: 0..1 in the camera planar frame.
  // cameraYaw: orbit yaw in radians (OrbitFollowCameraRig.yaw). Required.
  // faceTarget: optional world point to face (lock-on); otherwise face travel.
  planMovement({
    forward = 0,
    backward = 0,
    strafeLeft = 0,
    strafeRight = 0,
    cameraYaw,
    faceTarget = null,
    sprint = false,
    crouch = false,
    jump = false,
    deltaSeconds = 1 / 60,
    commit = false,
  }) {
    if (!Number.isFinite(cameraYaw)) {
      throw new Error('CameraRelativeCharacterMotionController: cameraYaw is required');
    }

    const moveRight = this.basis.controlSignal('left', strafeLeft)
      + this.basis.controlSignal('right', strafeRight);
    const moveForward = this.basis.controlSignal('backward', backward)
      + this.basis.controlSignal('forward', forward);
    const inputLength = Math.hypot(moveRight, moveForward);
    const inputScale = inputLength > 1 ? 1 / inputLength : 1;
    const moveFrame = this.basis.yawPitchRollFrame(cameraYaw);
    const moveDirection = inputLength > 0
      ? moveFrame.right
        .multiplyScalar(moveRight * inputScale)
        .addScaledVector(moveFrame.forward, moveForward * inputScale)
      : new Vector3();

    let facingDirection = null;
    if (faceTarget) {
      facingDirection = this._directionTo(toVec3(faceTarget));
    } else if (this.cfg.turnToMove && moveDirection.lengthSq() > 0) {
      facingDirection = moveDirection;
    }

    const intent = this._prepareLocomotion({
      moveDirection,
      facingDirection,
      sprint,
      crouch,
      jump,
      deltaSeconds,
    });

    if (commit) return this.commitMovement(intent);
    return intent;
  }
}
