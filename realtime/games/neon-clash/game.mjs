import { ResourcePool } from '/assets/gameplay/ResourcePool.js';

export const ATTACKS = Object.freeze({
  punch: { startup: 0.12, active: 0.14, recovery: 0.20, range: 1.70, damage: 10, push: 2.6 },
  kick: { startup: 0.23, active: 0.16, recovery: 0.29, range: 2.38, damage: 17, push: 4.0 },
});
const EDGE = 9.0;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const free = f => f.action === 'idle' || f.action === 'guard';
function fighter(id, x, facing) {
  return {
    id, x, y: 0, vy: 0, push: 0, facing, moving: false,
    health: new ResourcePool({ id: `${id}-health`, initial: 100, max: 100 }),
    action: 'idle', actionTime: 0, actionDuration: 1, attack: null, hit: false,
    punches: 0, kicks: 0, punchHits: 0, kickHits: 0, jumps: 0, blocks: 0,
    damage: 0, combo: 0, maxCombo: 0, lastHitAt: -100,
  };
}

// One owner for input acceptance, combat, health, and round transitions.
export function createGame({ onTransition = () => {} } = {}) {
  const g = {
    roundId: 0,
    reset() {
      // A fresh round waits in READY until the first gameplay input.
      this.roundId += 1; this.state = 'READY'; this.paused = false;
      this.elapsed = 0; this.readyTime = 0; this.terminalCount = 0; this.outcomeReason = null;
      this.events = []; this.eventId = 0; this.hitStop = 0;
      this.player = fighter('player', -3.4, 1); this.rival = fighter('rival', 3.4, -1);
      this.aiWait = 1.05; this.aiTurn = 0; this.pendingAttack = null; this.pendingJump = false;
      this.feedback = ''; this.feedbackUntil = 0; this.lastImpact = null;
      onTransition('restart');
    },
    // READY -> RUNNING. The clock starts from 0 so FIGHT! and the match timer
    // begin right after the start press.
    start() {
      if (this.state !== 'READY') return;
      this.state = 'RUNNING'; this.elapsed = 0;
      this.emit('round.started');
    },
    emit(type, fields = {}) {
      this.events.push({ id: ++this.eventId, type, elapsed: this.elapsed, ...fields });
      if (this.events.length > 96) this.events.shift();
    },
    pause(value = !this.paused) {
      if (this.state !== 'RUNNING' || this.paused === value) return;
      this.paused = value; this.pendingAttack = null; this.pendingJump = false;
      this.player.moving = false; this.rival.moving = false;
      if (this.player.action === 'guard') this.player.action = 'idle';
      onTransition(value ? 'pause' : 'resume');
    },
    handleInput(input) {
      if (input.consumePress('pause')) { this.pause(); return; }
      const jump = input.consumePress('jump');
      const punch = input.consumePress('punch');
      const kick = input.consumePress('kick');
      if (this.state === 'READY') {
        // The start press only starts the duel; it never also jumps or strikes.
        if (jump || punch || kick || input.isDown('left') || input.isDown('right') || input.isDown('guard')) this.start();
        return;
      }
      if (this.state !== 'RUNNING' || this.paused) return;
      if (jump) this.pendingJump = true;
      if (punch || kick) this.pendingAttack = { kind: kick ? 'kick' : 'punch', until: this.elapsed + 0.18 };
    },
    startAttack(f, kind) {
      if (!free(f)) return false;
      const base = ATTACKS[kind];
      f.attack = { ...base, startup: base.startup + (f.id === 'rival' ? 0.22 : 0), damage: f.id === 'rival' ? (kind === 'kick' ? 13 : 9) : base.damage };
      f.action = kind; f.actionTime = 0; f.actionDuration = f.attack.startup + base.active + base.recovery;
      f.hit = false; f.moving = false; f[kind === 'kick' ? 'kicks' : 'punches']++;
      this.emit('combat.attack', { actor: f.id, kind });
      return true;
    },
    drivePlayer(dt, input) {
      const f = this.player;
      if (this.pendingJump) {
        if (f.y === 0 && free(f)) {
          f.vy = 8.4; f.y = 0.001; f.action = 'idle'; f.jumps++;
          this.emit('combat.jump', { actor: f.id });
        }
        this.pendingJump = false;
      }
      if (this.pendingAttack) {
        if (this.elapsed > this.pendingAttack.until) this.pendingAttack = null;
        else if (free(f)) { this.startAttack(f, this.pendingAttack.kind); this.pendingAttack = null; }
      }
      if (free(f)) {
        const guarding = input.isDown('guard') && f.y === 0;
        f.action = guarding ? 'guard' : 'idle';
        const axis = guarding ? 0 : input.axis('left', 'right');
        f.moving = axis !== 0;
        f.x += axis * (f.y > 0 ? 3.1 : 3.8) * dt;
      } else f.moving = false;
    },
    driveRival(dt) {
      const f = this.rival, p = this.player;
      this.aiWait = Math.max(0, this.aiWait - dt);
      if (!free(f)) { f.moving = false; return; }
      if (f.action === 'guard') {
        if (f.actionTime < f.actionDuration) return;
        f.action = 'idle'; this.aiWait = 0.24;
      }
      const distance = Math.abs(p.x - f.x);
      if (distance > 1.65) {
        f.x += Math.sign(p.x - f.x) * 2.05 * dt; f.moving = true;
      } else f.moving = false;
      if (this.aiWait <= 0 && distance <= 2.15 && p.y < 1.35) {
        this.aiTurn++;
        if (this.aiTurn % 4 === 0) {
          f.action = 'guard'; f.actionTime = 0; f.actionDuration = 0.55; f.moving = false;
        } else {
          this.startAttack(f, this.aiTurn % 3 === 0 || distance > 1.85 ? 'kick' : 'punch');
          this.aiWait = 1.32;
        }
      }
    },
    tickFighter(f, dt) {
      f.actionTime += dt;
      if (!free(f) && f.actionTime >= f.actionDuration) {
        f.action = 'idle'; f.actionTime = 0; f.attack = null;
      }
      if (f.y > 0 || f.vy > 0) {
        f.vy -= 22 * dt; f.y = Math.max(0, f.y + f.vy * dt);
        if (f.y === 0) f.vy = 0;
      }
      f.x = clamp(f.x + f.push * dt, -EDGE, EDGE);
      f.push *= Math.exp(-10 * dt);
      if (this.elapsed - f.lastHitAt > 1.6) f.combo = 0;
    },
    eligible(a, b) {
      return a.attack && !a.hit && a.actionTime >= a.attack.startup && a.actionTime <= a.attack.startup + a.attack.active
        && (b.x - a.x) * a.facing > 0 && Math.abs(a.x - b.x) <= a.attack.range && Math.abs(a.y - b.y) < 1.12;
    },
    strike(a, b, attack, kind) {
      a.hit = true;
      const blocked = b.action === 'guard' && b.y === 0 && (a.x - b.x) * b.facing > 0;
      const damage = blocked ? Math.ceil(attack.damage * 0.18) : attack.damage;
      const before = b.health.value; b.health.lose(damage); b.health.drainEvents();
      a.damage += before - b.health.value;
      a[kind === 'kick' ? 'kickHits' : 'punchHits']++;
      b.push = a.facing * attack.push * (blocked ? 0.32 : 1);
      if (blocked) b.blocks++;
      else {
        b.action = 'hurt'; b.actionTime = 0; b.actionDuration = kind === 'kick' ? 0.32 : 0.22;
        b.attack = null; b.moving = false; b.combo = 0;
        a.combo = this.elapsed - a.lastHitAt < 1.6 ? a.combo + 1 : 1;
        a.maxCombo = Math.max(a.maxCombo, a.combo); a.lastHitAt = this.elapsed;
      }
      const impact = { actor: a.id, target: b.id, kind, blocked, damage: before - b.health.value, x: (a.x + b.x) / 2, y: Math.max(a.y, b.y) + 1.65, facing: a.facing };
      this.emit('combat.hit', impact);
      this.lastImpact = { ...impact, id: this.eventId };
      this.hitStop = blocked ? 0.02 : (kind === 'kick' ? 0.055 : 0.035);
      this.feedback = blocked ? 'GUARDED' : a.id === 'player' ? (a.combo > 1 ? `${a.combo} HIT COMBO` : kind === 'kick' ? 'CLEAN KICK' : 'NICE PUNCH') : 'COUNTER HIT';
      this.feedbackUntil = this.elapsed + 0.68;
    },
    finish(state) {
      if (this.state !== 'RUNNING') return;
      this.state = state; this.terminalCount++;
      this.outcomeReason = state === 'WON' ? 'Rival knocked out' : 'Player knocked out';
      this.pendingAttack = null; this.pendingJump = false; this.hitStop = 0;
      for (const f of [this.player, this.rival]) {
        f.moving = false; f.push = 0; f.vy = 0; f.y = 0;
        f.action = f.health.isDepleted ? 'ko' : 'victory';
        // Host freezes update after WON/LOST, so land the terminal pose immediately.
        f.actionTime = f.health.isDepleted ? 1 : 0;
        f.actionDuration = 1;
        f.attack = null;
      }
      this.emit(state === 'WON' ? 'round.won' : 'round.lost', { reason: this.outcomeReason });
      onTransition('terminal');
    },
    update(dt, input) {
      // READY: rival, clock and combat hold; only the idle stance animates.
      if (this.state === 'READY') { this.readyTime += dt; return false; }
      if (this.state !== 'RUNNING' || this.paused) return false;
      this.elapsed += dt;
      if (this.hitStop > 0) { this.hitStop = Math.max(0, this.hitStop - dt); return; }
      const p = this.player, r = this.rival;
      this.tickFighter(p, dt); this.tickFighter(r, dt);
      this.drivePlayer(dt, input); this.driveRival(dt);
      p.x = clamp(p.x, -EDGE, EDGE); r.x = clamp(r.x, -EDGE, EDGE);
      // Fighters can cross freely. Face the opponent after all movement,
      // including during attacks or hit stun, before resolving hit direction.
      // At identical positions retain the last facing to avoid flicker.
      const direction = Math.sign(r.x - p.x);
      if (direction !== 0) { p.facing = direction; r.facing = -direction; }
      // Resolve from one contact snapshot so simultaneous strikes can trade.
      const hits = [];
      if (this.eligible(p, r)) hits.push([p, r, p.attack, p.action]);
      if (this.eligible(r, p)) hits.push([r, p, r.attack, r.action]);
      for (const hit of hits) this.strike(...hit);
      // Rival depletion resolves victory, including a simultaneous final hit.
      if (r.health.isDepleted) this.finish('WON');
      else if (p.health.isDepleted) this.finish('LOST');
      return this.state === 'RUNNING';
    },
    read() {
      const snapshot = f => ({
        x: f.x, y: f.y, facing: f.facing, hp: f.health.value, moving: f.moving,
        action: f.action, actionTime: f.actionTime, actionDuration: f.actionDuration,
        grounded: f.y === 0, ready: free(f), punches: f.punches, kicks: f.kicks,
        punchHits: f.punchHits, kickHits: f.kickHits, jumps: f.jumps, blocks: f.blocks,
        damage: f.damage, combo: f.combo, maxCombo: f.maxCombo,
        telegraph: !!f.attack && f.actionTime < f.attack.startup,
      });
      return {
        state: this.state, roundId: this.roundId, paused: this.paused, elapsed: this.elapsed, readyTime: this.readyTime,
        terminalCount: this.terminalCount, outcomeReason: this.outcomeReason,
        player: snapshot(this.player), rival: snapshot(this.rival),
        distance: Math.abs(this.player.x - this.rival.x),
        rivalDirection: Math.sign(this.rival.x - this.player.x),
        feedback: this.elapsed < this.feedbackUntil ? this.feedback : '',
        impact: this.lastImpact ? { ...this.lastImpact } : null,
        events: this.events.map(e => ({ ...e })),
        diagnostics: {
          inputApplied: { moving: this.player.moving, action: this.player.action },
          contact: { grounded: this.player.y === 0, arenaEdge: Math.abs(this.player.x) >= EDGE - 0.01, bodyGap: Math.abs(this.player.x - this.rival.x) },
          activation: { rivalActive: this.state === 'RUNNING' && !this.paused },
          attackWindow: { player: this.eligible(this.player, this.rival) === true, rival: this.eligible(this.rival, this.player) === true },
          targetFilter: { distance: Math.abs(this.player.x - this.rival.x), heightDifference: Math.abs(this.player.y - this.rival.y) },
        },
      };
    },
  };
  g.reset();
  return g;
}
