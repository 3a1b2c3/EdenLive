import * as THREE from 'three';
import { buildSimpleCharacterVisual } from '/assets/world/object/factory/CharacterVisualFactory.js';
import { buildSimpleQuadrupedVisual } from '/assets/world/object/factory/QuadrupedVisualFactory.js';
import { buildSimpleFantasyCreatureVisual } from '/assets/world/object/factory/FantasyCreatureVisualFactory.js';
import { buildSimpleTreeVisual } from '/assets/world/object/factory/TreeVisualFactory.js';
import { buildSimpleRockVisual } from '/assets/world/object/factory/RockVisualFactory.js';

const TAU = Math.PI * 2;
const SKY = '#4aa8ff';
const C = {
  meadow: '#4db36a',
  path: '#d4a05a',
  grass: '#7ec84a',
  pebble: '#d47a8a',
  rock: '#9a6ab8',
  rockLight: '#c4a0d4',
  rockDark: '#6a4888',
  stone: '#5ab8c4',
  rune: '#e8d070',
  circle: '#d4b86a',
  oath: '#d45a78',
  ridgeA: '#d4895a',
  ridgeB: '#6a68c4',
  ruin: '#c45a78',
  shrine: '#7a68c4',
  ember: '#e87830',
  sword: '#d0e0ee',
  helm: '#5ec4c8',
  visor: '#1a4a66',
  gold: '#e0c060',
  telegraph: '#e04058',
  impact: '#e06840',
  goatRing: '#e07840',
  lock: '#70d4e0',
  marker: '#e0c060',
};
const TREE_COLORS = {
  dead: { bark: '#b06840', leaf: '#c48858' },
  pine: { bark: '#7a4a30', leaf: '#2e7a48' },
  fir: { bark: '#5a3a28', leaf: '#3a9a68' },
};

function flatten(root) {
  root.traverse(object => {
    if (!object.isMesh) return;
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
      if (!material) continue;
      if ('metalness' in material) material.metalness = 0;
      if ('roughness' in material) material.roughness = 1;
      if (material.emissive) material.emissive.set(0);
    }
  });
}

const lambert = color => new THREE.MeshLambertMaterial({ color });
function mesh(parent, geometry, mat, name, x = 0, y = 0, z = 0) {
  const item = new THREE.Mesh(geometry, mat);
  item.name = name; item.position.set(x, y, z);
  item.castShadow = true; item.receiveShadow = true;
  parent.add(item);
  return item;
}
const flat = (parent, geometry, mat, name, x, y, z) => {
  const m = mesh(parent, geometry, mat, name, x, y, z);
  m.rotation.x = -Math.PI / 2; m.castShadow = false;
  return m;
};
function seeded(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
function ring(parent, name, inner, outer, color, opacity = 1) {
  return flat(
    parent,
    new THREE.RingGeometry(inner, outer, 64),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }),
    name, 0, 0.08, 0,
  );
}

export function createWorld() {
  const scene = new THREE.Scene();
  scene.name = 'Ashen Wilds';
  scene.background = new THREE.Color(SKY);
  scene.add(new THREE.HemisphereLight('#ffffff', '#888888', 2.0));
  const sun = new THREE.DirectionalLight('#ffffff', 1.8);
  sun.position.set(-24, 52, 28);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.12, 380);

  const rand = seeded(28);
  flat(scene, new THREE.PlaneGeometry(450, 420), lambert(C.meadow), 'Open highland meadow', 0, -0.025, -50);

  const positions = [];
  for (let i = 0; i < 34; i++) {
    const z0 = 40 - i * 3.4, z1 = z0 - 3.4;
    const center = z => z < -28 ? Math.min(12, (-z - 28) * 0.37) : Math.sin(z * 0.052) * 0.7;
    const w0 = 2.5 + rand() * 0.8, w1 = 2.5 + rand() * 0.8;
    const verts = [[center(z0) - w0, z0], [center(z0) + w0, z0], [center(z1) - w1, z1], [center(z0) + w0, z0], [center(z1) + w1, z1], [center(z1) - w1, z1]];
    for (const [x, z] of verts) positions.push(x, 0.008, z);
  }
  const pathGeo = new THREE.BufferGeometry();
  pathGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  pathGeo.computeVertexNormals();
  mesh(scene, pathGeo, new THREE.MeshLambertMaterial({ color: C.path, side: THREE.DoubleSide }), 'Worn route toward the standing stones');

  const dressing = new THREE.Group();
  dressing.name = 'Wind-bent trees, rocks, and standing stones';
  scene.add(dressing);
  const obstacles = [];
  const trees = [[-15, 22, 'dead'], [17, 19, 'pine'], [-20, 2, 'fir'], [20, -5, 'dead'], [-16, -24, 'dead'], [26, -29, 'fir'], [-22, -48, 'pine'], [30, -64, 'dead'], [-11, -64, 'dead']];
  for (const [i, [x, z, preset]] of trees.entries()) {
    const tree = buildSimpleTreeVisual({ preset, wind: 0.3, colors: TREE_COLORS[preset] });
    tree.mesh.position.set(x, 0, z);
    tree.mesh.scale.setScalar(1.15 + rand() * 0.55);
    tree.mesh.rotation.y = rand() * TAU;
    tree.mesh.name = `wild-tree-${i}`;
    dressing.add(tree.mesh);
    obstacles.push({ x, z, radius: 0.75 });
  }
  const rocks = [[-9, 19, 'outcrop'], [13, 10, 'boulder'], [-11, -5, 'flatRock'], [14, -17, 'stackedRocks'], [-8, -29, 'boulder'], [-12, -48, 'outcrop'], [24, -45, 'flatRock'], [-3, -62, 'boulder']];
  for (const [i, [x, z, preset]] of rocks.entries()) {
    const rock = buildSimpleRockVisual({
      preset,
      colors: { body: C.rock, light: C.rockLight, dark: C.rockDark, accent: C.gold, crystal: C.lock, impact: C.impact },
    });
    rock.mesh.position.set(x, 0, z);
    rock.mesh.rotation.y = rand() * TAU;
    rock.mesh.name = `wild-rock-${i}`;
    dressing.add(rock.mesh);
    obstacles.push({ x, z, radius: 1.35 });
  }

  const arena = new THREE.Group();
  arena.name = 'Boss arena and attack telegraph';
  scene.add(arena);
  mesh(arena, new THREE.CylinderGeometry(12.5, 12.5, 0.06, 48), lambert(C.circle), 'Stone circle floor', 12, 0, -58);
  const boundary = ring(arena, 'Ancient oath circle', 9.1, 9.2, C.oath, 0.85);
  boundary.position.set(12, 0.06, -58);
  for (let i = 0; i < 10; i++) {
    const angle = i * TAU / 10, x = 12 + Math.cos(angle) * 11.4, z = -58 + Math.sin(angle) * 11.4;
    if (i === 2 || i === 3) continue;
    const h = 3.0 + rand() * 2.0;
    const monolith = mesh(dressing, new THREE.BoxGeometry(1.2, h, 1.5), lambert(C.stone), `standing-stone-${i}`, x, h / 2, z);
    monolith.rotation.set(0.07, angle, 0.06);
    obstacles.push({ x, z, radius: 0.9 });
    const rune = mesh(monolith, new THREE.BoxGeometry(0.08, h * 0.35, 0.02), new THREE.MeshBasicMaterial({ color: C.rune }), `rune-${i}`, 0, 0, 0.76);
    rune.castShadow = false;
  }
  for (let i = 0; i < 13; i++) {
    const mountain = mesh(
      dressing,
      new THREE.ConeGeometry(22 + rand() * 16, 24 + rand() * 24, 5),
      lambert(i % 2 ? C.ridgeA : C.ridgeB),
      `far-ridge-${i}`,
      -145 + i * 24, 8, -120 - rand() * 30,
    );
    mountain.rotation.y = rand() * TAU;
    mountain.castShadow = false;
  }
  for (const x of [1, 23]) {
    mesh(dressing, new THREE.BoxGeometry(4, 16, 4), lambert(C.ruin), 'ruined watchtower', x, 8, -85);
    for (let k = 0; k < 3; k++) mesh(dressing, new THREE.BoxGeometry(0.7, 1.4, 4.2), lambert(C.ruin), 'tower battlement', x - 1.6 + k * 1.6, 16.6, -85);
  }
  mesh(dressing, new THREE.BoxGeometry(19, 3, 3.5), lambert(C.ruin), 'broken stone gate', 12, 11, -85);

  const grassGeo = new THREE.BufferGeometry();
  grassGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.15, 0, 0, 0.04, 0.6, 0, 0.15, 0, 0, 0, 0, -0.15, 0, 0.47, 0.02, 0, 0, 0.15], 3));
  grassGeo.computeVertexNormals();
  const grass = new THREE.InstancedMesh(grassGeo, new THREE.MeshLambertMaterial({ color: C.grass, side: THREE.DoubleSide }), 1800);
  grass.name = 'Wild grass';
  const dummy = new THREE.Object3D();
  let n = 0, attempts = 0;
  while (n < 1800 && attempts < 20000) {
    attempts++;
    const x = -45 + rand() * 95, z = 34 - rand() * 126;
    const pathCenter = z < -28 ? Math.min(12, (-z - 28) * 0.37) : Math.sin(z * 0.052) * 0.7;
    if (Math.abs(x - pathCenter) < 3.1 || Math.hypot(x - 12, z + 58) < 12.7) continue;
    dummy.position.set(x, 0, z);
    dummy.rotation.y = rand() * TAU;
    dummy.scale.setScalar(0.45 + rand() * 0.95);
    dummy.updateMatrix();
    grass.setMatrixAt(n, dummy.matrix);
    grass.setColorAt(n, new THREE.Color().setHSL(0.28 + rand() * 0.05, 0.48, 0.46 + rand() * 0.08));
    n++;
  }
  grass.count = n;
  grass.instanceMatrix.needsUpdate = true;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  grass.receiveShadow = false;
  scene.add(grass);
  const pebbles = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.45, 0), lambert(C.pebble), 120);
  pebbles.name = 'Scattered trail fragments';
  for (let i = 0; i < 120; i++) {
    dummy.position.set(-17 + rand() * 45, 0.07, 30 - rand() * 109);
    dummy.rotation.set(0, rand() * TAU, 0);
    dummy.scale.set(0.3 + rand(), 0.12, 0.25 + rand());
    dummy.updateMatrix();
    pebbles.setMatrixAt(i, dummy.matrix);
  }
  pebbles.instanceMatrix.needsUpdate = true;
  scene.add(pebbles);

  const shrine = new THREE.Group();
  shrine.position.set(-4.8, 0, 14);
  dressing.add(shrine);
  mesh(shrine, new THREE.CylinderGeometry(0.65, 0.85, 0.45, 8), lambert(C.shrine), 'Wayside altar', 0, 0.2, 0);
  mesh(shrine, new THREE.ConeGeometry(0.32, 0.6, 6), new THREE.MeshBasicMaterial({ color: C.ember }), 'Last ember', 0, 0.7, 0);
  mesh(shrine, new THREE.BoxGeometry(0.13, 1.6, 0.1), lambert(C.sword), 'Sword at the wayside', 0, 1, 0);

  const playerVisual = buildSimpleCharacterVisual({
    preset: 'warrior', height: 2.35, build: 1.14, headShape: 'box', holdPose: 'ready',
    colors: { skin: '#edbb9f', top: '#5ec4c8', pants: '#3a6a78', accent: C.gold },
  });
  playerVisual.mesh.name = 'Ash knight player';
  scene.add(playerVisual.mesh);
  mesh(playerVisual.attachments.head, new THREE.BoxGeometry(0.5, 0.49, 0.5), lambert(C.helm), 'Knight helm');
  mesh(playerVisual.attachments.head, new THREE.BoxGeometry(0.4, 0.05, 0.016), lambert(C.visor), 'Visor slit', 0, 0.035, -0.26);
  for (const [i, arm] of playerVisual.rig.arms.entries()) {
    mesh(arm.shoulder, new THREE.BoxGeometry(0.4, 0.22, 0.48), lambert(C.helm), `pauldron-${i}`, 0, 0.015, 0);
  }
  mesh(playerVisual.rig.chest, new THREE.BoxGeometry(0.8, 0.16, 0.54), lambert(C.gold), 'Knight belt', 0, 0.15, 0);

  const goatVisual = buildSimpleQuadrupedVisual({
    preset: 'goat',
    colors: { body: '#efe4c4', accent: '#c47848', hoof: '#4a3020' },
  });
  goatVisual.mesh.name = 'Near field simple goat';
  scene.add(goatVisual.mesh);

  const bossVisual = buildSimpleFantasyCreatureVisual({
    preset: 'skeletonGuard', heightScale: 2.18, bodyWidth: 1.34, armor: 'plate', cloak: true, cloakLength: 0.82,
    colors: { bone: '#ead8a8', body: '#a04870', armor: '#6a48b8', clothing: '#c06098', accent: C.gold, eye: '#e05050', belly: '#d4b868' },
  });
  bossVisual.mesh.name = 'Distant rune Stone Warden boss';
  scene.add(bossVisual.mesh);
  if (bossVisual.attachments.rightHand) {
    mesh(bossVisual.attachments.rightHand, new THREE.BoxGeometry(0.07, 1.4, 0.09), lambert(C.gold), 'Warden glaive shaft', 0, -0.15, 0);
    mesh(bossVisual.attachments.rightHand, new THREE.BoxGeometry(0.45, 0.8, 0.15), lambert(C.helm), 'Warden stone blade', 0, 0.9, 0);
  }
  for (const v of [playerVisual, goatVisual, bossVisual]) {
    v.mesh.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  }

  const telegraph = ring(scene, 'Boss attack warning ring', 5.05, 5.2, C.telegraph, 0.85);
  const core = flat(scene, new THREE.CircleGeometry(5.2, 64), new THREE.MeshBasicMaterial({
    color: C.impact, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide,
  }), 'Boss impact area', 12, 0.08, -58);
  const goatRing = ring(scene, 'Goat charge warning', 1.05, 1.2, C.goatRing, 0.85);
  telegraph.visible = false; core.visible = false; goatRing.visible = false;
  const lock = mesh(scene, new THREE.RingGeometry(0.105, 0.15, 12), new THREE.MeshBasicMaterial({
    color: C.lock, side: THREE.DoubleSide, depthTest: false,
  }), 'Lock-on reticle');
  const marker = mesh(scene, new THREE.RingGeometry(0.23, 0.35, 4), new THREE.MeshBasicMaterial({
    color: C.marker, side: THREE.DoubleSide,
  }), 'boss distance marker');
  for (const fx of [goatRing, lock]) {
    fx.visible = false; fx.castShadow = false; fx.receiveShadow = false;
  }

  flatten(scene);
  // Head ~2.12 at screen centre, feet near the bottom edge (FOV 55, dist 3.6).
  camera.position.set(0, 2.80, 16.6);
  camera.lookAt(0, 2.12, 13);
  return {
    scene, camera, playerVisual, goatVisual, bossVisual, marker,
    arenaParts: { arena, telegraph, core, inner: boundary },
    effects: { goatRing, lock },
    obstacles,
  };
}
