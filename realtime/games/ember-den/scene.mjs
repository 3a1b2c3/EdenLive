// SPDX-License-Identifier: Apache-2.0
import * as T from 'three';
import { box, ball, cyl, cone, rod, setRod, group, mat, metal, basic, glowMat, tunnelGeometry, noiseTexture, texturedMat, mulberry32, clamp, smooth, ownMaterials, setEmissive , LiteLight } from './lib/kit.mjs';
import { Trail } from './lib/fx.mjs';
import { createFpsStage, v3 } from './lib/fpsview.mjs';
import { ARENA, ROCKS, SWING } from './game.mjs';

const ICHOR = 0x9fe03c;

function buildSpider(i) {
  const root = group(null), body = group(root);
  root.scale.setScalar(1.12);
  const hide = i % 2 ? '#7a4e36' : '#6b4b30';
  ball(body, hide, [0, .08, .45], [.66, .44, .78]);
  ball(body, '#4a392f', [0, .03, -.35], [.43, .32, .49]);
  ball(body, '#4f392c', [0, .04, -.76], [.34, .27, .24]);
  for (const s of [-1, 1]) ball(body, '#b07c43', [s * .35, .35, .44], [.12, .055, .28], 0);
  const eyeMat = new T.MeshBasicMaterial({ color: 0xffb34d });
  const eyes = [];
  for (let j = 0; j < 6; j++) { const a = (j - 2.5) * .085; eyes.push(ball(body, eyeMat, [a, .13 + Math.abs(a) * .2, -.972], [.05, .047, .037], 1)); }
  for (const s of [-1, 1]) { const f = cone(body, '#d3d9b6', [s * .14, -.16, -.89], [.07, .3], 5); f.rotation.x = -.55; }
  const legs = [];
  for (const side of [-1, 1]) for (let j = 0; j < 4; j++) {
    const k = Math.sin((j / 3) * Math.PI);
    const hip = [side * .28, 0, -.65 + j * .36], knee = [side * (.91 + k * .28), .42, -1.03 + j * .66], foot = [side * (1.38 + k * .3), -.5, -1.45 + j * .93];
    const upper = rod(body, '#5a4535', hip, knee, .075), lower = rod(body, '#4a392c', knee, foot, .05);
    const joint = ball(body, '#9a7a4a', knee, [.1, .1, .1], 0);
    legs.push({ side, j, hip, knee, foot, upper, lower, joint });
  }
  ownMaterials(root);
  return { root, body, legs, eyeMat };
}

export function createScene(initial) {
  const stage = createFpsStage({ background: 0x0c1520, fog: [14, 46], hemi: [0xc8b090, 0x9a6a46, 3.0], fov: 74 });
  const { scene, camera, fx, hand } = stage;
  const warm = new T.DirectionalLight(0xffb070, 1.6); warm.position.set(-3, 6, 8); scene.add(warm);
  const rnd = mulberry32(5);
  const world = group(scene);

  // ---- cave shell, floor and set dressing
  const wall = mat('#4b5d6c', { side: T.DoubleSide });
  const shell = new T.Mesh(tunnelGeometry({ z0: 14, z1: -40, rings: 28, sides: 16, rx: 6.6, ry: 6.4, floor: -.1, noise: .45, seed: 3 }), wall);
  world.add(shell);
  const floorTex = noiseTexture({ base: '#4e5057', spots: ['#3f4349', '#5d6068', '#46423f'], repeat: [5, 18], seed: 9 });
  const floor = new T.Mesh(new T.PlaneGeometry(13.5, 58), texturedMat(floorTex));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -14);
  world.add(floor);
  box(world, '#2c3744', [0, 3, -40.5], [14, 8, 1]);
  for (const r of ROCKS) {
    const m = ball(world, rnd() > .5 ? '#55697a' : '#46596a', [r.x, r.h * .5, r.z], [r.hx * 1.25, r.h * .75, r.hz * 1.25], 0);
    m.rotation.set(rnd(), rnd() * 6, rnd());
  }
  for (let j = 0; j < 24; j++) {
    const z = 12 - j * 2.1, side = j % 2 ? 1 : -1;
    ball(world, j % 3 ? '#42576a' : '#566b78', [side * (5.7 + rnd() * .5), 1.2 + rnd() * 1.4, z], [1.4 + rnd() * .8, 2 + rnd() * 1.2, 1.5 + rnd()], 0).rotation.set(rnd() * 3, rnd() * 6, rnd() * 3);
    const st = cone(world, '#53697a', [side * (3.2 + rnd() * 2.6), 5.6 - rnd() * .8, z + rnd()], [.32 + rnd() * .3, 1.5 + rnd() * 1.8], 5);
    st.rotation.z = Math.PI;
  }
  for (let j = 0; j < 18; j++) {
    const side = j % 2 ? 1 : -1, z = 8 - j * 2.3;
    const c = cone(world, '#4a5f70', [side * (4.4 + rnd() * 1.1), .5, z], [.28 + rnd() * .2, .9 + rnd() * .8], 5);
    c.rotation.z = side * (.1 + rnd() * .25);
  }
  // Glowing teal crystals give the warm fire a cool counterpoint.
  const crystalMat = new T.MeshBasicMaterial({ color: 0x5fe8d6 });
  for (const [x, z] of [[-5, 4], [5.1, -2], [-5.2, -13], [5.2, -19], [-5, -27], [5, -33], [0, -39]]) {
    const g = group(world, x, 0, z);
    for (let k = 0; k < 4; k++) {
      const c = cone(g, crystalMat, [(rnd() - .5) * .7, .4 + rnd() * .3, (rnd() - .5) * .7], [.14 + rnd() * .1, .8 + rnd() * .8], 5);
      c.rotation.set((rnd() - .5) * .8, 0, (rnd() - .5) * .8);
    }
    const l = new LiteLight(0x4ad8c8, 5, 8, 1.6); l.position.set(0, 1, 0); g.add(l);
  }
  // Bones near the walls hint at previous victims.
  for (const [x, z] of [[-4.6, -3], [4.5, -9], [-4.4, -18], [4.6, -24], [-4.2, 6]]) {
    for (let k = 0; k < 5; k++) { const b = rod(world, '#cfc7ad', [x + k * .12, .06, z + (k % 3) * .2], [x + k * .12 + .5, .1, z + (k % 3) * .2 + .35 * (k % 2 ? 1 : -1)], .045); void b; }
    ball(world, '#d8d0b4', [x, .16, z - .3], [.17, .15, .18], 1);
  }

  // ---- braziers with flicker
  const flames = [];
  [[-3.3, 5], [3.3, -3], [-3.4, -14], [3.4, -24], [-3.3, -32]].forEach(([x, z], i) => {
    const g = group(world, x, 0, z);
    cyl(g, '#2d2a2c', [0, .62, 0], [.1, .16, 1.2], 6);
    cyl(g, '#3c3836', [0, 1.32, 0], [.52, .32, .36], 8);
    cyl(g, '#a3501f', [0, 1.47, 0], [.4, .4, .06], 8);
    const outer = cone(g, new T.MeshBasicMaterial({ color: 0xff8a26 }), [0, 1.9, 0], [.36, 1.0], 6);
    const inner = cone(g, new T.MeshBasicMaterial({ color: 0xffe18a }), [0, 1.78, 0], [.2, .65], 6);
    const light = new LiteLight(0xffa24a, 30, 16, 1.7); light.position.set(0, 2, 0); g.add(light);
    flames.push({ outer, inner, light, i });
  });

  // ---- spiders
  const spiders = initial.enemies.map((e, i) => { const sp = buildSpider(i); scene.add(sp.root); return { ...sp, vis: { dead: 0, flinch: 0, rear: 0, walkT: i * 2 } }; });

  // ---- axe viewmodel
  const axe = group(hand);
  rod(axe, '#7a5233', [.02, -1.05, 0], [0, .3, 0], .044);
  for (let k = 0; k < 6; k++) cyl(axe, '#3d3028', [.012, -.7 + k * .075, 0], [.05, .05, .03], 8);
  box(axe, '#6c7d89', [0, .27, 0], [.13, .36, .16]);
  box(axe, '#8b7a52', [.0, .1, 0], [.17, .08, .14]);
  const bladeShape = new T.Shape();
  bladeShape.moveTo(-.02, .43); bladeShape.lineTo(-.28, .5); bladeShape.lineTo(-.52, .42); bladeShape.lineTo(-.6, .22); bladeShape.lineTo(-.48, -.08); bladeShape.lineTo(-.28, -.02); bladeShape.lineTo(-.02, .1); bladeShape.closePath();
  const blade = new T.Mesh(new T.ExtrudeGeometry(bladeShape, { depth: .07, bevelEnabled: false }), mat('#a9bccb'));
  blade.position.z = -.035; axe.add(blade);
  const edge = new T.Mesh(new T.ShapeGeometry((() => { const s = new T.Shape(); s.moveTo(-.52, .42); s.lineTo(-.6, .22); s.lineTo(-.48, -.08); s.lineTo(-.43, -.02); s.lineTo(-.52, .22); s.lineTo(-.47, .38); s.closePath(); return s; })()), new T.MeshBasicMaterial({ color: 0xf4fbff, side: T.DoubleSide }));
  edge.position.z = .037; axe.add(edge);
  stage.handBase.set(.5, -.52, -.95); hand.scale.setScalar(.85);
  const trail = new Trail(scene, { n: 14, color: 0x9fd8ff, opacity: .42, life: .22 });
  const flare = stage.flare(axe, { color: 0xffe9b0, size: .6 });
  flare.sprite.position.set(-.55, .2, .05);

  const KEY = [
    // t, rotation (x,y,z), position (x,y,z) of the axe group in hand space
    [0, [-.12, .12, -.32], [0, 0, 0]],
    [SWING.wind, [.4, .35, -1.0], [.14, .12, .1]],
    [SWING.wind + SWING.strike, [-.85, -.55, .95], [-.46, -.06, -.28]],
    [SWING.wind + SWING.strike + SWING.recover, [-.12, .12, -.32], [0, 0, 0]],
  ];
  function poseAxe(t, idle) {
    let rot = KEY[0][1], pos = KEY[0][2];
    if (t >= 0) {
      let i = 0; while (i < KEY.length - 2 && t > KEY[i + 1][0]) i++;
      const a = KEY[i], b = KEY[i + 1], f = clamp((t - a[0]) / (b[0] - a[0]), 0, 1), u = i === 1 ? f * f : smooth(f);
      rot = a[1].map((n, j) => n + (b[1][j] - n) * u); pos = a[2].map((n, j) => n + (b[2][j] - n) * u);
    }
    axe.rotation.set(rot[0], rot[1], rot[2] + Math.sin(idle * 1.7) * .012);
    axe.position.set(pos[0], pos[1] + Math.sin(idle * 2.2) * .008, pos[2]);
  }

  const tipA = new T.Vector3(), tipB = new T.Vector3();
  let lastRound = -1;

  function placeSpiders(s, dt) {
    spiders.forEach((sp, i) => {
      const e = s.enemies[i], v = sp.vis, t = stage.vt;
      sp.root.position.set(e.x, .58 - v.dead * .26, e.z);
      sp.root.rotation.y = e.facing;
      v.flinch = Math.max(0, v.flinch - dt * 4);
      const wantRear = e.windup > 0 ? 1 : 0;
      v.rear += (wantRear - v.rear) * Math.min(1, dt * 12);
      if (e.hp <= 0) v.dead = Math.min(1, v.dead + dt * 2.2);
      sp.body.rotation.x = -v.rear * .55 + v.flinch * .3;
      sp.body.rotation.z = v.dead * Math.PI * .92 * (i % 2 ? 1 : -1);
      sp.body.position.y = v.dead * .5 + v.rear * .22;
      sp.body.scale.set(1, 1 - v.dead * .15, 1 - v.flinch * .1);
      sp.eyeMat.color.setHex(e.windup > 0 ? 0xff3a22 : e.hp <= 0 ? 0x3a2418 : 0xffb34d);
      const em = e.stun > 0 && e.hp > 0 ? 0x6a2410 : 0;
      setEmissive(sp.body, em, 1);
      const walk = e.walking && e.hp > 0 && s.state === 'RUNNING' ? 1 : 0;
      v.walkT += dt * (walk ? 13 : 4);
      for (const l of sp.legs) {
        const wave = e.hp > 0 ? Math.sin(v.walkT + l.j * 1.7 + l.side * 2) * (walk ? .16 : .04) : 0;
        const d = v.dead;
        const knee = [l.knee[0] * (1 - .3 * d), l.knee[1] + .55 * d + v.rear * .18, l.knee[2] + wave];
        const foot = [l.foot[0] * (1 - .55 * d), l.foot[1] * (1 - d) + .35 * d + Math.max(0, wave) * .5 + v.rear * .5, l.foot[2] * (1 - .25 * d) + wave * 1.4];
        setRod(l.upper, l.hip, knee); setRod(l.lower, knee, foot); l.joint.position.set(...knee);
      }
    });
  }

  function handle(ev) {
    const P = v3(ev.x ?? 0, ev.y ?? 0, ev.z ?? 0);
    switch (ev.type) {
      case 'melee.hit': {
        const sp = spiders[ev.target]; if (sp) sp.vis.flinch = 1;
        fx.flash(P, { color: 0xfff1c0, size: 1.5, life: .12, spin: 1 });
        fx.burst(P, { n: 16, color: 0xffe9a8, speed: 6, size: .12, life: .35 });
        fx.burst(P, { n: 18, color: ICHOR, speed: 4, size: .2, life: .6, gravity: 9 });
        fx.chips(P, { n: 7, color: [ICHOR, 0x4e6a1f], speed: 3.2, size: .12, life: 1.2 });
        fx.ring(P, { color: 0xfff0c0, r0: .1, r1: 1.2, life: .22, normal: camera.getWorldDirection(v3(0, 0, 0)).negate() });
        fx.light(P, { color: 0xffd9a0, intensity: 40, life: .14, distance: 9 });
        stage.shake(.8, .28); stage.kick(.7);
        break;
      }
      case 'melee.miss':
        fx.burst(P, { n: 6, color: 0xcfe6ff, speed: 3, size: .08, life: .25, gravity: 3 });
        stage.kick(.3);
        break;
      case 'melee.swung': stage.kick(.2); break;
      case 'enemy.defeated':
        fx.smoke(P, { n: 6, color: 0x8b7a68, size: 1.1, life: 1.3, rise: .6, spread: 1.2, opacity: .45 });
        fx.burst(v3(P.x, .5, P.z), { n: 22, color: ICHOR, speed: 4.5, size: .22, life: .7, gravity: 8 });
        stage.shake(.5, .3);
        break;
      case 'enemy.bite':
        stage.shake(1.5, .4);
        break;
      case 'player.hit': stage.shake(1.2, .35); break;
      default:
    }
  }

  function resetVisuals() {
    fx.clear(); trail.clear();
    spiders.forEach((sp, i) => Object.assign(sp.vis, { dead: 0, flinch: 0, rear: 0, walkT: i * 2 }));
  }

  function sync(s, dt, evs = []) {
    if (s.roundId !== lastRound) { if (lastRound !== -1) resetVisuals(); lastRound = s.roundId; }
    stage.update(dt);
    for (const ev of evs) handle(ev);
    stage.place(s, dt);
    placeSpiders(s, dt);
    poseAxe(s.swingT, stage.vt);
    if (s.swingT >= SWING.wind * .6 && s.swingT < SWING.wind + SWING.strike + .12) {
      axe.updateMatrixWorld(true);
      tipA.set(-.58, .3, 0); tipB.set(-.5, .02, 0);
      trail.push(axe.localToWorld(tipA.clone()), axe.localToWorld(tipB.clone()));
    }
    trail.update(dt);
    for (const f of flames) {
      const k = 1 + .14 * Math.sin(stage.vt * 9 + f.i * 2) + .06 * Math.sin(stage.vt * 23 + f.i);
      f.outer.scale.set(1, k, 1); f.inner.scale.set(1, 1 / k * 1.05, 1);
      f.light.intensity = 30 * (1 + .06 * Math.sin(stage.vt * 11 + f.i * 3));
      if (false) fx.spark(f.outer.getWorldPosition(v3(0, 0, 0)), v3(0, 1.5, 0), { color: 0xffb04a, size: .08, life: .9, gravity: -.2 });
    }
  }
  sync(initial, 0, []);
  return { scene, camera, sync, pendingEvents: (s) => stage.drain(s, () => {}) };
}
