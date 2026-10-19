// SPDX-License-Identifier: Apache-2.0
import * as T from 'three';
import { box, ball, cyl, cone, rod, group, mat, basic, noiseTexture, texturedMat, skyDome, mulberry32, clamp, smooth, ownMaterials, setEmissive, createDrain , LiteLight } from '../_shared/kit.mjs';
import { Fx, Trail } from '../_shared/fx.mjs';
import { v3 } from '../_shared/fpsview.mjs';
import { STAGE, COMBO } from './game.mjs';

const CYAN = 0x6fe8ff, GOLD = 0xffd070;

// Fighters face +x in their own frame; limbs swing around z.
function buildFighter({ top, belt, pants, skin = '#d9a37e', hair = '#2a1f1a', band }) {
  const root = group(null), hips = group(root, 0, 1.0, 0);
  box(hips, pants, [0, 0, 0], [.34, .22, .5]);
  const legs = [-1, 1].map((sz) => {
    const hip = group(hips, 0, -.05, sz * .15), knee = group(hip, 0, -.48, 0);
    box(hip, pants, [0, -.24, 0], [.2, .5, .2]);
    box(knee, pants, [0, -.23, 0], [.17, .47, .17]);
    box(knee, '#1d1a1a', [.07, -.47, 0], [.3, .1, .18]);
    return { hip, knee };
  });
  const torso = group(hips, 0, .08, 0);
  box(torso, top, [0, .38, 0], [.4, .72, .6]);
  box(torso, belt, [0, .02, 0], [.42, .12, .62]);
  const head = group(torso, 0, .92, 0);
  ball(head, skin, [0, .08, 0], [.19, .21, .19], 1);
  ball(head, hair, [-.02, .16, 0], [.2, .13, .2], 1);
  box(head, band, [0, .13, 0], [.4, .05, .4]).scale.set(.5, 1, .5);
  const arms = [-1, 1].map((sz) => {
    const shoulder = group(torso, 0, .7, sz * .38), elbow = group(shoulder, 0, -.42, 0);
    box(shoulder, top, [0, -.21, 0], [.17, .44, .17]);
    box(elbow, skin, [0, -.2, 0], [.14, .4, .14]);
    const fist = ball(elbow, skin, [0, -.43, 0], [.12, .12, .12], 1);
    return { shoulder, elbow, fist, sz };
  });
  const aura = new T.Mesh(new T.SphereGeometry(.22, 10, 8), new T.MeshBasicMaterial({ color: 0xff4a2a, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false }));
  arms[1].elbow.add(aura); aura.position.y = -.43;
  ownMaterials(root);
  return { root, hips, torso, head, legs, arms, aura, vis: { walkT: 0, flash: 0 } };
}

export function createScene(initial) {
  const scene = new T.Scene();
  scene.background = new T.Color(0x3a3050); scene.fog = new T.Fog(0x4a3a5c, 22, 70);
  const camera = new T.PerspectiveCamera(42, 16 / 9, .3, 150);
  camera.position.set(0, 2.45, 9.8); camera.lookAt(0, 1.55, 0);
  scene.add(camera);
  scene.add(skyDome({ top: '#1d1840', mid: '#6a3f6c', bottom: '#f09a62', radius: 120 }));
  scene.add(new T.HemisphereLight(0xcfd6ff, 0x5a4a58, 1.45));
  const key = new T.DirectionalLight(0xffe6c8, 2.3); key.position.set(-6, 9, 9); scene.add(key);
  const rim = new T.DirectionalLight(0x6fd0ff, 1.1); rim.position.set(5, 5, -8); scene.add(rim);
  const fx = new Fx(scene, { lights: 3 });
  const rnd = mulberry32(71);
  const world = group(scene);

  // ---- platform (the stage stays big in frame: it spans the full width)
  const jadeTex = noiseTexture({ base: '#3c8f7a', spots: ['#357f6c', '#46a089', '#2f705f'], n: 120, repeat: [6, 2], seed: 4, lines: { color: '#2a6a58', count: 4, width: 3 } });
  const deck = new T.Mesh(new T.BoxGeometry(17.4, .7, 5.4), [mat('#2e6e5e'), mat('#2e6e5e'), texturedMat(jadeTex), mat('#2e6e5e'), mat('#2e6e5e'), mat('#2e6e5e')]);
  deck.position.set(0, -.35, 0); world.add(deck);
  box(world, '#d9b25a', [0, .03, 2.65], [17.6, .1, .22]); box(world, '#d9b25a', [0, .03, -2.65], [17.6, .1, .22]);
  for (const sx of [-1, 1]) box(world, '#d9b25a', [sx * 8.75, .03, 0], [.22, .1, 5.4]);
  box(world, '#b9a67c', [0, -1.05, .6], [18.6, .7, 6.4]);
  box(world, '#8f7f5e', [0, -1.7, 1.4], [20, .7, 7.6]);
  for (const sx of [-1, 1]) for (let k = 0; k < 6; k++) box(world, '#c9b48a', [sx * (8.2 - k * 1.25) * (sx > 0 ? 1 : 1), -.8, 2.62], [.5, .5, .08]);
  // circular combat marks
  const ring = new T.Mesh(new T.RingGeometry(1.6, 1.72, 40), new T.MeshBasicMaterial({ color: 0xe8d9a0, transparent: true, opacity: .55, side: T.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(0, .02, 0); world.add(ring);
  // ---- backdrop: pillars, wall, moon gate, lanterns, mountains
  box(world, '#4a3d52', [0, 3, -6.2], [26, 6.5, .8]);
  box(world, '#6a2f3a', [0, 6.4, -6], [27, .4, 1.4]); box(world, '#d9b25a', [0, 6.7, -6], [27.4, .14, 1.6]);
  const moon = new T.Mesh(new T.CircleGeometry(2.1, 36), new T.MeshBasicMaterial({ color: 0xfff0d0 })); moon.position.set(0, 3.4, -5.7); world.add(moon);
  const moonRing = new T.Mesh(new T.TorusGeometry(2.3, .18, 8, 40), new T.MeshLambertMaterial({ color: 0x9a2f2f, flatShading: true })); moonRing.position.set(0, 3.4, -5.6); world.add(moonRing);
  for (const x of [-6.6, -3, 3, 6.6]) {
    const g = group(world, x, 0, -3.2);
    cyl(g, '#5a4c64', [0, 2.4, 0], [.5, .62, 4.8], 8);
    cyl(g, '#d9b25a', [0, .25, 0], [.72, .78, .5], 8); cyl(g, '#d9b25a', [0, 4.5, 0], [.62, .55, .35], 8);
    box(g, '#9a2f2f', [0, 4.85, 0], [1.5, .38, 1.3]); box(g, '#9a2f2f', [0, 5.15, 0], [1.9, .22, 1.7]);
    for (let k = 0; k < 4; k++) box(g, '#d9b25a', [0, 1 + k * .9, .52], [.5, .06, .06]);
  }
  const lanterns = [];
  for (const x of [-4.8, -1.4, 1.4, 4.8]) {
    const g = group(world, x, 5.4, -2.6);
    rod(g, '#3a2a22', [0, .7, 0], [0, 0, 0], .02);
    const bulb = ball(g, new T.MeshBasicMaterial({ color: 0xff5a3a }), [0, -.2, 0], [.3, .38, .3], 1);
    box(g, '#d9b25a', [0, .12, 0], [.34, .06, .34]); box(g, '#d9b25a', [0, -.55, 0], [.2, .06, .2]);
    lanterns.push(bulb);
  }
  for (const x of [-5.5, 5.5]) { const l = new LiteLight(0xff8a50, 14, 14, 1.6); l.position.set(x, 4.8, -1.8); scene.add(l); }
  for (const [x, z, h, c] of [[-20, -26, 20, '#3c3358'], [-8, -34, 26, '#2f2a4d'], [10, -30, 22, '#3a3156'], [24, -28, 18, '#463a5e'], [0, -42, 30, '#272344']]) cone(world, c, [x, h / 2 - 3, z], [h * .9, h], 5);
  for (const [x, z] of [[-9.8, -2], [9.6, -1.6], [-11, 1], [11, 2]]) { rod(world, '#5a4030', [x, -1, z], [x, 3.4, z], .13); for (let k = 0; k < 5; k++) cone(world, '#2f6a44', [x, 1.2 + k * .55, z], [1.3 - k * .2, 1.1], 6); }
  // drifting petals/embers
  const petals = Array.from({ length: 0 }, () => { const s = new T.Sprite(new T.SpriteMaterial({ map: fx.glow, color: 0xffb3a0, transparent: true, opacity: .55, blending: T.AdditiveBlending, depthWrite: false })); s.scale.setScalar(.12); s.position.set((rnd() - .5) * 16, rnd() * 5, (rnd() - .5) * 4); scene.add(s); return s; });

  // ---- fighters
  const hero = buildFighter({ top: '#3f86c8', belt: '#f0f0e8', pants: '#223a63', band: '#e9eef2' });
  const foe = buildFighter({ top: '#e0793f', belt: '#1c1a1a', pants: '#5a3f33', band: '#a82a2a', hair: '#6a3a22' });
  scene.add(hero.root, foe.root);
  const trail = new Trail(scene, { n: 12, color: CYAN, opacity: .75, life: .18 });
  const waves = new Map();
  const wpos = new T.Vector3(), wpos2 = new T.Vector3();
  const drain = createDrain();
  let lastRound = -1, vt = 0, shake = 0, shakeA = 0, hitStop = 0, koT = 0, comboT = -9, dashGhost = 0, waveOrb = 0;

  function pose(f, a, st, o) {
    // a: anim object {anim, animT, y, ...}; st: extras {guard, moving, hurtT}
    const t = a.animT, vis = f.vis;
    let zl = { x: 0, y: 0, z: 0 };
    const set = (arm, sh, el) => { arm.shoulder.rotation.z = sh; arm.elbow.rotation.z = el; };
    const [rear, front] = f.arms; // sz -1 / +1 ; front is the arm nearer the camera
    let torsoLean = 0, hipY = 1.0, legF = .3, legR = -.3, kneeF = .3, kneeR = .3, headTilt = 0, rootRot = 0, rootY = 0;
    const walking = st.moving && a.anim === 'idle';
    vis.walkT += st.dt * (walking ? 9 : 0);
    const bob = Math.sin(vt * 3.2) * .02;
    set(front, .55, 1.5); set(rear, .15, 1.7);
    if (walking) { legF = Math.sin(vis.walkT) * .7; legR = -Math.sin(vis.walkT) * .7; kneeF = Math.max(0, -Math.sin(vis.walkT)) * .8; kneeR = Math.max(0, Math.sin(vis.walkT)) * .8; }
    const bump = (x, a0, a1) => clamp((x - a0) / (a1 - a0), 0, 1);
    const punch = (arm, dur) => { const ph = t < dur * .38 ? t / (dur * .38) : Math.max(0, 1 - (t - dur * .38) / (dur * .62)); set(arm, .5 + ph * 1.05, 1.5 - ph * 1.45); return ph; };
    switch (a.anim) {
      case 'combo1': { const ph = punch(front, .28); torsoLean = -.15 * ph; legF = .5; break; }
      case 'combo2': { const ph = punch(rear, .28); torsoLean = -.2 * ph; legR = -.45; break; }
      case 'combo3': {
        const ph = t < .18 ? t / .18 : Math.max(0, 1 - (t - .18) / .32);
        legF = .3 + ph * 1.35; kneeF = .3 - ph * .25; torsoLean = .25 * ph; set(front, -.6 * ph, 1.5); set(rear, 1.0 * ph, 1.2); rootY = ph * .08; break;
      }
      case 'uppercut': {
        const crouch = t < .14 ? t / .14 : 0, rise = t >= .14 ? Math.max(0, 1 - (t - .14) / .4) : 0;
        hipY = 1.0 - crouch * .22 + rise * .12; set(front, .4 + (t >= .14 ? rise * 2.5 : 0), 1.2 - rise * 1.1); torsoLean = crouch * -.2 + rise * .15; legF = .6 * crouch; kneeF = .9 * crouch; rootY = rise * .25; break;
      }
      case 'wave': {
        const ph = t < .2 ? t / .2 : Math.max(0, 1 - (t - .2) / .3); set(front, .5 + ph * 1.1, 1.5 - ph * 1.4); set(rear, .3 + ph * 1.2, 1.6 - ph * 1.5); torsoLean = -.22 * ph; hipY = 1 - .06 * ph; legF = .5; legR = -.5; break;
      }
      case 'dash': { torsoLean = -.45; set(front, -.9, .4); set(rear, -.7, .3); legF = 1.0; legR = -.9; kneeR = 1; hipY = .92; break; }
      case 'jump': { legF = .9; legR = .5; kneeF = 1.1; kneeR = 1.3; set(front, 1.9, .8); set(rear, 1.6, .9); hipY = 1.0; break; }
      case 'hurt': { const k = Math.max(0, 1 - t / .35); torsoLean = .35 * k; headTilt = .3 * k; set(front, -.3 * k, .8); set(rear, -.2 * k, .8); legF = .1; legR = -.3; break; }
      case 'launched': { rootRot = Math.min(1.1, t * 3.2); torsoLean = .2; set(front, 2.2, .3); set(rear, 2.0, .4); legF = 1; legR = .6; break; }
      case 'guard': { set(front, 1.0, 2.1); set(rear, .9, 2.2); torsoLean = .08; hipY = .93; break; }
      case 'windup': { set(rear, 1.9 - Math.min(1, t / .4) * 3.0, .9); set(front, .6, 1.4); torsoLean = .22 * Math.min(1, t / .4); legR = -.5; break; }
      case 'recover': { const k = Math.max(0, 1 - t / .35); set(rear, .5 + k * 1.05, 1.5 - k * 1.45); torsoLean = -.15 * k; break; }
      default:
    }
    if (st.guard) { set(front, 1.0, 2.1); set(rear, .9, 2.2); torsoLean = .08; hipY = .92; }
    if (st.ko) { rootRot = 1.5; rootY = -.62; set(front, .3, .4); set(rear, -.2, .6); legF = .2; legR = -.1; torsoLean = 0; hipY = 1.0; }
    f.hips.position.y = hipY + (a.anim === 'idle' || walking ? bob : 0) - (a.y > 0 ? 0 : 0);
    f.torso.rotation.z = -torsoLean; f.head.rotation.z = headTilt;
    f.legs[1].hip.rotation.z = legF; f.legs[0].hip.rotation.z = legR; f.legs[1].knee.rotation.z = -kneeF; f.legs[0].knee.rotation.z = -kneeR;
    f.root.rotation.z = rootRot; f.root.position.y = a.y + rootY;
  }

  function handle(ev, s) {
    const P = v3(ev.x ?? 0, ev.y ?? 1.3, 0.3);
    switch (ev.type) {
      case 'combo.struck': { comboT = 0; break; }
      case 'enemy.hit': {
        const big = ev.label === 'finisher' || ev.label === 'uppercut' || ev.label === 'wave';
        foe.vis.flash = 1; hitStop = big ? .09 : .05;
        const col = ev.label === 'wave' ? CYAN : ev.label === 'uppercut' ? GOLD : 0xffffff;
        fx.flash(P, { color: col, size: big ? 3.2 : 2, life: .14, spin: 2 });
        fx.ring(P, { color: col, r0: .15, r1: big ? 1.9 : 1.2, life: .24, normal: v3(0, 0, 1) });
        fx.burst(P, { n: big ? 28 : 16, color: col, speed: big ? 8 : 6, size: .12, life: .4, gravity: 5 });
        fx.light(P, { color: col, intensity: 40, life: .15, distance: 10 });
        shake = big ? .3 : .15; shakeA = big ? 1.2 : .6;
        break;
      }
      case 'enemy.guarded': fx.flash(P, { color: 0xfff0b0, size: 1.4, life: .1 }); fx.ring(P, { color: 0xfff0b0, r0: .1, r1: .8, life: .2, normal: v3(0, 0, 1) }); fx.burst(P, { n: 8, color: 0xffe9a0, speed: 4, size: .08, life: .3 }); break;
      case 'strike.blocked': fx.flash(P, { color: CYAN, size: 2, life: .14 }); fx.ring(P, { color: CYAN, r0: .1, r1: 1.1, life: .25, normal: v3(0, 0, 1) }); fx.burst(P, { n: 12, color: CYAN, speed: 5, size: .1, life: .35 }); shake = .12; shakeA = .5; break;
      case 'player.hit': case 'opponent.struck':
        if (ev.type === 'player.hit') { hero.vis.flash = 1; fx.flash(P, { color: 0xff7a4a, size: 2.4, life: .14, spin: 2 }); fx.burst(P, { n: 18, color: 0xff7a4a, speed: 6, size: .12, life: .4, gravity: 5 }); fx.ring(P, { color: 0xff7a4a, r0: .15, r1: 1.4, life: .24, normal: v3(0, 0, 1) }); shake = .28; shakeA = 1.2; hitStop = .06; }
        break;
      case 'enemy.attack': fx.ring(v3(foe.root.position.x, 1.5, .3), { color: 0xff4a2a, r0: .1, r1: 1, life: .3, normal: v3(0, 0, 1), opacity: .9 }); break;
      case 'player.dashed': {
        dashGhost = 1;
        for (let k = 0; k < 7; k++) { const y = .3 + k * .28, a = v3(ev.x - ev.facing * .2, y, .3), b = v3(ev.x - ev.facing * (1.6 + Math.random()), y, .3); fx.beam(a, b, { color: CYAN, width: .05, life: .25 }); }
        fx.smoke(v3(ev.x, .1, .3), { n: 4, color: 0xd9d0c0, size: .8, life: .7, rise: .2, spread: 1, opacity: .4 });
        break;
      }
      case 'uppercut.struck': { const p = hero.root.position; for (let k = 0; k < 10; k++) fx.spark(v3(p.x + ev.facing * .5, .6 + k * .12, .3), v3(ev.facing * .8, 4 + Math.random() * 3, 0), { color: GOLD, size: .14, life: .35 }); break; }
      case 'wave.launched': waveOrb = 1; break;
      case 'projectile.impact': fx.flash(P, { color: CYAN, size: 3.4, life: .2, spin: 1 }); fx.ring(P, { color: CYAN, r0: .2, r1: 2.4, life: .4, normal: v3(0, 0, 1) }); fx.burst(P, { n: 30, color: CYAN, speed: 8, size: .14, life: .5, gravity: 2 }); break;
      case 'enemy.defeated': koT = .001; fx.burst(v3(ev.x, 1.2, .3), { n: 36, color: 0xffd070, speed: 8, size: .14, life: .8, gravity: 4 }); fx.smoke(v3(ev.x, .2, .3), { n: 6, color: 0xd9d0c0, size: 1.1, life: 1.3, rise: .4, spread: 1.2, opacity: .45 }); shake = .5; shakeA = 1.6; break;
      case 'player.jumped': fx.smoke(v3(hero.root.position.x, .1, .3), { n: 2, color: 0xd9d0c0, size: .6, life: .6, rise: .2, spread: .6, opacity: .35 }); break;
      default:
    }
  }

  function syncWaves(s, dt) {
    const live = new Set();
    for (const w of s.projectiles) {
      live.add(w.id);
      let g = waves.get(w.id);
      if (!g) {
        g = group(scene);
        const arc = new T.Mesh(new T.TorusGeometry(.75, .11, 6, 18, Math.PI * .85), new T.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: .9, blending: T.AdditiveBlending, depthWrite: false }));
        arc.rotation.z = -Math.PI * .425 + (w.vx > 0 ? 0 : Math.PI); g.add(arc);
        const inner = new T.Mesh(new T.TorusGeometry(.6, .05, 5, 16, Math.PI * .85), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .95, blending: T.AdditiveBlending, depthWrite: false }));
        inner.rotation.z = arc.rotation.z; g.add(inner);
        const halo = new T.Sprite(new T.SpriteMaterial({ map: fx.glow, color: CYAN, transparent: true, blending: T.AdditiveBlending, depthWrite: false })); halo.scale.setScalar(2.6); g.add(halo);
        g.userData.dir = Math.sign(w.vx);
        waves.set(w.id, g);
      }
      g.position.set(w.x, w.y, .3);
      g.scale.set(1 + Math.sin(vt * 20) * .05, 1, 1);
      if (Math.random() < .25) fx.spark(v3(w.x - g.userData.dir * .3, w.y + (Math.random() - .5) * 1.2, .3), v3(-g.userData.dir * 2, (Math.random() - .5) * 2, 0), { color: CYAN, size: .12, life: .3 });
    }
    for (const [id, g] of waves) if (!live.has(id)) { scene.remove(g); waves.delete(id); }
  }

  function sync(s, dt, evs = []) {
    if (s.roundId !== lastRound) {
      if (lastRound !== -1) { fx.clear(); trail.clear(); for (const g of waves.values()) scene.remove(g); waves.clear(); koT = 0; }
      lastRound = s.roundId;
    }
    vt += dt;
    // brief hit-stop slows the effects clock, not the rules
    const vdt = hitStop > 0 ? dt * .15 : dt; hitStop = Math.max(0, hitStop - dt);
    fx.update(vdt);
    for (const ev of evs) handle(ev, s);
    const p = s.player, o = s.opponent;
    hero.root.position.x = p.x; foe.root.position.x = o.x;
    hero.root.rotation.y = p.facing > 0 ? 0 : Math.PI; foe.root.rotation.y = o.facing > 0 ? 0 : Math.PI;
    hero.root.position.z = .0; foe.root.position.z = 0;
    const heroAnim = { anim: p.anim, animT: p.animT, y: p.y };
    if (p.y > 0 && p.anim === 'idle') heroAnim.anim = 'jump';
    pose(hero, heroAnim, { guard: s.guarding, moving: p.moving, dt: vdt }, o);
    pose(foe, { anim: o.anim, animT: o.animT, y: o.y }, { guard: o.guardT > 0 && o.anim !== 'launched', moving: o.anim === 'walk', dt: vdt, ko: o.hp <= 0 && s.state !== 'RUNNING' }, p);
    // KO slide
    foe.aura.material.opacity = o.windup > 0 ? .55 + .35 * Math.sin(vt * 40) : 0;
    foe.arms[0].elbow.updateMatrixWorld(true);
    hero.vis.flash = Math.max(0, hero.vis.flash - dt * 6); foe.vis.flash = Math.max(0, foe.vis.flash - dt * 6);
    setEmissive(hero.root, hero.vis.flash > 0 ? 0xa05030 : 0, hero.vis.flash); setEmissive(foe.root, foe.vis.flash > 0 ? 0xa0a0b0 : 0, foe.vis.flash * .8);
    if (s.guarding) setEmissive(hero.root, 0x1a5a78, .5);
    // fist trail during strikes
    comboT += dt;
    if (['combo1', 'combo2', 'combo3', 'uppercut', 'wave'].includes(p.anim) && p.animT < .5) {
      hero.root.updateMatrixWorld(true);
      const arm = p.anim === 'combo2' ? hero.arms[0] : hero.arms[1];
      const a = arm.fist.getWorldPosition(wpos), b = arm.shoulder.getWorldPosition(wpos2);
      const kick = p.anim === 'combo3' ? hero.legs[1].knee.getWorldPosition(wpos2) : b;
      trail.push(p.anim === 'combo3' ? hero.legs[1].knee.getWorldPosition(v3(0, 0, 0)).add(v3(0, -.3, 0)) : a.clone(), kick.clone());
    }
    trail.update(dt);
    waveOrb = Math.max(0, waveOrb - dt * 3);
    if (waveOrb > 0 && Math.random() < .3) { const a = hero.arms[1].fist.getWorldPosition(v3(0, 0, 0)); fx.spark(a, v3((Math.random() - .5) * 2, (Math.random() - .5) * 2, 0), { color: CYAN, size: .16 + waveOrb * .1, life: .25 }); }
    syncWaves(s, dt);
    if (koT > 0) koT += dt;
    // fixed side camera with a little punch-in for impact
    shake = Math.max(0, shake - dt);
    const a = shakeA * (shake / .3);
    camera.position.set((shake > 0 ? Math.sin(vt * 95) * a * .09 : 0), 2.45 + (shake > 0 ? Math.cos(vt * 77) * a * .07 : 0), 9.8);
    camera.lookAt(clamp((p.x + o.x) * .08, -.6, .6), 1.55, 0);
    lanterns.forEach((l, i) => { l.scale.y = .38 * (1 + Math.sin(vt * 2 + i) * .04); });
    petals.forEach((q, i) => { q.position.y -= dt * (.25 + (i % 5) * .05); q.position.x += Math.sin(vt + i) * dt * .3; if (q.position.y < 0) q.position.y = 5; });
  }
  sync(initial, 0, []);
  return { scene, camera, sync, pendingEvents: (s) => drain(s, () => {}) };
}
