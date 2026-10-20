import { Box3, Color, Group, Vector3 } from 'three';
import { createPrimitiveKit, freezeConfig, normalizeFactoryOptions, seededRandom } from './VisualFactoryUtils.js';

// Simplified mechanisms: the same states, timings and attachment frames, drawn
// as plain blocks. Hazard stripes, sockets, saw teeth, guide rails, direction
// arrows and multi-part plates are gone; travel and angles still drive motion.
// The Simple-prefixed exports are canonical; the unprefixed aliases at the end
// keep this module's historical name and consumers unchanged.

// Motion catalogue inlined from the detailed factory (labels translated) so the
// shared state machine keeps working under this module's historical name.
export const MECHANISM_MOTIONS = freezeConfig({
  still: 'still',
  released: 'released / untriggered',
  pressed: 'pressed / triggered',
  press: 'press (once)',
  off: 'off',
  on: 'on',
  toggle: 'toggle (once)',
  retracted: 'retracted',
  warning: 'warning blink',
  extended: 'extended',
  cycle: 'retract / warn / extend',
  swing: 'swing',
  up: 'up',
  down: 'down',
  travel: 'lift travel',
  rotate: 'platform rotate',
  charge: 'charge',
  launch: 'launch (once)',
  spin: 'blade spin',
  closed: 'closed',
  open: 'open',
  operate: 'operate (once)',
});

export const MECHANISM_TYPES = freezeConfig({
  pressurePlate: { label: 'pressure plate', presets: ['pressurePlate'] },
  button: { label: 'button', presets: ['button'] },
  lever: { label: 'lever', presets: ['lever'] },
  spikes: { label: 'floor spikes', presets: ['spikes'] },
  pendulum: { label: 'pendulum', presets: ['pendulum'] },
  liftPlatform: { label: 'lift platform', presets: ['liftPlatform'] },
  rotatingPlatform: { label: 'rotating platform', presets: ['rotatingPlatform'] },
  launchPad: { label: 'launch pad', presets: ['launchPad'] },
  saw: { label: 'rotary saw', presets: ['saw'] },
  gate: { label: 'gate', presets: ['gate'] },
});

export const MECHANISM_MOTION_BY_KIND = freezeConfig({
  pressurePlate: { still: 'still', released: 'released / untriggered', pressed: 'pressed / triggered', press: 'press (once)' },
  button: { still: 'still', released: 'released / untriggered', pressed: 'pressed / triggered', press: 'press (once)' },
  lever: { still: 'still', off: 'off', on: 'on', toggle: 'toggle (once)' },
  spikes: { still: 'still', retracted: 'retracted', warning: 'warning blink', extended: 'extended', cycle: 'retract / warn / extend' },
  pendulum: { still: 'still', swing: 'swing' },
  liftPlatform: { still: 'still', up: 'up', down: 'down', travel: 'lift travel' },
  rotatingPlatform: { still: 'still', rotate: 'platform rotate' },
  launchPad: { still: 'still', charge: 'charge', launch: 'launch (once)' },
  saw: { still: 'still', spin: 'blade spin' },
  gate: { still: 'still', closed: 'closed', open: 'open', operate: 'operate (once)' },
});

export const SIMPLE_MECHANISM_PRESETS = freezeConfig({
  pressurePlate: { kind: 'pressurePlate', width: 1.35, depth: 1.05, plateTravel: 0.16 },
  button: { kind: 'button', width: 0.88, depth: 0.88, plateTravel: 0.22, buttonRadius: 0.24 },
  lever: { kind: 'lever', width: 1.05, depth: 0.7, leverLength: 0.72, leverAmplitude: 42 },
  spikes: { kind: 'spikes', width: 1.45, depth: 0.95, spikeCount: 6, spikeHeight: 0.62 },
  pendulum: { kind: 'pendulum', width: 1.1, depth: 0.7, pendulumLength: 1.45, pendulumHead: 0.55, swingAmplitude: 38 },
  liftPlatform: { kind: 'liftPlatform', width: 1.35, depth: 1.15, platformTravel: 1.05 },
  rotatingPlatform: { kind: 'rotatingPlatform', width: 1.45, depth: 1.45, platformRadius: 0.68 },
  launchPad: { kind: 'launchPad', width: 1.35, depth: 1.7, launchAngle: 24, launchTravel: 0.7 },
  saw: { kind: 'saw', width: 1.25, depth: 0.72, sawRadius: 0.42, sawArm: 0.32 },
  gate: { kind: 'gate', width: 1.55, depth: 0.62, gateLength: 1.35, gateAngle: 82 },
});

const number = (group, label, value, min, max, step = 0.05, when) => ({ group, label, default: value, min, max, step, when });
const derivedChoice = (group, label, value, choices) => ({ group, label, default: value, choices, derived: true });
const is = (...kinds) => p => kinds.includes(p.kind);

export const SIMPLE_MECHANISM_SCHEMA = freezeConfig({
  kind: derivedChoice('kind & size', 'mechanism kind (from preset)', 'pressurePlate',
    Object.fromEntries(Object.entries(MECHANISM_TYPES).map(([key, value]) => [key, value.label]))),
  referenceHeight: { ...number('kind & size', 'reference character height / m', 2.2, 0.8, 3.2, 0.05), randomize: false },
  width: number('kind & size', 'mechanism width / m', 1.2, 0.35, 5, 0.05),
  depth: number('kind & size', 'mechanism depth / m', 1, 0.35, 5, 0.05),
  height: number('kind & size', 'base height / m', 0.18, 0.08, 1.2, 0.02),
  plateTravel: number('plate & button', 'press travel / m', 0.16, 0.02, 0.7, 0.01, is('pressurePlate', 'button')),
  buttonRadius: number('plate & button', 'button radius / m', 0.24, 0.08, 0.6, 0.01, is('button')),
  leverLength: number('lever', 'lever length / m', 0.72, 0.3, 1.8, 0.02, is('lever')),
  leverAmplitude: number('lever', 'toggle angle / deg', 42, 15, 80, 1, is('lever')),
  spikeCount: number('spikes', 'spike count', 5, 2, 12, 1, is('spikes')),
  spikeHeight: number('spikes', 'spike height / m', 0.62, 0.18, 1.8, 0.02, is('spikes')),
  retractedDuration: number('spikes', 'retracted wait / s', 1, 0.2, 4, 0.1, is('spikes')),
  warningDuration: number('spikes', 'warning duration / s', 0.8, 0.2, 3, 0.1, is('spikes')),
  spikeMoveDuration: number('spikes', 'spike move duration / s', 0.25, 0.1, 1, 0.05, is('spikes')),
  extendedDuration: number('spikes', 'extended hold / s', 0.7, 0.2, 4, 0.1, is('spikes')),
  pendulumLength: number('pendulum', 'arm length / m', 1.45, 0.45, 4, 0.05, is('pendulum')),
  pendulumHead: number('pendulum', 'head size / m', 0.55, 0.12, 1.2, 0.02, is('pendulum')),
  swingAmplitude: number('pendulum', 'swing amplitude / deg', 38, 5, 80, 1, is('pendulum')),
  swingPeriod: number('pendulum', 'swing period / s', 2.4, 0.5, 8, 0.1, is('pendulum')),
  platformTravel: number('platform', 'lift travel / m', 1.05, 0.1, 4, 0.05, is('liftPlatform')),
  platformRadius: number('platform', 'rotating platform radius / m', 0.68, 0.3, 2.5, 0.02, is('rotatingPlatform')),
  rotatePeriod: number('platform', 'rotate period / s', 3.5, 0.5, 12, 0.1, is('rotatingPlatform')),
  launchAngle: number('launch pad', 'launch angle / deg', 24, 5, 55, 1, is('launchPad')),
  launchTravel: number('launch pad', 'launch travel / m', 0.7, 0.1, 3, 0.05, is('launchPad')),
  launchDuration: number('launch pad', 'launch duration / s', 0.9, 0.2, 3, 0.1, is('launchPad')),
  sawRadius: number('rotary saw', 'blade radius / m', 0.42, 0.16, 1.2, 0.02, is('saw')),
  sawArm: number('rotary saw', 'blade reach / m', 0.32, 0.1, 1.5, 0.02, is('saw')),
  sawSpeed: number('rotary saw', 'blade speed / rev per sec', 1.2, -4, 4, 0.1, is('saw')),
  gateLength: number('gate', 'arm length / m', 1.35, 0.5, 4, 0.05, is('gate')),
  gateAngle: number('gate', 'open angle / deg', 82, 30, 110, 1, is('gate')),
  actionSpeed: number('action demo', 'action speed', 1, 0.2, 3, 0.05),
  switchDuration: number('action demo', 'single switch duration / s', 0.6, 0.1, 3, 0.05, is('pressurePlate', 'button', 'lever', 'gate')),
  motionPeriod: number('action demo', 'motion demo period / s', 2.6, 0.5, 10, 0.1, is('liftPlatform', 'launchPad')),
  warningBlink: number('action demo', 'warning blink rate / Hz', 4, 0.5, 12, 0.5, is('spikes')),
});

// Locked details: spike girth, hammer profile and post thickness.
const SPIKE_RADIUS = 0.11, POST = 0.16, PLATE_THICK = 0.12;

const PALETTE = { body: '#788f8a', accent: '#d9b769', warning: '#df7659', metal: '#b9c6bd', dark: '#4f6764' };

export const SIMPLE_MECHANISM_PRESET_LOCKED_FIELDS = Object.freeze(['kind']);
export function normalizeSimpleMechanismOptions(options = {}) {
  const preset = options.preset ?? Object.keys(SIMPLE_MECHANISM_PRESETS)[0];
  const base = SIMPLE_MECHANISM_PRESETS[preset];
  if (!base) throw new RangeError(`preset: choose ${Object.keys(SIMPLE_MECHANISM_PRESETS).join(', ')}`);
  return normalizeFactoryOptions({ ...options, kind: base.kind },
    SIMPLE_MECHANISM_PRESETS, SIMPLE_MECHANISM_SCHEMA, PALETTE);
}

export function randomSimpleMechanismOptions(seed = 1, overrides = {}) {
  const random = seededRandom(seed), pick = values => values[Math.floor(random() * values.length)];
  for (let i = 0; i < 5; i++) random();
  const preset = overrides.preset ?? pick(Object.keys(SIMPLE_MECHANISM_PRESETS));
  const base = normalizeSimpleMechanismOptions({ preset });
  const result = { preset };
  for (const [key, field] of Object.entries(SIMPLE_MECHANISM_SCHEMA)) {
    if (field.derived || field.randomize === false || (field.when && !field.when(base))) continue;
    if (field.choices) result[key] = pick(Object.keys(field.choices));
    else {
      const value = base[key] * (0.7 + random() * 0.6);
      result[key] = Math.max(field.min, Math.min(field.max, Math.round(value / field.step) * field.step));
    }
  }
  const colors = Object.fromEntries(Object.entries(base.colors).map(([key, value]) => [key,
    '#' + new Color(value).offsetHSL(0, (random() - 0.5) * 0.08, (random() - 0.5) * 0.12).getHexString()]));
  return normalizeSimpleMechanismOptions({ ...result, ...overrides, colors: { ...colors, ...overrides.colors } });
}

function buildParts(kit, root, p) {
  const c = p.colors, rig = {}, attachments = {};
  const base = kit.group(root, 'mechanism-base');
  kit.box(base, 'base-block', [p.width, p.height, p.depth], [0, p.height / 2, 0], c.body);
  const motion = kit.group(root, 'mechanism-motion');
  rig.motion = motion;
  const point = (name, parent, position = [0, 0, 0], direction = [0, 1, 0]) => {
    const node = kit.group(parent, `${name}-point`, position);
    node.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(...direction).normalize());
    attachments[name] = node;
    return node;
  };
  point('base', base);
  point('trigger', base, [0, p.height, 0]);
  attachments.activation = attachments.trigger;
  // One block stands in for socket plus lamp; the state machine only toggles it.
  const indicator = (position = [0, p.height + 0.05, -p.depth * 0.42]) => {
    rig.indicator = kit.group(motion, 'active-indicator', position);
    kit.box(rig.indicator, 'indicator-light', [0.16, 0.1, 0.1], [0, 0, 0], c.accent);
    rig.indicator.visible = false;
  };
  if (p.kind === 'pressurePlate' || p.kind === 'button') {
    const button = p.kind === 'button';
    const bottom = p.height + (button ? 0.12 : 0.035);
    const plate = kit.group(motion, button ? 'button-plunger' : 'pressure-plate', [0, bottom + p.plateTravel, 0]);
    const springs = kit.group(motion, 'plunger-columns', [0, bottom, 0]);
    if (button) {
      kit.cylinder(springs, 'button-stem', p.buttonRadius * 0.6, p.plateTravel, [0, p.plateTravel / 2, 0], c.metal);
      kit.cylinder(plate, 'button-cap', p.buttonRadius, 0.16, [0, 0.08, 0], c.accent);
      point('press', plate, [0, 0.16, 0], [0, -1, 0]);
    } else {
      kit.box(springs, 'plate-column', [p.width * 0.6, p.plateTravel, p.depth * 0.5],
        [0, p.plateTravel / 2, 0], c.metal);
      kit.box(plate, 'plate-top', [p.width * 0.86, PLATE_THICK, p.depth * 0.72], [0, PLATE_THICK / 2, 0], c.accent);
      point('press', plate, [0, PLATE_THICK, 0], [0, -1, 0]);
    }
    rig.plate = plate; rig.springs = springs;
    indicator();
  } else if (p.kind === 'lever') {
    const y = p.height + 0.18;
    const pivot = kit.group(motion, 'lever-pivot', [0, y, 0]);
    rig.arm = kit.beam(pivot, 'lever-arm', [0, 0, 0], [0, p.leverLength, 0], 0.09, c.metal);
    kit.box(pivot, 'lever-handle', [0.2, 0.2, 0.2], [0, p.leverLength, 0], c.accent);
    pivot.rotation.z = -p.leverAmplitude * Math.PI / 180;
    point('handle', pivot, [0, p.leverLength, 0]);
    point('toggle', pivot);
    rig.lever = pivot;
    indicator();
  } else if (p.kind === 'spikes') {
    const spikeField = kit.group(motion, 'spike-field', [0, p.height + 0.03, 0]);
    const cols = Math.ceil(Math.sqrt(p.spikeCount)), rows = Math.ceil(p.spikeCount / cols);
    const radius = Math.min(SPIKE_RADIUS, p.width * 0.32 / cols, p.depth * 0.32 / rows);
    rig.spikeMeshes = [];
    for (let i = 0; i < p.spikeCount; i++) {
      const x = ((i % cols + 0.5) / cols - 0.5) * p.width * 0.8;
      const z = ((Math.floor(i / cols) + 0.5) / rows - 0.5) * p.depth * 0.8;
      // A topRatio of zero points along +Y; retraction only scales what shows.
      rig.spikeMeshes.push(kit.cylinder(spikeField, `spike-${i + 1}`, radius, p.spikeHeight,
        [x, p.spikeHeight / 2, z], c.metal, 0));
    }
    const warning = kit.group(motion, 'warning-lamps', [0, p.height + 0.07, -p.depth * 0.44]);
    kit.box(warning, 'warning-lamp', [p.width * 0.5, 0.1, 0.1], [0, 0, 0], c.warning);
    rig.spikes = spikeField; rig.warning = warning;
    point('warning', warning);
    point('hazard', spikeField, [0, p.spikeHeight, 0]);
    spikeField.visible = false; warning.visible = false;
  } else if (p.kind === 'pendulum') {
    const support = kit.group(root, 'pendulum-support');
    // Reserve the whole sweep, including the square head, between the posts.
    const reach = Math.sin(p.swingAmplitude * Math.PI / 180) * p.pendulumLength + p.pendulumHead * 0.72;
    const x = Math.max(p.width * 0.42, reach + 0.16);
    const y = p.height + 0.12 + p.pendulumLength + p.pendulumHead * 0.72;
    for (const side of [-1, 1]) kit.box(support, 'support-post', [POST, y + 0.12, POST], [side * x, (y + 0.12) / 2, 0], c.dark);
    kit.box(support, 'top-beam', [x * 2 + 0.24, 0.16, 0.2], [0, y + 0.12, 0], c.metal);
    const pivot = kit.group(motion, 'pendulum-pivot', [0, y, 0]);
    rig.arm = kit.beam(pivot, 'pendulum-arm', [0, 0, 0], [0, -p.pendulumLength, 0], 0.09, c.metal);
    rig.head = kit.box(pivot, 'pendulum-head', [p.pendulumHead, p.pendulumHead, p.pendulumHead],
      [0, -p.pendulumLength, 0], c.warning);
    rig.pendulum = pivot; rig.support = support;
    point('pivot', motion, [0, y, 0], [0, 0, 1]);
    point('hazard', pivot, [0, -p.pendulumLength, 0], [0, -1, 0]);
  } else if (p.kind === 'liftPlatform') {
    const rails = kit.group(root, 'platform-guides');
    for (const x of [-1, 1]) kit.box(rails, 'guide-rail', [0.1, p.platformTravel + 0.3, 0.1],
      [x * p.width * 0.39, p.height + (p.platformTravel + 0.3) / 2, 0], c.metal);
    const lift = kit.group(motion, 'lift-platform', [0, p.height + 0.04, 0]);
    kit.box(lift, 'platform', [p.width * 0.9, 0.16, p.depth * 0.86], [0, 0.08, 0], c.accent);
    rig.lift = lift; rig.rails = rails;
    point('platform', lift, [0, 0.16, 0]);
  } else if (p.kind === 'rotatingPlatform') {
    const turn = kit.group(motion, 'rotating-platform', [0, p.height + 0.11, 0]);
    kit.cylinder(turn, 'turntable-top', p.platformRadius, 0.14, [0, 0.07, 0], c.accent);
    // One bar keeps the rotation direction readable without an arrow outline.
    kit.box(turn, 'turntable-mark', [p.platformRadius * 0.24, 0.03, p.platformRadius * 1.1], [0, 0.15, 0], c.dark);
    rig.turn = turn;
    point('platform', turn, [0, 0.14, 0]);
  } else if (p.kind === 'launchPad') {
    // Rear hinge: positive X rotation raises the front (−Z) of the ramp.
    const ramp = kit.group(motion, 'launch-ramp', [0, p.height + 0.16, p.depth * 0.35]);
    kit.box(ramp, 'ramp-surface', [p.width * 0.86, PLATE_THICK, p.depth * 0.68], [0, 0.06, -p.depth * 0.34], c.accent);
    kit.box(ramp, 'launch-mark', [p.width * 0.16, 0.03, p.depth * 0.5], [0, 0.135, -p.depth * 0.4], c.dark);
    rig.ramp = ramp;
    point('launch', ramp, [0, 0.14, -p.depth * 0.6], [0, 0, -1]);
  } else if (p.kind === 'saw') {
    const y = p.height + p.sawRadius * 1.25 + 0.15, z = p.depth * 0.25;
    const support = kit.group(root, 'saw-support');
    kit.box(support, 'saw-post', [0.14, y - p.height, 0.14], [0, (y + p.height) / 2, z], c.dark);
    kit.beam(support, 'saw-axle', [0, y, z], [0, y, -p.sawArm], 0.1, c.metal);
    const blade = kit.group(motion, 'saw-blade', [0, y, -p.sawArm]);
    kit.cylinder(blade, 'saw-disc', p.sawRadius, 0.085, [0, 0, 0], c.warning).rotation.x = Math.PI / 2;
    // A single spoke shows the spin; teeth are dropped.
    kit.box(blade, 'saw-spoke', [p.sawRadius * 1.7, p.sawRadius * 0.18, 0.1], [0, 0, 0], c.dark);
    rig.blade = blade; rig.support = support;
    point('axis', motion, [0, y, -p.sawArm], [0, 0, 1]);
    point('hazard', blade, [0, p.sawRadius * 1.13, 0]);
    attachments.edge = attachments.hazard;
  } else if (p.kind === 'gate') {
    const x = -p.width * 0.4, y = p.height + Math.max(0.55, Math.min(0.95, p.gateLength * 0.45));
    for (const px of [x, x + p.gateLength]) kit.box(base, 'gate-post', [POST, y, POST], [px, y / 2, 0], c.dark);
    const gate = kit.group(motion, 'gate-arm-pivot', [x, y, 0]);
    kit.box(gate, 'gate-arm', [p.gateLength, 0.11, 0.11], [p.gateLength / 2, 0, 0], c.accent);
    rig.gate = gate;
    point('barrier', gate, [p.gateLength, 0, 0], [1, 0, 0]);
    indicator([x, y + 0.08, 0]);
  }
  return { rig, attachments, motion };
}

/** Metres, built from Y=0; hidden moving parts never shift the visible bounds. */
export function buildSimpleMechanismVisual(options = {}) {
  const p = normalizeSimpleMechanismOptions(options), kit = createPrimitiveKit(), mesh = new Group();
  mesh.name = `simple-mechanism-${p.preset}`;
  const built = buildParts(kit, mesh, p);
  const api = { mesh, params: p, rig: built.rig, attachments: built.attachments,
    getStats: () => { kit.assertLive(); return kit.stats(mesh); }, dispose: () => kit.dispose(mesh) };
  installMechanismActions(api, kit, built);
  api.bounds = mechanismVisibleBounds(mesh);
  api.dimensions = api.bounds.getSize(new Vector3());
  api.scaleInfo = freezeConfig({ units: 'm', referenceHeight: p.referenceHeight,
    width: api.dimensions.x, depth: api.dimensions.z, height: api.dimensions.y });
  return api;
}

// Shared action machinery, inlined from the detailed factory under this file's
// historical name so the simplified rig runs the same state machine.
const TAU = Math.PI * 2;
const clamp01 = value => Math.max(0, Math.min(1, value));
const ease = value => value * value * (3 - 2 * value);
function actionSpec(id, p) {
  const oneShot = ['press', 'toggle', 'launch', 'operate'].includes(id);
  const periods = {
    warning: 1 / p.warningBlink,
    cycle: p.retractedDuration + p.warningDuration + 2 * p.spikeMoveDuration + p.extendedDuration,
    swing: p.swingPeriod, travel: p.motionPeriod, rotate: p.rotatePeriod,
    charge: p.motionPeriod, spin: p.sawSpeed === 0 ? undefined : 1 / Math.abs(p.sawSpeed),
  };
  const period = periods[id], mode = oneShot ? 'once' : period ? 'loop' : 'static';
  return { label: MECHANISM_MOTION_BY_KIND[p.kind][id], mode, loop: mode === 'loop', static: mode === 'static',
    ...(oneShot ? { duration: (id === 'launch' ? p.launchDuration : p.switchDuration) / p.actionSpeed } : {}),
    ...(period ? { period: period / p.actionSpeed } : {}) };
}
export function mechanismVisibleBounds(root) {
  root.updateWorldMatrix(true, true);
  const bounds = new Box3();
  root.traverseVisible(node => { if (node.isMesh) bounds.expandByObject(node, true); });
  return bounds;
}
/** Shared by the simplified factory: the same state machine drives both rigs. */
export function installMechanismActions(api, kit, built) {
  const { motion, rig } = built, p = api.params;
  const neutral = [];
  motion.traverse(node => neutral.push({ node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(), visible: node.visible }));
  const restore = () => neutral.forEach(n => { n.node.position.copy(n.position); n.node.quaternion.copy(n.quaternion); n.node.scale.copy(n.scale); n.node.visible = n.visible; });
  let state;
  Object.defineProperty(api, 'actionState', { enumerable: true, get: () => ({ ...state }) });
  api.motions = MECHANISM_MOTION_BY_KIND[p.kind];
  api.actions = freezeConfig(Object.fromEntries(Object.keys(api.motions).map(id => [id, actionSpec(id, p)])));
  api.getPoseBounds = () => { kit.assertLive(); return mechanismVisibleBounds(api.mesh); };
  api.setPose = (action = 'still', seconds = 0) => {
    kit.assertLive();
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) throw new TypeError('time must be finite');
    if (!Object.hasOwn(api.motions, action)) throw new RangeError(`unknown ${p.kind} motion: ${action}`);
    restore();
    const spec = api.actions[action], time = Math.max(0, seconds);
    const progress = spec.mode === 'once' ? clamp01(time / spec.duration) : spec.loop ? (time % spec.period) / spec.period : 0;
    const elapsed = spec.loop ? progress * spec.period * p.actionSpeed : 0;
    const u = ease(progress);
    state = { id: action, mode: spec.mode, phase: 'idle', progress, value: 0,
      active: spec.loop || (spec.mode === 'once' && progress < 1), finished: spec.mode === 'once' && progress >= 1 };
    if (p.kind === 'pressurePlate' || p.kind === 'button') {
      const value = action === 'pressed' ? 1 : action === 'press' ? u : 0;
      rig.plate.position.y -= p.plateTravel * value;
      rig.springs.scale.y = Math.max(.001, 1 - value);
      rig.indicator.visible = value >= .98;
      Object.assign(state, { value, pressed: value >= .98, phase: value >= .98 ? 'pressed' : value > 0 ? 'pressing' : 'released' });
    } else if (p.kind === 'lever') {
      const value = action === 'on' ? 1 : action === 'toggle' ? u : 0;
      const angle = (2 * value - 1) * p.leverAmplitude * Math.PI / 180;
      rig.lever.rotation.z = angle;
      rig.indicator.visible = value >= .5;
      Object.assign(state, { value, angle, switched: value >= .5, phase: value === 1 ? 'on' : value > 0 ? 'switching' : 'off' });
    } else if (p.kind === 'spikes') {
      let value = action === 'extended' ? 1 : 0, phase = action === 'warning' ? 'warning' : value ? 'extended' : 'retracted';
      let warningTime = elapsed;
      if (action === 'cycle') {
        const warningStart = p.retractedDuration, extendStart = warningStart + p.warningDuration;
        const holdStart = extendStart + p.spikeMoveDuration, retractStart = holdStart + p.extendedDuration;
        if (elapsed < warningStart) phase = 'retracted';
        else if (elapsed < extendStart) { phase = 'warning'; warningTime = elapsed - warningStart; }
        else if (elapsed < holdStart) { phase = 'extending'; value = ease(clamp01((elapsed - extendStart) / p.spikeMoveDuration)); }
        else if (elapsed < retractStart) { phase = 'extended'; value = 1; }
        else { phase = 'retracting'; value = 1 - ease(clamp01((elapsed - retractStart) / p.spikeMoveDuration)); }
      }
      rig.spikes.visible = value > 0;
      for (const spike of rig.spikeMeshes) {
        spike.scale.y = Math.max(1e-6, p.spikeHeight * value);
        spike.position.y = p.spikeHeight * value / 2;
      }
      api.attachments.hazard.position.y = p.spikeHeight * value;
      rig.warning.visible = phase === 'warning' && (warningTime * p.warningBlink % 1) < .5;
      Object.assign(state, { value, phase, extended: value >= .98, warning: phase === 'warning', warningLit: rig.warning.visible });
    } else if (p.kind === 'pendulum') {
      const angle = action === 'swing' ? Math.sin(progress * TAU) * p.swingAmplitude * Math.PI / 180 : 0;
      rig.pendulum.rotation.z = angle;
      Object.assign(state, { angle, value: angle, phase: action === 'swing' ? 'swinging' : 'idle' });
    } else if (p.kind === 'liftPlatform') {
      const value = action === 'up' ? 1 : action === 'travel' ? (1 - Math.cos(progress * TAU)) / 2 : 0;
      rig.lift.position.y += value * p.platformTravel;
      Object.assign(state, { value, height: value * p.platformTravel,
        phase: action === 'travel' ? progress < .5 ? 'rising' : 'lowering' : value ? 'up' : 'down' });
    } else if (p.kind === 'rotatingPlatform') {
      const angle = action === 'rotate' ? progress * TAU : 0;
      rig.turn.rotation.y = angle;
      Object.assign(state, { angle, value: angle, phase: action === 'rotate' ? 'rotating' : 'idle' });
    } else if (p.kind === 'launchPad') {
      const value = action === 'launch' ? u : action === 'charge' ? (1 - Math.cos(progress * TAU)) * .07 : 0;
      const angle = p.launchAngle * Math.PI / 180 * value;
      rig.ramp.rotation.x = angle;
      if (action === 'launch') {
        rig.ramp.position.z -= p.launchTravel * value * Math.cos(p.launchAngle * Math.PI / 180);
        rig.ramp.position.y += p.launchTravel * value * Math.sin(p.launchAngle * Math.PI / 180);
      }
      Object.assign(state, { value, angle, launched: action === 'launch' && progress >= 1,
        phase: action === 'charge' ? 'charging' : action === 'launch' ? progress >= 1 ? 'launched' : 'launching' : 'idle' });
    } else if (p.kind === 'saw') {
      const angle = action === 'spin' ? progress * TAU * Math.sign(p.sawSpeed) : 0;
      rig.blade.rotation.z = angle;
      Object.assign(state, { angle, value: angle, phase: action === 'spin' && p.sawSpeed !== 0 ? 'spinning' : 'idle' });
    } else if (p.kind === 'gate') {
      const value = action === 'open' ? 1 : action === 'operate' ? u : 0;
      const angle = p.gateAngle * Math.PI / 180 * value;
      rig.gate.rotation.z = angle;
      rig.indicator.visible = value >= .98;
      Object.assign(state, { value, angle, open: value >= .98, phase: value === 1 ? 'open' : value > 0 ? 'opening' : 'closed' });
    }
    api.mesh.updateWorldMatrix(true, true);
    return api;
  };
  api.reset = () => api.setPose('still', 0);
  api.getAttachmentFrame = name => {
    kit.assertLive();
    const node = api.attachments[name];
    if (!node) throw new RangeError(`unknown mechanism attachment: ${name}`);
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
export { MECHANISM_MOTIONS as SIMPLE_MECHANISM_MOTIONS };
export { MECHANISM_MOTION_BY_KIND as SIMPLE_MECHANISM_MOTION_BY_KIND };
export { MECHANISM_TYPES as SIMPLE_MECHANISM_TYPES };
export { SIMPLE_MECHANISM_PRESETS as MECHANISM_PRESETS };
export { SIMPLE_MECHANISM_PRESET_LOCKED_FIELDS as MECHANISM_PRESET_LOCKED_FIELDS };
export { SIMPLE_MECHANISM_SCHEMA as MECHANISM_SCHEMA };
export { normalizeSimpleMechanismOptions as normalizeMechanismOptions };
export { randomSimpleMechanismOptions as randomMechanismOptions };
export { buildSimpleMechanismVisual as createMechanismVisual, buildSimpleMechanismVisual as buildMechanismVisual };