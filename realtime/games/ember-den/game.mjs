// SPDX-License-Identifier: Apache-2.0
// Ember Den rules: axe melee against three spiders in a firelit basalt cave.
import { FpsSim, wrap } from './lib/fps-core.mjs';

export const ARENA = { minX: -5.4, maxX: 5.4, minZ: -36, maxZ: 11 };
// Boulders double as collision boxes and as scene meshes.
export const ROCKS = [
  { x: -3.9, z: 1, hx: .9, hz: 1.1, h: 1.5 }, { x: 3.8, z: -6, hx: 1, hz: 1.2, h: 1.7 },
  { x: -2.6, z: -11, hx: .8, hz: .8, h: 1.2 }, { x: 2.4, z: -17, hx: .9, hz: .9, h: 1.3 },
  { x: -4, z: -23, hx: 1.1, hz: 1.2, h: 1.8 }, { x: 4, z: -28, hx: 1, hz: 1, h: 1.5 },
];
export const SWING = { wind: .16, strike: .1, recover: .3, range: 3.2, arc: .8, damage: 30 };

export function createGame() {
  const sim = new FpsSim({
    seed: 21, maxHealth: 100, loseText: 'Spider bites reduced your health to zero.',
    bounds: ARENA, obstacles: ROCKS, playerStart: { x: 0, z: 8, yaw: 0 },
    movement: { speed: 3.3, radius: .45 },
    makeEnemies: () => [
      { x: .6, z: -5, hp: 90, speed: 2.3, radius: .85, height: 1.1 },
      { x: -2.4, z: -8.5, hp: 90, speed: 2.1, radius: .85, height: 1.1 },
      { x: 2.4, z: -12, hp: 90, speed: 2.0, radius: .85, height: 1.1 },
    ],
    init: () => ({ swing: null, swings: 0, hits: 0 }),
    press(sim, k) { if (k.consumePress('fire')) startSwing(sim); },
    step(sim, dt, k) {
      const s = sim.s;
      if (k.isDown('fire')) startSwing(sim);
      if (s.swing) {
        const w = s.swing;
        w.t += dt;
        if (!w.struck && w.t >= SWING.wind) { w.struck = true; strike(sim); }
        if (w.t >= SWING.wind + SWING.strike + SWING.recover) s.swing = null;
      }
      spiders(sim, dt);
    },
    check(sim) {
      if (sim.s.kills >= 3) sim.end('WON', 'All three spiders are dead.');
    },
    read: (sim) => ({ swingT: sim.s.swing ? sim.s.swing.t : -1 }),
  });
  function startSwing(sim) {
    const s = sim.s;
    if (s.swing || s.cooldown > 0) return;
    s.swing = { t: 0, struck: false };
    s.cooldown = SWING.wind + SWING.strike + SWING.recover + .08;
    s.swings++;
    sim.emit('melee.swung');
  }
  function strike(sim) {
    const s = sim.s, p = s.player;
    let hit = false;
    for (const e of s.enemies) {
      if (e.hp <= 0) continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z) - e.radius;
      const err = Math.abs(wrap(Math.atan2(e.x - p.x, p.z - e.z) - p.yaw));
      if (d < SWING.range - .4 && err < SWING.arc && p.pitch > -.55) {
        hit = true;
        const pt = { x: e.x - Math.sin(p.yaw) * .4, y: (e.y ?? 0) + .7, z: e.z + Math.cos(p.yaw) * .4 };
        if (e.windup <= 0) e.stun = .25;
        e.knock = { x: Math.sin(p.yaw) * 5.5, z: -Math.cos(p.yaw) * 5.5 };
        sim.emit('melee.hit', { target: e.id, ...pt });
        sim.damageEnemy(e, SWING.damage, { point: pt });
        s.hits++;
      }
    }
    if (!hit) {
      const f = sim.aimDir();
      sim.emit('melee.miss', { x: +(p.x + f.x * 2.2).toFixed(2), y: .6, z: +(p.z + f.z * 2.2).toFixed(2) });
    }
  }
  function spiders(sim, dt) {
    const s = sim.s, p = s.player;
    for (const e of s.enemies) {
      if (e.hp <= 0) continue;
      if (e.knock) {
        sim.moveEnemy(e, e.x + e.knock.x * dt, e.z + e.knock.z * dt);
        e.knock.x *= Math.max(0, 1 - 7 * dt); e.knock.z *= Math.max(0, 1 - 7 * dt);
        if (Math.hypot(e.knock.x, e.knock.z) < .1) e.knock = null;
      }
      if (e.stun > 0) continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      e.walking = false;
      if (e.windup > 0) {
        e.windup -= dt;
        e.facing = Math.atan2(p.x - e.x, p.z - e.z);
        if (e.windup <= 0) {
          // The lunge lands only if the player is still close and not airborne.
          if (Math.hypot(e.x - p.x, e.z - p.z) < 3.7 && p.y < .85) { sim.emit('enemy.bite', { target: e.id }); sim.damagePlayer(16, { from: e }); }
          else sim.emit('bite.dodged', { target: e.id });
          e.attackT = 1.3;
        }
        continue;
      }
      e.attackT -= dt;
      if (d > 3.3) { sim.steer(e, p.x, p.z, e.speed, dt); e.walking = true; }
      else {
        e.facing = Math.atan2(p.x - e.x, p.z - e.z);
        if (e.attackT <= 0) { e.windup = .5; sim.emit('enemy.attack', { target: e.id }); }
      }
    }
  }
  return sim.api();
}
