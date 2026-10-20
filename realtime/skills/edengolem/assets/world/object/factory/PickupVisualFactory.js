import { Color, Group, Vector3 } from 'three';
import { createPrimitiveKit, freezeConfig, measure,
  normalizeFactoryOptions, seededRandom } from './VisualFactoryUtils.js';

// Simplified pickup: one or two primitives per item type, no faces, symbols,
// gauges, straps, handles, stripes, chips, knobs or cartridges. Sizing, layout
// and the hover / appear / collect animation are unchanged.
// The Simple-prefixed exports are canonical; the unprefixed aliases at the end
// keep this module's historical name and consumers unchanged.

// Motion catalogue inlined from the detailed factory (labels translated) so the
// simplified module stays self-contained.
export const PICKUP_MOTIONS = freezeConfig({ still: 'still', idle: 'hover spin',
  appear: 'appear (once)', collect: 'collect (once)' });

export const SIMPLE_PICKUP_PRESETS = freezeConfig({
  coin: { kind: 'coin', sizeRatio: 0.18 },
  coinStack: { kind: 'coin', sizeRatio: 0.16, count: 5, layout: 'stack', resting: 'flat', spacing: 0.02 },
  ring: { kind: 'ring', sizeRatio: 0.28 },
  gem: { kind: 'gem', sizeRatio: 0.22, gemShape: 'diamond', colors: { body: '#69b6ae', accent: '#bee0c3' } },
  crystal: { kind: 'gem', sizeRatio: 0.3, gemShape: 'cluster', colors: { body: '#9b8bbe', accent: '#d7bfdb' } },
  star: { kind: 'star', sizeRatio: 0.26, colors: { body: '#e5bd66', accent: '#fff0bf' } },
  heart: { kind: 'heart', sizeRatio: 0.22, colors: { body: '#ca786e', accent: '#efd1ac' } },
  healthPotion: { kind: 'potion', sizeRatio: 0.24, bottleShape: 'round',
    colors: { body: '#d1dace', liquid: '#b36660', accent: '#f2e5be' } },
  manaPotion: { kind: 'potion', sizeRatio: 0.27, bottleShape: 'flask',
    colors: { body: '#c8d9dd', liquid: '#668faa', accent: '#e5e2be' } },
  medkit: { kind: 'medkit', sizeRatio: 0.3, colors: { body: '#e2dfca', accent: '#b96359', trim: '#628f84' } },
  apple: { kind: 'food', sizeRatio: 0.18, foodShape: 'apple', colors: { body: '#bd6b56', accent: '#90ad7b' } },
  bread: { kind: 'food', sizeRatio: 0.24, foodShape: 'bread', colors: { body: '#cfac72', accent: '#eee0bd' } },
  drumstick: { kind: 'food', sizeRatio: 0.25, foodShape: 'drumstick', colors: { body: '#b77f58', accent: '#e9dec2' } },
  ammoBox: { kind: 'ammo', sizeRatio: 0.27, packShape: 'box',
    colors: { body: '#718879', accent: '#d2b370', trim: '#465e5b' } },
  shells: { kind: 'ammo', sizeRatio: 0.22, packShape: 'bundle', colors: { body: '#b67461', accent: '#d3b981' } },
  battery: { kind: 'battery', sizeRatio: 0.28, colors: { body: '#688b8d', accent: '#e6c16d', trim: '#d5d8be' } },
  energyOrb: { kind: 'orb', sizeRatio: 0.23, colors: { body: '#86b5a0', accent: '#dbdcc0', trim: '#547e77' } },
  key: { kind: 'key', sizeRatio: 0.3, keyHead: 'round' },
  bossKey: { kind: 'key', sizeRatio: 0.42, keyHead: 'diamond',
    colors: { body: '#a1aeb9', accent: '#ba7269', trim: '#536c7c' } },
  keycard: { kind: 'keycard', sizeRatio: 0.22, colors: { body: '#dfddc7', accent: '#718fa7' } },
  scroll: { kind: 'scroll', sizeRatio: 0.3, colors: { body: '#e6d9b7', accent: '#b77a5e', trim: '#8a715a' } },
  tome: { kind: 'book', sizeRatio: 0.3, colors: { body: '#747797', accent: '#dbc28a', trim: '#ece3c6' } },
  relic: { kind: 'relic', sizeRatio: 0.32, colors: { body: '#85968a', accent: '#d3b578', trim: '#c4cdb7' } },
});

const number = (group, label, value, min, max, step = 0.05, when) => ({ group, label, default: value, min, max, step, when });
const choice = (group, label, value, choices, when) => ({ group, label, default: value, choices, when });
const is = (...kinds) => p => kinds.includes(p.kind);
export const SIMPLE_PICKUP_SCHEMA = freezeConfig({
  kind: choice('type & size', 'item type', 'coin', { coin: 'coin', ring: 'ring', gem: 'gem / crystal cluster', star: 'star', heart: 'heart',
    potion: 'potion', medkit: 'medkit', food: 'food', ammo: 'ammo', battery: 'battery', orb: 'orb', key: 'key',
    keycard: 'keycard', scroll: 'scroll', book: 'book', relic: 'relic' }),
  referenceHeight: number('type & size', 'character reference height / m', 2.2, 0.8, 3.2),
  sizeRatio: number('type & size', 'longest side / character height', 0.24, 0.05, 0.8, 0.01),
  resting: choice('type & size', 'resting pose', 'upright', { upright: 'upright', flat: 'flat' }),
  count: number('quantity & layout', 'visible count', 1, 1, 9, 1),
  layout: choice('quantity & layout', 'arrangement', 'row', { row: 'row', stack: 'stack', cluster: 'cluster' }, p => p.count > 1),
  spacing: number('quantity & layout', 'spacing / item size', 0.18, 0, 0.8, 0.02, p => p.count > 1),
  shapeSeed: { ...number('quantity & layout', 'layout seed', 42, 0, 999999, 1, p => p.count > 1 && p.layout !== 'row'), input: 'number' },
  gemShape: choice('silhouette', 'gem profile', 'diamond', { diamond: 'diamond', crystal: 'crystal column', cluster: 'cluster' }, is('gem')),
  bottleShape: choice('silhouette', 'bottle profile', 'round', { round: 'round', square: 'square', flask: 'flask' }, is('potion')),
  packShape: choice('silhouette', 'supply packaging', 'box', { box: 'hard case', pouch: 'pouch', bundle: 'loose bundle' }, is('medkit', 'ammo')),
  foodShape: choice('silhouette', 'food profile', 'apple', { apple: 'apple', bread: 'bread', drumstick: 'drumstick' }, is('food')),
  keyHead: choice('silhouette', 'key bow profile', 'round', { round: 'round', square: 'square', diamond: 'diamond' }, is('key')),
  hoverHeight: number('demo & pickup range', 'hover height / item size', 0.4, 0, 2),
  bobAmount: number('demo & pickup range', 'bob amount / item size', 0.12, 0, 0.5, 0.02),
  spinSpeed: number('demo & pickup range', 'spin speed (turns per second)', 0.2, -1, 1, 0.05),
  motionSpeed: number('demo & pickup range', 'animation speed multiplier', 1, 0.2, 3, 0.1),
  transitionDuration: number('demo & pickup range', 'appear / collect duration (s)', 0.7, 0.2, 2, 0.1),
  pickupPadding: number('demo & pickup range', 'pickup padding / item size', 0.25, 0, 1),
});

// Locked details: silhouette proportions, disc edge count and fill levels.
const SIDES = 12, RING_WIDTH = 0.14, FILL = 0.65, ROUNDS = 4, TEETH = 2, SHAFT = 1;

const PALETTE = { body: '#d8b36b', accent: '#f3dfad', trim: '#786d59', liquid: '#709f90' };
export const normalizeSimplePickupOptions = (options = {}) =>
  normalizeFactoryOptions(options, SIMPLE_PICKUP_PRESETS, SIMPLE_PICKUP_SCHEMA, PALETTE);

/** Keep the selected item identity and palette; vary its silhouette and arrangement. */
export function randomSimplePickupOptions(seed = 1, overrides = {}) {
  const random = seededRandom(seed), pick = values => values[Math.floor(random() * values.length)];
  for (let i = 0; i < 5; i++) random();
  const preset = overrides.preset ?? pick(Object.keys(SIMPLE_PICKUP_PRESETS));
  const base = normalizeSimplePickupOptions({ ...overrides, preset });
  const p = { ...base, shapeSeed: seed >>> 0 };
  p.sizeRatio = Number((base.sizeRatio * (0.75 + random() * 0.5)).toFixed(2));
  if (base.count > 1) { p.count = pick([3, 4, 5, 6]); p.spacing = Number((0.08 + random() * 0.3).toFixed(2)); }
  if (base.kind === 'potion') p.bottleShape = pick(['round', 'square', 'flask']);
  if (base.kind === 'key') p.keyHead = pick(['round', 'square', 'diamond']);
  const colors = Object.fromEntries(Object.entries(base.colors).map(([key, value]) => [key,
    '#' + new Color(value).offsetHSL(0, (random() - 0.5) * 0.08, (random() - 0.5) * 0.12).getHexString()]));
  return normalizeSimplePickupOptions({ ...p, ...overrides, colors: { ...colors, ...overrides.colors } });
}

const starProfile = () => Array.from({ length: 10 }, (_, i) => {
  const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.23 : 0.5;
  return [Math.cos(a) * r, Math.sin(a) * r];
});

function buildItem(kit, root, p) {
  const c = p.colors;
  const disc = (name, radius, depth, position, color) => {
    const profile = Array.from({ length: SIDES }, (_, i) =>
      [Math.cos(i / SIDES * Math.PI * 2), Math.sin(i / SIDES * Math.PI * 2)]);
    return kit.prism(root, name, profile, [radius, radius, depth], position, color);
  };
  if (p.kind === 'coin') disc('coin-disc', 0.5, 0.14, [0, 0, 0], c.body);
  else if (p.kind === 'ring') kit.ring(root, 'collectible-ring', 0.5, RING_WIDTH, 0.13, [0, 0, 0], c.body, SIDES);
  else if (p.kind === 'gem') {
    if (p.gemShape === 'diamond') {
      kit.cylinder(root, 'gem-crown', 0.5, 0.28, [0, 0.14, 0], c.accent, 0.55);
      const lower = kit.cylinder(root, 'gem-point', 0.5, 0.65, [0, -0.325, 0], c.body, 0);
      lower.rotation.x = Math.PI;
    } else {
      kit.cylinder(root, 'crystal-column', 0.24, 0.9, [0, 0, 0], c.body, 0.2);
      if (p.gemShape === 'cluster') for (const side of [-1, 1]) {
        const part = kit.cylinder(root, 'crystal-branch', 0.17, 0.6, [side * 0.28, -0.16, 0], c.accent, 0.2);
        part.rotation.z = -side * 0.28;
      }
    }
  } else if (p.kind === 'star') kit.prism(root, 'star', starProfile(), [1, 1, 0.24], [0, 0, 0], c.body);
  else if (p.kind === 'heart') {
    const heart = [[0, -0.46], [-0.47, 0.02], [-0.48, 0.26], [-0.3, 0.44], [-0.13, 0.43],
      [0, 0.28], [0.13, 0.43], [0.3, 0.44], [0.48, 0.26], [0.47, 0.02]];
    kit.prism(root, 'heart', heart, [1, 1, 0.28], [0, 0, 0], c.body);
  } else if (p.kind === 'potion') {
    if (p.bottleShape === 'round') kit.sphere(root, 'bottle-body', [0.78, 0.76, 0.65], [0, 0, 0], c.body);
    else if (p.bottleShape === 'square') kit.box(root, 'bottle-body', [0.66, 0.7, 0.45], [0, 0, 0], c.body);
    else kit.frustum(root, 'bottle-body', [0.8, 0.7, 0.52], [0, 0, 0], c.body, 0.4);
    kit.cylinder(root, 'bottle-neck', 0.14, 0.23, [0, 0.43, 0], c.body);
    kit.cylinder(root, 'bottle-stopper', 0.17, 0.16, [0, 0.61, 0], c.trim);
    if (FILL > 0) kit.box(root, 'bottle-fill', [0.23, 0.43 * FILL, 0.02],
      [0, -0.235 + 0.215 * FILL, -0.34], c.liquid);
  } else if (p.kind === 'medkit') {
    if (p.packShape === 'bundle') {
      const roll = kit.cylinder(root, 'bandage-roll', 0.3, 0.9, [0, 0, 0], c.body);
      roll.rotation.z = Math.PI / 2;
      kit.box(root, 'bandage-wrap', [0.92, 0.24, 0.55], [0, 0, 0], c.trim);
    } else {
      if (p.packShape === 'box') kit.box(root, 'medical-case', [1, 0.6, 0.35], [0, 0, 0], c.body);
      else kit.frustum(root, 'medical-pouch', [1, 0.6, 0.4], [0, 0, 0], c.body, 0.85);
      kit.box(root, 'case-band', [1.02, 0.16, 0.37], [0, 0, 0], c.trim);
    }
  } else if (p.kind === 'food') {
    if (p.foodShape === 'apple') {
      kit.sphere(root, 'apple', [0.8, 0.7, 0.7], [0, 0, 0], c.body);
      kit.box(root, 'apple-stem', [0.07, 0.22, 0.07], [0, 0.38, 0], c.trim);
    } else if (p.foodShape === 'bread') {
      kit.sphere(root, 'bread-loaf', [1.15, 0.52, 0.6], [0, 0, 0], c.body);
      kit.box(root, 'bread-bottom', [0.91, 0.12, 0.44], [0, -0.2, 0], c.trim);
    } else {
      kit.sphere(root, 'roast', [0.6, 0.74, 0.58], [0, 0.13, 0], c.body);
      kit.box(root, 'bone', [0.12, 0.5, 0.12], [0, -0.38, 0], c.accent);
    }
  } else if (p.kind === 'ammo') {
    const w = Math.max(0.45, ROUNDS * 0.18 + 0.14);
    if (p.packShape === 'box') kit.box(root, 'ammo-case', [w, 0.48, 0.36], [0, -0.08, 0], c.body);
    else if (p.packShape === 'pouch') kit.frustum(root, 'ammo-pouch', [w, 0.48, 0.4], [0, -0.08, 0], c.body, 0.85);
    else kit.box(root, 'bundle-band', [w, 0.12, 0.26], [0, -0.05, 0], c.trim);
    kit.box(root, 'cartridge-row', [w * 0.86, 0.5, 0.22], [0, 0.12, 0], c.accent);
  } else if (p.kind === 'battery') {
    kit.cylinder(root, 'battery-body', 0.29, 0.82, [0, 0, 0], c.body);
    kit.cylinder(root, 'battery-terminal', 0.12, 0.14, [0, 0.48, 0], c.accent);
  } else if (p.kind === 'orb') {
    kit.sphere(root, 'energy-core', [0.85, 0.85, 0.85], [0, 0, 0], c.body);
    const band = kit.ring(root, 'orb-band', 0.52, 0.09, 0.09, [0, 0, 0], c.trim, SIDES);
    band.rotation.x = Math.PI / 2;
  } else if (p.kind === 'key') {
    const head = kit.ring(root, 'key-bow', 0.29, 0.11, 0.13, [0, 0.3, 0],
      c.body, p.keyHead === 'round' ? SIDES : 4);
    if (p.keyHead === 'square') head.rotation.z = Math.PI / 4;
    const length = 0.7 * SHAFT;
    kit.box(root, 'key-shaft', [0.12, length, 0.13], [0, 0.08 - length / 2, 0], c.body);
    for (let i = 0; i < TEETH; i++) kit.box(root, 'key-tooth',
      [0.25, length / (TEETH + 1) * 0.4, 0.13],
      [0.1, 0.08 - length + (i + 0.4) * length * 0.65 / TEETH, 0], c.body);
  } else if (p.kind === 'keycard') kit.box(root, 'access-card', [0.9, 0.57, 0.07], [0, 0, 0], c.body);
  else if (p.kind === 'scroll') {
    kit.box(root, 'scroll-paper', [0.65, 0.75, 0.055], [0, 0, 0], c.body);
    for (const side of [-1, 1]) {
      const roll = kit.cylinder(root, 'scroll-roll', 0.105, 0.84, [0, side * 0.37, 0], c.trim);
      roll.rotation.z = Math.PI / 2;
    }
  } else if (p.kind === 'book') {
    kit.box(root, 'book-pages', [0.6, 0.82, 0.24], [0, 0, 0], c.trim);
    for (const side of [-1, 1]) kit.box(root, 'book-cover', [0.69, 0.9, 0.06], [0, 0, side * 0.145], c.body);
    kit.box(root, 'book-spine', [0.09, 0.9, 0.35], [-0.34, 0, 0], c.body);
  } else if (p.kind === 'relic') {
    kit.frustum(root, 'relic-base', [0.65, 0.22, 0.42], [0, -0.4, 0], c.trim, 0.7);
    kit.frustum(root, 'relic-body', [0.42, 0.7, 0.3], [0, 0.04, 0], c.body, 0.65);
    kit.box(root, 'relic-crown', [0.58, 0.34, 0.42], [0, 0.52, 0], c.accent);
  }
}

/** +Y up, -Z front. Each item's longest resting dimension is referenceHeight * sizeRatio. */
export function buildSimplePickupVisual(options = {}) {
  const p = normalizeSimplePickupOptions(options), kit = createPrimitiveKit(), mesh = new Group();
  mesh.name = `simple-pickup-${p.preset}`;
  const motion = kit.group(mesh, 'pickup-motion'), arrangement = kit.group(motion, 'pickup-arrangement');
  const template = new Group(), shape = kit.group(template, 'item-shape');
  buildItem(kit, shape, p);
  if (p.resting === 'flat') shape.rotation.x = Math.PI / 2;
  const native = measure(template), itemSize = p.referenceHeight * p.sizeRatio;
  shape.scale.multiplyScalar(itemSize / Math.max(...native.dimensions.toArray()));
  const scaled = measure(template), center = scaled.bounds.getCenter(new Vector3());
  shape.position.set(-center.x, -scaled.bounds.min.y, -center.z);
  const itemDimensions = measure(template).dimensions, random = seededRandom(p.shapeSeed), items = [];
  const gap = itemSize * p.spacing, cell = Math.hypot(itemDimensions.x, itemDimensions.z) + gap;
  const columns = Math.ceil(Math.sqrt(p.count));
  for (let i = 0; i < p.count; i++) {
    const item = template.clone(true); item.name = `pickup-item-${i + 1}`;
    if (p.layout === 'stack') {
      item.position.y = i * (itemDimensions.y + gap);
      item.rotation.y = i === 0 ? 0 : (random() - 0.5) * 0.55;
    } else if (p.layout === 'cluster' && p.count > 1) {
      item.position.set((i % columns) * cell, 0, Math.floor(i / columns) * cell);
      item.rotation.y = (random() - 0.5) * 0.8;
    } else item.position.x = i * (itemDimensions.x + gap);
    arrangement.add(item); items.push(item);
  }
  const assembled = measure(arrangement), midpoint = assembled.bounds.getCenter(new Vector3());
  arrangement.position.copy(midpoint).multiplyScalar(-1);
  const baseY = assembled.dimensions.y / 2;
  motion.position.y = baseY;
  const info = measure(mesh), hover = itemSize * p.hoverHeight, bob = itemSize * p.bobAmount;
  const padding = itemSize * p.pickupPadding;
  const volumeHeight = info.dimensions.y + hover + bob + padding * 2;
  const pickupVolume = freezeConfig({ shape: 'cylinder', center: [0, volumeHeight / 2 - padding, 0],
    radius: Math.hypot(info.dimensions.x, info.dimensions.z) / 2 + padding, height: volumeHeight });
  const pickup = kit.group(mesh, 'pickup-center', pickupVolume.center);
  const focus = kit.group(motion, 'item-focus');
  const api = {
    mesh, group: mesh, params: p, rig: { motion, arrangement }, ...info,
    scaleInfo: freezeConfig({ referenceHeight: p.referenceHeight, sizeRatio: p.sizeRatio,
      longestSide: itemSize, count: p.count }),
    pickupVolume, attachments: { pickup, focus, items },
    setPose(action = 'idle', seconds = 0) {
      kit.assertLive();
      if (!Object.hasOwn(PICKUP_MOTIONS, action)) throw new RangeError('pickup motion must be still, idle, appear or collect');
      if (typeof seconds !== 'number' || !Number.isFinite(seconds)) throw new TypeError('time must be finite');
      motion.visible = true; motion.position.set(0, baseY, 0); motion.rotation.set(0, 0, 0); motion.scale.setScalar(1);
      const elapsed = Math.max(0, seconds);
      if (action === 'idle') {
        const phase = rate => rate === 0 ? 0 : (elapsed % (1 / Math.abs(rate))) * rate * Math.PI * 2;
        motion.position.y += hover + (Math.sin(phase(p.motionSpeed)) + 1) * 0.5 * bob;
        motion.rotation.y = phase(p.motionSpeed * p.spinSpeed);
      } else if (action === 'appear' || action === 'collect') {
        const progress = Math.min(1, elapsed / (p.transitionDuration / p.motionSpeed));
        const smooth = progress * progress * (3 - 2 * progress);
        const scale = action === 'appear' ? smooth : 1 - smooth;
        motion.scale.setScalar(scale);
        motion.position.y += hover + (action === 'appear' ? 1 - smooth : smooth) * itemSize * 0.7;
        motion.rotation.y = progress * p.transitionDuration * Math.PI * 2 * p.spinSpeed;
        motion.visible = scale > 0;
      }
      mesh.updateMatrixWorld(true);
      return api;
    },
    reset() { return api.setPose('still', 0); },
    getStats: () => kit.stats(mesh), dispose: () => kit.dispose(mesh),
  };
  return api.reset();
}

// Compatibility exports: the simplified factory replaces the original under
// this module's historical name, and keeps the original consumer surface.
export { PICKUP_MOTIONS as SIMPLE_PICKUP_MOTIONS };
export { SIMPLE_PICKUP_PRESETS as PICKUP_PRESETS };
export { SIMPLE_PICKUP_SCHEMA as PICKUP_SCHEMA };
export { normalizeSimplePickupOptions as normalizePickupOptions };
export { randomSimplePickupOptions as randomPickupOptions };
export { buildSimplePickupVisual as createPickupVisual, buildSimplePickupVisual as buildPickupVisual };