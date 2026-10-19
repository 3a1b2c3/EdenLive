// SPDX-License-Identifier: Apache-2.0
import * as T from 'three';
import { box, ball, cyl, cone, rod, group, mat, noiseTexture, texturedMat, skyDome, mulberry32, clamp, smooth, ownMaterials, setEmissive, createDrain , LiteLight } from '../_shared/kit.mjs';
import { Fx } from '../_shared/fx.mjs';
import { v3 } from '../_shared/fpsview.mjs';
import { W, H } from './game.mjs';

function buildWorker() {
  const root = group(null), body = group(root);
  const legs = [-1, 1].map((sx) => { const h = group(body, sx * .13, .5, 0); box(h, '#2f4a7a', [0, -.23, 0], [.16, .48, .18]); box(h, '#2a2220', [0, -.5, .04], [.18, .08, .26]); return h; });
  const torso = group(body, 0, .5, 0);
  box(torso, '#3a3f4a', [0, .3, 0], [.4, .5, .26]);
  box(torso, '#ffb02a', [0, .32, .01], [.42, .4, .28]);
  box(torso, '#e8e8e0', [0, .32, .15], [.42, .06, .02]);
  const head = group(torso, 0, .68, 0);
  ball(head, '#d6a583', [0, 0, 0], [.14, .15, .14], 1);
  ball(head, '#f2d23a', [0, .08, 0], [.17, .1, .17], 1);
  box(head, '#f2d23a', [0, .03, .14], [.22, .03, .1]);
  const arms = [-1, 1].map((sx) => { const a = group(torso, sx * .27, .52, 0); box(a, '#ffb02a', [0, -.17, 0], [.1, .36, .12]); box(a, '#d6a583', [0, -.38, 0], [.09, .08, .1]); return a; });
  ownMaterials(root);
  return { root, body, legs, arms, torso };
}

export function createScene(initial) {
  const scene = new T.Scene();
  scene.background = new T.Color(0x2a3140); scene.fog = new T.Fog(0x2a3140, 40, 90);
  const camera = new T.PerspectiveCamera(32, 16 / 9, .5, 120);
  const cx = (W - 1) / 2, cz = (H - 1) / 2;
  camera.position.set(cx + 4.9, 11.2, cz + 9.3); camera.lookAt(cx, 0, cz + .4);
  scene.add(camera);
  scene.add(skyDome({ top: '#1d2433', mid: '#37425a', bottom: '#59627a', radius: 100 }));
  scene.add(new T.HemisphereLight(0xdfe8ff, 0x6a6258, 1.5));
  const key = new T.DirectionalLight(0xfff0d8, 2.4); key.position.set(-6, 14, 8); scene.add(key);
  const fx = new Fx(scene, { lights: 3 });
  const rnd = mulberry32(88);
  const world = group(scene);

  // ---- warehouse shell: the board sits in a larger, busy floor so it fills the frame without a void
  const concrete = texturedMat(noiseTexture({ base: '#6c7176', spots: ['#62676c', '#777c82', '#585d62'], repeat: [10, 8], seed: 5, lines: { color: '#4a4f54', count: 2, width: 2 } }));
  const floor = new T.Mesh(new T.PlaneGeometry(46, 36), concrete); floor.rotation.x = -Math.PI / 2; floor.position.set(cx, -.34, cz); world.add(floor);
  const wallMat = texturedMat(noiseTexture({ base: '#7a6a58', spots: ['#6c5c4c', '#88775f'], repeat: [8, 2], seed: 6 }));
  const back = new T.Mesh(new T.BoxGeometry(46, 12, .6), wallMat); back.position.set(cx, 5.7, cz - 10.5); world.add(back);
  const left = new T.Mesh(new T.BoxGeometry(.6, 12, 30), wallMat); left.position.set(cx - 14, 5.7, cz); world.add(left);
  for (let x = cx - 12; x <= cx + 14; x += 4) { box(world, '#4a4038', [x, 5.7, cz - 10.1], [.5, 12, .5]); }
  box(world, '#c4452e', [cx + 1, 3, cz - 10.15], [6, 5.6, .15]); for (let k = 0; k < 8; k++) box(world, '#a43a28', [cx + 1, .6 + k * .7, cz - 10.05], [6, .05, .05]);
  // shelving, pallets, barrels and floor markings around the board
  const shelf = (x, z, ry = 0) => {
    const g = group(world, x, 0, z); g.rotation.y = ry;
    for (const sx of [-1.6, 1.6]) for (const sz of [-.5, .5]) box(g, '#3a5a8a', [sx, 1.6, sz], [.12, 3.4, .12]);
    for (let k = 0; k < 4; k++) { box(g, '#c4772e', [0, .3 + k * .9, 0], [3.4, .1, 1.2]); if (k < 3) for (let j = 0; j < 3; j++) box(g, ['#a8773f', '#8a6a3a', '#b9884a'][(j + k) % 3], [-1.1 + j * 1.1, .7 + k * .9, 0], [.9, .6, .9]); }
  };
  shelf(cx - 10.5, cz - 7.5); shelf(cx - 5.5, cz - 8); shelf(cx + 5.5, cz - 8); shelf(cx + 10.8, cz - 7);
  shelf(cx - 12.2, cz - 1, Math.PI / 2); shelf(cx - 12.2, cz + 4, Math.PI / 2);
  for (const [x, z] of [[cx + 8.5, cz - 2], [cx + 10, cz + 1], [cx + 9, cz + 4.5], [cx - 8.8, cz + 7.5], [cx + 7, cz + 8.5]]) {
    box(world, '#9a7a4a', [x, -.18, z], [1.8, .2, 1.8]);
    for (let k = 0; k < 2; k++) box(world, ['#a8773f', '#b9884a'][k], [x, .3 + k * .6, z], [1.5, .6, 1.5]);
  }
  for (const [x, z] of [[cx + 7.6, cz + 6.5], [cx + 8.4, cz + 7.2], [cx - 7.5, cz - 4]]) { cyl(world, '#2f6aa8', [x, .35, z], [.42, .42, 1.1], 10); cyl(world, '#1f4a7a', [x, .35, z], [.44, .44, .08], 10); }
  for (let k = 0; k < 14; k++) box(world, new T.MeshBasicMaterial({ color: 0xf2c640 }), [cx - 10 + k * 1.8, -.33, cz + 9.4], [.9, .02, .22]);
  for (const [x, z] of [[cx - 4, cz - 6], [cx + 4, cz - 6], [cx - 4, cz + 8], [cx + 4, cz + 8]]) {
    if (z < cz) { box(world, '#2a2e36', [x, 9, z], [.3, .3, 6]); box(world, new T.MeshBasicMaterial({ color: 0xfff0d0 }), [x, 8.8, z], [.5, .1, 3]); }
    const l = new LiteLight(0xffe6c0, 16, 26, 1.4); l.position.set(x, 8, z); scene.add(l);
  }

  // ---- board: floor tiles, walls, goal pads
  const tiles = group(world);
  const tileA = mat('#56666a'), tileB = mat('#607276');
  for (let x = 0; x < W; x++) for (let z = 0; z < H; z++) box(tiles, (x + z) % 2 ? tileA : tileB, [x, -.14, z], [.98, .28, .98]);
  const wallMats = [mat('#8d9ca0'), mat('#7f8e92')];
  for (const w of initial.walls) {
    const m = box(world, wallMats[(w.x + w.z) % 2], [w.x, .5, w.z], [.98, 1.0, .98]);
    box(world, '#a8b6ba', [w.x, 1.02, w.z], [1.0, .06, 1.0]);
    if ((w.x * 7 + w.z * 3) % 5 === 0) box(world, '#e0b43a', [w.x, .5, w.z + .5], [.98, .12, .02]);
    void m;
  }
  const pads = initial.goals.map((g) => {
    const p = group(world, g.x, 0, g.z);
    box(p, '#d9ac4a', [0, .02, 0], [.86, .05, .86]); box(p, '#3f6f68', [0, .05, 0], [.58, .03, .58]);
    const glow = new T.Mesh(new T.PlaneGeometry(1.1, 1.1), new T.MeshBasicMaterial({ color: 0xffd070, transparent: true, opacity: .35, blending: T.AdditiveBlending, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = .08; p.add(glow);
    return { p, glow };
  });
  const crateMat = mat('#b97a3e'), crateOn = mat('#5fbf8a'), dark = mat('#503b28');
  const crates = initial.boxes.map((b) => {
    const g = group(world, b.x, 0, b.z);
    const body = box(g, crateMat, [0, .4, 0], [.8, .8, .8]);
    for (const z of [-.41, .41]) { box(g, dark, [0, .2, z], [.84, .1, .03]); box(g, dark, [0, .6, z], [.84, .1, .03]); }
    for (const x of [-.41, .41]) { box(g, dark, [x, .2, 0], [.03, .1, .84]); box(g, dark, [x, .6, 0], [.03, .1, .84]); }
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) box(g, dark, [sx * .38, .4, sz * .38], [.07, .82, .07]);
    box(g, '#d9ac4a', [0, .81, 0], [.5, .02, .5]);
    return { g, body, vx: b.x, vz: b.z, on: false };
  });
  const worker = buildWorker(); scene.add(worker.root);
  const drain = createDrain();
  let wx = initial.player.x, wz = initial.player.z, wyaw = initial.player.yaw, hop = 0, walkT = 0, bump = null, lastRound = -1, vt = 0, shake = 0, redT = 0, lastMoveT = -9;

  function handle(ev, s) {
    switch (ev.type) {
      case 'player.moved': hop = 1; lastMoveT = vt; fx.smoke(v3(ev.fromX, .05, ev.fromZ), { n: 1, color: 0xb0aca0, size: .35, life: .5, rise: .15, spread: .15, opacity: .3 }); break;
      case 'box.pushed': {
        const P = v3(ev.x - ev.dx * .5, .15, ev.z - ev.dz * .5);
        fx.smoke(P, { n: 3, color: 0xc8c0b0, size: .5, life: .7, rise: .25, spread: .3, opacity: .45 });
        fx.burst(P, { n: 8, color: 0xffd9a0, speed: 2.5, size: .06, life: .3, gravity: 5 });
        if (ev.onGoal) {
          const G = v3(ev.x, .1, ev.z);
          fx.ring(G, { color: 0x7dffb0, r0: .2, r1: 1.5, life: .55 }); fx.flash(v3(ev.x, .8, ev.z), { color: 0xbfffd8, size: 2, life: .2, spin: 1 });
          fx.burst(v3(ev.x, .5, ev.z), { n: 26, color: 0x9dffc0, speed: 4, size: .09, life: .8, gravity: -1 });
          fx.light(v3(ev.x, 1.2, ev.z), { color: 0x7dffb0, intensity: 18, life: .35, distance: 7 });
        }
        break;
      }
      case 'move.blocked': bump = { t: 0, dx: ev.dx, dz: ev.dz }; fx.burst(v3(ev.x - ev.dx * .45, .5, ev.z - ev.dz * .45), { n: 6, color: 0xff7a4a, speed: 2.5, size: .07, life: .25, gravity: 3 }); shake = .1; break;
      case 'round.won': for (const c of crates) fx.burst(v3(c.vx, 1, c.vz), { n: 24, color: 0xffe08a, speed: 6, size: .1, life: 1, gravity: 3 }); break;
      case 'round.lost': redT = 1; break;
      default:
    }
  }
  function sync(s, dt, evs = []) {
    if (s.roundId !== lastRound) {
      if (lastRound !== -1) { fx.clear(); wx = s.player.x; wz = s.player.z; crates.forEach((c, i) => { c.vx = s.boxes[i].x; c.vz = s.boxes[i].z; }); redT = 0; bump = null; }
      lastRound = s.roundId;
    }
    vt += dt; fx.update(dt);
    for (const ev of evs) handle(ev, s);
    const k = 1 - Math.exp(-dt * 16);
    const dx0 = s.player.x - wx, dz0 = s.player.z - wz;
    wx += dx0 * k; wz += dz0 * k;
    const moving = Math.hypot(dx0, dz0) > .05;
    walkT += dt * (moving ? 16 : 0);
    let ox = 0, oz = 0;
    if (bump) { bump.t += dt * 7; const b = Math.sin(Math.min(1, bump.t) * Math.PI) * .18; ox = bump.dx * b; oz = bump.dz * b; if (bump.t >= 1) bump = null; }
    hop = Math.max(0, hop - dt * 5);
    worker.root.position.set(wx + ox, Math.sin((1 - hop) * Math.PI) * hop * .12, wz + oz);
    let dyaw = s.player.yaw - wyaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw)); wyaw += dyaw * Math.min(1, dt * 18);
    worker.root.rotation.y = wyaw;
    worker.legs[0].rotation.x = Math.sin(walkT) * .7; worker.legs[1].rotation.x = -Math.sin(walkT) * .7;
    worker.arms[0].rotation.x = -Math.sin(walkT) * .6; worker.arms[1].rotation.x = Math.sin(walkT) * .6;
    const pushing = vt - lastMoveT < .2 && s.pushes > 0;
    worker.torso.rotation.x = moving && pushing ? .18 : 0;
    crates.forEach((c, i) => {
      const b = s.boxes[i], on = s.goals.some((g) => g.x === b.x && g.z === b.z);
      c.vx += (b.x - c.vx) * k; c.vz += (b.z - c.vz) * k;
      c.g.position.set(c.vx, 0, c.vz);
      c.body.material = on ? crateOn : crateMat;
      c.on = on;
      c.g.position.y = on ? Math.abs(Math.sin(vt * 3)) * .02 : 0;
    });
    pads.forEach((p, i) => { const g = s.goals[i]; const filled = s.boxes.some((b) => b.x === g.x && b.z === g.z); p.glow.material.opacity = filled ? .15 : .3 + .2 * Math.sin(vt * 3 + i); p.glow.material.color.setHex(filled ? 0x7dffb0 : 0xffd070); });
    shake = Math.max(0, shake - dt);
    camera.position.set(cx + 4.9 + (shake > 0 ? Math.sin(vt * 90) * .04 : 0), 11.2, cz + 9.3);
    camera.lookAt(cx, 0, cz + .4);
    if (s.state === 'LOST') { const idx = crates.findIndex((c) => !c.on); if (idx >= 0 && Math.random() < .3) fx.spark(v3(crates[idx].vx, 1, crates[idx].vz), v3(0, 2, 0), { color: 0xff5a3a, size: .15, life: .6, gravity: 2 }); }
  }
  sync(initial, 0, []);
  return { scene, camera, sync, pendingEvents: (s) => drain(s, () => {}) };
}
