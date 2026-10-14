import { Color, Group, Vector3 } from 'three';
import { createPrimitiveKit, freezeConfig, measure,
  normalizeFactoryOptions, seededRandom, choiceOption } from './VisualFactoryUtils.js';
import { equipmentActions, equipmentHold, sampleEquipmentAction,
  createEquipmentArticulation } from './EquipmentActions.js';

// Simplified handheld equipment: the same grips, support points, action anchors
// and actions, drawn with a few blocks per item. Guards, symbols, sight housings,
// spikes, rings, book lines and medical marks are gone.
// The Simple-prefixed exports are canonical; the unprefixed aliases at the end
// keep this module's historical name and consumers unchanged.
export const SIMPLE_EQUIPMENT_PRESETS = freezeConfig({
  shortSword: { kind: 'blade', sizeRatio: 0.48, bladeShape: 'straight' },
  greatSword: { kind: 'blade', sizeRatio: 0.83, bladeShape: 'broad', bladeLength: 1.3, bladeWidth: 0.24, gripLength: 0.38 },
  curvedSword: { kind: 'blade', sizeRatio: 0.55, bladeShape: 'curved', colors: { accent: '#d9b66a' } },
  dagger: { kind: 'blade', sizeRatio: 0.24, bladeLength: 0.55, gripLength: 0.24 },
  battleAxe: { kind: 'axe', sizeRatio: 0.55, headWidth: 0.5 },
  doubleAxe: { kind: 'axe', sizeRatio: 0.72, axeSides: 'double', haftLength: 1.15, headWidth: 0.34, headHeight: 0.26, colors: { body: '#7b9292', accent: '#bf8066' } },
  warHammer: { kind: 'hammer', sizeRatio: 0.65, headWidth: 0.44, headHeight: 0.26 },
  mace: { kind: 'mace', sizeRatio: 0.45, headWidth: 0.4 },
  spear: { kind: 'spear', sizeRatio: 1.15, haftLength: 1.5, headWidth: 0.22 },
  staff: { kind: 'staff', sizeRatio: 1, haftLength: 1.4, staffTop: 'crystal', colors: { accent: '#779eb5', core: '#b3d2d0' } },
  wand: { kind: 'wand', sizeRatio: 0.3, staffTop: 'orb', headWidth: 0.18, haftLength: 0.65 },
  bow: { kind: 'bow', sizeRatio: 0.72, bowSpan: 1.4 },
  crossbow: { kind: 'crossbow', sizeRatio: 0.48, bowSpan: 1.1 },
  roundShield: { kind: 'shield', sizeRatio: 0.48, shieldShape: 'round' },
  kiteShield: { kind: 'shield', sizeRatio: 0.63, shieldShape: 'kite', colors: { body: '#6c8c8e', accent: '#e5c77c' } },
  towerShield: { kind: 'shield', sizeRatio: 0.78, shieldShape: 'tower', shieldWidth: 0.6 },
  spellbook: { kind: 'book', sizeRatio: 0.27, colors: { body: '#817799', accent: '#d8bd7e' } },
  orb: { kind: 'orb', sizeRatio: 0.2, colors: { body: '#90b8aa', core: '#c5ddc1' } },
  rifle: { kind: 'firearm', firearmType: 'rifle', sizeRatio: 0.53, gunStock: 'full', gunMagazine: 'curved', gunSight: 'reflex' },
  smg: { kind: 'firearm', firearmType: 'smg', sizeRatio: 0.32, gunStock: 'folded', gunMagazine: 'straight' },
  shotgun: { kind: 'firearm', firearmType: 'shotgun', sizeRatio: 0.58, gunStock: 'full' },
  sniperRifle: { kind: 'firearm', firearmType: 'sniperRifle', sizeRatio: 0.72, gunStock: 'full', gunSight: 'scope' },
  machineGun: { kind: 'firearm', firearmType: 'machineGun', sizeRatio: 0.66, gunStock: 'full', gunMagazine: 'box' },
  pistol: { kind: 'firearm', firearmType: 'pistol', sizeRatio: 0.16, gunStock: 'none' },
  waterNozzle: { kind: 'waterNozzle', sizeRatio: 0.27, colors: { body: '#657b78', accent: '#d8b65b' } },
  syringe: { kind: 'syringe', sizeRatio: 0.18, colors: { body: '#dcdcc9', accent: '#819f97', core: '#88b9bf' } },
  flashlight: { kind: 'flashlight', sizeRatio: 0.16, colors: { body: '#566c6b', core: '#f0dc9b' } },
  radio: { kind: 'radio', sizeRatio: 0.16, colors: { body: '#536b64', core: '#8cbaab' } },
  medkit: { kind: 'medkit', sizeRatio: 0.25, colors: { body: '#dfddc8', accent: '#bf7568' } },
  clipboard: { kind: 'clipboard', sizeRatio: 0.21, colors: { body: '#799187', accent: '#83a6b1' } },
});

const number = (group, label, value, min, max, step = 0.05, when) => ({ group, label, default: value, min, max, step, when });
const choice = (group, label, value, choices, when) => ({ group, label, default: value, choices, when });
const derivedChoice = (group, label, value, choices, when) => ({ ...choice(group, label, value, choices, when), derived: true });
const is = (...kinds) => p => kinds.includes(p.kind);
const shaft = is('axe', 'hammer', 'mace', 'spear', 'staff', 'wand');
const head = is('axe', 'hammer', 'mace', 'spear', 'staff', 'wand');
const longGun = p => p.kind === 'firearm' && p.firearmType !== 'pistol';
export const SIMPLE_EQUIPMENT_SCHEMA = freezeConfig({
  actionSpeed: number('action', 'action speed', 1, 0.25, 2, 0.05),
  actionAmount: number('action', 'action amount', 1, 0.5, 1.2, 0.05),
  kind: derivedChoice('kind & size', 'equipment kind (from preset)', 'blade', {
    blade: 'blade / dagger', axe: 'axe', hammer: 'hammer', mace: 'mace', spear: 'spear', staff: 'staff', wand: 'wand',
    bow: 'bow', crossbow: 'crossbow', shield: 'shield', book: 'spellbook', orb: 'orb', firearm: 'firearm',
    waterNozzle: 'water nozzle', syringe: 'syringe', flashlight: 'flashlight', radio: 'radio',
    medkit: 'medkit', clipboard: 'clipboard',
  }),
  referenceHeight: number('kind & size', 'Character reference height / m', 2.2, 0.8, 3.2),
  sizeRatio: number('kind & size', 'longest side / reference height', 0.5, 0.1, 1.8, 0.01),
  bladeShape: choice('blade & grip', 'blade profile', 'straight', { straight: 'straight', broad: 'broad', curved: 'curved' }, is('blade')),
  bladeLength: number('blade & grip', 'blade length', 0.95, 0.4, 1.5, 0.05, is('blade')),
  bladeWidth: number('blade & grip', 'blade width', 0.16, 0.06, 0.38, 0.01, is('blade')),
  gripLength: number('blade & grip', 'grip length', 0.24, 0.15, 0.6, 0.01, is('blade')),
  haftLength: number('shaft & head', 'haft length', 1, 0.5, 1.8, 0.05, shaft),
  headWidth: number('shaft & head', 'head width', 0.4, 0.16, 0.9, 0.02, head),
  headHeight: number('shaft & head', 'head height', 0.3, 0.16, 0.6, 0.02, is('axe', 'hammer', 'spear', 'staff', 'wand')),
  axeSides: choice('shaft & head', 'axe sides', 'single', { single: 'single', double: 'double' }, is('axe')),
  staffTop: choice('shaft & head', 'staff top', 'crystal', { crystal: 'crystal', orb: 'orb', cross: 'cross', fork: 'fork' }, is('staff', 'wand')),
  bowSpan: number('bow', 'bow limb span', 1.2, 0.6, 1.8, 0.05, is('bow', 'crossbow')),
  drawAmount: number('bow', 'string draw', 0.1, 0, 0.45, 0.05, is('bow', 'crossbow')),
  shieldShape: choice('shield', 'shield profile', 'round', { round: 'round', kite: 'kite', tower: 'tower' }, is('shield')),
  shieldWidth: number('shield', 'shield width / height', 0.8, 0.5, 1.3, 0.05, is('shield')),
  firearmType: derivedChoice('firearm', 'firearm type (from preset)', 'rifle', { rifle: 'rifle', smg: 'smg', shotgun: 'shotgun', sniperRifle: 'sniper rifle', machineGun: 'machine gun', pistol: 'pistol' }, is('firearm')),
  barrelLength: number('firearm', 'barrel length', 1, 0.55, 1.7, 0.05, is('firearm')),
  gunStock: choice('firearm', 'gun stock', 'full', { none: 'none', full: 'full stock', folded: 'folded stock' }, longGun),
  gunMagazine: choice('firearm', 'magazine profile', 'straight', { straight: 'straight', curved: 'curved', drum: 'drum', box: 'box' }, p => longGun(p) && p.firearmType !== 'shotgun'),
  gunSight: choice('firearm', 'sight', 'iron', { iron: 'iron', reflex: 'reflex', scope: 'scope' }, is('firearm')),
  nozzleLength: number('tools', 'nozzle length', 1, 0.65, 1.6, 0.05, is('waterNozzle')),
  nozzleTip: choice('tools', 'nozzle tip', 'wide', { wide: 'wide', narrow: 'narrow' }, is('waterNozzle')),
});

// Locked details: thickness, support placement and grip positions.
const THICK = 0.06, BOW_CURVE = 0.3, RIM = 0.07, DEPTH = 0.1, FILL = 0.65;

const PALETTE = { body: '#728c87', metal: '#bdc9c4', grip: '#796a57', accent: '#d7b781', core: '#8ab6ba', paper: '#e6dfc7' };
export const normalizeSimpleEquipmentOptions = (options = {}) => {
  const presetId = choiceOption(options.preset, Object.keys(SIMPLE_EQUIPMENT_PRESETS)[0],
    Object.keys(SIMPLE_EQUIPMENT_PRESETS), 'preset');
  const preset = SIMPLE_EQUIPMENT_PRESETS[presetId];
  return normalizeFactoryOptions({
    ...options,
    kind: preset.kind,
    firearmType: preset.firearmType ?? SIMPLE_EQUIPMENT_SCHEMA.firearmType.default,
  }, SIMPLE_EQUIPMENT_PRESETS, SIMPLE_EQUIPMENT_SCHEMA, PALETTE);
};

export function randomSimpleEquipmentOptions(seed = 1, overrides = {}) {
  const random = seededRandom(seed), pick = values => values[Math.floor(random() * values.length)];
  for (let i = 0; i < 5; i++) random();
  const preset = overrides.preset ?? pick(Object.keys(SIMPLE_EQUIPMENT_PRESETS));
  const base = normalizeSimpleEquipmentOptions({ ...overrides, preset }), p = { ...base };
  for (const [key, field] of Object.entries(SIMPLE_EQUIPMENT_SCHEMA)) {
    if (field.derived || key === 'referenceHeight' || (field.when && !field.when(base))) continue;
    if (field.choices) p[key] = pick(Object.keys(field.choices));
    else {
      const value = key === 'drawAmount' ? field.min + random() * (field.max - field.min)
        : base[key] * (0.75 + random() * 0.5);
      p[key] = Math.round(value / field.step) * field.step;
    }
  }
  const colors = Object.fromEntries(Object.entries(base.colors).map(([key, color]) => [key,
    '#' + new Color(color).offsetHSL(0, (random() - 0.5) * 0.08, (random() - 0.5) * 0.12).getHexString()]));
  return normalizeSimpleEquipmentOptions({ ...p, ...overrides, colors: { ...colors, ...overrides.colors } });
}

function buildSimpleParts(kit, root, p) {
  const rig = {}, c = p.colors;
  const attachments = { grip: kit.group(root, 'main-grip') };
  const point = (name, at, direction = 'up') => {
    const node = kit.group(root, `${name}-point`, at);
    if (direction === 'up') node.rotation.x = Math.PI / 2;
    attachments[name] = node;
    return node;
  };
  const support = at => point('supportGrip', at, 'forward');
  if (p.kind === 'blade') {
    const bottom = p.gripLength / 2, top = bottom + p.bladeLength;
    kit.box(root, 'blade-grip', [0.085, p.gripLength, 0.085], [0, 0, 0], c.grip);
    const profiles = {
      straight: [[-0.5, 0], [0.5, 0], [0.5, 0.83], [0, 1], [-0.5, 0.83]],
      broad: [[-0.38, 0], [0.38, 0], [0.65, 0.7], [0, 1], [-0.65, 0.7]],
      curved: [[-0.35, 0], [0.35, 0], [0.5, 0.45], [1.2, 0.84], [1.65, 1], [0.55, 0.86], [-0.22, 0.48]],
    };
    kit.prism(root, 'blade', profiles[p.bladeShape], [p.bladeWidth, p.bladeLength, THICK], [0, bottom, 0], c.metal);
    kit.box(root, 'blade-guard', [0.35, 0.055, 0.1], [0, bottom, 0], c.accent);
    point('tip', [p.bladeShape === 'curved' ? p.bladeWidth * 1.65 : 0, top, 0]);
    point('edgeStart', [0, bottom, 0]);
    if (p.gripLength >= 0.3) support([0, -p.gripLength * 0.3, 0]);
    attachments.action = attachments.tip;
  } else if (shaft(p)) {
    const y = p.haftLength * 0.78;
    kit.box(root, 'equipment-shaft', [0.07, p.haftLength, 0.07], [0, p.haftLength * 0.28, 0], c.grip);
    if (p.kind !== 'wand') support([0, p.haftLength * 0.28, 0]);
    let tip = [0, y + p.headHeight * 0.5, 0];
    if (p.kind === 'axe') {
      for (const side of p.axeSides === 'double' ? [-1, 1] : [1]) kit.box(root, 'axe-head',
        [p.headWidth, p.headHeight, THICK], [side * p.headWidth * 0.5, y - p.headHeight * 0.25, 0], c.metal);
      tip = [p.headWidth, y - p.headHeight * 0.25, 0];
    } else if (p.kind === 'hammer') {
      kit.box(root, 'hammer-head', [p.headWidth, p.headHeight, p.headHeight * 0.8], [0, y, 0], c.metal);
      tip = [p.headWidth / 2 + 0.02, y, 0];
    } else if (p.kind === 'mace') {
      kit.sphere(root, 'mace-head', [p.headWidth, p.headWidth, p.headWidth], [0, y, 0], c.metal);
      tip = [0, y + p.headWidth / 2, 0];
    } else if (p.kind === 'spear') {
      kit.prism(root, 'spear-head', [[0, 0], [-0.5, 0.4], [0, 1], [0.5, 0.4]],
        [p.headWidth, p.headHeight, THICK], [0, y, 0], c.metal);
      tip = [0, y + p.headHeight, 0];
    } else {
      const h = p.headHeight, w = p.headWidth;
      if (p.staffTop === 'orb') kit.sphere(root, 'staff-orb', [w, h, w], [0, y + h * 0.35, 0], c.core);
      else if (p.staffTop === 'crystal') kit.box(root, 'staff-crystal', [w, h, w * 0.8], [0, y + h * 0.35, 0], c.core);
      else if (p.staffTop === 'cross') {
        kit.box(root, 'staff-cross-v', [0.065, h, 0.065], [0, y + h * 0.35, 0], c.accent);
        kit.box(root, 'staff-cross-h', [w, 0.065, 0.065], [0, y + h * 0.45, 0], c.accent);
      } else for (const side of [-1, 1]) kit.beam(root, 'staff-fork',
        [0, y - h * 0.2, 0], [side * w / 2, y + h * 0.85, 0], 0.055, c.accent);
      tip = [0, y + h * 0.85, 0];
    }
    point('tip', tip);
    if (['axe', 'hammer'].includes(p.kind)) attachments.tip.rotation.set(0, -Math.PI / 2, 0);
    attachments.action = attachments.tip;
  } else if (p.kind === 'bow' || p.kind === 'crossbow') {
    const crossbow = p.kind === 'crossbow', span = p.bowSpan, curve = BOW_CURVE, originZ = crossbow ? -0.5 : 0;
    const at = (side, t, z) => crossbow ? [side * span * t, 0, originZ + z] : [0, side * span * t, z];
    const strings = [];
    for (const side of [-1, 1]) {
      kit.beam(root, 'bow-limb', at(side, 0, 0), at(side, 0.5, curve), 0.055, c.grip);
      strings.push({ start: new Vector3(...at(side, 0.5, curve)),
        node: kit.beam(root, 'bow-string', at(side, 0.5, curve), [0, 0, originZ + curve + p.drawAmount], 0.012, c.paper) });
    }
    if (crossbow) {
      kit.box(root, 'crossbow-stock', [0.12, 0.12, 0.96], [0, 0.035, -0.22], c.body);
      kit.box(root, 'crossbow-grip', [0.085, 0.23, 0.1], [0, -0.06, 0], c.grip);
      support([0, -0.05, -0.4]);
    } else kit.box(root, 'bow-grip', [0.08, span * 0.16, 0.085], [0, 0, 0], c.body);
    const tail = originZ + curve + p.drawAmount, tip = originZ - 0.45;
    point('nock', [0, 0.025, tail], 'forward');
    const arrow = kit.group(root, 'arrow');
    kit.beam(arrow, 'arrow-shaft', [0, 0.025, tail], [0, 0.025, tip], 0.02, c.paper);
    const arrowhead = kit.cylinder(arrow, 'arrow-tip', 0.045, 0.14, [0, 0.025, tip - 0.055], c.metal, 0);
    arrowhead.rotation.x = -Math.PI / 2;
    point('muzzle', [0, 0.025, tip - 0.125], 'forward');
    attachments.action = attachments.muzzle;
    if (!crossbow) attachments.supportGrip = attachments.nock;
    rig.bow = { update(draw, release) {
      const offset = draw * 0.3, end = new Vector3(0, 0, tail + offset);
      for (const { start, node } of strings) {
        const direction = end.clone().sub(start);
        node.position.copy(start).add(end).multiplyScalar(0.5);
        node.scale.y = direction.length();
        node.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
      }
      attachments.nock.position.z = tail + offset;
      arrow.position.z = offset; arrow.visible = release < 0.5;
      attachments.muzzle.position.z = tip - 0.125 + offset;
    } };
  } else if (p.kind === 'shield') {
    const profile = p.shieldShape === 'round'
      ? Array.from({ length: 12 }, (_, i) => [Math.cos(i * Math.PI / 6) / 2, Math.sin(i * Math.PI / 6) / 2])
      : p.shieldShape === 'kite' ? [[-0.5, 0.5], [0.5, 0.5], [0.44, -0.1], [0, -0.5], [-0.44, -0.1]]
        : [[-0.5, 0.45], [-0.4, 0.5], [0.4, 0.5], [0.5, 0.45], [0.5, -0.45], [0.4, -0.5], [-0.4, -0.5], [-0.5, -0.45]];
    const z = -0.06 - DEPTH / 2;
    kit.prism(root, 'shield-face', profile, [p.shieldWidth, 1, DEPTH], [0, 0, z], c.body);
    kit.box(root, 'shield-handle', [0.065, 0.22, 0.065], [0, 0, 0], c.grip);
    const faceZ = -0.075 - DEPTH;
    point('face', [0, 0, faceZ], 'forward');
    attachments.action = attachments.face;
  } else if (p.kind === 'book') {
    kit.box(root, 'book-pages', [0.5, 0.67, 0.13], [0, 0, -0.07], c.paper);
    kit.box(root, 'book-back', [0.55, 0.72, 0.035], [0, 0, 0.015], c.body);
    rig.cover = kit.group(root, 'book-cover-hinge', [-0.275, 0, -0.15]);
    kit.box(rig.cover, 'book-cover', [0.55, 0.72, 0.035], [0.275, 0, 0], c.body);
    kit.box(root, 'book-spine', [0.055, 0.72, 0.17], [-0.265, 0, -0.07], c.grip);
    point('face', [0, 0.15, -0.18], 'forward');
    attachments.action = attachments.face;
  } else if (p.kind === 'orb') {
    rig.orb = kit.sphere(root, 'magic-orb', [0.6, 0.6, 0.6], [0, 0.3, 0], c.core);
    point('tip', [0, 0.61, 0]);
    attachments.action = attachments.tip;
  } else if (p.kind === 'firearm') {
    const s = 1, pistol = p.firearmType === 'pistol';
    const [length, width, barrel] = {
      rifle: [0.43, 0.115, 0.35], smg: [0.32, 0.13, 0.16], shotgun: [0.52, 0.12, 0.38],
      sniperRifle: [0.49, 0.105, 0.59], machineGun: [0.57, 0.18, 0.38], pistol: [0.28, 0.095, 0.055],
    }[p.firearmType];
    const barrelL = barrel * p.barrelLength, topY = pistol ? 0.105 : 0.14;
    kit.box(root, 'gun-grip', [s * 0.085, s * 0.2, s * 0.11], [0, 0, s * 0.015], c.body);
    rig.slide = kit.box(root, 'gun-receiver', [s * width, s * (pistol ? 0.105 : 0.15), s * length],
      [0, s * topY, -s * length * 0.3], c.body);
    const barrelZ = -s * (length * 0.8 + barrelL * 0.5);
    const tube = kit.cylinder(root, 'gun-barrel', s * 0.03, s * barrelL, [0, s * topY, barrelZ], c.metal);
    tube.rotation.x = Math.PI / 2;
    if (!pistol) {
      if (p.gunStock === 'full') kit.box(root, 'gun-stock', [s * 0.12, s * 0.22, s * 0.16],
        [0, s * 0.1, s * (length * 0.2 + 0.21)], c.grip);
      else if (p.gunStock === 'folded') kit.box(root, 'folded-stock', [s * 0.055, s * 0.065, s * 0.3],
        [s * (width * 0.5 + 0.035), s * 0.11, -s * 0.02], c.grip);
      if (p.firearmType !== 'shotgun') kit.box(root, 'gun-magazine',
        [s * (p.gunMagazine === 'box' ? 0.24 : 0.09), s * 0.21, s * 0.13], [0, -s * 0.05, -s * 0.18], c.grip);
      attachments.supportGrip = kit.group(root, 'support-grip',
        [0, s * 0.025, -s * Math.min(0.34, length * 0.7)]);
    }
    if (p.gunSight !== 'iron') kit.box(root, 'gun-sight', [s * 0.04, s * 0.06, s * 0.08],
      [0, s * (topY + 0.11), -s * 0.08], c.accent);
    attachments.muzzle = kit.group(root, 'muzzle-point', [0, s * topY, -s * (length * 0.8 + barrelL + 0.0225)]);
    attachments.action = attachments.muzzle;
  } else if (p.kind === 'waterNozzle') {
    const length = 0.72 * p.nozzleLength;
    kit.box(root, 'nozzle-grip', [0.11, 0.27, 0.13], [0, 0, 0], c.body);
    const pipe = kit.cylinder(root, 'water-nozzle-body', 0.09, length, [0, 0.16, -length * 0.32], c.metal);
    pipe.rotation.x = Math.PI / 2;
    const tip = kit.cylinder(root, 'water-nozzle-tip', p.nozzleTip === 'wide' ? 0.15 : 0.085, 0.19,
      [0, 0.16, -length * 0.82 - 0.08], c.accent, p.nozzleTip === 'wide' ? 0.6 : 1);
    tip.rotation.x = Math.PI / 2;
    rig.valve = kit.box(root, 'nozzle-handle', [0.28, 0.045, 0.045], [0, 0.37, -0.12], c.accent);
    attachments.supportGrip = kit.group(root, 'support-grip', [0, 0.06, -length * 0.55]);
    attachments.hose = kit.group(root, 'hose-connector', [0, 0.16, length * 0.18]);
    attachments.muzzle = kit.group(root, 'muzzle-point', [0, 0.16, -(length * 0.82 + 0.1875)]);
    attachments.action = attachments.muzzle;
  } else if (p.kind === 'syringe') {
    kit.cylinder(root, 'syringe-barrel', 0.075, 0.55, [0, 0.25, 0], c.paper);
    rig.liquid = kit.box(root, 'syringe-liquid', [0.068, 0.42 * FILL, 0.022],
      [0, 0.04 + 0.21 * FILL, -0.081], c.core);
    kit.box(root, 'syringe-finger-rest', [0.26, 0.035, 0.15], [0, -0.035, 0], c.accent);
    const plunger = kit.cylinder(root, 'syringe-plunger', 0.026, 0.19, [0, -0.13, 0], c.metal);
    rig.plunger = [plunger]; rig.stroke = 0.17;
    kit.cylinder(root, 'syringe-needle', 0.008, 0.22, [0, 0.71, 0], c.metal, 0.15);
    attachments.tip = kit.group(root, 'tip-point', [0, 0.82, 0]);
    attachments.tip.rotation.x = Math.PI / 2;
    attachments.action = attachments.tip;
  } else if (p.kind === 'flashlight') {
    const body = kit.cylinder(root, 'flashlight-body', 0.065, 0.4, [0, 0, -0.1], c.body);
    body.rotation.x = Math.PI / 2;
    const lens = kit.cylinder(root, 'flashlight-lens', 0.1, 0.06, [0, 0, -0.33], c.core);
    lens.rotation.x = Math.PI / 2;
    attachments.light = kit.group(root, 'light-point', [0, 0, -0.36]);
    attachments.action = attachments.light;
  } else if (p.kind === 'radio') {
    kit.box(root, 'handheld-radio', [0.18, 0.34, 0.12], [0, 0.09, 0], c.body);
    kit.box(root, 'radio-antenna', [0.025, 0.23, 0.025], [-0.057, 0.37, 0], c.body);
    attachments.face = kit.group(root, 'face-point', [0, 0.16, -0.075]);
    attachments.action = attachments.face;
  } else if (p.kind === 'medkit') {
    kit.box(root, 'medical-case', [0.63, 0.35, 0.26], [0, -0.355, 0], c.paper);
    rig.caseLid = kit.group(root, 'case-lid-hinge', [0, -0.18, 0.13]);
    kit.box(rig.caseLid, 'case-lid', [0.63, 0.11, 0.26], [0, 0.055, -0.13], c.paper);
    kit.box(root, 'case-handle', [0.28, 0.05, 0.06], [0, 0.025, 0], c.body);
    attachments.grip.position.set(0, 0.025, 0);
    attachments.face = kit.group(root, 'face-point', [0, -0.3, -0.157]);
    attachments.action = attachments.face;
  } else if (p.kind === 'clipboard') {
    kit.box(root, 'clipboard-board', [0.45, 0.62, 0.045], [0, 0.12, -0.04], c.body);
    kit.box(root, 'clipboard-paper', [0.37, 0.49, 0.016], [0, 0.1, -0.073], c.paper);
    kit.box(root, 'clipboard-clip', [0.18, 0.065, 0.03], [0, 0.37, -0.086], c.metal);
    attachments.face = kit.group(root, 'face-point', [0, 0.12, -0.092]);
    attachments.action = attachments.face;
  }
  return { root, attachments, rig };
}

export const SIMPLE_EQUIPMENT_MOTIONS = freezeConfig({ still: 'still item', inspect: 'spin view' });

/** Ground origin for catalog use; gripBounds and grip attachments support hand mounting. */
export function buildSimpleEquipmentVisual(options = {}) {
  const p = normalizeSimpleEquipmentOptions(options), kit = createPrimitiveKit();
  const mesh = new Group(); mesh.name = `simple-equipment-${p.preset}`;
  const motion = kit.group(mesh, 'equipment-motion'), model = kit.group(motion, 'equipment-model');
  const parts = buildSimpleParts(kit, kit.group(model, 'simple-equipment-parts'), p);
  const articulate = createEquipmentArticulation(p, parts);
  const size = p.referenceHeight * p.sizeRatio;
  const raw = measure(mesh);
  model.scale.multiplyScalar(size / Math.max(...raw.dimensions.toArray()));
  mesh.updateMatrixWorld(true);
  // Put the main grip on the rotation axis, then raise the static object onto the ground.
  const gripAt = parts.attachments.grip.getWorldPosition(new Vector3());
  model.position.sub(gripAt);
  const gripBounds = measure(mesh).bounds.clone();
  motion.position.y = -gripBounds.min.y;
  const { bounds, dimensions } = measure(mesh);
  const radius = Math.max(...[bounds.min.x, bounds.max.x].flatMap(x => [bounds.min.z, bounds.max.z].map(z => Math.hypot(x, z))));
  const inspectBounds = bounds.clone(); inspectBounds.min.x = inspectBounds.min.z = -radius; inspectBounds.max.x = inspectBounds.max.z = radius;
  const attachments = parts.attachments;
  const actions = equipmentActions(p);
  let disposed = false, owner = null;
  const api = { mesh, params: p, actions, bounds, dimensions, gripBounds, inspectBounds, attachments,
    rig: { motion, model, parts: parts.rig }, scaleInfo: { referenceHeight: p.referenceHeight, sizeRatio: p.sizeRatio, longestSide: size },
    setPose(action = 'still', seconds = 0) {
      kit.assertLive(); choiceOption(action, 'still',
        [...Object.keys(SIMPLE_EQUIPMENT_MOTIONS), ...Object.keys(actions)], 'action');
      if (typeof seconds !== 'number' || !Number.isFinite(seconds)) throw new TypeError('time must be finite');
      const sample = actions[action] ? sampleEquipmentAction(p, action, seconds) : null;
      articulate(sample);
      api.actionState = sample ? { action, progress: sample.progress, active: sample.active, finished: sample.finished } : null;
      motion.rotation.y = action === 'inspect' ? ((seconds % 8) / 8) * Math.PI * 2 : 0;
      mesh.updateMatrixWorld(true); return api;
    },
    reset() { return api.setPose('still', 0); },
    getHoldPose: () => equipmentHold(p),
    sampleAction: (action, seconds) => sampleEquipmentAction(p, action, seconds),
    get owner() { return owner; },
    get disposed() { return disposed; },
    // Ownership is exclusive; releasing an item leaves it alive for another holder.
    claim(holder) { kit.assertLive(); if (owner && owner !== holder) throw new Error('Equipment is already held'); owner = holder; },
    release(holder) { if (owner !== holder) throw new Error('Equipment owner mismatch'); owner = null; },
    getStats: () => kit.stats(mesh), dispose() { if (owner) throw new Error('Unequip the item before disposing it'); if (!disposed) { kit.dispose(mesh); disposed = true; } },
  };
  return api.reset();
}

// Category catalogue inlined from the detailed factory (labels terse).
export const SIMPLE_EQUIPMENT_TYPES = freezeConfig({
  blade: { label: 'blade', presets: ['shortSword', 'greatSword', 'curvedSword', 'dagger'] },
  axe: { label: 'axe', presets: ['battleAxe', 'doubleAxe'] },
  hammer: { label: 'hammer', presets: ['warHammer'] },
  mace: { label: 'mace', presets: ['mace'] },
  spear: { label: 'spear', presets: ['spear'] },
  staff: { label: 'staff', presets: ['staff'] },
  wand: { label: 'wand', presets: ['wand'] },
  bow: { label: 'bow', presets: ['bow'] },
  crossbow: { label: 'crossbow', presets: ['crossbow'] },
  shield: { label: 'shield', presets: ['roundShield', 'kiteShield', 'towerShield'] },
  book: { label: 'spellbook', presets: ['spellbook'] },
  orb: { label: 'orb', presets: ['orb'] },
  firearm: { label: 'firearm', presets: ['rifle', 'smg', 'shotgun', 'sniperRifle', 'machineGun', 'pistol'] },
  waterNozzle: { label: 'water nozzle', presets: ['waterNozzle'] },
  syringe: { label: 'syringe', presets: ['syringe'] },
  flashlight: { label: 'flashlight', presets: ['flashlight'] },
  radio: { label: 'radio', presets: ['radio'] },
  medkit: { label: 'medkit', presets: ['medkit'] },
  clipboard: { label: 'clipboard', presets: ['clipboard'] },
});

// Compatibility exports: the simplified factory replaces the original under
// this module's historical name, and keeps the original consumer surface.
export { SIMPLE_EQUIPMENT_MOTIONS as EQUIPMENT_MOTIONS };
export { SIMPLE_EQUIPMENT_TYPES as EQUIPMENT_TYPES };
export { SIMPLE_EQUIPMENT_PRESETS as EQUIPMENT_PRESETS };
export { SIMPLE_EQUIPMENT_SCHEMA as EQUIPMENT_SCHEMA };
export { normalizeSimpleEquipmentOptions as normalizeEquipmentOptions };
export { randomSimpleEquipmentOptions as randomEquipmentOptions };
export { buildSimpleEquipmentVisual as createEquipmentVisual, buildSimpleEquipmentVisual as buildEquipmentVisual };