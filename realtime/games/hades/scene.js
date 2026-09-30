import * as THREE from 'three';
import { mergeGeometries } from '/assets/math/BufferGeometryUtils.js';
import { buildSimpleCharacterVisual } from '/assets/world/object/factory/CharacterVisualFactory.js';
import { buildSimpleFantasyCreatureVisual } from '/assets/world/object/factory/FantasyCreatureVisualFactory.js';

const TAU = Math.PI * 2;
const SKY = '#4aa8ff';

export const actorOptions = {
  hero: {
    preset: 'warrior',
    colors: { skin: '#e8d0b0', top: '#c94d62', pants: '#4a68b8', accent: '#d4b45a' },
    loadout: {
      right: { preset: 'shortSword', colors: { body: '#d4b45a', metal: '#d4b45a', accent: '#d4b45a', grip: '#8a5a38' } },
      left: { preset: 'roundShield', colors: { body: '#d4b45a', metal: '#d4b45a', accent: '#c94d62', grip: '#8a5a38' } },
    },
  },
  wardenViolet: {
    preset: 'skeletonGuard',
    colors: { body: '#e4d4b8', armor: '#5a8ec8', clothing: '#7a68c0', eye: '#e8b888' },
  },
  wardenRust: {
    preset: 'skeletonGuard',
    colors: { body: '#e4d4b8', armor: '#5a8ec8', clothing: '#c87050', eye: '#e8b888' },
  },
  boss: {
    preset: 'earthElemental',
    colors: { body: '#c08048', belly: '#d4a868', accent: '#d4b45a', core: '#d88860', eye: '#e8c080' },
  },
};

const lambert = color => new THREE.MeshLambertMaterial({ color });
const basic = (color, opacity = 1) => new THREE.MeshBasicMaterial({
  color, transparent: opacity < 1, opacity, depthWrite: opacity === 1, side: THREE.DoubleSide,
});
const rangeMat = (color, opacity) => {
  const material = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
  });
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -2;
  return material;
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

export function createWorld() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 140);
  camera.position.set(0, 14.2, 24.0);
  camera.lookAt(0, 0.2, 1.5);

  scene.add(new THREE.HemisphereLight('#ffffff', '#888888', 2));
  const sun = new THREE.DirectionalLight('#ffffff', 1.8);
  sun.position.set(-8, 17, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(512, 512);
  Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 50 });
  sun.shadow.normalBias = 0.05;
  scene.add(sun);

  const materials = {
    paving: lambert('#7a6cb8'),
    rim: lambert('#c07090'),
    trim: lambert('#d4b45a'),
    gold: lambert('#d4b45a'),
    column: lambert('#4db89a'),
    abyss: basic('#d07040'),
    lava: basic('#c85840', 0.9),
    brazier: lambert('#c86840'),
    flame: basic('#e8d070'),
    gate: lambert('#d85a78'),
    seal: basic('#8a4880'),
    portal: basic('#58c0d0'),
    sigil: basic('#d08050'),
    rubble: lambert('#5a8ec8'),
  };

  function mesh(parent, geometry, material, position = [0, 0, 0]) {
    const item = new THREE.Mesh(geometry, material);
    item.position.set(...position);
    item.castShadow = true;
    item.receiveShadow = true;
    parent.add(item);
    return item;
  }
  function box(parent, size, position, material) {
    return mesh(parent, new THREE.BoxGeometry(...size), material, position);
  }
  function cylinder(parent, radius, height, position, material, segments = 12) {
    return mesh(parent, new THREE.CylinderGeometry(radius, radius, height, segments), material, position);
  }
  function ring(parent, inner, outer, position, material, segments = 24) {
    const item = mesh(parent, new THREE.RingGeometry(inner, outer, segments), material, position);
    item.rotation.x = -Math.PI / 2;
    item.castShadow = false;
    item.receiveShadow = false;
    return item;
  }
  function disk(parent, radius, position, material, segments = 24) {
    const item = mesh(parent, new THREE.CircleGeometry(radius, segments), material, position);
    item.rotation.x = -Math.PI / 2;
    item.castShadow = false;
    item.receiveShadow = false;
    return item;
  }
  function group(name) {
    const g = new THREE.Group();
    g.name = name;
    scene.add(g);
    return g;
  }

  const arena = group('arena');
  cylinder(arena, 12.1, 0.7, [0, -0.35, 0], materials.rim, 24);
  cylinder(arena, 11.55, 0.16, [0, 0.04, 0], materials.paving, 24);
  cylinder(arena, 12.2, 0.12, [0, 0.02, 0], materials.trim, 24);

  const architecture = group('architecture');
  ring(architecture, 12.4, 28, [0, -2.2, 0], materials.abyss, 24).receiveShadow = false;
  ring(architecture, 12.6, 14.5, [0, -1.7, 0], materials.lava, 20);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU + 0.22;
    const cliff = box(architecture, [5.2, 2.4, 3.2], [Math.sin(a) * 16.8, -0.5, Math.cos(a) * 16.8], materials.rubble);
    cliff.rotation.y = a;
  }
  function pillar(x, z, h) {
    const column = new THREE.Group();
    architecture.add(column);
    column.position.set(x, 0, z);
    box(column, [1.6, 0.36, 1.6], [0, 0.18, 0], materials.column);
    cylinder(column, 0.52, h, [0, h / 2 + 0.36, 0], materials.column, 10);
    box(column, [1.28, 0.28, 1.28], [0, h + 0.5, 0], materials.trim);
  }
  [[-10, -6.1, 5.4], [10, -6.1, 5.4], [-11.25, 1.3, 3.2], [11.25, 1.3, 4.3], [-8.8, 7.2, 1.5], [8.8, 7.2, 1.5], [-6.6, -10.8, 4], [6.6, -10.8, 4]].forEach(p => pillar(...p));

  const flames = [];
  for (const [x, z] of [[-7.6, -5], [7.6, -5], [-9, 4], [9, 4]]) {
    cylinder(architecture, 0.22, 0.9, [x, 0.5, z], materials.brazier, 8);
    cylinder(architecture, 0.5, 0.2, [x, 0.98, z], materials.trim, 8);
    const flame = mesh(architecture, new THREE.ConeGeometry(0.28, 0.72, 6), materials.flame, [x, 1.4, z]);
    flame.castShadow = false;
    flame.userData.dynamic = true;
    flames.push(flame);
  }

  const exit = group('exit');
  exit.position.z = -12;
  box(exit, [6.4, 0.3, 1.8], [0, 0.15, 0.35], materials.column);
  for (const side of [-1, 1]) {
    box(exit, [1.3, 6.4, 1.4], [side * 2.7, 3.2, 0], materials.gate);
  }
  box(exit, [7, 0.7, 1.6], [0, 6.65, 0], materials.trim);
  const gateSeal = new THREE.Group();
  gateSeal.userData.dynamic = true;
  exit.add(gateSeal);
  box(gateSeal, [4, 5.6, 0.24], [0, 3.3, 0.06], materials.seal);
  const portal = box(exit, [4, 5.6, 0.1], [0, 3.3, -0.14], materials.portal);
  portal.visible = false;
  portal.userData.dynamic = true;

  const sigil = group('sigil');
  sigil.position.set(0, 0.12, -6.9);
  cylinder(sigil, 2.15, 0.08, [0, 0, 0], materials.sigil, 16);

  function batchStatic(root) {
    root.updateMatrixWorld(true);
    const inverse = root.matrixWorld.clone().invert();
    const batches = new Map();
    root.traverse(node => {
      if (!node.isMesh || node.isInstancedMesh) return;
      let ancestor = node;
      while (ancestor && ancestor !== root) {
        if (ancestor.userData.dynamic) return;
        ancestor = ancestor.parent;
      }
      const key = node.material.uuid;
      if (!batches.has(key)) batches.set(key, { material: node.material, geometries: [], sources: [] });
      const batch = batches.get(key);
      const geometry = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld));
      batch.geometries.push(geometry);
      batch.sources.push(node);
    });
    for (const batch of batches.values()) {
      if (!batch.geometries.length) continue;
      const geometry = mergeGeometries(batch.geometries);
      batch.geometries.forEach(item => item.dispose());
      if (!geometry) continue;
      const combined = new THREE.Mesh(geometry, batch.material);
      combined.castShadow = true;
      combined.receiveShadow = true;
      batch.sources.forEach(node => { node.parent.remove(node); node.geometry.dispose(); });
      root.add(combined);
    }
  }
  [arena, architecture, exit, sigil].forEach(batchStatic);

  const hero = buildSimpleCharacterVisual(actorOptions.hero);
  hero.mesh.name = 'hero';
  scene.add(hero.mesh);
  const cloak = mesh(hero.mesh, new THREE.ConeGeometry(0.8, 1.48, 4, 1, true), lambert('#c94d62'), [0, 1.05, 0.4]);
  cloak.material.side = THREE.DoubleSide;
  cloak.rotation.set(0.13, Math.PI / 4, 0);
  cloak.scale.set(0.82, 1, 0.3);
  const heroRing = ring(scene, 0.66, 0.74, [0, 0.17, 7], basic('#d4b45a', 0.88), 24);

  const wardensRoot = group('wardens');
  const wardens = [actorOptions.wardenViolet, actorOptions.wardenRust].map(options => {
    const visual = buildSimpleFantasyCreatureVisual(options);
    wardensRoot.add(visual.mesh);
    return visual;
  });
  const boss = buildSimpleFantasyCreatureVisual(actorOptions.boss);
  boss.mesh.name = 'boss';
  scene.add(boss.mesh);
  for (const side of [-1, 1]) {
    const horn = mesh(boss.mesh, new THREE.ConeGeometry(0.22, 1.15, 6), materials.gold, [side * 0.84, 3.46, -0.08]);
    horn.rotation.z = side * -0.55;
  }
  box(boss.mesh, [0.16, 3.2, 0.16], [1.65, 1.35, -0.24], materials.trim);
  const axe = box(boss.mesh, [1.2, 0.9, 0.28], [1.65, 2.62, -0.24], materials.gold);
  axe.rotation.z = 0.25;
  for (const visual of [hero, ...wardens, boss]) {
    visual.mesh.traverse(node => {
      if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; }
    });
  }

  function warning(radius) {
    const root = new THREE.Group();
    scene.add(root);
    const fill = disk(root, radius - 0.08, [0, 0.2, 0], rangeMat('#d07050', 0.32), 28);
    const rim = ring(root, radius - 0.08, radius, [0, 0.22, 0], rangeMat('#d05068', 0.92), 28);
    fill.renderOrder = 4;
    rim.renderOrder = 5;
    root.visible = false;
    return root;
  }
  const warnings = [warning(2.3), warning(2.3), warning(3.4)];
  function rangeDisk(radius, rim, fill) {
    const root = new THREE.Group();
    scene.add(root);
    root.visible = false;
    const fillMesh = disk(root, radius - 0.08, [0, 0.2, 0], rangeMat(fill, 0.28), 32);
    const rimMesh = ring(root, radius - 0.08, radius, [0, 0.22, 0], rangeMat(rim, 0.92), 32);
    fillMesh.renderOrder = 4;
    rimMesh.renderOrder = 5;
    return root;
  }
  const slash = rangeDisk(4.25, '#d4b45a', '#d4b45a');
  const nova = rangeDisk(5.7, '#8a78c8', '#8a78c8');

  flatten(scene);
  return {
    scene, camera, hero, wardens, boss, warnings, slash, nova,
    flames, gateSeal, portal, heroRing,
  };
}
