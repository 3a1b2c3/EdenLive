// Static downtown composition. Visuals only: the game rules own movement, collision and outcomes.
import {
  BoxGeometry, CanvasTexture, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, NearestFilter, PlaneGeometry, SphereGeometry, SRGBColorSpace,
} from 'three';
import { applyAtmosphere } from '/assets/world/environment/SceneAtmosphere.js';
import { createGroundLine, createMarkerBox } from '/assets/world/object/factory/GreyboxKitFactory.js';
import { buildSimpleBuildingVisual, randomSimpleBuildingOptions } from '/assets/world/object/factory/BuildingVisualFactory.js';
import { createVehicleVisual } from '/assets/world/object/factory/VehicleVisualFactory.js';
import {
  ROAD, START, FINISH_Z, CHECKPOINT_ZS, CHECKPOINT_WIDTH, CROSS_STREET_ZS, CROSS_STREET_DEPTH,
  ROADBLOCKS, TRAFFIC, PARKED, STREETLIGHT_SPACING, buildingSlots,
} from './layout.mjs';

const ASPHALT = 0x4a4d55;
const GATE_CYAN = 0x25c7dd;

function named(object, name) {
  object.name = name;
  return object;
}

function flat(width, depth, color, { x = 0, y = 0, z = 0, name } = {}) {
  const mesh = new Mesh(new PlaneGeometry(width, depth), new MeshStandardMaterial({ color, roughness: 1 }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  if (name) mesh.name = name;
  return mesh;
}

function box(width, height, depth, color, { x = 0, y = 0, z = 0, emissive = false } = {}) {
  const mesh = createMarkerBox({ width, height, depth, color, emissive, emissiveIntensity: 0.9 });
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.position.set(x, y + height / 2, z);
  return mesh;
}

function checkerTexture(columns, rows) {
  const cell = 32;
  const canvas = document.createElement('canvas');
  canvas.width = columns * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext('2d');
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#f4f4f0' : '#16181c';
      ctx.fillRect(c * cell, r * cell, cell, cell);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  return texture;
}

function buildRoad() {
  const road = named(new Group(), 'road');
  const length = ROAD.startZ - ROAD.endZ;
  const centerZ = (ROAD.startZ + ROAD.endZ) / 2;
  road.add(flat(520, 1100, 0x8b8880, { y: 0, z: -360, name: 'road_plaza' }));
  road.add(flat(ROAD.halfWidth * 2, length, ASPHALT, { y: 0.03, z: centerZ, name: 'road_asphalt' }));
  for (const side of [-1, 1]) {
    road.add(flat(ROAD.bayWidth, length, 0x5a5d65, {
      x: side * (ROAD.halfWidth + ROAD.bayWidth / 2), y: 0.03, z: centerZ,
    }));
    road.add(flat(ROAD.sidewalkWidth, length, 0xb8b4aa, {
      x: side * (ROAD.halfWidth + ROAD.bayWidth + ROAD.sidewalkWidth / 2), y: 0.06, z: centerZ,
    }));
  }
  for (const z of CROSS_STREET_ZS) {
    road.add(flat(150, CROSS_STREET_DEPTH, ASPHALT, { y: 0.07, z, name: `cross_street_${z}` }));
  }

  // Edge lines and the double yellow center line.
  const edge = (right, color, width) => createGroundLine({
    from: { right, forward: -ROAD.startZ }, to: { right, forward: -ROAD.endZ }, width, color, opacity: 1, up: 0.12,
  });
  road.add(edge(-ROAD.halfWidth + 0.35, 0xf2f2ea, 0.18), edge(ROAD.halfWidth - 0.35, 0xf2f2ea, 0.18));
  road.add(edge(-0.12, 0xf0c020, 0.1), edge(0.12, 0xf0c020, 0.1));

  // Dashed lane dividers and zebra crosswalks as two instanced meshes.
  const dashMaterial = new MeshBasicMaterial({ color: 0xf2f2ea });
  const dashZs = [];
  for (let z = ROAD.startZ - 2; z > ROAD.endZ; z -= 8) {
    if (CROSS_STREET_ZS.some(cz => Math.abs(z - cz) < CROSS_STREET_DEPTH / 2 + 5)) continue;
    dashZs.push(z);
  }
  const dashes = new InstancedMesh(new BoxGeometry(0.14, 0.01, 3.6), dashMaterial, dashZs.length * 2);
  const matrix = new Matrix4();
  let index = 0;
  for (const x of [-3.6, 3.6]) {
    for (const z of dashZs) dashes.setMatrixAt(index++, matrix.makeTranslation(x, 0.12, z));
  }
  dashes.name = 'lane_dashes';
  road.add(dashes);

  const zebraXs = [];
  for (let x = -6.2; x <= 6.2; x += 1.2) zebraXs.push(x);
  const zebra = new InstancedMesh(new BoxGeometry(0.6, 0.01, 3.2), dashMaterial, CROSS_STREET_ZS.length * 2 * zebraXs.length);
  index = 0;
  for (const cz of CROSS_STREET_ZS) {
    for (const dz of [CROSS_STREET_DEPTH / 2 + 3, -CROSS_STREET_DEPTH / 2 - 3]) {
      for (const x of zebraXs) zebra.setMatrixAt(index++, matrix.makeTranslation(x, 0.12, cz + dz));
    }
  }
  zebra.name = 'crosswalks';
  road.add(zebra);
  return road;
}

function buildBuildings() {
  const group = named(new Group(), 'buildings');
  const boxes = [];
  for (const slot of buildingSlots()) {
    const options = randomSimpleBuildingOptions(slot.seed, {
      preset: slot.preset,
      massing: slot.massing,
      floors: slot.floors,
      width: slot.width,
      depth: slot.depth,
      colors: { wall: slot.wall, roof: '#4e5961' },
    });
    const building = buildSimpleBuildingVisual(options);
    const size = building.dimensions;
    const center = building.bounds.getCenter(building.bounds.min.clone());
    const centerX = slot.side * (ROAD.buildingSetback + size.x / 2);
    building.group.position.set(centerX - center.x, 0, slot.z - center.z);
    group.add(building.group);
    boxes.push({
      minX: centerX - size.x / 2, maxX: centerX + size.x / 2,
      minZ: slot.z - size.z / 2, maxZ: slot.z + size.z / 2, height: size.y,
    });
  }
  return { group, boxes };
}

function buildSkyline() {
  const group = named(new Group(), 'backdrop');
  const palette = ['#8e9bab', '#a79d8f', '#7f8a97', '#b5a58c'];
  for (let i = 0; i < 16; i += 1) {
    const options = randomSimpleBuildingOptions(900 + i, {
      preset: i % 3 === 0 ? 'skyscraper' : 'tower',
      massing: 'block',
      floors: 18 + (i * 7) % 14,
      width: 14 + (i % 4) * 2,
      depth: 14 + (i % 3) * 2,
      colors: { wall: palette[i % palette.length], roof: '#59636d' },
    });
    const tower = buildSimpleBuildingVisual(options);
    const column = i % 8;
    const row = Math.floor(i / 8);
    tower.group.position.set(-84 + column * 24, 0, -790 - row * 40);
    group.add(tower.group);
  }
  return group;
}

function gateFrame(color, { postHeight = 6.2, span = CHECKPOINT_WIDTH, z = 0 } = {}) {
  const frame = new Group();
  const half = span / 2;
  frame.add(box(0.6, postHeight, 0.6, color, { x: -half, z }), box(0.6, postHeight, 0.6, color, { x: half, z }));
  frame.add(box(span + 0.6, 0.8, 0.8, color, { y: postHeight, z, emissive: true }));
  return frame;
}

function buildCheckpoints() {
  const group = named(new Group(), 'checkpoint');
  const gates = [];
  CHECKPOINT_ZS.forEach((z, i) => {
    const gate = named(gateFrame(GATE_CYAN), `checkpoint_${i + 1}`);
    gate.position.z = z;
    gate.add(createGroundLine({
      from: { right: -ROAD.halfWidth, forward: 0 }, to: { right: ROAD.halfWidth, forward: 0 },
      width: 0.8, color: GATE_CYAN, opacity: 0.9, up: 0.13,
    }));
    group.add(gate);
    gates.push(gate);
  });
  return { group, gates };
}

// Recolor a gate between the pending and passed looks; materials are per-mesh, so no sharing.
export function setGateColor(gate, color) {
  gate.traverse(node => {
    if (!node.material) return;
    node.material.color.set(color);
    if (node.material.emissive) node.material.emissive.set(color).multiplyScalar(0.9);
  });
}

function buildFinish() {
  const group = named(new Group(), 'finish_line');
  group.position.z = FINISH_Z;
  group.add(gateFrame(0xf4f4f0, { postHeight: 7.4, span: CHECKPOINT_WIDTH }));
  const banner = new Mesh(
    new PlaneGeometry(CHECKPOINT_WIDTH, 1.8),
    new MeshBasicMaterial({ map: checkerTexture(32, 4) }),
  );
  banner.position.set(0, 6.2, 0.45);
  group.add(banner);
  const strip = new Mesh(
    new PlaneGeometry(ROAD.halfWidth * 2, 2.4),
    new MeshBasicMaterial({ map: checkerTexture(18, 3) }),
  );
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(0, 0.13, 0);
  group.add(strip);
  return group;
}

function buildRoadblocks() {
  const group = named(new Group(), 'roadblock');
  for (const block of ROADBLOCKS) {
    const barrier = named(new Group(), `roadblock_${block.id}`);
    barrier.position.set(block.x, 0, block.z);
    barrier.add(
      box(0.25, 0.9, 0.5, 0x3a3a40, { x: -block.width / 2 + 0.35 }),
      box(0.25, 0.9, 0.5, 0x3a3a40, { x: block.width / 2 - 0.35 }),
      box(block.width, 0.4, block.depth, 0xf26a1b, { y: 0.45 }),
      box(block.width, 0.28, block.depth * 1.02, 0xf5f5ee, { y: 0.78 }),
    );
    group.add(barrier);
  }
  return group;
}

function buildTraffic() {
  const group = named(new Group(), 'traffic_car');
  const cars = [];
  for (const car of TRAFFIC) {
    const vehicle = createVehicleVisual({ preset: car.preset, colors: { body: car.color } });
    vehicle.group.name = `traffic_${car.id}`;
    vehicle.group.position.set(car.x, 0, car.z);
    group.add(vehicle.group);
    cars.push({
      id: car.id, group: vehicle.group, x: car.x, startZ: car.z, speed: car.speed,
      halfX: vehicle.dimensions.x / 2, halfZ: vehicle.dimensions.z / 2,
    });
  }
  return { group, cars };
}

function streetlight(side) {
  const light = new Group();
  light.add(box(0.28, 8, 0.28, 0x3b4048));
  light.add(box(2.6, 0.22, 0.22, 0x3b4048, { x: -side * 1.3, y: 7.8 }));
  light.add(box(0.9, 0.2, 0.5, 0xffe3a0, { x: -side * 2.4, y: 7.6, emissive: true }));
  return light;
}

function signal() {
  const group = new Group();
  group.add(box(0.25, 5, 0.25, 0x30343a));
  group.add(box(0.8, 2.2, 0.6, 0x1c1e22, { y: 4.3 }));
  const lamps = [[0xd23b2e, 6.1], [0xe0b030, 5.4], [0x2fb061, 4.7]];
  for (const [color, y] of lamps) {
    const lamp = new Mesh(new SphereGeometry(0.2, 12, 8), new MeshBasicMaterial({ color }));
    lamp.position.set(0, y, 0.32);
    group.add(lamp);
  }
  return group;
}

function buildStreetProps() {
  const group = named(new Group(), 'street_props');
  const parkedBoxes = [];
  const lightX = ROAD.halfWidth + ROAD.bayWidth + 0.6;
  for (const side of [-1, 1]) {
    for (let z = 4; z > ROAD.endZ; z -= STREETLIGHT_SPACING) {
      if (CROSS_STREET_ZS.some(cz => Math.abs(z - cz) < CROSS_STREET_DEPTH / 2 + 3)) continue;
      const light = streetlight(side);
      light.position.set(side * lightX, 0, z);
      group.add(light);
    }
  }
  for (const cz of CROSS_STREET_ZS) {
    for (const side of [-1, 1]) {
      const pole = signal();
      pole.position.set(side * (ROAD.halfWidth + ROAD.bayWidth + 0.2), 0, cz + CROSS_STREET_DEPTH / 2 + 5);
      group.add(pole);
    }
  }
  for (const parked of PARKED) {
    const vehicle = createVehicleVisual({ preset: parked.preset, colors: { body: parked.color } });
    vehicle.group.name = `parked_${parked.id}`;
    const parkedX = parked.side * (ROAD.halfWidth + ROAD.bayWidth / 2);
    vehicle.group.position.set(parkedX, 0, parked.z);
    group.add(vehicle.group);
    parkedBoxes.push({
      id: parked.id, minX: parkedX - vehicle.dimensions.x / 2, maxX: parkedX + vehicle.dimensions.x / 2,
      minZ: parked.z - vehicle.dimensions.z / 2, maxZ: parked.z + vehicle.dimensions.z / 2,
    });
  }
  return { group, parkedBoxes };
}

export function buildCityScene(scene, camera) {
  applyAtmosphere(scene, {
    skyColor: 0xf2b777,
    fogColor: 0xeab98a,
    fogNear: 90,
    fogFar: 420,
    ambientColor: 0xfff0dc,
    ambientIntensity: 1.1,
    keyColor: 0xffe2b8,
    keyIntensity: 1.0,
    keyElevationDeg: 32,
    keyAzimuthDeg: 150,
    shadows: false,
  });

  const road = buildRoad();
  const { group: buildings, boxes: buildingBoxes } = buildBuildings();
  const player = createVehicleVisual({ preset: 'taxi', colors: { body: '#ffe01a' } });
  player.group.name = 'player';
  // Roof sign: the factory draws no signs, so the cab gets one lit box on its cabin.
  player.group.add(box(0.9, 0.28, 0.4, 0xfff6c8, { y: player.dimensions.y, emissive: true }));
  player.group.position.set(START.x, 0, START.z);

  const props = buildStreetProps();
  const checkpoints = buildCheckpoints();
  const traffic = buildTraffic();
  scene.add(
    road, buildings, buildSkyline(), props.group, checkpoints.group,
    buildFinish(), buildRoadblocks(), traffic.group, player.group,
  );

  // Starting chase framing; the game's follow rig drives the camera every frame afterwards.
  camera.name = 'chase_camera';
  camera.position.set(START.x, 3.6, START.z + 8.5);
  camera.lookAt(START.x, 1.4, START.z - 14);
  scene.add(camera);

  return {
    player, buildingBoxes, parkedBoxes: props.parkedBoxes, traffic: traffic.cars, gates: checkpoints.gates,
  };
}
