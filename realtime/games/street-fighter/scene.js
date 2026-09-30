import * as THREE from 'three';
import { createCharacterVisual } from '/assets/world/object/factory/CharacterVisualFactory.js';

const SKY = '#4aa8ff';
const YAW_EXTRA = 0.22;

const colors = {
  asphalt: '#6654c9',
  sidewalk: '#d4896a',
  curb: '#e8c56a',
  lane: '#f0d45a',
  skyline: '#3d7ec8',
  window: '#d4b45a',
  facade: '#c07090',
  crown: '#d4b45a',
  shutter: '#5a8ec8',
  door: '#4a68b8',
  glass: '#7ec8d4',
  handle: '#d8c49a',
  signBox: '#5a4a88',
  strip: '#c94d62',
  right: '#4db89a',
  sideSign: '#7a68c0',
  vending: '#c94d62',
  vendingGlass: '#d4b45a',
  lamp: '#8a6bb8',
  lampHead: '#e8c56a',
  playerAccent: '#4db8b0',
  rivalAccent: '#c94d62',
};

const lambert = color => new THREE.MeshLambertMaterial({ color });
const basic = (color, opacity = 1) => new THREE.MeshBasicMaterial({
  color, transparent: opacity < 1, opacity, depthWrite: opacity === 1,
});

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

function box(parent, name, x, y, z, w, h, d, color, lit = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lit ? lambert(color) : basic(color));
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.castShadow = lit;
  mesh.receiveShadow = lit;
  parent.add(mesh);
  return mesh;
}

function textSign(parent, text, x, y, z, width, height, color = '#f1e8d4', background = '#3a2f5c') {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 1024, 256);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 166px sans-serif';
  ctx.fillText(text, 512, 137, 960);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture }));
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function makeFighter(name, accent, outfit, pants, skin, dir) {
  const visual = createCharacterVisual({
    preset: 'monk', height: 3.05, build: 1.12, headShape: 'box',
    loadout: { left: null, right: null },
    colors: { skin, top: outfit, pants, accent },
  });
  flatten(visual.mesh);
  const root = new THREE.Group();
  root.name = name;
  root.add(visual.group);
  const rig = visual.rig, extras = new THREE.Group();
  rig.head.add(extras);
  box(extras, 'hair', 0, 0.255, 0.03, 0.6, 0.17, 0.58, '#3a3048');
  box(extras, 'headband', 0, 0.11, -0.01, 0.576, 0.10, 0.594, accent);
  box(extras, 'brow', 0, 0.004, -0.285, 0.39, 0.048, 0.028, '#22212a');
  for (const x of [-0.12, 0.12]) box(extras, 'eye', x, -0.042, -0.289, 0.065, 0.04, 0.025, '#faf1df');
  box(rig.chest, 'belt', 0, 0.075, 0, 1.03, 0.17, 0.67, accent);
  const lapel = box(rig.chest, 'gi-lapel', -0.12, 0.55, -0.327, 0.11, 0.76, 0.03, name === 'player' ? '#d1c7b4' : '#5a4a58');
  lapel.rotation.z = -0.35;
  for (let i = 0; i < 2; i++) {
    const arm = rig.arms[i];
    arm.hand.children[0].visible = false;
    box(arm.hand, 'glove', 0, -0.025, -0.04, 0.32, 0.32, 0.38, accent);
    const hip = rig.legs[i].hip;
    hip.children[0].visible = false;
    box(hip, 'thigh', 0, -0.34, 0, 0.34, 0.69, 0.37, pants);
    const knee = new THREE.Group();
    knee.position.y = -0.67;
    hip.add(knee);
    box(knee, 'shin', 0, -0.29, 0, 0.30, 0.60, 0.32, pants);
    box(knee, 'shoe', 0, -0.59, -0.115, 0.35, 0.21, 0.56, name === 'player' ? '#3d6a72' : '#3a3040');
    rig.legs[i].knee = knee;
  }
  const tail = box(rig.head, 'headband-tail', 0.28, 0.1, 0.43, 0.12, 0.08, 0.66, accent);
  tail.rotation.y = -0.45;
  flatten(root);
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.85, 32),
    new THREE.MeshBasicMaterial({ color: '#1a1430', transparent: true, opacity: 0.45, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.y = 0.45;
  shadow.position.y = 0.012;
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.83, 0.88, 40),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.scale.y = 0.45;
  marker.position.y = 0.025;
  const view = { root, visual, rig, dir, shadow, marker, accent, params: visual.params };
  poseFighter(view, { x: dir > 0 ? -3.4 : 3.4, y: 0, facing: dir, action: 'idle', actionTime: 0, actionDuration: 1, moving: false, hp: 100 }, 0);
  return view;
}

export function faceYaw(facing) {
  return -facing * Math.PI / 2 + (facing > 0 ? YAW_EXTRA : -YAW_EXTRA);
}

export function poseFighter(view, f, time) {
  const { root, visual, rig } = view;
  visual.setPose(f.moving ? 'walk' : 'idle', time);
  root.position.set(f.x, f.y, 0);
  rig.body.position.y = 1.32 + (f.moving ? 0.015 : Math.sin(time * 4) * 0.025);
  rig.legs[0].hip.rotation.x = f.moving ? Math.sin(time * 11) * 0.45 : 0.35;
  rig.legs[1].hip.rotation.x = f.moving ? -Math.sin(time * 11) * 0.45 : -0.38;
  for (const leg of rig.legs) leg.knee.rotation.x = -0.16;
  rig.arms[0].shoulder.rotation.set(0.48, 0, -0.16); rig.arms[0].elbow.rotation.x = 1.55;
  rig.arms[1].shoulder.rotation.set(0.0, 0, 0.22); rig.arms[1].elbow.rotation.x = 1.9;
  rig.chest.rotation.y = -0.11;
  rig.chest.rotation.x = 0;
  const t = f.actionTime || 0, p = Math.min(1, t / (f.actionDuration || 1));
  if (f.action === 'punch') {
    const extend = Math.sin(Math.min(1, p / 0.64) * Math.PI);
    rig.arms[0].shoulder.rotation.x = 0.48 + 1.12 * extend;
    rig.arms[0].elbow.rotation.x = 1.55 * (1 - extend);
    rig.chest.rotation.y = -0.1 - 0.22 * extend;
  } else if (f.action === 'kick') {
    const extend = Math.sin(Math.min(1, p / 0.78) * Math.PI);
    rig.legs[0].hip.rotation.x = 0.35 + 1.32 * extend;
    rig.legs[0].knee.rotation.x = -0.16 + 0.13 * extend;
    rig.chest.rotation.x = -0.23 * extend;
  } else if (f.action === 'guard') {
    rig.arms[0].shoulder.rotation.x = 0.55; rig.arms[1].shoulder.rotation.x = 0.55;
    rig.arms[0].elbow.rotation.x = 2.2; rig.arms[1].elbow.rotation.x = 2.2;
    rig.body.position.y -= 0.10;
  } else if (f.action === 'hurt') {
    rig.chest.rotation.x = -0.33; rig.arms[0].shoulder.rotation.x = -0.35;
  } else if (f.action === 'ko' || f.hp <= 0) {
    const fall = Math.min(1, t / 0.48);
    root.rotation.z = f.facing * fall * 1.43;
    root.position.y = 0.12; rig.body.position.y = 1.32;
    rig.arms[0].shoulder.rotation.x = -0.6; rig.arms[1].shoulder.rotation.x = 0.4;
  } else if (f.action === 'victory') {
    rig.arms[0].shoulder.rotation.x = Math.PI; rig.arms[0].elbow.rotation.x = 0.25;
    root.rotation.z = 0;
  } else {
    root.rotation.z = 0;
  }
  if (f.y > 0.05) { rig.legs[1].hip.rotation.x = 0.85; rig.legs[1].knee.rotation.x = -1.0; }
  view.shadow.position.x = f.x;
  view.marker.position.x = f.x;
  view.shadow.scale.setScalar(Math.max(0.4, 1 - f.y * 0.16));
  view.shadow.scale.y *= 0.45;
}

export function createWorld() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  const camera = new THREE.OrthographicCamera(-10, 10, 4.8, -4.8, 0.1, 90);
  camera.position.set(0, 5.8, 25);
  camera.lookAt(0, 2.6, 0);

  scene.add(new THREE.HemisphereLight('#ffffff', '#888888', 2));
  const sun = new THREE.DirectionalLight('#ffffff', 1.8);
  sun.position.set(-7, 15, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 50 });
  sun.shadow.normalBias = 0.05;
  scene.add(sun);

  const street = new THREE.Group();
  street.name = 'street';
  scene.add(street);
  const floor = box(street, 'asphalt', 0, -0.15, 0, 40, 0.25, 18, colors.asphalt);
  floor.receiveShadow = true;
  floor.castShadow = false;
  box(street, 'sidewalk', 0, 0.13, -3.8, 35, 0.3, 3, colors.sidewalk);
  box(street, 'curb', 0, 0.08, -2.2, 35, 0.19, 0.16, colors.curb);
  for (let x = -16; x <= 16; x += 3.2) box(street, 'lane-mark', x, 0.003, 2.4, 1.7, 0.011, 0.10, colors.lane, false);
  box(street, 'front-line', 0, 0.008, 4.6, 36, 0.018, 0.08, colors.lane, false);

  const skyline = new THREE.Group();
  skyline.name = 'skyline';
  scene.add(skyline);
  const slabs = [
    [-13.2, 7, -11], [-8.8, 9, -13], [-4.4, 6, -10], [0, 10, -12],
    [4.4, 7.5, -11], [8.8, 9.5, -13], [13.2, 6.5, -10],
  ];
  for (const [x, h, z] of slabs) {
    box(skyline, 'city-block', x, h / 2, z, 3.7, h, 3, colors.skyline);
    box(skyline, 'window', x, h * 0.55, z + 1.52, 2.2, h * 0.45, 0.08, colors.window, false);
  }

  box(street, 'arcade-facade', -1.5, 2.5, -5.7, 13.2, 5.0, 1.5, colors.facade);
  box(street, 'arcade-crown', -1.5, 4.85, -4.84, 13.6, 0.24, 0.4, colors.crown);
  for (const x of [-5.2, 2.3]) {
    box(street, 'shutter-frame', x, 1.9, -4.78, 4.0, 3.6, 0.15, colors.door);
    box(street, 'shutter', x, 1.85, -4.67, 3.5, 3.35, 0.16, colors.shutter);
  }
  box(street, 'door', -1.5, 1.75, -4.75, 2.0, 3.1, 0.1, colors.door);
  box(street, 'door-glass', -1.5, 2.15, -4.67, 1.68, 1.75, 0.02, colors.glass, false);
  box(street, 'door-handle', -0.91, 1.65, -4.58, 0.06, 0.5, 0.08, colors.handle);
  box(street, 'sign-box', -1.5, 4.02, -4.47, 5.4, 0.86, 0.25, colors.signBox);
  textSign(skyline, 'AFTER HOURS', -1.5, 4.03, -4.30, 5.1, 0.70, '#f2cab9', '#3a2f5c');
  box(street, 'accent-strip', -1.5, 3.48, -4.38, 12.7, 0.065, 0.05, colors.strip, false);

  box(street, 'right-building', 8.6, 3.7, -6, 5.7, 7.4, 2, colors.right);
  box(street, 'side-sign', 5.9, 4.55, -4.3, 0.97, 3.7, 0.42, colors.sideSign);
  for (let i = 0; i < 4; i++) {
    textSign(skyline, ['N', 'E', 'O', 'N'][i], 5.9, 5.65 - i * 0.75, -4.06, 0.68, 0.62, '#7be5e2', '#3a2f5c');
  }
  box(street, 'sign-edge', 5.36, 4.55, -4.11, 0.05, 3.7, 0.06, colors.playerAccent, false);
  box(street, 'vending', 8.1, 1.25, -3.9, 1.2, 2.45, 0.78, colors.vending);
  box(street, 'vending-glass', 8.1, 1.55, -3.50, 0.88, 1.1, 0.035, colors.vendingGlass, false);

  for (const x of [-9, 9.8]) {
    box(street, 'lamp-pole', x, 2.3, -2.9, 0.11, 4.6, 0.11, colors.lamp);
    box(street, 'lamp', x + 0.33, 4.58, -2.9, 0.85, 0.12, 0.25, colors.lampHead, false);
  }

  const player = makeFighter('player', colors.playerAccent, '#e8d9c4', '#d4c8b4', '#e6ae87', 1);
  const rival = makeFighter('rival', colors.rivalAccent, '#5a4a58', '#6a5a62', '#b78166', -1);
  for (const f of [player, rival]) scene.add(f.root, f.shadow, f.marker);

  const effects = new THREE.Group();
  effects.name = 'hit-effects';
  scene.add(effects);
  const sparkGeometry = new THREE.BoxGeometry(0.09, 0.09, 0.09);
  const sparks = Array.from({ length: 32 }, () => {
    const mesh = new THREE.Mesh(sparkGeometry, new THREE.MeshBasicMaterial({ color: '#e8c56a' }));
    mesh.visible = false;
    effects.add(mesh);
    return mesh;
  });

  flatten(scene);
  return { scene, camera, player, rival, sparks, baseCamera: camera.position.clone() };
}
