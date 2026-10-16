// SPDX-License-Identifier: Apache-2.0
// Iron Colossus rules: a giant reptile breathes fire and stomps to demolish six defended towers.
import { FpsSim, wrap, clamp } from './lib/fps-core.mjs';

export const ARENA = { minX: -15, maxX: 15, minZ: -40, maxZ: 16 };
// Six defence towers in two rows; they shoot shells at the monster until destroyed.
export const TOWERS = [
  [-6, -10], [6, -10], [-6, -20], [6, -20], [-6, -30], [6, -30],
].map(([x, z], i) => ({ x, z, hp: 100, radius: 1.9, height: 7.5, shellCd: 1.4 + i * .45 }));
// Non-target city blocks framing the avenue.
export const BLOCKS = [
  [-12.5, 6, 3, 3, 9], [12.5, 8, 3, 3, 11], [-12.5, -3, 3, 4, 14], [12.5, -2, 3, 3.5, 12], [-12.5, -16, 3, 4, 10], [12.5, -14, 3, 4, 15],
  [-12.5, -26, 3, 3.5, 12], [12.5, -26, 3, 4, 9], [-12.5, -36, 3, 3, 13], [12.5, -36, 3, 3, 10], [-3, -38, 5, 2, 8], [4, -38, 4, 2, 11],
].map(([x, z, hx, hz, h]) => ({ x, z, hx, hz, h }));
export const FLAME = { range: 15, arc: .62, dps: 40, maxHeat: 100 };
const STOMP = { radius: 6.5, damage: 70, cd: 2 };

export function createGame() {
  const sim = new FpsSim({
    seed: 91, maxHealth: 150, loseText: 'Defense shells reduced the colossus to zero health.',
    bounds: ARENA, obstacles: BLOCKS.map((b) => ({ ...b, shotsPass: true })), playerStart: { x: 0, z: 9, yaw: 0 },
    movement: { speed: 4.2, radius: 1.2, aim: 1.4, canJump: false }, noJump: true,
    makeEnemies: () => [],
    init: () => ({
      towers: TOWERS.map((t) => ({ ...t })), heat: 0, overheated: false, breathing: false, stompCd: 0, stomps: 0, jumpCount: 0,
      breathT: 0, stompT: -1, towersLeft: TOWERS.length,
    }),
    press(sim, k) { if (k.consumePress('jump')) stomp(sim); },
    step(sim, dt, k) {
      const s = sim.s, p = s.player;
      s.stompCd = Math.max(0, s.stompCd - dt);
      if (s.stompT >= 0) { s.stompT += dt; if (s.stompT > .6) s.stompT = -1; }
      // Flame breath: held F, builds heat, cools down when released.
      const want = k.isDown('fire') && !s.overheated;
      if (want && !s.breathing) sim.emit('flame.breathed');
      s.breathing = want;
      if (want) {
        s.heat = Math.min(FLAME.maxHeat, s.heat + dt * 22); s.breathT += dt;
        if (s.heat >= FLAME.maxHeat) { s.overheated = true; s.breathing = false; sim.emit('flame.overheated'); }
        for (const t of s.towers) {
          if (t.hp <= 0) continue;
          const d = Math.hypot(t.x - p.x, t.z - p.z) - t.radius;
          const err = Math.abs(wrap(Math.atan2(t.x - p.x, p.z - t.z) - p.yaw));
          if (d < FLAME.range && err < FLAME.arc * (1 - Math.min(.5, d / 40))) damageTower(sim, t, FLAME.dps * dt, 'flame');
        }
      } else { s.heat = Math.max(0, s.heat - dt * (s.overheated ? 30 : 18)); if (s.overheated && s.heat <= 20) s.overheated = false; s.breathT = 0; }
      // Defence towers fire shells that arc toward the colossus.
      for (const t of s.towers) {
        if (t.hp <= 0) continue;
        t.shellCd -= dt;
        const d = Math.hypot(t.x - p.x, t.z - p.z);
        if (t.shellCd <= 0 && d < 36) {
          t.shellCd = 3.4 + sim.rnd() * 1.2;
          const o = { x: t.x, y: t.height + .4, z: t.z }, tx = p.x, tz = p.z, ty = 2.2;
          const tf = clamp(d / 17, .8, 2), G = 12;
          sim.spawnProjectile({ type: 'shell', owner: 'enemy', x: o.x, y: o.y, z: o.z, vx: (tx - o.x) / tf, vz: (tz - o.z) / tf, vy: (ty - o.y) / tf + .5 * G * tf, gravity: G, radius: .5, dmg: 7, ttl: 4, from: t.id });
          sim.emit('defense.fired', { x: o.x, y: o.y, z: o.z, tower: TOWERS.indexOf(TOWERS.find((q) => q.x === t.x && q.z === t.z)) });
        }
      }
    },
    check(sim) {
      const s = sim.s;
      s.towersLeft = s.towers.filter((t) => t.hp > 0).length;
      if (s.towersLeft === 0) sim.end('WON', 'Every defense tower has collapsed.');
    },
    projectileHooks: {
      shell: {
        // Shells explode on the ground near the monster; a direct hit on the huge body hurts.
        world(sim, p, pt) {
          const pl = sim.s.player;
          if (Math.hypot(pt.x - pl.x, pt.z - pl.z) < 2.6) { sim.damagePlayer(7, { from: { x: p.x - p.vx, z: p.z - p.vz } }); sim.s.shellHit = true; }
          return true;
        },
        player(sim, p) { sim.damagePlayer(7, { from: { x: p.x - p.vx, z: p.z - p.vz } }); },
      },
    },
    read: (sim) => {
      const s = sim.s, p = s.player;
      const live = s.towers.filter((t) => t.hp > 0).map((t) => ({ t, d: Math.hypot(t.x - p.x, t.z - p.z), err: wrap(Math.atan2(t.x - p.x, p.z - t.z) - p.yaw) })).sort((a, b) => a.d - b.d)[0];
      return { building: live ? { error: live.err, distance: live.d, hp: live.t.hp } : { error: 0, distance: 0, hp: 0 }, towersLeft: s.towers.filter((t) => t.hp > 0).length };
    },
  });
  function damageTower(sim, t, dmg, by) {
    if (t.hp <= 0) return;
    const was = t.hp;
    t.hp = Math.max(0, t.hp - dmg);
    const idx = TOWERS.findIndex((q) => q.x === t.x && q.z === t.z);
    if (by === 'stomp' || Math.floor(was / 20) !== Math.floor(t.hp / 20)) sim.emit('building.hit', { tower: idx, x: t.x, y: 3, z: t.z, by });
    if (t.hp === 0) { sim.s.kills++; sim.emit('building.collapsed', { tower: idx, x: t.x, y: 0, z: t.z }); }
  }
  function stomp(sim) {
    const s = sim.s, p = s.player;
    if (s.stompCd > 0) return;
    s.stompCd = STOMP.cd; s.stomps++; s.stompT = 0;
    sim.emit('ground.stomped', { x: p.x, y: 0, z: p.z });
    for (const t of s.towers) if (t.hp > 0 && Math.hypot(t.x - p.x, t.z - p.z) - t.radius < STOMP.radius) damageTower(sim, t, STOMP.damage, 'stomp');
  }
  return sim.api();
}
