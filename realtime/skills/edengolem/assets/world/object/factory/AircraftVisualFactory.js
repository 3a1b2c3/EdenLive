import { Group } from 'three';
import { createPrimitiveKit, freezeConfig, normalizeFactoryOptions,
  randomFactoryOptions, finishVisual, choiceOption } from './VisualFactoryUtils.js';
import { AIRCRAFT_MOTIONS, AIRCRAFT_MOTION_SCHEMA, installAircraftMotion } from './AircraftMotion.js';
import { visibleTransportBounds } from './TransportMotionUtils.js';
export { AIRCRAFT_MOTIONS as SIMPLE_AIRCRAFT_MOTIONS };

// Simplified aircraft: fuselage block, flat wing panels with their control
// surfaces, tail, engines and landing gear. Cabin windows, liveries, fighter
// intakes, wing-root extensions, winglets, biplane struts, gear doors, rotor
// hubs and missile fins are gone; every flight action still works.
// The Simple-prefixed exports are canonical; the unprefixed aliases at the end
// keep this module's historical name and consumers unchanged.
export const SIMPLE_AIRCRAFT_PRESETS = freezeConfig({
  trainer: { type: 'propeller', length: 7, width: 1.2, wingspan: 9, engines: 1, wingLevel: 'high' },
  biplane: { type: 'biplane', length: 6, width: 1.25, wingspan: 7.5, wingSweep: 0, engines: 1,
    colors: { body: '#d3aa64', wing: '#e2cb8e', accent: '#9c6c54' } },
  seaplane: { type: 'propeller', length: 8.5, width: 1.5, wingspan: 11, landingGear: 'floats', wingLevel: 'high', engines: 1 },
  twinprop: { type: 'propeller', length: 10, width: 1.6, wingspan: 12, engines: 2 },
  turboprop: { type: 'propeller', length: 17, width: 2.3, wingspan: 19, engines: 2, wingLevel: 'high', tail: 't', propellerBlades: 4 },
  glider: { type: 'glider', length: 7, width: 0.8, wingspan: 17, wingChord: 0.12, wingTaper: 0.34, tail: 't' },
  business: { type: 'jet', length: 12, width: 1.55, wingspan: 11, engines: 2, engineMount: 'rear', tail: 't' },
  airliner: { type: 'jet', length: 28, width: 3.3, wingspan: 27, wingSweep: 0.45, engines: 2 },
  jumbo: { type: 'jet', length: 38, width: 4.6, wingspan: 36, wingSweep: 0.5, engines: 4 },
  cargo: { type: 'jet', length: 29, width: 4.2, wingspan: 31, engines: 4, wingLevel: 'high', tail: 't', bodyStyle: 'box' },
  delta: { type: 'jet', length: 12, width: 1.4, wingspan: 7.5, wingChord: 0.42, wingTaper: 0.12, wingSweep: 0.7, engines: 1, engineMount: 'rear', tail: 'twin', canards: true },
  flyingwing: { type: 'flyingwing', length: 10, width: 2, wingspan: 22, wingChord: 0.66, wingTaper: 0.28, wingSweep: 0.6, engines: 2, landingGear: 'retracted' },
  helicopter: { type: 'helicopter', length: 8, width: 1.7, wingspan: 10, rotorBlades: 4, landingGear: 'skids' },
  lightFighter: { type: 'jet', length: 12, width: 1.35, wingspan: 8, bodyStyle: 'tapered', wingSweep: 0.35,
    wingChord: 0.27, engines: 1, engineMount: 'rear', cannon: true, weaponPairs: 1 },
  twinFighter: { type: 'jet', length: 16, width: 2, wingspan: 11, bodyStyle: 'tapered', wingSweep: 0.4,
    wingChord: 0.32, tail: 'twin', finCant: 16, engines: 2, engineMount: 'rear', cannon: true, weaponPairs: 2 },
  canardFighter: { type: 'jet', length: 14, width: 1.6, wingspan: 9, bodyStyle: 'tapered', wingSweep: 0.65,
    wingChord: 0.46, wingTaper: 0.12, tail: 'none', canards: true, engines: 1, engineMount: 'rear', cannon: true, weaponPairs: 2 },
  stealthFighter: { type: 'jet', length: 17, width: 2.3, wingspan: 12, bodyStyle: 'tapered', wingSweep: 0.55,
    wingChord: 0.38, wingTaper: 0.2, tail: 'twin', finCant: 28, engines: 2, engineMount: 'rear', cannon: true, weaponPairs: 1,
    colors: { body: '#899a9f', wing: '#a7b4b5', accent: '#617e82' } },
  forwardFighter: { type: 'jet', length: 14, width: 1.7, wingspan: 10, bodyStyle: 'tapered', wingSweep: -0.38,
    wingPosition: 0.12, wingChord: 0.27, tail: 'twin', canards: true, engines: 2, engineMount: 'rear', cannon: true, weaponPairs: 1 },
});

// A preset fixes the class and the parts that make the silhouette recognisable.
export const SIMPLE_AIRCRAFT_PRESET_LOCKED_FIELDS = [
  'type', 'bodyStyle', 'wingLevel', 'wingChord', 'wingTaper', 'wingSweep',
  'wingPosition', 'engines', 'engineMount', 'tail', 'tailSpan', 'tailHeight',
  'landingGear', 'propellerBlades', 'rotorBlades', 'canards', 'finCant', 'cannon', 'weaponPairs',
];

export const SIMPLE_AIRCRAFT_SCHEMA = freezeConfig({
  type: { label: 'aircraft type (set by preset)', default: 'propeller', choices: { propeller: 'propeller plane', biplane: 'biplane', jet: 'jet', glider: 'glider', flyingwing: 'flying wing', helicopter: 'helicopter' }, randomize: false, derived: true },
  length: { label: 'fuselage length', default: 8, min: 4, max: 42, step: 0.25 },
  width: { label: 'fuselage width', default: 1.4, min: 0.65, max: 5, step: 0.05 },
  wingspan: { label: 'wingspan / rotor diameter', default: 10, min: 5, max: 42, step: 0.25 },
  bodyStyle: { label: 'fuselage profile (set by preset)', default: 'round', choices: { round: 'round', box: 'box', tapered: 'tapered' }, derived: true },
  wingChord: { label: 'wing root chord / length (set by preset)', default: 0.24, min: 0.1, max: 0.7, step: 0.01, when: p => p.type !== 'helicopter', derived: true },
  wingTaper: { label: 'wing tip taper (set by preset)', default: 0.46, min: 0.1, max: 1, step: 0.02, when: p => p.type !== 'helicopter', derived: true },
  wingSweep: { label: 'wing sweep ratio (set by preset)', default: 0.12, min: -0.45, max: 0.8, step: 0.02, fullRange: true, when: p => p.type !== 'helicopter', derived: true },
  wingPosition: { label: 'wing position (set by preset)', default: 0, min: -0.12, max: 0.2, step: 0.01, fullRange: true, when: p => p.type !== 'helicopter', derived: true },
  wingLevel: { label: 'wing level (set by preset)', default: 'low', choices: { low: 'low wing', mid: 'mid wing', high: 'high wing' }, when: p => !['biplane', 'helicopter'].includes(p.type), derived: true },
  dihedral: { label: 'wing dihedral', default: 4, min: -5, max: 18, step: 1, when: p => p.type !== 'helicopter' },
  engines: { label: 'engine count (set by preset)', default: 1, min: 1, max: 4, step: 1, when: p => !['glider', 'helicopter'].includes(p.type), derived: true },
  engineMount: { label: 'engine mount (set by preset)', default: 'wing', choices: { wing: 'under wing', rear: 'rear fuselage' }, when: p => p.type === 'jet', derived: true },
  tail: { label: 'tail layout (set by preset)', default: 'standard', choices: { standard: 'standard', t: 't-tail', twin: 'twin fins', v: 'v-tail', none: 'no stabiliser' }, when: p => !['flyingwing', 'helicopter'].includes(p.type), derived: true },
  tailSpan: { label: 'tail span / wingspan (set by preset)', default: 0.3, min: 0.15, max: 0.5, step: 0.02, when: p => p.type !== 'flyingwing', derived: true },
  tailHeight: { label: 'fin height multiplier (set by preset)', default: 1.15, min: 0.6, max: 2.2, step: 0.05, when: p => p.type !== 'flyingwing', derived: true },
  landingGear: { label: 'landing gear (set by preset)', default: 'wheels', choices: { wheels: 'wheels', floats: 'floats', skids: 'skids', retracted: 'retracted' }, derived: true },
  propellerBlades: { label: 'propeller blades (set by preset)', default: 3, min: 2, max: 5, step: 1, when: p => ['propeller', 'biplane'].includes(p.type), derived: true },
  rotorBlades: { label: 'rotor blades (set by preset)', default: 4, min: 2, max: 6, step: 1, when: p => p.type === 'helicopter', derived: true },
  canards: { label: 'canards (set by preset)', default: false, when: p => !['helicopter', 'flyingwing'].includes(p.type), derived: true },
  finCant: { group: 'fighters and stores', label: 'twin fin cant (set by preset)', default: 0, min: 0, max: 35, step: 1, when: p => p.tail === 'twin', derived: true },
  cannon: { group: 'fighters and stores', label: 'cannon (set by preset)', default: false, randomize: false, derived: true },
  weaponPairs: { group: 'fighters and stores', label: 'weapon pairs (set by preset)', default: 0, min: 0, max: 3, step: 1, randomize: false, derived: true },
  ...AIRCRAFT_MOTION_SCHEMA,
});

// Locked proportions: nose length, cockpit rise, engine and weapon size.
const NOSE = 0.17, CABIN_RISE = 0.06, ENGINE_SCALE = 1, WEAPON_SCALE = 1;

const PALETTE = { body: '#e0e5d4', wing: '#ccd5c6', window: '#345368', accent: '#6ca699', engine: '#657e83', wheel: '#3e4c53', propeller: '#b77f5d' };
const PALETTES = [PALETTE,
  { ...PALETTE, body: '#e8d2ad', wing: '#d2b37f', accent: '#a9755d' },
  { ...PALETTE, body: '#9ab6af', wing: '#c6d4c5', accent: '#dfb06d' },
  { ...PALETTE, body: '#a2b1c3', wing: '#ccd5d8', accent: '#be896c' },
  { ...PALETTE, body: '#c78063', wing: '#eadabd', accent: '#537b74' },
];
export const normalizeSimpleAircraftOptions = (options = {}) => {
  if (options.preset === undefined) return normalizeFactoryOptions(options, SIMPLE_AIRCRAFT_PRESETS, SIMPLE_AIRCRAFT_SCHEMA, PALETTE);
  const preset = choiceOption(options.preset, Object.keys(SIMPLE_AIRCRAFT_PRESETS)[0], Object.keys(SIMPLE_AIRCRAFT_PRESETS), 'preset');
  const base = normalizeFactoryOptions({ preset }, SIMPLE_AIRCRAFT_PRESETS, SIMPLE_AIRCRAFT_SCHEMA, PALETTE);
  const locked = Object.fromEntries(SIMPLE_AIRCRAFT_PRESET_LOCKED_FIELDS.map(key => [key, base[key]]));
  return normalizeFactoryOptions({ ...options, ...locked, preset }, SIMPLE_AIRCRAFT_PRESETS, SIMPLE_AIRCRAFT_SCHEMA, PALETTE);
};
export const randomSimpleAircraftOptions = (seed = 1, overrides = {}) =>
  randomFactoryOptions(seed, overrides, SIMPLE_AIRCRAFT_PRESETS, SIMPLE_AIRCRAFT_SCHEMA,
    PALETTES, normalizeSimpleAircraftOptions);

/** Simplified aircraft. +Y up, nose toward -Z, neutral pose parked on the ground. */
export function buildSimpleAircraftVisual(options = {}) {
  const p = normalizeSimpleAircraftOptions(options), c = p.colors;
  const kit = createPrimitiveKit(), mesh = new Group();
  mesh.name = `simple-aircraft-${p.preset}`;
  const l = p.length, w = p.width, span = Math.max(p.wingspan, w * 1.8), heli = p.type === 'helicopter';
  const fuselage = kit.group(mesh, 'airframe', [0, w * 1.1, 0]);
  const rotors = [], surfaces = [], gear = [], cannons = [], missiles = [];
  const bodyL = heli ? l * 0.55 : l * 0.7, bodyZ = heli ? -l * 0.18 : 0;
  if (p.bodyStyle === 'round') {
    const body = kit.cylinder(fuselage, 'fuselage', w / 2, bodyL, [0, 0, bodyZ], c.body);
    body.rotation.x = Math.PI / 2;
  } else kit.box(fuselage, 'fuselage', [w, w * (p.bodyStyle === 'tapered' ? 0.65 : 0.9), bodyL], [0, 0, bodyZ], c.body);
  kit.nose(fuselage, 'nose', [w, w * 0.9, l * NOSE],
    [0, 0, bodyZ - bodyL / 2 - l * NOSE / 2 + 0.08], c.body, 0.22, 0.45);
  const tailBody = kit.nose(fuselage, 'tail-cone', [w, w * 0.85, l * (heli ? 0.5 : 0.23)],
    [0, 0, heli ? l * 0.31 : l * 0.41], c.body, 0.12, 0.18);
  tailBody.rotation.y = Math.PI;
  kit.box(fuselage, 'cockpit', [w * 0.7, w * (0.4 + CABIN_RISE), l * 0.16],
    [0, w * (0.25 + CABIN_RISE), bodyZ - bodyL * 0.36], c.window);

  function wingPair(parent, name, wingSpan, chord, y, z, sweep = p.wingSweep, taper = p.wingTaper, angle = p.dihedral) {
    const half = wingSpan / 2, root = Math.min(w * 0.32, half * 0.3), tipZ = half * sweep;
    for (const side of [-1, 1]) {
      const pivot = kit.group(parent, name, [0, y, z]);
      pivot.rotation.z = side * angle * Math.PI / 180;
      const point = (t, q) => [side * (root + (half - root) * t), tipZ * t + chord * (1 - (1 - taper) * t) * (q - 0.5)];
      const thickness = Math.max(0.055, w * 0.055);
      kit.slab(pivot, 'wing-panel', [point(0, 0), point(1, 0), point(1, 0.71), point(0, 0.71)], thickness, [0, 0, 0], c.wing);
      // Local +X follows the hinge outwards, so each side keeps its own control surface.
      function control(kind, from, to) {
        const a = point(from, 0.73), b = point(to, 0.73), theta = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const axis = kit.group(pivot, `${kind}-hinge`, [a[0], 0, a[1]]); axis.rotation.y = -theta;
        const hinge = kit.group(axis, kind);
        const local = ([x, z]) => [(x - a[0]) * Math.cos(theta) + (z - a[1]) * Math.sin(theta),
          -(x - a[0]) * Math.sin(theta) + (z - a[1]) * Math.cos(theta)];
        kit.slab(hinge, `${kind}-panel`, [a, b, point(to, 1), point(from, 1)].map(local),
          thickness * 0.85, [0, 0, 0], c.accent);
        surfaces.push({ root: hinge, kind, side });
      }
      if (['main-wing', 'upper-wing'].includes(name)) {
        const mixed = p.type === 'flyingwing' || p.tail === 'none';
        control(mixed ? 'elevon' : 'flap', 0.015, 0.52);
        control(mixed ? 'elevon' : 'aileron', 0.54, 0.99);
      } else control(name === 'canard' ? 'canard' : name === 'v-tail' ? 'rudderv' : 'elevator', 0.015, 0.99);
    }
  }
  const wingY = p.wingLevel === 'high' ? w * 0.5 : p.wingLevel === 'mid' ? 0 : -w * 0.3;
  const wingZ = l * p.wingPosition, chord = l * p.wingChord;
  if (!heli) {
    wingPair(fuselage, 'main-wing', span, chord, p.type === 'biplane' ? -w * 0.3 : wingY, wingZ);
    if (p.type === 'biplane') wingPair(fuselage, 'upper-wing', span * 0.97, chord, w * 1.05, wingZ - l * 0.035);
    if (p.canards && p.type !== 'flyingwing') wingPair(fuselage, 'canard', span * 0.3, chord * 0.32, 0, -l * 0.32, 0.12, 0.5, 0);
  }
  const finH = w * p.tailHeight, tailZ = heli ? l * 0.49 : l * 0.45;
  function fin(x, y, side = 0) {
    const root = kit.group(fuselage, 'vertical-tail', [x, y, tailZ]);
    root.rotation.z = -side * p.finCant * Math.PI / 180;
    const finChord = l * 0.16;
    const fixed = kit.prism(root, 'tail-fin', [[0.5, 0], [-0.12, 0], [-0.12, 1], [0.2, 1]],
      [finChord, finH, w * 0.07], [0, 0, 0], c.wing);
    fixed.rotation.y = Math.PI / 2;
    const rudder = kit.group(root, 'rudder', [0, 0, finChord * 0.14]);
    const panel = kit.prism(rudder, 'rudder-panel', [[0, 0], [-0.36, 0], [-0.14, 1], [0, 1]],
      [finChord, finH, w * 0.06], [0, 0, 0], c.accent);
    panel.rotation.y = Math.PI / 2;
    surfaces.push({ root: rudder, kind: 'rudder', side });
  }
  if (p.type !== 'flyingwing') {
    if (p.tail === 'v' && !heli) wingPair(fuselage, 'v-tail', span * p.tailSpan, l * 0.12, w * 0.15, tailZ, 0.25, 0.4, 40);
    else {
      if (p.tail === 'twin' && !heli) for (const side of [-1, 1]) fin(side * span * p.tailSpan * 0.32, 0, side);
      else fin(0, 0);
      if (p.tail !== 'none' || heli) wingPair(fuselage, 'horizontal-tail', span * p.tailSpan, l * 0.12,
        p.tail === 't' && !heli ? finH * 0.86 : 0, tailZ, 0.2, 0.55, 0);
    }
  }
  function propeller(parent, radius, position, blades, axis = 'z') {
    const root = kit.group(parent, 'propeller', position);
    if (axis === 'y') root.rotation.x = Math.PI / 2;
    else if (axis === 'x') root.rotation.y = Math.PI / 2;
    const spin = kit.group(root, 'rotor-spin');
    for (let i = 0; i < blades; i++) {
      const blade = kit.group(spin, 'blade-root'); blade.rotation.z = i * Math.PI * 2 / blades;
      kit.box(blade, 'blade', [Math.max(0.07, radius * 0.12), radius, 0.06], [0, radius / 2, 0], c.propeller);
    }
    rotors.push(spin);
  }
  if (heli) {
    kit.cylinder(fuselage, 'rotor-mast', w * 0.08, w * 0.9, [0, w * 0.7, -l * 0.12], c.engine);
    propeller(fuselage, span / 2, [0, w * 1.13, -l * 0.12], p.rotorBlades, 'y');
    propeller(fuselage, w * 0.6, [w * 0.13, w * 0.4, l * 0.49], 3, 'x');
  } else if (p.type !== 'glider') {
    const prop = ['propeller', 'biplane'].includes(p.type);
    for (let i = 0; i < p.engines; i++) {
      const center = p.engines % 2 === 1 && i === p.engines - 1;
      const side = i % 2 ? 1 : -1, pair = Math.floor(i / 2);
      const rear = !prop && p.engineMount === 'rear';
      const x = center ? 0 : rear ? side * w * 0.72 : side * Math.max(w * 0.78, span * (0.18 + pair * 0.14));
      const engineR = w * 0.23 * ENGINE_SCALE;
      const z = center ? (prop ? -l * (0.35 + NOSE) : l * 0.43)
        : rear ? l * 0.3 : wingZ + Math.abs(x) * p.wingSweep - chord * 0.28;
      const y = center ? 0 : rear ? 0 : wingY - engineR * 1.35;
      const engineL = Math.min(l * 0.19, w * 1.8);
      const engine = kit.cylinder(fuselage, 'engine-nacelle', engineR, engineL, [x, y, z], c.engine);
      engine.rotation.x = Math.PI / 2;
      if (prop) propeller(fuselage, w * 0.75 * ENGINE_SCALE, [x, y, z - engineL / 2 - 0.08], p.propellerBlades);
    }
  }
  if (p.landingGear === 'floats' || p.landingGear === 'skids') for (const side of [-1, 1]) {
    const float = p.landingGear === 'floats', x = side * w * 0.65;
    for (const end of [-1, 1]) kit.beam(fuselage, 'gear-support',
      [side * w * 0.3, -w * 0.25, end * bodyL * 0.25], [x, -w, end * bodyL * 0.25], w * 0.065, c.engine);
    if (float) kit.box(fuselage, 'float', [w * 0.4, w * 0.28, l * 0.62], [x, -w, -l * 0.05], c.wing);
    else kit.box(fuselage, 'skid', [w * 0.1, w * 0.1, bodyL * 1.2], [x, -w, bodyZ], c.engine);
  } else {
    for (const [x, z] of [[0, -l * 0.29], [-w * 0.65, l * 0.12], [w * 0.65, l * 0.12]]) {
      const radius = w * 0.18, side = Math.sign(x) || 1;
      const root = kit.group(fuselage, 'landing-gear', [x * 0.6, -w * 0.3, z]);
      const fold = kit.group(root, 'gear-fold');
      kit.beam(fold, 'landing-strut', [0, 0, 0], [x * 0.4, -w * 0.62, 0], w * 0.07, c.engine);
      const wheel = kit.group(fold, 'gear-wheel-spin', [x * 0.4, -w * 0.62, 0]);
      const tire = kit.cylinder(wheel, 'landing-wheel', radius, w * 0.14, [0, 0, 0], c.wheel);
      tire.rotation.z = Math.PI / 2;
      kit.box(wheel, 'landing-spoke', [w * 0.16, radius * 1.2, radius * 0.16], [0, 0, 0], c.accent);
      // Gear bay doors are dropped; the motion controller still gets a node to swing.
      const door = kit.group(root, 'gear-door');
      gear.push({ root, fold, wheel, radius, door, side });
    }
  }
  if (p.cannon) {
    const barrel = kit.group(fuselage, 'cannon', [w * 0.4, -w * 0.25, -l * 0.27]);
    const barrelL = l * 0.11 * WEAPON_SCALE;
    const tube = kit.cylinder(barrel, 'cannon-barrel', w * 0.045 * WEAPON_SCALE, barrelL, [0, 0, -barrelL / 2], c.engine);
    tube.rotation.x = Math.PI / 2;
    const muzzle = kit.group(barrel, 'cannon-muzzle', [0, 0, -barrelL]);
    const flash = kit.nose(muzzle, 'muzzle-flash', [w * 0.2, w * 0.2, l * 0.045], [0, 0, -l * 0.0225], '#edc779', 0.15, 0.15);
    const tracer = kit.box(muzzle, 'cannon-tracer', [w * 0.035, w * 0.035, l * 0.07], [0, 0, -l * 0.06], '#edc779');
    flash.visible = tracer.visible = false;
    cannons.push({ barrel, muzzle, flash, tracer });
  }
  for (let pair = 0; pair < p.weaponPairs; pair++) for (const side of [-1, 1]) {
    const x = side * Math.max(w * 0.85, span * (0.18 + pair * 0.09));
    const y = (heli ? -w * 0.2 : wingY + Math.sin(p.dihedral * Math.PI / 180) * Math.abs(x)) - w * 0.42;
    const mount = kit.group(fuselage, 'weapon-hardpoint', [x, y, heli ? 0 : wingZ + Math.abs(x) * p.wingSweep]);
    kit.box(mount, 'weapon-pylon', [w * 0.09, w * 0.4, l * 0.065], [0, w * 0.2, 0], c.engine);
    const projectile = kit.group(mount, 'missile');
    const missileL = l * 0.13 * WEAPON_SCALE, radius = w * 0.065 * WEAPON_SCALE;
    const body = kit.cylinder(projectile, 'missile-body', radius, missileL, [0, 0, 0], c.wing);
    body.rotation.x = Math.PI / 2;
    kit.nose(projectile, 'missile-nose', [radius * 2, radius * 2, missileL * 0.3], [0, 0, -missileL * 0.65], c.accent, 0.05, 0.05);
    const exhaust = kit.nose(projectile, 'missile-exhaust', [radius * 2, radius * 2, missileL * 0.4],
      [0, 0, missileL * 0.7], '#edc779', 0.1, 0.1);
    exhaust.rotation.y = Math.PI; exhaust.visible = false;
    missiles.push({ mount, projectile, exhaust });
  }
  const api = finishVisual(kit, mesh, p, { rotors });
  for (const unit of gear) unit.root.visible = p.landingGear !== 'retracted';
  fuselage.position.y -= visibleTransportBounds(mesh).min.y;
  installAircraftMotion(api, kit, { fuselage, rotors, surfaces, gear, cannons, missiles });
  api.bounds.copy(api.getPoseBounds()); api.bounds.getSize(api.dimensions);
  return api;
}

// Compatibility exports: the simplified factory replaces the original under
// this module's historical name, and keeps the original consumer surface.
export { AIRCRAFT_MOTIONS };
export { SIMPLE_AIRCRAFT_PRESETS as AIRCRAFT_PRESETS };
export { SIMPLE_AIRCRAFT_PRESET_LOCKED_FIELDS as AIRCRAFT_PRESET_LOCKED_FIELDS };
export { SIMPLE_AIRCRAFT_SCHEMA as AIRCRAFT_SCHEMA };
export { normalizeSimpleAircraftOptions as normalizeAircraftOptions };
export { randomSimpleAircraftOptions as randomAircraftOptions };
export { buildSimpleAircraftVisual as createAircraftVisual, buildSimpleAircraftVisual as buildAircraftVisual };