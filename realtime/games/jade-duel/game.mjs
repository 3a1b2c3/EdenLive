// SPDX-License-Identifier: Apache-2.0
// Jade Duel rules: a side-view duel with combos, guard, uppercut, energy wave and dash.
import { mulberry32, clamp } from '../_shared/fps-core.mjs';

export const STAGE = { minX: -7.2, maxX: 7.2, gap: 1.15 };
export const COMBO = { window: 1.1, hits: 3 };
const DAMAGE = [9, 10, 15];           // combo hit 1, 2, 3
const COSTS = { uppercut: 15, wave: 30, dash: 10 };
const ENERGY_MAX = 60;

export function createGame() {
  let s, seq = 0, round = 0, rnd;
  const emit = (type, data = {}) => { s.events.push({ id: ++seq, type, t: +s.elapsed.toFixed(3), ...data }); if (s.events.length > 80) s.events = s.events.slice(-80); };
  function reset() {
    rnd = mulberry32(300 + round);
    s = {
      state: 'RUNNING', roundId: ++round, elapsed: 0, terminalCount: 0, outcomeReason: '', events: [], paused: false,
      player: { x: -2.6, y: 0, vy: 0, facing: 1, anim: 'idle', animT: 0, comboStep: 0, comboAt: -9, hurtT: 0, dashT: 0, moving: false },
      health: 100, maxHealth: 100, energy: ENERGY_MAX, guarding: false, cooldown: 0, special: 0, blocked: 0,
      opponent: { x: 2.6, y: 0, vy: 0, hp: 100, maxHp: 100, facing: -1, anim: 'idle', animT: 0, attackT: 1.4, windup: 0, hurtT: 0, stun: 0, guardT: 0, airT: 0 },
      projectiles: [], pid: 0, combo: 0, hits: 0, comboHits: 0, kills: 0, jumpCount: 0,
    };
  }
  function end(state, reason) { if (s.state !== 'RUNNING') return; s.state = state; s.outcomeReason = reason; s.terminalCount++; emit(state === 'WON' ? 'round.won' : 'round.lost', { reason }); }
  const dist = () => Math.abs(s.opponent.x - s.player.x);
  const setAnim = (a, name, t = 0) => { a.anim = name; a.animT = t; };

  function hitOpponent(dmg, { knock = 3, launch = 0, label = 'hit' } = {}) {
    const o = s.opponent;
    // Opponent blocks roughly one light attack in three while it is not busy.
    if (o.guardT > 0 && label !== 'uppercut' && label !== 'wave') {
      emit('enemy.guarded', { x: o.x, y: 1.3 });
      o.x = clamp(o.x + s.player.facing * .25, STAGE.minX, STAGE.maxX);
      return false;
    }
    o.hp = Math.max(0, o.hp - dmg); o.hurtT = .3; o.stun = launch ? .6 : .28; o.windup = 0;
    o.x = clamp(o.x + s.player.facing * knock * .12, STAGE.minX, STAGE.maxX);
    if (launch) { o.vy = launch; }
    setAnim(o, launch ? 'launched' : 'hurt');
    s.hits++;
    emit('enemy.hit', { target: 0, damage: dmg, x: +o.x.toFixed(2), y: launch ? 1.8 : 1.3, label, by: 'player', killed: o.hp === 0 });
    if (o.hp === 0) { s.kills++; emit('enemy.defeated', { target: 0, x: o.x, y: 1.2 }); end('WON', 'Your opponent is knocked out.'); }
    return true;
  }
  function damagePlayer(dmg) {
    const p = s.player;
    if (s.guarding && !s.player.y) { s.blocked++; emit('strike.blocked', { x: p.x, y: 1.3 }); p.x = clamp(p.x - p.facing * .3, STAGE.minX, STAGE.maxX); s.energy = Math.min(ENERGY_MAX, s.energy + 3); return; }
    if (p.y > .9) { emit('strike.dodged', { x: p.x, y: p.y + 1 }); return; }
    s.health = Math.max(0, s.health - dmg); p.hurtT = .3; setAnim(p, 'hurt');
    emit('player.hit', { damage: dmg, health: s.health, angle: 0, x: +p.x.toFixed(2), y: 1.3 });
    emit('opponent.struck', { x: p.x, y: 1.3 });
    if (s.health <= 0) end('LOST', 'Your health reached zero.');
  }

  function handleInput(k) {
    if (k.consumePress('restart')) { reset(); k.clear(); return; }
    if (k.consumePress('pause') && s.state === 'RUNNING') { s.paused = !s.paused; k.clear(); return; }
    if (s.state !== 'RUNNING' || s.paused) return;
    const p = s.player;
    s.guarding = k.isDown('guard') && p.y === 0;
    if (k.consumePress('jump') && p.y === 0 && !s.guarding) { p.vy = 7.2; s.jumpCount++; setAnim(p, 'jump'); emit('player.jumped'); }
    if (k.consumePress('fire') && !s.guarding && s.cooldown <= 0 && p.animT >= 0) comboStrike();
    if (k.consumePress('special') && s.special <= 0 && s.energy >= COSTS.uppercut) uppercut();
    if (k.consumePress('reload') && s.special <= 0 && s.energy >= COSTS.wave) wave();
    if (k.consumePress('dash') && s.special <= 0 && s.energy >= COSTS.dash) dash();
  }
  function comboStrike() {
    const p = s.player, o = s.opponent;
    s.comboHits = (s.elapsed - p.comboAt < COMBO.window) ? (s.comboHits % COMBO.hits) + 1 : 1;
    p.comboAt = s.elapsed; s.combo = s.comboHits;
    s.cooldown = s.comboHits === 3 ? .5 : .28;
    setAnim(p, `combo${s.comboHits}`);
    emit('combo.struck', { step: s.comboHits, x: +p.x.toFixed(2), y: 1.4, facing: p.facing });
    p.strikeAt = s.elapsed + .1; p.strikeStep = s.comboHits;
  }
  function uppercut() {
    const p = s.player;
    s.energy -= COSTS.uppercut; s.special = .8; setAnim(p, 'uppercut');
    emit('uppercut.struck', { x: +p.x.toFixed(2), y: 1.4, facing: p.facing });
    p.strikeAt = s.elapsed + .14; p.strikeStep = 'uppercut';
  }
  function wave() {
    const p = s.player;
    s.energy -= COSTS.wave; s.special = .9; setAnim(p, 'wave');
    emit('wave.launched', { x: +p.x.toFixed(2), y: 1.3, facing: p.facing });
    p.strikeAt = s.elapsed + .2; p.strikeStep = 'wave';
  }
  function dash() {
    const p = s.player, o = s.opponent;
    s.energy -= COSTS.dash; s.special = .5; p.dashT = .22; setAnim(p, 'dash');
    emit('player.dashed', { x: +p.x.toFixed(2), y: 1, facing: p.facing });
  }

  function update(dt, k) {
    if (s.state !== 'RUNNING' || s.paused) return false;
    s.elapsed += dt;
    const p = s.player, o = s.opponent;
    s.cooldown = Math.max(0, s.cooldown - dt); s.special = Math.max(0, s.special - dt);
    s.energy = Math.min(ENERGY_MAX, s.energy + dt * 4);
    if (s.elapsed - p.comboAt > COMBO.window + .2) s.combo = 0;
    p.animT += dt; o.animT += dt; p.hurtT = Math.max(0, p.hurtT - dt); o.hurtT = Math.max(0, o.hurtT - dt);
    p.facing = Math.sign(o.x - p.x) || p.facing; o.facing = -p.facing;
    // player movement (1-D) with jump and dash
    const mv = k.axis('left', 'right');
    p.moving = !!mv && !s.guarding;
    if (p.dashT > 0) { p.dashT -= dt; p.x += p.facing * 14 * dt; }
    else if (!s.guarding && p.animT > .12) p.x += mv * 3.4 * dt;
    p.x = clamp(p.x, STAGE.minX, STAGE.maxX);
    if (p.y > 0 || p.vy > 0) { p.vy -= 18 * dt; p.y = Math.max(0, p.y + p.vy * dt); if (p.y === 0) { p.vy = 0; if (p.anim === 'jump') setAnim(p, 'idle'); } }
    // keep fighters from passing through each other
    const gap = STAGE.gap, sep = o.x - p.x;
    if (Math.abs(sep) < gap && (p.y < 1 || o.y < 1)) { const push = (gap - Math.abs(sep)) / 2 * Math.sign(sep || 1); p.x = clamp(p.x - push, STAGE.minX, STAGE.maxX); o.x = clamp(o.x + push, STAGE.minX, STAGE.maxX); }
    // delayed strike resolution
    if (p.strikeAt && s.elapsed >= p.strikeAt) {
      const step = p.strikeStep; p.strikeAt = 0;
      if (step === 'wave') {
        s.projectiles.push({ id: ++s.pid, x: p.x + p.facing * .9, y: 1.3, vx: p.facing * 11, life: 1.4 });
      } else if (step === 'uppercut') {
        if (dist() < 1.9 && o.y < 1.2) hitOpponent(24, { launch: 6.5, knock: 1.5, label: 'uppercut' });
      } else if (dist() < 1.85 && o.y < .9) {
        hitOpponent(DAMAGE[step - 1], { knock: step === 3 ? 6 : 2, label: step === 3 ? 'finisher' : 'punch' });
      } else emit('combo.missed', { x: +p.x.toFixed(2), y: 1.4, facing: p.facing });
    }
    // energy wave
    for (let i = s.projectiles.length - 1; i >= 0; i--) {
      const w = s.projectiles[i]; w.x += w.vx * dt; w.life -= dt;
      if (Math.abs(w.x - o.x) < .8 && o.y < 1.8) { s.projectiles.splice(i, 1); if (hitOpponent(20, { knock: 5, label: 'wave' })) emit('projectile.impact', { x: +o.x.toFixed(2), y: 1.3, surface: 'enemy', owner: 'player', type: 'wave' }); }
      else if (w.life <= 0 || Math.abs(w.x) > 9) s.projectiles.splice(i, 1);
    }
    // opponent
    if (o.vy > 0 || o.y > 0) { o.vy -= 18 * dt; o.y = Math.max(0, o.y + o.vy * dt); if (o.y === 0 && o.vy < 0) { o.vy = 0; if (o.anim === 'launched') setAnim(o, 'idle'); } }
    o.stun = Math.max(0, o.stun - dt); o.guardT = Math.max(0, o.guardT - dt);
    if (o.stun <= 0 && o.y === 0) {
      const d = dist();
      if (o.windup > 0) {
        o.windup -= dt;
        if (o.windup <= 0) { if (dist() < 2.1) damagePlayer(11); else emit('strike.whiffed', { x: o.x, y: 1.3 }); o.attackT = 1.15 + rnd() * .6; setAnim(o, 'recover'); }
      } else {
        o.attackT -= dt;
        if (d > 1.7) { o.x += Math.sign(p.x - o.x) * 1.25 * dt; o.anim = o.anim === 'walk' ? 'walk' : 'walk'; }
        else if (o.anim === 'walk') setAnim(o, 'idle');
        if (o.attackT <= 0 && d < 2.0) { o.windup = .42; setAnim(o, 'windup'); emit('enemy.attack', { x: o.x, y: 1.4 }); }
        else if (o.attackT < 0 && d >= 2.0) o.attackT = 0;
        // Raise a guard when the player is mid-combo; drops quickly so wave and uppercut still work.
        if (o.guardT <= 0 && s.combo >= 2 && rnd() < dt * 1.1) { o.guardT = .55; setAnim(o, 'guard'); emit('enemy.guarding', { x: o.x, y: 1.3 }); }
      }
    }
    o.x = clamp(o.x, STAGE.minX, STAGE.maxX);
  }
  function read() {
    const o = s.opponent, p = s.player;
    return structuredClone({ ...s, duelDistance: dist(), target: { error: 0, distance: dist(), hp: o.hp, stun: o.stun }, opponentHp: o.hp });
  }
  reset();
  return { handleInput, update, read, reset };
}
