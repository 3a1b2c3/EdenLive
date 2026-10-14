// Single owner of the Moorland Archer static world. Later stages import buildWorld()
// and read the returned data (terrain height, colliders, spawn points) instead of
// rebuilding geometry.
import {
  AmbientLight, Box3, Color, ConeGeometry, CylinderGeometry, DirectionalLight, DodecahedronGeometry,
  Group, HemisphereLight, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  PlaneGeometry, Quaternion, SphereGeometry, Vector3, BoxGeometry, TorusGeometry,
} from 'three';
import { createTerrainMesh } from '/assets/world/environment/TerrainMeshFactory.js';
import { createCharacterVisual } from '/assets/world/object/factory/CharacterVisualFactory.js';
import { buildSimpleFantasyCreatureVisual } from '/assets/world/object/factory/FantasyCreatureVisualFactory.js';
import { buildSimpleTreeVisual } from '/assets/world/object/factory/TreeVisualFactory.js';
import { buildSimpleHouseVisual } from '/assets/world/object/factory/HouseVisualFactory.js';
import { buildSimpleRockVisual } from '/assets/world/object/factory/RockVisualFactory.js';

export const WORLD = Object.freeze({
  size: 340,
  segments: 210,
  playableRadius: 118,
  waterLevel: -1.0,
  deepWater: -2.1, // terrain below this is too deep to wade
  playerStart: Object.freeze({ x: 3, z: 38, yaw: 0 }),
  shrine: Object.freeze({ x: 0, z: -74, plateau: 7 }),
  campfire: Object.freeze({ x: 0, z: -57 }),
  lake: Object.freeze({ x: -40, z: 10 }),
});

// Monster roster: counts and roles are gameplay data kept with the scene.
export const MONSTER_SPAWNS = Object.freeze([
  Object.freeze({ id: 'bokoblin-red', kind: 'club', x: -5.5, z: -58.5, yaw: 0.4, hp: 3, color: 'red' }),
  Object.freeze({ id: 'bokoblin-blue', kind: 'club', x: 5.8, z: -59.5, yaw: -0.5, hp: 3, color: 'blue' }),
  Object.freeze({ id: 'bokoblin-boss', kind: 'thrower', x: 0.5, z: -64.5, yaw: 0, hp: 5, color: 'black' }),
]);

const smoothstep = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

const STREAM = [[-40, 10], [-56, -8], [-66, -32], [-88, -48], [-112, -58]];
function distToStream(x, z) {
  let best = Infinity;
  for (let i = 0; i < STREAM.length - 1; i += 1) {
    const [ax, az] = STREAM[i], [bx, bz] = STREAM[i + 1];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best;
}
// Dirt path from the start meadow to the shrine plateau.
function pathFactor(x, z) {
  if (z > 50 || z < -62) return 0;
  const cx = Math.sin(z * 0.05) * 5;
  return 1 - smoothstep(1.6, 3.6, Math.abs(x - cx));
}

// Heightfield in world coordinates (x right, z toward the viewer, y up).
export function heightAt(x, z) {
  let h = 2.4 * Math.sin(x * 0.043) * Math.cos(z * 0.037)
    + 1.5 * Math.sin(x * 0.091 + 1.3) * Math.sin(z * 0.072 + 0.4)
    + 0.55 * Math.sin(x * 0.21 + z * 0.17)
    + 2.2 * smoothstep(20, 60, z) * (1 - smoothstep(60, 90, z)); // start meadow sits on a rise
  const r = Math.hypot(x, z);
  h += smoothstep(105, 165, r) * 22;
  const dp = Math.hypot(x - WORLD.shrine.x, z - WORLD.shrine.z);
  h = mix(h, WORLD.shrine.plateau, 1 - smoothstep(18, 34, dp));
  // Ramp up to the plateau along the path.
  const ramp = (1 - smoothstep(4, 9, Math.abs(x))) * smoothstep(-20, -52, z) * (1 - smoothstep(-52, -58, z));
  h = mix(h, mix(h, WORLD.shrine.plateau, smoothstep(-30, -54, z)), ramp);
  const dl = Math.hypot((x - WORLD.lake.x) / 1.35, z - WORLD.lake.z);
  h = mix(h, -4.6, 1 - smoothstep(9, 24, dl));
  const ds = distToStream(x, z);
  h = mix(h, Math.min(h, -2.3), 1 - smoothstep(2.4, 6.5, ds));
  return h;
}

export function isDeepWater(x, z) { return heightAt(x, z) < WORLD.deepWater; }

function terrainColor(x, z, h) {
  const n = 0.04 * Math.sin(x * 0.7 + z * 0.3) * Math.cos(z * 0.9 - x * 0.2);
  let r = 0.36 + n, g = 0.62 + n * 1.2, b = 0.24 + n * 0.5; // bright meadow green
  const high = smoothstep(4, 20, h);
  r = mix(r, 0.44, high); g = mix(g, 0.5, high); b = mix(b, 0.3, high);
  const shore = 1 - smoothstep(-1.4, 0.1, h);
  r = mix(r, 0.78, shore); g = mix(g, 0.72, shore); b = mix(b, 0.52, shore);
  const p = pathFactor(x, z) * (h > -0.5 ? 1 : 0);
  r = mix(r, 0.72, p * 0.85); g = mix(g, 0.6, p * 0.85); b = mix(b, 0.4, p * 0.85);
  const dp = Math.hypot(x - WORLD.shrine.x, z - WORLD.shrine.z);
  const stone = 1 - smoothstep(10, 17, dp);
  r = mix(r, 0.55, stone); g = mix(g, 0.56, stone); b = mix(b, 0.52, stone);
  return { r, g, b };
}

// Sampler shaped for TerrainMeshFactory: (right, forward) with forward = -z.
const terrainSampler = {
  sample(right, forward) {
    const x = right, z = -forward, h = heightAt(x, z);
    return { height: h, color: terrainColor(x, z, h) };
  },
  heightAt: (right, forward) => heightAt(right, -forward),
};

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

// Control-signal look for factory output: no metal, no gloss, no emissive glow.
function flatten(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m) continue;
      if ('metalness' in m) m.metalness = 0;
      if ('roughness' in m) m.roughness = 1;
      if (m.emissive) m.emissive.set(0);
    }
  });
}

function shadowAll(root, cast = true) {
  root.traverse(o => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = true; } });
}

// Attach a primitive to a factory node, sized in world units, preserving world pose.
function attachWorld(node, mesh, worldPos) {
  node.updateWorldMatrix(true, false);
  mesh.position.copy(worldPos);
  mesh.updateMatrixWorld(true);
  node.attach(mesh);
  return mesh;
}
function worldBox(obj) { obj.updateWorldMatrix(true, true); return new Box3().setFromObject(obj); }

function createMountains() {
  const group = new Group();
  group.name = 'mountains';
  const rnd = mulberry32(7);
  const rockMat = new MeshLambertMaterial({ color: 0x7890ad, flatShading: true });
  const snowMat = new MeshLambertMaterial({ color: 0xf1f5fa, flatShading: true });
  for (let i = 0; i < 18; i += 1) {
    const a = (i / 18) * Math.PI * 2 + rnd() * 0.2;
    const r = 330 + rnd() * 90;
    const hgt = 90 + rnd() * 110, rad = 70 + rnd() * 50;
    const m = new Mesh(new ConeGeometry(rad, hgt, 7), rockMat);
    m.position.set(Math.cos(a) * r, hgt / 2 + 5, Math.sin(a) * r);
    m.rotation.y = rnd() * Math.PI;
    group.add(m);
    if (hgt > 150) {
      const cap = new Mesh(new ConeGeometry(rad * 0.34, hgt * 0.34, 7), snowMat);
      cap.position.set(m.position.x, 5 + hgt - hgt * 0.17 + 0.5, m.position.z);
      cap.rotation.y = m.rotation.y;
      group.add(cap);
    }
  }
  return group;
}

function createWater() {
  const water = new Mesh(new PlaneGeometry(WORLD.size, WORLD.size, 1, 1),
    new MeshLambertMaterial({ color: 0x3a8ed0, transparent: true, opacity: 0.8 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = WORLD.waterLevel;
  water.name = 'water';
  water.receiveShadow = true;
  return water;
}

function placementOk(x, z, clearance = 0) {
  const h = heightAt(x, z);
  if (h < WORLD.waterLevel + 0.6) return false;
  if (Math.hypot(x, z) > 150) return false;
  if (pathFactor(x, z) > 0.01 || Math.abs(x - Math.sin(z * 0.05) * 5) < 6 + clearance && z < 52 && z > -62) return false;
  if (Math.hypot(x - WORLD.shrine.x, z - WORLD.shrine.z) < 32 + clearance) return false;
  if (Math.hypot(x - WORLD.playerStart.x, z - WORLD.playerStart.z) < 9) return false;
  return true;
}

function createTrees(colliders) {
  const group = new Group();
  group.name = 'trees';
  const rnd = mulberry32(2026);
  const groves = [[-22, 46], [26, 22], [-62, 58], [44, -16], [-26, -32], [58, 52], [-80, -6],
    [32, -58], [-44, -66], [80, 10], [-14, 12], [70, -60], [-96, 36], [18, 76]];
  const leafs = ['#5d9f43', '#4f8f3a', '#6bab4c', '#478540'];
  for (const [gx, gz] of groves) {
    const count = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < count; i += 1) {
      const x = gx + (rnd() - 0.5) * 16, z = gz + (rnd() - 0.5) * 16;
      if (!placementOk(x, z, 1)) continue;
      const pine = rnd() < 0.4;
      const height = pine ? 8 + rnd() * 4 : 6 + rnd() * 3;
      const tree = buildSimpleTreeVisual(pine
        ? { preset: 'pine', height, crownWidth: 3.6 + rnd(), colors: { leaf: '#3f7442', bark: '#6d5440' } }
        : { preset: 'oak', height, crownWidth: 5 + rnd() * 1.5, colors: { leaf: leafs[i % leafs.length], bark: '#7a5d42' } });
      tree.group.position.set(x, heightAt(x, z) - 0.15, z);
      tree.group.rotation.y = rnd() * Math.PI * 2;
      shadowAll(tree.group);
      group.add(tree.group);
      colliders.push({ type: 'tree', x, z, r: 0.7 });
    }
  }
  return group;
}

function createRocks(colliders) {
  const group = new Group();
  group.name = 'rocks';
  const rnd = mulberry32(99);
  const spots = [[12, 48], [-10, 28], [18, 6], [-30, 62], [38, 36], [-52, 30], [22, -34], [-18, -48],
    [-12, -52], [14, -50], [60, 24], [-70, 44], [-34, -8], [48, -40]];
  for (const [x, z] of spots) {
    if (!placementOk(x, z)) continue;
    const s = 0.7 + rnd() * 0.9;
    const rock = buildSimpleRockVisual({ preset: rnd() < 0.7 ? 'boulder' : 'flatRock' });
    rock.group.scale.setScalar(s);
    rock.group.position.set(x, heightAt(x, z) - 0.25, z);
    rock.group.rotation.y = rnd() * Math.PI * 2;
    shadowAll(rock.group);
    group.add(rock.group);
    colliders.push({ type: 'rock', x, z, r: 1.2 * s });
  }
  return group;
}

function createGrass() {
  const rnd = mulberry32(5);
  const geo = new ConeGeometry(0.16, 0.9, 4);
  geo.translate(0, 0.45, 0);
  const mat = new MeshLambertMaterial({ color: 0x74b54c, flatShading: true });
  const count = 900;
  const mesh = new InstancedMesh(geo, mat, count);
  mesh.name = 'grass-tufts';
  const m = new Matrix4(), q = new Quaternion(), s = new Vector3(), p = new Vector3(), up = new Vector3(0, 1, 0);
  let n = 0;
  for (let i = 0; i < count * 3 && n < count; i += 1) {
    const x = (rnd() - 0.5) * 220, z = (rnd() - 0.5) * 220;
    const h = heightAt(x, z);
    if (h < WORLD.waterLevel + 0.3 || pathFactor(x, z) > 0.2) continue;
    if (Math.hypot(x - WORLD.shrine.x, z - WORLD.shrine.z) < 16) continue;
    q.setFromAxisAngle(up, rnd() * 6.28);
    const k = 0.6 + rnd() * 0.9;
    s.set(k, k * (0.8 + rnd() * 0.6), k);
    p.set(x, h - 0.05, z);
    mesh.setMatrixAt(n, m.compose(p, q, s));
    n += 1;
  }
  mesh.count = n;
  mesh.receiveShadow = true;
  return mesh;
}

function createVillage(colliders) {
  const group = new Group();
  group.name = 'village';
  const houses = [
    { preset: 'cottage', x: 96, z: -104, yaw: -0.7 },
    { preset: 'chalet', x: 110, z: -90, yaw: -1.0 },
    { preset: 'cabin', x: 84, z: -118, yaw: -0.5 },
    { preset: 'farmhouse', x: 122, z: -110, yaw: -0.9 },
    { preset: 'barn', x: 104, z: -126, yaw: -0.6 },
  ];
  for (const h of houses) {
    const house = buildSimpleHouseVisual({ preset: h.preset, colors: { wall: '#eadcbc', roof: '#b4483a' } });
    house.group.position.set(h.x, heightAt(h.x, h.z) - 0.3, h.z);
    house.group.rotation.y = h.yaw;
    shadowAll(house.group);
    group.add(house.group);
    colliders.push({ type: 'house', x: h.x, z: h.z, r: 5 });
  }
  return group;
}

function createShrine(colliders) {
  const { x, z, plateau } = WORLD.shrine;
  const group = new Group();
  group.name = 'shrine';
  group.position.set(x, plateau, z);
  const slate = new MeshLambertMaterial({ color: 0x3d4450, flatShading: true });
  const trim = new MeshLambertMaterial({ color: 0x59606c, flatShading: true });
  const glowMat = new MeshBasicMaterial({ color: 0xffa640 });
  const add = (geo, mat, px, py, pz, name) => {
    const m = new Mesh(geo, mat);
    m.position.set(px, py, pz);
    if (name) m.name = name;
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    return m;
  };
  add(new CylinderGeometry(10, 11, 1.2, 8), trim, 0, 0.6, 0, 'shrine-base');
  add(new CylinderGeometry(7.2, 7.8, 6.5, 8), slate, 0, 4.4, 0, 'shrine-body');
  add(new SphereGeometry(7.4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), slate, 0, 7.6, 0, 'shrine-dome').scale.y = 0.6;
  add(new CylinderGeometry(1.1, 1.4, 1.6, 8), trim, 0, 12.8, 0, 'shrine-crown');
  add(new TorusGeometry(7.3, 0.18, 6, 24), glowMat, 0, 7.6, 0, 'shrine-glow-ring').rotation.x = Math.PI / 2;
  // Doorway facing +z toward the approach path.
  add(new BoxGeometry(4.2, 5.2, 1.2), trim, 0, 3.8, 7.1, 'shrine-door-frame');
  add(new PlaneGeometry(3, 4.2), glowMat, 0, 3.4, 7.72, 'shrine-doorway');
  for (const sx of [-1, 1]) {
    add(new BoxGeometry(1, 7.5, 1), trim, sx * 3.2, 4.6, 7.4, 'shrine-pillar');
    add(new BoxGeometry(0.16, 4.6, 0.1), glowMat, sx * 3.2, 4.8, 7.95, 'shrine-pillar-rune');
  }
  // Steps down from the door.
  for (let i = 0; i < 3; i += 1) add(new BoxGeometry(5.5 - i * 0.3, 0.4, 1.2), trim, 0, 1.0 - i * 0.35, 8.6 + i * 1.1);
  colliders.push({ type: 'shrine', x, z, r: 10.2 });
  return group;
}

function createCampfire() {
  const { x, z } = WORLD.campfire;
  const group = new Group();
  group.name = 'campfire';
  group.position.set(x, heightAt(x, z), z);
  const wood = new MeshLambertMaterial({ color: 0x6b4a2e });
  for (let i = 0; i < 5; i += 1) {
    const log = new Mesh(new CylinderGeometry(0.14, 0.16, 1.4, 6), wood);
    log.rotation.z = Math.PI / 2.6;
    const a = (i / 5) * Math.PI * 2;
    log.position.set(Math.cos(a) * 0.35, 0.3, Math.sin(a) * 0.35);
    log.rotation.y = -a;
    log.castShadow = true;
    group.add(log);
  }
  const stoneMat = new MeshLambertMaterial({ color: 0x80807a, flatShading: true });
  for (let i = 0; i < 9; i += 1) {
    const a = (i / 9) * Math.PI * 2;
    const st = new Mesh(new DodecahedronGeometry(0.28), stoneMat);
    st.position.set(Math.cos(a) * 1.0, 0.12, Math.sin(a) * 1.0);
    group.add(st);
  }
  const flame = new Mesh(new ConeGeometry(0.45, 1.3, 7),
    new MeshBasicMaterial({ color: 0xffb13b }));
  flame.position.y = 0.85;
  flame.name = 'campfire-flame';
  group.add(flame);
  return group;
}

// Bokoblin: orc-rig creature with added long ears, snout horn and a wooden club.
export function createMonsterVisual(spawn) {
  const palette = {
    red: { body: '#c9533f', belly: '#e59a78', clothing: '#5d3b25', armor: '#6e5a45', accent: '#ecdcb4', eye: '#fff2a0' },
    blue: { body: '#4d6fc0', belly: '#90a8dc', clothing: '#4a3222', armor: '#5d5e66', accent: '#ecdcb4', eye: '#fff2a0' },
    black: { body: '#3a3440', belly: '#6c6070', clothing: '#6d2a26', armor: '#8a7a66', accent: '#e8c46a', eye: '#ff5a3a' },
  }[spawn.color];
  const big = spawn.kind === 'thrower';
  const creature = buildSimpleFantasyCreatureVisual({
    preset: 'orc', heightScale: big ? 1.05 : 0.78, bodyWidth: big ? 1.45 : 1.2, headScale: 1.3,
    hunch: 0.15, armor: 'scrap', hornStyle: 'spires', hornSize: 0.8, colors: palette,
  });
  creature.mesh.name = `monster-${spawn.id}`;
  creature.setPose('idle', 0);
  const root = new Group();
  root.name = spawn.id;
  root.add(creature.mesh);
  root.position.set(spawn.x, heightAt(spawn.x, spawn.z), spawn.z);
  root.rotation.y = spawn.yaw;
  root.updateMatrixWorld(true);

  const skin = new MeshLambertMaterial({ color: palette.body, flatShading: true });
  const head = creature.attachments.head;
  if (head) {
    const hb = worldBox(head), hc = hb.getCenter(new Vector3()), hs = hb.getSize(new Vector3());
    for (const side of [-1, 1]) {
      const ear = new Mesh(new ConeGeometry(hs.y * 0.18, hs.x * 0.9, 4), skin);
      ear.rotation.set(0, root.rotation.y, side * -1.25);
      const offset = new Vector3(side * hs.x * 0.62, hs.y * 0.1, 0).applyAxisAngle(new Vector3(0, 1, 0), root.rotation.y);
      attachWorld(head, ear, hc.clone().add(offset));
    }
  }
  const hand = creature.attachments.rightHand ?? creature.attachments.leftHand;
  if (hand) {
    const hp = worldBox(hand).getCenter(new Vector3());
    const club = new Group();
    club.name = 'club';
    const woodMat = new MeshLambertMaterial({ color: big ? 0x8b8b90 : 0x8a5a32, flatShading: true });
    const shaft = new Mesh(new CylinderGeometry(big ? 0.2 : 0.12, big ? 0.26 : 0.2, big ? 1.6 : 1.2, 6), woodMat);
    shaft.position.y = big ? 0.6 : 0.45;
    club.add(shaft);
    if (big) {
      const boulder = new Mesh(new DodecahedronGeometry(0.42), new MeshLambertMaterial({ color: 0x8c8c84, flatShading: true }));
      boulder.position.y = 1.5;
      club.add(boulder);
    }
    club.rotation.set(0.5, root.rotation.y, 0.35);
    attachWorld(hand, club, hp);
  }
  shadowAll(root);
  return { root, creature, spawn };
}

export function createPlayerVisual() {
  const actor = createCharacterVisual({
    preset: 'ranger', height: 1.9, build: 0.9, headShape: 'round',
    colors: { top: '#3f8f45', pants: '#e2cf9f', skin: '#f0c9a0', accent: '#7a5a38' },
  });
  actor.setPose('idle', 0);
  const root = new Group();
  root.name = 'player';
  root.add(actor.group);
  root.updateMatrixWorld(true);
  const head = actor.attachments.head;
  if (head) {
    const hb = worldBox(head), hc = hb.getCenter(new Vector3()), hs = hb.getSize(new Vector3());
    const hood = new Mesh(new ConeGeometry(hs.x * 0.62, hs.y * 1.3, 8),
      new MeshLambertMaterial({ color: 0x2f7a3a, flatShading: true }));
    hood.rotation.x = 0.55; // floppy hood leaning back
    attachWorld(head, hood, hc.clone().add(new Vector3(0, hs.y * 0.55, hs.z * 0.2)));
    const hair = new Mesh(new SphereGeometry(hs.x * 0.54, 10, 8), new MeshLambertMaterial({ color: 0xe0b85c }));
    hair.scale.set(1, 0.55, 1);
    attachWorld(head, hair, hc.clone().add(new Vector3(0, hs.y * 0.25, hs.z * 0.08)));
  }
  // Quiver on the back (+z is behind for a -z facing actor).
  const chest = actor.rig?.chest;
  if (chest) {
    const cb = worldBox(chest), cc = cb.getCenter(new Vector3()), cs = cb.getSize(new Vector3());
    const quiver = new Mesh(new CylinderGeometry(0.1, 0.09, 0.62, 8), new MeshLambertMaterial({ color: 0x6d4a2a }));
    quiver.rotation.z = 0.45;
    attachWorld(chest, quiver, cc.clone().add(new Vector3(0, cs.y * 0.15, cs.z * 0.6)));
  }
  shadowAll(root);
  return { root, actor };
}

// Arrow: shaft, steel head and fletching, pointing along local -z.
export function createArrowMesh() {
  const arrow = new Group();
  arrow.name = 'arrow';
  const shaft = new Mesh(new CylinderGeometry(0.025, 0.025, 1.0, 5), new MeshLambertMaterial({ color: 0xd8b77a }));
  shaft.rotation.x = Math.PI / 2;
  arrow.add(shaft);
  const tip = new Mesh(new ConeGeometry(0.06, 0.18, 5), new MeshLambertMaterial({ color: 0xd0d6de }));
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -0.58;
  arrow.add(tip);
  const fletchMat = new MeshLambertMaterial({ color: 0xf4f4f0, side: 2 });
  for (let i = 0; i < 3; i += 1) {
    const f = new Mesh(new PlaneGeometry(0.1, 0.22), fletchMat);
    f.position.z = 0.42;
    f.rotation.set(Math.PI / 2, 0, (i / 3) * Math.PI);
    f.rotation.order = 'ZXY';
    arrow.add(f);
  }
  arrow.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return arrow;
}

const SKY = 0x6fb3ea;

// White key + white/grey hemisphere, no fog: the renderer is a control signal
// and the registry prompts own weather and light.
function addLights(scene) {
  scene.background = new Color(SKY);
  scene.add(new HemisphereLight(0xffffff, 0x888888, 1.2));
  scene.add(new AmbientLight(0xffffff, 0.3));
  const sun = new DirectionalLight(0xffffff, 2.0);
  sun.position.set(30.1, 66.9, -52.1); // elevation 48 deg, azimuth 30 deg, 90 m out
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, far: 225 });
  scene.add(sun);
  return { sun };
}

export function buildWorld(scene) {
  const colliders = [];
  const atmosphere = addLights(scene);

  scene.add(createMountains());

  const terrain = createTerrainMesh({ terrainSampler, size: WORLD.size, segments: WORLD.segments,
    materialOptions: { roughness: 1, metalness: 0, flatShading: false } });
  terrain.name = 'terrain';
  scene.add(terrain);
  scene.add(createWater());
  scene.add(createTrees(colliders));
  scene.add(createRocks(colliders));
  scene.add(createGrass());
  scene.add(createVillage(colliders));
  scene.add(createShrine(colliders));
  const campfire = createCampfire();
  scene.add(campfire);

  const monsters = MONSTER_SPAWNS.map(createMonsterVisual);
  const monsterGroup = new Group();
  monsterGroup.name = 'monsters';
  for (const m of monsters) monsterGroup.add(m.root);
  scene.add(monsterGroup);

  const player = createPlayerVisual();
  const { x, z, yaw } = WORLD.playerStart;
  player.root.position.set(x, heightAt(x, z), z);
  player.root.rotation.y = yaw;
  scene.add(player.root);

  // Representative arrow lodged in the ground ahead of the archer (a missed shot).
  const stuck = createArrowMesh();
  stuck.name = 'arrow-stuck';
  stuck.position.set(x - 2.2, heightAt(x - 2.2, z - 7) + 0.35, z - 7);
  stuck.rotation.x = -0.9;
  scene.add(stuck);

  flatten(scene);
  return { atmosphere, terrain, campfire, monsters, player, colliders, arrowSample: stuck };
}
