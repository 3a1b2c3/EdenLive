import { Group, Matrix4, Vector3 } from 'three';
import { freezeConfig } from './VisualFactoryUtils.js';

export const CREATURE_ACTIONS = freezeConfig({
  pounce: { label: 'pounce (once)', loop: false },
  charge: { label: 'charge (once)', loop: false },
  death: { label: 'death fall (hold)', loop: false },
});
export const ANIMAL_MOTIONS = freezeConfig({ still: 'still pose', idle: 'idle', move: 'move',
  ...Object.fromEntries(Object.entries(CREATURE_ACTIONS).map(([id, action]) => [id, action.label])) });

const number = (label, value, min, max, step = .05) => ({ group: 'combat actions', label, default: value, min, max, step, randomize: false });
export const CREATURE_ACTION_SCHEMA = freezeConfig({
  actionSpeed: number('action speed', 1, .2, 3),
  pounceDistance: number('pounce distance / rest length', .65, 0, 2),
  pounceHeight: number('pounce height / rest height', .28, 0, 1.2),
  pounceDuration: number('pounce duration (s)', 1.2, .3, 3),
  chargeDistance: number('charge distance / rest length', 1, 0, 3),
  chargeDuration: number('charge duration (s)', 1.35, .3, 3),
  deathDuration: number('death duration (s)', 1.1, .3, 3),
  deathSide: { group: 'combat actions', label: 'fall to', default: 'right', choices: { right: 'right', left: 'left' }, randomize: false },
});

export function animalMotionLabels(family) {
  return { ...ANIMAL_MOTIONS, move: { quadruped: 'walk', bird: 'flap / glide', fish: 'swim' }[family],
    pounce: family === 'bird' ? 'pounce / swoop (once)' : family === 'fish' ? 'pounce / lunge (once)' : ANIMAL_MOTIONS.pounce };
}

const clamp = n => Math.max(0, Math.min(1, n));
const smooth = n => { const t = clamp(n); return t * t * (3 - 2 * t); };
const wingAngle = (wing, value) => { wing.root.rotation.z += wing.mirrored ? value : wing.side * value; };

// Shared timing and travel; the pose below follows each factory's anatomy.
function combatPose(rig, motion, family, p, id, u, height) {
  const { body, head, chest, neck, jaw, tail, core, orbit, legs = [], arms = [], wings = [], fins = [], tentacles = [], fragments = [], limbs = [] } = rig;
  if (id === 'death') {
    const fall = smooth(u), side = p.deathSide === 'right' ? -1 : 1;
    if (family === 'slime' || family === 'jellyfish') {
      const target = family === 'slime' ? body : motion;
      target.scale.set(1 + fall * .5, 1 - fall * .86, 1 + fall * .4);
      tentacles.forEach(({ root }, i) => { root.rotation.z += (i % 2 ? 1 : -1) * fall * 1.1; });
    } else if (family === 'elemental' && p.elementForm !== 'golem') {
      body.scale.y *= 1 - fall * .76;
      body.rotation.z += side * fall * .18;
    } else {
      motion.rotation.z += side * fall * (family === 'fish' ? Math.PI : Math.PI / 2);
      // A broad stone body lands on its chest; a pure side roll would stand its
      // outstretched arms and orbit ring vertically above the floor.
      if (family === 'elemental') motion.rotation.x -= fall * Math.PI / 2;
    }
    legs.forEach(({ root, knee, foot, side: legSide = 1 }, i) => {
      root.rotation.x += fall * (family === 'bird' ? .7 : .42 + (i % 2) * .24);
      root.rotation.z += legSide * fall * .16;
      if (knee) knee.rotation.x += fall * (family === 'humanoid' ? .85 : -.85);
      if (foot) foot.rotation.x += fall * .2;
    });
    arms.forEach(({ root, elbow, side: armSide }) => {
      root.rotation.x += fall * -.35; root.rotation.z += armSide * fall * .35;
      elbow.rotation.x += fall * .45;
    });
    wings.forEach(wing => {
      if (wing.mirrored) { wing.root.rotation.y -= wing.side * fall * 1.55; wingAngle(wing, -.12 * fall); }
      else wingAngle(wing, 1.15 * fall);
    });
    if (neck && family === 'dragon') neck.rotation.x -= fall * .32;
    if (head) { head.rotation.x -= fall * .22; head.rotation.z += side * fall * .12; }
    if (jaw) jaw.rotation.x += fall * .2;
    if (chest) chest.rotation.x -= fall * .2;
    if (tail) tail.rotation.y += side * fall * .32;
    fins.forEach(({ root, side: finSide = 1 }) => { root.rotation.z += finSide * fall * .45; });
    if (core) core.scale.multiplyScalar(1 - fall * .65);
    if (orbit) {
      orbit.position.y *= 1 - fall * .8;
      if (p.elementForm === 'golem') orbit.scale.multiplyScalar(1 - fall * .85);
    }
    fragments.forEach(({ root, kind }, i) => {
      root.position.x *= 1 + fall * .65; root.position.z *= 1 + fall * .65;
      if (kind === 'shard') root.position.y *= 1 - fall;
      root.rotation.z += (i % 2 ? 1 : -1) * fall * .8;
    });
    limbs.forEach(({ arm, leg, side: limbSide }) => {
      arm.rotation.z += limbSide * fall * .6;
      if (leg) leg.rotation.x += fall * .5;
    });
    if (rig.cloak) rig.cloak.rotation.x += fall * .16;
    return 0;
  }

  const pouncing = id === 'pounce', end = pouncing ? .72 : .8;
  const flight = clamp((u - .2) / (end - .2));
  const envelope = smooth(u / .2) * (1 - smooth((u - end) / (1 - end)));
  const air = Math.sin(Math.PI * flight), stride = Math.sin(flight * Math.PI * 10) * envelope;
  const crouch = smooth(u / .2) * (1 - smooth((u - .2) / .14))
    + (pouncing ? .45 * smooth((u - .64) / .08) * (1 - smooth((u - .72) / .28)) : 0);
  motion.rotation.x -= (pouncing ? .14 * air : .2 * envelope);
  if (family === 'slime' || family === 'jellyfish') {
    const squash = pouncing ? -.3 * crouch + .24 * air : -.18 * envelope;
    const target = family === 'slime' ? body : motion;
    target.scale.set(1 / Math.sqrt(1 + squash), 1 + squash, 1 / Math.sqrt(1 + squash));
    if (!pouncing) target.scale.z *= 1 + .3 * envelope;
  }
  legs.forEach(({ root, knee, foot, side = 1, front = 1 }) => {
    const humanoid = family === 'humanoid';
    const swing = pouncing ? (front < 0 ? .95 : -.55) * air + .3 * crouch : stride * (side * front < 0 ? -1 : 1) * .7;
    root.rotation.x += family === 'bird' ? .75 * air + .22 * envelope : swing;
    if (knee) knee.rotation.x += (humanoid ? 1 : -1) * (crouch * .85 + air * .45 + Math.max(0, -swing) * .45);
    if (foot) foot.rotation.x -= swing * .3;
  });
  arms.forEach(({ root, elbow, side }) => {
    root.rotation.x += pouncing ? 1.35 * air + .45 * envelope : 1.15 * envelope + side * stride * .14;
    elbow.rotation.x += .25 * envelope;
    root.rotation.z += side * .15 * envelope;
  });
  wings.forEach(wing => {
    wingAngle(wing, pouncing ? -.55 * Math.sin(flight * Math.PI * 2) * envelope : .85 * envelope);
    if (wing.mirrored && !pouncing) wing.root.rotation.y -= wing.side * .95 * envelope;
  });
  if (head) head.rotation.x -= (pouncing ? .1 : .25) * envelope;
  if (neck && family === 'dragon') neck.rotation.x -= .2 * envelope;
  if (jaw) jaw.rotation.x += (pouncing ? .35 : .1) * envelope;
  if (chest) chest.rotation.x -= .2 * envelope;
  if (tail) tail.rotation.y += stride * (family === 'fish' ? .5 : .12);
  fins.forEach(({ root }, i) => { root.rotation.z += stride * (i % 2 ? 1 : -1) * .25; });
  tentacles.forEach(({ root }, i) => { root.rotation.x += envelope * .8 + stride * (i % 2 ? .1 : -.1); });
  if (core) core.scale.multiplyScalar(1 + .2 * envelope);
  if (orbit) orbit.rotation.y += flight * Math.PI * 2 * envelope;
  fragments.forEach(({ root, kind }) => { if (kind === 'shard') root.position.z -= height * .12 * envelope; });
  limbs.forEach(({ arm, leg, side }) => {
    arm.rotation.x += envelope * 1.15;
    if (leg) leg.rotation.x += stride * side * .35;
  });
  if (rig.cloak) rig.cloak.rotation.x -= .4 * envelope;
  return pouncing ? air * p.pounceHeight * height : (['quadruped', 'humanoid', 'dragon'].includes(family) ? Math.abs(stride) * .025 * height : 0);
}

/** Install after neutral grounding. Caller-owned mesh transforms are never changed. */
export function installCreatureActions(api, kit, { motion, rig, family, animate, labels = ANIMAL_MOTIONS, scale = 1, numericTime = false }) {
  const p = api.params, parent = motion.parent;
  const heading = new Group(), travel = new Group();
  heading.name = 'creature-heading'; travel.name = 'creature-travel';
  parent.add(heading); heading.add(travel); travel.add(motion);
  const height = api.dimensions.y / scale, length = api.dimensions.z / scale;
  const attack = new Group(); attack.name = 'attack-direction';
  attack.position.set(0, height * .5, api.bounds.min.z / scale);
  travel.add(attack);
  api.attachments.attack = attack;
  api.actionRig = { heading, travel };
  api.actions = freezeConfig(Object.fromEntries(Object.entries(CREATURE_ACTIONS).map(([id, spec]) =>
    [id, { ...spec, duration: p[`${id}Duration`] / p.actionSpeed }])));

  // Cached local chains make grounding independent of external parents and scales.
  const nodes = [];
  function cache(object, parentNode) {
    const node = { object, parent: parentNode, matrix: new Matrix4(), vertices: object.geometry?.attributes.position,
      position: object.position.clone(), rotation: object.quaternion.clone(), scale: object.scale.clone() };
    nodes.push(node); object.children.forEach(child => cache(child, node));
  }
  cache(motion, null);
  const restore = () => {
    for (const n of nodes) { n.object.position.copy(n.position); n.object.quaternion.copy(n.rotation); n.object.scale.copy(n.scale); }
  };
  function groundHeight() {
    let min = Infinity;
    for (const { object, parent: parentNode, matrix, vertices } of nodes) {
      object.updateMatrix();
      if (parentNode) matrix.multiplyMatrices(parentNode.matrix, object.matrix); else matrix.copy(object.matrix);
      if (!vertices) continue;
      const e = matrix.elements;
      for (let i = 0; i < vertices.count; i++) min = Math.min(min,
        e[1] * vertices.getX(i) + e[5] * vertices.getY(i) + e[9] * vertices.getZ(i) + e[13]);
    }
    return min;
  }
  let state;
  Object.defineProperty(api, 'actionState', { enumerable: true, get: () => ({ ...state }) });
  api.getAttackFrame = () => {
    kit.assertLive(); attack.updateWorldMatrix(true, false);
    const origin = attack.getWorldPosition(new Vector3());
    const direction = attack.localToWorld(new Vector3(0, 0, -1)).sub(origin).normalize();
    return { origin, direction };
  };
  api.setPose = (action = numericTime ? 'move' : 'idle', seconds = 0, options = {}) => {
    kit.assertLive();
    if (numericTime && typeof action === 'number') { seconds = action; action = 'move'; }
    if (!Object.hasOwn(labels, action)) throw new RangeError(`unknown creature motion: ${action}`);
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) throw new TypeError('time must be finite');
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('pose options must be an object');
    const angle = options.heading ?? 0, inPlace = options.inPlace ?? false;
    if (typeof angle !== 'number' || !Number.isFinite(angle)) throw new TypeError('heading must be finite radians');
    if (typeof inPlace !== 'boolean') throw new TypeError('inPlace must be boolean');
    restore(); heading.rotation.y = angle; travel.position.set(0, 0, 0);
    const spec = api.actions[action], progress = spec ? clamp(Math.max(0, seconds) / spec.duration) : 0;
    const end = action === 'pounce' ? .72 : .8;
    state = { id: action, progress, finished: Boolean(spec && progress >= 1),
      active: Boolean(spec && action !== 'death' && progress >= .2 && progress < end),
      phase: !spec ? (action === 'still' ? 'still' : 'loop') : progress >= 1 ? 'finished' : action === 'death' ? 'falling'
        : progress < .2 ? 'windup' : progress < end ? 'active' : 'recover', heading: angle, inPlace };
    if (spec) {
      travel.position.y = combatPose(rig, motion, family, p, action, progress, height);
      if (action !== 'death' && !inPlace) travel.position.z = -p[`${action}Distance`] * length * smooth((progress - .2) / (end - .2));
      motion.position.y -= groundHeight();
    } else if (action !== 'still') {
      const lift = animate(action, seconds) ?? 0;
      motion.position.y += lift - groundHeight();
    }
    api.mesh.updateMatrixWorld(true);
    return api;
  };
  api.reset = () => api.setPose('still', 0);
  return api.reset();
}