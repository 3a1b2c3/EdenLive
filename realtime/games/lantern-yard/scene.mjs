import {
  BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry,
  PointLight, SphereGeometry, TorusGeometry,
} from 'three';
import { applyAtmosphere } from '/assets/world/environment/SceneAtmosphere.js';
import { buildSimpleCharacterVisual } from '/assets/world/object/factory/CharacterVisualFactory.js';
import { buildSimpleTreeVisual } from '/assets/world/object/factory/TreeVisualFactory.js';

// Authoritative layout data. Behavior reads collision and spawn data from here.
export const LAYOUT = Object.freeze({
  half: 15,                       // courtyard inner half-extent (metres)
  wallHeight: 3.2,
  wallThickness: 1,
  playerSpawn: [0, 0, 12],
  // Axis-aligned blockers [cx, cz, halfX, halfZ].
  boxes: [
    [-8, 3, 0.6, 2.5], [8, -3, 0.6, 2.5],        // long hedges
    [0, -9.5, 2, 0.6], [5, 9, 2, 0.6],           // cross hedges
    [-10, 6, 1.2, 1.2], [10.5, -7, 1.2, 1.2],    // planters
    [-4.5, 4.5, 1.1, 0.4], [4.5, -4.5, 1.1, 0.4], // benches
  ],
  // Round blockers [cx, cz, radius].
  circles: [
    [0, 0, 2.4],                                 // fountain
    [-13.6, -13.6, 0.8], [13.6, 13.6, 0.8], [13.6, -13.6, 0.8], [-13.6, 13.6, 0.8], // tree trunks
  ],
  // Lanterns sit around the garden edge, outside the guard's loop.
  lanterns: [
    [-6, 14.2], [7, 14.2], [14.2, 0], [0, -14.2], [-14.2, 0],
  ],
  // Guard patrol loop (x, z) around the fountain.
  guardPath: [[-5.5, -5.5], [5.5, -5.5], [5.5, 5.5], [-5.5, 5.5]],
});

const mat = (color, extra = {}) => new MeshStandardMaterial({ color, roughness: 0.85, ...extra });

function box(parent, name, [w, h, d], [x, y, z], material) {
  const m = new Mesh(new BoxGeometry(w, h, d), material);
  m.name = name; m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}

export function buildLantern(index) {
  const g = new Group();
  g.name = `lantern-${index}`;
  const glow = new MeshStandardMaterial({ color: 0xffc46b, emissive: 0xff9a2e, emissiveIntensity: 1.6, roughness: 0.4 });
  const frame = mat(0x3a2414);
  const post = new Mesh(new CylinderGeometry(0.06, 0.08, 1.1, 8), frame);
  post.position.y = 0.55; g.add(post);
  const body = new Mesh(new SphereGeometry(0.32, 16, 12), glow);
  body.scale.set(1, 1.25, 1); body.position.y = 1.45; body.name = 'lantern-body'; g.add(body);
  const cap = new Mesh(new CylinderGeometry(0.12, 0.22, 0.12, 10), frame);
  cap.position.y = 1.88; g.add(cap);
  const ring = new Mesh(new TorusGeometry(0.55, 0.05, 6, 24), new MeshStandardMaterial({ color: 0xffb04a, emissive: 0xff8a1e, emissiveIntensity: 1.2 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.04; g.add(ring);
  const light = new PointLight(0xffa64a, 6, 6, 1.6);
  light.position.y = 1.45; g.add(light);
  return g;
}

export function buildCourtyard(scene) {
  const { half, wallHeight: wh, wallThickness: wt } = LAYOUT;
  applyAtmosphere(scene, {
    skyColor: 0x2b2f52, fogFar: 70, fogNear: 30,
    ambientColor: 0x8d94c8, ambientIntensity: 0.55,
    keyColor: 0xffc9a0, keyIntensity: 0.9, keyElevationDeg: 38, keyAzimuthDeg: 210,
    shadows: true, shadowExtent: 22,
  });

  const backdrop = new Group(); backdrop.name = 'backdrop'; scene.add(backdrop);
  const moon = new Mesh(new SphereGeometry(3, 20, 14), new MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xffe8b8, emissiveIntensity: 0.9 }));
  moon.position.set(-28, 26, -45); backdrop.add(moon);

  // Walls and floor.
  const walls = new Group(); walls.name = 'courtyard-walls'; scene.add(walls);
  const stone = mat(0x8a7d6b), capStone = mat(0x6d6253);
  const ground = new Mesh(new PlaneGeometry(80, 80), mat(0x3c4a2e));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.name = 'outer-ground';
  walls.add(ground);
  const span = half * 2 + wt * 2;
  for (const [name, x, z, w, d] of [
    ['wall-n', 0, -half - wt / 2, span, wt], ['wall-s', 0, half + wt / 2, span, wt],
    ['wall-w', -half - wt / 2, 0, wt, span], ['wall-e', half + wt / 2, 0, wt, span],
  ]) {
    box(walls, name, [w, wh, d], [x, wh / 2, z], stone);
    box(walls, `${name}-cap`, [w + 0.3, 0.25, d + 0.3], [x, wh + 0.12, z], capStone);
  }

  // Garden dressing: lawn, gravel paths, hedges, planters, benches, fountain, trees.
  const garden = new Group(); garden.name = 'garden'; scene.add(garden);
  const lawn = new Mesh(new PlaneGeometry(half * 2, half * 2), mat(0x4f7a3a));
  lawn.rotation.x = -Math.PI / 2; lawn.position.y = 0.01; lawn.receiveShadow = true; garden.add(lawn);
  const gravel = mat(0xb9ad94);
  for (const [w, d] of [[2.4, half * 2], [half * 2, 2.4]]) {
    const path = new Mesh(new PlaneGeometry(w, d), gravel);
    path.rotation.x = -Math.PI / 2; path.position.y = 0.02; path.receiveShadow = true; garden.add(path);
  }
  const ringPath = new Mesh(new TorusGeometry(6, 0.9, 4, 40), gravel);
  ringPath.rotation.x = -Math.PI / 2; ringPath.scale.z = 0.02; ringPath.position.y = 0.02; garden.add(ringPath);

  const hedge = mat(0x2f5a2a), planter = mat(0x7a4a32), bench = mat(0x6b4a2e);
  LAYOUT.boxes.forEach(([cx, cz, hx, hz], i) => {
    if (i < 4) box(garden, `hedge-${i}`, [hx * 2, 1.6, hz * 2], [cx, 0.8, cz], hedge);
    else if (i < 6) {
      box(garden, `planter-${i}`, [hx * 2, 0.7, hz * 2], [cx, 0.35, cz], planter);
      const flowers = new Mesh(new SphereGeometry(hx * 0.9, 12, 8), mat(0xc85a8a));
      flowers.scale.y = 0.45; flowers.position.set(cx, 0.75, cz); garden.add(flowers);
    } else {
      box(garden, `bench-${i}`, [hx * 2, 0.15, hz * 2], [cx, 0.5, cz], bench);
      for (const s of [-1, 1]) box(garden, `bench-leg-${i}-${s}`, [0.15, 0.45, hz * 1.6], [cx + s * hx * 0.8, 0.22, cz], stone);
    }
  });

  const fountain = new Group(); fountain.name = 'fountain'; garden.add(fountain);
  const basin = new Mesh(new CylinderGeometry(2.4, 2.6, 0.7, 28), stone);
  basin.position.y = 0.35; basin.castShadow = true; fountain.add(basin);
  const water = new Mesh(new CylinderGeometry(2.1, 2.1, 0.05, 28), new MeshStandardMaterial({ color: 0x4a86b8, roughness: 0.2, metalness: 0.1 }));
  water.position.y = 0.66; fountain.add(water);
  const column = new Mesh(new CylinderGeometry(0.3, 0.45, 1.8, 12), stone);
  column.position.y = 1.2; column.castShadow = true; fountain.add(column);
  const bowl = new Mesh(new CylinderGeometry(0.9, 0.4, 0.3, 16), stone);
  bowl.position.y = 2.1; fountain.add(bowl);

  const treePresets = ['oak', 'cherry', 'maple', 'cypress'];
  LAYOUT.circles.slice(1).forEach(([x, z], i) => {
    const tree = buildSimpleTreeVisual({ preset: treePresets[i] });
    tree.group.name = `tree-${i}`;
    tree.group.position.set(x, 0, z);
    tree.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
    garden.add(tree.group);
  });

  // Actors.
  const player = buildSimpleCharacterVisual({ preset: 'hiker', height: 1.8, colors: { top: '#d8853f', pants: '#3a4c6b' } });
  player.group.name = 'player';
  player.group.position.set(...LAYOUT.playerSpawn);
  player.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  scene.add(player.group);

  const guard = buildSimpleCharacterVisual({ preset: 'police', height: 2.0, build: 1.15, colors: { top: '#1f2433', pants: '#14161f', accent: '#b02a2a' } });
  guard.group.name = 'guard';
  const [gx, gz] = LAYOUT.guardPath[0];
  guard.group.position.set(gx, 0, gz);
  guard.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  // Red warning ring so the hazard reads from the chase camera.
  const warn = new Mesh(new TorusGeometry(0.9, 0.06, 6, 28), new MeshStandardMaterial({ color: 0xff3b2e, emissive: 0xff2010, emissiveIntensity: 1 }));
  warn.rotation.x = Math.PI / 2; warn.position.y = 0.05; guard.group.add(warn);
  scene.add(guard.group);

  // Five lanterns.
  const lanterns = new Group(); lanterns.name = 'lanterns'; scene.add(lanterns);
  const lanternObjects = LAYOUT.lanterns.map(([x, z], i) => {
    const l = buildLantern(i); l.position.set(x, 0, z); lanterns.add(l); return l;
  });

  return { player, guard, lanterns: lanternObjects };
}
