import * as THREE from 'three';
import { createRenderer } from '/assets/user-interface/PrototypeShell.js';
import { createCharacterVisual } from '/assets/world/object/factory/CharacterVisualFactory.js';
import { createTreeVisual } from '/assets/world/object/factory/TreeVisualFactory.js';
import { keyOf, pointOf } from './levels.mjs';

const COLORS = {
  sky: '#4aa8ff',
  plinth: '#d94a28',
  plinthMid: '#e07040',
  plinthTop: '#f08a52',
  tile: ['#f2c84a', '#e8bc30', '#f6d45c', '#efc43c'],
  wall: '#2ecf6a',
  wallCap: '#9af08a',
  moss: '#7dff3a',
  wood: '#e07010',
  brace: '#ffd24a',
  frame: '#f0a020',
  docked: '#18e0e8',
  dockedSeal: '#0aa0c8',
  goal: '#e8a020',
  goalFill: '#ffd24a',
  planter: '#ff3d8a',
  soil: '#b8e020',
  grass: '#c8ff40',
  hat: '#0e7a9a',
  hatBand: '#ff6a00',
};
export const FACTORY_OPTIONS = {
  keeper: {
    preset: 'worker', height: 1.16, build: 1.2, headShape: 'round',
    colors: { skin: '#edcda9', top: '#2ad4c8', pants: '#3a4ae0', accent: '#ffd24a' },
    loadout: { left: null, right: null },
  },
  cypress: {
    preset: 'cypress', height: 2.6, crownWidth: 1.1, trunkRadius: .08,
    colors: { bark: '#a05a28', leaf: '#1a9a38' }, wind: .22,
  },
  shrub: {
    preset: 'shrub', height: 1.2, crownWidth: 1.5,
    colors: { bark: '#b07030', leaf: '#00c8a0' }, wind: .1,
  },
};

function flatten(root) {
  root.traverse(object => {
    if (!object.isMesh) return;
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
      if ('metalness' in material) material.metalness = 0;
      if ('roughness' in material) material.roughness = 1;
      if (material.emissive) material.emissive.set(0);
    }
  });
}

export function createGarden(container, board, initial) {
  const renderer = createRenderer(container);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.sky);
  const camera = new THREE.OrthographicCamera(-8, 8, 6, -6, .1, 100);
  camera.position.set(9.5, 14.5, 11.5);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight('#ffffff', '#888888', 2));
  const sun = new THREE.DirectionalLight('#ffffff', 1.8);
  sun.position.set(-6, 12, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -12;
  sun.shadow.camera.right = 12;
  sun.shadow.camera.top = 12;
  sun.shadow.camera.bottom = -12;
  sun.shadow.normalBias = .025;
  sun.shadow.bias = -.00035;
  scene.add(sun);
  const root = new THREE.Group();
  scene.add(root);
  const groups = {};
  for (const name of ['courtyard', 'walls', 'crates', 'goals', 'planting', 'keeper']) {
    const group = new THREE.Group();
    group.name = name;
    groups[name] = group;
    root.add(group);
  }
  const geometries = new Map(), materials = new Map();
  const assets = [], crateRoots = new Map(), goalRoots = new Map(), tileMeshes = [];
  let actor, currentBoard = board;
  const material = color => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshLambertMaterial({ color }));
    return materials.get(color);
  };
  const beacon = color => {
    const key = `basic:${color}`;
    if (!materials.has(key)) materials.set(key, new THREE.MeshBasicMaterial({ color }));
    return materials.get(key);
  };
  const boxGeometry = (w, h, d, bevel = .025) => {
    bevel = Math.min(bevel, Math.min(w, h, d) * .35);
    const key = [w, h, d, bevel].join('/');
    if (geometries.has(key)) return geometries.get(key);
    const shape = new THREE.Shape(), x = -w / 2 + bevel, y = -h / 2 + bevel, tw = w - 2 * bevel, th = h - 2 * bevel;
    shape.moveTo(x, y); shape.lineTo(x + tw, y); shape.lineTo(x + tw, y + th); shape.lineTo(x, y + th); shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(.001, d - 2 * bevel), bevelEnabled: bevel > 0, bevelSegments: 1, steps: 1,
      bevelSize: bevel, bevelThickness: bevel,
    });
    geometry.translate(0, 0, -d / 2 + bevel);
    geometry.computeVertexNormals();
    geometries.set(key, geometry);
    return geometry;
  };
  const box = (parent, w, h, d, color, x = 0, y = 0, z = 0, bevel = .025) => {
    const mesh = new THREE.Mesh(boxGeometry(w, h, d, bevel), material(color));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const cylinder = (parent, top, bottom, height, color, x, y, z, sides = 12) => {
    const key = ['cyl', top, bottom, height, sides].join('/');
    if (!geometries.has(key)) geometries.set(key, new THREE.CylinderGeometry(top, bottom, height, sides));
    const mesh = new THREE.Mesh(geometries.get(key), material(color));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const coord = (x, y) => new THREE.Vector3(x - (currentBoard.width - 1) / 2, .045, y - (currentBoard.height - 1) / 2);
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 64;
  const context = shadowCanvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 4, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(16, 40, 80, .45)');
  gradient.addColorStop(1, 'rgba(16, 40, 80, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  const shadowMaterial = new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false });
  const shadowGeo = new THREE.PlaneGeometry(1.55, 1.55);
  function shadow(parent, scale = 1) {
    const s = new THREE.Mesh(shadowGeo, shadowMaterial);
    s.rotation.x = -Math.PI / 2;
    s.position.y = .01;
    s.scale.setScalar(scale);
    parent.add(s);
  }

  function makeCrate(id) {
    const group = new THREE.Group();
    group.name = id;
    const body = box(group, .72, .72, .72, COLORS.wood, 0, .385, 0, .045);
    for (const z of [-.385, .385]) {
      box(group, .77, .095, .055, COLORS.frame, 0, .105, z, .007);
      box(group, .77, .095, .055, COLORS.frame, 0, .67, z, .007);
      for (const x of [-.30, .30]) box(group, .075, .58, .055, COLORS.frame, x, .385, z, .007);
      for (const sign of [-1, 1]) {
        const brace = box(group, .69, .09, .065, COLORS.brace, 0, .385, z * 1.06, .008);
        brace.rotation.z = sign * Math.PI / 4;
      }
      for (const x of [-.28, .28]) for (const y of [.11, .66]) {
        cylinder(group, .018, .018, .012, COLORS.wood, x, y, z + Math.sign(z) * .032, 6).rotation.x = Math.PI / 2;
      }
    }
    for (const x of [-.383, .383]) {
      box(group, .05, .62, .075, COLORS.frame, x, .39, -.28, .005);
      box(group, .05, .62, .075, COLORS.frame, x, .39, .28, .005);
      for (const y of [.12, .66]) box(group, .055, .07, .72, COLORS.brace, x, y, 0, .005);
    }
    for (const x of [-.22, 0, .22]) box(group, .21, .028, .63, COLORS.brace, x, .758, 0, .006);
    const seal = box(group, .24, .017, .24, COLORS.brace, 0, .784, 0, .009);
    seal.rotation.y = Math.PI / 4;
    const check = new THREE.Group();
    for (const [length, x, z, angle] of [[.12, -.03, .02, -Math.PI / 4], [.21, .045, 0, Math.PI / 4]]) {
      const m = box(check, length, .018, .035, '#f7f3d9', x, .79, z, .002);
      m.rotation.y = angle;
    }
    check.visible = false;
    group.add(check);
    group.userData = { body, seal, check, id };
    shadow(group, .8);
    return group;
  }
  function makePlant(x, z, preset, scale = 1) {
    const planter = new THREE.Group();
    planter.position.set(x, -.025, z);
    groups.planting.add(planter);
    box(planter, 1.2, .26, 1.2, COLORS.planter, 0, -.10, 0, .05);
    box(planter, 1.1, .10, 1.1, COLORS.soil, 0, .07, 0, .03);
    const tree = createTreeVisual(FACTORY_OPTIONS[preset]);
    tree.group.scale.setScalar(scale);
    tree.group.position.y = .10;
    tree.setPose('still', 0);
    planter.add(tree.group);
    assets.push(tree);
    for (let i = 0; i < 4; i++) {
      const angle = i * 2.4;
      const stone = cylinder(planter, .07, .10, .09, COLORS.plinthTop, Math.cos(angle) * .41, .15, Math.sin(angle) * .4, 7);
      stone.rotation.z = .2;
    }
  }
  function build(nextBoard, snapshot) {
    currentBoard = nextBoard;
    for (const a of assets.splice(0)) a.dispose();
    for (const group of Object.values(groups)) group.clear();
    crateRoots.clear();
    goalRoots.clear();
    tileMeshes.length = 0;
    const width = nextBoard.width, height = nextBoard.height;
    box(groups.courtyard, width + .30, .46, height + .30, COLORS.plinth, 0, -.46, 0, .12);
    box(groups.courtyard, width + .52, .18, height + .52, COLORS.plinthMid, 0, -.20, 0, .07);
    box(groups.courtyard, width + .36, .10, height + .36, COLORS.plinthTop, 0, -.075, 0, .035);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = coord(x, y), key = keyOf(x, y), blocked = nextBoard.walls.has(key);
      const tile = box(groups.courtyard, .967, .115, .967, COLORS.tile[(x * 7 + y * 3) % 4], p.x, -.025, p.z, .026);
      tile.userData.cell = { x, y };
      if (!blocked) tileMeshes.push(tile);
      if (blocked) {
        const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
        const h = edge ? ((x === width - 1 || y === height - 1) ? .23 : .48) : .70;
        box(groups.walls, .95, h, .95, COLORS.wall, p.x, h / 2 + .04, p.z, .055);
        box(groups.walls, .975, .085, .975, COLORS.wallCap, p.x, h + .067, p.z, .028);
        if ((x + y) % 3 === 0) box(groups.walls, .62, .018, .46, COLORS.moss, p.x + .08, h + .117, p.z - .13, .008);
      }
    }
    for (const key of nextBoard.goals) {
      const [x, y] = pointOf(key), p = coord(x, y), goal = new THREE.Group();
      goal.position.copy(p);
      groups.goals.add(goal);
      box(goal, .73, .018, .73, COLORS.tile[0], 0, .015, 0, .006);
      const strips = [];
      for (const sign of [-1, 1]) {
        strips.push(box(goal, .56, .018, .04, COLORS.goal, 0, .031, sign * .27, .007));
        strips.push(box(goal, .04, .018, .56, COLORS.goal, sign * .27, .031, 0, .007));
      }
      const diamond = box(goal, .17, .020, .17, COLORS.goalFill, 0, .030, 0, .015);
      diamond.rotation.y = Math.PI / 4;
      for (const strip of strips) strip.material = beacon(COLORS.goal);
      diamond.material = beacon(COLORS.goalFill);
      goal.userData = { strips, diamond };
      goalRoots.set(key, goal);
    }
    for (const crate of snapshot.crates) {
      const mesh = makeCrate(crate.id);
      mesh.position.copy(coord(crate.x, crate.y));
      groups.crates.add(mesh);
      crateRoots.set(crate.id, mesh);
    }
    actor = createCharacterVisual(FACTORY_OPTIONS.keeper);
    actor.setPose('idle', 0);
    groups.keeper.add(actor.group);
    assets.push(actor);
    const hat = new THREE.Group();
    cylinder(hat, .265, .29, .055, COLORS.hat, 0, 1.15, 0, 16);
    cylinder(hat, .17, .21, .19, COLORS.hat, 0, 1.25, 0, 14);
    cylinder(hat, .215, .22, .05, COLORS.hatBand, 0, 1.18, 0, 14);
    actor.group.add(hat);
    groups.keeper.position.copy(coord(snapshot.player.x, snapshot.player.y));
    groups.keeper.rotation.y = Math.PI;
    shadow(groups.keeper, .62);
    makePlant(-width / 2 - .55, -height / 2 + 1.5, 'cypress');
    makePlant(-width / 2 + .6, -height / 2 - .55, 'cypress', .78);
    makePlant(width / 2 - .75, -height / 2 - .55, 'shrub', .65);
    makePlant(-width / 2 - .42, height / 2 - 1.3, 'shrub', .52);
    for (let i = 0; i < 11; i++) {
      const x = -width / 2 + .6 + (i % 4) * .20, z = height / 2 + .19 + Math.floor(i / 4) * .09;
      const blade = box(groups.planting, .025, .18 + (i % 3) * .065, .035, COLORS.grass, x, -.02, z, .004);
      blade.rotation.z = (i % 3 - 1) * .4;
    }
    const plate = box(groups.courtyard, 1.26, .16, .045, COLORS.wall, .8, -.38, height / 2 + .183, .012);
    for (let i = 0; i < 3; i++) box(groups.courtyard, .045, .065, .02, COLORS.wallCap, .65 + i * .14, -.37, plate.position.z + .03, .008);
    flatten(scene);
    sync(snapshot, 1, true);
  }
  function fit(width, height) {
    const w = width || container.clientWidth || 800, h = height || container.clientHeight || 500;
    const aspect = w / h;
    const size = Math.max(currentBoard.width, currentBoard.height);
    const halfHeight = Math.max(size * .72, size * .86 / aspect);
    camera.top = halfHeight;
    camera.bottom = -halfHeight;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  const hintMesh = new THREE.Mesh(
    new THREE.RingGeometry(.28, .33, 40),
    new THREE.MeshBasicMaterial({ color: COLORS.goalFill, side: THREE.DoubleSide, transparent: true, opacity: .8 }),
  );
  hintMesh.rotation.x = -Math.PI / 2;
  hintMesh.visible = false;
  scene.add(hintMesh);
  const wrapPi = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
  const FACE = { up: 0, right: -Math.PI / 2, down: Math.PI, left: Math.PI / 2 };
  function sync(snapshot, dt, instant = false) {
    const lerp = instant ? 1 : 1 - Math.exp(-Math.min(dt, .1) * 19);
    const target = coord(snapshot.player.x, snapshot.player.y);
    const moving = groups.keeper.position.distanceTo(target) > .014;
    groups.keeper.position.lerp(target, lerp);
    if (snapshot.direction) {
      const targetYaw = FACE[snapshot.direction];
      const fromS = wrapPi(groups.keeper.rotation.y - Math.PI);
      const toS = wrapPi(targetYaw - Math.PI);
      const delta = wrapPi(toS - fromS);
      groups.keeper.rotation.y = Math.abs(delta) < 1e-3 ? targetYaw : wrapPi(fromS + delta * lerp + Math.PI);
    }
    actor.setPose(moving ? 'walk' : 'idle', moving ? (snapshot.elapsed || 0) : 0);
    for (const crate of snapshot.crates) {
      const mesh = crateRoots.get(crate.id), p = coord(crate.x, crate.y);
      mesh.position.lerp(p, lerp);
      const docked = currentBoard.goals.has(keyOf(crate.x, crate.y));
      mesh.userData.body.material = material(docked ? COLORS.docked : COLORS.wood);
      mesh.userData.seal.material = material(docked ? COLORS.dockedSeal : COLORS.brace);
      mesh.userData.check.visible = docked;
    }
    for (const [key, goal] of goalRoots) {
      const filled = snapshot.crates.some(c => keyOf(c.x, c.y) === key);
      for (const strip of goal.userData.strips) strip.material = beacon(filled ? COLORS.docked : COLORS.goal);
    }
  }
  function showHint(point) {
    hintMesh.visible = !!point;
    if (point) {
      hintMesh.position.copy(coord(point.x, point.y));
      hintMesh.position.y = .09;
    }
  }
  function pick(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      (clientX - rect.left) / rect.width * 2 - 1,
      1 - (clientY - rect.top) / rect.height * 2,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, camera);
    return ray.intersectObjects(tileMeshes, false)[0]?.object.userData.cell ?? null;
  }
  build(board, initial);
  return {
    scene, camera, renderer, groups, build, sync, pick, showHint, fit,
    render: () => renderer.render(scene, camera),
    dispose() {
      for (const a of assets) a.dispose();
      for (const g of geometries.values()) g.dispose();
      for (const m of materials.values()) m.dispose();
      shadowTexture.dispose();
      shadowMaterial.dispose();
      shadowGeo.dispose();
      hintMesh.geometry.dispose();
      hintMesh.material.dispose();
      renderer.dispose();
    },
  };
}
