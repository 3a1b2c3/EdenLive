// One gameplay owner for the city walk. Pure state + rules; main.js mirrors it into the scene.
import { CameraRelativeCharacterMotionController } from '/assets/actor-motion/character/CameraRelativeCharacterMotionController.js';
import { RoundClock, CLOCK_EXPIRY_MEANINGS } from '/assets/gameplay/RoundClock.js';
import { RandomGenerator } from '/assets/math/RandomUtils.js';
import {
  BLOCKS, CAR_ROUTES, CITY_HALF, FOUNTAIN, INITIAL_RING_SPOTS, PEDESTRIAN_ROUTES, PLAYER_SPAWN,
  RING_SPOTS, ROAD_HALF, ROAD_LINES, onRoad, samplePath, surfaceHeight,
} from './city-layout.mjs';

export const RULES = Object.freeze({
  targetScore: 100,
  pointsPerRing: 10,
  startSeconds: 30,
  bonusSeconds: 8,
  activeRings: 5,
  ringRadius: 2.0,
  respawnMin: 14,
  respawnMax: 32,
  walkSpeed: 7,
  playerRadius: 0.45,
  carCruise: 9,
  carAccel: 5,
  carBrake: 16,
  // Look-ahead corridor in front of each car: anyone inside forces a stop.
  stopDistance: 8.5,
  slowDistance: 16,
  laneHalfWidth: 1.7,
  crossingReach: 4.8,
  carHalfLength: 2.6,
  carHalfWidth: 1.15,
  cameraYawRate: 1.9,
  cameraPitchRate: 1.2,
});

const EVENT_LIMIT = 48;
const LOOKAHEAD_STEP = 1.5;
const LOOKAHEAD_SAMPLES = Math.ceil(RULES.slowDistance / LOOKAHEAD_STEP);
const JUNCTION_REACH = 18;

function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

// Static player blockers: building lots, fountain, city edge.
const LOTS = BLOCKS.filter(b => !b.park).map(b => b.lot);

// Guide routing: street intersections are waypoints; a leg is usable when it clears every
// building lot (and the fountain) with the player's radius to spare.
const GUIDE_NODES = ROAD_LINES.flatMap(x => ROAD_LINES.map(z => ({ x, z })));
const GUIDE_MARGIN = 0.8;

function segmentClear(ax, az, bx, bz) {
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(2, Math.ceil(len / 0.75));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    for (const l of LOTS) {
      if (x > l.x0 - GUIDE_MARGIN && x < l.x1 + GUIDE_MARGIN && z > l.z0 - GUIDE_MARGIN && z < l.z1 + GUIDE_MARGIN) return false;
    }
    if (Math.hypot(x - FOUNTAIN.x, z - FOUNTAIN.z) < FOUNTAIN.radius + GUIDE_MARGIN) return false;
  }
  return true;
}

const NODE_EDGES = GUIDE_NODES.map((a, i) => GUIDE_NODES
  .map((b, j) => ({ j, d: Math.hypot(b.x - a.x, b.z - a.z) }))
  .filter(e => e.j !== i && segmentClear(a.x, a.z, GUIDE_NODES[e.j].x, GUIDE_NODES[e.j].z)));

// Shortest walkable route from (px, pz) to (tx, tz): total length and the first waypoint.
function guideRoute(px, pz, tx, tz) {
  if (segmentClear(px, pz, tx, tz)) return { length: Math.hypot(tx - px, tz - pz), x: tx, z: tz };
  const n = GUIDE_NODES.length;
  const dist = new Array(n).fill(Infinity);
  const first = new Array(n).fill(-1);
  const done = new Array(n).fill(false);
  GUIDE_NODES.forEach((node, i) => {
    if (segmentClear(px, pz, node.x, node.z)) { dist[i] = Math.hypot(node.x - px, node.z - pz); first[i] = i; }
  });
  let best = { length: Infinity, x: tx, z: tz };
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i += 1) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0) break;
    done[u] = true;
    const node = GUIDE_NODES[u];
    if (segmentClear(node.x, node.z, tx, tz)) {
      const total = dist[u] + Math.hypot(tx - node.x, tz - node.z);
      if (total < best.length) best = { length: total, x: GUIDE_NODES[first[u]].x, z: GUIDE_NODES[first[u]].z };
    }
    for (const e of NODE_EDGES[u]) {
      if (dist[u] + e.d < dist[e.j]) { dist[e.j] = dist[u] + e.d; first[e.j] = first[u]; }
    }
  }
  return best;
}

function resolveStatic(x, z, r) {
  for (const lot of LOTS) {
    const cx = Math.max(lot.x0, Math.min(x, lot.x1));
    const cz = Math.max(lot.z0, Math.min(z, lot.z1));
    const dx = x - cx;
    const dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r;
        z = cz + (dz / d) * r;
      } else {
        // Center inside the lot: push out along the shallowest axis.
        const pushes = [[lot.x0 - r - x, 0], [lot.x1 + r - x, 0], [0, lot.z0 - r - z], [0, lot.z1 + r - z]];
        pushes.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
        x += pushes[0][0];
        z += pushes[0][1];
      }
    }
  }
  const fdx = x - FOUNTAIN.x;
  const fdz = z - FOUNTAIN.z;
  const fr = FOUNTAIN.radius + r;
  const fd = Math.hypot(fdx, fdz);
  if (fd < fr && fd > 1e-6) {
    x = FOUNTAIN.x + (fdx / fd) * fr;
    z = FOUNTAIN.z + (fdz / fd) * fr;
  }
  const lim = CITY_HALF - r;
  x = Math.max(-lim, Math.min(lim, x));
  z = Math.max(-lim, Math.min(lim, z));
  return { x, z };
}

// Push a circle out of an oriented car box.
function resolveCar(x, z, r, car) {
  const c = Math.cos(car.heading);
  const s = Math.sin(car.heading);
  // Car forward (-Z local) in world: (-sin h, -cos h); right: (cos h, -sin h).
  const dx = x - car.x;
  const dz = z - car.z;
  const lr = dx * c - dz * s;          // along right
  const lf = -dx * s - dz * c;         // along forward
  const hx = RULES.carHalfWidth;
  const hf = car.halfLength ?? RULES.carHalfLength;
  const qx = Math.max(-hx, Math.min(lr, hx));
  const qf = Math.max(-hf, Math.min(lf, hf));
  let ex = lr - qx;
  let ef = lf - qf;
  let d = Math.hypot(ex, ef);
  if (d >= r) return null;
  let nr;
  let nf;
  if (d > 1e-6) {
    nr = qx + (ex / d) * r;
    nf = qf + (ef / d) * r;
  } else {
    const toSide = hx - Math.abs(lr);
    const toEnd = hf - Math.abs(lf);
    if (toSide < toEnd) { nr = Math.sign(lr || 1) * (hx + r); nf = lf; } else { nr = lr; nf = Math.sign(lf || 1) * (hf + r); }
  }
  return {
    x: car.x + nr * c - nf * s,
    z: car.z - nr * s - nf * c,
  };
}

export function createGame({ seed = 7 } = {}) {
  const motion = new CameraRelativeCharacterMotionController({
    walkSpeed: RULES.walkSpeed, sprintSpeed: RULES.walkSpeed, accelerationLag: 0.05, decelerationLag: 0.06, turnLag: 0.06,
  });
  const clock = new RoundClock({
    limitSeconds: RULES.startSeconds, expiryMeaning: CLOCK_EXPIRY_MEANINGS.LOSE, warningSeconds: 10,
    maxRoundSeconds: 600,
  });
  const rng = new RandomGenerator(seed);

  // A round opens in READY: the walker waits at the spawn, traffic holds and
  // the city clock does not run until the first step, so the model frame rate
  // settles before the countdown. readyTime drives the idle animation meanwhile.
  const state = {
    state: 'READY', roundId: 0, elapsed: 0, readyTime: 0, terminalCount: 0, outcomeReason: null,
    score: 0, ringsCollected: 0, events: [], nextEventId: 1,
    camera: { yaw: 0, pitch: -0.32 },
    player: { x: 0, z: 0, y: 0, heading: 0, speed: 0, distance: 0, moving: false },
    cars: [], pedestrians: [], rings: [],
    yieldStops: 0, carHits: 0, junctions: new Map(),
  };

  function emit(type, data = {}) {
    state.events.push({ id: state.nextEventId, type, t: +state.elapsed.toFixed(3), ...data });
    state.nextEventId += 1;
    if (state.events.length > EVENT_LIMIT) state.events.splice(0, state.events.length - EVENT_LIMIT);
  }

  function reset() {
    state.roundId += 1;
    state.state = 'READY';
    state.elapsed = 0;
    state.readyTime = 0;
    state.terminalCount = 0;
    state.outcomeReason = null;
    state.score = 0;
    state.ringsCollected = 0;
    state.events = [];
    state.nextEventId = 1;
    state.yieldStops = 0;
    state.junctions.clear();
    state.carHits = 0;
    rng.seed(seed + state.roundId);
    state.camera.yaw = 0;
    state.camera.pitch = -0.32;
    motion.setState({ position: { x: PLAYER_SPAWN.x, y: 0, z: PLAYER_SPAWN.z }, velocity: { x: 0, y: 0, z: 0 }, yaw: PLAYER_SPAWN.heading });
    Object.assign(state.player, {
      x: PLAYER_SPAWN.x, z: PLAYER_SPAWN.z, y: surfaceHeight(PLAYER_SPAWN.x, PLAYER_SPAWN.z),
      heading: PLAYER_SPAWN.heading, speed: 0, distance: 0, moving: false,
    });
    state.cars = CAR_ROUTES.map(route => {
      const s = route.phase * route.path.length;
      const p = samplePath(route.path, s);
      const base = { sedan: 2.4, hatchback: 2.0, coupe: 2.5, suv: 2.5, taxi: 2.45, pickup: 2.9, van: 2.75, minibus: 3.3 };
      return {
        id: route.id, route, s, speed: RULES.carCruise, x: p.x, z: p.z, heading: p.heading,
        dirX: p.dirX, dirZ: p.dirZ, yielding: false, yieldTo: null, odometer: 0, claim: null,
        halfLength: base[route.preset] ?? RULES.carHalfLength,
      };
    });
    state.pedestrians = PEDESTRIAN_ROUTES.map(route => {
      const s = route.phase * route.path.length;
      const p = samplePath(route.path, s);
      return { id: route.id, route, s, x: p.x, z: p.z, heading: p.heading, onRoad: onRoad(p.x, p.z), walkTime: 0 };
    });
    state.rings = INITIAL_RING_SPOTS.map((spotIndex, i) => ({ id: `ring_${i}`, spotIndex, x: RING_SPOTS[spotIndex].x, z: RING_SPOTS[spotIndex].z, pulse: 0 }));
    // Ring bonuses extend the limit during a round; every round starts from the base clock.
    clock.limitSeconds = RULES.startSeconds;
    clock.reset();
    clock.drainEvents();
  }

  // Any held WASD step starts the round and the city clock with it.
  function startFrom(input) {
    if (!['forward', 'backward', 'left', 'right'].some(action => input.isDown(action))) return false;
    state.state = 'RUNNING';
    clock.start();
    clock.drainEvents();
    emit('round.started');
    return true;
  }

  function pickRespawn(ring) {
    const taken = new Set(state.rings.map(r => r.spotIndex));
    const p = state.player;
    const candidates = RING_SPOTS.map((spot, i) => ({ spot, i, d: Math.hypot(spot.x - p.x, spot.z - p.z) }))
      .filter(c => !taken.has(c.i) && c.d >= RULES.respawnMin && c.d <= RULES.respawnMax);
    const pool = candidates.length ? candidates
      : RING_SPOTS.map((spot, i) => ({ spot, i, d: Math.hypot(spot.x - p.x, spot.z - p.z) }))
        .filter(c => !taken.has(c.i) && c.d >= 8).sort((a, b) => a.d - b.d).slice(0, 6);
    const pick = rng.choice(pool);
    ring.spotIndex = pick.i;
    ring.x = pick.spot.x;
    ring.z = pick.spot.z;
    ring.pulse = 0;
  }

  function endRound(result, reason) {
    if (state.state !== 'RUNNING') return;
    state.state = result;
    state.outcomeReason = reason;
    state.terminalCount += 1;
    clock.pause();
    state.player.speed = 0;
    state.player.moving = false;
    motion.setState({ velocity: { x: 0, y: 0, z: 0 } });
    emit(result === 'WON' ? 'round.won' : 'round.lost', { reason, score: state.score });
  }

  // Everyone a car must yield to: pedestrians and the player.
  function walkers() {
    const list = state.pedestrians.map(p => ({ id: p.id, x: p.x, z: p.z, onRoad: p.onRoad }));
    list.push({ id: 'player', x: state.player.x, z: state.player.z, onRoad: onRoad(state.player.x, state.player.z) });
    return list;
  }

  // Intersection box key for a point, or null. Boxes are the asphalt squares where roads cross.
  function junctionAt(x, z) {
    const ix = ROAD_LINES.findIndex(r => Math.abs(x - r) < ROAD_HALF);
    const iz = ROAD_LINES.findIndex(r => Math.abs(z - r) < ROAD_HALF);
    return ix >= 0 && iz >= 0 ? `${ix},${iz}` : null;
  }

  // Next junction along the route within reach: its key and distance to its entry.
  function nextJunction(car) {
    for (let d = LOOKAHEAD_STEP; d <= JUNCTION_REACH; d += LOOKAHEAD_STEP) {
      const q = samplePath(car.route.path, car.s + d);
      const key = junctionAt(q.x, q.z);
      if (key) return { key, distance: d };
    }
    return null;
  }

  // Distance along the car's own route to the first point inside its corridor, or Infinity.
  function corridorDistance(car, x, z, test) {
    for (let k = -1; k <= LOOKAHEAD_SAMPLES; k += 1) {
      const offset = k * LOOKAHEAD_STEP;
      const q = k === 0 ? car : samplePath(car.route.path, car.s + offset);
      const dirX = k === 0 ? car.dirX : q.dirX;
      const dirZ = k === 0 ? car.dirZ : q.dirZ;
      const dx = x - q.x;
      const dz = z - q.z;
      const along = dx * dirX + dz * dirZ;
      if (Math.abs(along) > LOOKAHEAD_STEP * 0.5 + 0.05) continue;
      // Signed lateral offset, positive to the car's right (the curb side).
      const side = -dx * dirZ + dz * dirX;
      if (!test(side)) continue;
      const ahead = offset + along;
      return ahead > -RULES.carHalfLength * 0.5 ? ahead : Infinity;
    }
    return Infinity;
  }

  function updateCars(dt) {
    const people = walkers();
    const junctions = state.junctions;
    // Pass 1: find each car's nearest walker and nearest car ahead on its route.
    const plans = state.cars.map(car => {
      let walkerGap = Infinity;
      let walkerId = null;
      for (const w of people) {
        // Anyone already crossing the road stops the car across both lanes, so a walker
        // stepping into this lane is seen before they arrive; sidewalk walkers only count
        // inside the lane itself.
        const d = corridorDistance(car, w.x, w.z, side => (w.onRoad
          ? side > -RULES.crossingReach && side < RULES.laneHalfWidth + 0.9
          : Math.abs(side) < RULES.laneHalfWidth));
        if (d < walkerGap) { walkerGap = d; walkerId = w.id; }
      }
      let carGap = Infinity;
      let carAhead = null;
      if (!(car.ignoreCarsFor > 0)) {
        for (const other of state.cars) {
          if (other === car) continue;
          const d = corridorDistance(car, other.x, other.z, side => Math.abs(side) < 2.2);
          // Bumper-to-bumper spacing: stop about one car length behind.
          if (d > 0 && d - car.halfLength - other.halfLength < carGap) { carGap = d - car.halfLength - other.halfLength; carAhead = other; }
        }
      }
      return { car, walkerGap, walkerId, carGap, carAhead };
    });
    // Junction reservation: a car inside a junction holds it; an approaching car may claim a
    // free junction, otherwise it waits at the entry. Claims are first come, first served.
    for (const [key, holder] of junctions) {
      const holderCar = state.cars.find(c => c.id === holder);
      if (!holderCar || (junctionAt(holderCar.x, holderCar.z) !== key && holderCar.claim !== key)) junctions.delete(key);
    }
    for (const plan of plans) {
      const car = plan.car;
      const inside = junctionAt(car.x, car.z);
      if (inside) {
        if (!junctions.has(inside)) junctions.set(inside, car.id);
        if (car.claim === inside) car.claim = null;
      }
      const next = nextJunction(car);
      if (!next || next.key === inside) continue;
      const holder = junctions.get(next.key);
      if (holder && holder !== car.id) {
        // Wait at the stop line, a car half-length before the box.
        plan.carGap = Math.min(plan.carGap, next.distance - car.halfLength - 1 + RULES.stopDistance);
        if (car.claim === next.key) car.claim = null;
      } else if (next.distance < RULES.carHalfLength + 6) {
        junctions.set(next.key, car.id);
        car.claim = next.key;
      }
    }
    // Two cars meeting in an intersection would each wait for the other; the earlier route yields.
    for (const plan of plans) {
      const other = plan.carAhead && plans.find(p => p.car === plan.carAhead);
      if (other && other.carAhead === plan.car && state.cars.indexOf(plan.car) < state.cars.indexOf(other.car)) {
        plan.carGap = Infinity;
        plan.carAhead = null;
      }
    }
    // Pass 2: brake, yield and advance.
    for (const { car, walkerGap, walkerId, carGap } of plans) {
      const gap = Math.min(walkerGap, carGap);
      let target = RULES.carCruise;
      if (gap < RULES.stopDistance) target = 0;
      else if (gap < RULES.slowDistance) target = RULES.carCruise * (gap - RULES.stopDistance) / (RULES.slowDistance - RULES.stopDistance);
      const wasYielding = car.yielding;
      car.yielding = walkerGap < RULES.stopDistance;
      car.yieldTo = car.yielding ? walkerId : null;
      if (car.yielding && !wasYielding) {
        state.yieldStops += 1;
        emit('car.yield', { car: car.id, to: walkerId });
      }
      if (!car.yielding && wasYielding) emit('car.resume', { car: car.id });
      // Break rare waiting cycles between three or more cars.
      car.carWait = !car.yielding && carGap < RULES.stopDistance && car.speed < 0.2 ? (car.carWait || 0) + dt : 0;
      if (car.carWait > 3) { car.ignoreCarsFor = 1.5; car.carWait = 0; }
      if (car.ignoreCarsFor > 0) car.ignoreCarsFor -= dt;
      const rate = target < car.speed ? RULES.carBrake : RULES.carAccel;
      car.speed += Math.max(-rate * dt, Math.min(rate * dt, target - car.speed));
      if (car.speed < 0.01 && target === 0) car.speed = 0;
      car.s += car.speed * dt;
      car.odometer += car.speed * dt;
      const p = samplePath(car.route.path, car.s);
      car.x = p.x;
      car.z = p.z;
      // Smooth the heading through corners.
      car.heading += wrapAngle(p.heading - car.heading) * Math.min(1, dt * 8);
      car.dirX = -Math.sin(car.heading);
      car.dirZ = -Math.cos(car.heading);
    }
  }

  function updatePedestrians(dt) {
    for (const ped of state.pedestrians) {
      // Pedestrians keep walking; they briefly wait at the curb only if a car is moving
      // right next to their crossing point, so cars and walkers never overlap.
      const p = samplePath(ped.route.path, ped.s + ped.route.speed * dt);
      const entering = !ped.onRoad && onRoad(p.x, p.z);
      let wait = false;
      if (entering) {
        for (const car of state.cars) {
          if (car.speed > 0.8 && !car.yielding && Math.hypot(car.x - p.x, car.z - p.z) < 4.5) { wait = true; break; }
        }
      }
      if (wait) continue;
      ped.s += ped.route.speed * dt;
      ped.x = p.x;
      ped.z = p.z;
      ped.heading = p.heading;
      ped.onRoad = onRoad(p.x, p.z);
      ped.walkTime += dt;
    }
  }

  function updatePlayer(dt, input) {
    const intent = motion.planMovement({
      forward: input.forward, backward: input.backward, strafeLeft: input.left, strafeRight: input.right,
      cameraYaw: state.camera.yaw, deltaSeconds: dt,
    });
    let { x, z } = intent.position;
    ({ x, z } = resolveStatic(x, z, RULES.playerRadius));
    for (const car of state.cars) {
      const pushed = resolveCar(x, z, RULES.playerRadius, car);
      if (pushed) {
        x = pushed.x; z = pushed.z;
        ({ x, z } = resolveStatic(x, z, RULES.playerRadius));
      }
    }
    const moved = Math.hypot(x - state.player.x, z - state.player.z);
    motion.commitMovement(intent, {
      position: { x, y: 0, z },
      velocity: intent.velocity,
      correctedDelta: { x: x - state.player.x, y: 0, z: z - state.player.z },
      grounded: true,
    });
    const p = state.player;
    p.x = x;
    p.z = z;
    p.y = surfaceHeight(x, z);
    p.heading = motion.yaw;
    p.speed = dt > 0 ? moved / dt : 0;
    p.distance += moved;
    p.moving = p.speed > 0.4;
  }

  function collectRings() {
    const p = state.player;
    for (const ring of state.rings) {
      if (Math.hypot(ring.x - p.x, ring.z - p.z) <= RULES.ringRadius) {
        state.score += RULES.pointsPerRing;
        state.ringsCollected += 1;
        clock.limitSeconds += RULES.bonusSeconds;
        emit('ring.collected', { ring: ring.id, spot: ring.spotIndex, score: state.score });
        if (state.score >= RULES.targetScore) {
          endRound('WON', 'score_reached');
          return;
        }
        pickRespawn(ring);
      }
    }
  }

  // Nearest ring by walking distance; x/z is the next waypoint toward it along the streets.
  let guideCache = null;
  function nearestRing() {
    const p = state.player;
    const key = `${p.x.toFixed(2)},${p.z.toFixed(2)},${state.rings.map(r => r.spotIndex).join(',')}`;
    if (guideCache && guideCache.key === key) return guideCache.value;
    let best = null;
    for (const ring of state.rings) {
      const route = guideRoute(p.x, p.z, ring.x, ring.z);
      if (!best || route.length < best.distance) {
        best = { id: ring.id, x: route.x, z: route.z, ringX: ring.x, ringZ: ring.z, distance: route.length };
      }
    }
    guideCache = { key, value: best };
    return best;
  }

  reset();

  return {
    rules: RULES,
    state,
    // R is host-reserved: the host calls reset() for a fresh round.
    reset,
    update(dt, input) {
      // Camera orbit stays live even in terminal states so the player can look around.
      const axis = (neg, pos) => (input.isDown(pos) ? 1 : 0) - (input.isDown(neg) ? 1 : 0);
      const yawAxis = axis('lookLeft', 'lookRight');
      const pitchAxis = axis('lookDown', 'lookUp');
      state.camera.yaw = wrapAngle(state.camera.yaw - yawAxis * RULES.cameraYawRate * dt);
      state.camera.pitch = Math.max(-1.0, Math.min(0.15, state.camera.pitch + pitchAxis * RULES.cameraPitchRate * dt));
      if (state.state === 'READY' && !startFrom(input)) {
        // Idle pose and camera orbit only; traffic and the clock stay frozen.
        if (Number.isFinite(dt) && dt > 0) state.readyTime += dt;
        return false;
      }
      if (state.state !== 'RUNNING') return false;
      state.elapsed += dt;
      updatePedestrians(dt);
      updateCars(dt);
      updatePlayer(dt, {
        forward: input.isDown('forward') ? 1 : 0, backward: input.isDown('backward') ? 1 : 0,
        left: input.isDown('left') ? 1 : 0, right: input.isDown('right') ? 1 : 0,
      });
      collectRings();
      if (state.state !== 'RUNNING') return false;
      clock.step(dt);
      if (clock.expired) {
        endRound('LOST', 'time_up');
        return false;
      }
      return true;
    },
    nearestRing,
    clock,
    read() {
      const c = clock.snapshot();
      const guide = nearestRing();
      return {
        state: state.state,
        roundId: state.roundId,
        elapsed: +state.elapsed.toFixed(4),
        readyTime: +state.readyTime.toFixed(4),
        terminalCount: state.terminalCount,
        outcomeReason: state.outcomeReason,
        score: state.score,
        targetScore: RULES.targetScore,
        ringsCollected: state.ringsCollected,
        timeLeft: +c.remainingSeconds.toFixed(3),
        camera: { yaw: +state.camera.yaw.toFixed(4), pitch: +state.camera.pitch.toFixed(4) },
        player: {
          x: +state.player.x.toFixed(3), z: +state.player.z.toFixed(3), heading: +state.player.heading.toFixed(4),
          distance: +state.player.distance.toFixed(3), moving: state.player.moving,
        },
        guide: guide ? {
          ring: guide.id, distance: +guide.distance.toFixed(3),
          dx: +(guide.ringX - state.player.x).toFixed(3), dz: +(guide.ringZ - state.player.z).toFixed(3),
          // Bearing of the next street waypoint relative to camera forward: positive = to the right.
          bearing: +wrapAngle(Math.atan2(-(guide.x - state.player.x), -(guide.z - state.player.z)) - state.camera.yaw).toFixed(4) * -1,
        } : null,
        traffic: {
          yieldStops: state.yieldStops,
          yieldingNow: state.cars.filter(c => c.yielding).length,
          stoppedForPlayer: state.cars.filter(c => c.yieldTo === 'player').length,
          minCarPedestrianGap: +Math.min(...state.cars.flatMap(car => state.pedestrians.map(p => Math.hypot(p.x - car.x, p.z - car.z)))).toFixed(3),
        },
        events: state.events.map(e => ({ ...e })),
      };
    },
  };
}
