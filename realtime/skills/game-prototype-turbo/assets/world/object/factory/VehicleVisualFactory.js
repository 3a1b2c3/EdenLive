import { Group } from 'three';
import { choiceOption as choice, createPrimitiveKit, freezeConfig,
  normalizeFactoryOptions, randomFactoryOptions, finishVisual } from './VisualFactoryUtils.js';

// Simplified road vehicle: a body box, a cabin box and plain wheels. No
// windows, pillars, lamps, mirrors, bumpers, livery stripes, spoilers, roof
// racks, signs, exhaust stacks or fenders, and no suspension or body-roll rig.
// Cargo variants keep one extra box so a truck still reads as a truck.
// The Simple-prefixed exports are canonical; the unprefixed aliases at the end
// keep this module's historical name and consumers unchanged.
export const SIMPLE_VEHICLE_MOTIONS = Object.freeze({ still: 'still', drive: 'drive' });
const MOTION_IDS = Object.keys(SIMPLE_VEHICLE_MOTIONS);

export const SIMPLE_VEHICLE_PRESETS = freezeConfig({
  sedan: { type: 'car', length: 4.6, height: 1.7, cabinRatio: 0.5 },
  hatchback: { type: 'car', length: 3.7, height: 1.8, cabinRatio: 0.65 },
  coupe: { type: 'car', length: 4.8, height: 1.35, cabinRatio: 0.4, colors: { body: '#bd745c' } },
  suv: { type: 'car', width: 2.3, length: 4.8, height: 2.2, wheelScale: 1.15, cabinRatio: 0.68 },
  taxi: { type: 'car', length: 4.7, colors: { body: '#e5bd62' } },
  pickup: { type: 'pickup', length: 5.6, height: 2.1, wheelScale: 1.15 },
  van: { type: 'van', length: 5.3, height: 2.65, width: 2.2 },
  minibus: { type: 'bus', length: 6.3, height: 2.9, width: 2.3 },
  bus: { type: 'bus', length: 10, height: 3.3, width: 2.6, axles: 3, colors: { body: '#85aa9f' } },
  boxtruck: { type: 'boxtruck', length: 7.6, height: 3.5, width: 2.5, axles: 3 },
  tanker: { type: 'tanker', length: 8.5, height: 3.3, width: 2.5, axles: 3,
    colors: { body: '#c68a61', cargo: '#c1cbbb' } },
  tipper: { type: 'pickup', length: 7, height: 3.2, width: 2.7, axles: 3,
    colors: { body: '#d5ad5c', cargo: '#d5ad5c' } },
  tractor: { type: 'tractor', length: 3.8, height: 2.5, width: 2.1, rearWheelScale: 1.7,
    wheelScale: 0.95, colors: { body: '#83a47b' } },
  motorcycle: { type: 'motorcycle', length: 2.6, width: 0.7, height: 1.4, wheelScale: 1.8 },
  scooter: { type: 'motorcycle', length: 2, width: 0.75, height: 1.3, wheelScale: 1.3,
    colors: { body: '#9dbbb5' } },
});

export const SIMPLE_VEHICLE_SCHEMA = freezeConfig({
  type: { label: 'vehicle structure', default: 'car', choices: { car: 'car', pickup: 'pickup / tipper', van: 'van', bus: 'bus', boxtruck: 'box truck', tanker: 'tanker', tractor: 'tractor', motorcycle: 'two-wheeler' }, randomize: false },
  width: { label: 'body width', default: 1.95, min: 0.65, max: 3.3, step: 0.05 },
  length: { label: 'body length', default: 4.5, min: 1.8, max: 12, step: 0.1 },
  height: { label: 'body height', default: 1.8, min: 1, max: 4.2, step: 0.05 },
  cabinRatio: { label: 'cabin length ratio', default: 0.5, min: 0.3, max: 0.72, step: 0.02, when: p => p.type === 'car' },
  wheelScale: { label: 'wheel size', default: 1, min: 0.65, max: 1.8, step: 0.05 },
  wheelbase: { label: 'wheelbase ratio', default: 0.63, min: 0.45, max: 0.8, step: 0.01 },
  rearWheelScale: { label: 'rear wheel scale', default: 1, min: 0.8, max: 1.8, step: 0.05, when: p => p.type === 'tractor' },
  axles: { label: 'axle count', default: 2, min: 2, max: 4, step: 1, when: p => !['car', 'motorcycle', 'tractor'].includes(p.type) },
  steering: { label: 'steering angle (positive left)', default: 0, min: -40, max: 40, step: 1, randomize: false },
});

const PALETTE = { body: '#80aba0', chassis: '#354852', wheel: '#3f4c51', cargo: '#b7c5b6' };
const PALETTES = [PALETTE,
  { ...PALETTE, body: '#c98766' },
  { ...PALETTE, body: '#d8ba65', cargo: '#aaa477' },
  { ...PALETTE, body: '#889eb6' },
  { ...PALETTE, body: '#e0deca', cargo: '#90aa9b' },
];
export const normalizeSimpleVehicleOptions = (options = {}) =>
  normalizeFactoryOptions(options, SIMPLE_VEHICLE_PRESETS, SIMPLE_VEHICLE_SCHEMA, PALETTE);
export const randomSimpleVehicleOptions = (seed = 1, overrides = {}) =>
  randomFactoryOptions(seed, overrides, SIMPLE_VEHICLE_PRESETS, SIMPLE_VEHICLE_SCHEMA, PALETTES, normalizeSimpleVehicleOptions);

/** Simplified road vehicle. +Y up, -Z forward, root at ground level. */
export function buildSimpleVehicleVisual(options = {}) {
  const p = normalizeSimpleVehicleOptions(options), c = p.colors;
  const kit = createPrimitiveKit(), mesh = new Group();
  mesh.name = `simple-vehicle-${p.preset}`;
  const w = p.width, h = p.height, l = p.length, bike = p.type === 'motorcycle';
  const r = bike ? Math.min(h * 0.3, l * 0.16) * p.wheelScale / 1.4
    : Math.min(w * 0.19, h * 0.25, l * 0.11) * p.wheelScale;
  const floor = r * 1.5, bodyH = h * 0.34, top = Math.max(h, floor + bodyH + h * 0.3);
  const wheels = [], steeringPivots = [];
  const axleCount = bike || ['car', 'tractor'].includes(p.type) ? 2 : p.axles;

  for (let axle = 0; axle < axleCount; axle++) {
    const z = axle === 0 ? -l * p.wheelbase / 2 : l * p.wheelbase / 2 - (axle - 1) * l * 0.12;
    const radius = p.type === 'tractor' && axle > 0 ? r * p.rearWheelScale : r;
    for (const side of bike ? [0] : [-1, 1]) {
      const steer = kit.group(mesh, 'steering-pivot', [side * w * 0.46, radius, z]);
      if (axle === 0) { steer.rotation.y = p.steering * Math.PI / 180; steeringPivots.push(steer); }
      const pivot = kit.group(steer, 'wheel-pivot');
      const tire = kit.cylinder(pivot, 'tire', radius, bike ? w * 0.3 : w * 0.16, [0, 0, 0], c.wheel);
      tire.rotation.z = Math.PI / 2;
      kit.box(pivot, 'wheel-spoke', [bike ? w * 0.32 : w * 0.17, radius * 1.2, radius * 0.15],
        [0, 0, 0], c.chassis);
      wheels.push({ pivot, steer, radius, axle, side });
    }
  }

  if (bike) {
    // A frame beam and a saddle-height box: enough for a two-wheeler silhouette.
    kit.beam(mesh, 'frame', [0, r, l * 0.28], [0, h * 0.7, -l * 0.28], w * 0.3, c.body);
    kit.box(mesh, 'saddle', [w * 0.8, h * 0.16, l * 0.4], [0, h * 0.8, l * 0.08], c.chassis);
    kit.box(mesh, 'handlebar', [w * 1.3, h * 0.1, 0.12], [0, h * 0.95, -l * 0.26], c.chassis);
  } else {
    kit.box(mesh, 'body', [w, bodyH, l], [0, floor + bodyH / 2, 0], c.body);
    const longCab = ['van', 'bus'].includes(p.type), car = p.type === 'car';
    const cabL = car ? l * p.cabinRatio : longCab ? l * 0.92 : l * 0.3;
    const cabZ = car ? 0 : longCab ? 0 : -l * 0.31;
    const cabBase = floor + bodyH, cabH = top - cabBase;
    kit.box(mesh, 'cabin', [w * 0.9, cabH, cabL], [0, cabBase + cabH / 2, cabZ], c.body);
    if (p.type === 'pickup') {
      const bedL = l * 0.55, bedH = h * 0.3;
      kit.box(mesh, 'cargo-bed', [w * 0.96, bedH, bedL], [0, cabBase + bedH / 2, l * 0.45 - bedL / 2], c.cargo);
    } else if (p.type === 'boxtruck') {
      const cargoH = top - floor;
      kit.box(mesh, 'cargo-box', [w * 1.02, cargoH, l * 0.6], [0, cabBase + cargoH / 2, l * 0.18], c.cargo);
    } else if (p.type === 'tanker') {
      const tankR = w * 0.46;
      const tank = kit.cylinder(mesh, 'tank', tankR, l * 0.6, [0, cabBase + tankR, l * 0.17], c.cargo);
      tank.rotation.x = Math.PI / 2;
    } else if (p.type === 'tractor') {
      // The cab sits over the big rear wheels, leaving the engine hood ahead of it.
      mesh.children.filter(o => o.name === 'cabin').forEach(o => { o.position.z += l * 0.4; });
      kit.box(mesh, 'engine-hood', [w * 0.7, h * 0.3, l * 0.5], [0, cabBase + h * 0.12, -l * 0.14], c.body);
    }
  }

  const children = [...mesh.children], motion = kit.group(mesh, 'vehicle-motion');
  children.forEach(node => motion.add(node));

  function setPose(id = 'still', seconds = 0) {
    kit.assertLive();
    choice(id, 'still', MOTION_IDS, 'motion');
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) throw new TypeError('time must be finite');
    const distance = id === 'drive' ? seconds * 6 : 0;
    for (const wheel of wheels) wheel.pivot.rotation.x = -distance / wheel.radius;
    return api;
  }

  const api = finishVisual(kit, mesh, p, { wheels, steeringPivots,
    motions: SIMPLE_VEHICLE_MOTIONS, setPose, reset: () => setPose('still', 0) });
  return api.reset();
}

// Compatibility exports: the simplified factory replaces the original under
// this module's historical name, and keeps the original consumer surface.
export { SIMPLE_VEHICLE_MOTIONS as VEHICLE_MOTIONS };
export { SIMPLE_VEHICLE_PRESETS as VEHICLE_PRESETS };
export { SIMPLE_VEHICLE_SCHEMA as VEHICLE_SCHEMA };
export { normalizeSimpleVehicleOptions as normalizeVehicleOptions };
export { randomSimpleVehicleOptions as randomVehicleOptions };
export { buildSimpleVehicleVisual as createVehicleVisual, buildSimpleVehicleVisual as buildVehicleVisual };