import { Box3, Group, Vector3 } from 'three';
import { createPrimitiveKit, freezeConfig, normalizeFactoryOptions,
  randomFactoryOptions } from './VisualFactoryUtils.js';

// Simplified rocks: the same silhouettes, attachments and actions, drawn as a
// few blocks. Facets, surface chips, sockets and colour jitter are gone.
// The motion catalogue and action installer used to live in the detailed
// factory; they are inlined here so the simplified module stays self-contained.
// The Simple-prefixed exports are canonical; the unprefixed aliases at the end
// keep this module's historical name and consumers unchanged.

// Rock catalogue inlined from the detailed factory (labels terse).
export const SIMPLE_ROCK_TYPES = freezeConfig({
  boulder: { label: 'round boulder', presets: ['boulder'] },
  flat: { label: 'flat stone', presets: ['flatRock'] },
  cliff: { label: 'cliff chunk', presets: ['cliffChunk'] },
  ridge: { label: 'ground ridge', presets: ['ridge'] },
  outcrop: { label: 'outcrop', presets: ['outcrop'] },
  meteorite: { label: 'meteorite', presets: ['meteorite'] },
  crater: { label: 'impact crater', presets: ['impactCrater'] },
  slab: { label: 'tilted slab', presets: ['slab'] },
  stack: { label: 'stacked rocks', presets: ['stackedRocks'] },
  crystal: { label: 'crystal rock', presets: ['crystalRock'] },
});

// Motion catalogue inlined from the detailed factory (labels translated).
export const SIMPLE_ROCK_MOTIONS = freezeConfig({
  still: 'still',
  rotate: 'rotate (demo)',
  impact: 'meteor fall (once)',
  settle: 'settle (once)',
  scatter: 'scatter (once)',
  pulse: 'crystal / core pulse',
});

export const SIMPLE_ROCK_PRESETS = freezeConfig({
  boulder: { rockShape: 'boulder', kind: 'boulder', width: 2.4, height: 1.55, depth: 2.1 },
  flatRock: { rockShape: 'flat', kind: 'flat', width: 3.2, height: 0.68, depth: 2.25 },
  cliffChunk: { rockShape: 'cliff', kind: 'cliff', width: 2.45, height: 3.2, depth: 1.8, lean: -0.05 },
  ridge: { rockShape: 'ridge', kind: 'ridge', width: 4.8, height: 1.1, depth: 1.45, ridgeLength: 4.8, ridgeHeight: 1.15 },
  outcrop: { rockShape: 'outcrop', kind: 'outcrop', width: 3.1, height: 2.25, depth: 2.4, lean: 0.08 },
  meteorite: { rockShape: 'meteorite', kind: 'meteorite', width: 2.4, height: 1.6, depth: 2.1, meteoriteTail: 0.7 },
  impactCrater: { rockShape: 'crater', kind: 'crater', width: 4.2, height: 0.9, depth: 4.2,
    craterRadius: 1.25, craterDepth: 0.5, craterRim: 0.55 },
  slab: { rockShape: 'slab', kind: 'slab', width: 2.9, height: 0.58, depth: 1.45, lean: 0.2 },
  stackedRocks: { rockShape: 'stack', kind: 'stack', width: 2.15, height: 2.8, depth: 2.05 },
  crystalRock: { rockShape: 'crystal', kind: 'crystal', width: 2.2, height: 2.5, depth: 1.9 },
});

const number = (group, label, value, min, max, step = 0.05, when) => ({ group, label, default: value, min, max, step, when });
const derivedChoice = (group, label, value, choices) => ({ group, label, default: value, choices, derived: true });
const is = (...shapes) => p => shapes.includes(p.rockShape);
const shapeChoices = Object.fromEntries(Object.entries(SIMPLE_ROCK_TYPES).map(([key, value]) => [key, value.label]));

export const SIMPLE_ROCK_SCHEMA = freezeConfig({
  rockShape: derivedChoice('type and size', 'rock category (set by preset)', 'boulder', shapeChoices),
  kind: derivedChoice('type and size', 'rock kind (set by preset)', 'boulder', shapeChoices),
  referenceHeight: { ...number('type and size', 'character reference height / m', 2.2, 0.8, 3.2, 0.05), randomize: false },
  width: number('type and size', 'width / m', 2.4, 0.25, 12, 0.05),
  height: number('type and size', 'height / m', 1.55, 0.15, 8, 0.05),
  depth: number('type and size', 'depth / m', 2.1, 0.25, 12, 0.05),
  lean: number('profile and grounding', 'overall lean', 0, -0.45, 0.45, 0.01),
  buriedAmount: number('profile and grounding', 'buried amount', 0, 0, 0.8, 0.02),
  ridgeLength: number('ridge and impact', 'ridge length / m', 4.8, 0.8, 16, 0.1, is('ridge')),
  ridgeHeight: number('ridge and impact', 'ridge peak height / m', 1.15, 0.2, 5, 0.05, is('ridge')),
  craterRadius: number('ridge and impact', 'crater radius / m', 1.25, 0.25, 6, 0.05, is('crater')),
  craterDepth: number('ridge and impact', 'crater depth / m', 0.5, 0, 2.8, 0.05, is('crater')),
  craterRim: number('ridge and impact', 'crater rim height / m', 0.55, 0.05, 2.5, 0.05, is('crater')),
  meteoriteTail: number('fragments and crystals', 'meteorite tail length / m', 0.7, 0, 5, 0.05, is('meteorite')),
  actionSpeed: number('motion', 'action speed', 1, 0.2, 3, 0.05),
  settleAmount: number('motion', 'settle amount / m', 0.12, 0, 0.8, 0.01),
  settleDuration: number('motion', 'settle duration / s', 1.2, 0.2, 4, 0.05),
  rotatePeriod: number('motion', 'rotate period / s', 4, 0.5, 14, 0.1),
  impactHeight: number('motion', 'impact fall height / m', 3.5, 0.2, 12, 0.1),
  impactDuration: number('motion', 'impact duration / s', 1.4, 0.2, 5, 0.05),
  scatterAmount: number('motion', 'scatter amount / m', 0.38, 0, 2, 0.02),
  pulsePeriod: number('motion', 'pulse period / s', 2.2, 0.4, 10, 0.1),
});

// Locked details: facet count, colour jitter, fragment spread and contact patch.
const CONTACT = 0.62, SPREAD = 0.5, RIM_SIDES = 4, STACK_COUNT = 3, CRYSTAL_COUNT = 2, TAIL_COUNT = 2;

const PALETTE = { body: '#7e8780', light: '#a7aa94', dark: '#4e5d59', accent: '#c1a46f', crystal: '#b7c6ba', impact: '#c77c61' };
const PALETTES = [
  PALETTE,
  { ...PALETTE, body: '#8d8578', light: '#b6a995', dark: '#5e5b56', accent: '#c69a69' },
  { ...PALETTE, body: '#6f7778', light: '#9ba7a2', dark: '#414c52', accent: '#b98270' },
];

export const SIMPLE_ROCK_PRESET_LOCKED_FIELDS = Object.freeze(['rockShape', 'kind']);

function preprocess(options = {}) {
  const next = { ...options };
  if (typeof next.meteoriteTail === 'boolean') next.meteoriteTail = next.meteoriteTail ? 0.7 : 0;
  return next;
}

export function normalizeSimpleRockOptions(options = {}) {
  const source = preprocess(options);
  const preset = source.preset ?? Object.keys(SIMPLE_ROCK_PRESETS)[0];
  const base = SIMPLE_ROCK_PRESETS[preset];
  if (!base) throw new RangeError(`preset: choose ${Object.keys(SIMPLE_ROCK_PRESETS).join(', ')}`);
  return normalizeFactoryOptions({ ...source, rockShape: base.rockShape, kind: base.kind },
    SIMPLE_ROCK_PRESETS, SIMPLE_ROCK_SCHEMA, PALETTE);
}

export function randomSimpleRockOptions(seed = 1, overrides = {}) {
  return randomFactoryOptions(seed, preprocess(overrides), SIMPLE_ROCK_PRESETS, SIMPLE_ROCK_SCHEMA, PALETTES, normalizeSimpleRockOptions);
}

const TAU = Math.PI * 2;
const clamp01 = value => Math.max(0, Math.min(1, value));
const ease = value => value * value * (3 - 2 * value);
const finiteTime = seconds => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) throw new TypeError('time must be finite');
  return Math.max(0, seconds);
};

export function rockVisibleBounds(root) {
  root.updateWorldMatrix(true, true);
  const bounds = new Box3();
  root.traverseVisible(node => { if (node.isMesh) bounds.expandByObject(node, true); });
  return bounds;
}

function buildParts(kit, root, p) {
  const c = p.colors;
  const rig = { fragments: [], crystals: [], impactFragments: [] }, attachments = {};
  const staticGroup = kit.group(root, 'rock-static');
  const motion = kit.group(root, 'rock-motion');
  const body = kit.group(motion, 'rock-body');
  const fragments = kit.group(motion, 'rock-fragments');
  const core = kit.group(motion, 'rock-core');
  rig.static = staticGroup; rig.motion = motion; rig.body = body; rig.fragmentsGroup = fragments; rig.core = core;
  rig.activity = motion;

  const point = (name, parent, position = [0, 0, 0], direction = [0, 1, 0]) => {
    const node = kit.group(parent, `${name}-point`, position);
    const vector = new Vector3(...direction);
    if (vector.lengthSq() < 1e-8) vector.set(0, 1, 0);
    node.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), vector.normalize());
    attachments[name] = node;
    return node;
  };
  const addFragmentAttachment = (node, index) => {
    for (const name of [`fragment[${index}]`, `fragment${index}`]) attachments[name] = point(name, node, [0, 0, 0]);
  };
  point('base', staticGroup, [0, 0, 0]);
  point('center', motion, [0, Math.max(0.05, p.height * 0.48), 0]);
  point('surface', motion, [0, Math.max(0.08, p.height * 0.92), 0]);
  point('top', motion, [0, Math.max(0.1, p.height), 0]);

  // A small contact patch keeps settle from putting geometry below Y=0.
  const contactWidth = Math.max(0.12, p.width * (0.16 + CONTACT * 0.24));
  const contactDepth = Math.max(0.12, p.depth * (0.16 + CONTACT * 0.24));
  kit.box(staticGroup, 'ground-contact', [contactWidth, 0.08, contactDepth], [0, 0.04, 0], c.dark);

  const burialScale = 1 - p.buriedAmount * 0.45;
  const bodyW = Math.max(0.12, p.width * burialScale);
  const bodyH = Math.max(0.1, p.height * burialScale);
  const bodyD = Math.max(0.12, p.depth * burialScale);
  const lift = Math.max(0.06, bodyH * 0.08);
  rig.clearance = lift;

  const addMain = (size, position, color = c.body) => {
    const node = kit.rock(body, 'rock-main', size, position, color);
    node.rotation.set(p.lean * 0.18, 0, p.lean);
    rig.main = node;
    return node;
  };

  const shape = p.rockShape;
  if (shape === 'ridge') {
    const length = Math.max(p.width, p.ridgeLength);
    rig.ridge = kit.group(body, 'ground-ridge');
    for (let i = 0; i < 3; i++) {
      const f = i / 2, peak = p.ridgeHeight * (i === 1 ? 1 : 0.7);
      const sx = length / 3 * 1.2, sz = Math.max(0.12, p.depth * 0.6);
      const node = kit.box(rig.ridge, `ridge-${i + 1}`, [sx, peak, sz],
        [(f - 0.5) * length, lift + peak / 2, 0], i === 1 ? c.body : c.light);
      rig.fragments.push(node);
    }
    rig.main = rig.ridge;
  } else if (shape === 'crater') {
    const radius = Math.min(p.craterRadius, Math.min(bodyW, bodyD) * 0.47);
    const floor = Math.max(0.04, lift * 0.55);
    kit.cylinder(body, 'crater-floor', radius * 1.08, Math.max(0.04, bodyH * 0.16), [0, floor, 0], c.dark, 0.72);
    rig.craterRim = kit.group(body, 'crater-rim');
    for (let i = 0; i < RIM_SIDES; i++) {
      const a = i / RIM_SIDES * Math.PI * 2;
      const rr = radius * (1.02 + p.craterRim * 0.2);
      const s = [Math.max(0.12, radius * 0.45), Math.max(0.08, p.craterRim), Math.max(0.12, radius * 0.45)];
      const node = kit.box(rig.craterRim, `crater-rim-${i + 1}`, s,
        [Math.cos(a) * rr, floor + s[1] / 2, Math.sin(a) * rr], i % 2 ? c.body : c.light);
      node.rotation.y = a;
      rig.impactFragments.push(node); rig.fragments.push(node); addFragmentAttachment(node, i);
    }
    const impact = kit.box(core, 'impact-core', [radius * 0.32, Math.max(0.08, p.craterDepth * 0.28), radius * 0.32],
      [0, floor + Math.max(0.04, p.craterDepth * 0.15), 0], c.impact);
    rig.impactCore = impact;
    rig.main = body;
    attachments.hazard = point('hazard', core, [0, Math.max(0.08, p.craterDepth * 0.28), 0]);
    attachments.impact = point('impact', core, [0, Math.max(0.1, p.craterDepth * 0.38), 0], [0, 1, 0]);
  } else if (shape === 'stack') {
    let y = lift;
    rig.stack = kit.group(body, 'rock-stack');
    for (let i = 0; i < STACK_COUNT; i++) {
      const scale = 1 - i * 0.18;
      const s = [bodyW * 0.7 * scale, bodyH * 0.32 * scale, bodyD * 0.7 * scale];
      const node = kit.box(rig.stack, `stack-rock-${i + 1}`, s,
        [(i - 1) * SPREAD * 0.25, y + s[1] / 2, (i % 2 ? 1 : -1) * SPREAD * 0.15], i % 2 ? c.light : c.body);
      y += s[1] * 0.8;
      rig.fragments.push(node); addFragmentAttachment(node, i);
    }
    rig.main = rig.stack;
  } else if (shape === 'crystal') {
    const base = addMain([bodyW, bodyH * 0.52, bodyD], [0, lift + bodyH * 0.26, 0], c.body);
    rig.crystalBase = base;
    rig.crystalField = kit.group(body, 'crystal-field');
    for (let i = 0; i < CRYSTAL_COUNT; i++) {
      const a = i / CRYSTAL_COUNT * Math.PI * 2, radius = Math.min(bodyW, bodyD) * 0.22;
      const crystalH = bodyH * 0.55, crystalR = Math.max(0.06, bodyW * 0.09);
      const node = kit.cylinder(rig.crystalField, `crystal-${i + 1}`, crystalR, crystalH,
        [Math.cos(a) * radius, lift + bodyH * 0.45 + crystalH / 2, Math.sin(a) * radius], c.crystal, 0.35);
      node.rotation.y = a;
      rig.crystals.push(node); rig.fragments.push(node); addFragmentAttachment(node, i);
    }
    rig.energy = kit.sphere(core, 'crystal-core', [bodyW * 0.18, bodyH * 0.18, bodyD * 0.18],
      [0, lift + bodyH * 0.48, 0], c.accent);
    rig.coreMesh = rig.energy;
    rig.main = base;
  } else {
    let size = [bodyW, bodyH, bodyD];
    if (shape === 'flat') size = [bodyW, Math.max(0.1, bodyH * 0.55), bodyD];
    if (shape === 'cliff') size = [bodyW * 0.9, bodyH, bodyD * 0.72];
    if (shape === 'slab') size = [bodyW, Math.max(0.1, bodyH * 0.5), bodyD * 0.82];
    const main = addMain(size, [p.lean * bodyH * 0.12, lift + size[1] / 2, 0],
      shape === 'meteorite' ? c.dark : c.body);
    if (shape === 'slab') main.rotation.z = p.lean + 0.18;
    if (shape === 'meteorite') {
      rig.tail = kit.group(motion, 'meteorite-tail');
      for (let i = 0; i < TAIL_COUNT; i++) {
        const f = (i + 1) / TAIL_COUNT, s = Math.max(0.06, bodyW * (0.13 - f * 0.04));
        const node = kit.rock(rig.tail, `meteorite-fragment-${i + 1}`, [s, s, s],
          [0, lift + bodyH * 0.4, f * p.meteoriteTail], c.impact);
        rig.fragments.push(node); addFragmentAttachment(node, i);
      }
      rig.impactCore = kit.sphere(core, 'meteorite-core', [bodyW * 0.18, bodyH * 0.18, bodyD * 0.18],
        [0, lift + bodyH * 0.45, -bodyD * 0.35], c.impact);
    }
    rig.main = main;
  }

  if (!attachments.hazard) {
    const hazardParent = shape === 'ridge' ? rig.ridge : rig.main ?? body;
    attachments.hazard = point('hazard', hazardParent,
      [0, Math.max(0.08, bodyH * 0.55), 0], shape === 'meteorite' ? [0, 0, 1] : [0, 1, 0]);
  }
  if (!attachments.impact) {
    const impactParent = rig.impactCore ?? core;
    attachments.impact = point('impact', impactParent, [0, 0, 0], [0, 1, 0]);
  }
  if (!attachments.surface) attachments.surface = point('surface', motion, [0, lift + bodyH, 0]);
  if (!attachments.top) attachments.top = point('top', motion, [0, lift + bodyH * 1.1, 0]);
  attachments.focus = attachments.surface;
  attachments.activation = attachments.hazard;
  return { rig, attachments, motion };
}

/** Metres, built from Y=0; hidden moving parts never shift the visible bounds. */
export function buildSimpleRockVisual(options = {}) {
  const p = { ...normalizeSimpleRockOptions(options), surfaceBreakup: 0.25 };
  const kit = createPrimitiveKit(), mesh = new Group();
  mesh.name = `simple-rock-${p.preset}`;
  const built = buildParts(kit, mesh, p);
  mesh.updateWorldMatrix(true, true);
  const before = new Box3().setFromObject(mesh, true);
  for (const child of mesh.children) child.position.y -= before.min.y;
  mesh.updateWorldMatrix(true, true);
  const api = { group: mesh, mesh, params: p, rig: built.rig, attachments: built.attachments };
  let disposed = false;
  Object.defineProperty(api, 'disposed', { enumerable: true, get: () => disposed });
  api.getStats = () => { kit.assertLive(); return kit.stats(mesh); };
  api.dispose = () => { if (disposed) return; disposed = true; kit.dispose(mesh); };
  installRockActions(api, kit, built);
  api.bounds = rockVisibleBounds(mesh);
  api.dimensions = api.bounds.getSize(new Vector3());
  api.scaleInfo = freezeConfig({ units: 'm', referenceHeight: p.referenceHeight,
    width: api.dimensions.x, depth: api.dimensions.z, height: api.dimensions.y,
    neutralHeight: api.dimensions.y });
  return api;
}

function actionSpec(id, p) {
  if (id === 'still') return { label: SIMPLE_ROCK_MOTIONS.still, mode: 'static', static: true, loop: false };
  if (id === 'rotate') return { label: SIMPLE_ROCK_MOTIONS.rotate, mode: 'loop', loop: true, static: false, period: p.rotatePeriod / p.actionSpeed };
  if (id === 'impact') return { label: SIMPLE_ROCK_MOTIONS.impact, mode: 'once', loop: false, static: false, duration: p.impactDuration / p.actionSpeed };
  if (id === 'settle') return { label: SIMPLE_ROCK_MOTIONS.settle, mode: 'once', loop: false, static: false, duration: p.settleDuration / p.actionSpeed };
  if (id === 'scatter') return { label: SIMPLE_ROCK_MOTIONS.scatter, mode: 'once', loop: false, static: false, duration: p.settleDuration / p.actionSpeed };
  return { label: SIMPLE_ROCK_MOTIONS.pulse, mode: 'loop', loop: true, static: false, period: p.pulsePeriod / p.actionSpeed };
}

/** Inlined from the detailed factory: the same state machine drives both rigs. */
export function installRockActions(api, kit, built) {
  const { motion, rig } = built, p = api.params;
  const neutral = [];
  motion.traverse(node => neutral.push({ node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(), visible: node.visible }));
  const restore = () => neutral.forEach(n => {
    n.node.position.copy(n.position); n.node.quaternion.copy(n.quaternion); n.node.scale.copy(n.scale); n.node.visible = n.visible;
  });
  const actions = Object.fromEntries(Object.keys(SIMPLE_ROCK_MOTIONS).map(id => [id, actionSpec(id, p)]));
  api.motions = SIMPLE_ROCK_MOTIONS;
  api.actions = freezeConfig(actions);
  let state = { id: 'still', mode: 'static', phase: 'still', progress: 0, value: 0, active: false, finished: false };
  Object.defineProperty(api, 'actionState', { enumerable: true, get: () => ({ ...state }) });
  api.getPoseBounds = () => { kit.assertLive(); return rockVisibleBounds(api.mesh); };
  api.setPose = (action = 'still', seconds = 0) => {
    kit.assertLive();
    const time = finiteTime(seconds);
    if (!Object.hasOwn(api.actions, action)) throw new RangeError(`unknown rock motion: ${action}`);
    restore();
    const spec = api.actions[action];
    const progress = spec.mode === 'once' ? clamp01(time / spec.duration) : spec.loop ? (time % spec.period) / spec.period : 0;
    const u = ease(progress), elapsed = spec.loop ? progress * spec.period * p.actionSpeed : 0;
    state = { id: action, mode: spec.mode, phase: 'still', progress, value: 0,
      active: spec.loop || (spec.mode === 'once' && progress < 1), finished: spec.mode === 'once' && progress >= 1 };
    if (action === 'rotate') {
      const angle = progress * TAU;
      motion.rotation.y = angle; state = { ...state, value: angle, angle, phase: 'rotating' };
    } else if (action === 'impact') {
      const remaining = 1 - u;
      motion.position.y += p.impactHeight * remaining;
      motion.rotation.x = remaining * .16;
      state = { ...state, value: remaining, phase: progress >= 1 ? 'landed' : 'falling', active: progress < 1 };
    } else if (action === 'settle') {
      const clearance = Math.max(0, Math.min(p.settleAmount, rig.clearance * .9));
      motion.position.y -= clearance * u;
      motion.rotation.x = Math.sin(progress * Math.PI) * .045 * p.surfaceBreakup;
      motion.rotation.z = Math.sin(progress * Math.PI * 1.4) * .035 * p.surfaceBreakup;
      state = { ...state, value: u, phase: progress >= 1 ? 'settled' : 'settling', active: progress < 1 };
    } else if (action === 'scatter') {
      const amount = p.scatterAmount * u;
      rig.fragments.forEach((fragment, index) => {
        const direction = new Vector3(fragment.position.x, 0, fragment.position.z);
        if (direction.lengthSq() < 1e-8) direction.set(Math.cos(index * 2.39996), 0, Math.sin(index * 2.39996));
        direction.normalize(); fragment.position.x += direction.x * amount * (.5 + (index % 3) * .22);
        fragment.position.z += direction.z * amount * (.5 + (index % 2) * .25);
        fragment.rotation.y += (index % 2 ? 1 : -1) * u * .35;
      });
      state = { ...state, value: u, phase: progress >= 1 ? 'scattered' : 'scattering', active: progress < 1 };
    } else if (action === 'pulse') {
      const wave = .5 + .5 * Math.sin(elapsed / Math.max(.0001, p.pulsePeriod) * TAU);
      const scale = 1 + wave * .16;
      if (rig.coreMesh) rig.coreMesh.scale.setScalar(scale);
      rig.crystals.forEach((crystal, index) => crystal.scale.setScalar(1 + wave * (.06 + (index % 3) * .025)));
      state = { ...state, value: wave, phase: 'pulsing', active: true };
    }
    api.mesh.updateWorldMatrix(true, true);
    // A settling rotation can only approach the floor. If a caller chooses a
    // very small rock with a large custom amplitude, nudge the internal motion
    // node up; the caller's root transform is never touched.
    const current = rockVisibleBounds(api.mesh);
    if (current.min.y < -1e-7) motion.position.y += -current.min.y;
    api.mesh.updateWorldMatrix(true, true);
    return api;
  };
  api.reset = () => api.setPose('still', 0);
  api.getAttachmentFrame = name => {
    kit.assertLive();
    const node = api.attachments[name];
    if (!node) throw new RangeError(`unknown rock attachment: ${name}`);
    node.updateWorldMatrix(true, false);
    const origin = node.getWorldPosition(new Vector3());
    const direction = node.localToWorld(new Vector3(0, 1, 0)).sub(origin).normalize();
    return { origin, direction };
  };
  api.getAttachmentWorldPosition = name => api.getAttachmentFrame(name).origin;
  return api.reset();
}

// Compatibility exports: the simplified factory replaces the original under
// this module's historical name, and keeps the original consumer surface.
export { SIMPLE_ROCK_MOTIONS as ROCK_MOTIONS };
export { SIMPLE_ROCK_TYPES as ROCK_TYPES };
export { SIMPLE_ROCK_PRESETS as ROCK_PRESETS };
export { SIMPLE_ROCK_SCHEMA as ROCK_SCHEMA };
export { SIMPLE_ROCK_PRESET_LOCKED_FIELDS as ROCK_PRESET_LOCKED_FIELDS };
export { normalizeSimpleRockOptions as normalizeRockOptions };
export { randomSimpleRockOptions as randomRockOptions };
export { buildSimpleRockVisual as createRockVisual, buildSimpleRockVisual as buildRockVisual };