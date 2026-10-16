// SPDX-License-Identifier: Apache-2.0
// Greybox-plus modelling helpers shared by the Eden prototype games.
// Low-poly flat-shaded primitives, additive glow materials and procedural textures.
import * as T from 'three';

const cache = new Map();
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
export const smooth = (t) => t * t * (3 - 2 * t);
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

/** Cached flat-shaded Lambert material. */
export function mat(color, { emissive = 0x000000, ei = 1, flat = true, side } = {}) {
  const key = `${color}|${emissive}|${ei}|${flat}|${side ?? ''}`;
  if (!cache.has(key)) { const o = { color, emissive, emissiveIntensity: ei, flatShading: flat }; if (side !== undefined) o.side = side; cache.set(key, new T.MeshLambertMaterial(o)); }
  return cache.get(key);
}
export function metal(color, { rough = .38, metalness = .55, emissive = 0x000000 } = {}) {
  const key = `m|${color}|${rough}|${metalness}|${emissive}`;
  if (!cache.has(key)) cache.set(key, new T.MeshStandardMaterial({ color, roughness: rough, metalness, emissive, flatShading: true }));
  return cache.get(key);
}
/** Unlit colour that ignores lights (lamps, screens, flames). */
export function basic(color, opacity = 1) {
  const key = `b|${color}|${opacity}`;
  if (!cache.has(key)) cache.set(key, new T.MeshBasicMaterial({ color, transparent: opacity < 1, opacity }));
  return cache.get(key);
}
export function glowMat(color, opacity = 1) {
  return new T.MeshBasicMaterial({ color, transparent: true, opacity, blending: T.AdditiveBlending, depthWrite: false });
}
const asMat = (c) => (c && c.isMaterial ? c : mat(c));

export function group(parent, x = 0, y = 0, z = 0) {
  const g = new T.Group();
  g.position.set(x, y, z);
  parent?.add(g);
  return g;
}
export function mesh(parent, geo, c, pos = [0, 0, 0]) {
  const m = new T.Mesh(geo, asMat(c));
  m.position.set(pos[0], pos[1], pos[2]);
  parent?.add(m);
  return m;
}
export function box(parent, c, pos, size) { return mesh(parent, new T.BoxGeometry(size[0], size[1], size[2]), c, pos); }
export function ball(parent, c, pos, scale = [1, 1, 1], detail = 1) {
  const m = mesh(parent, new T.IcosahedronGeometry(1, detail), c, pos);
  m.scale.set(scale[0], scale[1], scale[2]);
  return m;
}
export function cyl(parent, c, pos, [rt, rb, h], seg = 8) { return mesh(parent, new T.CylinderGeometry(rt, rb, h, seg), c, pos); }
export function cone(parent, c, pos, [r, h], seg = 6) { return mesh(parent, new T.ConeGeometry(r, h, seg), c, pos); }
const UP = new T.Vector3(0, 1, 0);
export function rod(parent, c, a, b, r, seg = 6) {
  const A = new T.Vector3(...a), B = new T.Vector3(...b);
  const m = mesh(parent, new T.CylinderGeometry(r, r, A.distanceTo(B), seg), c, A.clone().add(B).multiplyScalar(.5).toArray());
  m.quaternion.setFromUnitVectors(UP, B.clone().sub(A).normalize());
  return m;
}
/** Re-aim a rod created by `rod` between two points without reallocating. */
export function setRod(m, a, b) {
  const A = new T.Vector3(...a), B = new T.Vector3(...b);
  m.position.copy(A).add(B).multiplyScalar(.5);
  m.scale.y = A.distanceTo(B) / m.geometry.parameters.height;
  m.quaternion.setFromUnitVectors(UP, B.sub(A).normalize());
}
/** Give every mesh below `root` its own material instance so it can flash independently. */
export function ownMaterials(root) {
  root.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
  return root;
}
export function setEmissive(root, hex, intensity = 1) {
  root.traverse((o) => {
    if (o.isMesh && o.material.emissive) { o.material.emissive.setHex(hex); o.material.emissiveIntensity = intensity; }
  });
}

export function radialTexture(stops, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [t, col] of stops) r.addColorStop(t, col);
  g.fillStyle = r;
  g.fillRect(0, 0, size, size);
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  return tex;
}
/** Four-point lens flare used for muzzle flashes and impacts. */
export function starTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const h = size / 2;
  const core = g.createRadialGradient(h, h, 0, h, h, h);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(.25, 'rgba(255,255,255,.75)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'lighter';
  for (const [sx, sy] of [[1, .12], [.12, 1], [.7, .1], [.1, .7]]) {
    g.save();
    g.translate(h, h);
    if (sx === .7 || sy === .7) g.rotate(Math.PI / 4);
    const grad = g.createLinearGradient(-h * sx, 0, h * sx, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(.5, 'rgba(255,255,255,.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(-h * sx, -h * sy * .22, h * sx * 2, h * sy * .44);
    g.restore();
  }
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  return tex;
}
/** Tileable noisy surface for floors and walls; the skill keeps it a plain canvas texture. */
export function noiseTexture({ base = '#808080', spots = ['#707070', '#909090'], n = 260, size = 256, repeat = [8, 8], lines = null, seed = 4 } = {}) {
  const rnd = mulberry32(seed);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < n; i++) {
    g.fillStyle = spots[Math.floor(rnd() * spots.length)];
    g.globalAlpha = .25 + rnd() * .4;
    const r = 2 + rnd() * 14;
    g.beginPath();
    g.ellipse(rnd() * size, rnd() * size, r, r * (.4 + rnd() * .8), rnd() * 3, 0, 7);
    g.fill();
  }
  g.globalAlpha = 1;
  if (lines) {
    g.strokeStyle = lines.color;
    g.lineWidth = lines.width ?? 2;
    const step = size / (lines.count ?? 4);
    for (let i = 0; i <= (lines.count ?? 4); i++) {
      g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, size); g.stroke();
      g.beginPath(); g.moveTo(0, i * step); g.lineTo(size, i * step); g.stroke();
    }
  }
  const tex = new T.CanvasTexture(c);
  tex.wrapS = tex.wrapT = T.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
export function texturedMat(map, { color = 0xffffff, emissive = 0x000000, ei = 1, flat = false } = {}) {
  return new T.MeshLambertMaterial({ map, color, emissive, emissiveIntensity: ei, flatShading: flat });
}

/** Faceted cave/tunnel shell around the z axis. Returns a BufferGeometry open at both ends. */
export function tunnelGeometry({ z0, z1, rings = 22, sides = 14, rx = 6, ry = 5.4, floor = -.1, noise = .5, seed = 7, arc = Math.PI, center = () => 0 }) {
  const rnd = mulberry32(seed);
  const positions = [], indices = [];
  for (let j = 0; j < rings; j++) {
    const z = z0 + (z1 - z0) * (j / (rings - 1));
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * arc;
      const n = 1 + (rnd() - .5) * noise;
      positions.push(center(z) + Math.cos(a) * rx * n, floor + Math.sin(a) * ry * (1 + (rnd() - .5) * noise * .6), z);
    }
  }
  for (let j = 0; j < rings - 1; j++) for (let i = 0; i < sides; i++) {
    const a = j * (sides + 1) + i, b = a + sides + 1;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
export const fract = (x) => x - Math.floor(x);

/** Building facade with lit windows. Returns {map, emissiveMap}; both are plain canvas textures. */
export function facadeTexture({ wall = '#2f7f86', trim = null, lit = ['#ffd27a', '#9fe8ff'], cols = 5, rows = 10, litChance = .45, seed = 1, w = 256, h = 512 } = {}) {
  const rnd = mulberry32(seed);
  const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const a = mk(), b = mk(), ga = a.getContext('2d'), gb = b.getContext('2d');
  ga.fillStyle = wall; ga.fillRect(0, 0, w, h);
  for (let i = 0; i < 220; i++) { ga.fillStyle = rnd() > .5 ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.06)'; ga.fillRect(rnd() * w, rnd() * h, 10 + rnd() * 30, 4 + rnd() * 16); }
  gb.fillStyle = '#000'; gb.fillRect(0, 0, w, h);
  const cw = w / cols, ch = h / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = c * cw + cw * .18, y = r * ch + ch * .2, ww = cw * .64, hh = ch * .56;
    const on = rnd() < litChance;
    ga.fillStyle = on ? lit[Math.floor(rnd() * lit.length)] : '#0e1a22';
    ga.fillRect(x, y, ww, hh);
    ga.fillStyle = 'rgba(0,0,0,.35)'; ga.fillRect(x, y + hh, ww, 3);
    if (on) { gb.fillStyle = ga.fillStyle; gb.fillRect(x, y, ww, hh); }
  }
  if (trim) { ga.fillStyle = trim; for (let r = 0; r <= rows; r += 3) ga.fillRect(0, r * ch - 2, w, 5); }
  const mkTex = (cv) => { const t = new T.CanvasTexture(cv); t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 4; return t; };
  return { map: mkTex(a), emissiveMap: mkTex(b) };
}
/** Vertical gradient sky dome that ignores fog. */
export function skyDome({ top = '#1f2a4d', mid = '#7a5a78', bottom = '#e98b5a', radius = 150 } = {}) {
  const c = document.createElement('canvas'); c.width = 8; c.height = 256;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, top); gr.addColorStop(.55, mid); gr.addColorStop(.62, bottom); gr.addColorStop(1, bottom);
  g.fillStyle = gr; g.fillRect(0, 0, 8, 256);
  const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
  const m = new T.Mesh(new T.SphereGeometry(radius, 16, 12), new T.MeshBasicMaterial({ map: tex, side: T.BackSide, fog: false, depthWrite: false }));
  m.renderOrder = -10;
  return m;
}
export function createDrain() {
  const st = { last: -1, round: -1 };
  return (s, onRound) => {
    if (s.roundId !== st.round) {
      const first = st.round === -1; st.round = s.roundId;
      st.last = s.events.length ? s.events[s.events.length - 1].id : st.last;
      if (!first) onRound?.();
      return [];
    }
    const out = s.events.filter((e) => e.id > st.last);
    if (out.length) st.last = out[out.length - 1].id;
    return out;
  };
}

/** Stand-in for a point light: scenes keep their light placement code but pay no shading cost. */
export class LiteLight extends T.Object3D {
  constructor(color = 0xffffff, intensity = 0, distance = 0) { super(); this.color = new T.Color(color); this.intensity = intensity; this.distance = distance; }
}
