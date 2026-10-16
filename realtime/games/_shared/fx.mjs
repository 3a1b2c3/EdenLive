// SPDX-License-Identifier: Apache-2.0
// Pooled combat effects: muzzle flashes, tracers, bolts, sparks, debris, smoke,
// shock rings, lightning, light pulses and ribbon trails. Everything is driven by
// the caller's visual clock (`update(dt)`), so pausing the clock pauses the effects.
import * as T from 'three';
import { radialTexture, starTexture, mulberry32 } from './kit.mjs';

// Effect budget: keep the capture cheap. Counts are scaled down and capped per kind.
const SCALE = { spark: .4, smoke: .35, chip: .45 };
const CAP = { spark: 36, smoke: 10, chip: 20, beam: 14, ring: 6, star: 6 };

const UP = new T.Vector3(0, 1, 0);
const _a = new T.Vector3(), _b = new T.Vector3(), _c = new T.Vector3();

export class Fx {
  constructor(scene, { lights = 0, seed = 11 } = {}) {
    this.scene = scene;
    this.group = new T.Group();
    this.group.name = 'fx';
    scene.add(this.group);
    this.rnd = mulberry32(seed);
    this.glow = radialTexture([[0, 'rgba(255,255,255,1)'], [.3, 'rgba(255,255,255,.6)'], [1, 'rgba(255,255,255,0)']]);
    this.soft = radialTexture([[0, 'rgba(255,255,255,.85)'], [.55, 'rgba(255,255,255,.4)'], [1, 'rgba(255,255,255,0)']]);
    this.star = starTexture();
    this.items = [];
    this.pools = { spark: [], smoke: [], chip: [], beam: [], ring: [], star: [] };
    this.lightPool = [];
    for (let i = 0; i < lights; i++) {
      const l = new T.PointLight(0xffffff, 0, 12, 1.6);
      l.userData = { age: 0, life: 0, peak: 0 };
      scene.add(l);
      this.lightPool.push(l);
    }
    this.chipGeo = new T.BoxGeometry(1, 1, 1);
    this.beamGeo = new T.CylinderGeometry(1, 1, 1, 6, 1, true);
    this.ringGeo = new T.RingGeometry(.86, 1, 28);
  }

  r(a = 0, b = 1) { return a + (b - a) * this.rnd(); }

  _take(kind, make) {
    const o = this.pools[kind].pop() ?? make();
    o.visible = true;
    this.group.add(o);
    return o;
  }
  _give(kind, o) { o.visible = false; this.group.remove(o); this.pools[kind].push(o); }

  _sprite(kind, tex, additive) {
    return this._take(kind, () => new T.Sprite(new T.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending,
    })));
  }

  /** Glowing point that flies, fades and optionally falls. */
  _full(kind) { let n = 0; for (const it of this.items) if (it.kind === kind) n++; return n >= CAP[kind]; }
  spark(pos, vel, { color = 0xffd27a, size = .14, life = .5, gravity = 0, drag = 0, grow = 0 } = {}) {
    if (this._full('spark')) return;
    const s = this._sprite('spark', this.glow, true);
    s.material.color.set(color);
    s.material.opacity = 1;
    s.position.copy(pos);
    const v = vel.clone();
    this.items.push({
      kind: 'spark', obj: s, age: 0, life,
      step: (dt, t) => {
        v.y -= gravity * dt;
        v.multiplyScalar(Math.max(0, 1 - drag * dt));
        s.position.addScaledVector(v, dt);
        s.material.opacity = 1 - t;
        s.scale.setScalar(size * (1 + grow * t) * (1 - t * .5));
      },
    });
  }
  burst(pos, { n = 12, color = 0xffd27a, speed = 4, size = .13, life = .45, gravity = 7, dir = null, spread = 1, drag = 1.2 } = {}) {
    n = Math.max(2, Math.ceil(n * SCALE.spark));
    for (let i = 0; i < n; i++) {
      const v = new T.Vector3(this.r(-1, 1), this.r(-.2, 1), this.r(-1, 1));
      if (dir) v.multiplyScalar(spread).addScaledVector(dir, 1.4);
      else v.multiplyScalar(spread);
      v.normalize().multiplyScalar(speed * this.r(.35, 1));
      this.spark(pos, v, { color, size: size * this.r(.6, 1.3), life: life * this.r(.6, 1.2), gravity, drag });
    }
  }
  smoke(pos, { n = 4, color = 0x888888, size = .6, life = 1.1, rise = .8, spread = .5, opacity = .5 } = {}) {
    n = Math.max(1, Math.ceil(n * SCALE.smoke));
    for (let i = 0; i < n; i++) {
      if (this._full('smoke')) return;
      const s = this._sprite('smoke', this.soft, false);
      s.material.color.set(color);
      s.position.set(pos.x + this.r(-spread, spread) * .4, pos.y, pos.z + this.r(-spread, spread) * .4);
      const v = new T.Vector3(this.r(-spread, spread), rise * this.r(.6, 1.2), this.r(-spread, spread));
      const sz = size * this.r(.7, 1.3), l = life * this.r(.8, 1.2);
      this.items.push({
        kind: 'smoke', obj: s, age: 0, life: l,
        step: (dt, t) => {
          s.position.addScaledVector(v, dt);
          v.multiplyScalar(1 - .8 * dt);
          s.scale.setScalar(sz * (.5 + t * 1.4));
          s.material.opacity = opacity * (1 - t) * Math.min(1, t * 8);
        },
      });
    }
  }
  /** Solid debris cubes that tumble and rest on the ground. */
  chips(pos, { n = 8, color = 0x8a7a66, speed = 4, size = .18, life = 1.4, ground = 0 } = {}) {
    n = Math.max(2, Math.ceil(n * SCALE.chip));
    for (let i = 0; i < n; i++) {
      if (this._full('chip')) return;
      const m = this._take('chip', () => new T.Mesh(this.chipGeo, new T.MeshLambertMaterial({ flatShading: true })));
      m.material.color.set(Array.isArray(color) ? color[i % color.length] : color);
      m.position.copy(pos);
      const sz = size * this.r(.5, 1.4);
      m.scale.set(sz, sz * this.r(.5, 1), sz * this.r(.6, 1.2));
      const v = new T.Vector3(this.r(-1, 1), this.r(.4, 1.4), this.r(-1, 1)).multiplyScalar(speed * this.r(.4, 1));
      const spin = new T.Vector3(this.r(-9, 9), this.r(-9, 9), this.r(-9, 9));
      this.items.push({
        kind: 'chip', obj: m, age: 0, life,
        step: (dt, t) => {
          v.y -= 14 * dt;
          m.position.addScaledVector(v, dt);
          if (m.position.y < ground + sz * .3) { m.position.y = ground + sz * .3; v.multiplyScalar(.25); v.y = Math.abs(v.y) * .3; spin.multiplyScalar(.3); }
          m.rotation.x += spin.x * dt; m.rotation.y += spin.y * dt; m.rotation.z += spin.z * dt;
          if (t > .8) m.scale.multiplyScalar(1 - dt * 3);
        },
      });
    }
  }
  /** Camera-facing lens flare that pops and fades. */
  flash(pos, { color = 0xfff0b0, size = 1, life = .09, spin = 0 } = {}) {
    if (this._full('star')) return;
    const s = this._sprite('star', this.star, true);
    s.material.color.set(color);
    s.position.copy(pos);
    const rot0 = this.r(0, 6.28);
    this.items.push({
      kind: 'star', obj: s, age: 0, life,
      step: (dt, t) => {
        s.scale.setScalar(size * (.6 + .6 * Math.sin(Math.min(1, t * 1.4) * 1.4)));
        s.material.opacity = 1 - t * t;
        s.material.rotation = rot0 + spin * t;
      },
    });
  }
  /** Expanding shock ring lying on a plane (default: ground) or facing `normal`. */
  ring(pos, { color = 0xffffff, r0 = .2, r1 = 3, life = .5, normal = UP, opacity = .8 } = {}) {
    if (this._full('ring')) return;
    const m = this._take('ring', () => new T.Mesh(this.ringGeo, new T.MeshBasicMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
    })));
    m.material.color.set(color);
    m.position.copy(pos);
    m.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), normal.clone().normalize());
    this.items.push({
      kind: 'ring', obj: m, age: 0, life,
      step: (dt, t) => {
        const e = 1 - (1 - t) * (1 - t);
        m.scale.setScalar(r0 + (r1 - r0) * e);
        m.material.opacity = opacity * (1 - t);
      },
    });
  }
  /** Straight glowing streak between two points (tracers, beams, pulses). */
  beam(a, b, { color = 0xffe08a, width = .03, life = .08, opacity = .95, taper = true } = {}) {
    if (this._full('beam')) return;
    const m = this._take('beam', () => new T.Mesh(this.beamGeo, new T.MeshBasicMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    })));
    m.material.color.set(color);
    const len = a.distanceTo(b);
    m.position.copy(a).add(b).multiplyScalar(.5);
    m.quaternion.setFromUnitVectors(UP, _a.copy(b).sub(a).normalize());
    this.items.push({
      kind: 'beam', obj: m, age: 0, life,
      step: (dt, t) => {
        const w = width * (taper ? 1 - t * .7 : 1);
        m.scale.set(w, len, w);
        m.material.opacity = opacity * (1 - t);
      },
    });
  }
  /** Jagged electric arc rebuilt every few frames for a crackling look. */
  lightning(a, b, { color = 0x7fe3ff, width = .05, life = .25, seg = 9, jitter = .35, core = 0xffffff, opacity = 1 } = {}) {
    seg = Math.min(seg, 5);
    if (this.items.filter((i) => i.kind === 'lightning').length >= 4) return;
    const holder = new T.Group();
    this.group.add(holder);
    const mats = [new T.MeshBasicMaterial({ color, transparent: true, blending: T.AdditiveBlending, depthWrite: false }),
      new T.MeshBasicMaterial({ color: core, transparent: true, blending: T.AdditiveBlending, depthWrite: false })];
    const parts = [];
    for (let i = 0; i < seg; i++) for (let k = 0; k < 2; k++) {
      const m = new T.Mesh(this.beamGeo, mats[k]);
      holder.add(m);
      parts.push(m);
    }
    let acc = 1;
    const from = a.clone(), to = b.clone();
    const dir = to.clone().sub(from);
    const side1 = new T.Vector3().crossVectors(dir, UP).normalize();
    if (!isFinite(side1.x) || side1.lengthSq() < .01) side1.set(1, 0, 0);
    const side2 = new T.Vector3().crossVectors(dir, side1).normalize();
    this.items.push({
      kind: 'lightning', obj: holder, age: 0, life,
      dispose: () => { for (const m of mats) m.dispose(); },
      step: (dt, t) => {
        acc += dt;
        if (acc > .04) {
          acc = 0;
          const pts = [from.clone()];
          for (let i = 1; i < seg; i++) {
            const p = from.clone().lerp(to, i / seg);
            const j = jitter * Math.sin((i / seg) * Math.PI) * dir.length() * .12;
            p.addScaledVector(side1, this.r(-1, 1) * j).addScaledVector(side2, this.r(-1, 1) * j);
            pts.push(p);
          }
          pts.push(to.clone());
          for (let i = 0; i < seg; i++) {
            const p = pts[i], q = pts[i + 1], len = p.distanceTo(q);
            for (let k = 0; k < 2; k++) {
              const m = parts[i * 2 + k];
              m.position.copy(p).add(q).multiplyScalar(.5);
              m.quaternion.setFromUnitVectors(UP, _b.copy(q).sub(p).normalize());
              const w = width * (k ? .35 : 1);
              m.scale.set(w, len, w);
            }
          }
        }
        mats[0].opacity = opacity * (1 - t);
        mats[1].opacity = opacity * (1 - t * .6);
      },
    });
  }
  /** Brief coloured point-light pulse from a small preallocated pool. */
  light(pos, { color = 0xffc070, intensity = 18, life = .12, distance = 12 } = {}) {
    if (!this.lightPool.length) return;
    const l = this.lightPool.reduce((best, c) => (c.userData.age >= c.userData.life ? c : best), this.lightPool[0]);
    l.color.set(color);
    l.position.copy(pos);
    l.distance = distance;
    l.userData = { age: 0, life, peak: intensity };
    l.intensity = intensity;
  }
  /** Flame/magic jet: call every frame while active. */
  jet(pos, dir, { color = 0xff9a2e, core = 0xfff0a0, n = 3, speed = 9, size = .9, life = .45, spread = .22 } = {}) {
    n = Math.max(1, Math.round(n * .5));
    for (let i = 0; i < n; i++) {
      const v = new T.Vector3(this.r(-spread, spread), this.r(-spread, spread) + .06, this.r(-spread, spread)).add(dir).normalize().multiplyScalar(speed * this.r(.7, 1.1));
      const hot = this.rnd() < .45;
      this.spark(pos, v, { color: hot ? core : color, size: size * this.r(.6, 1.2), life: life * this.r(.7, 1.1), gravity: -1.2, drag: .5, grow: 1.6 });
    }
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      const t = Math.min(1, it.age / it.life);
      it.step(dt, t);
      if (it.age >= it.life) {
        if (it.kind === 'lightning') { this.group.remove(it.obj); it.dispose(); }
        else this._give(it.kind, it.obj);
        this.items.splice(i, 1);
      }
    }
    for (const l of this.lightPool) {
      const u = l.userData;
      if (u.age < u.life) { u.age += dt; l.intensity = u.peak * Math.max(0, 1 - u.age / u.life); } else l.intensity = 0;
    }
  }
  clear() {
    for (const it of this.items) {
      if (it.kind === 'lightning') { this.group.remove(it.obj); it.dispose(); } else this._give(it.kind, it.obj);
    }
    this.items.length = 0;
    for (const l of this.lightPool) { l.userData.age = l.userData.life; l.intensity = 0; }
  }
}

/** Swept ribbon between two tracked points (axe edge, wrench head, bolt tails). */
export class Trail {
  constructor(scene, { n = 16, color = 0xdff6ff, opacity = .75, life = .22 } = {}) {
    this.n = n;
    this.life = life;
    this.pts = [];
    this.pos = new Float32Array(n * 2 * 3);
    this.col = new Float32Array(n * 2 * 3);
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute('color', new T.BufferAttribute(this.col, 3).setUsage(T.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.color = new T.Color(color);
    this.opacity = opacity;
    this.mesh = new T.Mesh(g, new T.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    scene.add(this.mesh);
  }
  setColor(c) { this.color.set(c); }
  push(a, b) {
    this.pts.unshift({ a: a.clone(), b: b.clone(), age: 0 });
    if (this.pts.length > this.n) this.pts.pop();
  }
  update(dt) {
    for (const p of this.pts) p.age += dt;
    while (this.pts.length && this.pts[this.pts.length - 1].age > this.life) this.pts.pop();
    const m = this.pts.length;
    for (let i = 0; i < m; i++) {
      const p = this.pts[i], f = Math.max(0, 1 - p.age / this.life) * this.opacity;
      this.pos.set([p.a.x, p.a.y, p.a.z, p.b.x, p.b.y, p.b.z], i * 6);
      for (let k = 0; k < 2; k++) {
        const o = i * 6 + k * 3;
        this.col[o] = this.color.r * f; this.col[o + 1] = this.color.g * f; this.col[o + 2] = this.color.b * f;
      }
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.setDrawRange(0, Math.max(0, (m - 1) * 6));
  }
  clear() { this.pts.length = 0; this.mesh.geometry.setDrawRange(0, 0); }
}

/** Glowing projectile body: stretched core, soft halo and a ribbon tail. */
export function createBolt(scene, fx, { color = 0x6ff0ff, core = 0xffffff, size = .14, length = 1, trail = .2 } = {}) {
  const g = new T.Group();
  const coreMesh = new T.Mesh(new T.SphereGeometry(1, 8, 6), new T.MeshBasicMaterial({ color: core }));
  coreMesh.scale.set(size, size, size * 3 * length);
  const halo = new T.Sprite(new T.SpriteMaterial({ map: fx.glow, color, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
  halo.scale.setScalar(size * 9);
  const shell = new T.Mesh(new T.SphereGeometry(1, 8, 6), new T.MeshBasicMaterial({ color, transparent: true, opacity: .55, blending: T.AdditiveBlending, depthWrite: false }));
  shell.scale.set(size * 1.8, size * 1.8, size * 5.2 * length);
  g.add(shell, coreMesh, halo);
  const tr = new Trail(scene, { n: 6, color, opacity: .8, life: trail });
  g.userData.trail = tr;
  g.userData.size = size;
  scene.add(g);
  return g;
}
