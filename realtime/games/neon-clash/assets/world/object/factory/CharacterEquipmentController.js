import { Group, Vector3, Quaternion, Euler } from 'three';
import { buildEquipmentVisual } from './EquipmentVisualFactory.js';

const DOWN = new Vector3(0, -1, 0), UP = new Vector3(0, 1, 0);
const slotIndex = hand => { if (!['left', 'right'].includes(hand)) throw new RangeError('hand must be left or right'); return hand === 'left' ? 0 : 1; };

/** Character owns attachment, IK and the lifetime of currently equipped items. */
export function createCharacterEquipmentController(kit, context, attachments) {
  const { mesh, chest, arms, p, h, armLength, torsoW } = context;
  const slots = { left: null, right: null }, owner = {}, gripStatus = {};
  const u = armLength * .53, l = armLength * .47, reach = u + l - h * .0001;
  let actionState = null;
  const hoseRoot = new Group(); hoseRoot.name = 'held-water-hose'; mesh.add(hoseRoot);
  const hoseSegments = p.hose ? Array.from({ length: 10 }, () => kit.beam(hoseRoot, 'hose-segment', [0,0,0], [0,.1,0], h * .023, p.colors.accent)) : [];

  function localPoint(item, node) {
    mesh.updateWorldMatrix(true, true);
    return item.mesh.worldToLocal(node.getWorldPosition(new Vector3()));
  }
  function equip(hand, input) {
    slotIndex(hand); kit.assertLive();
    if (input === slots[hand]) return slots[hand];
    const external = Boolean(input?.mesh);
    // Only new, unsized options inherit the holder's height. Explicit sizes and
    // live instances retain their own scale when equipped or transferred.
    const item = input === null ? null : external ? input : buildEquipmentVisual({
      ...input, referenceHeight: input?.referenceHeight === undefined ? h : input.referenceHeight,
    });
    if (item && (!item.attachments?.grip || typeof item.sampleAction !== 'function' || item.disposed)) throw new TypeError('Expected a live EquipmentVisualFactory instance');
    if (item?.owner) throw new Error('Unequip the item from its current hand first');
    item?.claim(owner);
    const old = unequip(hand);
    old?.dispose();
    slots[hand] = item;
    if (item) {
      item.mesh.removeFromParent(); item.mesh.position.set(0,0,0); item.mesh.rotation.set(0,0,0); item.mesh.scale.set(1,1,1);
      item.reset(); item.mesh.updateWorldMatrix(true, true);
      const offset = item.mesh.worldToLocal(item.attachments.grip.getWorldPosition(new Vector3()));
      item.mesh.position.copy(offset).negate(); arms[slotIndex(hand)].hand.add(item.mesh);
      attachments[hand === 'right' ? 'weapon' : 'offhand'] = item.mesh;
    }
    actionState = null;
    return item;
  }
  function unequip(hand) {
    slotIndex(hand); kit.assertLive();
    const item = slots[hand];
    if (!item) return null;
    item.release(owner); item.mesh.removeFromParent(); item.mesh.position.set(0,0,0); item.mesh.rotation.set(0,0,0); item.mesh.scale.set(1,1,1); item.reset();
    slots[hand] = null; delete attachments[hand === 'right' ? 'weapon' : 'offhand'];
    actionState = null; delete gripStatus[hand];
    return item;
  }
  function getActions(hand) {
    slotIndex(hand);
    const other = hand === 'right' ? 'left' : 'right';
    return Object.fromEntries(Object.entries(slots[hand]?.actions ?? {}).filter(([, action]) => !action.freeHand || !slots[other]));
  }
  function validateAction(hand, action, seconds) {
    slotIndex(hand);
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) throw new TypeError('time must be finite');
    if (!getActions(hand)[action]) throw new RangeError(`${hand} hand cannot perform ${action}; equip the required item and free the support hand if needed`);
  }
  // Two-bone IK with fixed limb lengths. Rotation is relative to the chest.
  function holdArm(index, target, rotation) {
    const arm = arms[index], start = arm.shoulder.position;
    const direction = target.clone().sub(start);
    const distance = Math.max(Math.abs(u - l) + h * .0001, Math.min(reach, direction.length()));
    direction.normalize(); const actual = start.clone().addScaledVector(direction, distance);
    const along = (u*u - l*l + distance*distance) / (2*distance);
    const bend = new Vector3(index === 0 ? -.6 : .6, -1, .35);
    bend.addScaledVector(direction, -bend.dot(direction));
    if (bend.lengthSq() < 1e-8) bend.set(0,0,1).addScaledVector(direction, -direction.z);
    bend.normalize();
    const elbowAt = start.clone().addScaledVector(direction, along).addScaledVector(bend, Math.sqrt(Math.max(0,u*u-along*along)));
    arm.shoulder.quaternion.setFromUnitVectors(DOWN, elbowAt.clone().sub(start).normalize());
    const lower = new Quaternion().setFromUnitVectors(DOWN, actual.clone().sub(elbowAt).normalize());
    arm.elbow.quaternion.copy(arm.shoulder.quaternion).invert().multiply(lower);
    arm.hand.quaternion.copy(lower).invert().multiply(rotation);
    return actual;
  }
  function clampSphere(point, center) {
    const delta = point.clone().sub(center);
    if (delta.length() > reach) point.copy(center).addScaledVector(delta.normalize(), reach);
  }
  function fitBoth(target, start, other, offset) {
    const second = other.clone().sub(offset), delta = second.clone().sub(start);
    if (delta.length() > reach * 2) return false;
    // Alternating sphere projections preserve the intended trajectory where reachable.
    for (let i = 0; i < 24; i++) { clampSphere(target, start); clampSphere(target, second); }
    if (target.distanceTo(start) > reach + 1e-6) {
      const mid = start.clone().add(second).multiplyScalar(.5), axis = delta.clone().normalize();
      const radial = target.clone().sub(mid); radial.addScaledVector(axis, -radial.dot(axis));
      const radius = Math.sqrt(Math.max(0, reach*reach - delta.lengthSq()*.25));
      if (radial.length() > radius) radial.setLength(radius);
      target.copy(mid).add(radial);
    }
    return true;
  }
  function apply(motion, seconds, requested = null) {
    actionState = null;
    for (const key of Object.keys(gripStatus)) delete gripStatus[key];
    const samples = {};
    for (const hand of ['left', 'right']) if (slots[hand]) {
      const active = requested?.hand === hand, item = slots[hand];
      item.setPose(active ? requested.action : 'still', active ? seconds : 0);
      samples[hand] = active ? item.sampleAction(requested.action, seconds) : item.getHoldPose();
      if (active) {
        const sample = samples[hand], side = hand === 'right' ? 1 : -1;
        chest.rotation.y += sample.bodyYaw * side; chest.rotation.x += sample.bodyLean;
        actionState = { hand, ...item.actionState };
      }
    }
    const order = requested ? [requested.hand, requested.hand === 'left' ? 'right' : 'left'] : ['right', 'left'];
    for (const hand of order) {
      const item = slots[hand]; if (!item) continue;
      const index = slotIndex(hand), side = index === 1 ? 1 : -1, other = index === 1 ? 'left' : 'right';
      const sample = samples[hand], start = arms[index].shoulder.position;
      const target = start.clone().add(new Vector3(-side * sample.reach[0], sample.reach[1], sample.reach[2]).multiplyScalar(h));
      const rotation = new Quaternion().setFromEuler(new Euler(sample.rotation[0], sample.rotation[1]*side, sample.rotation[2]*side));
      if (sample.yawOffset) rotation.multiply(new Quaternion().setFromAxisAngle(UP, sample.yawOffset));
      if (!requested && ['walk','run'].includes(motion)) target.y += Math.sin(seconds * 8) * h * .007;
      if (!requested && ['walk', 'run'].includes(motion) && p.holdPose === 'swing' && !sample.support) {
        mesh.updateWorldMatrix(true, true);
        chest.worldToLocal(arms[index].hand.getWorldPosition(target));
      }
      const node = item.attachments[sample.support === 'nock' ? 'nock' : 'supportGrip'];
      const useSupport = !slots[other] && node && (sample.support || p.holdPose === 'twoHand');
      let supportAt = null;
      if (useSupport) {
        const offset = localPoint(item, node).sub(localPoint(item, item.attachments.grip));
        const transformed = offset.clone().applyQuaternion(rotation), otherStart = arms[1-index].shoulder.position;
        let fitted = fitBoth(target, start, otherStart, transformed);
        if (!fitted && offset.length() > 1e-6) {
          // Very wide bodies may require turning the item across the chest.
          rotation.setFromUnitVectors(offset.clone().normalize(), otherStart.clone().sub(start).normalize());
          transformed.copy(offset).applyQuaternion(rotation);
          fitted = fitBoth(target, start, otherStart, transformed);
        }
        if (fitted) supportAt = target.clone().add(transformed);
      }
      holdArm(index, target, rotation);
      if (supportAt) holdArm(1-index, supportAt, rotation);
      mesh.updateWorldMatrix(true, true);
      const handAt = arms[index].hand.getWorldPosition(new Vector3());
      gripStatus[hand] = { primaryError: handAt.distanceTo(item.attachments.grip.getWorldPosition(new Vector3())),
        supportUsed: Boolean(supportAt), supportError: supportAt ? arms[1-index].hand.getWorldPosition(new Vector3()).distanceTo(node.getWorldPosition(new Vector3())) : null,
        supportReachable: useSupport ? Boolean(supportAt) : null };
    }
    const hoseItem = Object.values(slots).find(item => item?.attachments.hose);
    hoseRoot.visible = Boolean(hoseItem && hoseSegments.length);
    if (hoseRoot.visible) {
      attachments.hose = hoseRoot;
      const a = mesh.worldToLocal(hoseItem.attachments.hose.getWorldPosition(new Vector3()));
      const side = Math.max(torsoW*.83, a.x+h*.24);
      const b = new Vector3(side, Math.max(h*.04,a.y-h*.24),a.z), c = new Vector3(side,h*.025,h*p.hoseLength*.35), d = new Vector3(side+h*.16,h*.016,h*p.hoseLength);
      const points = Array.from({length:11}, (_,i) => { const t=i/10,v=1-t; return a.clone().multiplyScalar(v**3).addScaledVector(b,3*v*v*t).addScaledVector(c,3*v*t*t).addScaledVector(d,t**3); });
      hoseSegments.forEach((segment,i) => { const direction=points[i+1].clone().sub(points[i]); segment.position.copy(points[i]).add(points[i+1]).multiplyScalar(.5); segment.scale.y=direction.length(); segment.quaternion.setFromUnitVectors(UP,direction.normalize()); });
    } else delete attachments.hose;
  }
  return { equip, unequip, getActions, validateAction, apply,
    get slots() { return { ...slots }; }, get gripStatus() { return structuredClone(gripStatus); }, get actionState() { return actionState ? { ...actionState } : null; },
    dispose() { for (const hand of ['left','right']) unequip(hand)?.dispose(); hoseRoot.removeFromParent(); },
  };
}
