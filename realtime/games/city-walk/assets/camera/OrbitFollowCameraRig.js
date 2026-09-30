import { clamp, smoothingAlpha } from '../math/ScalarUtils.js';
import { toVec3 } from '../math/Vector3Utils.js';
import { BaseCameraRig } from './BaseCameraRig.js';
import { DEFAULT_WORLD_BASIS } from '../math/WorldBasis.js';

const PLANAR_EPS_SQ = 1e-12;

// Persistent third-person orbit. The other catalog rigs do not cover this:
//
//   PoseFollow     -- offset lives in the actor frame, so the view turns with the body.
//   LookOffset     -- orbit exists, but yaw/pitch recenter when look input stops.
//   PositionFollow -- fixed world azimuth; the player cannot orbit.
//   FirstPerson    -- eye-locked.
//
// Look input here turns the camera, not the actor. Releasing look leaves the orbit
// where it is. Negative pitch looks down at the body-height anchor; the actor does
// not have to sit in the middle of the frame. Lock-on is an optional position the
// yaw interpolates toward; actor facing stays on the motion controller.
export class OrbitFollowCameraRig extends BaseCameraRig {
  constructor({
    distance = 8,
    anchorHeight = 1.2,
    anchorRight = 0,
    anchorForward = 0,
    lockAnchorHeight = null,
    pitchMin = -1.05,
    pitchMax = 0.35,
    lookSensitivity = 0.0035,
    lockLag = 0.16,
    lockLookBlend = 0,
    positionLag = 0,
    lookLag = 0,
    yaw = 0,
    pitch = -0.35,
    basis = DEFAULT_WORLD_BASIS,
  } = {}) {
    super({ basis });
    Object.assign(this, {
      distance,
      anchorHeight,
      anchorRight,
      anchorForward,
      lockAnchorHeight,
      pitchMin,
      pitchMax,
      lookSensitivity,
      lockLag,
      lockLookBlend,
      positionLag,
      lookLag,
    });
    this.yaw = yaw;
    this.pitch = clamp(pitch, pitchMin, pitchMax);
  }

  setLook(yaw = this.yaw, pitch = this.pitch) {
    this.yaw = yaw;
    this.pitch = clamp(pitch, this.pitchMin, this.pitchMax);
    return this;
  }

  reset({ yaw = 0, pitch = -0.35 } = {}) {
    this.setLook(yaw, pitch);
    this.initialized = false;
    return this;
  }

  step({
    targetPosition,
    lockTargetPosition = null,
    lookDeltaX = 0,
    lookDeltaY = 0,
    yawInput = 0,
    pitchInput = 0,
    deltaSeconds = 1 / 60,
    snapToTarget = false,
    camera = null,
  }) {
    const lookHeld = lookDeltaX !== 0 || lookDeltaY !== 0 || yawInput !== 0 || pitchInput !== 0;
    if (lookDeltaX !== 0 || lookDeltaY !== 0) {
      this.yaw += lookDeltaX * this.lookSensitivity;
      this.pitch = clamp(
        this.pitch + lookDeltaY * this.lookSensitivity,
        this.pitchMin,
        this.pitchMax,
      );
    }
    if (yawInput !== 0 || pitchInput !== 0) {
      this.yaw += yawInput * deltaSeconds;
      this.pitch = clamp(this.pitch + pitchInput * deltaSeconds, this.pitchMin, this.pitchMax);
    }

    const focus = toVec3(targetPosition);
    const playerLookAt = this._anchorFrom(focus, this.anchorHeight);
    let desiredLookAt = playerLookAt;
    const lockPos = lockTargetPosition ? toVec3(lockTargetPosition) : null;

    if (lockPos && !lookHeld) {
      const desiredYaw = this._yawToward(focus, lockPos);
      const yawDelta = Math.atan2(Math.sin(desiredYaw - this.yaw), Math.cos(desiredYaw - this.yaw));
      const blend = snapToTarget || this.lockLag <= 0 ? 1 : smoothingAlpha(this.lockLag, deltaSeconds);
      this.yaw += yawDelta * blend;
    }
    if (lockPos && this.lockLookBlend > 0) {
      const lockLook = this._anchorFrom(lockPos, this.lockAnchorHeight ?? this.anchorHeight);
      desiredLookAt = playerLookAt.clone().lerp(lockLook, clamp(this.lockLookBlend, 0, 1));
    }

    const frame = this.basis.yawPitchRollFrame(this.yaw, this.pitch);
    const desiredPosition = frame.back.clone().multiplyScalar(this.distance).add(desiredLookAt);

    this.smoothVector(this.position, desiredPosition, this.positionLag, deltaSeconds, snapToTarget);
    this.smoothVector(this.lookAt, desiredLookAt, this.lookLag, deltaSeconds, snapToTarget);
    this.setLookAtPose({
      position: this.position,
      lookAt: this.lookAt,
      up: this.basis.upVector(),
    });

    const pose = this.getPose();
    this.applyToCamera(camera, pose);
    return pose;
  }

  _anchorFrom(origin, height) {
    return this.basis.fromBasisComponents(this.anchorRight, height, this.anchorForward).add(origin);
  }

  _yawToward(from, to) {
    const delta = this.basis.planarDelta(to, from);
    if (delta.right * delta.right + delta.forward * delta.forward <= PLANAR_EPS_SQ) return this.yaw;
    return this.basis.forwardToYaw(this.basis.fromBasisComponents(delta.right, 0, delta.forward));
  }
}
