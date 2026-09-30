// Pure city layout data shared by the scene builder and the gameplay owner.
// Y-up, -Z forward. Roads form a 4x4 grid of centerlines enclosing a 3x3 grid of blocks.

export const ROAD_LINES = [-60, -20, 20, 60];
export const ROAD_HALF = 5;          // asphalt half width (two lanes)
export const LANE_OFFSET = 2.5;      // lane center from road centerline (right-hand traffic)
export const SIDEWALK_OFFSET = 6.5;  // pedestrian path from road centerline
export const SIDEWALK_OUTER = 8;     // sidewalk ends and the building lot begins
export const CITY_HALF = 68;         // invisible outer wall, just past the perimeter sidewalk
export const PARK_BLOCK = { ix: 1, iz: 1 };

export const BLOCKS = [];
for (let iz = 0; iz < 3; iz += 1) {
  for (let ix = 0; ix < 3; ix += 1) {
    const x0 = ROAD_LINES[ix] + ROAD_HALF;
    const x1 = ROAD_LINES[ix + 1] - ROAD_HALF;
    const z0 = ROAD_LINES[iz] + ROAD_HALF;
    const z1 = ROAD_LINES[iz + 1] - ROAD_HALF;
    BLOCKS.push({
      ix, iz, park: ix === PARK_BLOCK.ix && iz === PARK_BLOCK.iz,
      cx: (x0 + x1) / 2, cz: (z0 + z1) / 2,
      x0, x1, z0, z1,
      lot: { x0: x0 + 3, x1: x1 - 3, z0: z0 + 3, z1: z1 - 3 },
    });
  }
}

// Closed rectangle on road centerlines, offset to the right of travel (cars) or inward (walkers).
// Right of travel direction (dx, dz) is (-dz, dx) in this basis.
function rectanglePath(x0, x1, z0, z1, clockwise, offset) {
  // Counter-clockwise when viewed from above (+Y): -Z edge west->east is not CCW; define explicitly.
  const corners = clockwise
    ? [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]
    : [[x0, z0], [x0, z1], [x1, z1], [x1, z0]];
  const n = corners.length;
  const points = [];
  for (let i = 0; i < n; i += 1) {
    const prev = corners[(i + n - 1) % n];
    const cur = corners[i];
    const next = corners[(i + 1) % n];
    const inDir = norm(cur[0] - prev[0], cur[1] - prev[1]);
    const outDir = norm(next[0] - cur[0], next[1] - cur[1]);
    points.push([
      cur[0] + (-inDir[1] - outDir[1]) * offset,
      cur[1] + (inDir[0] + outDir[0]) * offset,
    ]);
  }
  return buildPath(points);
}

function norm(x, z) {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
}

function buildPath(points) {
  const segments = [];
  let length = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segments.push({ a, b, len, start: length, dir: norm(b[0] - a[0], b[1] - a[1]) });
    length += len;
  }
  return { points, segments, length };
}

// Sample a closed path at distance s: position and travel heading (rotation.y, -Z forward).
export function samplePath(path, s) {
  let d = ((s % path.length) + path.length) % path.length;
  for (const seg of path.segments) {
    if (d <= seg.len || seg === path.segments[path.segments.length - 1]) {
      const t = Math.min(1, d / seg.len);
      return {
        x: seg.a[0] + (seg.b[0] - seg.a[0]) * t,
        z: seg.a[1] + (seg.b[1] - seg.a[1]) * t,
        dirX: seg.dir[0], dirZ: seg.dir[1],
        heading: Math.atan2(-seg.dir[0], -seg.dir[1]),
      };
    }
    d -= seg.len;
  }
  return null;
}

const R = ROAD_LINES;
// Car loops: rectangles of road indices; opposite directions use opposite lanes.
export const CAR_ROUTES = [
  { id: 'car_0', preset: 'sedan', color: '#d9534f', rect: [0, 3, 0, 3], clockwise: true, phase: 0.05 },
  { id: 'car_1', preset: 'taxi', color: '#f2c14e', rect: [0, 3, 0, 3], clockwise: false, phase: 0.42 },
  { id: 'car_2', preset: 'hatchback', color: '#4f8fd9', rect: [1, 2, 1, 2], clockwise: true, phase: 0.3 },
  { id: 'car_3', preset: 'suv', color: '#3a3f47', rect: [1, 2, 1, 2], clockwise: false, phase: 0.8 },
  { id: 'car_4', preset: 'van', color: '#e8e6df', rect: [0, 2, 1, 3], clockwise: true, phase: 0.6 },
  { id: 'car_5', preset: 'coupe', color: '#5fb36a', rect: [1, 3, 0, 2], clockwise: false, phase: 0.15 },
  { id: 'car_6', preset: 'sedan', color: '#9b6bd1', rect: [0, 3, 0, 3], clockwise: true, phase: 0.55 },
  { id: 'car_7', preset: 'minibus', color: '#ef8a3c', rect: [0, 2, 0, 2], clockwise: false, phase: 0.7 },
  { id: 'car_8', preset: 'taxi', color: '#f2c14e', rect: [1, 3, 1, 3], clockwise: true, phase: 0.25 },
  { id: 'car_9', preset: 'hatchback', color: '#2a9d8f', rect: [0, 1, 0, 3], clockwise: false, phase: 0.62 },
  { id: 'car_10', preset: 'sedan', color: '#e76f51', rect: [2, 3, 0, 3], clockwise: true, phase: 0.1 },
  { id: 'car_11', preset: 'pickup', color: '#577590', rect: [0, 3, 1, 2], clockwise: false, phase: 0.35 },
].map(route => ({
  ...route,
  path: rectanglePath(R[route.rect[0]], R[route.rect[1]], R[route.rect[2]], R[route.rect[3]],
    route.clockwise, LANE_OFFSET),
}));

// Walker loops sit on the inward sidewalk; any loop spanning more than one block crosses streets
// at intersection crosswalks, which is where cars must yield.
export const PEDESTRIAN_ROUTES = [
  { rect: [0, 2, 1, 2], clockwise: true, phase: 0.0, preset: 'commuter' },
  { rect: [0, 2, 1, 2], clockwise: false, phase: 0.5, preset: 'worker' },
  { rect: [1, 3, 1, 3], clockwise: true, phase: 0.2, preset: 'hiker' },
  { rect: [1, 3, 1, 3], clockwise: false, phase: 0.7, preset: 'nurse' },
  { rect: [0, 3, 0, 2], clockwise: true, phase: 0.35, preset: 'tall' },
  { rect: [0, 3, 0, 2], clockwise: false, phase: 0.85, preset: 'stocky' },
  { rect: [1, 2, 0, 3], clockwise: true, phase: 0.1, preset: 'doctor' },
  { rect: [1, 2, 0, 3], clockwise: false, phase: 0.6, preset: 'child' },
  { rect: [0, 1, 0, 3], clockwise: true, phase: 0.45, preset: 'runner' },
  { rect: [2, 3, 0, 3], clockwise: false, phase: 0.25, preset: 'commuter' },
  { rect: [0, 3, 2, 3], clockwise: true, phase: 0.9, preset: 'worker' },
  { rect: [1, 2, 1, 2], clockwise: true, phase: 0.5, preset: 'heavy' },
].map((route, i) => ({
  ...route,
  id: `ped_${i}`,
  speed: 1.25 + (i % 4) * 0.12,
  // Right-of-travel offset: clockwise loops walk the inner sidewalk, counter-clockwise the outer.
  path: rectanglePath(R[route.rect[0]], R[route.rect[1]], R[route.rect[2]], R[route.rect[3]],
    route.clockwise, SIDEWALK_OFFSET),
}));

// Candidate ring spots: sidewalks, crosswalk edges, road shoulders and the park.
export const RING_SPOTS = (() => {
  const spots = [];
  for (const block of BLOCKS) {
    const s = SIDEWALK_OFFSET - ROAD_HALF; // 1.5 inside the block edge
    spots.push([block.cx, block.z0 + s], [block.cx, block.z1 - s], [block.x0 + s, block.cz], [block.x1 - s, block.cz]);
    if (block.park) spots.push([block.cx - 7, block.cz - 7], [block.cx + 7, block.cz + 7], [block.cx + 7, block.cz - 7], [block.cx, block.cz + 7]);
  }
  // Mid-road spots between intersections (on the lane divider) make the player cross traffic.
  for (const x of R) for (const z of [-40, 0, 40]) spots.push([x, z]);
  for (const z of R) for (const x of [-40, 0, 40]) spots.push([x, z]);
  return spots.map(([x, z], i) => ({ id: `spot_${i}`, x, z }));
})();

export const PLAYER_SPAWN = { x: 0, z: 13.5, heading: 0 };

// First five rings: spread around the spawn, 10-34 m away, so the round opens with choices.
// The first ring sits on the lawn straight ahead of the spawn so the opening move teaches the goal.
const FIRST_RING = RING_SPOTS.findIndex(spot => spot.x === PLAYER_SPAWN.x && spot.z === 7);
export const INITIAL_RING_SPOTS = [FIRST_RING, ...RING_SPOTS
  .map((spot, i) => ({ i, d: Math.hypot(spot.x - PLAYER_SPAWN.x, spot.z - PLAYER_SPAWN.z) }))
  .filter(c => c.d >= 10 && c.d <= 34)
  .sort((a, b) => a.d - b.d)
  .filter((_, k) => k % 2 === 0)
  .filter(c => c.i !== FIRST_RING)
  .slice(0, 4)
  .map(c => c.i)];

// Static solid footprints for player collision: building lots (axis-aligned) and round props.
export function lotColliders() {
  return BLOCKS.filter(b => !b.park).map(b => ({ ...b.lot }));
}

export const FOUNTAIN = { x: 0, z: 0, radius: 3.2 };
export const CURB_HEIGHT = 0.12;

// Asphalt covers each road centerline +-ROAD_HALF, clipped to the city extent.
export function onRoad(x, z) {
  const extent = R[R.length - 1] + ROAD_HALF;
  if (Math.abs(x) > extent || Math.abs(z) > extent) return false;
  return R.some(r => Math.abs(x - r) < ROAD_HALF) || R.some(r => Math.abs(z - r) < ROAD_HALF);
}

export function surfaceHeight(x, z) {
  return onRoad(x, z) ? 0 : CURB_HEIGHT;
}

// Crosswalk arms: one per intersection side where a road continues, 6.5 from the center.
export const CROSSWALKS = (() => {
  const list = [];
  const extent = R[R.length - 1] + ROAD_HALF;
  for (const x of R) {
    for (const z of R) {
      // Crossing the road that runs along Z (at x), north and south of the intersection.
      for (const sz of [-1, 1]) {
        const cz = z + sz * SIDEWALK_OFFSET;
        if (Math.abs(cz) < extent) list.push({ x, z: cz, across: 'x' });
      }
      // Crossing the road that runs along X (at z), west and east of the intersection.
      for (const sx of [-1, 1]) {
        const cx = x + sx * SIDEWALK_OFFSET;
        if (Math.abs(cx) < extent) list.push({ x: cx, z, across: 'z' });
      }
    }
  }
  return list;
})();
