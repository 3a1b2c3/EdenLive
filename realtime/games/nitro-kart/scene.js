import {
  AmbientLight, BoxGeometry, Color, CylinderGeometry, DirectionalLight, Fog, Group, HemisphereLight,
  InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Quaternion,
  Scene, SphereGeometry, Vector3, CanvasTexture, SRGBColorSpace,
} from 'three';
import { buildSimpleBuildingVisual } from '/assets/world/object/factory/BuildingVisualFactory.js';
import { buildSimpleTreeVisual } from '/assets/world/object/factory/TreeVisualFactory.js';
import { BARRIER_OFFSET, TRACK_HALF_WIDTH, buildTrackData, sampleAtDistance, trackSurfaceGeometries } from './track.js';
import { createKart } from './kart.js';

export const KART_COLORS = Object.freeze([
  { id: 'player', name: 'player_kart', body: 0xe63946, accent: 0xffd166, helmet: 0xffffff },
  { id: 'rival_blue', name: 'rival_blue', body: 0x3a86ff, accent: 0xf1faee, helmet: 0xffbe0b },
  { id: 'rival_green', name: 'rival_green', body: 0x2dc653, accent: 0x1b263b, helmet: 0xf1faee },
  { id: 'rival_yellow', name: 'rival_yellow', body: 0xffc300, accent: 0x7209b7, helmet: 0x4cc9f0 },
]);

function std(color, extra = {}) {
  return new MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, flatShading: true, ...extra });
}

function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const g = c.getContext('2d');
  for (let x = 0; x < 16; x += 1) for (let y = 0; y < 4; y += 1) {
    g.fillStyle = (x + y) % 2 ? '#111' : '#fff';
    g.fillRect(x * 8, y * 8, 8, 8);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function bannerTexture(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, '#ff3d7f'); grad.addColorStop(1, '#7b2ff7');
  g.fillStyle = grad; g.fillRect(0, 0, 512, 96);
  g.fillStyle = '#fff'; g.font = 'bold 60px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 52);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function buildBarriers(track) {
  // One box per centerline sample on each side; collision is the lateral clamp in the game.
  const group = new Group();
  group.name = 'track_barrier';
  const n = track.samples.length;
  const geo = new BoxGeometry(1, 1, 1);
  const colors = [new Color(0xf4f6fb), new Color(0x3a86ff)];
  for (const side of [1, -1]) {
    const mesh = new InstancedMesh(geo, std(0xffffff), n);
    const m = new Matrix4(); const q = new Quaternion(); const up = new Vector3(0, 1, 0);
    for (let i = 0; i < n; i += 1) {
      const a = track.samples[i];
      const b = track.samples[(i + 1) % n];
      const ax = a.x + a.nx * BARRIER_OFFSET * side; const az = a.z + a.nz * BARRIER_OFFSET * side;
      const bx = b.x + b.nx * BARRIER_OFFSET * side; const bz = b.z + b.nz * BARRIER_OFFSET * side;
      const len = Math.hypot(bx - ax, bz - az) + 0.05;
      q.setFromAxisAngle(up, Math.atan2(bx - ax, bz - az));
      m.compose(new Vector3((ax + bx) / 2, 0.45, (az + bz) / 2), q, new Vector3(0.45, 0.9, len));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, colors[Math.floor(i / 2) % 2]);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

function buildStartGate(track) {
  const s = sampleAtDistance(track.samples, track.length, 0);
  const gate = new Group();
  gate.name = 'start_finish_line';
  gate.position.set(s.x, 0, s.z);
  gate.rotation.y = Math.atan2(-s.tx, -s.tz);
  const line = new Mesh(new PlaneGeometry(TRACK_HALF_WIDTH * 2, 1.4), new MeshStandardMaterial({ map: checkerTexture(), roughness: 0.8 }));
  line.rotation.x = -Math.PI / 2;
  line.position.y = 0.05;
  gate.add(line);
  const postMat = std(0xffffff);
  for (const x of [-(TRACK_HALF_WIDTH + 1.1), TRACK_HALF_WIDTH + 1.1]) {
    const post = new Mesh(new CylinderGeometry(0.35, 0.4, 6.4, 12), postMat);
    post.position.set(x, 3.2, 0);
    post.castShadow = true;
    gate.add(post);
  }
  const banner = new Mesh(new BoxGeometry(TRACK_HALF_WIDTH * 2 + 3, 1.6, 0.4), [
    std(0x7b2ff7), std(0x7b2ff7), std(0x7b2ff7), std(0x7b2ff7),
    new MeshStandardMaterial({ map: bannerTexture('NITRO KART RUSH') }),
    new MeshStandardMaterial({ map: bannerTexture('FINISH') }),
  ]);
  banner.position.y = 6.6;
  banner.castShadow = true;
  gate.add(banner);
  return gate;
}

function buildNitroBoxes(track) {
  const group = new Group();
  group.name = 'nitro_box';
  const boxes = track.nitroStations.map((p, i) => {
    const box = new Group();
    box.name = `nitro_box_${i}`;
    box.position.set(p.x, 1.1, p.z);
    const core = new Mesh(new BoxGeometry(1.1, 1.1, 1.1), new MeshStandardMaterial({
      color: 0x4cc9f0, emissive: 0x1e90ff, emissiveIntensity: 0.9, transparent: true, opacity: 0.88, roughness: 0.3,
    }));
    core.rotation.set(0.4, 0.6, 0.2);
    box.add(core);
    const mark = new Mesh(new BoxGeometry(0.3, 0.75, 0.3), new MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6 }));
    mark.rotation.copy(core.rotation);
    box.add(mark);
    group.add(box);
    return box;
  });
  return { group, boxes };
}

function buildDressing(track) {
  const group = new Group();
  group.name = 'dressing';
  // Grandstands beside the main straight (outside the track's left/right shoulders).
  const standMat = [std(0x8d99ae), std(0xef476f), std(0x06d6a0), std(0xffd166)];
  const s0 = sampleAtDistance(track.samples, track.length, 6);
  const stand = new Group();
  stand.name = 'grandstand';
  for (let tier = 0; tier < 4; tier += 1) {
    const step = new Mesh(new BoxGeometry(22, 0.9, 2), standMat[tier]);
    step.position.set(0, 0.45 + tier * 0.9, tier * 1.6);
    step.castShadow = true; step.receiveShadow = true;
    stand.add(step);
  }
  const roof = new Mesh(new BoxGeometry(23, 0.3, 7.5), std(0xffffff));
  roof.position.set(0, 6, 2.6);
  stand.add(roof);
  stand.position.set(s0.x - s0.nx * (BARRIER_OFFSET + 3), 0, s0.z - s0.nz * (BARRIER_OFFSET + 3));
  stand.rotation.y = Math.atan2(-s0.nx, -s0.nz);
  group.add(stand);

  // Colorful city blocks ringing the circuit.
  const presets = ['office', 'apartment', 'skyscraper', 'hotel', 'shop', 'tower'];
  const palette = ['#ffadad', '#ffd6a5', '#caffbf', '#9bf6ff', '#bdb2ff', '#ffc6ff'];
  const spots = [[60, 10], [62, 40], [48, 72], [16, 80], [-20, 76], [-52, 60], [-66, 30], [-62, -6], [-30, -22], [8, -26], [40, -18], [0, 28]];
  spots.forEach(([x, z], i) => {
    const b = buildSimpleBuildingVisual({ preset: presets[i % presets.length], colors: { wall: palette[i % palette.length], roof: '#3d5a80' } });
    if (i === spots.length - 1) {
      b.group.scale.setScalar(0.7);
    }
    b.group.position.set(x, 0, z);
    b.group.rotation.y = (i * 0.7) % Math.PI;
    group.add(b.group);
  });

  // Palm trees along the outside of the track.
  const palm = { preset: 'palm', height: 7.5 };
  for (let i = 0; i < 14; i += 1) {
    const s = sampleAtDistance(track.samples, track.length, (i + 0.5) * track.length / 14);
    const side = i % 2 === 0 ? 1 : -1;
    const off = BARRIER_OFFSET + 3.5;
    const t = buildSimpleTreeVisual(palm);
    t.group.position.set(s.x + s.nx * off * side, 0, s.z + s.nz * off * side);
    group.add(t.group);
  }

  // Balloons floating over the infield.
  const balloonColors = [0xff006e, 0xffbe0b, 0x3a86ff, 0x8338ec, 0x06d6a0];
  [[2, 12, 30], [-10, 16, 22], [14, 14, 38], [-4, 18, 44], [20, 17, 18]].forEach(([x, y, z], i) => {
    const b = new Mesh(new SphereGeometry(1.4, 16, 12), std(balloonColors[i], { flatShading: false, roughness: 0.35 }));
    b.scale.y = 1.2;
    b.position.set(x, y, z);
    group.add(b);
    const string = new Mesh(new CylinderGeometry(0.03, 0.03, 4, 4), std(0xffffff));
    string.position.set(x, y - 3.5, z);
    group.add(string);
  });
  return group;
}

export function buildScene() {
  const scene = new Scene();
  scene.background = new Color(0x8fd3ff);
  scene.fog = new Fog(0x8fd3ff, 90, 220);
  const track = buildTrackData();

  const backdrop = new Group();
  backdrop.name = 'backdrop';
  const ground = new Mesh(new PlaneGeometry(400, 400), std(0x7bd389, { flatShading: false }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  backdrop.add(ground);
  const sun = new Mesh(new SphereGeometry(8, 20, 14), new MeshStandardMaterial({ color: 0xfff3b0, emissive: 0xffe066, emissiveIntensity: 1 }));
  sun.position.set(-120, 90, -160);
  backdrop.add(sun);
  scene.add(backdrop);

  scene.add(new HemisphereLight(0xdff3ff, 0x5c8a4a, 0.85));
  scene.add(new AmbientLight(0xffffff, 0.25));
  const key = new DirectionalLight(0xfff4e0, 1.25);
  key.position.set(-40, 70, -30);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, far: 220 });
  key.target.position.set(0, 0, 28);
  scene.add(key, key.target);

  const trackGroup = new Group();
  trackGroup.name = 'track';
  const surf = trackSurfaceGeometries(track);
  const vc = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  for (const geo of Object.values(surf)) {
    const m = new Mesh(geo, vc);
    m.receiveShadow = true;
    trackGroup.add(m);
  }
  scene.add(trackGroup);
  scene.add(buildBarriers(track));
  scene.add(buildStartGate(track));
  const nitro = buildNitroBoxes(track);
  scene.add(nitro.group);
  scene.add(buildDressing(track));

  // The player starts on the back row so the chase camera frames the rival field ahead.
  const GRID_ORDER = [2, 0, 1, 3];
  const karts = KART_COLORS.map((cfg, i) => {
    const kart = createKart(cfg);
    const slot = track.grid[GRID_ORDER[i]];
    kart.root.position.set(slot.x, 0, slot.z);
    kart.root.rotation.y = slot.yaw;
    return { ...kart, id: cfg.id, slot };
  });
  const player = karts[0];
  player.root.name = 'player';
  scene.add(player.root);
  const rivals = new Group();
  rivals.name = 'rival_kart';
  for (const k of karts.slice(1)) rivals.add(k.root);
  scene.add(rivals);

  const camera = new PerspectiveCamera(62, 16 / 9, 0.1, 500);
  return { scene, camera, track, karts, nitroBoxes: nitro.boxes };
}

/** Static chase framing behind the player's grid slot. */
export function placeChaseCamera(camera, kart) {
  const yaw = kart.root.rotation.y;
  const fx = -Math.sin(yaw); const fz = -Math.cos(yaw);
  const p = kart.root.position;
  camera.position.set(p.x - fx * 7.5, 3.6, p.z - fz * 7.5);
  camera.lookAt(p.x + fx * 6, 1.2, p.z + fz * 6);
}
