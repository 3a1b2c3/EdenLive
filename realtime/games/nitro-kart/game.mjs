import { BARRIER_OFFSET, projectOnTrack, sampleAtDistance } from './track.js';

// One gameplay owner for the race: player kart physics, drift-to-nitro, rivals on the
// racing line, laps/checkpoints, outcomes and restart. Rendering reads `karts` and `read()`.
export const RACE = Object.freeze({
  laps: 2,
  countdown: 3,
  raceClock: 120,
  checkpointsPerLap: 8,
  maxCharges: 2,
  boostSeconds: 2.4,
  boxRespawn: 4,
  boxRadius: 1.9,
  kartRadius: 1.05,
});

const PLAYER = Object.freeze({
  accel: 15, brake: 30, reverseMax: 7, maxSpeed: 20, boostMax: 31, boostAccel: 30,
  drag: 0.12, steerRate: 1.85, driftSteerRate: 1.5, grip: 9, driftGrip: 2.1,
  driftMinSpeed: 7, driftDrag: 0.05, cornerDrag: 0.55,
});
const WALL_LIMIT = BARRIER_OFFSET - 0.95;

const RIVALS = Object.freeze([
  { id: 'rival_blue', slot: 0, lane: -1.8, speed: 21.6, phase: 0.3 },
  { id: 'rival_green', slot: 1, lane: 1.9, speed: 21.2, phase: 1.7 },
  { id: 'rival_yellow', slot: 3, lane: 0.2, speed: 20.8, phase: 3.1 },
]);
const PLAYER_SLOT = 2;

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const yawOfDir = (dx, dz) => Math.atan2(-dx, -dz);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function curvatureAhead(track, dist, span = 14) {
  const a = sampleAtDistance(track.samples, track.length, dist);
  const b = sampleAtDistance(track.samples, track.length, dist + span);
  return Math.abs(wrapAngle(yawOfDir(b.tx, b.tz) - yawOfDir(a.tx, a.tz)));
}

export function createGame({ track, createPool }) {
  const L = track.length;
  const cpSpan = L / RACE.checkpointsPerLap;
  let roundId = 0;
  let s; // round state

  const nitroPool = createPool({ id: 'nitro', initial: 0, max: RACE.maxCharges, depletionPolicy: 'decrementOnly' });

  function emit(type, data = {}) {
    s.eventSeq += 1;
    s.events.push({ id: `r${roundId}-e${s.eventSeq}`, type, t: +s.elapsed.toFixed(3), ...data });
    if (s.events.length > 48) s.events.shift();
  }

  function racer(id, slotIndex) {
    const slot = track.grid[slotIndex];
    const progress = slot.dist > L / 2 ? slot.dist - L : slot.dist;
    return {
      id, x: slot.x, z: slot.z, yaw: slot.yaw, vx: 0, vz: 0, speed: 0, progress,
      lastDist: slot.dist, hint: -1, lap: 0, cpReached: Math.floor(progress / cpSpan), finished: false,
      finishTime: null, wheelSpin: 0,
    };
  }

  function reset() {
    roundId += 1;
    nitroPool.reset();
    s = {
      state: 'RUNNING', phase: 'grid', elapsed: 0, countdownStart: 0, raceTime: 0, terminalCount: 0,
      outcomeReason: null, events: [], eventSeq: 0, finishOrder: [],
      player: {
        ...racer('player', PLAYER_SLOT), steer: 0, drifting: false, driftTime: 0, slip: 0,
        gauge: 0, boost: 0, barrierHits: 0, wallCooldown: 0, driftsCompleted: 0,
        nitroUsed: 0, nitroRefused: 0, driftsStarted: 0, driftChargeTotal: 0, turnLeft: 0, turnRight: 0, boxesCollected: 0,
      },
      rivals: RIVALS.map((cfg) => ({ ...racer(cfg.id, cfg.slot), cfg, laneNow: track.grid[cfg.slot] ? 0 : 0 })),
      boxes: track.nitroStations.map((p, i) => ({ id: `nitro_box_${i}`, x: p.x, z: p.z, respawn: 0 })),
      countdownShown: 3,
    };
    for (const r of s.rivals) {
      const proj = projectOnTrack(track, r.x, r.z);
      r.laneNow = proj.lateral;
    }
    emit('round.start', { roundId });
  }

  function updateProgress(k) {
    const proj = projectOnTrack(track, k.x, k.z, k.hint);
    k.hint = proj.index;
    let d = proj.dist - k.lastDist;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    k.progress += d;
    k.lastDist = proj.dist;
    return proj;
  }

  function checkLaps(k, isPlayer) {
    const cp = Math.floor(k.progress / cpSpan);
    while (cp > k.cpReached) {
      k.cpReached += 1;
      if (isPlayer && k.cpReached > 0) emit('race.checkpoint', { checkpoint: k.cpReached % RACE.checkpointsPerLap, lapProgress: k.cpReached });
      if (k.cpReached > 0 && k.cpReached % RACE.checkpointsPerLap === 0) {
        k.lap = k.cpReached / RACE.checkpointsPerLap;
        emit('race.lap', { kart: k.id, lap: k.lap });
        if (k.lap >= RACE.laps && !k.finished) {
          k.finished = true;
          k.finishTime = s.raceTime;
          s.finishOrder.push(k.id);
          emit('race.finish', { kart: k.id, place: s.finishOrder.length, time: +s.raceTime.toFixed(2) });
        }
      }
    }
  }

  function terminal(state, reason) {
    if (s.state !== 'RUNNING') return;
    s.state = state;
    s.phase = 'finished';
    s.outcomeReason = reason;
    s.terminalCount += 1;
    s.player.drifting = false;
    emit(state === 'WON' ? 'round.won' : 'round.lost', { reason });
  }

  function stepPlayer(dt, input) {
    const p = s.player;
    const up = input?.isDown('up') ?? false;
    const down = input?.isDown('down') ?? false;
    const steerIn = input ? input.axis('right', 'left') : 0; // +1 = left
    const driftHeld = input?.isDown('drift') ?? false;
    p.steer += (steerIn - p.steer) * Math.min(1, dt * 12);

    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    let along = p.vx * fx + p.vz * fz;
    let latX = p.vx - fx * along;
    let latZ = p.vz - fz * along;

    // Drift state: hold drift while steering at speed.
    const wasDrifting = p.drifting;
    if (!p.drifting && driftHeld && Math.abs(steerIn) > 0 && along > PLAYER.driftMinSpeed) {
      p.drifting = true;
      p.driftTime = 0;
      p.driftDir = Math.sign(steerIn);
      p.driftsStarted += 1;
      emit('drift.start', { dir: p.driftDir });
    } else if (p.drifting && (!driftHeld || along < 2.5)) {
      p.drifting = false;
    }
    if (wasDrifting && !p.drifting) {
      p.driftsCompleted += 1;
      emit('drift.end', { seconds: +p.driftTime.toFixed(2) });
    }

    const boosting = p.boost > 0;
    const maxSpeed = boosting ? PLAYER.boostMax : PLAYER.maxSpeed;
    const accel = boosting ? PLAYER.boostAccel : PLAYER.accel;
    if (boosting) {
      along += accel * dt;
      p.boost = Math.max(0, p.boost - dt);
    } else if (up) {
      along += accel * dt;
    }
    if (down) {
      along -= (along > 0 ? PLAYER.brake : PLAYER.accel * 0.6) * dt;
      along = Math.max(-PLAYER.reverseMax, along);
    }
    // Hard steering without drifting scrubs speed; drifting keeps momentum through the corner.
    const cornerScrub = p.drifting ? PLAYER.driftDrag : PLAYER.cornerDrag * Math.abs(p.steer);
    along -= along * (PLAYER.drag + cornerScrub) * dt;
    if (!up && !down && !boosting) along -= Math.sign(along) * Math.min(Math.abs(along), 4 * dt);
    along = Math.min(along, maxSpeed + (along > maxSpeed ? 0 : 0));
    if (along > maxSpeed) along += (maxSpeed - along) * Math.min(1, dt * 3);

    const speedFactor = clamp(Math.abs(along) / 8, 0, 1) * Math.sign(along || 1);
    const rate = p.drifting ? PLAYER.driftSteerRate : PLAYER.steerRate;
    const steerUse = p.drifting ? clamp(p.steer + p.driftDir * 0.2, -1.2, 1.2) : p.steer;
    const dYaw = steerUse * rate * speedFactor * dt;
    if (dYaw > 0) p.turnLeft += dYaw; else p.turnRight -= dYaw;
    p.yaw = wrapAngle(p.yaw + dYaw);

    const grip = p.drifting ? PLAYER.driftGrip : PLAYER.grip;
    const keep = Math.exp(-grip * dt);
    latX *= keep;
    latZ *= keep;
    const nfx = -Math.sin(p.yaw);
    const nfz = -Math.cos(p.yaw);
    p.vx = nfx * along + latX;
    p.vz = nfz * along + latZ;
    p.speed = Math.hypot(p.vx, p.vz);
    p.slip = along > 1 ? Math.atan2(Math.hypot(latX, latZ), along) : 0;

    if (p.drifting) {
      p.driftTime += dt;
      const before = p.gauge;
      const charge = (1.8 + 1.6 * Math.min(p.slip, 0.5)) * dt * clamp(along / PLAYER.maxSpeed, 0.6, 1.2);
      p.gauge += charge;
      p.driftChargeTotal += charge;
      if (p.gauge >= 1) {
        if (nitroPool.value < RACE.maxCharges) {
          nitroPool.gain(1);
          emit('nitro.gained', { source: 'drift', charges: nitroPool.value });
          p.gauge -= 1;
        } else {
          p.gauge = 1;
        }
      }
      if (before < 0.5 && p.gauge >= 0.5) emit('drift.charge', { gauge: 0.5 });
    }

    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.wheelSpin += along * dt / 0.4;

    const proj = updateProgress(p);
    p.wallCooldown = Math.max(0, p.wallCooldown - dt);
    if (Math.abs(proj.lateral) > WALL_LIMIT) {
      const sm = proj.sample;
      const sign = Math.sign(proj.lateral);
      const over = Math.abs(proj.lateral) - WALL_LIMIT;
      p.x -= sm.nx * over * sign;
      p.z -= sm.nz * over * sign;
      // Arcade wall assist: turn the kart toward the track direction so it slides along.
      const trackYaw = yawOfDir(sm.tx, sm.tz);
      p.yaw = wrapAngle(p.yaw + wrapAngle(trackYaw - p.yaw) * Math.min(1, dt * 6));
      const outward = (p.vx * sm.nx + p.vz * sm.nz) * sign;
      if (outward > 0) {
        p.vx -= sm.nx * outward * sign;
        p.vz -= sm.nz * outward * sign;
      }
      if (p.wallCooldown <= 0) {
        p.vx *= 0.85;
        p.vz *= 0.85;
        p.barrierHits += 1;
        p.wallCooldown = 0.45;
        emit('kart.barrier_hit', { hits: p.barrierHits });
      } else {
        p.vx *= Math.exp(-0.8 * dt);
        p.vz *= Math.exp(-0.8 * dt);
      }
    }

    for (const b of s.boxes) {
      if (b.respawn > 0) { b.respawn = Math.max(0, b.respawn - dt); continue; }
      if ((p.x - b.x) ** 2 + (p.z - b.z) ** 2 <= RACE.boxRadius ** 2) {
        b.respawn = RACE.boxRespawn;
        p.boxesCollected += 1;
        const gained = nitroPool.value < RACE.maxCharges;
        if (gained) nitroPool.gain(1);
        emit('nitro.box', { box: b.id, charges: nitroPool.value, gained });
      }
    }
  }

  function stepRivals(dt) {
    for (const r of s.rivals) {
      if (r.finished) {
        r.speed = Math.max(0, r.speed - 8 * dt);
      } else {
        const dist = ((r.progress % L) + L) % L;
        const curv = curvatureAhead(track, dist + 4);
        const target = r.cfg.speed * (1 - 0.18 * clamp(curv / 0.9, 0, 1));
        r.speed += clamp(target - r.speed, -14 * dt, 9 * dt);
      }
      r.progress += r.speed * dt;
      const lane = r.cfg.lane + 1.0 * Math.sin(r.progress * 0.045 + r.cfg.phase);
      r.laneNow += (lane - r.laneNow) * Math.min(1, dt * 0.8);
      const sm = sampleAtDistance(track.samples, L, r.progress);
      r.x = sm.x + sm.nx * r.laneNow;
      r.z = sm.z + sm.nz * r.laneNow;
      r.yaw = yawOfDir(sm.tx, sm.tz);
      r.lastDist = sm.dist;
      r.wheelSpin += r.speed * dt / 0.4;
    }
  }

  function resolveContacts() {
    const p = s.player;
    const minD = RACE.kartRadius * 2;
    for (const r of s.rivals) {
      const dx = p.x - r.x;
      const dz = p.z - r.z;
      const d = Math.hypot(dx, dz);
      if (d > 0 && d < minD) {
        const push = (minD - d);
        p.x += (dx / d) * push;
        p.z += (dz / d) * push;
        const into = -(p.vx * dx + p.vz * dz) / d;
        if (into > 0) { p.vx += (dx / d) * into * 0.6; p.vz += (dz / d) * into * 0.6; }
      }
    }
  }

  function rankOf(id) {
    const all = [s.player, ...s.rivals];
    const order = all.slice().sort((a, b) => {
      if (a.finished && b.finished) return s.finishOrder.indexOf(a.id) - s.finishOrder.indexOf(b.id);
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.progress - a.progress;
    });
    return order.findIndex((k) => k.id === id) + 1;
  }

  function lineAngle() {
    const p = s.player;
    const dist = ((p.progress % L) + L) % L;
    const t = sampleAtDistance(track.samples, L, dist + 9);
    return wrapAngle(yawOfDir(t.x - p.x, t.z - p.z) - p.yaw);
  }

  reset();

  return {
    track,
    get state() { return s.state; },
    get karts() { return { player: s.player, rivals: s.rivals }; },
    get boxes() { return s.boxes; },
    handleInput(input) {
      if (s.state !== 'RUNNING') {
        if (input.consumePress('restart')) reset();
        input.consumePress('nitro');
        return;
      }
      input.consumePress('restart');
      if (s.phase === 'grid') {
        // The countdown starts on the driver's first control input, as at a kart grid.
        // Latch short taps as well as held keys so a 35 ms press still starts the countdown.
        const tapped = ['nitro', 'up', 'down', 'left', 'right', 'drift'].map((a) => input.consumePress(a)).some(Boolean);
        if (tapped || ['up', 'down', 'left', 'right', 'drift'].some((a) => input.isDown(a))) {
          s.phase = 'countdown';
          s.countdownStart = s.elapsed;
          emit('race.countdown', { value: RACE.countdown });
        }
        return;
      }
      if (input.consumePress('nitro')) {
        if (s.phase === 'race' && s.player.boost <= 0 && nitroPool.canSpend(1)) {
          nitroPool.spend(1);
          s.player.boost = RACE.boostSeconds;
          s.player.nitroUsed += 1;
          emit('nitro.used', { charges: nitroPool.value });
        } else {
          s.player.nitroRefused += 1;
          emit('nitro.refused', { charges: nitroPool.value, boosting: s.player.boost > 0, phase: s.phase });
        }
      }
    },
    restart() { reset(); },
    update(dt, input) {
      if (s.state !== 'RUNNING') return false;
      s.elapsed += dt;
      if (s.phase === 'grid') return true;
      if (s.phase === 'countdown') {
        const left = RACE.countdown - (s.elapsed - s.countdownStart);
        const shown = Math.ceil(left);
        if (shown < s.countdownShown && shown > 0) { s.countdownShown = shown; emit('race.countdown', { value: shown }); }
        if (left <= 0) { s.phase = 'race'; emit('race.go'); }
        return true;
      }
      s.raceTime += dt;
      stepPlayer(dt, input);
      stepRivals(dt);
      resolveContacts();
      checkLaps(s.player, true);
      for (const r of s.rivals) checkLaps(r, false);
      // Precedence: player finish beats a same-step rival finish and the clock.
      if (s.player.finished && s.finishOrder[0] === 'player') terminal('WON', 'first_place');
      else if (s.finishOrder.length > 0) terminal('LOST', 'rival_finished');
      else if (s.raceTime >= RACE.raceClock) terminal('LOST', 'time_up');
      return s.state === 'RUNNING';
    },
    read() {
      const p = s.player;
      const rivals = {};
      for (const r of s.rivals) rivals[r.id] = { lap: r.lap, progress: +r.progress.toFixed(2), speed: +r.speed.toFixed(2), finished: r.finished };
      const boxes = {};
      for (const b of s.boxes) boxes[b.id] = { available: b.respawn <= 0 };
      return {
        implemented: true,
        state: s.state,
        phase: s.phase,
        roundId,
        elapsed: +s.elapsed.toFixed(4),
        raceTime: +s.raceTime.toFixed(3),
        timeLeft: +Math.max(0, RACE.raceClock - s.raceTime).toFixed(2),
        countdown: s.phase === 'countdown' ? Math.max(0, Math.ceil(RACE.countdown - (s.elapsed - s.countdownStart))) : (s.phase === 'grid' ? RACE.countdown : 0),
        terminalCount: s.terminalCount,
        outcomeReason: s.outcomeReason,
        lapsToWin: RACE.laps,
        position: rankOf('player'),
        finishOrder: s.finishOrder.slice(),
        player: {
          x: +p.x.toFixed(3), z: +p.z.toFixed(3), yaw: +p.yaw.toFixed(4), speed: +p.speed.toFixed(3),
          lap: p.lap, displayLap: Math.min(RACE.laps, p.lap + 1), progress: +p.progress.toFixed(3),
          checkpoints: Math.max(0, p.cpReached), lineAngle: +lineAngle().toFixed(4),
          drifting: p.drifting, slip: +p.slip.toFixed(3), driftsCompleted: p.driftsCompleted,
          boosting: p.boost > 0, boostLeft: +p.boost.toFixed(2), nitroUsed: p.nitroUsed, nitroRefused: p.nitroRefused,
          driftsStarted: p.driftsStarted, driftChargeTotal: +p.driftChargeTotal.toFixed(3),
          turnLeft: +p.turnLeft.toFixed(3), turnRight: +p.turnRight.toFixed(3),
          barrierHits: p.barrierHits, boxesCollected: p.boxesCollected,
        },
        nitro: { charges: nitroPool.value, max: RACE.maxCharges, gauge: +p.gauge.toFixed(3) },
        rivals,
        boxes,
        events: s.events.map((e) => ({ ...e })),
      };
    },
  };
}
