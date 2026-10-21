// One gameplay owner for the browser and the checkers: arcade taxi driving, collisions, checkpoints,
// health, the race clock, outcomes and restart. Visuals only read `view()`; observers read `read()`.
import { ArcadeCarMotionController } from '/assets/actor-motion/ground-vehicle/ArcadeCarMotionController.js';
import { ObjectiveTracker, OBJECTIVE_SHAPES } from '/assets/gameplay/ObjectiveTracker.js';
import { ResourcePool } from '/assets/gameplay/ResourcePool.js';
import { RoundClock } from '/assets/gameplay/RoundClock.js';
import { RoundDirector, ROUND_EVENTS, ROUND_STATES } from '/assets/gameplay/RoundDirector.js';
import { CHECKPOINT_ZS, FINISH_Z, ROADBLOCKS, START } from './layout.mjs';

export const TUNING = Object.freeze({
  car: {
    maxForwardSpeed: 38, maxReverseSpeed: 10, throttleAccel: 27, reverseAccel: 30, engineBrake: 0.75,
    steerLag: 0.09, steerAngleMax: 0.11, wheelBase: 5, rideHeight: 0, boostMultiplier: 1,
  },
  handbrakeDecay: 3.2,
  bodyRadius: 1.05,
  bodyReach: 1.25,
  boundaryX: 12.6,
  boundaryDrag: 0.96,
  hitSlowdown: 0.3,
  hitCooldownSeconds: 0.8,
  damage: { roadblock: 20, traffic: 15, parked: 10 },
  health: 100,
  startSeconds: 32,
  checkpointBonusSeconds: 6,
  trafficStopZ: FINISH_Z - 60,
  eventRing: 48,
});

const CHECKPOINT_COUNT = CHECKPOINT_ZS.length;

function roadblockBoxes() {
  return ROADBLOCKS.map(b => ({
    id: b.id, kind: 'roadblock',
    minX: b.x - b.width / 2, maxX: b.x + b.width / 2, minZ: b.z - b.depth / 2, maxZ: b.z + b.depth / 2,
  }));
}

// Closest-point test of a circle against a box. Returns the push-out normal and depth, or null.
function circleVsBox(cx, cz, radius, box) {
  const qx = Math.min(Math.max(cx, box.minX), box.maxX);
  const qz = Math.min(Math.max(cz, box.minZ), box.maxZ);
  let dx = cx - qx;
  let dz = cz - qz;
  const dist = Math.hypot(dx, dz);
  if (dist >= radius) return null;
  if (dist > 1e-6) return { nx: dx / dist, nz: dz / dist, depth: radius - dist };
  // Center inside the box: leave through the nearest face.
  const exits = [
    { nx: -1, nz: 0, depth: cx - box.minX + radius }, { nx: 1, nz: 0, depth: box.maxX - cx + radius },
    { nx: 0, nz: -1, depth: cz - box.minZ + radius }, { nx: 0, nz: 1, depth: box.maxZ - cz + radius },
  ];
  return exits.reduce((best, e) => (e.depth < best.depth ? e : best));
}

export function createGame({ parkedBoxes = [], traffic = [] } = {}) {
  const car = new ArcadeCarMotionController(TUNING.car);
  const objective = new ObjectiveTracker({
    shape: OBJECTIVE_SHAPES.QUOTA, target: CHECKPOINT_COUNT, label: 'checkpoints',
    then: { shape: OBJECTIVE_SHAPES.REACH, target: 1, label: 'finish' },
  });
  const clock = new RoundClock({ limitSeconds: TUNING.startSeconds, warningSeconds: 10 });
  const health = new ResourcePool({ id: 'health', initial: TUNING.health, max: TUNING.health });
  const director = new RoundDirector({ objective, clock, resources: [health] });

  const staticBoxes = [
    ...roadblockBoxes(),
    ...parkedBoxes.map(p => ({ ...p, kind: 'parked' })),
  ];
  const trafficState = traffic.map(t => ({ id: t.id, x: t.x, startZ: t.startZ, speed: t.speed, halfX: t.halfX, halfZ: t.halfZ, z: t.startZ }));

  let roundId = 0;
  let nextEventId = 0;
  let events = [];
  let terminalCount = 0;
  let checkpointsPassed = 0;
  let hits = 0;
  let lastHit = null;
  let restartRequested = false;
  const cooldowns = new Map();

  function emit(type, detail = {}) {
    events.push({ id: `e${roundId}-${nextEventId++}`, type, elapsed: director.elapsedSeconds, ...detail });
    if (events.length > TUNING.eventRing) events = events.slice(-TUNING.eventRing);
  }

  function restart() {
    roundId += 1;
    nextEventId = 0;
    events = [];
    terminalCount = 0;
    checkpointsPassed = 0;
    hits = 0;
    lastHit = null;
    cooldowns.clear();
    restartRequested = false;
    car.reset({ x: START.x, y: 0, z: START.z }, 0);
    director.reset();
    clock.limitSeconds = TUNING.startSeconds;
    for (const t of trafficState) t.z = t.startZ;
    director.start();
    emit(ROUND_EVENTS.ROUND_STARTED);
  }

  function applyHit(box, kind, normal) {
    const id = box.id;
    const inContact = (cooldowns.get(id) ?? -Infinity) > director.elapsedSeconds;
    // The window renews while the bodies keep touching, so one contact costs one hit.
    cooldowns.set(id, director.elapsedSeconds + TUNING.hitCooldownSeconds);
    if (inContact) return null;
    const damage = TUNING.damage[kind];
    health.lose(damage);
    hits += 1;
    lastHit = { id, kind, damage, at: director.elapsedSeconds, nx: normal.nx, nz: normal.nz };
    emit('car.hit', { target: id, kind, damage, health: health.value });
    return damage;
  }

  // Resolve the planned move: push the body out of solids, scrape the boundary, register hits.
  function resolve(intent) {
    const position = intent.position.clone();
    const velocity = intent.velocity.clone();
    const frame = car.basis.yawPitchRollFrame(intent.yaw);
    const fx = frame.forward.x;
    const fz = frame.forward.z;
    const boxes = [...staticBoxes, ...trafficState.map(t => ({
      id: t.id, kind: 'traffic', minX: t.x - t.halfX, maxX: t.x + t.halfX, minZ: t.z - t.halfZ, maxZ: t.z + t.halfZ,
      vz: t.z > TUNING.trafficStopZ ? -t.speed : 0,
    }))];
    let collisions = 0;
    let slowed = false;
    for (const box of boxes) {
      for (const reach of [TUNING.bodyReach, -TUNING.bodyReach]) {
        const hit = circleVsBox(position.x + fx * reach, position.z + fz * reach, TUNING.bodyRadius, box);
        if (!hit) continue;
        position.x += hit.nx * hit.depth;
        position.z += hit.nz * hit.depth;
        collisions += 1;
        // Remove the closing speed against the solid (relative to a moving car) so the taxi cannot drive into it.
        const closing = velocity.x * hit.nx + (velocity.z - (box.vz ?? 0)) * hit.nz;
        if (closing < 0) {
          velocity.x -= closing * hit.nx;
          velocity.z -= closing * hit.nz;
        }
        if (applyHit(box, box.kind, hit) !== null) slowed = true;
      }
    }
    if (slowed) velocity.multiplyScalar(TUNING.hitSlowdown);
    if (Math.abs(position.x) > TUNING.boundaryX) {
      position.x = Math.sign(position.x) * TUNING.boundaryX;
      velocity.multiplyScalar(TUNING.boundaryDrag);
    }
    return { position, velocity, collisions };
  }

  function crossProgress(previousZ, currentZ) {
    if (checkpointsPassed < CHECKPOINT_COUNT) {
      const gateZ = CHECKPOINT_ZS[checkpointsPassed];
      if (previousZ > gateZ && currentZ <= gateZ) {
        checkpointsPassed += 1;
        objective.advance(1);
        clock.limitSeconds += TUNING.checkpointBonusSeconds;
        emit('checkpoint.passed', { index: checkpointsPassed, bonusSeconds: TUNING.checkpointBonusSeconds });
      }
    } else if (previousZ > FINISH_Z && currentZ <= FINISH_Z) {
      objective.noteReached();
      emit('finish.crossed', { elapsed: director.elapsedSeconds });
    }
  }

  restart();

  return {
    isActive: () => director.state === ROUND_STATES.RUNNING,

    // Edge inputs (restart) work in every state, including after a terminal outcome.
    handleInput(input) {
      const requested = restartRequested;
      restartRequested = false;
      if (input.consumePress('restart') || requested) restart();
    },

    // The result card's click queues the same restart edge the keys use; handleInput stays the one owner.
    requestRestart() {
      restartRequested = true;
    },

    update(dt, input) {
      if (director.state !== ROUND_STATES.RUNNING) return false;
      const previousZ = car.position.z;
      if (input.isDown('handbrake')) car.velocity.multiplyScalar(Math.exp(-TUNING.handbrakeDecay * dt));
      const intent = car.planMovement({
        left: input.isDown('left') ? 1 : 0,
        right: input.isDown('right') ? 1 : 0,
        throttle: input.isDown('throttle') ? 1 : 0,
        reverse: input.isDown('brake') ? 1 : 0,
        deltaSeconds: dt,
      });
      car.commitMovement(intent, resolve(intent), null);
      for (const t of trafficState) t.z = Math.max(TUNING.trafficStopZ, t.startZ - t.speed * director.elapsedSeconds);
      crossProgress(previousZ, car.position.z);
      for (const event of director.step(dt)) {
        if (event.type === ROUND_EVENTS.ROUND_WON || event.type === ROUND_EVENTS.ROUND_LOST) {
          terminalCount += 1;
          emit(event.type, { reason: event.reason });
        }
      }
      return director.state === ROUND_STATES.RUNNING ? undefined : false;
    },

    // Live objects for rendering; never serialized.
    view() {
      return {
        car, trafficState, checkpointsPassed, roundId, lastHit,
        state: director.state,
      };
    },

    round: () => director.snapshot(),

    read() {
      const forward = car.bodyFrame.forward;
      const forwardSpeed = car.velocity.x * forward.x + car.velocity.z * forward.z;
      const snapshot = director.snapshot();
      return {
        state: director.state,
        roundId,
        elapsed: director.elapsedSeconds,
        terminalCount,
        outcomeReason: director.outcomeReason,
        events: events.map(e => ({ ...e })),
        car: {
          x: car.position.x, z: car.position.z, vx: car.velocity.x, yaw: car.yaw, steer: car.steer,
          speed: Math.abs(forwardSpeed), forwardSpeed,
        },
        health: health.value,
        timeRemaining: clock.remainingSeconds,
        timeLimit: clock.limitSeconds,
        checkpoints: checkpointsPassed,
        checkpointsTotal: CHECKPOINT_COUNT,
        finishUnlocked: checkpointsPassed >= CHECKPOINT_COUNT,
        distanceToFinish: Math.max(0, car.position.z - FINISH_Z),
        hits,
        lastHit: lastHit ? { id: lastHit.id, kind: lastHit.kind, damage: lastHit.damage } : null,
        round: snapshot,
      };
    },
  };
}
