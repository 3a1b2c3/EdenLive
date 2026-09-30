import { Group } from 'three';
import { createPrimitiveKit, freezeConfig, normalizeFactoryOptions, randomFactoryOptions, finishVisual } from './VisualFactoryUtils.js';

export const BUILDING_PRESETS = freezeConfig({
  apartment: { floors: 6, balconies: true, facade: 'grid', width: 8, depth: 7 },
  office: { floors: 12, facade: 'glass', width: 9, depth: 8, roof: 'plant', colors: { wall: '#90aaa8', trim: '#d5e1d8' } },
  skyscraper: { massing: 'setback', floors: 24, tiers: 4, width: 10, depth: 10, taper: 0.22, facade: 'glass', roof: 'spire' },
  shop: { floors: 2, width: 5, depth: 7, storefront: true, awning: true, roof: 'gable', colors: { wall: '#d8b288', accent: '#b86e53' } },
  hotel: { massing: 'podium', floors: 14, width: 8, depth: 9, balconies: true, roof: 'sign' },
  warehouse: { floors: 1, floorHeight: 5, width: 15, depth: 18, windows: 3, roof: 'sawtooth', facade: 'ribbon', storefront: false },
  townhouse: { massing: 'row', blocks: 4, floors: 3, width: 4, depth: 7, roof: 'gable', colors: { wall: '#b9826b', accent: '#efc789' } },
  mall: { massing: 'podium', floors: 3, width: 16, depth: 14, facade: 'ribbon', roof: 'sign', awning: true },
  tower: { massing: 'octagonal', floors: 18, width: 9, depth: 9, facade: 'glass', roof: 'spire' },
  civic: { massing: 'twins', floors: 5, width: 7, depth: 9, roof: 'pyramid', colors: { wall: '#dfd8be', trim: '#efe8d2' } },
  terraces: { massing: 'setback', floors: 8, tiers: 4, taper: 0.24, balconies: true, width: 13, depth: 11 },
  arcade: { massing: 'courtyard', floors: 4, width: 14, depth: 13, facade: 'grid', roof: 'flat' },
});
export const BUILDING_SCHEMA = freezeConfig({
  massing: { label: 'massing', default: 'block', choices: { block: 'block', setback: 'setback', podium: 'podium', twins: 'twins', row: 'row', octagonal: 'octagonal', courtyard: 'courtyard' }, randomize: false },
  width: { label: 'width', default: 8, min: 4, max: 20, step: 0.25 },
  depth: { label: 'depth', default: 7, min: 4, max: 22, step: 0.25 },
  floors: { label: 'floors', default: 6, min: 1, max: 30, step: 1 },
  floorHeight: { label: 'floorHeight', default: 2.8, min: 2.2, max: 5, step: 0.1 },
  tiers: { label: 'tiers', default: 3, min: 2, max: 5, step: 1, when: p => p.massing === 'setback' },
  taper: { label: 'taper', default: 0.15, min: 0.05, max: 0.25, step: 0.01, when: p => p.massing === 'setback' },
  blocks: { label: 'blocks', default: 3, min: 2, max: 6, step: 1, when: p => p.massing === 'row' },
  spacing: { label: 'spacing', default: 0.5, min: 0.2, max: 4, step: 0.1, when: p => ['row', 'twins'].includes(p.massing) },
  podiumScale: { label: 'podiumScale', default: 1.4, min: 1.1, max: 1.8, step: 0.05, when: p => p.massing === 'podium' },
  facade: { label: 'facade', default: 'grid', choices: { grid: 'grid', ribbon: 'ribbon', glass: 'glass' } },
  windows: { label: 'windows', default: 4, min: 2, max: 8, step: 1 },
  windowScale: { label: 'windowScale', default: 0.57, min: 0.3, max: 0.85, step: 0.05 },
  bands: { label: 'bands', default: true },
  balconies: { label: 'balconies', default: false, when: p => p.facade === 'grid' },
  storefront: { label: 'storefront', default: true },
  awning: { label: 'awning', default: false },
  roof: { label: 'roof', default: 'flat', choices: { flat: 'flat', gable: 'gable', pyramid: 'pyramid', sawtooth: 'sawtooth', plant: 'plant', spire: 'spire', sign: 'sign' } },
  roofHeight: { label: 'roofHeight', default: 2, min: 0.8, max: 6, step: 0.1, when: p => p.roof !== 'flat' },
});
const PALETTE = { wall: '#c9c6ab', roof: '#526e71', trim: '#e3e8d6', window: '#345568', accent: '#d39a64', base: '#8eaaa0' };
const PALETTES = [PALETTE,
  { ...PALETTE, wall: '#90aaa8', window: '#304e62', accent: '#d8b46b' },
  { ...PALETTE, wall: '#b9826b', trim: '#eadbc6', roof: '#596d70' },
  { ...PALETTE, wall: '#a0acc1', trim: '#e0e8db', accent: '#6e9e95' },
  { ...PALETTE, wall: '#e0d7b9', window: '#577f86', accent: '#bd7757' },
];
export const normalizeBuildingOptions = (options = {}) => normalizeFactoryOptions(options, BUILDING_PRESETS, BUILDING_SCHEMA, PALETTE);
export const randomBuildingOptions = (seed = 1, overrides = {}) => randomFactoryOptions(seed, overrides, BUILDING_PRESETS, BUILDING_SCHEMA, PALETTES, normalizeBuildingOptions);


function addSimpleRoof(kit, parent, { width, depth, height, style, color, y = 0 }) {
  if (style === 'flat' || !['gable', 'pyramid', 'hip', 'shed'].includes(style)) {
    return kit.box(parent, 'flat-roof', [width, 0.24, depth], [0, y + 0.12, 0], color);
  }
  if (style === 'hip' || style === 'pyramid') {
    return kit.frustum(parent, `${style}-roof`, [width, height, depth], [0, y + height / 2, 0], color,
      style === 'pyramid' ? 0 : 0.28);
  }
  const profiles = {
    gable: [[-0.5, 0], [0.5, 0], [0, 1]],
    shed: [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 0.2]],
  };
  return kit.prism(parent, `${style}-roof`, profiles[style], [width, height, depth], [0, y, 0], color);
}

/** Simplified city massing in actual scale. */
export function buildBuildingVisual(options = {}) {
  const p = normalizeBuildingOptions(options), c = p.colors, kit = createPrimitiveKit(), mesh = new Group();
  mesh.name = `simple-building-${p.preset}`;
  const w = p.width, d = p.depth, fh = p.floorHeight;
  const roofStyle = ['gable', 'pyramid'].includes(p.roof) ? p.roof : 'flat';
  function block(width, depth, floors, x = 0, z = 0, y = 0, top = true) {
    const root = kit.group(mesh, 'building-section', [x, y, z]), h = floors * fh;
    kit.box(root, 'structure', [width, h, depth], [0, h / 2, 0], c.wall);
    if (top) addSimpleRoof(kit, root, { width, depth, height: p.roofHeight, style: roofStyle, color: c.roof, y: h });
    return root;
  }
  if (p.massing === 'setback') {
    const count = Math.min(p.tiers, p.floors);
    let used = 0;
    for (let i = 0; i < count; i++) {
      const floors = Math.floor(p.floors / count) + (i < p.floors % count ? 1 : 0), scale = (1 - p.taper) ** i;
      block(w * scale, d * scale, floors, 0, 0, used * fh, i === count - 1);
      used += floors;
    }
  } else if (p.massing === 'podium' && p.floors > 1) {
    const floors = Math.min(2, p.floors - 1);
    block(w * p.podiumScale, d * p.podiumScale, floors, 0, 0, 0, false);
    block(w, d, p.floors - floors, 0, d * 0.08, floors * fh);
  } else if (p.massing === 'twins') {
    for (const side of [-1, 1]) block(w, d, p.floors, side * (w + p.spacing) / 2);
  } else if (p.massing === 'row') {
    for (let i = 0; i < p.blocks; i++) block(w, d, Math.max(1, p.floors - i % 2),
      (i - (p.blocks - 1) / 2) * (w + p.spacing));
  } else if (p.massing === 'courtyard') {
    for (const side of [-1, 1]) {
      block(w, d * 0.24, p.floors, 0, side * d * 0.38);
      block(w * 0.24, d * 0.52, p.floors, side * w * 0.38, 0);
    }
  } else if (p.massing === 'octagonal') {
    const radius = w / 2, h = p.floors * fh;
    const root = kit.group(mesh, 'octagonal-tower');
    kit.box(root, 'structure', [w, h, d], [0, h / 2, 0], c.wall);
    addSimpleRoof(kit, root, { width: w * 0.74, depth: d * 0.74, height: p.roofHeight, style: roofStyle, color: c.roof, y: h });
  } else block(w, d, p.floors);
  return finishVisual(kit, mesh, p);
}
export const createBuildingVisual = buildBuildingVisual;
