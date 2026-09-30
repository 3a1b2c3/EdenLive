import * as THREE from 'three';
import { ArcadeCarMotionController } from '/assets/actor-motion/ground-vehicle/ArcadeCarMotionController.js';
import { collideMovement } from '/assets/world/environment/PlanarObstacleCollision.js';
import { RoundRules, snapshotRules } from './gameRules.mjs';

// One widely separated hue per profession, shared by the character body
// (tuning.mjs) and its ground ring so a pedestrian and its marker read as
// the same entity.
export const PROFESSIONS = [
  { id: 'mage', name: 'Mage', color: '#a000ff' },
  { id: 'warrior', name: 'Warrior', color: '#ff2000' },
  { id: 'nurse', name: 'Nurse', color: '#00d8d8' },
  { id: 'firefighter', name: 'Firefighter', color: '#ff8000' },
  { id: 'police', name: 'Police', color: '#0060ff' },
  { id: 'worker', name: 'Worker', color: '#00c000' },
];
export const WORLD_LIMIT = 48;
export const BLOCKS = [];
for (const x of [-37, -14, 14, 37]) for (const z of [-37, -14, 14, 37]) {
  BLOCKS.push({ x, z, w: Math.abs(x) === 37 ? 12 : 13, d: Math.abs(z) === 37 ? 12 : 13,
    h: 5 + ((BLOCKS.length * 7) % 4) * 1.25, index: BLOCKS.length });
}
export const WALLS = [
  ...BLOCKS,
  { x: -49, z: 0, w: 2, d: 100, h: 2 }, { x: 49, z: 0, w: 2, d: 100, h: 2 },
  { x: 0, z: -49, w: 100, d: 2, h: 2 }, { x: 0, z: 49, w: 100, d: 2, h: 2 },
];
const SPAWNS = [
  [0, 18, 0], [0.2, -8, 1], [-0.3, -31, 2],
  [7, 27, 3], [-8, 27, 0], [18, 0, 4], [-19, 0, 5],
  [27, 19, 2], [27, -5, 3], [27, -29, 0], [-27, 17, 1], [-27, -7, 2], [-27, -30, 3],
  [13, -27, 4], [-14, -27, 5], [34, 27, 1], [-37, 27, 2], [37, 0, 3], [-38, 0, 0],
  [9, 0, 2], [-9, 0, 3], [5, 41, 5], [-5, -42, 4], [27, 40, 4],
];

function collider(b) {
  return { bounds: new THREE.Box3(new THREE.Vector3(-b.w / 2, 0, -b.d / 2), new THREE.Vector3(b.w / 2, b.h, b.d / 2)),
    matrix: new THREE.Matrix4().makeTranslation(b.x, 0, b.z), inverse: new THREE.Matrix4().makeTranslation(-b.x, 0, -b.z) };
}

export class Simulation {
  constructor() {
    this.rules = new RoundRules();
    // Top speed is the translation rate of the control signal (the camera is a
    // fixed-orientation chase view) and, with the camera moved closer in
    // main.js, it carries the whole budget: the visible strip is 35 m, so
    // 23 m/s cycled it in 1.5 s while 7 m/s takes 4.9 s and holds near-ground
    // parallax near 0.8 deg per presented frame. Still well above the 3 m/s a
    // launch needs, so pedestrian hits play out the same way.
    this.car = new ArcadeCarMotionController({ maxForwardSpeed: 7, maxReverseSpeed: 4.8, throttleAccel: 6,
      reverseAccel: 6.4, engineBrake: 0.65, steerAngleMax: 0.66, wheelBase: 3.15, rideHeight: 0.04, boostMultiplier: 1.4 });
    this.colliders = WALLS.map(collider);
    this.reset(false);
  }
  reset(newRound = true) {
    if (newRound) this.rules.reset();
    this.car.reset(new THREE.Vector3(0, 0.04, 35), 0);
    this.people = SPAWNS.map(([x, z, role], i) => ({ id: `ped-${i}`, role, x, z, homeX: x, homeZ: z,
      phase: 'WALKING', hits: 0, dead: false, height: 0, vx: 0, vz: 0, vy: 0, timer: 0, yaw: i * 1.7,
      moved: 0, spin: 0, walkTime: 0 }));
    this.paused = false;
    // READY: the coupe idles on its start line until the first drive key, so the
    // model frame rate settles before play. RoundRules stays RUNNING underneath.
    this.ready = true;
    this.distance = 0;
    this.moved = false;
    this.turned = false;
    this.impactCooldown = 0;
    this.lastEvents = [];
    this.speed = 0;
    this.braking = false;
    this.boosting = false;
    this.lastCrash = null;
  }
  step(dt, input) {
    this.lastEvents = [];
    if (this.paused || this.rules.isResolved || dt <= 0) return [];
    if (this.ready) {
      if (!(input.throttle || input.reverse || input.left || input.right)) return [];
      this.ready = false;
      this.lastEvents = [this.rules._emit('round.started')];
      return this.lastEvents;
    }
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);
    this.braking = input.brake;
    this.boosting = input.boost && input.throttle;
    if (input.brake) this.car.velocity.multiplyScalar(Math.exp(-8 * dt));
    const intent = this.car.planMovement({ ...input, throttle: input.brake ? 0 : input.throttle,
      reverse: input.brake ? 0 : input.reverse, deltaSeconds: dt });
    const desiredPosition = intent.position.clone();
    const incoming = intent.velocity.clone();
    // A three-circle capsule follows the actual long, narrow car footprint.
    // The shared resolver sweeps each circle, including thin boundary walls.
    for (let pass = 0; pass < 2; pass++) for (const offset of [-1.12, 0, 1.12]) {
      const shift = new THREE.Vector3(-Math.sin(intent.yaw) * offset, 0, -Math.cos(intent.yaw) * offset);
      const sub = { startPosition: intent.startPosition.clone().add(shift), position: intent.position.clone().add(shift),
        desiredDelta: intent.position.clone().sub(intent.startPosition), velocity: incoming.clone(), deltaSeconds: dt };
      collideMovement(sub, this.colliders, 1.06, 1.5);
      intent.position.copy(sub.position).sub(shift);
    }
    const correction = intent.position.clone().sub(desiredPosition);
    const touching = correction.lengthSq() > 1e-7;
    if (touching) {
      const normal = correction.clone().normalize();
      const impact = -incoming.dot(normal);
      if (impact > 0) intent.velocity.copy(incoming).addScaledVector(normal, impact * 1.4);
      if (impact >= 3 && this.impactCooldown <= 0) {
        this.rules.wallDamage(20);
        this.impactCooldown = 0.9;
        this.lastCrash = { x: this.car.position.x - normal.x * 2, z: this.car.position.z - normal.z * 2 };
      }
    }
    const travel = intent.position.distanceTo(intent.startPosition);
    this.car.commitMovement(intent);
    const signed = this.car.velocity.dot(this.car.bodyFrame.forward);
    this.distance += travel * (Math.sign(signed) || 1);
    this.speed = signed;
    this.moved ||= this.car.position.distanceTo(new THREE.Vector3(0, 0.04, 35)) > 0.25;
    this.turned ||= Math.abs(this.car.yaw) > 0.04;

    for (const p of this.people) {
      if (p.phase === 'AIRBORNE') {
        p.vy -= 16 * dt;
        p.height += p.vy * dt;
        this.movePerson(p, p.vx * dt, p.vz * dt);
        p.vx *= Math.exp(-0.8 * dt); p.vz *= Math.exp(-0.8 * dt);
        p.spin += dt * 7;
        if (p.height <= 0) {
          p.height = 0; p.timer = p.dead ? 0 : 0.8;
          p.phase = p.dead ? 'DEAD' : 'RECOVERING';
          p.homeX = p.x; p.homeZ = p.z;
        }
      } else if (p.phase === 'RECOVERING') {
        p.timer -= dt;
        if (p.timer <= 0) p.phase = 'WALKING';
      } else if (p.phase === 'WALKING') {
        p.walkTime += dt;
        const dx = Math.sin(p.walkTime * 0.65 + Number(p.id.slice(4))) * dt * 0.32;
        this.movePerson(p, dx, Math.cos(p.walkTime * 0.5) * dt * 0.15);
        p.yaw = -Math.atan2(dx, 0.15 * dt);
        p.moved += Math.abs(dx);
      }
      if (p.phase !== 'WALKING' || p.dead || Math.abs(signed) < 3) continue;
      const dx = p.x - this.car.position.x, dz = p.z - this.car.position.z;
      const along = -dx * Math.sin(this.car.yaw) - dz * Math.cos(this.car.yaw);
      const lateral = dx * Math.cos(this.car.yaw) - dz * Math.sin(this.car.yaw);
      if (Math.hypot(lateral, Math.max(0, Math.abs(along) - 1.18)) > 1.58) continue;
      this.rules.hit(p.id);
      p.phase = 'AIRBORNE';
      p.height = 0.15; p.vy = 6.8; p.spin = 0;
      const direction = this.car.velocity.clone().normalize();
      p.vx = direction.x * 7; p.vz = direction.z * 7;
      p.yaw = this.car.yaw;
    }
    this.lastEvents = this.rules.step(dt);
    for (const event of this.lastEvents) if (event.type === 'ped.hit') {
      const p = this.people.find(person => person.id === event.personId);
      if (p) { p.hits = event.count; p.dead = event.count >= 2; }
    }
    if (this.rules.isResolved) { this.car.velocity.set(0, 0, 0); this.speed = 0; this.boosting = false; }
    return this.lastEvents;
  }
  movePerson(p, dx, dz) {
    const x = THREE.MathUtils.clamp(p.x + dx, -46.5, 46.5), z = THREE.MathUtils.clamp(p.z + dz, -46.5, 46.5);
    if (!BLOCKS.some(b => Math.abs(x - b.x) < b.w / 2 + 0.5 && Math.abs(z - b.z) < b.d / 2 + 0.5)) {
      p.x = x; p.z = z;
    }
  }
  read() {
    const rules = snapshotRules(this.rules);
    if (this.ready) rules.state = 'READY';
    return { ...rules, paused: this.paused,
      car: { x: this.car.position.x, z: this.car.position.z, yaw: this.car.yaw, speed: this.speed,
        moved: this.moved, turned: this.turned, moving: Math.abs(this.speed) > 0.2,
        direction: this.speed > 0.2 ? 'forward' : this.speed < -0.2 ? 'reverse' : 'stopped' },
      people: this.people.map(p => ({ id: p.id, role: PROFESSIONS[p.role].id, x: p.x, z: p.z, phase: p.phase, hits: p.hits, dead: p.dead, height: p.height })),
      airborne: this.people.filter(p => p.phase === 'AIRBORNE').length,
      alive: this.people.filter(p => !p.dead).length };
  }
}
