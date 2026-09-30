export const TARGET_SCORE = 600;
export const START_HEALTH = 100;
export const HIT_SCORE = 100;

export class RoundRules {
  constructor() { this.reset(); }
  reset() {
    this.state = 'RUNNING';
    this.elapsed = 0;
    this.score = 0;
    this.health = START_HEALTH;
    this.hits = 0;
    this.deaths = 0;
    this.wallHits = 0;
    this.terminalCount = 0;
    this.outcomeReason = '';
    this.events = [];
    this.eventId = 0;
    this.roundId = (this.roundId || 0) + 1;
    this.personHits = new Map();
    this.queue = [];
  }
  hit(personId = 'unknown') { if (this.state === 'RUNNING') this.queue.push({ type: 'hit', personId }); }
  wallDamage(amount = 20) { if (this.state === 'RUNNING') this.queue.push({ type: 'wall', amount }); }
  _emit(type, data = {}) {
    const event = { id: ++this.eventId, type, ...data };
    this.events.push(event);
    if (this.events.length > 32) this.events.shift();
    return event;
  }
  step(dt = 1 / 60) {
    const emitted = [];
    if (this.state === 'RUNNING') {
      this.elapsed += Math.max(0, Number.isFinite(dt) ? dt : 0);
      for (const action of this.queue.splice(0)) {
        if (action.type === 'hit') {
          const previous = this.personHits.get(action.personId) || 0;
          if (previous >= 2) continue;
          const count = previous + 1;
          this.personHits.set(action.personId, count);
          this.hits += 1;
          this.score += HIT_SCORE;
          emitted.push(this._emit('ped.hit', { personId: action.personId, count, score: this.score }));
          if (count >= 2) {
            this.deaths += 1;
            emitted.push(this._emit('ped.death', { personId: action.personId, deaths: this.deaths, score: this.score }));
          }
        } else if (action.type === 'wall') {
          this.wallHits += 1;
          this.health = Math.max(0, this.health - Math.max(0, action.amount));
          emitted.push(this._emit('wall.crash', { health: this.health, wallHits: this.wallHits }));
        }
      }
      // Destruction has precedence when a crash and the last score share a tick.
      if (this.health <= 0) {
        this.state = 'LOST';
        this.outcomeReason = '撞墙导致车辆耐久耗尽';
        this.terminalCount = 1;
        emitted.push(this._emit('round.lost', { reason: this.outcomeReason }));
      } else if (this.score >= TARGET_SCORE) {
        this.state = 'WON';
        this.outcomeReason = `已达到 ${TARGET_SCORE} 分目标`;
        this.terminalCount = 1;
        emitted.push(this._emit('round.won', { reason: this.outcomeReason }));
      }
    } else {
      this.queue.length = 0;
    }
    return emitted;
  }
  get isResolved() { return this.state === 'WON' || this.state === 'LOST'; }
}

export function snapshotRules(rules) {
  return {
    state: rules.state, roundId: rules.roundId, elapsed: rules.elapsed,
    terminalCount: rules.terminalCount, score: rules.score, health: rules.health,
    hits: rules.hits, deaths: rules.deaths, wallHits: rules.wallHits,
    outcomeReason: rules.outcomeReason,
    events: rules.events.slice(), frame: { id: 0, rawDt: 0, simDt: 0 },
  };
}
