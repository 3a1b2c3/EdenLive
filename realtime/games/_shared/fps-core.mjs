// SPDX-License-Identifier: Apache-2.0
// First-person combat rules kernel shared by the Eden first-person games.
// Pure state + rules (no DOM, no Three.js), so it can be replayed headlessly.
// Conventions: Y up, yaw 0 faces -Z, ArrowRight raises yaw, ArrowUp raises pitch.
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EYE = 1.65;
export const forwardOf = (yaw, pitch = 0) => ({
  x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch),
});

export class FpsSim {
  constructor(cfg) {
    this.cfg = cfg;
    this.round = 0;
    this.seq = 0;
    this.reset();
  }

  get alive() { return this.s.enemies.filter((e) => e.hp > 0); }

  reset() {
    const c = this.cfg;
    this.rnd = mulberry32((c.seed ?? 1) + this.round * 977);
    const st = c.playerStart;
    this.s = {
      state: 'RUNNING', roundId: ++this.round, elapsed: 0, terminalCount: 0, outcomeReason: '', events: [], paused: false,
      player: { x: st.x, y: 0, z: st.z, yaw: st.yaw ?? 0, pitch: 0, vy: 0, moving: false },
      health: c.maxHealth ?? 100, maxHealth: c.maxHealth ?? 100, kills: 0, shots: 0, hurtAt: -9, cooldown: 0, jumpCount: 0,
      enemies: c.makeEnemies(this), projectiles: [], pid: 0,
    };
    Object.assign(this.s, c.init?.(this) ?? {});
    this.s.enemies.forEach((e, i) => Object.assign(e, {
      id: i, maxHp: e.hp, radius: e.radius ?? .6, height: e.height ?? 1.9, stun: 0, hitAt: -9, deadAt: -9,
      facing: Math.PI, attackT: 1 + this.rnd() * 1.5, windup: 0, ...e,
    }));
  }

  emit(type, data = {}) {
    const s = this.s;
    s.events.push({ id: ++this.seq, type, t: +s.elapsed.toFixed(3), ...data });
    if (s.events.length > 80) s.events = s.events.slice(-80);
  }
  end(state, reason) {
    const s = this.s;
    if (s.state !== 'RUNNING') return;
    s.state = state;
    s.outcomeReason = reason;
    s.terminalCount++;
    this.emit(state === 'WON' ? 'round.won' : 'round.lost', { reason });
  }

  /* ---------- world queries ---------- */
  obstacleBlocks(x, z, r) {
    const { bounds, obstacles = [] } = this.cfg;
    if (x < bounds.minX + r || x > bounds.maxX - r || z < bounds.minZ + r || z > bounds.maxZ - r) return true;
    for (const o of obstacles) {
      if (o.walkable) continue;
      const cx = clamp(x, o.x - o.hx, o.x + o.hx), cz = clamp(z, o.z - o.hz, o.z + o.hz);
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
    }
    return this.cfg.blockedAt?.(this, x, z, r) ?? false;
  }
  enemyBlocks(x, z, r, self = null) {
    for (const e of this.s.enemies) {
      if (e === self || e.hp <= 0) continue;
      if (Math.hypot(e.x - x, e.z - z) < e.radius + r) return e;
    }
    return null;
  }
  /** Ray against enemies (vertical cylinders), the player, ground, boxes and arena walls. */
  rayCast(o, d, maxT, { enemies = true, player = false, world = true } = {}) {
    const { bounds, obstacles = [] } = this.cfg;
    let best = { t: maxT, kind: null };
    const consider = (t, kind, extra = {}) => { if (t >= 0 && t < best.t) best = { t, kind, ...extra }; };
    if (world) {
      if (d.y < -1e-6) consider(-o.y / d.y, 'ground');
      for (const b of obstacles) {
        if (b.shotsPass) continue;
        const lo = [b.x - b.hx, 0, b.z - b.hz], hi = [b.x + b.hx, b.h ?? 2, b.z + b.hz];
        const oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
        let t0 = 0, t1 = best.t, ok = true;
        for (let i = 0; i < 3 && ok; i++) {
          if (Math.abs(dd[i]) < 1e-8) { if (oo[i] < lo[i] || oo[i] > hi[i]) ok = false; continue; }
          let a = (lo[i] - oo[i]) / dd[i], c = (hi[i] - oo[i]) / dd[i];
          if (a > c) [a, c] = [c, a];
          t0 = Math.max(t0, a); t1 = Math.min(t1, c);
          if (t0 > t1) ok = false;
        }
        if (ok && t0 > 0) consider(t0, 'obstacle', { box: b });
      }
      // Arena walls: leaving the bounds box ends the ray.
      for (const [axis, lim, sign] of [['x', bounds.minX, -1], ['x', bounds.maxX, 1], ['z', bounds.minZ, -1], ['z', bounds.maxZ, 1]]) {
        const dv = d[axis];
        if (dv * sign > 1e-8) consider((lim - o[axis]) / dv, 'bounds');
      }
    }
    const cyl = (cx, cz, r, y0, y1, kind, extra) => {
      const ox = o.x - cx, oz = o.z - cz;
      const a = d.x * d.x + d.z * d.z;
      if (a < 1e-9) return;
      const b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - r * r;
      const disc = b * b - 4 * a * c;
      if (disc < 0) return;
      let t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t < 0) t = c < 0 ? 0 : t;
      const y = o.y + d.y * t;
      if (t >= 0 && y >= y0 && y <= y1) consider(t, kind, extra);
    };
    if (enemies) for (const e of this.s.enemies) if (e.hp > 0) cyl(e.x, e.z, e.radius, (e.y ?? 0), (e.y ?? 0) + e.height, 'enemy', { enemy: e });
    if (player) { const p = this.s.player; cyl(p.x, p.z, .5, p.y + .1, p.y + 1.85, 'player'); }
    best.point = { x: o.x + d.x * best.t, y: o.y + d.y * best.t, z: o.z + d.z * best.t };
    return best;
  }
  hasLOS(a, b, ha = 1.4, hb = 1.2) {
    const dx = b.x - a.x, dz = b.z - a.z, dy = hb - ha, len = Math.hypot(dx, dy, dz);
    if (len < .01) return true;
    const hit = this.rayCast({ x: a.x, y: ha, z: a.z }, { x: dx / len, y: dy / len, z: dz / len }, len, { enemies: false });
    return hit.kind === null || hit.kind === 'ground';
  }
  aimDir() { const p = this.s.player; return forwardOf(p.yaw, p.pitch); }
  eye() { const p = this.s.player; return { x: p.x, y: p.y + EYE, z: p.z }; }

  /** Nearest living enemy to the player and its aim error, for HUD and autopilots. */
  target() {
    const p = this.s.player;
    return this.alive.map((e) => ({
      e, distance: Math.hypot(e.x - p.x, e.z - p.z),
      error: wrap(Math.atan2(e.x - p.x, p.z - e.z) - p.yaw),
    })).sort((a, b) => a.distance - b.distance)[0];
  }

  /* ---------- actors ---------- */
  damageEnemy(e, dmg, meta = {}) {
    if (e.hp <= 0) return false;
    e.hp = Math.max(0, e.hp - dmg);
    e.hitAt = this.s.elapsed;
    const pt = meta.point ?? { x: e.x, y: (e.y ?? 0) + e.height * .6, z: e.z };
    this.emit('enemy.hit', { target: e.id, damage: dmg, ...pt, by: meta.by ?? 'player', killed: e.hp === 0 });
    if (e.hp === 0) {
      this.s.kills++;
      e.deadAt = this.s.elapsed;
      this.emit('enemy.defeated', { target: e.id, x: e.x, y: (e.y ?? 0) + e.height * .5, z: e.z });
    }
    return true;
  }
  damagePlayer(dmg, meta = {}) {
    const s = this.s;
    if (s.state !== 'RUNNING') return false;
    s.health = Math.max(0, s.health - dmg);
    s.hurtAt = s.elapsed;
    const from = meta.from;
    this.emit('player.hit', { damage: dmg, health: s.health, angle: from ? +wrap(Math.atan2(from.x - s.player.x, s.player.z - from.z) - s.player.yaw).toFixed(3) : 0 });
    if (s.health <= 0) this.end('LOST', this.cfg.loseText ?? 'Your health reached zero.');
    return true;
  }
  moveEnemy(e, nx, nz) {
    if (!this.obstacleBlocks(nx, e.z, e.radius) && !this.enemyBlocks(nx, e.z, e.radius, e) && Math.hypot(nx - this.s.player.x, e.z - this.s.player.z) > e.radius + .4) e.x = nx;
    if (!this.obstacleBlocks(e.x, nz, e.radius) && !this.enemyBlocks(e.x, nz, e.radius, e) && Math.hypot(e.x - this.s.player.x, nz - this.s.player.z) > e.radius + .4) e.z = nz;
  }
  /** Walk an enemy toward (or away from, speed < 0) a point and face it. */
  steer(e, tx, tz, speed, dt) {
    const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz) || 1;
    e.facing = Math.atan2(dx, dz);
    this.moveEnemy(e, e.x + (dx / d) * speed * dt, e.z + (dz / d) * speed * dt);
  }
  strafe(e, tx, tz, speed, dt, dir = 1) {
    const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz) || 1;
    this.moveEnemy(e, e.x + (-dz / d) * dir * speed * dt, e.z + (dx / d) * dir * speed * dt);
  }

  /* ---------- weapons ---------- */
  /** Instant shot from the eye. Applies damage and returns the ray result. */
  hitscan({ dmg = 20, range = 40, spread = 0, type = 'bullet' } = {}) {
    const s = this.s, o = this.eye();
    let { x, y, z } = this.aimDir();
    if (spread) { x += (this.rnd() - .5) * spread; y += (this.rnd() - .5) * spread; z += (this.rnd() - .5) * spread; const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l; }
    const hit = this.rayCast(o, { x, y, z }, range);
    const end = hit.point;
    this.emit('shot.trace', { type, ox: +o.x.toFixed(2), oy: +o.y.toFixed(2), oz: +o.z.toFixed(2), x: +end.x.toFixed(2), y: +end.y.toFixed(2), z: +end.z.toFixed(2), surface: hit.kind ?? 'air' });
    if (hit.kind === 'enemy') this.damageEnemy(hit.enemy, dmg, { point: end });
    s.shots++;
    return hit;
  }
  spawnProjectile(p) {
    const s = this.s;
    const proj = { id: ++s.pid, owner: 'player', type: 'bolt', radius: .12, dmg: 10, ttl: 3, age: 0, vx: 0, vy: 0, vz: 0, gravity: 0, ...p };
    s.projectiles.push(proj);
    return proj;
  }
  stepProjectiles(dt) {
    const s = this.s, hooks = this.cfg.projectileHooks ?? {};
    for (let i = s.projectiles.length - 1; i >= 0; i--) {
      const p = s.projectiles[i];
      p.age += dt;
      p.vy -= p.gravity * dt;
      const sp = Math.hypot(p.vx, p.vy, p.vz), len = sp * dt;
      let remove = p.age > p.ttl;
      if (!remove && len > 0) {
        const d = { x: p.vx / sp, y: p.vy / sp, z: p.vz / sp };
        const hit = this.rayCast({ x: p.x, y: p.y, z: p.z }, d, len + p.radius, { enemies: p.owner === 'player', player: p.owner === 'enemy' });
        if (hit.kind) {
          const pt = hit.point;
          const h = hooks[p.type];
          const info = { x: +pt.x.toFixed(2), y: +pt.y.toFixed(2), z: +pt.z.toFixed(2), type: p.type, surface: hit.kind, owner: p.owner, pid: p.id };
          let consumed = true;
          if (hit.kind === 'enemy') {
            if (h?.enemy) consumed = h.enemy(this, p, hit.enemy, pt) !== false;
            else this.damageEnemy(hit.enemy, p.dmg, { point: pt });
          } else if (hit.kind === 'player') {
            if (h?.player) h.player(this, p, pt); else this.damagePlayer(p.dmg, { from: { x: p.x - p.vx, z: p.z - p.vz } });
          } else if (h?.world) consumed = h.world(this, p, pt, hit.kind) !== false;
          if (consumed) { this.emit('projectile.impact', info); remove = true; }
        } else { p.x += d.x * len; p.y += d.y * len; p.z += d.z * len; }
      }
      if (remove) s.projectiles.splice(i, 1);
    }
  }

  /* ---------- player ---------- */
  movePlayer(dt, k, { speed = 3.2, radius = .45, aim = 1.6, canJump = true } = {}) {
    const p = this.s.player;
    p.yaw = wrap(p.yaw + k.axis('aimLeft', 'aimRight') * dt * aim);
    p.pitch = clamp(p.pitch + k.axis('aimDown', 'aimUp') * dt * 1.1, -.6, .6);
    const side = k.axis('left', 'right'), fwd = k.axis('back', 'forward'), l = Math.max(1, Math.hypot(side, fwd));
    const nx = p.x + (side * Math.cos(p.yaw) + fwd * Math.sin(p.yaw)) * speed * dt / l;
    const nz = p.z + (side * Math.sin(p.yaw) - fwd * Math.cos(p.yaw)) * speed * dt / l;
    const blocked = (x, z) => this.obstacleBlocks(x, z, radius) || !!this.enemyBlocks(x, z, radius);
    if (!blocked(nx, p.z)) p.x = nx;
    if (!blocked(p.x, nz)) p.z = nz;
    p.moving = !!(side || fwd);
    if (p.moving && !this.moveCue) this.moveCue = 0;
    if (p.moving) { this.moveCue = (this.moveCue ?? 0) - dt; if (this.moveCue <= 0) { this.emit('player.moved'); this.moveCue = .5; } }
    if (canJump && (p.y > 0 || p.vy > 0)) { p.vy -= 15 * dt; p.y = Math.max(0, p.y + p.vy * dt); if (p.y === 0) p.vy = 0; }
  }
  jump() { const p = this.s.player; if (p.y === 0) { p.vy = 6.2; this.s.jumpCount++; this.emit('player.jumped'); } }

  /* ---------- loop plumbing ---------- */
  handleInput(k) {
    const s = this.s;
    if (k.consumePress('restart')) { this.reset(); k.clear(); return; }
    if (k.consumePress('pause') && s.state === 'RUNNING') { s.paused = !s.paused; k.clear(); return; }
    if (s.state !== 'RUNNING' || s.paused) return;
    if (!this.cfg.noJump && k.consumePress('jump')) this.jump();
    this.cfg.press?.(this, k);
  }
  update(dt, k) {
    const s = this.s;
    if (s.state !== 'RUNNING' || s.paused) return false;
    s.elapsed += dt;
    s.cooldown = Math.max(0, s.cooldown - dt);
    this.movePlayer(dt, k, this.cfg.movement);
    for (const e of s.enemies) e.stun = Math.max(0, e.stun - dt);
    this.cfg.step?.(this, dt, k);
    this.stepProjectiles(dt);
    if (s.state === 'RUNNING') this.cfg.check?.(this);
  }
  read() {
    const t = this.target(), s = this.s;
    return structuredClone({
      ...s, ...(this.cfg.read?.(this) ?? {}),
      target: t ? { error: t.error, distance: t.distance, hp: t.e.hp, stun: t.e.stun, id: t.e.id } : { error: 0, distance: 0, hp: 0, stun: 0, id: -1 },
    });
  }
  api() {
    return { handleInput: (k) => this.handleInput(k), update: (dt, k) => this.update(dt, k), read: () => this.read(), reset: () => this.reset(), sim: this };
  }
}
