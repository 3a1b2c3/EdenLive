// The browser and headless rule adapter use this exact motion/collision simulation.
// Three.js supplies vector math via the reusable controller; no scene or DOM is needed.
import { LaneRunnerMotionController } from './assets/actor-motion/LaneRunnerMotionController.js';

export const RULES = Object.freeze({
  laneCount: 3, laneWidth: 2.9, speed: 9, targetScore: 10, finish: 174,
  jumpVelocity: 14.5, gravity: 24, slideSeconds: 1.05,
  standingHeight: 2.05, slideHeight: 0.82, radius: 0.3, halfDepth: 0.26,
  trainLength: 14, trainWidth: 2.4, trainHeight: 3.1,
  // Keep the previous detailed-train roof so jump / land numbers stay put.
  roofHeight: 3.1 * (0.94 + 0.065 / 2),
  barrierBottom: 1.22, barrierTop: 2.5, step: 1 / 120,
});
export const laneX = lane => (lane - 1) * RULES.laneWidth;
export const TRACK = Object.freeze([
  { id: 'side-train', type: 'train', lane: 2, distance: 38 },
  { id: 'first-roof', type: 'train', lane: 1, distance: 39 },
  { id: 'first-barrier', type: 'barrier', lane: 1, distance: 62 },
  { id: 'second-roof', type: 'train', lane: 0, distance: 99 },
  { id: 'side-barrier', type: 'barrier', lane: 2, distance: 88 },
  { id: 'second-barrier', type: 'barrier', lane: 0, distance: 123 },
  { id: 'last-barrier', type: 'barrier', lane: 2, distance: 151 },
].map(Object.freeze));
const roofCoin = RULES.roofHeight + 0.9;
export const COINS = Object.freeze([
  [8, 1, 1.05], [16, 1, 1.05], [38, 1, roofCoin], [43, 1, roofCoin],
  [61.8, 1, 0.5], [74, 1, 1.05], [98, 0, roofCoin], [104, 0, roofCoin],
  [122.8, 0, 0.5], [146, 1, 1.05], [156, 1, 1.05], [166, 1, 1.05],
].map(([distance, lane, height], id) => Object.freeze({id, distance, lane, height})));

export class SubwayRound {
  constructor() {
    this.motion = new LaneRunnerMotionController({laneCount: RULES.laneCount,
      laneWidth: RULES.laneWidth, forwardSpeed: RULES.speed, laneChangeLag: 0.075,
      jumpVelocity: RULES.jumpVelocity, gravity: RULES.gravity,
      standingHeight: RULES.standingHeight, duckHeight: RULES.slideHeight,
      duckDurationSeconds: RULES.slideSeconds});
    this.roundId = 0; this.eventId = 0;
    this.reset();
  }
  reset() {
    this.motion.floorUp = 0;
    this.motion.reset();
    this.roundId += 1;
    // A round waits on its starting line. The host keeps simulating, rendering,
    // and generating; only the runner holds still, so the model frame rate can
    // settle before the first hazard arrives.
    this.state = 'READY'; this.elapsed = 0; this.score = 0;
    this.outcomeReason = ''; this.terminalCount = 0;
    this.events = []; this.collected = new Set(); this.cleared = new Set();
    this.contacts = new Set(); this.roofId = null;
    return this.read();
  }
  emit(type, extra = {}) {
    this.events.push({id: ++this.eventId, type, ...extra});
    if (this.events.length > 128) this.events.shift();
  }
  finish(state, reason) {
    if (this.state !== 'RUNNING') return;
    this.state = state; this.outcomeReason = reason; this.terminalCount += 1;
    this.emit(state === 'WON' ? 'round.won' : 'round.lost', {reason});
  }
  action(name) {
    if (this.state === 'READY') {
      // Jump is the start signal, and it is not spent on a jump: the runner
      // leaves the line on the ground. Every other action waits.
      if (name !== 'jump') return false;
      this.state = 'RUNNING';
      this.emit('round.started');
      return true;
    }
    if (this.state !== 'RUNNING') return false;
    if (name === 'left' || name === 'right') {
      const accepted = this.motion.requestLane(name === 'left' ? -1 : 1) === 'moved';
      if (accepted) this.emit('lane.changed', {lane: this.motion.targetLaneIndex});
      return accepted;
    }
    if (name === 'jump' && this.motion.requestJump()) {
      this.emit('player.jumped', {fromRoof: this.roofId !== null}); return true;
    }
    if (name === 'duck' && this.motion.requestDuck()) {
      this.emit('player.ducked'); return true;
    }
    return false;
  }
  roofUnder(x, distance) {
    return TRACK.find(h => h.type === 'train'
      && Math.abs(x - laneX(h.lane)) < RULES.trainWidth / 2 + 0.02
      && Math.abs(distance - h.distance) <= RULES.trainLength / 2 + 0.04);
  }
  tick(dt) {
    const m = this.motion, beforeY = m.upOffset;
    const support = this.roofUnder(m.lateralOffset, m.distance);
    m.floorUp = support && m.upOffset >= RULES.roofHeight - 0.002 ? RULES.roofHeight : 0;
    if (m.grounded && m.upOffset > m.floorUp + 0.002) m.grounded = false;
    m.step(dt);
    const under = this.roofUnder(m.lateralOffset, m.distance);
    if (under && beforeY >= RULES.roofHeight - 0.002
        && m.upOffset <= RULES.roofHeight && m.verticalVelocity <= 0) {
      m.upOffset = RULES.roofHeight; m.verticalVelocity = 0;
      m.floorUp = RULES.roofHeight; m.grounded = true;
      m.position.y = m.upOffset;
    }
    if (!under && m.floorUp > 0) { m.floorUp = 0; m.grounded = false; }
    const newRoof = under && m.grounded && m.upOffset > 0 ? under.id : null;
    if (newRoof && newRoof !== this.roofId) this.emit('roof.landed', {hazard: newRoof, height: m.upOffset});
    if (this.roofId && !newRoof) this.emit('roof.left', {hazard: this.roofId});
    this.roofId = newRoof;
    this.elapsed += dt;
    // Solids resolve before resources and victory, so a collision cannot also win.
    for (const h of TRACK) {
      const depth = h.type === 'train' ? RULES.trainLength / 2 + 0.08 : 0.28;
      const width = h.type === 'train' ? RULES.trainWidth / 2 + 0.02 : 1.24;
      const overlap = Math.abs(m.distance - h.distance) < depth + RULES.halfDepth
        && Math.abs(m.lateralOffset - laneX(h.lane)) < width + RULES.radius;
      if (overlap) {
        this.contacts.add(h.id);
        const crash = h.type === 'train' ? m.upOffset < RULES.roofHeight - 0.025
          : m.upOffset + m.colliderHeight > RULES.barrierBottom
            && m.upOffset < RULES.barrierTop;
        if (crash) {
          this.finish('LOST', h.type === 'train'
            ? 'You hit a train. Jump earlier to reach the roof, or change lanes.'
            : 'You hit a barrier. Press Down to slide beneath it.');
          return;
        }
      }
      if (!this.cleared.has(h.id) && m.distance > h.distance + depth + RULES.halfDepth) {
        this.cleared.add(h.id);
        if (this.contacts.has(h.id)) this.emit(h.type === 'train' ? 'train.cleared' : 'barrier.cleared', {hazard: h.id});
      }
    }
    for (const coin of COINS) {
      if (this.collected.has(coin.id)) continue;
      if (Math.abs(m.distance - coin.distance) < 0.75
          && Math.abs(m.lateralOffset - laneX(coin.lane)) < 0.67
          && coin.height >= m.upOffset - 0.34
          && coin.height <= m.upOffset + m.colliderHeight + 0.34) {
        this.collected.add(coin.id); this.score += 1;
        this.emit('coin.collected', {coin: coin.id, score: this.score, height: coin.height});
      }
    }
    if (this.score >= RULES.targetScore) this.finish('WON', `All ${RULES.targetScore} coins collected!`);
    else if (m.distance >= RULES.finish) this.finish('LOST', `End of the line: ${this.score}/${RULES.targetScore} coins. Press R to try again.`);
  }
  step(dt) {
    const previousId = this.eventId;
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('dt must be finite and nonnegative');
    if (this.state === 'READY') {
      // No physics on the starting line, but time still passes so the idle
      // animation plays and the model keeps receiving frames that change.
      this.elapsed += dt;
      return [];
    }
    let remaining = dt;
    while (remaining > 1e-9 && this.state === 'RUNNING') {
      const step = Math.min(remaining, RULES.step); this.tick(step); remaining -= step;
    }
    return this.events.filter(e => e.id > previousId).map(e => ({...e}));
  }
  get cue() {
    if (this.state === 'READY') return 'ready';
    if (this.state !== 'RUNNING') return 'finished';
    const m = this.motion;
    const preferred = m.distance >= 132 ? 1 : m.distance >= 78 ? 0 : 1;
    if (m.targetLaneIndex !== preferred) return m.targetLaneIndex > preferred ? 'lane-left' : 'lane-right';
    if (this.roofId) return 'on-roof';
    const near = TRACK.filter(h => h.lane === m.targetLaneIndex && !this.cleared.has(h.id))
      .sort((a,b) => a.distance - b.distance)[0];
    if (!near) return 'run';
    const gap = near.distance - (near.type === 'train' ? RULES.trainLength / 2 : 0) - m.distance;
    if (near.type === 'train' && gap < 6.8 && gap > -1 && m.grounded) return 'train-jump';
    if (near.type === 'train' && gap >= 6.8 && gap < 16) return 'train-ahead';
    if (near.type === 'barrier' && gap < 5 && gap > -1 && m.grounded) return 'barrier-slide';
    return 'run';
  }
  read() {
    const m = this.motion;
    return {state:this.state, roundId:this.roundId, elapsed:this.elapsed,
      terminalCount:this.terminalCount, outcomeReason:this.outcomeReason,
      score:this.score, targetScore:RULES.targetScore, distance:m.distance,
      laneIndex:m.laneIndex, targetLaneIndex:m.targetLaneIndex, x:m.lateralOffset,
      height:m.upOffset, grounded:m.grounded, ducking:m.ducking,
      onRoof:this.roofId !== null, roofId:this.roofId, cue:this.cue,
      collected:[...this.collected], events:this.events.map(e => ({...e}))};
  }
}
