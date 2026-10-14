import { Group } from 'three';
import { createPrimitiveKit, freezeConfig, normalizeFactoryOptions, randomFactoryOptions, finishVisual } from './VisualFactoryUtils.js';

export const TREE_PRESETS = freezeConfig({
  oak: { type: 'broadleaf', height: 7, crownWidth: 6, clusters: 8, branches: 5 },
  maple: { type: 'broadleaf', height: 6, crownWidth: 5, crownShape: 'faceted',
    colors: { leaf: '#cb8a4e', leafLight: '#e6b968', fruit: '#b76e48' } },
  birch: { type: 'broadleaf', height: 8, crownWidth: 3.7, trunkRadius: 0.14, trunks: 3,
    colors: { bark: '#d9d9bf', leaf: '#9eb475', leafLight: '#c2ce8c' } },
  pine: { type: 'conifer', height: 9, crownWidth: 4, layers: 3, crownRatio: 0.75 },
  fir: { type: 'conifer', height: 11, crownWidth: 5, layers: 5, crownRatio: 0.83,
    colors: { leaf: '#497e6c', leafLight: '#689680' } },
  cypress: { type: 'column', height: 8, crownWidth: 1.9, crownRatio: 0.82, clusters: 4 },
  palm: { type: 'palm', height: 8, crownWidth: 6.5, branches: 9, trunkRadius: 0.22, lean: 0.12, fruit: true },
  acacia: { type: 'umbrella', height: 6, crownWidth: 8, crownRatio: 0.25, branches: 5, clusters: 6 },
  willow: { type: 'willow', height: 7, crownWidth: 6, branches: 7, droop: 0.8, crownShape: 'round',
    colors: { leaf: '#88a674', leafLight: '#b0bd80' } },
  cherry: { type: 'broadleaf', height: 5, crownWidth: 5.3, flowers: true,
    colors: { leaf: '#dba5a0', leafLight: '#edc4b3', fruit: '#f1ddd0' } },
  baobab: { type: 'umbrella', height: 8, crownWidth: 6, trunkRadius: 0.95, crownRatio: 0.28, branches: 5 },
  shrub: { type: 'broadleaf', height: 1.7, crownWidth: 2.6, crownRatio: 0.85, trunkRadius: 0.08, clusters: 5 },
  dead: { type: 'bare', height: 6, crownWidth: 4.7, branches: 7, lean: -0.12 },
});
export const TREE_SCHEMA = freezeConfig({
  type: { label: 'type', default: 'broadleaf', choices: { broadleaf: 'broadleaf', conifer: 'conifer', column: 'column', palm: 'palm', umbrella: 'umbrella', willow: 'willow', bare: 'bare' }, randomize: false },
  height: { label: 'height', default: 6, min: 1.2, max: 16, step: 0.1 },
  crownWidth: { label: 'crownWidth', default: 4.8, min: 1, max: 10, step: 0.1 },
  crownRatio: { label: 'crownRatio', default: 0.55, min: 0.2, max: 0.88, step: 0.02, when: p => !['palm', 'bare'].includes(p.type) },
  crownShape: { label: 'crownShape', default: 'faceted', choices: { faceted: 'faceted', round: 'round', box: 'box' }, when: p => !['palm', 'conifer', 'bare'].includes(p.type) },
  trunkRadius: { label: 'trunkRadius', default: 0.25, min: 0.06, max: 1.2, step: 0.02 },
  trunkTaper: { label: 'trunkTaper', default: 0.45, min: 0.15, max: 0.85, step: 0.05 },
  trunks: { label: 'trunks', default: 1, min: 1, max: 4, step: 1 },
  lean: { label: 'lean', default: 0, min: -0.35, max: 0.35, step: 0.01, fullRange: true },
  branches: { label: 'branches', default: 5, min: 3, max: 12, step: 1, when: p => p.type !== 'conifer' },
  clusters: { label: 'clusters', default: 7, min: 3, max: 14, step: 1, when: p => !['palm', 'conifer', 'bare'].includes(p.type) },
  layers: { label: 'layers', default: 3, min: 2, max: 6, step: 1, when: p => p.type === 'conifer' },
  irregularity: { label: 'irregularity', default: 0.28, min: 0, max: 0.65, step: 0.05 },
  droop: { label: 'droop', default: 0.45, min: 0.1, max: 1, step: 0.05, when: p => ['palm', 'willow'].includes(p.type) },
  roots: { label: 'roots', default: true },
  fruit: { label: 'fruit', default: false, when: p => p.type !== 'bare' },
  flowers: { label: 'flowers', default: false, when: p => !['bare', 'conifer', 'palm'].includes(p.type) },
  wind: { label: 'wind', default: 0.45, min: 0, max: 1, step: 0.05 },
  shapeSeed: { label: 'shapeSeed', default: 42, min: 0, max: 4294967295, step: 1, input: 'number' },
});
const PALETTE = { bark: '#8b7155', leaf: '#699779', leafLight: '#99b98a', fruit: '#d39b5b' };
const PALETTES = [PALETTE,
  { ...PALETTE, leaf: '#4e8173', leafLight: '#87ac91' },
  { ...PALETTE, leaf: '#baa15d', leafLight: '#dcc786', bark: '#806a59' },
  { ...PALETTE, leaf: '#c9885d', leafLight: '#dfb77a' },
  { ...PALETTE, leaf: '#b9919c', leafLight: '#dfb8b5' },
];
export const normalizeTreeOptions = (options = {}) => normalizeFactoryOptions(options, TREE_PRESETS, TREE_SCHEMA, PALETTE);
export const randomTreeOptions = (seed = 1, overrides = {}) => randomFactoryOptions(seed, overrides, TREE_PRESETS, TREE_SCHEMA, PALETTES, normalizeTreeOptions);


export function buildTreeVisual(options = {}) {
  const p = normalizeTreeOptions(options), c = p.colors, kit = createPrimitiveKit(), mesh = new Group();
  mesh.name = `simple-tree-${p.preset}`;
  const rig = kit.group(mesh, 'wind-rig');
  const h = p.height, cw = p.crownWidth, r = p.trunkRadius;
  const ch = p.type === 'bare' ? 0 : h * p.crownRatio;
  const trunkH = p.type === 'palm' ? h * 0.82 : p.type === 'bare' ? h * 0.88 : h - ch;
  const stem = p.type === 'bare' ? h : trunkH + Math.min(ch * 0.35, r * 3);
  kit.cylinder(rig, 'trunk', r, stem, [0, stem / 2, 0], c.bark, 0.7);
  const crown = kit.group(rig, 'crown', [0, trunkH, 0]);
  if (p.type === 'conifer') {
    kit.cylinder(crown, 'crown-cone', cw / 2, Math.max(0.2, ch), [0, ch / 2, 0], c.leaf, 0);
  } else if (p.type === 'palm') {
    for (let i = 0; i < 4; i++) {
      const frond = kit.group(crown, 'crown-frond');
      frond.rotation.y = i * Math.PI / 2;
      frond.rotation.x = 1.15;
      const leaf = kit.cylinder(frond, 'frond', cw * 0.16, cw * 0.5, [0, cw * 0.25, 0], c.leaf, 0);
      leaf.scale.z *= 0.35;
    }
  } else if (p.type === 'column') {
    kit.cylinder(crown, 'crown-column', cw / 2, Math.max(0.2, ch), [0, ch / 2, 0], c.leaf, 0.75);
  } else if (p.type === 'umbrella') {
    kit.cylinder(crown, 'crown-canopy', cw / 2, Math.max(0.2, ch), [0, ch / 2, 0], c.leaf, 0.45);
  } else if (p.type === 'bare') {
    for (let i = 0; i < 3; i++) {
      const angle = i * Math.PI * 2 / 3;
      kit.beam(crown, 'dead-branch', [0, -h * 0.22, 0],
        [Math.sin(angle) * cw * 0.35, h * 0.12, Math.cos(angle) * cw * 0.35], r * 0.6, c.bark);
    }
  } else {
    kit.box(crown, 'crown-blob', [cw, Math.max(0.2, ch), cw], [0, ch / 2, 0], c.leaf);
  }
  const api = finishVisual(kit, mesh, p, { rig,
    setPose(seconds = 0) {
      kit.assertLive();
      if (!Number.isFinite(seconds)) throw new TypeError('time must be finite');
      rig.rotation.z = Math.sin(seconds * 1.35) * 0.025 * p.wind;
      rig.rotation.x = Math.sin(seconds * 0.85) * 0.014 * p.wind;
      return api;
    },
  });
  return api;
}
export const createTreeVisual = buildTreeVisual;
