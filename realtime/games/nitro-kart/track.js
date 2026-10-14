import { BufferGeometry, Color, Float32BufferAttribute } from 'three';

// Closed circuit authored in world X/Z (Y up). Driving direction follows the control order.
export const TRACK_HALF_WIDTH = 5.4;
export const CURB_WIDTH = 0.6;
export const BARRIER_OFFSET = TRACK_HALF_WIDTH + 0.5;

const TRACK_CONTROL = Object.freeze([
  [0, 0], [20, 3], [34, 16], [38, 34], [28, 50],
  [8, 56], [-14, 50], [-24, 36], [-38, 26], [-34, 8], [-20, 1],
]);

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function closedPoints(controls, perSegment) {
  const n = controls.length;
  const points = [];
  for (let i = 0; i < n; i += 1) {
    const [p0, p1, p2, p3] = [controls[(i - 1 + n) % n], controls[i], controls[(i + 1) % n], controls[(i + 2) % n]];
    for (let s = 0; s < perSegment; s += 1) {
      const t = s / perSegment;
      points.push({ x: catmullRom(p0[0], p1[0], p2[0], p3[0], t), z: catmullRom(p0[1], p1[1], p2[1], p3[1], t) });
    }
  }
  return points;
}

/** Arc-length samples with unit tangent (tx,tz) and left normal (nx,nz). */
export function buildTrackData() {
  const points = closedPoints(TRACK_CONTROL, 12);
  const samples = [];
  let dist = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1e-6;
    const tx = (b.x - a.x) / len;
    const tz = (b.z - a.z) / len;
    samples.push({ x: a.x, z: a.z, tx, tz, nx: tz, nz: -tx, dist, segLen: len });
    dist += len;
  }
  const length = dist;
  const nitroStations = [0.2, 0.45, 0.66, 0.86].map((frac, i) => {
    const s = sampleAtDistance(samples, length, length * frac);
    const side = i % 2 === 0 ? -1.6 : 1.6;
    return { x: s.x + s.nx * side, z: s.z + s.nz * side };
  });
  // Starting grid: two rows of two, just behind the line.
  const grid = [[-3, -1.6], [-3, 1.6], [-8, -1.6], [-8, 1.6]].map(([along, lateral]) => {
    const s = sampleAtDistance(samples, length, along);
    return { x: s.x + s.nx * lateral, z: s.z + s.nz * lateral, yaw: Math.atan2(-s.tx, -s.tz), dist: s.dist };
  });
  return { samples, length, nitroStations, grid };
}

export function sampleAtDistance(samples, length, distance) {
  const d = ((distance % length) + length) % length;
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (samples[mid].dist <= d) lo = mid; else hi = mid - 1;
  }
  const a = samples[lo];
  const b = samples[(lo + 1) % samples.length];
  const t = (d - a.dist) / a.segLen;
  let tx = a.tx + (b.tx - a.tx) * t;
  let tz = a.tz + (b.tz - a.tz) * t;
  const l = Math.hypot(tx, tz) || 1;
  tx /= l;
  tz /= l;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx, tz, nx: tz, nz: -tx, dist: d };
}

/** Nearest centerline projection; `hint` (sample index) keeps the search local. */
export function projectOnTrack(track, x, z, hint = -1) {
  const { samples } = track;
  const n = samples.length;
  let bestI = 0;
  let bestD = Infinity;
  const scan = (i) => {
    const s = samples[(i + n) % n];
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d < bestD) { bestD = d; bestI = (i + n) % n; }
  };
  if (hint >= 0) for (let k = -12; k <= 12; k += 1) scan(hint + k);
  else for (let i = 0; i < n; i += 1) scan(i);
  const a = samples[bestI];
  let along = (x - a.x) * a.tx + (z - a.z) * a.tz;
  let s = a;
  if (along < 0) { s = samples[(bestI - 1 + n) % n]; along = (x - s.x) * s.tx + (z - s.z) * s.tz; }
  along = Math.max(0, Math.min(s.segLen, along));
  const px = s.x + s.tx * along;
  const pz = s.z + s.tz * along;
  const lateral = (x - px) * s.nx + (z - pz) * s.nz;
  return { index: bestI, dist: (s.dist + along) % track.length, lateral, sample: s };
}

function band(samples, inner, outer, y, colorAt) {
  const pos = [];
  const nor = [];
  const col = [];
  const n = samples.length;
  for (let i = 0; i < n; i += 1) {
    const a = samples[i];
    const b = samples[(i + 1) % n];
    const v = (s, o) => [s.x + s.nx * o, y, s.z + s.nz * o];
    const a0 = v(a, inner); const a1 = v(a, outer); const b0 = v(b, inner); const b1 = v(b, outer);
    pos.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1);
    const c = colorAt(a, i);
    for (let k = 0; k < 6; k += 1) { nor.push(0, 1, 0); col.push(c.r, c.g, c.b); }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

/** Asphalt, dashed center line and red/white curbs as vertex-colored ribbons. */
export function trackSurfaceGeometries(track) {
  const asphalt = new Color(0x404858);
  const white = new Color(0xf5f7fb);
  const red = new Color(0xe5383b);
  const { samples } = track;
  const inner = TRACK_HALF_WIDTH - CURB_WIDTH;
  return {
    road: band(samples, -inner, inner, 0.02, () => asphalt),
    centerLine: band(samples, -0.12, 0.12, 0.035, (_s, i) => (i % 2 === 0 ? white : asphalt)),
    curbLeft: band(samples, inner, TRACK_HALF_WIDTH, 0.04, (_s, i) => (i % 2 === 0 ? white : red)),
    curbRight: band(samples, -TRACK_HALF_WIDTH, -inner, 0.04, (_s, i) => (i % 2 === 0 ? red : white)),
  };
}
