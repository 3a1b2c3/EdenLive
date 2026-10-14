export const TRACK_LENGTH = 240;
// Speeds are the other half of the camera's angular-rate budget (the corner
// radius in track.mjs is the first): the view rides the track tangent, so a
// corner turns at v/R. Throttle 22 with a 1.55x boost reached 153 deg/s, which
// replaced 6.6% of the frame per presented frame. At R=20 these values hold
// the corner near 2 deg/frame. Rival speeds and the race clock scale with the
// player so the race still resolves the same way: boosting wins near 47 s,
// while running without the packs loses to the leader at 57 s.
export const RACE_LIMIT = 85;
export const MAX_CRASHES = 3;
export const BOOST_DURATION = 3.5;
export const BOOST_PACKS = [28, 68, 108, 148, 188, 222];
export const PACK_LANES = [0, -2.7, 0, 2.7, 0, 0];
export const RIVAL_NAMES = ['VIPER', 'NOVA', 'GHOST'];
export const RIVAL_SPEEDS = [11.9, 12.3, 12.7];
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export function freshRound(id = 1) {
  return {
    // READY is the grid: the race clock and rivals wait for the first
    // throttle/brake/steer input, so the model frame rate settles before play.
    state: 'READY', started: false, roundId: id, elapsed: 0, distance: 0, speed: 0,
    lane: 0, boost: 0, boostCount: 0, crashes: 0, laps: 0,
    terminalCount: 0, outcomeReason: null, events: [], nextEventId: 1,
    inputApplied: false, throttle: false, braking: false, steering: 0,
    rivalDistances: [8, 15, 23], rivalLanes: [-2.8, 2.8, -2.8],
    pickedLap: [-1, -1, -1, -1, -1, -1], collisionCooldown: 0,
    lastLapTime: 0, lapTimes: [], rank: 4,
  };
}
function emit(s, type, extra = {}) {
  const event = { id: s.nextEventId++, type, ...extra };
  s.events.push(event);
  if (s.events.length > 64) s.events.shift();
  return event;
}
export function advanceRound(s, dt, input = {}) {
  if (s.state !== 'RUNNING' && s.state !== 'READY') return [];
  const events = [];
  s.steering = clamp(Number(input.steer) || 0, -1, 1);
  s.throttle = !!input.throttle; s.braking = !!input.brake;
  s.inputApplied = s.throttle || s.braking || s.steering !== 0;
  if (s.state === 'READY') {
    if (!s.inputApplied) return events;
    s.state = 'RUNNING'; s.started = true;
    events.push(emit(s, 'round.started'));
  }
  s.elapsed += dt;
  s.collisionCooldown = Math.max(0, s.collisionCooldown - dt);
  // Lane changes are lateral translation past near geometry, the other source
  // of new content per frame; scaled down with the forward speed. 3.5 still
  // crosses the full 5.4-unit lane spread in 1.5 s, well inside the ~3.3 s
  // between boost packs.
  s.lane = clamp(s.lane + s.steering * dt * 3.5, -4.1, 4.1);
  s.boost = Math.max(0, s.boost - dt);
  const target = s.braking ? 2.5 : (s.throttle ? 12 : 6.5) * (s.boost > 0 ? 1.3 : 1);
  s.speed += (target - s.speed) * Math.min(1, dt * (s.braking ? 8 : 2.5));
  const prev = s.distance;
  s.distance += s.speed * dt;
  const lap = Math.floor(s.distance / TRACK_LENGTH);
  for (let i = 0; i < BOOST_PACKS.length; i++) {
    const packDistance = lap * TRACK_LENGTH + BOOST_PACKS[i];
    if (s.pickedLap[i] !== lap && prev <= packDistance + 1.2 && s.distance >= packDistance - 1.2 && Math.abs(s.lane - PACK_LANES[i]) < 1.35) {
      s.pickedLap[i] = lap; s.boost = BOOST_DURATION; s.boostCount++;
      events.push(emit(s, 'boost.collected', { index: i, lap, boostSeconds: BOOST_DURATION }));
    }
  }
  if (lap > s.laps) {
    s.lapTimes.push(Number((s.elapsed - s.lastLapTime).toFixed(3)));
    s.lastLapTime = s.elapsed;
    events.push(emit(s, 'lap.completed', { lap, time: s.lapTimes.at(-1) }));
  }
  s.laps = lap;
  for (let i = 0; i < 3; i++) {
    s.rivalDistances[i] += RIVAL_SPEEDS[i] * dt;
    s.rivalLanes[i] = (i === 1 ? 2.8 : -2.8) + Math.sin(s.elapsed * .55 + i) * .35;
    const delta = ((s.distance - s.rivalDistances[i] + TRACK_LENGTH * 100 + TRACK_LENGTH / 2) % TRACK_LENGTH) - TRACK_LENGTH / 2;
    if (Math.abs(delta) < 2.1 && Math.abs(s.lane - s.rivalLanes[i]) < 1.65 && s.collisionCooldown <= 0) {
      s.crashes++; s.collisionCooldown = 1.6; s.speed *= .56;
      events.push(emit(s, 'rival.contact', { rival: i, crashes: s.crashes }));
    }
  }
  s.rank = 1 + s.rivalDistances.filter(d => d > s.distance).length;
  // Contact loss takes precedence; finish before rival/time resolution in the same tick.
  // `cause` rides on round.lost so its prompt line needs no snapshot.
  let loss = null, cause = '';
  if (s.crashes >= MAX_CRASHES) { loss = 'Three collisions wrecked the car. Dodge the rivals and try again.'; cause = 'crash'; }
  else if (s.laps >= 3 && s.rank === 1) {
    s.state = 'WON'; s.outcomeReason = 'First across the line after three laps — the city night race is yours!';
  } else if (s.rivalDistances.some(d => d >= TRACK_LENGTH * 3)) { loss = 'A rival crossed the line first. Grab the boost packs and fight for P1.'; cause = 'rival'; }
  else if (s.elapsed >= RACE_LIMIT) { loss = `The ${RACE_LIMIT}-second race clock expired. Keep the throttle pinned and chain the boost packs.`; cause = 'clock'; }
  if (loss) { s.state = 'LOST'; s.outcomeReason = loss; }
  if (s.state !== 'RUNNING') { s.terminalCount++; events.push(emit(s, s.state === 'WON' ? 'round.won' : 'round.lost', { reason: s.outcomeReason, cause })); }
  return events;
}
export function snapshot(s) {
  return {
    ...s, events: s.events.map(e => ({ ...e })), rivalDistances: [...s.rivalDistances], rivalLanes: [...s.rivalLanes],
    pickedLap: [...s.pickedLap], lapTimes: [...s.lapTimes], boostSeconds: s.boost,
    collected: s.pickedLap.map(l => l === Math.floor(s.distance / TRACK_LENGTH)),
    lap: Math.min(3, s.laps + 1), lapsCompleted: s.laps, crashLimit: MAX_CRASHES, raceLimit: RACE_LIMIT,
    playerOdometer: s.distance, progress: Math.min(1, s.distance / (TRACK_LENGTH * 3)),
    diagnostics: { inputApplied: s.inputApplied, contact: { crashes: s.crashes, cooldown: s.collisionCooldown }, activation: { race: s.started, rivals: 3 }, reachableTargets: { trackLength: TRACK_LENGTH } }
  };
}
export function createGame() {
  let round = freshRound();
  return {
    // The host owns the restart lifecycle (R key) and calls reset().
    reset() { round = freshRound(round.roundId + 1); },
    handleInput() {},
    update(dt, keys) {
      if (round.state !== 'RUNNING' && round.state !== 'READY') return false;
      advanceRound(round, dt, { throttle: keys.isDown('throttle'), brake: keys.isDown('brake'), steer: keys.axis('steerLeft', 'steerRight') });
      if (round.state === 'WON' || round.state === 'LOST') keys.clear();
      return round.state === 'RUNNING' || round.state === 'READY';
    },
    read() { return snapshot(round); }
  };
}
