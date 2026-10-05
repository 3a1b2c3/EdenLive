import { freezeConfig } from './VisualFactoryUtils.js';
import { captureTransportPose, visibleTransportBounds, transportFrame, radians, clamp, smooth, finite, controlsObject } from './TransportMotionUtils.js';

export const AIRCRAFT_MOTIONS = freezeConfig({ still: 'still', fly: 'fly / rotor', bank: 'bank', pitch: 'pitch', yaw: 'yaw',
  controls: 'manual controls', gearUp: 'retract gear (once)', gearDown: 'lower gear (once)', fire: 'cannon burst (once)', launch: 'launch payload (once)' });
const number = (label, value, min, max, step = .1) => ({ group: 'flight demo', label, default: value, min, max, step, randomize: false });
export const AIRCRAFT_MOTION_SCHEMA = freezeConfig({
  surfaceAngle: number('max surface deflection (deg)', 26, 0, 45, 1),
  bankAngle: number('demo max bank (deg)', 24, 0, 60, 1),
  pitchAngle: number('demo max pitch (deg)', 12, 0, 35, 1),
  yawAngle: number('demo max yaw (deg)', 15, 0, 35, 1),
  maneuverPeriod: number('maneuver period (s)', 4, .5, 12),
  rotorSpeed: number('rotor speed multiplier', 1, 0, 3),
  gearDuration: number('gear travel duration (s)', 1.8, .3, 5),
  fireDuration: number('cannon burst duration (s)', .9, .3, 3),
  launchDuration: number('launch duration (s)', 1.5, .5, 4),
  launchDistance: number('launch distance / length', .65, .2, 1.5),
});

export function installAircraftMotion(api, kit, { fuselage, rotors, surfaces, gear, cannons, missiles }) {
  const p = api.params, neutral = captureTransportPose(fuselage);
  const initialGear = p.landingGear === 'retracted' ? 0 : 1;
  const motions = { ...AIRCRAFT_MOTIONS };
  if (!gear.length) { delete motions.gearUp; delete motions.gearDown; }
  if (!cannons.length) delete motions.fire;
  if (!missiles.length) delete motions.launch;
  api.motions = freezeConfig(motions);
  api.actions = freezeConfig(Object.fromEntries(['gearUp', 'gearDown', 'fire', 'launch'].filter(id => motions[id]).map(id =>
    [id, { label: motions[id], loop: false, duration: p[id.startsWith('gear') ? 'gearDuration' : `${id}Duration`] }])));
  api.rig = { fuselage, surfaces, gear, cannons, missiles };
  api.attachments = { muzzles: cannons.map(c => c.muzzle), hardpoints: missiles.map(m => m.mount) };
  api.getWeaponFrames = () => {
    kit.assertLive();
    return [...cannons.map((c, i) => ({ id: `cannon-${i}`, kind: 'cannon', node: c.muzzle })),
      ...missiles.map((m, i) => ({ id: `hardpoint-${i}`, kind: 'missile', node: m.mount }))]
      .map(({ node, ...info }) => ({ ...info, ...transportFrame(node) }));
  };
  api.getPoseBounds = () => { kit.assertLive(); return visibleTransportBounds(api.mesh); };
  let state;
  Object.defineProperty(api, 'actionState', { enumerable: true, get: () => ({ ...state }) });
  api.setFlightPose = (seconds = 0, controls = {}) => {
    kit.assertLive(); finite(seconds, 'seconds'); controlsObject(controls);
    const roll = clamp(finite(controls.roll ?? 0, 'roll'), -1, 1), pitch = clamp(finite(controls.pitch ?? 0, 'pitch'), -1, 1);
    const yaw = clamp(finite(controls.yaw ?? 0, 'yaw'), -1, 1), flaps = clamp(finite(controls.flaps ?? 0, 'flaps'));
    const extension = clamp(finite(controls.gear ?? initialGear, 'gear'));
    const distance = finite(controls.distance ?? 0, 'distance');
    const engine = clamp(finite(controls.engine ?? 1, 'engine'), 0, 3);
    neutral.restore();
    fuselage.rotation.set(radians(p.pitchAngle) * pitch, -radians(p.yawAngle) * yaw, -radians(p.bankAngle) * roll);
    rotors.forEach((rotor, i) => { rotor.rotation.z = seconds * (p.type === 'helicopter' ? 16 : 24) * p.rotorSpeed * engine * (i % 2 ? -1 : 1); });
    for (const surface of surfaces) {
      const { root, kind, side } = surface;
      let input = kind === 'aileron' ? -side * roll : kind === 'flap' ? flaps
        : kind === 'elevon' ? -pitch - side * roll : kind === 'rudderv' ? -pitch + side * yaw
          : kind === 'canard' ? pitch : -pitch;
      if (kind === 'rudder') root.rotation.y = radians(p.surfaceAngle) * yaw;
      else root.rotation.x = side * radians(p.surfaceAngle) * clamp(input, -1, 1);
    }
    for (const unit of gear) {
      unit.fold.rotation.x = (1 - extension) * Math.PI / 2;
      unit.root.visible = extension > .015;
      unit.wheel.rotation.x = -distance / unit.radius;
      // Doors open during the travel and close at either endpoint.
      unit.door.rotation.z = unit.side * Math.sin(Math.PI * extension) * 1.3;
    }
    state = { id: 'controls', roll, pitch, yaw, flaps, gear: gear.length ? extension : null, progress: 0, active: false, finished: false, phase: 'loop' };
    api.mesh.updateMatrixWorld(true);
    return api;
  };
  api.setPose = (action = 'fly', seconds = 0, controls = {}) => {
    kit.assertLive();
    if (typeof action === 'number') { seconds = action; action = 'fly'; }
    if (!Object.hasOwn(motions, action)) throw new RangeError(`unavailable aircraft motion: ${action}`);
    finite(seconds, 'seconds'); controlsObject(controls);
    const wave = Math.sin(seconds * Math.PI * 2 / p.maneuverPeriod), spec = api.actions[action];
    const progress = spec ? clamp(seconds / spec.duration) : 0;
    const pose = { ...controls };
    if (action === 'bank') pose.roll = wave;
    if (action === 'pitch') pose.pitch = wave;
    if (action === 'yaw') pose.yaw = wave;
    if (action === 'gearUp' || action === 'gearDown') pose.gear = action === 'gearUp' ? 1 - smooth(progress) : smooth(progress);
    if (action === 'still') pose.engine = 0;
    api.setFlightPose(action === 'still' ? 0 : spec ? clamp(seconds, 0, spec.duration) : seconds, pose);
    let active = false;
    if (action === 'fire') {
      const firing = progress >= .12 && progress < .82;
      const pulse = ((progress - .12) / .7 * 4) % 1;
      active = firing;
      for (const cannon of cannons) {
        cannon.barrel.position.z += firing ? Math.max(0, 1 - pulse * 4) * p.width * .07 : 0;
        cannon.flash.visible = firing && pulse < .36;
        cannon.tracer.visible = firing && pulse < .75;
        cannon.tracer.position.z = -p.length * (.04 + Math.max(0, pulse) * .28);
      }
    }
    if (action === 'launch') missiles.forEach((missile, i) => {
      const start = .12 + i / missiles.length * .3, flight = clamp((progress - start) / .45);
      missile.projectile.position.z -= flight * p.length * p.launchDistance;
      missile.projectile.position.y -= Math.sin(flight * Math.PI) * p.width * .12;
      missile.projectile.visible = flight < 1;
      missile.exhaust.visible = flight > 0 && flight < 1;
      active ||= flight > 0 && flight < 1;
    });
    state = { ...state, id: action, progress, active, finished: Boolean(spec && progress >= 1),
      phase: action === 'still' ? 'still' : !spec ? 'loop' : progress >= 1 ? 'finished' : action.startsWith('gear') ? 'moving' : active ? 'active' : 'ready' };
    api.mesh.updateMatrixWorld(true);
    return api;
  };
  api.reset = () => api.setPose('still', 0);
  return api.reset();
}