import { Group } from 'three';
import { createPrimitiveKit, freezeConfig, normalizeFactoryOptions, randomFactoryOptions, finishVisual } from './VisualFactoryUtils.js';

export const VEHICLE_PRESETS = freezeConfig({
  sedan: { type: 'car', length: 4.6, height: 1.7, cabinRatio: 0.5 },
  hatchback: { type: 'car', length: 3.7, height: 1.8, cabinRatio: 0.65, cabinPosition: 0.07, bodyStyle: 'round' },
  coupe: { type: 'car', length: 4.8, height: 1.35, cabinRatio: 0.4, cabinPosition: 0.1, spoiler: true, colors: { body: '#bd745c' } },
  suv: { type: 'car', width: 2.3, length: 4.8, height: 2.2, wheelScale: 1.15, cabinRatio: 0.68, roofRack: true },
  taxi: { type: 'car', length: 4.7, roofSign: true, colors: { body: '#e5bd62', accent: '#647f6e' } },
  pickup: { type: 'pickup', length: 5.6, height: 2.1, wheelScale: 1.15 },
  van: { type: 'van', length: 5.3, height: 2.65, width: 2.2, windows: 3, bodyStyle: 'box' },
  minibus: { type: 'bus', length: 6.3, height: 2.9, windows: 4, width: 2.3 },
  bus: { type: 'bus', length: 10, height: 3.3, width: 2.6, windows: 7, axles: 3, colors: { body: '#85aa9f', accent: '#eac783' } },
  boxtruck: { type: 'boxtruck', length: 7.6, height: 3.5, width: 2.5, axles: 3 },
  tanker: { type: 'tanker', length: 8.5, height: 3.3, width: 2.5, axles: 3, colors: { cargo: '#c1cbbb', body: '#c68a61' } },
  tipper: { type: 'dumptruck', length: 7, height: 3.2, width: 2.7, axles: 3, cargoHeight: 1.2, colors: { body: '#d5ad5c', cargo: '#d5ad5c' } },
  tractor: { type: 'tractor', length: 3.8, height: 2.5, width: 2.1, rearWheelScale: 1.7, wheelScale: 0.95, exhaust: true, colors: { body: '#83a47b' } },
  motorcycle: { type: 'motorcycle', length: 2.6, width: 0.7, height: 1.4, wheelScale: 1.8, bodyStyle: 'round' },
  scooter: { type: 'motorcycle', length: 2, width: 0.75, height: 1.3, wheelScale: 1.3, bodyStyle: 'box', colors: { body: '#9dbbb5' } },
});
export const VEHICLE_SCHEMA = freezeConfig({
  type: { label: 'type', default: 'car', choices: { car: 'car', pickup: 'pickup', van: 'van', bus: 'bus', boxtruck: 'boxtruck', tanker: 'tanker', dumptruck: 'dumptruck', tractor: 'tractor', motorcycle: 'motorcycle' }, randomize: false },
  width: { label: 'width', default: 1.95, min: 0.65, max: 3.3, step: 0.05 },
  length: { label: 'length', default: 4.5, min: 1.8, max: 12, step: 0.1 },
  height: { label: 'height', default: 1.8, min: 1, max: 4.2, step: 0.05 },
  bodyStyle: { label: 'bodyStyle', default: 'tapered', choices: { box: 'box', tapered: 'tapered', round: 'round' } },
  cabinRatio: { label: 'cabinRatio', default: 0.5, min: 0.3, max: 0.72, step: 0.02, when: p => p.type === 'car' },
  cabinPosition: { label: 'cabinPosition', default: 0.02, min: -0.12, max: 0.15, step: 0.01, fullRange: true, when: p => p.type === 'car' },
  cabinWidth: { label: 'cabinWidth', default: 0.82, min: 0.65, max: 0.98, step: 0.02, when: p => p.type !== 'motorcycle' },
  wheelScale: { label: 'wheelScale', default: 1, min: 0.65, max: 1.8, step: 0.05 },
  wheelbase: { label: 'wheelbase', default: 0.63, min: 0.45, max: 0.8, step: 0.01 },
  rearWheelScale: { label: 'rearWheelScale', default: 1, min: 0.8, max: 1.8, step: 0.05, when: p => p.type === 'tractor' },
  axles: { label: 'axles', default: 2, min: 2, max: 4, step: 1, when: p => !['car', 'motorcycle', 'tractor'].includes(p.type) },
  windows: { label: 'windows', default: 3, min: 2, max: 9, step: 1, when: p => ['bus', 'van'].includes(p.type) },
  cargoHeight: { label: 'cargoHeight', default: 0.9, min: 0.4, max: 1.4, step: 0.05, when: p => ['pickup', 'boxtruck', 'tanker', 'dumptruck'].includes(p.type) },
  bedTilt: { label: 'bedTilt', default: 0, min: 0, max: 42, step: 1, when: p => p.type === 'dumptruck' },
  roofRack: { label: 'roofRack', default: false, when: p => ['car', 'van'].includes(p.type) },
  roofSign: { label: 'roofSign', default: false, when: p => p.type !== 'motorcycle' },
  spoiler: { label: 'spoiler', default: false, when: p => p.type === 'car' },
  bumpers: { label: 'bumpers', default: true, when: p => p.type !== 'motorcycle' },
  mirrors: { label: 'mirrors', default: true },
  exhaust: { label: 'exhaust', default: false, when: p => ['tractor', 'boxtruck', 'tanker', 'dumptruck'].includes(p.type) },
  stripe: { label: 'stripe', default: true },
  steering: { label: 'steering', default: 0, min: -30, max: 30, step: 1, fullRange: true },
});
const PALETTE = { body: '#80aba0', roof: '#d9e1ce', window: '#2e4c5f', chassis: '#354852', wheel: '#3f4c51', hub: '#b4c2b4', accent: '#efbb70', lamp: '#f5e1a6', cargo: '#b7c5b6' };
const PALETTES = [PALETTE,
  { ...PALETTE, body: '#c98766', accent: '#e4c991', roof: '#e4d6b9' },
  { ...PALETTE, body: '#d8ba65', accent: '#5b8984', cargo: '#aaa477' },
  { ...PALETTE, body: '#889eb6', accent: '#d1b789', roof: '#c6d5cf' },
  { ...PALETTE, body: '#e0deca', accent: '#9c6e5d', cargo: '#90aa9b' },
];
export const normalizeVehicleOptions = (options = {}) => normalizeFactoryOptions(options, VEHICLE_PRESETS, VEHICLE_SCHEMA, PALETTE);
export const randomVehicleOptions = (seed = 1, overrides = {}) => randomFactoryOptions(seed, overrides, VEHICLE_PRESETS, VEHICLE_SCHEMA, PALETTES, normalizeVehicleOptions);


/** Simplified road vehicle. Forward is -Z; setPose animates wheels without moving the root. */
export function buildVehicleVisual(options = {}) {
  const p = normalizeVehicleOptions(options), c = p.colors, kit = createPrimitiveKit(), mesh = new Group();
  mesh.name = `simple-vehicle-${p.preset}`;
  const w = p.width, h = p.height, l = p.length, bike = p.type === 'motorcycle';
  const r = bike ? Math.min(h * 0.3, l * 0.16) * p.wheelScale / 1.4 : Math.min(w * 0.19, h * 0.25, l * 0.11) * p.wheelScale;
  const floor = r * 1.5, bodyH = h * 0.34, top = Math.max(h, floor + bodyH + h * 0.3);
  const wheels = [], wheelPivots = [], wheelRecords = [], steeringPivots = [];
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
      kit.box(pivot, 'wheel-spoke', [bike ? w * 0.32 : w * 0.17, radius * 1.2, radius * 0.15], [0, 0, 0], c.chassis);
      wheels.push(tire); wheelPivots.push(pivot); wheelRecords.push({ pivot: tire, radius });
    }
  }
  if (bike) {
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
    if (p.type === 'pickup' || p.type === 'dumptruck') {
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
      mesh.children.filter(o => o.name === 'cabin').forEach(o => { o.position.z += l * 0.4; });
      kit.box(mesh, 'engine-hood', [w * 0.7, h * 0.3, l * 0.5], [0, cabBase + h * 0.12, -l * 0.14], c.body);
    }
  }
  const api = finishVisual(kit, mesh, p, { wheels, wheelPivots, wheelRecords, steeringPivots,
    setPose(distance = 0) {
      kit.assertLive();
      if (!Number.isFinite(distance)) throw new TypeError('distance must be finite');
      for (const [i, wheel] of wheels.entries()) wheel.rotation.x = -distance / wheelRecords[i].radius;
      return api;
    },
  });
  return api;
}
export const createVehicleVisual = buildVehicleVisual;
