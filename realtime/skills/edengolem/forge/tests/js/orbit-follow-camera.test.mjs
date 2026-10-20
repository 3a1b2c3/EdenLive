import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';

import { OrbitFollowCameraRig } from '../../../assets/camera/OrbitFollowCameraRig.js';
import { LookOffsetCameraRig } from '../../../assets/camera/LookOffsetCameraRig.js';
import { CameraRelativeCharacterMotionController } from '../../../assets/actor-motion/character/CameraRelativeCharacterMotionController.js';
import { DEFAULT_WORLD_BASIS as BASIS } from '../../../assets/math/WorldBasis.js';

const ORIGIN = { x: 0, y: 0, z: 0 };
const FRAME = 1 / 60;

test('default orbit sits above a body-height look-at', () => {
  const rig = new OrbitFollowCameraRig();
  const pose = rig.step({ targetPosition: ORIGIN, snapToTarget: true });
  assert.ok(BASIS.upComponent(pose.lookAt) - 1.2 < 1e-9
    && 1.2 - BASIS.upComponent(pose.lookAt) < 1e-9);
  assert.ok(BASIS.upComponent(pose.position) > BASIS.upComponent(pose.lookAt));
});

test('orbit yaw stays after look input stops, unlike LookOffset recenter', () => {
  const orbit = new OrbitFollowCameraRig({
    lookSensitivity: 1, yaw: 0, pitch: 0, distance: 8, anchorHeight: 0,
  });
  orbit.step({ targetPosition: ORIGIN, lookDeltaX: 0.4, lookDeltaY: 0, deltaSeconds: FRAME });
  assert.ok(Math.abs(orbit.yaw - 0.4) < 1e-9);
  orbit.step({ targetPosition: ORIGIN, lookDeltaX: 0, lookDeltaY: 0, deltaSeconds: 1 });
  assert.ok(Math.abs(orbit.yaw - 0.4) < 1e-9);

  const peek = new LookOffsetCameraRig({ lookSensitivity: 1, returnLag: 0.17, distance: 8 });
  peek.step({
    targetPosition: ORIGIN, lookActive: true, lookDeltaX: 0.4, lookDeltaY: 0, deltaSeconds: FRAME,
  });
  peek.step({
    targetPosition: ORIGIN, lookActive: false, lookDeltaX: 0, lookDeltaY: 0, deltaSeconds: 2,
  });
  assert.ok(Math.abs(peek.cameraYaw) < 0.02, 'LookOffset recenters once look input stops');
});

test('look-at uses the body-height anchor, not the target origin', () => {
  const rig = new OrbitFollowCameraRig({
    distance: 8, anchorHeight: 1.2, yaw: 0, pitch: 0, positionLag: 0, lookLag: 0,
  });
  const pose = rig.step({ targetPosition: { x: 3, y: 0, z: -2 }, snapToTarget: true });
  const target = { x: 3, y: 0, z: -2 };
  assert.ok(Math.abs(BASIS.rightComponent(pose.lookAt) - BASIS.rightComponent(target)) < 1e-9);
  assert.ok(Math.abs(BASIS.forwardComponent(pose.lookAt) - BASIS.forwardComponent(target)) < 1e-9);
  assert.ok(Math.abs(BASIS.upComponent(pose.lookAt) - 1.2) < 1e-9);
  assert.ok(Math.abs(pose.position.distanceTo(pose.lookAt) - 8) < 1e-6);
});

test('pitch stays inside the configured range', () => {
  const rig = new OrbitFollowCameraRig({
    yaw: 0, pitch: 0, pitchMin: -0.5, pitchMax: 0.25, lookSensitivity: 1,
  });
  rig.step({ targetPosition: ORIGIN, lookDeltaX: 0, lookDeltaY: 4, deltaSeconds: FRAME });
  assert.equal(rig.pitch, 0.25);
  rig.step({ targetPosition: ORIGIN, lookDeltaX: 0, lookDeltaY: -8, deltaSeconds: FRAME });
  assert.equal(rig.pitch, -0.5);
});

test('lock-on yaws toward the target and keeps the player look-at when blend is 0', () => {
  const rig = new OrbitFollowCameraRig({
    distance: 8, anchorHeight: 1.2, lockLag: 0, lockLookBlend: 0, yaw: 0, pitch: -0.3,
  });
  const lock = { x: 10, y: 0, z: 0 };
  const pose = rig.step({
    targetPosition: ORIGIN, lockTargetPosition: lock, snapToTarget: true,
  });
  const desired = BASIS.forwardToYaw(new Vector3(10, 0, 0));
  assert.ok(Math.abs(rig.yaw - desired) < 1e-6);
  assert.ok(Math.abs(BASIS.rightComponent(pose.lookAt)) < 1e-6);
  assert.ok(Math.abs(BASIS.upComponent(pose.lookAt) - 1.2) < 1e-6);
});

test('lockLookBlend slides the look-at toward the lock target without a centering rule', () => {
  const rig = new OrbitFollowCameraRig({
    distance: 8, anchorHeight: 1.2, lockAnchorHeight: 1.2, lockLag: 0, lockLookBlend: 1,
    yaw: 0, pitch: 0,
  });
  const pose = rig.step({
    targetPosition: ORIGIN, lockTargetPosition: { x: 10, y: 0, z: 0 }, snapToTarget: true,
  });
  assert.ok(Math.abs(BASIS.rightComponent(pose.lookAt) - 10) < 1e-6);
  assert.ok(Math.abs(BASIS.upComponent(pose.lookAt) - 1.2) < 1e-6);
});

test('held look input wins over lock yaw on that frame', () => {
  const rig = new OrbitFollowCameraRig({ yaw: 0, lockLag: 0, lookSensitivity: 0, pitch: 0 });
  rig.step({
    targetPosition: ORIGIN,
    lockTargetPosition: { x: 10, y: 0, z: 0 },
    yawInput: 1,
    deltaSeconds: 0.5,
  });
  assert.ok(Math.abs(rig.yaw - 0.5) < 1e-9);
});

test('reset restores look and snaps on the next step', () => {
  const rig = new OrbitFollowCameraRig({ yaw: 1, pitch: -0.2, distance: 8, anchorHeight: 1.2 });
  rig.step({ targetPosition: { x: 4, y: 0, z: 4 }, snapToTarget: true });
  rig.reset({ yaw: 0, pitch: 0 });
  assert.equal(rig.yaw, 0);
  assert.equal(rig.pitch, 0);
  const pose = rig.step({ targetPosition: ORIGIN, deltaSeconds: FRAME });
  assert.ok(Math.abs(BASIS.upComponent(pose.lookAt) - 1.2) < 1e-6);
});

test('forward input follows orbit yaw rather than actor yaw', () => {
  const motion = new CameraRelativeCharacterMotionController({
    walkSpeed: 6, accelerationLag: 0, decelerationLag: 0, turnLag: 0,
  });
  motion.setState({ position: new Vector3(), yaw: 0 });
  motion.planMovement({
    forward: 1, cameraYaw: -Math.PI / 2, deltaSeconds: 1, commit: true,
  });
  assert.ok(BASIS.rightComponent(motion.position) > 5);
  assert.ok(Math.abs(BASIS.forwardComponent(motion.position)) < 1e-6);
});

test('lock faceTarget turns the actor while strafing stays camera-relative', () => {
  const motion = new CameraRelativeCharacterMotionController({
    walkSpeed: 6, accelerationLag: 0, decelerationLag: 0, turnLag: 0,
  });
  motion.setState({ position: new Vector3(), yaw: 0 });
  motion.planMovement({
    strafeRight: 1,
    cameraYaw: 0,
    faceTarget: BASIS.fromBasisComponents(4, 0, 0),
    deltaSeconds: 1,
    commit: true,
  });
  assert.ok(BASIS.rightComponent(motion.position) > 5);
  const lockYaw = BASIS.forwardToYaw(BASIS.fromBasisComponents(4, 0, 0));
  assert.ok(Math.abs(motion.yaw - lockYaw) < 1e-6);
  assert.ok(Math.abs(lockYaw) > 1, 'lock facing must differ from the start yaw');
});

test('orbit then walk forward uses the new camera heading', () => {
  const rig = new OrbitFollowCameraRig({
    yaw: 0, pitch: 0, lookSensitivity: 1, distance: 8, anchorHeight: 0,
  });
  rig.step({ targetPosition: ORIGIN, lookDeltaX: -Math.PI / 2, deltaSeconds: FRAME });
  const motion = new CameraRelativeCharacterMotionController({
    walkSpeed: 1, accelerationLag: 0, decelerationLag: 0, turnLag: 0,
  });
  motion.setState({ position: new Vector3(), yaw: 0 });
  motion.planMovement({
    forward: 1, cameraYaw: rig.yaw, deltaSeconds: 1, commit: true,
  });
  assert.ok(BASIS.rightComponent(motion.position) > 0.5);
  assert.ok(Math.abs(BASIS.forwardComponent(motion.position)) < 1e-6);
});

test('cameraYaw is required so a missing orbit cannot silently become heading-relative', () => {
  const motion = new CameraRelativeCharacterMotionController();
  assert.throws(
    () => motion.planMovement({ forward: 1, deltaSeconds: FRAME }),
    /cameraYaw is required/,
  );
});
