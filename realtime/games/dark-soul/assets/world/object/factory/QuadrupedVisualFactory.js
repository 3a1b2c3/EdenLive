import { Group } from 'three';
import { createPrimitiveKit, freezeConfig, normalizeFactoryOptions,
  randomFactoryOptions, finishVisual } from './VisualFactoryUtils.js';
import { CREATURE_ACTION_SCHEMA, installCreatureActions } from './CreatureActions.js';

// Simplified four-legged animal: one body block, four rigid legs, a neck beam,
// a head with a snout, and the silhouette features that tell species apart
// (ears, horns, tusks, humps, tail). No knees, paws, eyes, spots, manes or
// fleece, and the combat actions are the shared ones, unchanged.
// The Simple-prefixed exports are canonical; the unprefixed aliases at the end
// keep this module's historical name and consumers unchanged.
export const SIMPLE_QUADRUPED_PRESETS = freezeConfig({
  dog: { type: 'canid', bodyLength: 2.35, bodyWidth: 0.82, bodyHeight: 0.95, legLength: 1.05, neckLength: 0.38, neckAngle: 34, headScale: 0.62, ears: 'point', tail: 'long', tailLength: 0.85 },
  cat: { type: 'feline', bodyLength: 1.65, bodyWidth: 0.58, bodyHeight: 0.7, legLength: 0.8, neckLength: 0.28, neckAngle: 18, headScale: 0.6, ears: 'point', tail: 'long', tailLength: 0.95, bodyStyle: 'round' },
  fox: { type: 'canid', bodyLength: 2.05, bodyWidth: 0.7, bodyHeight: 0.78, legLength: 0.95, neckLength: 0.42, neckAngle: 30, headScale: 0.58, ears: 'point', tail: 'long', tailLength: 1.1, colors: { body: '#c87955', accent: '#e3b779' } },
  wolf: { type: 'canid', bodyLength: 2.8, bodyWidth: 0.95, bodyHeight: 1.1, legLength: 1.25, neckLength: 0.48, neckAngle: 28, headScale: 0.66, ears: 'point', tail: 'long', tailLength: 1.25, colors: { body: '#89989a', accent: '#d5d6c1' } },
  horse: { type: 'equine', bodyLength: 3.25, bodyWidth: 1.05, bodyHeight: 1.35, legLength: 1.75, neckLength: 1.05, neckAngle: 24, headScale: 0.66, ears: 'point', tail: 'long', tailLength: 1.35, stride: 0.72, colors: { body: '#a7775b', accent: '#e2bd88' } },
  deer: { type: 'ruminant', bodyLength: 2.55, bodyWidth: 0.82, bodyHeight: 1.15, legLength: 1.55, neckLength: 0.86, neckAngle: 18, headScale: 0.58, ears: 'round', tail: 'short', tailLength: 0.36, horns: true, colors: { body: '#b8845c', accent: '#e3cf9a' } },
  cow: { type: 'ruminant', bodyLength: 2.75, bodyWidth: 1.25, bodyHeight: 1.45, legLength: 1.15, neckLength: 0.55, neckAngle: 14, headScale: 0.72, ears: 'round', tail: 'long', tailLength: 0.95, horns: true, bodyStyle: 'box', colors: { body: '#e2ddd0', accent: '#c88876' } },
  sheep: { type: 'ruminant', bodyLength: 1.85, bodyWidth: 1.02, bodyHeight: 1.1, legLength: 0.78, neckLength: 0.3, neckAngle: 10, headScale: 0.57, ears: 'round', tail: 'short', tailLength: 0.24, bodyStyle: 'round', colors: { body: '#e8e2d1', accent: '#9b806e' } },
  goat: { type: 'ruminant', bodyLength: 1.8, bodyWidth: 0.72, bodyHeight: 0.95, legLength: 1, neckLength: 0.5, neckAngle: 23, headScale: 0.55, ears: 'point', tail: 'short', tailLength: 0.25, horns: true, colors: { body: '#b9a68d', accent: '#6d665f' } },
  pig: { type: 'small', bodyLength: 1.75, bodyWidth: 0.9, bodyHeight: 0.88, legLength: 0.48, neckLength: 0.14, neckAngle: 4, headScale: 0.68, ears: 'point', tail: 'short', tailLength: 0.42, bodyStyle: 'round', colors: { body: '#d58f85', accent: '#b96d6c' } },
  rabbit: { type: 'small', bodyLength: 1.15, bodyWidth: 0.56, bodyHeight: 0.7, legLength: 0.45, neckLength: 0.14, neckAngle: 0, headScale: 0.62, ears: 'long', tail: 'short', tailLength: 0.2, bodyStyle: 'round', stride: 0.85, colors: { body: '#d7c5ae', accent: '#d58e85' } },
  elephant: { type: 'pachyderm', bodyLength: 3.65, bodyWidth: 1.75, bodyHeight: 2, legLength: 1.2, neckLength: 0.24, neckAngle: 0, headScale: 0.95, ears: 'round', tail: 'long', tailLength: 0.95, tusks: true, bodyStyle: 'round', colors: { body: '#9b9f94', accent: '#e2c48d' } },
  giraffe: { type: 'ruminant', bodyLength: 2.7, bodyWidth: 0.92, bodyHeight: 1.15, legLength: 1.75, neckLength: 1.65, neckAngle: 3, headScale: 0.55, ears: 'round', tail: 'long', tailLength: 1.15, horns: true, colors: { body: '#d7ae67', accent: '#8d654d' } },
  camel: { type: 'pachyderm', bodyLength: 3.25, bodyWidth: 1.15, bodyHeight: 1.55, legLength: 1.5, neckLength: 0.85, neckAngle: 24, headScale: 0.62, ears: 'round', tail: 'long', tailLength: 0.8, humps: 2, colors: { body: '#c59867', accent: '#e2c28b' } },
  turtle: { type: 'reptile', bodyLength: 1.7, bodyWidth: 1.2, bodyHeight: 0.58, legLength: 0.22, neckLength: 0.18, neckAngle: 0, headScale: 0.48, ears: 'none', tail: 'short', tailLength: 0.22, bodyStyle: 'shell', colors: { body: '#728f71', accent: '#b8a16b' } },
});

export const SIMPLE_QUADRUPED_SCHEMA = freezeConfig({
  type: { label: 'body type', default: 'canid', choices: { canid: 'canine', feline: 'feline', equine: 'equine', ruminant: 'ruminant', small: 'small animal', pachyderm: 'pachyderm', reptile: 'reptilian' }, randomize: false },
  bodyLength: { label: 'body length', default: 2.2, min: 0.8, max: 4.5, step: 0.05 },
  bodyWidth: { label: 'body width', default: 0.85, min: 0.35, max: 2.2, step: 0.05 },
  bodyHeight: { label: 'body height', default: 1, min: 0.35, max: 2.4, step: 0.05 },
  bodyStyle: { label: 'body profile', default: 'round', choices: { round: 'rounded', box: 'boxy', shell: 'shell' } },
  legLength: { label: 'leg length', default: 1, min: 0.2, max: 2.5, step: 0.05 },
  neckLength: { label: 'neck length', default: 0.4, min: 0.05, max: 1.9, step: 0.05 },
  neckAngle: { label: 'neck lift angle', default: 22, min: -20, max: 70, step: 1, fullRange: true },
  headScale: { label: 'head scale', default: 0.62, min: 0.3, max: 1.25, step: 0.02 },
  ears: { label: 'ear shape', default: 'point', choices: { none: 'none', point: 'pointed', round: 'round', long: 'long' } },
  tail: { label: 'tail', default: 'long', choices: { none: 'none', short: 'short', long: 'long' } },
  tailLength: { label: 'tail length', default: 0.8, min: 0.1, max: 1.8, step: 0.05, when: p => p.tail !== 'none' },
  horns: { label: 'horns / antlers', default: false, when: p => ['ruminant', 'pachyderm'].includes(p.type) },
  tusks: { label: 'tusks', default: false, when: p => p.type === 'pachyderm' },
  humps: { label: 'hump count', default: 0, min: 0, max: 2, step: 1, when: p => p.type === 'pachyderm' },
  stride: { label: 'stride amount', default: 0.55, min: 0, max: 1, step: 0.05 },
  ...CREATURE_ACTION_SCHEMA,
});

// Locked details: limb girth, snout size and tail lift follow the body.
const LEG_GIRTH = 0.22, SNOUT_RATIO = 0.62, TAIL_CURL = 0.35, EAR_LIFT = 0.42;

const PALETTE = { body: '#a98061', accent: '#6e806e', hoof: '#514d4b' };
const PALETTES = [PALETTE,
  { ...PALETTE, body: '#8d9c98', accent: '#d1a15f' },
  { ...PALETTE, body: '#d08a59', accent: '#6e9b88' },
  { ...PALETTE, body: '#d8d1bb', accent: '#bd806c' },
  { ...PALETTE, body: '#748e76', accent: '#d9b56d' },
];
export const normalizeSimpleQuadrupedOptions = (options = {}) =>
  normalizeFactoryOptions(options, SIMPLE_QUADRUPED_PRESETS, SIMPLE_QUADRUPED_SCHEMA, PALETTE);
export const randomSimpleQuadrupedOptions = (seed = 1, overrides = {}) =>
  randomFactoryOptions(seed, overrides, SIMPLE_QUADRUPED_PRESETS, SIMPLE_QUADRUPED_SCHEMA,
    PALETTES, normalizeSimpleQuadrupedOptions);

/** Simplified four-legged animal. +Y up, front toward -Z, root at the feet. */
export function buildSimpleQuadrupedVisual(options = {}) {
  const p = normalizeSimpleQuadrupedOptions(options), c = p.colors;
  const kit = createPrimitiveKit(), mesh = new Group();
  mesh.name = `simple-quadruped-${p.preset}`;
  const motion = kit.group(mesh, 'motion-rig');
  const bodyY = p.legLength + p.bodyHeight * 0.52;
  const body = kit.group(motion, 'body', [0, bodyY, 0]);
  const size = [p.bodyWidth, p.bodyHeight, p.bodyLength];
  if (p.bodyStyle === 'round') kit.sphere(body, 'torso', size, [0, 0, 0], c.body);
  else if (p.bodyStyle === 'shell') kit.frustum(body, 'shell', size, [0, 0.06, 0], c.body, 0.72);
  else kit.box(body, 'torso', size, [0, 0, 0], c.body);
  for (let i = 0; i < p.humps; i++) kit.box(body, 'hump', [p.bodyWidth * 0.5, p.bodyHeight * 0.34, p.bodyLength * 0.24],
    [0, p.bodyHeight * 0.42, (i - (p.humps - 1) / 2) * p.bodyLength * 0.22], c.body);

  // Rigid legs: one box per corner, pivoting at the hip.
  const legs = [], legW = Math.max(0.07, p.bodyWidth * LEG_GIRTH);
  for (const side of [-1, 1]) for (const front of [-1, 1]) {
    const hip = kit.group(motion, `${side < 0 ? 'left' : 'right'}-${front < 0 ? 'front' : 'rear'}-leg`,
      [side * p.bodyWidth * 0.34, bodyY - p.bodyHeight * 0.3, front * p.bodyLength * 0.3]);
    const length = bodyY - p.bodyHeight * 0.3;
    kit.box(hip, 'leg', [legW, length, legW], [0, -length / 2, 0], c.accent);
    legs.push({ root: hip, hip, front: front < 0 });
  }

  const angle = p.neckAngle * Math.PI / 180;
  const neckBase = [0, bodyY + p.bodyHeight * 0.28, -p.bodyLength * 0.34];
  const neckTop = [0, neckBase[1] + p.neckLength * Math.cos(angle), neckBase[2] - p.neckLength * Math.sin(angle)];
  const neck = kit.group(motion, 'neck');
  kit.beam(neck, 'neck-segment', neckBase, neckTop, Math.max(p.bodyWidth * 0.3, p.headScale * 0.26), c.body);
  const head = kit.group(neck, 'head', neckTop);
  const headH = p.bodyHeight * p.headScale * 0.78, headW = p.bodyWidth * p.headScale * 0.85;
  kit.box(head, 'head-block', [headW, headH, headW], [0, 0, 0], c.body);
  const snout = kit.box(head, 'snout', [headW * 0.6, headH * 0.5, headW * SNOUT_RATIO],
    [0, -headH * 0.1, -headW * 0.7], c.body);
  if (p.ears !== 'none') for (const side of [-1, 1]) {
    const tall = p.ears === 'long' ? 1.9 : p.ears === 'point' ? 1 : 0.55;
    kit.box(head, 'ear', [headW * 0.18, headH * 0.4 * tall, headW * 0.14],
      [side * headW * 0.42, headH * (EAR_LIFT + 0.2 * tall), 0], c.body);
  }
  if (p.horns) for (const side of [-1, 1]) kit.beam(head, 'horn',
    [side * headW * 0.26, headH * 0.4, 0], [side * headW * 0.5, headH * 0.95, headW * 0.1], headW * 0.11, c.hoof);
  if (p.tusks) for (const side of [-1, 1]) kit.beam(head, 'tusk',
    [side * headW * 0.22, -headH * 0.15, -headW * 0.5], [side * headW * 0.34, -headH * 0.45, -headW * 1.05], headW * 0.09, c.hoof);

  const tailRoot = kit.group(motion, 'tail', [0, bodyY + p.bodyHeight * 0.08, p.bodyLength * 0.45]);
  if (p.tail !== 'none') kit.beam(tailRoot, 'tail-segment', [0, 0, 0],
    [0, p.tailLength * TAIL_CURL, p.tailLength], Math.max(0.07, p.bodyWidth * 0.16), c.accent);

  const api = finishVisual(kit, mesh, p, { rig: motion, legs, tail: tailRoot,
    attachments: { head, mouth: snout } });
  const rig = { body, head, tail: tailRoot,
    legs: legs.map(leg => ({ root: leg.hip, front: leg.front ? -1 : 1, side: Math.sign(leg.hip.position.x) })) };
  return installCreatureActions(api, kit, { motion, rig, family: 'quadruped', numericTime: true,
    animate(action, seconds) {
      const phase = seconds * (p.type === 'small' ? 4.2 : 2.6);
      if (action === 'move') legs.forEach((leg, i) => {
        leg.hip.rotation.x = Math.sin(phase + (i % 2) * Math.PI) * p.stride * (leg.front ? 0.72 : 0.6);
      });
      tailRoot.rotation.y = Math.sin(seconds * 2.1) * 0.12;
      if (action === 'idle') head.rotation.x += Math.sin(seconds * 1.4) * 0.025;
    },
  });
}

// Compatibility exports: the simplified factory replaces the original under
// this module's historical name, and keeps the original consumer surface.
export { SIMPLE_QUADRUPED_PRESETS as QUADRUPED_PRESETS };
export { SIMPLE_QUADRUPED_SCHEMA as QUADRUPED_SCHEMA };
export { normalizeSimpleQuadrupedOptions as normalizeQuadrupedOptions };
export { randomSimpleQuadrupedOptions as randomQuadrupedOptions };
export { buildSimpleQuadrupedVisual as createQuadrupedVisual, buildSimpleQuadrupedVisual as buildQuadrupedVisual };