// SPDX-License-Identifier: Apache-2.0
import * as T from 'three';
import { box, ball, cyl, cone, rod, group, mat, noiseTexture, texturedMat, facadeTexture, skyDome, mulberry32, clamp, smooth, ownMaterials, setEmissive, createDrain , LiteLight } from '../_shared/kit.mjs';
import { Fx, createBolt } from '../_shared/fx.mjs';
import { v3 } from '../_shared/fpsview.mjs';
import { PoseFollowCameraRig } from '/assets/camera/PoseFollowCameraRig.js';
import { ARENA, TOWERS, BLOCKS, FLAME } from './game.mjs';

const FIRE = 0xff8a22, HOT = 0xfff0a0;

function buildColossus() {
  const root = group(null), body = group(root);
  const green = '#2f6f4a', dark = '#245a3a', belly = '#a6b27a', plate = '#d0a24e';
  ball(body, green, [0, 2.7, 0], [1.6, 1.4, 3.1], 1);
  ball(body, belly, [0, 2.0, -.1], [1.2, .85, 2.7], 1);
  ball(body, dark, [0, 2.9, -2.6], [1.0, .95, 1.5], 1);                        // neck
  const head = group(body, 0, 3.15, -3.9);
  ball(head, green, [0, 0, 0], [1.05, .85, 1.35], 1);
  box(head, dark, [0, -.05, -1.3], [1.1, .5, 1.3]);                             // snout
  const jaw = group(head, 0, -.38, -.6);
  box(jaw, dark, [0, -.1, -.75], [1.0, .26, 1.5]);
  for (let k = 0; k < 5; k++) cone(jaw, '#efe6c8', [-.4 + k * .2, .12, -1.35], [.07, .24], 4);
  for (let k = 0; k < 5; k++) { const t = cone(head, '#efe6c8', [-.4 + k * .2, -.34, -1.75], [.07, .24], 4); t.rotation.x = Math.PI; }
  for (const sx of [-1, 1]) {
    ball(head, new T.MeshBasicMaterial({ color: 0xffd23a }), [sx * .5, .32, -.65], [.15, .15, .15], 1);
    cone(head, '#caa766', [sx * .55, .75, .1], [.16, .7], 5).rotation.set(-.3, 0, sx * -.3);
  }
  const mouth = new T.Object3D(); mouth.position.set(0, -.35, -2.0); head.add(mouth);
  const legs = [[-1, -1.6], [1, -1.6], [-1, 1.7], [1, 1.7]].map(([sx, z], i) => {
    const hip = group(body, sx * 1.15, 2.2, z);
    box(hip, dark, [sx * .1, -.8, 0], [.85, 1.7, .95]);
    const foot = group(hip, sx * .1, -1.65, 0);
    box(foot, green, [0, 0, -.2], [1.05, .35, 1.4]);
    for (let k = -1; k <= 1; k++) cone(foot, '#efe6c8', [k * .32, -.05, -.98], [.1, .3], 4).rotation.x = -Math.PI / 2;
    return { hip, foot, sx, i };
  });
  const tail = [];
  let parent = group(body, 0, 2.5, 2.9);
  for (let k = 0; k < 6; k++) {
    const s = 1 - k * .14;
    ball(parent, k % 2 ? dark : green, [0, 0, 1.0 * s], [.85 * s, .8 * s, 1.15 * s], 1);
    const next = group(parent, 0, -.05, 1.9 * s);
    cone(parent, plate, [0, .8 * s, .9 * s], [.28 * s, .9 * s], 4);
    tail.push(parent); parent = next;
  }
  for (let k = 0; k < 7; k++) { const z = -2.2 + k * .85, s = 1 - Math.abs(k - 3) * .08; const pl = cone(body, plate, [0, 3.95 - Math.abs(k - 3) * .08, z], [.42 * s, 1.1 * s], 4); pl.rotation.x = -.15; pl.scale.z = .5; }
  ownMaterials(root);
  return { root, body, head, jaw, mouth, legs, tail };
}

function buildTower(t, i, fac) {
  const g = group(null);
  const concrete = mat('#8f979c'), band = mat('#d97a2e');
  box(g, '#6f777c', [0, .4, 0], [4.2, .8, 4.2]);
  const shaft = group(g);
  box(shaft, concrete, [0, 3.8, 0], [3, 6.2, 3]);
  for (const y of [2, 5.2]) box(shaft, band, [0, y, 0], [3.12, .3, 3.12]);
  for (let k = 0; k < 3; k++) for (const sx of [-1, 1]) box(shaft, '#2c3338', [sx * 1.51, 2.6 + k * 1.3, 0], [.04, .55, .7]);
  const turret = group(shaft, 0, 7.2, 0);
  cyl(turret, '#565d63', [0, 0, 0], [1.4, 1.5, .7], 10);
  const gun = group(turret, 0, .35, 0);
  box(gun, '#383d42', [0, 0, -1.2], [.5, .5, 2.4]);
  const muzzle = new T.Object3D(); muzzle.position.set(0, 0, -2.5); gun.add(muzzle);
  const lamp = new T.Mesh(new T.SphereGeometry(.25, 8, 6), new T.MeshBasicMaterial({ color: 0xff3a2a })); lamp.position.set(0, 1.1, 0); turret.add(lamp);
  const rubble = group(g);
  const rnd = mulberry32(100 + i);
  for (let k = 0; k < 11; k++) { const b = box(rubble, k % 3 ? '#80888c' : '#6a7176', [(rnd() - .5) * 3.6, .2 + rnd() * .35, (rnd() - .5) * 3.6], [.5 + rnd() * 1.1, .3 + rnd() * .5, .5 + rnd() * 1.0]); b.rotation.set((rnd() - .5) * .5, rnd() * 3, (rnd() - .5) * .5); }
  rubble.visible = false;
  ownMaterials(shaft);
  g.position.set(t.x, 0, t.z); g.scale.setScalar(1.2);
  return { g, shaft, turret, gun, muzzle, lamp, rubble, collapse: -1, fireT: 0, recoil: 0 };
}

export function createScene(initial) {
  const scene = new T.Scene();
  scene.background = new T.Color(0xaec8d8); scene.fog = new T.Fog(0xaec8d8, 40, 130);
  const camera = new T.PerspectiveCamera(60, 16 / 9, .3, 260);
  scene.add(camera);
  scene.add(skyDome({ top: '#6f9fc4', mid: '#b9d3e0', bottom: '#ead9bd', radius: 220 }));
  scene.add(new T.HemisphereLight(0xdbeaff, 0x7a6a58, 1.5));
  const sun = new T.DirectionalLight(0xfff0d8, 2.2); sun.position.set(-20, 30, 14); scene.add(sun);
  const fx = new Fx(scene);
  const rig = new PoseFollowCameraRig({ cameraOffset: { forward: -15, up: 9.5, right: 0 }, lookAtOffset: { forward: 9, up: 1, right: 0 }, positionLag: .06, lookLag: .04 });
  const rnd = mulberry32(61);
  const world = group(scene);

  // ---- ground and street
  const road = new T.Mesh(new T.PlaneGeometry(40, 110), texturedMat(noiseTexture({ base: '#555b61', spots: ['#4b5056', '#60666c'], repeat: [4, 14], seed: 3 })));
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0, -20); world.add(road);
  for (let z = 18; z > -50; z -= 4) box(world, new T.MeshBasicMaterial({ color: 0xe8d9a0 }), [0, .03, z], [.3, .02, 2]);
  for (const sx of [-1, 1]) {
    box(world, '#9aa0a2', [sx * 10, .12, -20], [2.2, .24, 110]);
    for (let z = 14; z > -50; z -= 6) box(world, new T.MeshBasicMaterial({ color: 0xf0f0e0 }), [sx * 4.2, .03, z], [.5, .02, 3]);
  }
  // cross streets
  for (const z of [-5, -15, -25, -35]) box(world, '#4d5359', [0, .02, z], [40, .02, 1.5]);
  // ---- city blocks
  const facades = [facadeTexture({ wall: '#2c7a82', lit: ['#ffd27a', '#aaf0ff'], seed: 7, trim: '#e8b36a', litChance: .3 }), facadeTexture({ wall: '#c07a42', lit: ['#ffe7a0'], seed: 8, trim: '#6a3a22', litChance: .3 }), facadeTexture({ wall: '#7f8c92', lit: ['#ffd27a'], seed: 9, trim: '#d9a85a', litChance: .25 })];
  const addBlock = (x, z, hx, hz, h, k) => {
    const f = facades[k % 3];
    const m = new T.MeshLambertMaterial({ map: f.map, emissiveMap: f.emissiveMap, emissive: 0xffffff, emissiveIntensity: .5, flatShading: true });
    f.map.repeat.set(2, Math.max(1, Math.round(h / 6))); f.emissiveMap.repeat.copy(f.map.repeat);
    const b = new T.Mesh(new T.BoxGeometry(hx * 2, h, hz * 2), m); b.position.set(x, h / 2, z); world.add(b);
    box(world, '#40454b', [x, h + .25, z], [hx * 2 + .3, .5, hz * 2 + .3]);
    if (k % 2) box(world, '#5a6066', [x + hx * .3, h + 1, z], [hx, 1.2, hz * .8]);
  };
  BLOCKS.forEach((b, k) => addBlock(b.x, b.z, b.hx, b.hz, b.h, k));
  // extra background skyline beyond the playable avenue
  for (let k = 0; k < 16; k++) { const sx = k % 2 ? 1 : -1; addBlock(sx * (19 + rnd() * 16), 18 - Math.floor(k / 2) * 5.5 - rnd() * 2, 2.2 + rnd() * 1.8, 2 + rnd() * 2, 7 + rnd() * 16, k + 1); }
  // harbour at the far end
  const sea = new T.Mesh(new T.PlaneGeometry(260, 80), new T.MeshBasicMaterial({ color: 0x3b7e9a })); sea.rotation.x = -Math.PI / 2; sea.position.set(0, -.1, -95); world.add(sea);
  box(world, '#6a7076', [0, .1, -48], [60, .3, 1.5]);
  for (const [x, h] of [[-18, 18], [-8, 15], [14, 20], [24, 16]]) { box(world, '#d9a22e', [x, h / 2, -52], [.7, h, .7]); box(world, '#d9a22e', [x + 4, h, -52], [10, .5, .5]); }
  box(world, '#a43a2a', [-6, 1.2, -62], [14, 2.4, 4]); box(world, '#e8e0d0', [-6, 3.2, -62], [8, 2, 3]);
  box(world, '#335a78', [20, 1, -70], [18, 2, 5]);

  // ---- towers
  const towers = initial.towers.map((t, i) => { const tw = buildTower(t, i); world.add(tw.g); return tw; });
  // ---- the colossus
  const mon = buildColossus(); scene.add(mon.root);
  const flameLight = new LiteLight(FIRE, 0, 22, 1.4); scene.add(flameLight);
  const drain = createDrain();
  const bolts = new Map();
  let lastRound = -1, walkT = 0, jawOpen = 0, stompAnim = 0, shake = 0, shakeA = 0, vt = 0, lostT = 0, hitFlash = 0, cdir = 0;
  const camAnchor = new T.Vector3();
  const tmp = new T.Vector3();

  function handle(ev, s) {
    const P = v3(ev.x ?? 0, ev.y ?? 0, ev.z ?? 0);
    switch (ev.type) {
      case 'defense.fired': {
        const tw = towers[ev.tower]; if (!tw) break;
        tw.recoil = 1;
        const m = tw.muzzle.getWorldPosition(v3(0, 0, 0));
        fx.flash(m, { color: 0xffd9a0, size: 3, life: .12, spin: 1 });
        fx.burst(m, { n: 10, color: 0xffb04a, speed: 7, size: .22, life: .35, gravity: 3 });
        fx.smoke(m, { n: 3, color: 0x6a6a6a, size: 1.1, life: 1, rise: .8, spread: .5, opacity: .5 });
        fx.light(m, { color: 0xffa23a, intensity: 40, life: .12, distance: 12 });
        break;
      }
      case 'projectile.impact': {
        if (ev.type && ev.surface === 'enemy') break;
        fx.flash(P, { color: 0xffd9a0, size: 4, life: .16, spin: 1 });
        fx.ring(v3(P.x, .2, P.z), { color: 0xffb04a, r0: .4, r1: 3.6, life: .4 });
        fx.burst(P, { n: 22, color: FIRE, speed: 7, size: .24, life: .6, gravity: 8 });
        fx.chips(P, { n: 6, color: [0x555b61, 0x40454b], speed: 5, size: .25, life: 1.2 });
        fx.smoke(P, { n: 3, color: 0x777777, size: 1.4, life: 1.3, rise: 1, spread: .8, opacity: .5 });
        fx.light(P, { color: 0xff9a3a, intensity: 50, life: .22, distance: 14 });
        const pl = s.player, d = Math.hypot(P.x - pl.x, P.z - pl.z);
        if (d < 4) { shake = Math.max(shake, .35); shakeA = 1.2; hitFlash = 1; }
        break;
      }
      case 'building.hit':
        fx.burst(P.clone().setY(4), { n: 12, color: [0xffb04a][0], speed: 5, size: .2, life: .5, gravity: 6 });
        if (ev.by === 'stomp') fx.chips(P.clone().setY(1), { n: 10, color: [0x8f979c, 0x6f777c], speed: 5, size: .3, life: 1.4 });
        break;
      case 'building.collapsed': {
        const tw = towers[ev.tower]; if (tw) tw.collapse = 0.001;
        fx.flash(v3(ev.x, 3, ev.z), { color: 0xffe0a0, size: 9, life: .3, spin: 1 });
        fx.ring(v3(ev.x, .2, ev.z), { color: 0xd9c8a8, r0: 1, r1: 9, life: .7, opacity: .7 });
        fx.chips(v3(ev.x, 4, ev.z), { n: 26, color: [0x8f979c, 0x6f777c, 0xd97a2e], speed: 8, size: .5, life: 2 });
        fx.smoke(v3(ev.x, 1, ev.z), { n: 14, color: 0x9a9690, size: 3.2, life: 2.6, rise: 1.4, spread: 3, opacity: .65 });
        fx.light(v3(ev.x, 3, ev.z), { color: 0xffa23a, intensity: 80, life: .5, distance: 24 });
        shake = Math.max(shake, .6); shakeA = 2;
        break;
      }
      case 'ground.stomped':
        stompAnim = 1; shake = .6; shakeA = 2.4;
        fx.ring(v3(P.x, .15, P.z), { color: 0xe8d8b0, r0: 1, r1: 9, life: .6, opacity: .9 });
        fx.ring(v3(P.x, .2, P.z), { color: 0xffffff, r0: .6, r1: 5.5, life: .4, opacity: .6 });
        fx.smoke(v3(P.x, .3, P.z), { n: 10, color: 0xb8aa92, size: 2.2, life: 1.6, rise: .6, spread: 3.2, opacity: .6 });
        fx.chips(v3(P.x, .5, P.z), { n: 18, color: [0x555b61, 0x777c80], speed: 7, size: .28, life: 1.4 });
        break;
      case 'flame.breathed': break;
      case 'player.hit': hitFlash = 1; shake = Math.max(shake, .35); shakeA = 1.1; break;
      case 'round.lost': lostT = .001; break;
      default:
    }
  }

  function syncTowers(s, dt) {
    towers.forEach((tw, i) => {
      const t = s.towers[i];
      if (tw.collapse >= 0 && t.hp <= 0) {
        tw.collapse = Math.min(1.2, tw.collapse + dt);
        const c = Math.min(1, tw.collapse / .8);
        tw.shaft.scale.y = Math.max(.05, 1 - smooth(c) * .95); tw.shaft.rotation.z = Math.sin(i * 2.1) * .35 * c; tw.shaft.position.y = -c * .4;
        tw.shaft.visible = tw.collapse < .85; tw.rubble.visible = tw.collapse > .5;
        return;
      }
      if (t.hp > 0) { tw.shaft.visible = true; tw.rubble.visible = false; tw.shaft.scale.y = 1; tw.shaft.rotation.z = 0; tw.shaft.position.y = 0; }
      // turret tracks the monster
      const p = s.player, a = Math.atan2(p.x - t.x, p.z - t.z) + Math.PI;
      tw.turret.rotation.y = a - Math.PI + Math.PI; tw.turret.rotation.y = Math.atan2(-(p.x - t.x), -(p.z - t.z));
      tw.recoil = Math.max(0, tw.recoil - dt * 4);
      tw.gun.position.z = tw.recoil * .5;
      tw.lamp.material.color.setHex(Math.sin(vt * 6 + i) > 0 ? 0xff3a2a : 0x701810);
      const burning = t.hp > 0 && t.hp < 75;
      const heat = clamp(1 - t.hp / 100, 0, 1);
      setEmissive(tw.shaft, 0x502008, heat * .9);
      if (burning && Math.random() < .12) {
        const q = v3(t.x + (Math.random() - .5) * 2, 3 + Math.random() * 4, t.z + (Math.random() - .5) * 2);
        fx.spark(q, v3(0, 2.2, 0), { color: Math.random() < .5 ? FIRE : HOT, size: .5, life: .7, gravity: -2, grow: 1 });
        if (Math.random() < .35) fx.smoke(q, { n: 1, color: 0x3c3c3c, size: 1.1, life: 1.6, rise: 1.6, spread: .3, opacity: .5 });
      }
    });
  }

  function syncShells(s, dt) {
    const live = new Set();
    for (const p of s.projectiles) {
      live.add(p.id);
      let b = bolts.get(p.id);
      if (!b) { b = createBolt(scene, fx, { color: 0xff8a22, core: 0xfff0c0, size: .32, length: 1.4, trail: .4 }); bolts.set(p.id, b); }
      b.position.set(p.x, p.y, p.z); b.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz);
      b.userData.trail.push(b.position.clone().add(v3(0, .35, 0)), b.position.clone().add(v3(0, -.35, 0)));
      if (Math.random() < .15) fx.smoke(b.position, { n: 1, color: 0x666666, size: .5, life: .6, rise: .1, spread: .05, opacity: .35 });
    }
    for (const [id, b] of bolts) if (!live.has(id)) { scene.remove(b); scene.remove(b.userData.trail.mesh); bolts.delete(id); }
    for (const b of bolts.values()) b.userData.trail.update(dt);
  }

  function sync(s, dt) {
    const evs = pending;
    if (s.roundId !== lastRound) {
      if (lastRound !== -1) { fx.clear(); for (const b of bolts.values()) { scene.remove(b); scene.remove(b.userData.trail.mesh); } bolts.clear(); towers.forEach((tw) => { tw.collapse = -1; }); lostT = 0; shake = 0; }
      lastRound = s.roundId;
    }
    vt += dt;
    fx.update(dt);
    for (const ev of evs) handle(ev, s);
    pending = [];
    const p = s.player;
    mon.root.position.set(p.x, 0, p.z); mon.root.rotation.y = -p.yaw;
    const moving = p.moving && s.state === 'RUNNING';
    walkT += dt * (moving ? 5 : 1.2);
    stompAnim = Math.max(0, stompAnim - dt * 3);
    mon.legs.forEach((l) => {
      const phase = Math.sin(walkT + (l.i === 0 || l.i === 3 ? 0 : Math.PI)) * (moving ? .6 : .03);
      l.hip.rotation.x = phase;
      l.foot.position.y = -1.65 + Math.max(0, phase) * .3;
      if (s.stompT >= 0 && l.i < 2) { const k = Math.sin(clamp(s.stompT / .6, 0, 1) * Math.PI); l.hip.rotation.x = -k * 1.0; }
    });
    mon.tail.forEach((t, k) => { t.rotation.y = Math.sin(walkT * .8 - k * .6) * (moving ? .22 : .1); t.rotation.x = Math.sin(walkT * .5 - k * .4) * .04; });
    mon.body.position.y = Math.abs(Math.sin(walkT)) * (moving ? .12 : .02) + (s.stompT >= 0 ? Math.sin(clamp(s.stompT / .6, 0, 1) * Math.PI) * .5 : 0);
    jawOpen += ((s.breathing ? 1 : 0) - jawOpen) * Math.min(1, dt * 10);
    mon.jaw.rotation.x = jawOpen * .55; mon.head.rotation.x = -jawOpen * .1;
    // flame jet
    flameLight.intensity = 0;
    if (s.breathing && s.state === 'RUNNING') {
      mon.root.updateMatrixWorld(true);
      const m = mon.mouth.getWorldPosition(v3(0, 0, 0));
      const dir = v3(Math.sin(p.yaw), -.04, -Math.cos(p.yaw));
      fx.jet(m, dir, { color: FIRE, core: HOT, n: 5, speed: 17, size: 1.5, life: .55, spread: .16 });
      fx.jet(m, dir, { color: 0xff5a1a, core: FIRE, n: 2, speed: 12, size: 2.1, life: .6, spread: .22 });
      flameLight.position.copy(m).addScaledVector(dir, 4).add(v3(0, .5, 0));
      flameLight.intensity = 90 * (.8 + .2 * Math.sin(vt * 40));
      // scorch sparks where flames meet towers
      s.towers.forEach((t) => {
        if (t.hp <= 0) return;
        const d = Math.hypot(t.x - p.x, t.z - p.z) - t.radius, err = Math.abs(Math.atan2(t.x - p.x, p.z - t.z) - p.yaw);
        if (d < FLAME.range && err < .5 && Math.random() < .5) fx.spark(v3(t.x + (Math.random() - .5) * 2, 1 + Math.random() * 5, t.z + (Math.random() - .5) * 2), v3(0, 2, 0), { color: HOT, size: .5, life: .5, grow: 1 });
      });
    }
    syncTowers(s, dt); syncShells(s, dt);
    // camera
    const fwd = v3(Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    rig.step({ targetPosition: v3(p.x, 0, p.z), targetFrame: { forward: fwd, up: v3(0, 1, 0), right: v3(Math.cos(p.yaw), 0, Math.sin(p.yaw)) }, deltaSeconds: dt || 1 / 60, snapToTarget: dt === 0, camera });
    shake = Math.max(0, shake - dt);
    if (shake > 0) { const a = shakeA * (shake / .6); camera.position.x += Math.sin(vt * 90) * a * .12; camera.position.y += Math.cos(vt * 73) * a * .12; camera.rotateZ(Math.sin(vt * 55) * a * .01); }
    if (lostT > 0) { lostT += dt; camera.position.y += Math.min(5, lostT * 2); camera.rotateX(-Math.min(.3, lostT * .1)); }
    camera.updateMatrixWorld();
    setEmissive(mon.root, hitFlash > 0 ? 0x80301a : 0, hitFlash);
    hitFlash = Math.max(0, hitFlash - dt * 6);
  }
  let pending = [];
  sync(initial, 0);
  return { scene, camera, sync: (s, dt, evs = []) => { pending = evs; sync(s, dt); }, pendingEvents: (s) => drain(s, () => {}) };
}
