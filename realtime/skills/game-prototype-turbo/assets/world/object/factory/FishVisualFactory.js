import { Group } from 'three';
import { createPrimitiveKit, freezeConfig, normalizeFactoryOptions,
  randomFactoryOptions, finishVisual } from './VisualFactoryUtils.js';
import { CREATURE_ACTION_SCHEMA, installCreatureActions } from './CreatureActions.js';

// Simplified aquatic animal: one body block, a tail fin wedge, an optional
// dorsal wedge and two pectoral fins. Eyes, mouths, stripes, spots, whiskers,
// spines and ray wings are gone; jellyfish keep their tentacle beams because
// the shared squash actions animate them.
// The Simple-prefixed exports are canonical; the unprefixed aliases at the end
// keep this module's historical name and consumers unchanged.
export const SIMPLE_FISH_PRESETS = freezeConfig({
  goldfish: { type: 'bony', bodyLength: 1.2, bodyWidth: 0.72, bodyHeight: 0.82, bodyStyle: 'round', finSize: 0.42, dorsal: 'triangle', tailShape: 'fan', colors: { body: '#d9854f', fin: '#d97558', accent: '#e6b75f' } },
  koi: { type: 'bony', bodyLength: 1.8, bodyWidth: 0.76, bodyHeight: 0.78, bodyStyle: 'torpedo', finSize: 0.46, dorsal: 'triangle', tailShape: 'fork', colors: { body: '#eee2c7', fin: '#d77a5d', accent: '#d59857' } },
  carp: { type: 'bony', bodyLength: 1.7, bodyWidth: 0.9, bodyHeight: 0.92, bodyStyle: 'round', finSize: 0.5, dorsal: 'sail', tailShape: 'fan', colors: { body: '#778f78', fin: '#637a6d', accent: '#d1a25e' } },
  trout: { type: 'bony', bodyLength: 1.75, bodyWidth: 0.72, bodyHeight: 0.72, bodyStyle: 'torpedo', finSize: 0.38, dorsal: 'triangle', tailShape: 'fork', colors: { body: '#6f9b88', fin: '#4d796f', accent: '#dfb767' } },
  salmon: { type: 'bony', bodyLength: 2.25, bodyWidth: 0.9, bodyHeight: 0.86, bodyStyle: 'torpedo', finSize: 0.46, dorsal: 'triangle', tailShape: 'fork', swimSpeed: 2.6, colors: { body: '#78948f', fin: '#5a7775', accent: '#d87961' } },
  shark: { type: 'predator', bodyLength: 3.6, bodyWidth: 1.05, bodyHeight: 0.9, bodyStyle: 'torpedo', finSize: 0.72, dorsal: 'sail', tailShape: 'fork', colors: { body: '#667c84', fin: '#4e616a', accent: '#b47c65' } },
  ray: { type: 'ray', bodyLength: 2.2, bodyWidth: 2.8, bodyHeight: 0.38, bodyStyle: 'flat', finSize: 1.2, dorsal: 'none', tailShape: 'ribbon', tailSwing: 0.25, colors: { body: '#8d826f', fin: '#756b5e', accent: '#d1a36d' } },
  puffer: { type: 'puffer', bodyLength: 1.15, bodyWidth: 1.08, bodyHeight: 1.1, bodyStyle: 'round', finSize: 0.34, dorsal: 'triangle', tailShape: 'round', colors: { body: '#b9ad68', fin: '#788a65', accent: '#d47f5e' } },
  clownfish: { type: 'bony', bodyLength: 1.25, bodyWidth: 0.7, bodyHeight: 0.84, bodyStyle: 'round', finSize: 0.42, dorsal: 'sail', tailShape: 'fan', colors: { body: '#dc704d', fin: '#e5a454', accent: '#e9e2c6' } },
  eel: { type: 'long', bodyLength: 3.6, bodyWidth: 0.48, bodyHeight: 0.5, bodyStyle: 'long', finSize: 0.26, dorsal: 'sail', tailShape: 'ribbon', tailSwing: 0.72, colors: { body: '#5d837a', fin: '#446c68', accent: '#d1a663' } },
  whale: { type: 'cetacean', bodyLength: 5.6, bodyWidth: 1.95, bodyHeight: 1.65, bodyStyle: 'torpedo', finSize: 1.05, dorsal: 'sail', tailShape: 'fork', colors: { body: '#567584', fin: '#3e606f', accent: '#8ca9a5' } },
  dolphin: { type: 'cetacean', bodyLength: 4.2, bodyWidth: 1.15, bodyHeight: 1.02, bodyStyle: 'torpedo', finSize: 0.74, dorsal: 'sail', tailShape: 'fork', colors: { body: '#688d97', fin: '#4d727e', accent: '#d2a06c' } },
  seahorse: { type: 'seahorse', bodyLength: 1.7, bodyWidth: 0.56, bodyHeight: 1.2, bodyStyle: 'long', finSize: 0.42, dorsal: 'sail', tailShape: 'ribbon', tailSwing: 0.25, colors: { body: '#c58a64', fin: '#9a6d5a', accent: '#e1b45e' } },
  jellyfish: { type: 'jellyfish', bodyLength: 1.45, bodyWidth: 1.55, bodyHeight: 0.75, bodyStyle: 'flat', finSize: 0.25, dorsal: 'none', tailShape: 'none', tentacles: 7, tailSwing: 0.8, colors: { body: '#b88fb0', fin: '#987ea5', accent: '#e7b96f' } },
});

export const SIMPLE_FISH_SCHEMA = freezeConfig({
  type: { label: 'fish body type', default: 'bony', choices: { bony: 'bony', predator: 'predator', ray: 'ray', puffer: 'puffer', long: 'eel-like', cetacean: 'cetacean', seahorse: 'seahorse', jellyfish: 'jellyfish' }, randomize: false },
  bodyLength: { label: 'body length', default: 1.8, min: 0.55, max: 7, step: 0.05 },
  bodyWidth: { label: 'body width', default: 0.8, min: 0.22, max: 3.4, step: 0.04 },
  bodyHeight: { label: 'body height', default: 0.85, min: 0.25, max: 2.5, step: 0.04 },
  bodyStyle: { label: 'body profile', default: 'torpedo', choices: { round: 'round', torpedo: 'torpedo', flat: 'flat', long: 'long' } },
  finSize: { label: 'fin size', default: 0.48, min: 0.12, max: 1.6, step: 0.03 },
  dorsal: { label: 'dorsal fin', default: 'triangle', choices: { none: 'none', triangle: 'triangle', sail: 'sail' } },
  tailShape: { label: 'tail shape', default: 'fan', choices: { fan: 'fan', fork: 'fork', round: 'round', ribbon: 'ribbon', none: 'none' } },
  tailWidth: { label: 'tail fin width', default: 0.85, min: 0.25, max: 2.2, step: 0.04 },
  tentacles: { label: 'tentacle count', default: 5, min: 2, max: 12, step: 1, when: p => p.type === 'jellyfish' },
  tailSwing: { label: 'tail swing', default: 0.5, min: 0, max: 1, step: 0.05 },
  swimSpeed: { label: 'swim speed', default: 2.4, min: 0.2, max: 8, step: 0.1 },
  ...CREATURE_ACTION_SCHEMA,
});

// Locked details: fin sweep and thickness follow the body size.
const FIN_WAVE = 0.45, PECTORAL_TILT = 0.16;

const PALETTE = { body: '#688d80', fin: '#4c756f', accent: '#dca860' };
const PALETTES = [PALETTE,
  { ...PALETTE, body: '#d1845e', fin: '#a9645d' },
  { ...PALETTE, body: '#5e8290', fin: '#416773', accent: '#d0ab65' },
  { ...PALETTE, body: '#ab9d61', fin: '#74805e' },
  { ...PALETTE, body: '#8e75a1', fin: '#75618d', accent: '#e1b15e' },
];
export const normalizeSimpleFishOptions = (options = {}) =>
  normalizeFactoryOptions(options, SIMPLE_FISH_PRESETS, SIMPLE_FISH_SCHEMA, PALETTE);
export const randomSimpleFishOptions = (seed = 1, overrides = {}) =>
  randomFactoryOptions(seed, overrides, SIMPLE_FISH_PRESETS, SIMPLE_FISH_SCHEMA,
    PALETTES, normalizeSimpleFishOptions);

/** Simplified aquatic animal. +Y up, head toward -Z, root grounded for the plate. */
export function buildSimpleFishVisual(options = {}) {
  const p = normalizeSimpleFishOptions(options), c = p.colors;
  const kit = createPrimitiveKit(), mesh = new Group();
  mesh.name = `simple-fish-${p.preset}`;
  const motion = kit.group(mesh, 'swim-rig');
  const bodyY = p.bodyHeight * 0.72;
  const body = kit.group(motion, 'body', [0, bodyY, 0]);
  const size = [p.bodyWidth, p.bodyHeight, p.bodyLength];
  if (p.bodyStyle === 'flat') kit.frustum(body, 'body-shape', size, [0, 0, 0], c.body, 0.58);
  else if (p.bodyStyle === 'long') kit.box(body, 'body-shape', size, [0, 0, 0], c.body);
  else kit.sphere(body, 'body-shape', size, [0, 0, 0], c.body);

  const tailRoot = kit.group(motion, 'tail', [0, bodyY, p.bodyLength * 0.46]);
  const tailH = Math.max(p.bodyHeight * 0.58, p.tailWidth * 0.55), tailW = Math.max(p.bodyWidth * 0.55, p.tailWidth);
  const thickness = Math.max(0.08, p.bodyWidth * 0.18);
  if (p.tailShape === 'fan' || p.tailShape === 'round') {
    const profile = p.tailShape === 'round' ? [[-0.5, 0], [0.5, 0], [0.4, 0.6], [0, 1], [-0.4, 0.6]]
      : [[-0.5, 0], [0.5, 0], [0.3, 0.6], [0, 1], [-0.3, 0.6]];
    kit.prism(tailRoot, 'tail-fin', profile, [tailW, tailH, thickness], [0, 0, 0], c.fin);
  } else if (p.tailShape === 'fork') {
    const profile = [[-0.5, 0], [0.5, 0], [0.18, 1], [0, 0.52], [-0.18, 1]];
    for (const side of [-1, 1]) kit.prism(tailRoot, 'tail-lobe', profile,
      [tailW * 0.8, tailH * 0.82, thickness], [side * tailW * 0.2, side * tailH * 0.12, 0], c.fin);
  } else if (p.tailShape === 'ribbon') {
    kit.beam(tailRoot, 'tail-ribbon', [0, 0, 0], [0, -p.bodyHeight * 0.12, p.bodyLength * 0.55],
      Math.max(0.05, p.bodyWidth * 0.12), c.fin);
  }

  const fins = [], dorsal = [];
  if (p.dorsal !== 'none') dorsal.push(kit.prism(motion, 'dorsal-fin', [[-0.5, 0], [0.5, 0], [0, 1]],
    [p.bodyWidth * 0.6, p.finSize * (p.dorsal === 'sail' ? 1.5 : 1), p.bodyHeight * 0.12],
    [0, bodyY + p.bodyHeight * 0.5, p.bodyLength * 0.03], c.fin));
  for (const side of [-1, 1]) {
    const root = kit.group(motion, `${side < 0 ? 'left' : 'right'}-pectoral-fin`,
      [side * p.bodyWidth * 0.42, bodyY - p.bodyHeight * 0.02, -p.bodyLength * 0.08]);
    root.rotation.y = side < 0 ? Math.PI : 0;
    root.rotation.z = side * PECTORAL_TILT;
    kit.prism(root, 'pectoral-fin', [[0, 0], [1, 0.2], [0.12, 1]],
      [p.finSize * 1.25, p.finSize * 0.8, Math.max(0.05, p.bodyHeight * 0.1)], [0, 0, 0], c.fin);
    fins.push({ root, baseZ: root.rotation.z });
  }

  const tentacles = [];
  if (p.type === 'jellyfish') for (let i = 0; i < p.tentacles; i++) {
    const a = i * Math.PI * 2 / p.tentacles;
    const root = kit.group(motion, 'tentacle',
      [Math.cos(a) * p.bodyWidth * 0.34, bodyY - p.bodyHeight * 0.32, Math.sin(a) * p.bodyLength * 0.3]);
    kit.beam(root, 'tentacle-segment', [0, 0, 0], [0, -p.bodyHeight * (0.55 + (i % 3) * 0.13), 0],
      Math.max(0.04, p.bodyWidth * 0.08), c.fin);
    tentacles.push({ root, phase: a });
  }

  const api = finishVisual(kit, mesh, p, { rig: motion, fins, dorsal, tail: tailRoot, tentacles,
    attachments: { body, tail: tailRoot } });
  const rig = { body, tail: tailRoot, tentacles,
    fins: [...fins.map(f => ({ ...f, side: Math.sign(f.root.position.x) })), ...dorsal.map(root => ({ root }))] };
  return installCreatureActions(api, kit, { motion, rig,
    family: p.type === 'jellyfish' ? 'jellyfish' : 'fish', numericTime: true,
    animate(action, seconds) {
      const amount = action === 'idle' ? 0.2 : 1;
      tailRoot.rotation.y = Math.sin(seconds * p.swimSpeed) * p.tailSwing * 0.42 * amount;
      fins.forEach(({ root, baseZ }, i) => {
        root.rotation.z = baseZ + Math.sin(seconds * p.swimSpeed * 1.2 + i * Math.PI) * FIN_WAVE * 0.22 * amount;
      });
      tentacles.forEach(({ root, phase }) => {
        root.rotation.z = Math.sin(seconds * 1.5 + phase) * FIN_WAVE * 0.18 * amount;
      });
    },
  });
}

// Compatibility exports: the simplified factory replaces the original under
// this module's historical name, and keeps the original consumer surface.
export { SIMPLE_FISH_PRESETS as FISH_PRESETS };
export { SIMPLE_FISH_SCHEMA as FISH_SCHEMA };
export { normalizeSimpleFishOptions as normalizeFishOptions };
export { randomSimpleFishOptions as randomFishOptions };
export { buildSimpleFishVisual as createFishVisual, buildSimpleFishVisual as buildFishVisual };