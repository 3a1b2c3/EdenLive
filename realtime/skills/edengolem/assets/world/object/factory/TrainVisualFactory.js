import { Group } from 'three';
import { choiceOption as choice, createPrimitiveKit, freezeConfig,
  normalizeFactoryOptions, randomFactoryOptions, finishVisual } from './VisualFactoryUtils.js';

// Simplified consist: one box per car on plain wheels. No side windows, doors,
// livery bands, cab glazing, lamps, pantograph, connecting rods, boiler bands,
// water tanks, cowcatcher or steam puffs. The head car keeps just enough
// massing to tell a steam engine from a metro or a high-speed nose.
// The Simple-prefixed exports are canonical; the unprefixed aliases at the end
// keep this module's historical name and consumers unchanged.
export const SIMPLE_TRAIN_MOTIONS = Object.freeze({ still: 'still', roll: 'drive' });
const MOTION_IDS = Object.keys(SIMPLE_TRAIN_MOTIONS);

export const SIMPLE_TRAIN_PRESETS = freezeConfig({
  subway: { type: 'metro', width: 2.15, height: 3.25, length: 8.5, cars: 2 },
  commuter: { type: 'metro', width: 2.7, height: 3.65, length: 11, cars: 3 },
  bullet: { type: 'highspeed', width: 2.6, height: 3.25, length: 11, cars: 3, nose: 2.9,
    colors: { body: '#e8eee5' } },
  streetcar: { type: 'tram', width: 1.95, height: 3.1, length: 6.5, cars: 2,
    colors: { body: '#f1c260' } },
  diesel: { type: 'diesel', width: 2.8, height: 3.8, length: 10.5, cars: 1, coach: 'freight',
    colors: { body: '#c67754' } },
  freight: { type: 'diesel', width: 2.55, height: 3.5, length: 9.5, cars: 4, coach: 'freight',
    colors: { body: '#76988f' } },
  steam: { type: 'steam', width: 2.4, height: 3.65, length: 8.7, cars: 3, driveWheels: 3,
    colors: { body: '#324e53' } },
  tank: { type: 'steam', width: 2.25, height: 3.1, length: 6.2, cars: 1, driveWheels: 2,
    colors: { body: '#77aba1' } },
  express: { type: 'steam', width: 2.7, height: 4, length: 11.5, cars: 3, driveWheels: 4,
    colors: { body: '#8b5a53' } },
});

export const SIMPLE_TRAIN_SCHEMA = freezeConfig({
  type: { label: 'head structure', default: 'metro', choices: { steam: 'steam', diesel: 'diesel', metro: 'metro', tram: 'tram', highspeed: 'high speed' }, randomize: false },
  width: { label: 'car width', default: 2.4, min: 1.5, max: 3.6, step: 0.05 },
  height: { label: 'car height', default: 3.4, min: 2.3, max: 5, step: 0.05 },
  length: { label: 'car length', default: 9, min: 5, max: 15, step: 0.25 },
  cars: { label: 'car count', default: 2, min: 1, max: 6, step: 1 },
  gap: { label: 'car gap', default: 0.65, min: 0.35, max: 1.6, step: 0.05 },
  coach: { label: 'trailing cars', default: 'passenger', choices: { passenger: 'passenger', freight: 'freight' } },
  nose: { label: 'nose length', default: 2, min: 0.6, max: 4, step: 0.1, when: p => p.type === 'highspeed' },
  driveWheels: { label: 'drive axles', default: 3, min: 2, max: 5, step: 1, when: p => p.type === 'steam' },
  chimney: { label: 'chimney height', default: 0.6, min: 0.3, max: 1.2, step: 0.05, when: p => p.type === 'steam' },
  wheelScale: { label: 'wheel scale', default: 1, min: 0.7, max: 1.25, step: 0.05 },
});

const PALETTE = { body: '#dbe6de', chassis: '#293c4c', wheel: '#425465' };
const PALETTES = [PALETTE,
  { ...PALETTE, body: '#80a79d' },
  { ...PALETTE, body: '#b97863' },
  { ...PALETTE, body: '#dcc16c' },
  { ...PALETTE, body: '#8193ba' },
];
export const normalizeSimpleTrainOptions = (options = {}) =>
  normalizeFactoryOptions(options, SIMPLE_TRAIN_PRESETS, SIMPLE_TRAIN_SCHEMA, PALETTE);
export const randomSimpleTrainOptions = (seed = 1, overrides = {}) =>
  randomFactoryOptions(seed, overrides, SIMPLE_TRAIN_PRESETS, SIMPLE_TRAIN_SCHEMA, PALETTES, normalizeSimpleTrainOptions);

/** Simplified consist. +Y up, -Z forward, root at rail level. */
export function buildSimpleTrainVisual(options = {}) {
  const p = normalizeSimpleTrainOptions(options), c = p.colors;
  const kit = createPrimitiveKit(), mesh = new Group();
  mesh.name = `simple-train-${p.preset}`;
  const w = p.width, h = p.height, l = p.length;
  const cars = [], wheels = [];
  const totalLength = p.cars * l + (p.cars - 1) * p.gap;
  const r = Math.min(h * 0.12 * p.wheelScale, w * 0.24);
  const floorY = r * 1.9;

  function wheel(parent, radius, z, side) {
    const pivot = kit.group(parent, 'wheel-pivot', [side * w * 0.45, radius, z]);
    const tire = kit.cylinder(pivot, 'wheel', radius, w * 0.1, [0, 0, 0], c.wheel);
    tire.rotation.z = Math.PI / 2;
    // One spoke bar keeps the rolling animation readable without a hub disc.
    kit.box(pivot, 'wheel-spoke', [w * 0.11, radius * 1.6, radius * 0.16], [0, 0, 0], c.chassis);
    wheels.push({ pivot, radius });
  }

  function bogies(parent) {
    for (const bogie of [-1, 1]) for (const side of [-1, 1]) wheel(parent, r, bogie * l * 0.31, side);
  }

  for (let i = 0; i < p.cars; i++) {
    const center = -totalLength / 2 + l / 2 + i * (l + p.gap);
    const car = kit.group(mesh, `car-${i}`, [0, 0, center]);
    kit.box(car, 'chassis', [w * 0.9, r * 0.5, l * 0.96], [0, floorY - r * 0.25, 0], c.chassis);
    const head = i === 0;
    if (head && p.type === 'steam') {
      // Boiler cylinder plus cab box: the whole locomotive in three shapes.
      const boilerR = w * 0.36, boilerY = floorY + boilerR + h * 0.06, boilerL = l * 0.62;
      const boiler = kit.cylinder(car, 'boiler', boilerR, boilerL, [0, boilerY, -l * 0.16], c.body);
      boiler.rotation.x = Math.PI / 2;
      const chimneyH = h * 0.2 * p.chimney;
      kit.cylinder(car, 'chimney', w * 0.14, chimneyH,
        [0, boilerY + boilerR + chimneyH / 2, -l * 0.38], c.chassis);
      kit.box(car, 'cab', [w, h - floorY - h * 0.04, l * 0.32], [0, (floorY + h - h * 0.04) / 2, l * 0.32], c.body);
      const driveR = Math.min(h * 0.2 * p.wheelScale, l * 0.6 / (p.driveWheels * 2.2));
      for (let j = 0; j < p.driveWheels; j++) {
        const z = -l * 0.14 + (j / (p.driveWheels - 1) - 0.5) * l * 0.56;
        for (const side of [-1, 1]) wheel(car, driveR, z, side);
      }
      for (const side of [-1, 1]) wheel(car, r * 0.85, l * 0.36, side);
    } else if (head && p.type === 'diesel') {
      const hoodH = (h - floorY) * 0.62;
      kit.box(car, 'engine-hood', [w * 0.82, hoodH, l * 0.62], [0, floorY + hoodH / 2, -l * 0.16], c.body);
      kit.box(car, 'cab', [w, h - floorY, l * 0.3], [0, (floorY + h) / 2, l * 0.29], c.body);
      bogies(car);
    } else if (p.type === 'highspeed' && (head || i === p.cars - 1)) {
      const noseLength = Math.min(p.nose, l * 0.33), front = head;
      const bodyLength = l - noseLength;
      const bodyCenter = front ? noseLength / 2 : -noseLength / 2;
      kit.box(car, 'body', [w, h - floorY, bodyLength], [0, (floorY + h) / 2, bodyCenter], c.body);
      const noseRoot = kit.group(car, 'nose-root', [0, floorY, (front ? -1 : 1) * (l / 2 - noseLength / 2)]);
      if (!front) noseRoot.rotation.y = Math.PI;
      kit.nose(noseRoot, 'streamlined-nose', [w, h - floorY, noseLength],
        [0, (h - floorY) / 2, 0], c.body, 0.42, 0.36);
      bogies(car);
    } else if (!head && p.coach === 'freight') {
      const cargoH = (h - floorY) * 0.78;
      kit.box(car, 'cargo-container', [w * 0.96, cargoH, l * 0.92], [0, floorY + cargoH / 2, 0], c.body);
      bogies(car);
    } else {
      kit.box(car, 'body', [w, h - floorY, l * 0.98], [0, (floorY + h) / 2, 0], c.body);
      bogies(car);
    }
    cars.push({ mesh: car, index: i, centerZ: center });
    if (i > 0) kit.box(mesh, 'coupler', [w * 0.22, r * 0.4, p.gap + 0.05],
      [0, floorY - r * 0.25, center - l / 2 - p.gap / 2], c.chassis);
  }
  const attachments = {
    front: kit.group(mesh, 'front-coupling', [0, floorY, -totalLength / 2]),
    rear: kit.group(mesh, 'rear-coupling', [0, floorY, totalLength / 2]),
  };

  function setPose(motion = 'still', seconds = 0) {
    kit.assertLive();
    choice(motion, 'still', MOTION_IDS, 'motion');
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) throw new TypeError('time must be finite');
    const distance = motion === 'roll' ? seconds * 4 : 0;
    for (const wheel of wheels) wheel.pivot.rotation.x = -distance / wheel.radius;
    return api;
  }

  const api = finishVisual(kit, mesh, p, { cars, wheels, attachments,
    motions: SIMPLE_TRAIN_MOTIONS, setPose, reset: () => setPose('still', 0) });
  return api.reset();
}

// Compatibility exports: the simplified factory replaces the original under
// this module's historical name, and keeps the original consumer surface.
export const TRAIN_TYPES = Object.freeze(['steam', 'diesel', 'metro', 'tram', 'highspeed']);
export { SIMPLE_TRAIN_MOTIONS as TRAIN_MOTIONS };
export { SIMPLE_TRAIN_PRESETS as TRAIN_PRESETS };
export { SIMPLE_TRAIN_SCHEMA as TRAIN_SCHEMA };
export { normalizeSimpleTrainOptions as normalizeTrainOptions };
export { randomSimpleTrainOptions as randomTrainOptions };
export { buildSimpleTrainVisual as createTrainVisual, buildSimpleTrainVisual as buildTrainVisual };