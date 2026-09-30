import { Group } from 'three';
import { choiceOption as choice, createPrimitiveKit, freezeConfig,
  normalizeFactoryOptions, randomFactoryOptions, finishVisual } from './VisualFactoryUtils.js';

// Simplified tree: one trunk cylinder plus a crown built from a couple of
// primitives. No branches, no twigs, no roots, no leaf clusters, no fruit or
// flowers, and no shape seed, so the same parameters always give the same tree.
// The Simple-prefixed exports are canonical; the unprefixed aliases at the end
// keep this module's historical name and consumers unchanged.
export const SIMPLE_TREE_MOTIONS = Object.freeze({ still: 'still', wind: 'wind sway' });
const MOTION_IDS = Object.keys(SIMPLE_TREE_MOTIONS);

export const SIMPLE_TREE_PRESETS = freezeConfig({
  oak: { shape: 'blob', height: 7, crownWidth: 6 },
  maple: { shape: 'blob', height: 6, crownWidth: 5, colors: { leaf: '#cb8a4e' } },
  birch: { shape: 'blob', height: 8, crownWidth: 3.7, trunkRadius: 0.14,
    colors: { bark: '#d9d9bf', leaf: '#9eb475' } },
  pine: { shape: 'cone', height: 9, crownWidth: 4, crownRatio: 0.7 },
  fir: { shape: 'layered', height: 11, crownWidth: 5, crownRatio: 0.8, layers: 4,
    colors: { leaf: '#497e6c' } },
  cypress: { shape: 'column', height: 8, crownWidth: 1.9, crownRatio: 0.8 },
  palm: { shape: 'fan', height: 8, crownWidth: 6.5, trunkRadius: 0.22, crownRatio: 0.22 },
  acacia: { shape: 'umbrella', height: 6, crownWidth: 8, crownRatio: 0.28 },
  willow: { shape: 'blob', height: 7, crownWidth: 6, crownRatio: 0.62,
    colors: { leaf: '#88a674' } },
  cherry: { shape: 'blob', height: 5, crownWidth: 5.3, colors: { leaf: '#dba5a0' } },
  baobab: { shape: 'umbrella', height: 8, crownWidth: 6, trunkRadius: 0.95, crownRatio: 0.3 },
  shrub: { shape: 'blob', height: 1.7, crownWidth: 2.6, crownRatio: 0.8, trunkRadius: 0.08 },
  dead: { shape: 'bare', height: 6, crownWidth: 4.7 },
});

export const SIMPLE_TREE_SCHEMA = freezeConfig({
  shape: { label: 'shape', default: 'blob', choices: { blob: 'blob', cone: 'cone', layered: 'layered', column: 'column', umbrella: 'umbrella', fan: 'palm fan', bare: 'bare' }, randomize: false },
  height: { label: 'height', default: 6, min: 1.2, max: 16, step: 0.1 },
  crownWidth: { label: 'crown width', default: 4.8, min: 1, max: 10, step: 0.1 },
  crownRatio: { label: 'crown ratio', default: 0.55, min: 0.2, max: 0.85, step: 0.05 },
  trunkRadius: { label: 'trunk radius', default: 0.25, min: 0.06, max: 1.2, step: 0.02 },
  layers: { label: 'crown layers', default: 3, min: 2, max: 5, step: 1, when: p => p.shape === 'layered' },
  wind: { label: 'wind sway', default: 0.45, min: 0, max: 1, step: 0.05 },
});

const PALETTE = { bark: '#8b7155', leaf: '#699779' };
const PALETTES = [PALETTE,
  { ...PALETTE, leaf: '#4e8173' },
  { ...PALETTE, leaf: '#baa15d', bark: '#806a59' },
  { ...PALETTE, leaf: '#c9885d' },
  { ...PALETTE, leaf: '#b9919c' },
];
export const normalizeSimpleTreeOptions = (options = {}) =>
  normalizeFactoryOptions(options, SIMPLE_TREE_PRESETS, SIMPLE_TREE_SCHEMA, PALETTE);
export const randomSimpleTreeOptions = (seed = 1, overrides = {}) =>
  randomFactoryOptions(seed, overrides, SIMPLE_TREE_PRESETS, SIMPLE_TREE_SCHEMA, PALETTES, normalizeSimpleTreeOptions);

/** Simplified tree. +Y up, root at ground level. */
export function buildSimpleTreeVisual(options = {}) {
  const p = normalizeSimpleTreeOptions(options), c = p.colors;
  const kit = createPrimitiveKit(), mesh = new Group();
  mesh.name = `simple-tree-${p.preset}`;
  const rig = kit.group(mesh, 'wind-rig');
  const h = p.height, cw = p.crownWidth, r = p.trunkRadius;
  const ch = p.shape === 'bare' ? 0 : h * p.crownRatio, trunkH = h - ch;
  // The trunk runs into the crown so the two shapes always read as one tree.
  const stem = p.shape === 'bare' ? h : trunkH + Math.min(ch * 0.35, r * 3);
  kit.cylinder(rig, 'trunk', r, stem, [0, stem / 2, 0], c.bark, 0.7);
  const crown = kit.group(rig, 'crown', [0, trunkH, 0]);

  if (p.shape === 'blob') {
    kit.rock(crown, 'crown-blob', [cw, ch, cw], [0, ch / 2, 0], c.leaf);
  } else if (p.shape === 'cone') {
    kit.cylinder(crown, 'crown-cone', cw / 2, ch, [0, ch / 2, 0], c.leaf, 0);
  } else if (p.shape === 'layered') {
    const tier = ch / (p.layers * 0.62);
    for (let i = 0; i < p.layers; i++) {
      const f = i / p.layers;
      kit.cylinder(crown, 'crown-tier', cw * 0.5 * (1 - f * 0.7), tier,
        [0, ch * 0.62 * f + tier / 2, 0], c.leaf, 0);
    }
  } else if (p.shape === 'column') {
    kit.cylinder(crown, 'crown-column', cw / 2, ch, [0, ch / 2, 0], c.leaf, 0.75);
  } else if (p.shape === 'umbrella') {
    kit.cylinder(crown, 'crown-canopy', cw / 2, ch, [0, ch / 2, 0], c.leaf, 0.45);
  } else if (p.shape === 'fan') {
    // Four flattened cones sweeping outward stand in for a whole frond crown.
    for (let i = 0; i < 4; i++) {
      const frond = kit.group(crown, 'crown-frond');
      frond.rotation.y = i * Math.PI / 2;
      frond.rotation.x = 1.15;
      const leaf = kit.cylinder(frond, 'frond', cw * 0.16, cw * 0.5, [0, cw * 0.25, 0], c.leaf, 0);
      leaf.scale.z *= 0.35;
    }
  } else {
    for (let i = 0; i < 3; i++) {
      const angle = i * Math.PI * 2 / 3;
      kit.beam(crown, 'dead-branch', [0, -h * 0.22, 0],
        [Math.sin(angle) * cw * 0.35, h * 0.12, Math.cos(angle) * cw * 0.35], r * 0.6, c.bark);
    }
  }

  function setPose(motion = 'still', seconds = 0) {
    kit.assertLive();
    choice(motion, 'still', MOTION_IDS, 'motion');
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) throw new TypeError('time must be finite');
    const amount = motion === 'wind' ? p.wind : 0;
    rig.rotation.z = Math.sin(seconds * 1.35) * 0.025 * amount;
    rig.rotation.x = Math.sin(seconds * 0.85) * 0.014 * amount;
    return api;
  }

  const api = finishVisual(kit, mesh, p, { rig, motions: SIMPLE_TREE_MOTIONS, setPose,
    reset: () => setPose('still', 0) });
  return api.reset();
}

// Compatibility exports: the simplified factory replaces the original under
// this module's historical name, and keeps the original consumer surface.
export { SIMPLE_TREE_MOTIONS as TREE_MOTIONS };
export { SIMPLE_TREE_PRESETS as TREE_PRESETS };
export { SIMPLE_TREE_SCHEMA as TREE_SCHEMA };
export { normalizeSimpleTreeOptions as normalizeTreeOptions };
export { randomSimpleTreeOptions as randomTreeOptions };
export { buildSimpleTreeVisual as createTreeVisual, buildSimpleTreeVisual as buildTreeVisual };