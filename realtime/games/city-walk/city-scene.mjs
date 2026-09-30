// One owner for the city's 3D composition. Later stages import this module and animate the
// returned handles; they do not rebuild the city.
import {
  BoxGeometry, CylinderGeometry, DoubleSide, Group, InstancedMesh, Mesh, MeshLambertMaterial, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry,
  TorusGeometry,
} from 'three';
import { mergeGeometries } from '/assets/math/BufferGeometryUtils.js';
import { buildSimpleBuildingVisual } from '/assets/world/object/factory/BuildingVisualFactory.js';
import { buildSimpleCharacterVisual } from '/assets/world/object/factory/CharacterVisualFactory.js';
import { buildSimpleTreeVisual } from '/assets/world/object/factory/TreeVisualFactory.js';
import { buildSimpleVehicleVisual } from '/assets/world/object/factory/VehicleVisualFactory.js';
import {
  BLOCKS, CAR_ROUTES, CITY_HALF, CROSSWALKS, CURB_HEIGHT, FOUNTAIN, INITIAL_RING_SPOTS,
  PEDESTRIAN_ROUTES, PLAYER_SPAWN, RING_SPOTS, ROAD_HALF, ROAD_LINES, SIDEWALK_OUTER, samplePath,
  surfaceHeight,
} from './city-layout.mjs';

const EXTENT = ROAD_LINES[ROAD_LINES.length - 1] + ROAD_HALF;

const COLORS = {
  asphalt: 0x3b3f46,
  sidewalk: 0xc9c4b8,
  lot: 0xa9a59b,
  grass: 0x7fb069,
  outerGround: 0x8fb77a,
  dash: 0xf2d25c,
  zebra: 0xf4f4f0,
  lampPole: 0x4a4f57,
  lampHead: 0xfff1c4,
  ring: 0x3ff0ff,
};

const BUILDING_PRESETS = ['apartment', 'office', 'shop', 'hotel', 'tower', 'townhouse', 'civic', 'skyscraper'];
const WALL_TINTS = ['#d7c7a8', '#b9c7cf', '#e0b89a', '#c4d0b4', '#d9d4c8', '#a9b6c9', '#e3cfa0', '#c7a99b'];
const PED_TOPS = ['#5b7fc7', '#e07a5f', '#81b29a', '#f2cc8f', '#9c6ade', '#3d405b', '#e56b9f', '#6ab0c9'];

export const PLAYER_OPTIONS = Object.freeze({
  preset: 'runner', height: 1.8, build: 1.05, loadout: { left: null, right: null },
  colors: { top: '#e63946', pants: '#1d3557', accent: '#ffd166' },
});

function box(w, h, d, color, { x = 0, y = 0, z = 0, name } = {}) {
  const mesh = new Mesh(new BoxGeometry(w, h, d), new MeshStandardMaterial({ color, flatShading: true }));
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  if (name) mesh.name = name;
  return mesh;
}

function buildGround() {
  const group = new Group();
  group.name = 'roads';
  const outer = new Mesh(new PlaneGeometry(900, 900), new MeshStandardMaterial({ color: COLORS.outerGround }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.02;
  outer.receiveShadow = true;
  group.add(outer);
  // One asphalt slab under the whole grid; blocks sit on top as raised sidewalks.
  const asphalt = new Mesh(new PlaneGeometry(EXTENT * 2, EXTENT * 2), new MeshStandardMaterial({ color: COLORS.asphalt }));
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.receiveShadow = true;
  group.add(asphalt);

  // Dashed center lines between intersections.
  const dashes = [];
  for (const line of ROAD_LINES) {
    for (let i = 0; i < ROAD_LINES.length - 1; i += 1) {
      const a = ROAD_LINES[i] + ROAD_HALF + 1;
      const b = ROAD_LINES[i + 1] - ROAD_HALF - 1;
      for (let t = a + 1; t < b; t += 4) {
        dashes.push({ x: line, z: t, rotY: 0 });
        dashes.push({ x: t, z: line, rotY: Math.PI / 2 });
      }
    }
  }
  const dashMesh = new InstancedMesh(new BoxGeometry(0.18, 0.02, 2), new MeshStandardMaterial({ color: COLORS.dash }), dashes.length);
  const dummy = new Object3D();
  dashes.forEach((d, i) => {
    dummy.position.set(d.x, 0.01, d.z);
    dummy.rotation.set(0, d.rotY, 0);
    dummy.updateMatrix();
    dashMesh.setMatrixAt(i, dummy.matrix);
  });
  dashMesh.name = 'lane_markings';
  group.add(dashMesh);
  return group;
}

function buildCrosswalks() {
  const stripesPer = 6;
  const mesh = new InstancedMesh(
    new BoxGeometry(0.8, 0.02, 2.6),
    new MeshStandardMaterial({ color: COLORS.zebra }),
    CROSSWALKS.length * stripesPer,
  );
  const dummy = new Object3D();
  let i = 0;
  for (const cw of CROSSWALKS) {
    for (let k = 0; k < stripesPer; k += 1) {
      const u = -ROAD_HALF + 0.9 + k * ((ROAD_HALF * 2 - 1.8) / (stripesPer - 1));
      // Stripes run with traffic and are laid out across the road being crossed.
      if (cw.across === 'x') {
        dummy.position.set(cw.x + u, 0.012, cw.z);
        dummy.rotation.set(0, 0, 0);
      } else {
        dummy.position.set(cw.x, 0.012, cw.z + u);
        dummy.rotation.set(0, Math.PI / 2, 0);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      i += 1;
    }
  }
  mesh.name = 'crosswalks';
  mesh.userData.crosswalks = CROSSWALKS;
  return mesh;
}

function buildSidewalks() {
  const group = new Group();
  group.name = 'sidewalks';
  for (const block of BLOCKS) {
    const w = block.x1 - block.x0;
    const d = block.z1 - block.z0;
    group.add(box(w, CURB_HEIGHT, d, COLORS.sidewalk, { x: block.cx, y: CURB_HEIGHT / 2, z: block.cz }));
    const lot = block.lot;
    const lotColor = block.park ? COLORS.grass : COLORS.lot;
    group.add(box(lot.x1 - lot.x0, 0.04, lot.z1 - lot.z0, lotColor,
      { x: block.cx, y: CURB_HEIGHT + 0.02, z: block.cz }));
  }
  // Perimeter sidewalk ring outside the outer road.
  const width = SIDEWALK_OUTER - ROAD_HALF + 4;
  const mid = EXTENT + width / 2;
  const span = (EXTENT + width) * 2;
  group.add(box(span, CURB_HEIGHT, width, COLORS.sidewalk, { y: CURB_HEIGHT / 2, z: -mid }));
  group.add(box(span, CURB_HEIGHT, width, COLORS.sidewalk, { y: CURB_HEIGHT / 2, z: mid }));
  group.add(box(width, CURB_HEIGHT, span - width * 2, COLORS.sidewalk, { x: -mid, y: CURB_HEIGHT / 2 }));
  group.add(box(width, CURB_HEIGHT, span - width * 2, COLORS.sidewalk, { x: mid, y: CURB_HEIGHT / 2 }));
  // Low hedge line marks the walkable edge at CITY_HALF.
  const hedge = new MeshStandardMaterial({ color: 0x4f7f4a, flatShading: true });
  const hedgeLen = CITY_HALF * 2 + 1.2;
  for (const [x, z, w, d] of [[0, -CITY_HALF - 0.6, hedgeLen, 1.2], [0, CITY_HALF + 0.6, hedgeLen, 1.2],
    [-CITY_HALF - 0.6, 0, 1.2, hedgeLen], [CITY_HALF + 0.6, 0, 1.2, hedgeLen]]) {
    const m = new Mesh(new BoxGeometry(w, 1.1, d), hedge);
    m.position.set(x, 0.55, z);
    m.castShadow = true;
    group.add(m);
  }
  return group;
}

function buildBuildings() {
  const group = new Group();
  group.name = 'buildings';
  const records = [];
  let n = 0;
  for (const block of BLOCKS) {
    if (block.park) continue;
    const lot = block.lot;
    const qw = (lot.x1 - lot.x0) / 2;
    const qd = (lot.z1 - lot.z0) / 2;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const preset = BUILDING_PRESETS[(n * 5 + block.ix * 3 + block.iz) % BUILDING_PRESETS.length];
      const size = preset === 'townhouse' ? { width: 4, blocks: 2 } : { width: 9, depth: 9 };
      const floors = { skyscraper: 16, tower: 12, office: 9, hotel: 8 }[preset];
      const options = {
        preset, ...size, depth: 9, ...(floors ? { floors } : {}),
        colors: { wall: WALL_TINTS[n % WALL_TINTS.length] },
      };
      const building = buildSimpleBuildingVisual(options);
      building.group.position.set(block.cx + sx * qw / 2 + 0.5 * sx, CURB_HEIGHT, block.cz + sz * qd / 2 + 0.5 * sz);
      // Entrance canopies face the nearest street.
      building.group.rotation.y = sz < 0 ? 0 : Math.PI;
      building.group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      group.add(building.group);
      records.push({ preset, options, block: [block.ix, block.iz] });
      n += 1;
    }
  }
  group.userData.records = records;
  return group;
}

function buildStreetProps() {
  const group = new Group();
  group.name = 'street_props';
  const poleGeo = new CylinderGeometry(0.08, 0.1, 4.6, 8);
  const armGeo = new BoxGeometry(0.1, 0.1, 1.2);
  const headGeo = new BoxGeometry(0.5, 0.16, 0.3);
  const poleMat = new MeshStandardMaterial({ color: COLORS.lampPole });
  const headMat = new MeshStandardMaterial({ color: COLORS.lampHead });
  const lamps = [];
  const trees = [];
  for (const block of BLOCKS) {
    const inset = 0.6;
    for (const [x, z, dx, dz] of [
      [block.x0 + inset, block.z0 + inset, -1, -1], [block.x1 - inset, block.z0 + inset, 1, -1],
      [block.x0 + inset, block.z1 - inset, -1, 1], [block.x1 - inset, block.z1 - inset, 1, 1],
    ]) {
      const lamp = new Group();
      const pole = new Mesh(poleGeo, poleMat);
      pole.position.y = 2.3;
      pole.castShadow = true;
      const arm = new Mesh(armGeo, poleMat);
      arm.position.set(0, 4.5, 0.5);
      const head = new Mesh(headGeo, headMat);
      head.position.set(0, 4.4, 1.0);
      lamp.add(pole, arm, head);
      lamp.position.set(x, CURB_HEIGHT, z);
      // Arm reaches over the road diagonal from the corner.
      lamp.rotation.y = Math.atan2(dx, dz);
      group.add(lamp);
      lamps.push({ x, z, radius: 0.25 });
    }
    // One tree per sidewalk side, off the pedestrian line and clear of the ring spots.
    const edge = 2.3; // from block edge, on the sidewalk's outer half
    const along = 7;
    const spots = [
      [block.cx - along, block.z0 + edge], [block.cx + along, block.z1 - edge],
      [block.x0 + edge, block.cz + along], [block.x1 - edge, block.cz - along],
    ];
    for (const [x, z] of spots) trees.push({ x, z, preset: block.park ? 'maple' : 'oak' });
  }
  // Park: a few extra trees around the fountain lawn.
  for (const [x, z, preset] of [[-10, -10, 'pine'], [10, -10, 'cherry'], [-10, 10, 'cherry'], [10, 10, 'pine']]) {
    trees.push({ x, z, preset });
  }
  const treeRecords = [];
  for (const t of trees) {
    const params = { preset: t.preset, height: t.preset === 'pine' ? 6.5 : 4.6, crownWidth: t.preset === 'pine' ? 3 : 3.2, trunkRadius: 0.16 };
    const tree = buildSimpleTreeVisual(params);
    tree.group.position.set(t.x, CURB_HEIGHT, t.z);
    group.add(tree.group);
    treeRecords.push({ x: t.x, z: t.z, radius: 0.35, preset: t.preset });
  }

  // Park fountain.
  const fountain = new Group();
  fountain.name = 'fountain';
  const stone = new MeshStandardMaterial({ color: 0xd8d2c4, flatShading: true });
  const basin = new Mesh(new CylinderGeometry(FOUNTAIN.radius, FOUNTAIN.radius + 0.2, 0.7, 20), stone);
  basin.position.y = 0.35 + CURB_HEIGHT;
  const water = new Mesh(new CylinderGeometry(FOUNTAIN.radius - 0.3, FOUNTAIN.radius - 0.3, 0.1, 20),
    new MeshStandardMaterial({ color: 0x6cc4e8 }));
  water.position.y = 0.66 + CURB_HEIGHT;
  const column = new Mesh(new CylinderGeometry(0.35, 0.5, 2.2, 10), stone);
  column.position.y = 1.2 + CURB_HEIGHT;
  const bowl = new Mesh(new CylinderGeometry(1.1, 0.5, 0.35, 14), stone);
  bowl.position.y = 2.3 + CURB_HEIGHT;
  for (const m of [basin, column, bowl]) m.castShadow = true;
  fountain.add(basin, water, column, bowl);
  fountain.position.set(FOUNTAIN.x, 0, FOUNTAIN.z);
  group.add(fountain);

  group.userData.lamps = lamps;
  group.userData.trees = treeRecords;
  return group;
}

export function createRingVisual(index) {
  const ring = new Group();
  ring.name = `score_ring_${index}`;
  const torus = new Mesh(new TorusGeometry(1.75, 0.16, 10, 40),
    new MeshBasicMaterial({ color: COLORS.ring }));
  torus.rotation.x = -Math.PI / 2;
  torus.position.y = 0.25;
  const disc = new Mesh(new CylinderGeometry(1.7, 1.7, 0.02, 32),
    new MeshBasicMaterial({ color: COLORS.ring, transparent: true, opacity: 0.25, depthWrite: false }));
  disc.position.y = 0.05;
  const beam = new Mesh(new CylinderGeometry(1.5, 1.7, 4.5, 24, 1, true),
    new MeshBasicMaterial({ color: COLORS.ring, transparent: true, opacity: 0.16, side: DoubleSide, depthWrite: false }));
  beam.position.y = 2.25;
  ring.add(torus, disc, beam);
  ring.userData.parts = { torus, disc, beam };
  return ring;
}

function buildRings() {
  const group = new Group();
  group.name = 'score_rings';
  const rings = INITIAL_RING_SPOTS.map((spotIndex, i) => {
    const spot = RING_SPOTS[spotIndex];
    const visual = createRingVisual(i);
    visual.position.set(spot.x, surfaceHeight(spot.x, spot.z), spot.z);
    group.add(visual);
    return { visual, spotIndex };
  });
  return { group, rings };
}

function buildCars() {
  const group = new Group();
  group.name = 'cars';
  const cars = CAR_ROUTES.map(route => {
    const options = { preset: route.preset, colors: { body: route.color } };
    const visual = buildSimpleVehicleVisual(options);
    visual.group.name = route.id;
    const s = route.phase * route.path.length;
    const p = samplePath(route.path, s);
    visual.group.position.set(p.x, 0, p.z);
    visual.group.rotation.y = p.heading;
    group.add(visual.group);
    return { route, visual, options, s };
  });
  return { group, cars };
}

function buildPedestrians() {
  const group = new Group();
  group.name = 'pedestrians';
  const pedestrians = PEDESTRIAN_ROUTES.map((route, i) => {
    const heights = { child: 1.2, tall: 1.95, stocky: 1.6, heavy: 1.75 };
    const options = {
      preset: route.preset, height: heights[route.preset] ?? 1.72 + (i % 3) * 0.05,
      loadout: { left: null, right: null },
      colors: { top: PED_TOPS[i % PED_TOPS.length] },
    };
    const visual = buildSimpleCharacterVisual(options);
    visual.group.name = route.id;
    const s = route.phase * route.path.length;
    const p = samplePath(route.path, s);
    visual.group.position.set(p.x, surfaceHeight(p.x, p.z), p.z);
    visual.group.rotation.y = p.heading;
    visual.setPose('walk', i * 0.37);
    visual.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
    group.add(visual.group);
    return { route, visual, options, s };
  });
  return { group, pedestrians };
}

// Bake a static group into one mesh per material. The group keeps its name so the scene
// manifest still binds to it; draw calls for buildings/props drop from hundreds to a handful.
function bakeStatic(group) {
  group.updateMatrixWorld(true);
  const buckets = new Map();
  const doomed = [];
  group.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.length !== 1 || mats[0].transparent) return;
    const mat = mats[0];
    let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal'].includes(name)) geo.deleteAttribute(name);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const key = mat.uuid;
    if (!buckets.has(key)) buckets.set(key, { mat, geos: [] });
    buckets.get(key).geos.push(geo);
    doomed.push(o);
  });
  for (const o of doomed) o.parent.remove(o);
  // Emptied helper groups are left in place; they carry no draw cost.
  const inverse = group.matrixWorld.clone().invert();
  for (const { mat, geos } of buckets.values()) {
    const merged = mergeGeometries(geos, false);
    merged.applyMatrix4(inverse);
    const mesh = new Mesh(merged, mat);
    mesh.name = `${group.name}_batch`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

// Swap PBR materials for Lambert across the city. The flat low-poly look barely changes, and
// per-pixel cost drops sharply on software rasterizers where the ground fills the screen.
export function useLambertMaterials(root) {
  const swapped = new Map();
  const swap = mat => {
    if (!mat || !mat.isMeshStandardMaterial) return mat;
    if (!swapped.has(mat.uuid)) {
      swapped.set(mat.uuid, new MeshLambertMaterial({
        color: mat.color,
        flatShading: mat.flatShading, transparent: mat.transparent, opacity: mat.opacity,
        side: mat.side, vertexColors: mat.vertexColors, depthWrite: mat.depthWrite,
      }));
    }
    return swapped.get(mat.uuid);
  };
  root.traverse(o => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
}

export function buildCity(scene) {
  scene.add(buildGround());
  scene.add(buildCrosswalks());
  const sidewalks = buildSidewalks();
  scene.add(sidewalks);
  bakeStatic(sidewalks);
  const buildings = buildBuildings();
  scene.add(buildings);
  bakeStatic(buildings);
  const props = buildStreetProps();
  scene.add(props);
  bakeStatic(props);
  const { group: ringGroup, rings } = buildRings();
  scene.add(ringGroup);
  const { group: carGroup, cars } = buildCars();
  scene.add(carGroup);
  const { group: pedGroup, pedestrians } = buildPedestrians();
  scene.add(pedGroup);

  const player = buildSimpleCharacterVisual(PLAYER_OPTIONS);
  player.group.name = 'player';
  player.group.position.set(PLAYER_SPAWN.x, surfaceHeight(PLAYER_SPAWN.x, PLAYER_SPAWN.z), PLAYER_SPAWN.z);
  player.group.rotation.y = PLAYER_SPAWN.heading;
  player.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  scene.add(player.group);

  useLambertMaterials(scene);
  // Factory output may still carry emissive trims; the control signal keeps none.
  scene.traverse(o => {
    if (!o.isMesh) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m?.emissive) m.emissive.set(0);
  });

  return {
    player, cars, pedestrians, rings, ringGroup,
    lamps: props.userData.lamps, trees: props.userData.trees,
    buildingRecords: buildings.userData.records,
  };
}
