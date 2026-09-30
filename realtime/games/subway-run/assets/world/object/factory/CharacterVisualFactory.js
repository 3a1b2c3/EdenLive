import { Group } from 'three';
import { choiceOption as choice, createPrimitiveKit, freezeConfig, measure,
  normalizeFactoryOptions, randomFactoryOptions } from './VisualFactoryUtils.js';
import { createCharacterEquipmentController } from './CharacterEquipmentController.js';
import { normalizeCharacterLoadout } from './CharacterLoadout.js';

// Simplified humanoid: head, torso, two arms, two legs. Clothing layers, armor,
// hats, hair and shoes are gone, and every proportion except overall height and
// girth is locked to a default. Handheld equipment is kept: the arms still have
// elbow and hand joints so the shared grip IK works unchanged.
// The Simple-prefixed exports are canonical; the unprefixed aliases at the end
// keep this module's historical name and consumers unchanged.
export const SIMPLE_CHARACTER_MOTIONS = Object.freeze({ idle: 'idle', walk: 'walk', run: 'run' });
const MOTION_IDS = Object.keys(SIMPLE_CHARACTER_MOTIONS);

// Locked proportions. The detailed factory exposes each of these as a slider.
const LEG_RATIO = 0.46, HEAD_RATIO = 0.2, TORSO_DEPTH = 0.62, ARM_RATIO = 0.32;
const UPPER_ARM = 0.53, FOREARM = 0.47;

// Same preset keys as the detailed factory so exported configurations stay
// comparable. Outfits are dropped; the weapon / offhand keys are kept because
// they feed the shared loadout adapter.
export const SIMPLE_CHARACTER_PRESETS = freezeConfig({
  runner: { height: 2.2, build: 1 },
  child: { height: 1.3, build: 0.88 },
  tall: { height: 2.85, build: 0.7 },
  stocky: { height: 1.7, build: 1.42 },
  heavy: { height: 2.15, build: 1.7 },
  sprinter: { height: 2.4, build: 0.83 },
  worker: { height: 2.12, build: 1.2, colors: { top: '#ffc253', pants: '#4a5560' } },
  hiker: { height: 2.05, build: 0.95, colors: { top: '#75af7b', pants: '#4d5b4a' } },
  commuter: { height: 2.35, build: 0.85, colors: { top: '#7186b5', pants: '#39445c' } },
  blocky: { height: 1.85, build: 1.15, headShape: 'box' },
  mage: { height: 2.25, build: 0.86, weapon: 'staff', offhand: 'book', emblem: 'gem',
    colors: { top: '#737cae', pants: '#515c8a', accent: '#ebc476' } },
  warrior: { height: 2.35, build: 1.2, weapon: 'sword', offhand: 'roundShield', emblem: 'chevron',
    colors: { top: '#ad6253', pants: '#574c44', accent: '#e8be76' } },
  rogue: { height: 2.1, build: 0.78, weapon: 'dagger', offhand: 'dagger',
    colors: { top: '#465568', pants: '#303c4c', accent: '#9fb9b1' } },
  soldier: { height: 2.2, build: 1.12, weapon: 'spear', offhand: 'kiteShield', emblem: 'chevron',
    colors: { top: '#6b8497', pants: '#4a5b68', accent: '#dfbf7b' } },
  paladin: { height: 2.5, build: 1.18, weapon: 'hammer', offhand: 'kiteShield', emblem: 'sun',
    colors: { top: '#e4debf', pants: '#bcbda5', accent: '#d8af63' } },
  ranger: { height: 2.25, build: 0.84, weapon: 'bow',
    colors: { top: '#6e9073', pants: '#535d49', accent: '#d6bf83' } },
  cleric: { height: 2.2, build: 0.94, weapon: 'staff', staffTop: 'cross', offhand: 'book', emblem: 'cross',
    colors: { top: '#e7dfc6', pants: '#b8cab8', accent: '#d3a45d' } },
  barbarian: { height: 2.6, build: 1.45, weapon: 'axe', weaponScale: 1.2,
    colors: { top: '#a27c58', pants: '#605040', accent: '#d8bd84' } },
  monk: { height: 2.1, build: 0.86, colors: { top: '#d89d55', pants: '#795c46', accent: '#9d5e48' } },
  necromancer: { height: 2.4, build: 0.72, weapon: 'staff', staffTop: 'fork', offhand: 'orb', emblem: 'gem',
    colors: { top: '#54536d', pants: '#373d53', accent: '#9dccb7', magic: '#8cdbc0' } },
  modernSoldier: { height: 2.25, build: 1.08, weapon: 'rifle', holdPose: 'twoHand', gunSight: 'reflex',
    colors: { top: '#7e8a62', pants: '#637553', accent: '#b9bd87', equipment: '#3e4c49' } },
  commando: { height: 2.15, build: 0.95, weapon: 'smg', holdPose: 'twoHand', gunSight: 'reflex', gunStock: 'folded',
    colors: { top: '#526777', pants: '#3d505e', accent: '#a0b7b1', equipment: '#374951' } },
  marksman: { height: 2.4, build: 0.85, weapon: 'sniperRifle', holdPose: 'twoHand', gunSight: 'scope', barrelLength: 1.3,
    colors: { top: '#a59b77', pants: '#7c8060', accent: '#c6bb90', equipment: '#4d5a50' } },
  supportGunner: { height: 2.4, build: 1.3, weapon: 'machineGun', holdPose: 'twoHand', weaponScale: 1.1,
    gunMagazine: 'box', gunSight: 'iron',
    colors: { top: '#89916b', pants: '#5f7058', accent: '#b8b888', equipment: '#48534d' } },
  breacher: { height: 2.2, build: 1.18, weapon: 'shotgun', holdPose: 'twoHand', gunSight: 'iron',
    colors: { top: '#697783', pants: '#495a68', accent: '#bec6b8', equipment: '#3d4e5b' } },
  police: { height: 2.2, build: 1.02, weapon: 'pistol', holdPose: 'ready', offhand: 'radio',
    colors: { top: '#6487a1', pants: '#354e66', accent: '#e2bc72', equipment: '#364957' } },
  firefighter: { height: 2.25, build: 1.16, weapon: 'waterNozzle', holdPose: 'twoHand',
    colors: { top: '#c99c65', pants: '#ad865a', accent: '#e4b957', equipment: '#48545a' } },
  nurse: { height: 2.05, build: 0.88, weapon: 'syringe', holdPose: 'ready', offhand: 'medkit',
    colors: { top: '#89bfc2', pants: '#639baf', accent: '#62a8a9', equipment: '#8ccac8', medical: '#edf1e6' } },
  doctor: { height: 2.3, build: 0.92, weapon: 'syringe', syringeSize: 0.8, holdPose: 'ready', offhand: 'clipboard',
    colors: { top: '#e4e9de', pants: '#668f9e', accent: '#6da9a9', equipment: '#699297', medical: '#f0eee1' } },
  paramedic: { height: 2.2, build: 1.05, weapon: 'radio', holdPose: 'ready', offhand: 'medkit',
    colors: { top: '#be7058', pants: '#456576', accent: '#e5d49a', equipment: '#536d76', medical: '#e9e9d8' } },
});

export const SIMPLE_CHARACTER_SCHEMA = freezeConfig({
  height: { label: 'height', default: 2.2, min: 0.8, max: 3.2, step: 0.05 },
  build: { label: 'build / girth', default: 1, min: 0.6, max: 1.7, step: 0.05 },
  headShape: { label: 'head shape', default: 'round', choices: { round: 'round', box: 'box' } },
  stride: { label: 'stride amount', default: 1, min: 0.4, max: 1.3, step: 0.05 },
  holdPose: { label: 'hold pose', default: 'swing',
    choices: { swing: 'natural swing', ready: 'steady grip', twoHand: 'two-hand carry' },
    when: p => Boolean(p.loadout?.left || p.loadout?.right) },
});

const PALETTE = { skin: '#f5c5a4', top: '#ff784f', pants: '#253e59', accent: '#39c9b8' };
const PALETTES = [PALETTE,
  { ...PALETTE, top: '#6e927d', pants: '#3f5148' },
  { ...PALETTE, skin: '#ce9572', top: '#668697', pants: '#37485c' },
  { ...PALETTE, skin: '#945f4e', top: '#d8ba65', pants: '#5b5344' },
  { ...PALETTE, skin: '#ecd0b7', top: '#8b7fae', pants: '#42425c' },
];
// Held items still need their own tints; they stay constants instead of sliders.
const EQUIPMENT_TINTS = Object.freeze({ armor: '#9eafb3', leather: '#7d604b', metal: '#d4dfd8',
  magic: '#8cdbc0', equipment: '#435963', medical: '#e5eee4', liquid: '#8bcfc9' });
const LEGACY_DEFAULTS = Object.freeze({ weapon: 'none', offhand: 'none',
  weaponScale: 1, offhandScale: 1, syringeSize: 1 });

export function normalizeSimpleCharacterOptions(options = {}) {
  const p = normalizeFactoryOptions(options, SIMPLE_CHARACTER_PRESETS, SIMPLE_CHARACTER_SCHEMA, PALETTE);
  // Preset weapon keys go through the same legacy adapter as the detailed
  // factory, so each profession starts out holding the same equipment.
  const legacy = { ...LEGACY_DEFAULTS, ...SIMPLE_CHARACTER_PRESETS[p.preset], ...options,
    height: p.height, colors: { ...EQUIPMENT_TINTS, ...p.colors } };
  return freezeConfig({ ...p, loadout: normalizeCharacterLoadout(legacy, options.loadout) });
}
export const randomSimpleCharacterOptions = (seed = 1, overrides = {}) =>
  randomFactoryOptions(seed, overrides, SIMPLE_CHARACTER_PRESETS, SIMPLE_CHARACTER_SCHEMA,
    PALETTES, normalizeSimpleCharacterOptions);

/** Simplified humanoid, still able to hold equipment. +Y up, -Z forward, root at the feet. */
export function buildSimpleCharacterVisual(options = {}) {
  const p = normalizeSimpleCharacterOptions(options), c = p.colors;
  const kit = createPrimitiveKit(), mesh = new Group();
  mesh.name = `simple-character-${p.preset}`;
  const h = p.height, hipY = h * LEG_RATIO, headH = h * HEAD_RATIO;
  const torsoH = h - headH - hipY;
  const torsoW = h * 0.3 * p.build, torsoD = torsoW * TORSO_DEPTH;
  const legW = h * 0.1 * Math.sqrt(p.build), armW = h * 0.075, armLength = h * ARM_RATIO;
  const upper = armLength * UPPER_ARM, lower = armLength * FOREARM;

  const body = kit.group(mesh, 'hips', [0, hipY, 0]);
  const chest = kit.group(body, 'chest');
  kit.box(chest, 'torso', [torsoW, torsoH, torsoD], [0, torsoH / 2, 0], c.top);
  const head = kit.group(chest, 'head', [0, torsoH + headH / 2, 0]);
  kit[p.headShape === 'box' ? 'box' : 'sphere'](head, 'head-block',
    [headH * 0.9, headH, headH * 0.9], [0, 0, 0], c.skin);

  const legs = [], arms = [];
  for (const side of [-1, 1]) {
    const label = side < 0 ? 'left' : 'right';
    const hip = kit.group(body, `${label}-hip`, [side * torsoW * 0.26, 0, 0]);
    kit.box(hip, 'leg', [legW, hipY, legW], [0, -hipY / 2, 0], c.pants);
    legs.push({ hip });
    // Two arm segments: the shared grip IK needs a shoulder, an elbow and a hand.
    const shoulder = kit.group(chest, `${label}-shoulder`,
      [side * (torsoW / 2 + armW * 0.55), torsoH - armW * 0.6, 0]);
    kit.box(shoulder, 'upper-arm', [armW, upper, armW], [0, -upper / 2, 0], c.top);
    const elbow = kit.group(shoulder, `${label}-elbow`, [0, -upper, 0]);
    kit.box(elbow, 'forearm', [armW * 0.9, lower, armW * 0.9], [0, -lower / 2, 0], c.skin);
    const hand = kit.group(elbow, `${label}-hand`, [0, -lower, 0]);
    kit.box(hand, 'hand', [armW * 1.2, armW * 1.2, armW * 1.2], [0, 0, 0], c.skin);
    arms.push({ shoulder, elbow, hand });
  }

  const attachments = { head, leftHand: arms[0].hand, rightHand: arms[1].hand };
  const equipment = createCharacterEquipmentController(kit,
    { mesh, chest, arms, p, h, armLength, torsoW }, attachments);
  for (const hand of ['left', 'right']) equipment.equip(hand, p.loadout[hand]);
  let disposed = false;

  function setPose(motion = 'idle', seconds = 0) {
    kit.assertLive();
    let requested = null;
    if (typeof motion === 'string' && motion.includes(':')) {
      const [hand, action, extra] = motion.split(':');
      if (extra !== undefined) throw new RangeError('Use hand:action');
      equipment.validateAction(hand, action, seconds); requested = { hand, action }; motion = 'idle';
    } else choice(motion, 'idle', MOTION_IDS, 'motion');
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) throw new TypeError('time must be finite');
    const run = motion === 'run', moving = run || motion === 'walk';
    const phase = seconds * Math.PI * 2 * (run ? 2.5 : 1.45);
    chest.rotation.set(0, 0, 0); head.rotation.set(0, 0, 0);
    const support = [];
    for (let i = 0; i < 2; i++) {
      const wave = Math.sin(phase + i * Math.PI);
      const hip = moving ? wave * (run ? 0.8 : 0.5) * p.stride : 0;
      let shoulder = Math.sin(seconds * 2.2 + i) * 0.03;
      if (moving) {
        shoulder = -wave * (run ? 0.8 : 0.42) * p.stride;
        chest.rotation.x = run ? -0.14 : -0.04;
      } else chest.rotation.x = Math.sin(seconds * 2.2) * 0.014;
      legs[i].hip.rotation.x = hip;
      arms[i].shoulder.rotation.set(shoulder, 0, (i === 0 ? -1 : 1) * 0.07);
      arms[i].elbow.rotation.set(moving ? (run ? 1.1 : 0.3) : 0.12, 0, 0);
      arms[i].hand.rotation.set(0, 0, 0);
      // Rigid legs pivot at the hip, so the planted foot is the least swung one.
      support.push(hipY * Math.cos(hip));
    }
    body.position.y = Math.max(...support);
    equipment.apply(motion, seconds, requested);
    mesh.updateMatrixWorld(true);
    return api;
  }

  const api = {
    mesh, group: mesh, attachments,
    rig: { body, chest, head, legs, arms },
    motions: SIMPLE_CHARACTER_MOTIONS,
    get params() {
      const loadout = Object.fromEntries(Object.entries(equipment.slots)
        .map(([hand, item]) => [hand, item?.params ?? null]));
      return freezeConfig({ ...p, loadout });
    },
    get equipment() { return equipment.slots; },
    get gripStatus() { return equipment.gripStatus; },
    get actionState() { return equipment.actionState; },
    getEquipmentActions: hand => equipment.getActions(hand),
    equip(hand, itemOrOptions) { const item = equipment.equip(hand, itemOrOptions); api.reset(); return item; },
    unequip(hand) { const item = equipment.unequip(hand); api.reset(); return item; },
    setEquipmentAction(hand, action, seconds = 0) { return setPose(`${hand}:${action}`, seconds); },
    setPose,
    reset() { return setPose('idle', 0); },
    getStats() {
      const stats = kit.stats(mesh);
      for (const item of Object.values(equipment.slots)) if (item) {
        const s = item.getStats(); stats.geometries += s.geometries; stats.materials += s.materials;
      }
      return stats;
    },
    dispose() { if (!disposed) { equipment.dispose(); kit.dispose(mesh); disposed = true; } },
  };
  api.reset();
  Object.assign(api, measure(mesh));
  return api;
}

// Compatibility exports: the simplified factory replaces the original under
// this module's historical name, and keeps the original consumer surface.
export { SIMPLE_CHARACTER_MOTIONS as CHARACTER_MOTIONS };
export { SIMPLE_CHARACTER_PRESETS as CHARACTER_PRESETS };
export { SIMPLE_CHARACTER_SCHEMA as CHARACTER_SCHEMA };
export { normalizeSimpleCharacterOptions as normalizeCharacterOptions };
export { randomSimpleCharacterOptions as randomCharacterOptions };
export { buildSimpleCharacterVisual as createCharacterVisual, buildSimpleCharacterVisual as buildCharacterVisual };