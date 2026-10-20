import { Group } from 'three';
import { createPrimitiveKit, freezeConfig, normalizeFactoryOptions,
  randomFactoryOptions, finishVisual } from './VisualFactoryUtils.js';
import { addSimpleRoof } from './ArchitectureParts.js';

// Simplified rural house: stacked boxes plus one roof prism. No windows, no
// doors, no facade rhythm, no eaves, no dormers, no beams and no shutters.
// A porch, when present, is a slab on two posts; stilts are four posts.
// The Simple-prefixed exports are canonical; the unprefixed aliases at the end
// keep this module's historical name and consumers unchanged.
export const SIMPLE_HOUSE_PRESETS = freezeConfig({
  cottage: { width: 4.8, depth: 4.2, roof: 'gable', porch: true },
  farmhouse: { layout: 'lshape', width: 7.5, depth: 6, floors: 2, roof: 'hip', porch: true },
  barn: { width: 6, depth: 9, floorHeight: 3.8, roof: 'gable', roofHeight: 3,
    colors: { wall: '#b97863', roof: '#566574' } },
  chalet: { width: 6, depth: 5.6, floors: 2, roofHeight: 3.6, porch: true,
    colors: { wall: '#d4b18b', roof: '#5a7471' } },
  cabin: { width: 4, depth: 4.5, roof: 'gable', chimney: true,
    colors: { wall: '#a58060', roof: '#52796e' } },
  stilt: { width: 5, depth: 6.2, stiltHeight: 2, roof: 'hip', porch: true },
  longhouse: { width: 4.6, depth: 11, roof: 'gable', roofAxis: 'cross' },
  courtyard: { layout: 'courtyard', width: 8, depth: 8, roof: 'shed', chimney: false },
  twin: { layout: 'twin', width: 5, depth: 5, floors: 2, roof: 'gable' },
  villa: { layout: 'tshape', width: 7.5, depth: 6.5, floors: 2, roof: 'hip', porch: true,
    colors: { wall: '#e9dfbf', roof: '#bc7a59' } },
  adobe: { layout: 'lshape', width: 6, depth: 5, roof: 'flat', chimney: false,
    colors: { wall: '#d1ad82', roof: '#e0c298' } },
  pavilion: { width: 4.6, depth: 4.6, roof: 'pyramid', roofHeight: 2.8, porch: true, chimney: false },
});

export const SIMPLE_HOUSE_SCHEMA = freezeConfig({
  layout: { label: 'plan layout', default: 'single', choices: { single: 'single', lshape: 'l-shaped wing', tshape: 't-shaped wing', courtyard: 'courtyard', twin: 'twin' }, randomize: false },
  width: { label: 'main width', default: 5, min: 3, max: 12, step: 0.1 },
  depth: { label: 'main depth', default: 5, min: 3, max: 14, step: 0.1 },
  floors: { label: 'floors', default: 1, min: 1, max: 3, step: 1 },
  floorHeight: { label: 'floor height', default: 2.6, min: 2, max: 4, step: 0.1 },
  roof: { label: 'roof profile', default: 'gable', choices: { gable: 'gable', hip: 'hip', shed: 'shed', flat: 'flat', pyramid: 'pyramid' } },
  roofAxis: { label: 'roof ridge axis', default: 'along', choices: { along: 'along depth', cross: 'across depth' } },
  roofHeight: { label: 'roof height', default: 1.7, min: 0.6, max: 4.5, step: 0.1, when: p => p.roof !== 'flat' },
  porch: { label: 'porch', default: false },
  chimney: { label: 'chimney', default: true },
  stiltHeight: { label: 'stilt height', default: 0, min: 0, max: 3, step: 0.1 },
});

const PALETTE = { wall: '#e4d2aa', roof: '#718a7b' };
const PALETTES = [PALETTE,
  { wall: '#b97863', roof: '#506976' },
  { wall: '#c7d5c0', roof: '#ab765b' },
  { wall: '#d3b589', roof: '#586f68' },
  { wall: '#8baba0', roof: '#4b6067' },
];
export const normalizeSimpleHouseOptions = (options = {}) =>
  normalizeFactoryOptions(options, SIMPLE_HOUSE_PRESETS, SIMPLE_HOUSE_SCHEMA, PALETTE);
export const randomSimpleHouseOptions = (seed = 1, overrides = {}) =>
  randomFactoryOptions(seed, overrides, SIMPLE_HOUSE_PRESETS, SIMPLE_HOUSE_SCHEMA, PALETTES, normalizeSimpleHouseOptions);

/** Simplified rural building. +Y up, entrance toward -Z, root at ground level. */
export function buildSimpleHouseVisual(options = {}) {
  const p = normalizeSimpleHouseOptions(options), c = p.colors;
  const kit = createPrimitiveKit(), mesh = new Group();
  mesh.name = `simple-house-${p.preset}`;
  const w = p.width, d = p.depth, baseY = p.stiltHeight;
  const entrance = kit.group(mesh, 'entrance', [0, baseY, -d / 2]);

  function block(width, depth, x, z, floors, main = false) {
    const root = kit.group(mesh, main ? 'main-house' : 'house-wing', [x, 0, z]);
    const h = floors * p.floorHeight;
    if (baseY > 0) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      kit.box(root, 'stilt', [0.28, baseY, 0.28], [sx * width * 0.4, baseY / 2, sz * depth * 0.4], c.roof);
    }
    kit.box(root, 'walls', [width, h, depth], [0, baseY + h / 2, 0], c.wall);
    const roofRoot = kit.group(root, 'roof', [0, baseY + h, 0]);
    const cross = p.roofAxis === 'cross';
    if (cross) roofRoot.rotation.y = Math.PI / 2;
    addSimpleRoof(kit, roofRoot, { width: cross ? depth : width, depth: cross ? width : depth,
      height: p.roofHeight, style: p.roof, color: c.roof });
    if (main && p.chimney) {
      const chimneyH = (p.roof === 'flat' ? 0.8 : p.roofHeight) + 0.7;
      kit.box(root, 'chimney', [0.5, chimneyH, 0.5],
        [width * 0.28, baseY + h + chimneyH / 2, depth * 0.18], c.roof);
    }
  }

  if (p.layout === 'courtyard') {
    block(w, d * 0.38, 0, d * 0.31, p.floors, true);
    for (const side of [-1, 1]) block(w * 0.24, d, side * w * 0.38, 0, p.floors);
    entrance.position.z = d * 0.12;
  } else {
    block(w, d, 0, 0, p.floors, true);
    const wingW = w * 0.62;
    if (p.layout === 'lshape') block(wingW, d * 0.8, (w + wingW) / 2 - 0.1, d * 0.3, p.floors);
    else if (p.layout === 'tshape') block(wingW, d * 0.8, (w + wingW) / 2 - 0.1, 0, p.floors);
    else if (p.layout === 'twin') block(wingW, d, w * (1 + 0.62) / 2 - 0.1, 0, p.floors);
  }
  // The porch is a flat slab on two posts: the coarse shape of a rain shelter.
  if (p.porch && p.layout !== 'courtyard') {
    const pw = w * 0.5, pd = 1.2, ph = p.floorHeight * 0.85;
    const root = kit.group(mesh, 'porch', [0, baseY, -d / 2 - pd / 2]);
    for (const side of [-1, 1]) kit.box(root, 'porch-post', [0.2, ph, 0.2],
      [side * pw * 0.42, ph / 2, -pd * 0.38], c.wall);
    kit.box(root, 'porch-roof', [pw, 0.24, pd], [0, ph + 0.12, 0], c.roof);
  }
  return finishVisual(kit, mesh, p, { attachments: { entrance } });
}

// Compatibility exports: the simplified factory replaces the original under
// this module's historical name, and keeps the original consumer surface.
export { SIMPLE_HOUSE_PRESETS as HOUSE_PRESETS };
export { SIMPLE_HOUSE_SCHEMA as HOUSE_SCHEMA };
export { normalizeSimpleHouseOptions as normalizeHouseOptions };
export { randomSimpleHouseOptions as randomHouseOptions };
export { buildSimpleHouseVisual as createHouseVisual, buildSimpleHouseVisual as buildHouseVisual };