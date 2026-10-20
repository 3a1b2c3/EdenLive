import { Group } from 'three';
import { createPrimitiveKit, freezeConfig, normalizeFactoryOptions,
  randomFactoryOptions, finishVisual } from './VisualFactoryUtils.js';
import { CREATURE_ACTION_SCHEMA, installCreatureActions } from './CreatureActions.js';

// Simplified bird: body block, head with a wedge beak, one flat panel per wing,
// one tail wedge and straight legs. No feather layers, eyes, crests, wattles,
// stripes or toes; the flapping and combat actions are the shared ones.
// The Simple-prefixed exports are canonical; the unprefixed aliases at the end
// keep this module's historical name and consumers unchanged.
export const SIMPLE_BIRD_PRESETS = freezeConfig({
  sparrow: { type: 'songbird', bodyLength: 0.8, bodyWidth: 0.52, bodyHeight: 0.62, wingSpan: 1.25, wingShape: 'rounded', beakLength: 0.2, tailLength: 0.42, legLength: 0.26 },
  crow: { type: 'songbird', bodyLength: 1.05, bodyWidth: 0.62, bodyHeight: 0.72, wingSpan: 1.65, wingShape: 'point', beakLength: 0.3, tailLength: 0.6, legLength: 0.3, colors: { body: '#35434a', wing: '#27383f', accent: '#89a49b' } },
  pigeon: { type: 'songbird', bodyLength: 1, bodyWidth: 0.68, bodyHeight: 0.78, wingSpan: 1.7, wingShape: 'rounded', beakLength: 0.18, tailLength: 0.5, legLength: 0.3, colors: { body: '#8b9b9c', wing: '#718586', accent: '#d1b06b' } },
  eagle: { type: 'raptor', bodyLength: 1.55, bodyWidth: 0.86, bodyHeight: 0.92, wingSpan: 3.6, wingShape: 'point', headScale: 0.82, beakLength: 0.42, tailLength: 0.82, legLength: 0.46, colors: { body: '#7a6049', wing: '#4c5350', accent: '#d8b85f' } },
  hawk: { type: 'raptor', bodyLength: 1.35, bodyWidth: 0.74, bodyHeight: 0.82, wingSpan: 3, wingShape: 'swept', headScale: 0.76, beakLength: 0.34, tailLength: 0.76, legLength: 0.42, colors: { body: '#a47d58', wing: '#6f604d', accent: '#c79c56' } },
  parrot: { type: 'tropical', bodyLength: 1, bodyWidth: 0.7, bodyHeight: 0.9, wingSpan: 1.85, wingShape: 'point', headScale: 0.9, beakLength: 0.3, tailLength: 1.05, legLength: 0.27, colors: { body: '#4eaa78', wing: '#3984a5', accent: '#e76f57', beak: '#d99b45' } },
  flamingo: { type: 'wading', bodyLength: 1.25, bodyWidth: 0.6, bodyHeight: 0.72, wingSpan: 2.1, wingShape: 'long', neckLength: 1.15, headScale: 0.58, beakLength: 0.36, tailLength: 0.46, legLength: 1.35, colors: { body: '#e39b9d', wing: '#d97d87', accent: '#5c7583', beak: '#46575b', leg: '#bd756d' } },
  penguin: { type: 'wading', bodyLength: 1, bodyWidth: 0.72, bodyHeight: 1.2, wingSpan: 1.55, wingShape: 'long', neckLength: 0.16, headScale: 0.78, beakLength: 0.2, tailLength: 0.24, legLength: 0.24, colors: { body: '#344851', wing: '#283b45', accent: '#e0aa58', beak: '#d69a4d', leg: '#d49a50' } },
  owl: { type: 'raptor', bodyLength: 1.1, bodyWidth: 0.9, bodyHeight: 1.05, wingSpan: 2.1, wingShape: 'rounded', headScale: 1.08, beakLength: 0.18, tailLength: 0.34, legLength: 0.25, colors: { body: '#8d735d', wing: '#6b594e', accent: '#d9ad65' } },
  duck: { type: 'waterfowl', bodyLength: 1.1, bodyWidth: 0.78, bodyHeight: 0.78, wingSpan: 1.7, wingShape: 'rounded', headScale: 0.74, beakLength: 0.34, tailLength: 0.3, legLength: 0.3, colors: { body: '#8d9f6e', wing: '#6f805d', accent: '#d6a04f', beak: '#e1a34f', leg: '#d38c4f' } },
  swan: { type: 'waterfowl', bodyLength: 1.6, bodyWidth: 0.82, bodyHeight: 0.82, wingSpan: 2.8, wingShape: 'long', neckLength: 1.32, neckAngle: 24, headScale: 0.62, beakLength: 0.24, tailLength: 0.48, legLength: 0.42, colors: { body: '#e8e5d7', wing: '#cbcfc3', accent: '#d79669', beak: '#d28c54', leg: '#bd7d65' } },
  rooster: { type: 'farmbird', bodyLength: 1.18, bodyWidth: 0.68, bodyHeight: 0.9, wingSpan: 1.75, wingShape: 'point', neckLength: 0.28, headScale: 0.82, beakLength: 0.24, tailLength: 0.95, legLength: 0.52, colors: { body: '#c65f4e', wing: '#477d79', accent: '#d6b05a', beak: '#d89b50', leg: '#b77a57' } },
  hummingbird: { type: 'tropical', bodyLength: 0.62, bodyWidth: 0.34, bodyHeight: 0.42, wingSpan: 1.25, wingShape: 'long', headScale: 0.68, beakLength: 0.5, tailLength: 0.45, legLength: 0.12, flapSpeed: 9.5, glide: 0.05, colors: { body: '#4a9e9a', wing: '#6b79a8', accent: '#df865a', beak: '#303c46' } },
});

export const SIMPLE_BIRD_SCHEMA = freezeConfig({
  type: { label: 'bird body type', default: 'songbird', choices: { songbird: 'songbird', raptor: 'raptor', tropical: 'tropical', wading: 'wading', waterfowl: 'waterfowl', farmbird: 'farm bird' }, randomize: false },
  bodyLength: { label: 'body length', default: 1.05, min: 0.45, max: 2.3, step: 0.02 },
  bodyWidth: { label: 'body width', default: 0.62, min: 0.2, max: 1.35, step: 0.02 },
  bodyHeight: { label: 'body height', default: 0.75, min: 0.28, max: 1.8, step: 0.02 },
  wingSpan: { label: 'wing span', default: 1.8, min: 0.6, max: 5.5, step: 0.05 },
  wingShape: { label: 'wing shape', default: 'rounded', choices: { rounded: 'rounded', point: 'pointed', swept: 'swept', long: 'long' } },
  neckLength: { label: 'neck length', default: 0.25, min: 0.05, max: 1.8, step: 0.02 },
  neckAngle: { label: 'neck raise angle', default: 10, min: -25, max: 55, step: 1, fullRange: true },
  headScale: { label: 'head scale', default: 0.76, min: 0.42, max: 1.25, step: 0.02 },
  beakLength: { label: 'beak length', default: 0.28, min: 0.08, max: 0.8, step: 0.02 },
  tailLength: { label: 'tail length', default: 0.5, min: 0.12, max: 1.5, step: 0.02 },
  legLength: { label: 'leg length', default: 0.3, min: 0, max: 1.8, step: 0.02 },
  flapSpeed: { label: 'flap speed', default: 3.2, min: 0.2, max: 12, step: 0.1 },
  glide: { label: 'glide ratio', default: 0.35, min: 0, max: 1, step: 0.05 },
  ...CREATURE_ACTION_SCHEMA,
});

// Locked details: wing fold, chord, tail spread and leg girth follow the body.
const WING_FOLD = 0.2, TAIL_SWAY = 0.45;

const PALETTE = { body: '#7b927e', wing: '#4e746e', accent: '#d29b61', beak: '#c78b4a', leg: '#9f755b' };
const PALETTES = [PALETTE,
  { ...PALETTE, body: '#d58a62', wing: '#9e6258', accent: '#4f8f8a' },
  { ...PALETTE, body: '#668d83', wing: '#406e73', accent: '#ddb45e' },
  { ...PALETTE, body: '#9d9fa2', wing: '#69747e', accent: '#c98370' },
  { ...PALETTE, body: '#e2d9c2', wing: '#c3b6a2', accent: '#d98971' },
];
export const normalizeSimpleBirdOptions = (options = {}) =>
  normalizeFactoryOptions(options, SIMPLE_BIRD_PRESETS, SIMPLE_BIRD_SCHEMA, PALETTE);
export const randomSimpleBirdOptions = (seed = 1, overrides = {}) =>
  randomFactoryOptions(seed, overrides, SIMPLE_BIRD_PRESETS, SIMPLE_BIRD_SCHEMA,
    PALETTES, normalizeSimpleBirdOptions);

/** Simplified bird. +Y up, beak toward -Z, root at the feet. */
export function buildSimpleBirdVisual(options = {}) {
  const p = normalizeSimpleBirdOptions(options), c = p.colors;
  const kit = createPrimitiveKit(), mesh = new Group();
  mesh.name = `simple-bird-${p.preset}`;
  const motion = kit.group(mesh, 'flight-rig');
  const bodyY = p.legLength + p.bodyHeight * 0.54;
  const body = kit.group(motion, 'body', [0, bodyY, 0]);
  kit.sphere(body, 'torso', [p.bodyWidth, p.bodyHeight, p.bodyLength], [0, 0, 0], c.body);

  const angle = p.neckAngle * Math.PI / 180;
  const neckBase = [0, bodyY + p.bodyHeight * 0.22, -p.bodyLength * 0.31];
  const neckTop = [0, neckBase[1] + p.neckLength * Math.cos(angle), neckBase[2] - p.neckLength * Math.sin(angle)];
  const neck = kit.group(motion, 'neck');
  if (p.neckLength > 0.06) kit.beam(neck, 'neck-segment', neckBase, neckTop, Math.max(0.08, p.bodyWidth * 0.28), c.body);
  const head = kit.group(neck, 'head', neckTop);
  const headH = p.bodyHeight * p.headScale * 0.72, headW = p.bodyWidth * p.headScale * 0.9;
  kit.box(head, 'head-block', [headW, headH, headW], [0, 0, 0], c.body);
  const beak = kit.nose(head, 'beak', [headW * 0.5, headH * 0.34, p.beakLength],
    [0, -headH * 0.05, -headW * 0.5 - p.beakLength * 0.45], c.beak, 0.3, 0.35);

  // One flat panel per wing; the outline is the only thing the shape changes.
  const wings = [], halfSpan = Math.max(p.bodyWidth * 0.45, p.wingSpan * 0.5);
  const chord = p.bodyLength * (p.wingShape === 'long' ? 0.68 : p.wingShape === 'point' ? 0.5 : 0.58);
  for (const side of [-1, 1]) {
    const wing = kit.group(motion, `${side < 0 ? 'left' : 'right'}-wing`,
      [side * p.bodyWidth * 0.42, bodyY + p.bodyHeight * 0.12, 0]);
    wing.rotation.y = side < 0 ? Math.PI : 0;
    wing.rotation.x = WING_FOLD * (side < 0 ? -1 : 1);
    const tipZ = p.wingShape === 'swept' ? chord * 0.48 : p.wingShape === 'point' ? chord * 0.16 : 0;
    const tipChord = p.wingShape === 'point' ? chord * 0.1 : p.wingShape === 'long' ? chord * 0.28 : chord * 0.48;
    kit.slab(wing, 'wing-panel', [[0, -chord * 0.48], [halfSpan, tipZ - tipChord * 0.5],
      [halfSpan * 0.94, tipZ + tipChord * 0.5], [0, chord * 0.45]],
      Math.max(0.06, p.bodyHeight * 0.1), [0, 0, 0], c.wing);
    wings.push({ wing, baseX: wing.rotation.x });
  }

  const tailRoot = kit.group(motion, 'tail', [0, bodyY + p.bodyHeight * 0.04, p.bodyLength * 0.43]);
  kit.prism(tailRoot, 'tail-feather', [[-0.5, 0], [0.5, 0], [0.18, 1], [-0.18, 1]],
    [Math.max(p.bodyWidth * 0.55, p.tailLength * 0.68), Math.max(p.bodyHeight * 0.4, p.tailLength * 0.5), p.tailLength * 0.72],
    [0, 0, p.tailLength * 0.28], c.wing);

  const legs = [];
  if (p.legLength > 0.02) for (const side of [-1, 1]) {
    const root = kit.group(motion, `${side < 0 ? 'left' : 'right'}-leg`,
      [side * p.bodyWidth * 0.2, bodyY - p.bodyHeight * 0.45, -p.bodyLength * 0.04]);
    kit.beam(root, 'shin', [0, 0, 0], [0, -p.legLength, 0], Math.max(0.04, p.bodyWidth * 0.09), c.leg);
    kit.box(root, 'foot', [p.bodyWidth * 0.28, p.bodyWidth * 0.08, p.bodyWidth * 0.42],
      [0, -p.legLength, -p.bodyWidth * 0.12], c.leg);
    legs.push(root);
  }

  const api = finishVisual(kit, mesh, p, { rig: motion, wings, legs, tail: tailRoot,
    attachments: { head, beak } });
  const rig = { body, head, tail: tailRoot,
    legs: legs.map((root, i) => ({ root, side: i ? 1 : -1 })),
    wings: wings.map(({ wing }, i) => ({ root: wing, side: i ? 1 : -1, mirrored: true })) };
  return installCreatureActions(api, kit, { motion, rig, family: 'bird', numericTime: true,
    animate(action, seconds) {
      const amount = action === 'idle' ? 0.1 : 1;
      const flap = (0.16 + (1 - p.glide) * 0.72) * amount;
      wings.forEach(({ wing, baseX }, i) => {
        wing.rotation.x = baseX + Math.sin(seconds * p.flapSpeed + i * Math.PI) * flap;
      });
      tailRoot.rotation.y = Math.sin(seconds * 1.35) * TAIL_SWAY * 0.25 * amount;
      if (action === 'move') legs.forEach((leg, i) => {
        leg.rotation.x = p.glide > 0.6 ? 0.6 : Math.sin(seconds * 2 + i) * 0.04;
      });
    },
  });
}

// Compatibility exports: the simplified factory replaces the original under
// this module's historical name, and keeps the original consumer surface.
export { SIMPLE_BIRD_PRESETS as BIRD_PRESETS };
export { SIMPLE_BIRD_SCHEMA as BIRD_SCHEMA };
export { normalizeSimpleBirdOptions as normalizeBirdOptions };
export { randomSimpleBirdOptions as randomBirdOptions };
export { buildSimpleBirdVisual as createBirdVisual, buildSimpleBirdVisual as buildBirdVisual };