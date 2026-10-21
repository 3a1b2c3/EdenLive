// Course layout shared by the scene (visuals) and, later, the game rules (collision and triggers).
// World basis: +X right, +Y up, -Z forward. The route runs from START toward -Z.

export const ROAD = Object.freeze({
  laneWidth: 3.6,
  laneCenters: Object.freeze([-5.4, -1.8, 1.8, 5.4]),
  halfWidth: 7.2,
  bayWidth: 2.8,
  sidewalkWidth: 4,
  buildingSetback: 14,
  startZ: 14,
  endZ: -724,
});

export const START = Object.freeze({ x: 1.8, z: 0 });
export const FINISH_Z = -700;
export const CHECKPOINT_ZS = Object.freeze([-90, -250, -410, -570]);
export const CROSS_STREET_ZS = Object.freeze([-70, -210, -350, -490, -630]);
export const CROSS_STREET_DEPTH = 14;

export const CHECKPOINT_WIDTH = 16;

// Axis-aligned hazard boxes (center x/z, full width/depth).
export const ROADBLOCKS = Object.freeze([
  { id: 'rb01', x: -5.4, z: -45, width: 3.2, depth: 0.9, height: 1.1 },
  { id: 'rb02', x: -5.4, z: -100, width: 3.2, depth: 0.9, height: 1.1 },
  { id: 'rb03', x: 5.4, z: -165, width: 3.2, depth: 0.9, height: 1.1 },
  { id: 'rb04', x: 1.8, z: -165, width: 3.2, depth: 0.9, height: 1.1 },
  { id: 'rb05', x: -1.8, z: -235, width: 3.2, depth: 0.9, height: 1.1 },
  { id: 'rb06', x: 5.4, z: -300, width: 3.2, depth: 0.9, height: 1.1 },
  { id: 'rb07', x: -5.4, z: -345, width: 3.2, depth: 0.9, height: 1.1 },
  { id: 'rb08', x: -1.8, z: -345, width: 3.2, depth: 0.9, height: 1.1 },
  { id: 'rb09', x: 1.8, z: -405, width: 3.2, depth: 0.9, height: 1.1 },
  { id: 'rb10', x: -5.4, z: -470, width: 3.2, depth: 0.9, height: 1.1 },
  { id: 'rb11', x: 5.4, z: -520, width: 3.2, depth: 0.9, height: 1.1 },
  { id: 'rb12', x: 1.8, z: -520, width: 3.2, depth: 0.9, height: 1.1 },
  { id: 'rb13', x: -1.8, z: -585, width: 3.2, depth: 0.9, height: 1.1 },
  { id: 'rb14', x: 5.4, z: -650, width: 3.2, depth: 0.9, height: 1.1 },
]);

// Slow civilian cars driving the same way as the player, in lane centers.
export const TRAFFIC = Object.freeze([
  { id: 'tr01', preset: 'taxi', x: -1.8, z: -75, speed: 9, color: '#e8e4d8' },
  { id: 'tr02', preset: 'bus', x: 5.4, z: -120, speed: 8, color: '#3f7fbf' },
  { id: 'tr03', preset: 'sedan', x: -5.4, z: -190, speed: 10, color: '#b6403a' },
  { id: 'tr04', preset: 'boxtruck', x: 1.8, z: -255, speed: 8, color: '#d9d9d2' },
  { id: 'tr05', preset: 'hatchback', x: -5.4, z: -310, speed: 11, color: '#4fa36b' },
  { id: 'tr06', preset: 'taxi', x: 5.4, z: -375, speed: 9, color: '#e8e4d8' },
  { id: 'tr07', preset: 'suv', x: -1.8, z: -440, speed: 10, color: '#59616b' },
  { id: 'tr08', preset: 'van', x: 1.8, z: -495, speed: 9, color: '#f0f0ea' },
  { id: 'tr09', preset: 'sedan', x: -5.4, z: -545, speed: 10, color: '#7a4fb0' },
  { id: 'tr10', preset: 'bus', x: -1.8, z: -615, speed: 8, color: '#3f7fbf' },
  { id: 'tr11', preset: 'coupe', x: 5.4, z: -675, speed: 10, color: '#d0642b' },
]);

// Parked cars in the curb bays.
export const PARKED = Object.freeze([
  { id: 'pk01', preset: 'sedan', side: 1, z: -30, color: '#8a8f99' },
  { id: 'pk02', preset: 'hatchback', side: -1, z: -95, color: '#c8c0a0' },
  { id: 'pk03', preset: 'pickup', side: 1, z: -150, color: '#6a7f9a' },
  { id: 'pk04', preset: 'suv', side: -1, z: -255, color: '#9a4a4a' },
  { id: 'pk05', preset: 'sedan', side: 1, z: -320, color: '#d0d0c8' },
  { id: 'pk06', preset: 'van', side: -1, z: -395, color: '#4a6a8a' },
  { id: 'pk07', preset: 'hatchback', side: 1, z: -455, color: '#a06a2a' },
  { id: 'pk08', preset: 'coupe', side: -1, z: -520, color: '#2f2f35' },
  { id: 'pk09', preset: 'sedan', side: 1, z: -600, color: '#7f9a7a' },
  { id: 'pk10', preset: 'pickup', side: -1, z: -665, color: '#b0b0b8' },
]);

export const STREETLIGHT_SPACING = 46;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BUILDING_PRESETS = ['office', 'skyscraper', 'apartment', 'hotel', 'tower', 'civic', 'office', 'apartment'];
const MASSINGS = ['block', 'setback', 'podium', 'block'];
const WALLS = ['#b9b3a6', '#8a97a6', '#a89f91', '#7d8794', '#c9b79c', '#96a0ab', '#b3a58c'];

export function inCrossStreetGap(z, margin = 0) {
  return CROSS_STREET_ZS.some(cz => Math.abs(z - cz) < CROSS_STREET_DEPTH * 0.5 + 10 + margin);
}

// Deterministic building slots, one row per side of the avenue.
export function buildingSlots(seed = 20261021) {
  const rand = mulberry32(seed);
  const slots = [];
  for (const side of [-1, 1]) {
    for (let z = 24; z > ROAD.endZ - 40; z -= 28) {
      if (inCrossStreetGap(z)) continue;
      const pick = list => list[Math.floor(rand() * list.length)];
      slots.push({
        side,
        z,
        seed: Math.floor(rand() * 100000) + 1,
        preset: pick(BUILDING_PRESETS),
        massing: pick(MASSINGS),
        floors: 5 + Math.floor(rand() * 14),
        width: 9 + Math.floor(rand() * 7),
        depth: 9 + Math.floor(rand() * 6),
        wall: pick(WALLS),
      });
    }
  }
  return slots;
}
