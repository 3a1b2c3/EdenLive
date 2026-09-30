import { freezeConfig } from './VisualFactoryUtils.js';

// Equipment owns its capabilities and choreography. Positions are proportions
// of the holder's height relative to the holding shoulder; no character rig here.
const action = (label, duration, loop = false, freeHand = false) => ({ label, duration, loop, freeHand });
const ACTIONS = freezeConfig({
  slash: action('slash', 1.1), thrust: action('thrust', .95), chop: action('chop', 1.5), smash: action('smash', 1.6),
  cast: action('cast', 1.8), block: action('block', 2, true), bash: action('bash', 1.1),
  aim: action('aim', 2, true), fire: action('fire', .7),
  draw: action('draw bow', 2, true, true), loose: action('loose arrow', 1.7, false, true),
  spray: action('spray', 3, true), inject: action('inject', 2), scan: action('scan', 3.5, true),
  talk: action('talk', 2.5, true), heal: action('open medkit', 2.6), read: action('read', 3, true),
});

export function equipmentActions(p) {
  const ids = {
    blade: ['slash', 'thrust'], axe: ['chop'], hammer: ['smash'], mace: ['smash'], spear: ['thrust'],
    staff: ['cast'], wand: ['cast'], bow: ['draw', 'loose'], crossbow: ['aim', 'fire'],
    shield: ['block', 'bash'], book: ['read', 'cast'], orb: ['cast'], firearm: ['aim', 'fire'],
    waterNozzle: ['spray'], syringe: ['inject'], flashlight: ['scan'], radio: ['talk'], medkit: ['heal'], clipboard: ['read'],
  }[p.kind];
  return freezeConfig(Object.fromEntries(ids.map(id => [id, { ...ACTIONS[id] }])));
}

const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const ramp = (t, a, b) => smooth((t - a) / (b - a));
const pulse = (t, a, b, c) => ramp(t, a, b) * (1 - ramp(t, b, c));
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);

export function equipmentHold(p) {
  const kind = p.kind;
  const pose = { reach: [.02, -.19, -.12], rotation: [0, 0, 0], yawOffset: 0, support: false,
    bodyYaw: 0, bodyLean: 0, draw: 0, release: 0, press: 0, open: 0, energy: 0, recoil: 0 };
  if (['firearm', 'crossbow', 'waterNozzle'].includes(kind)) {
    pose.reach = [.06, -.13, -.13]; pose.rotation = [0, .45, 0];
    pose.support = kind !== 'firearm' || p.firearmType !== 'pistol';
  } else if (kind === 'bow') {
    pose.reach = [.01, -.14, -.17]; pose.rotation = [0, .2, 0];
    pose.support = 'nock';
  } else if (kind === 'spear') {
    pose.rotation = [-.55, .15, 0]; pose.support = true;
  } else if (['axe', 'hammer', 'mace'].includes(kind)) {
    // The striking face is along local +X. This fixed alignment must not mirror
    // with the holder's hand, or a left-handed axe would strike backwards.
    pose.rotation = [-.15, 0, .1]; pose.yawOffset = Math.PI / 2;
    pose.support = p.sizeRatio >= .65;
  } else if (kind === 'blade') {
    pose.rotation = [-.18, 0, -.08]; pose.support = p.gripLength >= .3;
  } else if (kind === 'medkit') {
    pose.reach = [-.025, -.255, -.025];
  } else if (kind === 'shield') {
    pose.reach = [.02, -.17, -.15];
  } else if (['book', 'clipboard'].includes(kind)) {
    pose.reach = [.025, -.15, -.15]; pose.rotation = [.5, Math.PI, 0];
  }
  return pose;
}

/** Deterministic absolute-time action sample; all one-shots return their hands to rest. */
export function sampleEquipmentAction(p, id, seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) throw new TypeError('time must be finite');
  const spec = equipmentActions(p)[id];
  if (!spec) throw new RangeError(`${p.kind} does not support action ${id}`);
  const elapsed = Math.max(0, seconds) * p.actionSpeed;
  const t = Math.min(1, elapsed / spec.duration), hold = equipmentHold(p);
  const pose = { ...hold, progress: t, finished: !spec.loop && t >= 1, active: false };
  const inWeight = ramp(t, 0, .22), envelope = spec.loop ? inWeight : pulse(t, 0, .25, 1);
  let reach = hold.reach, rotation = hold.rotation;
  if (id === 'slash') {
    const swing = ramp(t, .25, .53), recover = ramp(t, .65, 1);
    reach = mix([-.04, -.045, -.1], [.13, -.16, -.17], swing);
    rotation = mix([.3, -.7, -.95], [-1.55, .5, 1.05], swing);
    pose.bodyYaw = (.22 - swing * .48) * envelope;
    pose.active = t >= .28 && t <= .56;
    const weight = ramp(t, 0, .2) * (1 - recover) * p.actionAmount;
    pose.reach = mix(hold.reach, reach, weight);
    pose.rotation = mix(hold.rotation, rotation, weight);
    pose.bodyYaw *= p.actionAmount;
    return pose;
  }
  if (id === 'thrust') {
    const hit = pulse(t, .22, .48, .82);
    reach = [.025, -.105, -.11 - hit * .15]; rotation = [-Math.PI / 2, .05, 0];
    pose.bodyLean = -.1 * hit; pose.active = t >= .3 && t <= .6;
  } else if (id === 'chop' || id === 'smash') {
    const hit = ramp(t, .3, .55);
    reach = mix([.04, .025, -.08], [.07, -.18, -.18], hit);
    rotation = mix([.7, 0, -.15], [-1.25, 0, .1], hit);
    pose.bodyLean = -.14 * envelope * hit; pose.active = t >= .35 && t <= .6;
  } else if (id === 'cast') {
    reach = [.04, -.065, -.2];
    rotation = p.kind === 'book' ? [.75, Math.PI, 0] : p.kind === 'orb' ? [-.6, 0, 0] : [-.7, 0, 0];
    pose.energy = pulse(t, .15, .55, .9); pose.open = envelope; pose.active = t >= .45 && t <= .7;
  } else if (id === 'block' || id === 'bash') {
    const hit = id === 'bash' ? pulse(t, .22, .45, .8) : 0;
    reach = [.07, -.08, -.16 - hit * .09]; rotation = [0, .08, 0];
    pose.active = id === 'block' ? t >= .2 : t >= .28 && t <= .6;
  } else if (id === 'aim' || id === 'fire') {
    const kick = id === 'fire' ? pulse(t, .25, .32, .52) : 0;
    reach = [.08, -.055 + kick * .012, -.13 + kick * .028]; rotation = [.04 + kick * .18, .12, 0];
    pose.recoil = kick; pose.support = hold.support; pose.active = id === 'fire' && t >= .25 && t <= .4;
    if (p.kind === 'crossbow') { pose.draw = id === 'aim' ? inWeight : inWeight * (1 - ramp(t, .26, .34)); pose.release = id === 'fire' ? ramp(t, .26, .36) : 0; }
  } else if (id === 'draw' || id === 'loose') {
    reach = [.03, -.055, -.235]; rotation = [0, .1, 0]; pose.support = 'nock';
    pose.draw = id === 'draw' ? ramp(t, .06, .4) : pulse(t, .06, .48, .59);
    pose.release = id === 'loose' ? ramp(t, .5, .62) : 0;
    pose.active = id === 'loose' && t >= .5 && t <= .62;
  } else if (id === 'spray') {
    reach = [.07, -.13, -.14]; rotation = [-.03, .3 + Math.sin(elapsed * 1.8) * .35, 0];
    pose.press = inWeight; pose.support = true; pose.active = t >= .2;
  } else if (id === 'inject') {
    reach = [.02, -.12, -.19 - pulse(t, .2, .4, .8) * .04]; rotation = [-Math.PI / 2, 0, 0];
    pose.press = ramp(t, .35, .72); pose.active = t >= .35 && t <= .72;
  } else if (id === 'scan') {
    reach = [.025, -.075, -.16]; rotation = [.04 + Math.sin(elapsed * 1.1) * .15, Math.sin(elapsed * 1.8) * .65, 0];
    pose.active = t >= .2;
  } else if (id === 'talk') {
    reach = [.1, .015, -.12]; rotation = [.12, Math.PI, -.08];
    pose.bodyYaw = Math.sin(elapsed * 2.3) * .035 * inWeight; pose.active = t >= .2;
  } else if (id === 'heal') {
    reach = [.04, -.14, -.17]; rotation = [-.1, 0, 0]; pose.open = envelope; pose.active = t >= .25 && t <= .75;
  } else if (id === 'read') {
    reach = [.05, -.08, -.16]; rotation = [.65, Math.PI, 0]; pose.open = inWeight; pose.active = t >= .2;
  }
  const weight = envelope * p.actionAmount;
  pose.bodyYaw *= p.actionAmount; pose.bodyLean *= p.actionAmount;
  pose.reach = mix(hold.reach, reach, weight); pose.rotation = mix(hold.rotation, rotation, weight);
  return pose;
}

// Only articulated equipment parts move here. The main grip never moves:
// Character applies the shoulder-relative trajectory to its own rig.
export function createEquipmentArticulation(p, parts) {
  const rig = parts.rig ?? {}, snapshots = [];
  parts.root.traverse(node => snapshots.push({ node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(), visible: node.visible }));
  const reset = () => snapshots.forEach(s => { s.node.position.copy(s.position); s.node.quaternion.copy(s.quaternion); s.node.scale.copy(s.scale); s.node.visible = s.visible; });
  return pose => {
    reset();
    if (!pose) return;
    if (rig.slide) rig.slide.position.z += rig.slide.scale.z * .15 * pose.recoil;
    if (rig.valve) rig.valve.rotation.x = -.4 * pose.press;
    if (rig.plunger) {
      for (const node of rig.plunger) node.position.y += rig.stroke * pose.press;
      if (rig.liquid) { const height = rig.liquid.scale.y; rig.liquid.scale.y *= 1 - pose.press; rig.liquid.position.y -= height * pose.press / 2; }
    }
    if (rig.caseLid) rig.caseLid.rotation.x = 1.5 * pose.open;
    if (rig.cover) rig.cover.rotation.y = -1.8 * pose.open;
    if (rig.bookHalves) rig.bookHalves.forEach((node, i) => { node.rotation.y *= 1 - pose.open * .7; });
    if (rig.orb) rig.orb.scale.multiplyScalar(1 + pose.energy * .12);
    for (const node of rig.rings ?? []) node.rotation.y += pose.energy * 1.6;
    if (rig.bow) rig.bow.update(pose.draw, pose.release);
  };
}