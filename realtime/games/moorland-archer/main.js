import * as THREE from 'three';
import { createRenderer } from '/assets/user-interface/PrototypeShell.js';
import { createGame } from './game.mjs';
import { buildWorld, createArrowMesh, heightAt, isDeepWater, MONSTER_SPAWNS, WORLD } from './scene.js';

const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
const setHidden = (node, hidden) => { if (node && node.hidden !== hidden) node.hidden = hidden; };

const TURN = 0.42; // seconds for a half-turn of presented yaw
const wrapPi = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

// Floating health bar that always faces the camera.
function createHealthBar() {
  const group = new THREE.Group();
  const back = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.16), new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.7, depthTest: false }));
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(1.24, 0.1), new THREE.MeshBasicMaterial({ color: 0xff4a3a, depthTest: false }));
  fill.position.z = 0.001;
  back.renderOrder = 20; fill.renderOrder = 21;
  group.add(back, fill);
  return { group, fill };
}

export function createRuntime(host) {
  const renderer = createRenderer(document.querySelector('#app'), { pixelRatio: 1, shadows: true });
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.domElement.setAttribute('aria-label', 'Moorland Archer game view');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1400);
  const world = buildWorld(scene);
  world.arrowSample.visible = false; // live arrows replace the static sample

  const game = createGame({ heightAt, isDeepWater, colliders: world.colliders, monsterSpawns: MONSTER_SPAWNS, world: WORLD });
  const g = game.internals;

  host.input.bind({
    KeyW: 'forward', KeyS: 'backward', KeyA: 'left', KeyD: 'right',
    KeyI: 'camUp', KeyK: 'camDown', KeyJ: 'camLeft', KeyL: 'camRight',
    KeyB: 'draw', ShiftLeft: 'sprint', ShiftRight: 'sprint',
    KeyP: 'pause', Escape: 'pause',
  });

  const $ = sel => document.querySelector(sel);
  const view = {
    hearts: $('#hud-hearts'),
    monsterCount: $('#monster-count'),
    monsterPips: $('#monster-pips'),
    shrineDist: $('#shrine-dist'),
    reticle: $('#reticle'),
    charge: $('#charge'),
    lockLabel: $('#lock-label'),
    banner: $('#banner'),
    hint: $('#hint'),
    damage: $('#damage'),
    overlay: $('#overlay'),
    eyebrow: $('#result-eyebrow'),
    title: $('#result-title'),
    msg: $('#result-msg'),
    statTime: $('#stat-time'),
    statHearts: $('#stat-hearts'),
    statAcc: $('#stat-acc'),
    resume: $('#resume'),
    restart: $('#restart'),
    resultHint: $('#result-hint'),
  };
  const big = {
    overlay: $('#overlay-big'),
    eyebrow: $('#big-result-eyebrow'),
    title: $('#big-result-title'),
    msg: $('#big-result-msg'),
    statTime: $('#big-stat-time'),
    statHearts: $('#big-stat-hearts'),
    statAcc: $('#big-stat-acc'),
    resume: $('#big-resume'),
    restart: $('#big-restart'),
    resultHint: $('#big-result-hint'),
  };
  const touch = document.querySelector('.touch');
  const heartEls = Array.from({ length: game.TUNING.hearts }, () => {
    const el = document.createElement('span');
    el.className = 'heart';
    el.textContent = '♥';
    view.hearts.appendChild(el);
    return el;
  });
  const pipEls = MONSTER_SPAWNS.map(sp => {
    const el = document.createElement('span');
    el.className = `pip${sp.kind === 'thrower' ? ' boss' : ''}`;
    view.monsterPips.appendChild(el);
    return el;
  });

  // Input: host keyboard plus the touch pad, merged behind one facade. The pad
  // is a single live object — handlers mutate it and the sim consumes it in
  // place; one-shot fields are deleted on consume, never copied.
  const pad = { held: new Map(), pressed: new Set() };
  let keyboard = host.input;
  function clearInput() {
    keyboard.clear();
    pad.held.clear();
    pad.pressed.clear();
  }
  const input = {
    isDown: action => keyboard.isDown(action) || [...pad.held.values()].includes(action),
    consumePress(action) {
      const key = keyboard.consumePress(action), pointer = pad.pressed.delete(action);
      return key || pointer;
    },
  };

  const listeners = new AbortController(), options = { signal: listeners.signal };
  for (const button of touch.querySelectorAll('[data-action]')) {
    button.addEventListener('pointerdown', event => {
      event.preventDefault(); button.blur();
      const action = button.dataset.action;
      if (action === 'pause') { pad.pressed.add('pause'); return; }
      if (paused || finished()) return;
      button.setPointerCapture(event.pointerId);
      if (button.dataset.hold === '1') pad.held.set(event.pointerId, action);
      // Bow draws on the press edge and looses on release, so it needs both.
      if (button.dataset.hold !== '1' || action === 'draw') pad.pressed.add(action);
    }, options);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      button.addEventListener(type, event => { pad.held.delete(event.pointerId); }, options);
    }
  }
  for (const button of [view.restart, big.restart]) {
    button.addEventListener('click', () => { button.blur(); clearInput(); host.restart(); }, options);
  }
  for (const button of [view.resume, big.resume]) {
    button.addEventListener('click', () => { button.blur(); pad.pressed.add('pause'); }, options);
  }
  window.addEventListener('blur', clearInput, options);
  document.addEventListener('visibilitychange', clearInput, options);

  const sun = world.atmosphere.sun;
  if (sun) scene.add(sun.target);
  const sunOffset = sun.position.clone();

  const monsterViews = new Map(world.monsters.map(v => {
    const bar = createHealthBar();
    scene.add(bar.group);
    return [v.spawn.id, { ...v, bar }];
  }));
  const arrowViews = new Map();
  const rockViews = new Map();
  const rockGeo = new THREE.DodecahedronGeometry(0.35);
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x8c8a80, flatShading: true });
  const flame = world.campfire.getObjectByName('campfire-flame');
  const tmp = new THREE.Vector3();

  // Presented monster yaw: the sim may retarget facing in one step; the view
  // spins through the camera-facing pose instead of snapping.
  const presentedYaw = new Map();
  function snapTurns() { for (const m of g.monsters) presentedYaw.set(m.id, m.yaw); }
  function stepTurns(dt) {
    const spin = Math.PI / TURN * dt;
    const camFace = game.rig.yaw + Math.PI;
    for (const m of g.monsters) {
      const from = wrapPi(presentedYaw.get(m.id) - camFace);
      const delta = wrapPi(wrapPi(m.yaw - camFace) - from);
      presentedYaw.set(m.id, Math.abs(delta) <= spin ? m.yaw : wrapPi(from + Math.sign(delta) * spin + camFace));
    }
  }
  snapTurns();

  // One tracked opacity per node; written only when the value changes.
  const shown = new Map();
  const setOpacity = (node, value) => { if (node && shown.get(node) !== value) { shown.set(node, value); node.style.opacity = value; } };
  let lastHearts = game.TUNING.hearts;
  let shownOverlay = false, lastReticleSide = '', lastCharge = -1, lastBannerOn = null, lastHintPhase = '';
  let paused = false;
  const finished = () => game.state === 'WON' || game.state === 'LOST';

  function togglePause() {
    // Pause is live-play only: READY and outcomes have their own cues.
    if (game.state !== 'RUNNING') return;
    paused = !paused;
    clearInput();
  }

  function resetVisuals() {
    game.reset();
    snapTurns();
    clearInput();
    paused = false;
    world.arrowSample.visible = false;
    for (const [, mesh] of arrowViews) scene.remove(mesh);
    arrowViews.clear();
    for (const [, mesh] of rockViews) scene.remove(mesh);
    rockViews.clear();
    if (sun) {
      sun.target.position.copy(game.motion.position);
      sun.position.copy(game.motion.position).add(sunOffset);
    }
    syncVisuals(0);
  }

  function fillDialog(nodes, snap) {
    const terminal = snap.state === 'WON' || snap.state === 'LOST';
    setHidden(nodes.resume, terminal);
    if (paused) {
      setText(nodes.eyebrow, 'Held');
      setText(nodes.title, 'Paused');
      setText(nodes.msg, 'The valley waits. Press P or Escape to pick the bow back up.');
      setText(nodes.restart, 'Restart the round');
      setText(nodes.resultHint, 'P / Escape resumes · R restarts');
    } else if (terminal) {
      const won = snap.state === 'WON';
      setText(nodes.eyebrow, won ? 'Shrine cleared' : 'Hearts depleted');
      setText(nodes.title, won ? 'Victory' : 'You Fell');
      setText(nodes.msg, won
        ? 'Every monster guarding the shrine has fallen. The way inside is open.'
        : 'The shrine guards overwhelmed you. Keep your distance and shoot from range.');
      setText(nodes.statTime, String(Math.round(snap.stats.seconds)));
      setText(nodes.statHearts, String(snap.hearts));
      setText(nodes.statAcc, `${snap.stats.accuracy}%`);
      setText(nodes.restart, 'Play again');
      setText(nodes.resultHint, 'Press R to restart');
    }
  }

  function syncVisuals(dt) {
    const snap = game.read();
    // Player.
    const pv = world.player;
    pv.root.position.copy(game.motion.position);
    pv.root.rotation.y = game.motion.yaw;
    const p = g.player;
    if (g.bow.drawing) pv.actor.setPose('right:draw', Math.min(g.bow.drawTime * 1.4, 1.2));
    else if (p.looseTime < 0.5) pv.actor.setPose('right:loose', p.looseTime * 2);
    else pv.actor.setPose(p.sprinting ? 'run' : p.moving ? 'walk' : 'idle', p.animTime);
    pv.root.visible = !(p.invuln > 0 && Math.floor(snap.elapsed * 1000 / 90) % 2 === 0);

    // Monsters.
    for (const m of g.monsters) {
      const v = monsterViews.get(m.id);
      v.root.position.copy(m.pos);
      v.root.rotation.y = presentedYaw.get(m.id);
      const c = v.creature;
      if (m.state === 'dead') c.setPose('death', m.deathTime);
      else if (m.state === 'windup') c.setPose(m.attack === 'throw' ? 'charge' : 'pounce', m.timer * 0.9, { inPlace: true });
      else if (m.state === 'chase' && m.vel.lengthSq() > 0.1) c.setPose('move', m.animTime);
      else c.setPose('idle', m.animTime);
      const showBar = m.hp > 0 && (m.state !== 'idle' || m.hp < m.maxHp);
      if (v.bar.group.visible !== showBar) v.bar.group.visible = showBar;
      if (showBar) {
        v.bar.group.position.copy(m.pos).setY(m.pos.y + (m.kind === 'thrower' ? 3.2 : 2.5));
        v.bar.group.quaternion.copy(camera.quaternion);
        const f = m.hp / m.maxHp;
        v.bar.fill.scale.x = Math.max(0.001, f);
        v.bar.fill.position.x = -0.62 * (1 - f);
      }
    }

    // Arrows.
    const seen = new Set();
    for (const a of g.arrows) {
      seen.add(a.id);
      let mesh = arrowViews.get(a.id);
      if (!mesh) { mesh = createArrowMesh(); scene.add(mesh); arrowViews.set(a.id, mesh); }
      mesh.position.copy(a.pos);
      if (!a.stuck) mesh.lookAt(tmp.copy(a.pos).sub(a.vel));
    }
    for (const [id, mesh] of arrowViews) if (!seen.has(id)) { scene.remove(mesh); arrowViews.delete(id); }
    // Rocks.
    const seenRocks = new Set();
    for (const r of g.rocks) {
      seenRocks.add(r.id);
      let mesh = rockViews.get(r.id);
      if (!mesh) { mesh = new THREE.Mesh(rockGeo, rockMat); mesh.castShadow = true; scene.add(mesh); rockViews.set(r.id, mesh); }
      mesh.position.copy(r.pos);
      mesh.rotation.x += dt * 6; mesh.rotation.z += dt * 4;
    }
    for (const [id, mesh] of rockViews) if (!seenRocks.has(id)) { scene.remove(mesh); rockViews.delete(id); }

    // Camera and light follow.
    camera.position.copy(g.cam.position);
    camera.lookAt(g.cam.lookAt);
    if (sun) {
      sun.target.position.copy(game.motion.position);
      sun.position.copy(game.motion.position).add(sunOffset);
    }
    const t = snap.elapsed + snap.readyTime;
    if (flame) { const k = 1 + Math.sin(t * 17) * 0.12 + Math.sin(t * 31) * 0.08; flame.scale.set(1, k, 1); }

    // HUD: hearts, guards, compass, reticle snapping to the auto-aim target, charge ring.
    heartEls.forEach((el, i) => { if (el.classList.contains('empty') !== (i >= snap.hearts)) el.classList.toggle('empty', i >= snap.hearts); });
    if (snap.hearts < lastHearts) { view.hearts.classList.remove('hit'); void view.hearts.offsetWidth; view.hearts.classList.add('hit'); }
    lastHearts = snap.hearts;
    g.monsters.forEach((m, i) => { if (pipEls[i].classList.contains('dead') !== (m.hp <= 0)) pipEls[i].classList.toggle('dead', m.hp <= 0); });
    setText(view.monsterCount, `${snap.monstersAlive} / ${snap.monstersTotal}`);
    setText(view.shrineDist, String(Math.round(snap.shrineDist)));
    const { locked, rx, ry } = reticle();
    if (locked) {
      const side = `${Math.round(rx)}|${Math.round(ry)}`;
      if (side !== lastReticleSide) {
        lastReticleSide = side;
        for (const el of [view.reticle, view.charge, view.lockLabel]) { el.style.left = `${rx}%`; el.style.top = `${ry}%`; }
      }
    }
    if (view.reticle.classList.contains('locked') !== locked) view.reticle.classList.toggle('locked', locked);
    if (view.reticle.classList.contains('drawing') !== g.bow.drawing) view.reticle.classList.toggle('drawing', g.bow.drawing);
    setOpacity(view.reticle, finished() ? '0' : '1');
    setOpacity(view.lockLabel, locked ? '1' : '0');
    setOpacity(view.charge, g.bow.drawing ? '1' : '0');
    const chargeDeg = g.bow.charge * 360;
    if (Math.abs(chargeDeg - lastCharge) >= 2) {
      lastCharge = chargeDeg;
      view.charge.style.background = `conic-gradient(${g.bow.charge >= 1 ? '#fff6a8' : '#6ff0e0'} ${chargeDeg}deg, transparent 0deg)`;
    }
    setOpacity(view.damage, String(Math.round(Math.min(1, p.hitFlash * 2) * 20) / 20));
    const bannerOn = !finished() && snap.elapsed < 5;
    if (bannerOn !== lastBannerOn) { lastBannerOn = bannerOn; setOpacity(view.banner, bannerOn ? '1' : '0'); }
    const hintPhase = finished() ? 'off' : snap.elapsed < 15 ? 'full' : 'dim';
    if (hintPhase !== lastHintPhase) { lastHintPhase = hintPhase; setOpacity(view.hint, hintPhase === 'off' ? '0' : hintPhase === 'full' ? '1' : '0.4'); }

    // READY is the start line, not an outcome: no card.
    const showOverlay = paused || finished();
    if (showOverlay !== shownOverlay) {
      shownOverlay = showOverlay;
      if (showOverlay) { fillDialog(view, snap); fillDialog(big, snap); }
      view.overlay.classList.toggle('lost', snap.state === 'LOST');
      big.overlay.classList.toggle('lost', snap.state === 'LOST');
      setHidden(view.overlay, !showOverlay);
      setHidden(big.overlay, !showOverlay);
      setHidden(touch, showOverlay);
    }
  }

  // Screen position of the auto-aim target while the bow is drawn; the centre
  // otherwise. Reads the camera render() last posed.
  function reticle() {
    const target = g.monsters.find(m => m.id === g.aim.targetId && m.hp > 0);
    const locked = Boolean(target && g.bow.drawing);
    let rx = 50, ry = 50;
    if (locked) {
      tmp.copy(target.pos).setY(target.pos.y + (target.kind === 'thrower' ? 1.5 : 1.1)).project(camera);
      rx = Math.min(96, Math.max(4, (tmp.x * 0.5 + 0.5) * 100));
      ry = Math.min(94, Math.max(6, (-tmp.y * 0.5 + 0.5) * 100));
    }
    return { locked, rx, ry };
  }

  // HUD values the in-page HUD derives here; read() ships them to the overlay.
  function hudState() {
    const { locked, rx, ry } = reticle();
    return {
      guards: g.monsters.map(m => ({ boss: m.kind === 'thrower', dead: m.hp <= 0 })),
      drawing: g.bow.drawing,
      charge: Math.round(g.bow.charge * 100) / 100,
      locked,
      reticleX: Math.round(rx * 10) / 10,
      reticleY: Math.round(ry * 10) / 10,
      hitFlash: Math.round(Math.min(1, g.player.hitFlash * 2) * 20) / 20,
    };
  }

  // Pure: reads only the event and constant copy, never the live game.
  function describeEvent(event) {
    switch (event.type) {
      case 'round.started': return 'The hooded archer sets off down the dirt path from the grassy rise toward the distant shrine.';
      case 'bow.drawn': return 'The archer draws the bowstring.';
      case 'arrow.fired': return event.assisted
        ? 'An arrow looses toward a locked monster.'
        : 'An arrow flies along the line of sight.';
      case 'arrow.missed': return 'The arrow sticks into the ground.';
      case 'monster.alerted': return 'A shrine guard spots the archer and gives chase.';
      case 'monster.swung': return 'A guard swings its club.';
      case 'monster.threw': return 'The great club thrower hurls a rock.';
      case 'monster.hit': return 'An arrow strikes a shrine guard.';
      case 'monster.killed': return event.remaining > 0
        ? `A guard falls; ${event.remaining} still hold the shrine.`
        : 'The last shrine guard falls.';
      case 'player.hit': return event.cause === 'rock'
        ? 'A hurled rock strikes the archer.'
        : 'A guard\'s club catches the archer.';
      case 'round.won': return 'Every guard is down; the shrine door stands open.';
      case 'round.lost': return 'The archer falls to the shrine guards.';
      default: return null;
    }
  }

  syncVisuals(0);
  return {
    canvas: renderer.domElement,
    update(dt, nextInput) {
      keyboard = nextInput;
      if (input.consumePress('pause')) togglePause();
      if (!paused) {
        game.update(dt, input);
        stepTurns(dt);
        if (finished()) { paused = false; clearInput(); }
      }
    },
    layout(width, height) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    read() {
      const snap = game.read();
      // Only a live run can be paused; the flag is what holds the rollout.
      const out = { ...snap, paused: paused && snap.state === 'RUNNING', ...hudState() };
      // The runtime stitches these sentences into the chunk's dynamic prompt.
      // Null means the event has no prompt line and is dropped.
      out.events = snap.events.map(event => ({ ...event, prompt: describeEvent(event) }));
      return out;
    },
    describeEvent,
    // Overlay clicks, and P / Escape themselves: probe() never steps update(),
    // so a paused run must be resumable from here while generation is held.
    // Returning true keeps the keydown away from the game's own pause binding.
    handleUiAction(action) {
      if (action === 'reset' || action === 'restart') { clearInput(); host.restart(); return true; }
      if (action === 'p' || action === 'escape' || action === 'pause' || action === 'resume') {
        if (action === 'resume' && !paused) return true;
        togglePause();
        return true;
      }
      return false;
    },
    // Poses run on sim time from update(); dt only spins the thrown rocks.
    render(_dt) { syncVisuals(1 / 60); renderer.render(scene, camera); },
    reset: resetVisuals,
    automation: () => ({
      visual: {
        player: world.player.root.position.toArray(),
        monsters: [...monsterViews.values()].map(v => v.root.position.toArray()),
        camera: camera.position.toArray(),
        drawCalls: renderer.info.render.calls,
      },
    }),
    destroy() {
      listeners.abort();
      clearInput();
      const geometries = new Set(), materials = new Set(), textures = new Set();
      scene.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (!material) continue; materials.add(material);
          for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        }
      });
      for (const resource of [...geometries, ...materials, ...textures]) resource.dispose();
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}
