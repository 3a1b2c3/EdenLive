import { Group } from 'three';
import { createPrimitiveKit, freezeConfig, normalizeFactoryOptions,
  randomFactoryOptions, finishVisual } from './VisualFactoryUtils.js';
import { addSimpleRoof } from './ArchitectureParts.js';

// Simplified city building: box massing only. Windows, storefronts, awnings,
// floor bands, balconies, parapets, spires, signs and rooftop plant are all
// gone. An entrance canopy, when present, is a slab on two posts. Floor count
// and floor height still set the real height so scale stays comparable.
// The Simple-prefixed exports are canonical; the unprefixed aliases at the end
// keep this module's historical name and consumers unchanged.
export const SIMPLE_BUILDING_PRESETS = freezeConfig({
  apartment: { floors: 6, width: 8, depth: 7 },
  office: { floors: 12, width: 9, depth: 8, colors: { wall: '#90aaa8' } },
  skyscraper: { massing: 'setback', floors: 24, tiers: 4, width: 10, depth: 10, taper: 0.22 },
  shop: { floors: 2, width: 5, depth: 7, roof: 'gable', canopy: true,
    colors: { wall: '#d8b288', roof: '#b86e53' } },
  hotel: { massing: 'podium', floors: 14, width: 8, depth: 9 },
  warehouse: { floors: 1, floorHeight: 5, width: 15, depth: 18, roof: 'gable', roofHeight: 3 },
  townhouse: { massing: 'row', blocks: 4, floors: 3, width: 4, depth: 7, roof: 'gable',
    colors: { wall: '#b9826b' } },
  mall: { massing: 'podium', floors: 3, width: 16, depth: 14, canopy: true },
  tower: { floors: 18, width: 9, depth: 9 },
  civic: { massing: 'twins', floors: 5, width: 7, depth: 9, roof: 'pyramid',
    colors: { wall: '#dfd8be' } },
  terraces: { massing: 'setback', floors: 8, tiers: 4, taper: 0.24, width: 13, depth: 11 },
  arcade: { massing: 'courtyard', floors: 4, width: 14, depth: 13 },
});

export const SIMPLE_BUILDING_SCHEMA = freezeConfig({
  massing: { label: 'massing structure', default: 'block', choices: { block: 'block', setback: 'setback tiers', podium: 'podium tower', twins: 'twin towers', row: 'street row', courtyard: 'courtyard' }, randomize: false },
  width: { label: 'building width', default: 8, min: 4, max: 20, step: 0.25 },
  depth: { label: 'building depth', default: 7, min: 4, max: 22, step: 0.25 },
  floors: { label: 'floor count', default: 6, min: 1, max: 30, step: 1 },
  floorHeight: { label: 'floor height', default: 2.8, min: 2.2, max: 5, step: 0.1 },
  tiers: { label: 'setback tiers', default: 3, min: 2, max: 5, step: 1, when: p => p.massing === 'setback' },
  taper: { label: 'per-tier taper', default: 0.15, min: 0.05, max: 0.25, step: 0.01, when: p => p.massing === 'setback' },
  blocks: { label: 'row block count', default: 3, min: 2, max: 6, step: 1, when: p => p.massing === 'row' },
  spacing: { label: 'building spacing', default: 0.5, min: 0.2, max: 4, step: 0.1, when: p => ['row', 'twins'].includes(p.massing) },
  podiumScale: { label: 'podium width multiplier', default: 1.4, min: 1.1, max: 1.8, step: 0.05, when: p => p.massing === 'podium' },
  roof: { label: 'roof structure', default: 'flat', choices: { flat: 'flat', gable: 'gable', pyramid: 'pyramid' } },
  roofHeight: { label: 'extra roof height', default: 2, min: 0.8, max: 6, step: 0.1, when: p => p.roof !== 'flat' },
  canopy: { label: 'entrance canopy', default: false },
});

const PALETTE = { wall: '#c9c6ab', roof: '#526e71' };
const PALETTES = [PALETTE,
  { wall: '#90aaa8', roof: '#3f5b60' },
  { wall: '#b9826b', roof: '#596d70' },
  { wall: '#a0acc1', roof: '#4c6069' },
  { wall: '#e0d7b9', roof: '#5d7a75' },
];
export const normalizeSimpleBuildingOptions = (options = {}) =>
  normalizeFactoryOptions(options, SIMPLE_BUILDING_PRESETS, SIMPLE_BUILDING_SCHEMA, PALETTE);
export const randomSimpleBuildingOptions = (seed = 1, overrides = {}) =>
  randomFactoryOptions(seed, overrides, SIMPLE_BUILDING_PRESETS, SIMPLE_BUILDING_SCHEMA, PALETTES, normalizeSimpleBuildingOptions);

/** Simplified city massing in actual scale. +Y up, entrance toward -Z. */
export function buildSimpleBuildingVisual(options = {}) {
  const p = normalizeSimpleBuildingOptions(options), c = p.colors;
  const kit = createPrimitiveKit(), mesh = new Group();
  mesh.name = `simple-building-${p.preset}`;
  const w = p.width, d = p.depth, fh = p.floorHeight;

  function block(width, depth, floors, x = 0, z = 0, y = 0, top = true) {
    const root = kit.group(mesh, 'building-section', [x, y, z]), h = floors * fh;
    kit.box(root, 'structure', [width, h, depth], [0, h / 2, 0], c.wall);
    if (top) addSimpleRoof(kit, root, { width, depth, height: p.roofHeight, style: p.roof, color: c.roof, y: h });
    return root;
  }

  if (p.massing === 'setback') {
    const count = Math.min(p.tiers, p.floors);
    let used = 0;
    for (let i = 0; i < count; i++) {
      const floors = Math.floor(p.floors / count) + (i < p.floors % count ? 1 : 0);
      const scale = (1 - p.taper) ** i;
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
    for (let i = 0; i < p.blocks; i++) {
      block(w, d, Math.max(1, p.floors - i % 2), (i - (p.blocks - 1) / 2) * (w + p.spacing));
    }
  } else if (p.massing === 'courtyard') {
    for (const side of [-1, 1]) {
      block(w, d * 0.24, p.floors, 0, side * d * 0.38);
      block(w * 0.24, d * 0.52, p.floors, side * w * 0.38, 0);
    }
  } else block(w, d, p.floors);

  if (p.canopy) {
    const cw = Math.min(w * 0.6, 6), cd = 1.8, ch = fh * 0.9;
    const front = p.massing === 'podium' ? -d * p.podiumScale / 2 : -d / 2;
    const root = kit.group(mesh, 'entrance-canopy', [0, 0, front - cd / 2]);
    for (const side of [-1, 1]) kit.box(root, 'canopy-post', [0.3, ch, 0.3],
      [side * cw * 0.42, ch / 2, -cd * 0.36], c.wall);
    kit.box(root, 'canopy-roof', [cw, 0.3, cd], [0, ch + 0.15, 0], c.roof);
  }
  return finishVisual(kit, mesh, p);
}

// Compatibility exports: the simplified factory replaces the original under
// this module's historical name, and keeps the original consumer surface.
export { SIMPLE_BUILDING_PRESETS as BUILDING_PRESETS };
export { SIMPLE_BUILDING_SCHEMA as BUILDING_SCHEMA };
export { normalizeSimpleBuildingOptions as normalizeBuildingOptions };
export { randomSimpleBuildingOptions as randomBuildingOptions };
export { buildSimpleBuildingVisual as createBuildingVisual, buildSimpleBuildingVisual as buildBuildingVisual };