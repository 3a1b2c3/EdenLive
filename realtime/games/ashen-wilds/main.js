import * as THREE from 'three';
import { createRenderer } from '/assets/user-interface/PrototypeShell.js';
import { createGame } from './game.mjs';
import { createWorld } from './scene.js';

const TAU = Math.PI * 2;
const TURN = 0.42;
const MOVE_ANIM = 0.42;
const wrapPi = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
const setHTML = (node, html) => { if (node && node.innerHTML !== html) node.innerHTML = html; };
const setHidden = (node, hidden) => { if (node && node.hidden !== hidden) node.hidden = hidden; };
const setWidth = (node, width) => { if (node && node.style.width !== width) node.style.width = width; };
const setClass = (node, name, on) => { if (node && node.classList.contains(name) !== on) node.classList.toggle(name, on); };

export function createRuntime(host) {
  const renderer = createRenderer(document.querySelector('#app'), { pixelRatio: 1, shadows: true });
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', 'Ashen Wilds game view');
  const world = createWorld();
  const { scene, camera, playerVisual, goatVisual, bossVisual, marker, arenaParts, effects } = world;
  const game = createGame({ obstacles: world.obstacles });
  const view = Object.fromEntries([...document.querySelectorAll('#hud [id]')].map(node => [node.id, node]));
  const big = {
    overlay: document.getElementById('overlay-big'),
    'result-kicker': document.getElementById('big-result-kicker'),
    'result-title': document.getElementById('big-result-title'),
    'result-text': document.getElementById('big-result-text'),
    'result-stats': document.getElementById('big-result-stats'),
    resume: document.getElementById('big-resume'),
    restart: document.getElementById('big-restart'),
    'result-hint': document.getElementById('big-result-hint'),
  };
  const touch = document.querySelector('.touch');
  const listeners = new AbortController(), options = { signal: listeners.signal };

  host.input.bind({
    KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right',
    ArrowLeft: 'cameraLeft', ArrowRight: 'cameraRight', ArrowUp: 'cameraUp', ArrowDown: 'cameraDown',
    Space: 'dodge', KeyJ: 'attack', KeyQ: 'lock',
    ShiftLeft: 'sprint', ShiftRight: 'sprint',
    KeyP: 'pause', Escape: 'pause',
  });

  const pad = { held: new Map(), pressed: new Set() };
  const finished = () => game.state === 'WON' || game.state === 'LOST';
  let keyboard = host.input;
  function clearInput() {
    keyboard.clear();
    pad.held.clear();
    pad.pressed.clear();
    game.clearInput();
  }
  const input = {
    isDown: action => keyboard.isDown(action) || [...pad.held.values()].includes(action),
    consumePress(action) {
      const key = keyboard.consumePress(action), pointer = pad.pressed.delete(action);
      return key || pointer;
    },
  };

  renderer.domElement.addEventListener('contextmenu', event => event.preventDefault(), options);

  for (const button of touch.querySelectorAll('[data-action]')) {
    button.addEventListener('pointerdown', event => {
      event.preventDefault(); button.blur();
      const action = button.dataset.action;
      if (action === 'pause') { pad.pressed.add('pause'); return; }
      if (game.paused || finished()) return;
      button.setPointerCapture(event.pointerId);
      if (button.dataset.hold === '1') pad.held.set(event.pointerId, action);
      else pad.pressed.add(action);
    }, options);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      button.addEventListener(type, event => { pad.held.delete(event.pointerId); }, options);
    }
  }
  for (const restart of [view.restart, big.restart]) {
    restart.addEventListener('click', () => { restart.blur(); clearInput(); host.restart(); }, options);
  }
  for (const button of [view.pause, view.resume, big.resume]) {
    button.addEventListener('click', () => { button.blur(); pad.pressed.add('pause'); }, options);
  }
  // Headless capture: a blur only drops held input, it never pauses the run,
  // so a background focus change cannot hold generation.
  window.addEventListener('blur', clearInput, options);
  document.addEventListener('visibilitychange', clearInput, options);
  function togglePause() {
    // Pause is live-play only: READY and outcomes have their own cues.
    if (game.state !== 'RUNNING') return;
    game.paused = !game.paused;
    clearInput();
  }

  const presented = { player: 0, goat: 0, boss: 0 };
  const desiredCamera = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  function snapTurns() {
    presented.player = game.player.yaw;
    presented.goat = game.goat.yaw;
    presented.boss = game.boss.yaw;
  }
  function stepTurns(dt) {
    const spin = Math.PI / TURN * dt;
    const camFace = game.cameraYaw + Math.PI;
    const seek = (key, target) => {
      const fromS = wrapPi(presented[key] - camFace);
      const toS = wrapPi(target - camFace);
      const delta = wrapPi(toS - fromS);
      presented[key] = Math.abs(delta) <= spin ? target : wrapPi(fromS + Math.sign(delta) * spin + camFace);
    };
    seek('player', game.player.yaw);
    seek('goat', game.goat.yaw);
    seek('boss', game.boss.yaw);
  }
  snapTurns();

  function resetActors() {
    playerVisual.reset(); goatVisual.reset(); bossVisual.reset();
    playerVisual.rig.body.rotation.set(0, 0, 0);
    playerVisual.rig.body.position.y = 0;
  }

  function poseScene() {
    // Idle cycles keep breathing through READY on the sim-driven ready clock.
    const p = game.player, t = game.elapsed + game.readyTime, a = game.actionTime;
    const roll = game.rollDirection;
    playerVisual.mesh.position.set(p.x, 0, p.z);
    playerVisual.mesh.rotation.set(0, presented.player, 0);
    if (game.state === 'LOST') {
      playerVisual.setPose('idle', 0);
      playerVisual.rig.body.rotation.x = -Math.PI / 2;
      playerVisual.rig.body.position.y = 0.35;
    } else if (game.action === 'attack') {
      playerVisual.rig.body.rotation.set(0, 0, 0);
      playerVisual.rig.body.position.y = 0;
      playerVisual.setPose('right:slash', a / 0.66 * 1.1);
    } else if (game.action === 'dodge') {
      playerVisual.setPose('idle', 0);
      playerVisual.mesh.rotation.y = Math.atan2(-roll.x, -roll.z);
      playerVisual.rig.body.rotation.x = -Math.min(1, a / 0.66) * TAU;
      playerVisual.rig.body.position.y = 0.8 + Math.sin(a / 0.66 * Math.PI) * 0.35;
      playerVisual.rig.legs.forEach(l => { l.hip.rotation.x = -0.75; });
    } else {
      playerVisual.rig.body.rotation.set(0, 0, 0);
      playerVisual.rig.body.position.y = 0;
      playerVisual.setPose(game.moving ? 'run' : 'idle', game.moving ? t * MOVE_ANIM : t);
    }
    for (const [e, v, key] of [[game.goat, goatVisual, 'goat'], [game.boss, bossVisual, 'boss']]) {
      v.mesh.position.set(e.x, 0, e.z);
      v.mesh.rotation.y = presented[key];
      if (e.health <= 0) v.setPose('death', game.state === 'WON' ? 1.1 : Math.min(1.1, e.deadTime), { inPlace: true });
      else if (e.phase === 'telegraph') v.setPose(e.id === 'goat' ? 'charge' : 'action', e.id === 'goat' ? (0.8 - e.timer) * 0.35 : (1.05 - e.timer) * 0.6, { inPlace: true });
      else if (e.phase === 'impact') v.setPose('charge', 0.65 + (0.38 - e.timer), { inPlace: true });
      else v.setPose(e.moved ? 'move' : 'idle', e.moved ? t * MOVE_ANIM : t);
    }
    const b = game.boss, g = game.goat;
    const bossRange = (b.phase === 'telegraph' || b.phase === 'impact') && game.state === 'RUNNING';
    const goatRange = (g.phase === 'telegraph' || g.phase === 'impact') && game.state === 'RUNNING';
    arenaParts.telegraph.visible = bossRange;
    arenaParts.core.visible = bossRange;
    arenaParts.telegraph.position.set(b.x, 0.10, b.z);
    arenaParts.core.position.set(b.x, 0.085, b.z);
    effects.goatRing.visible = goatRange;
    effects.goatRing.position.set(g.x, 0.06, g.z);
    if (!finished()) {
      const yaw = game.cameraYaw, pitch = game.cameraPitch;
      const dist = game.lockedTarget === 'boss' ? 4.2 : 3.6;
      desiredCamera.set(p.x + Math.sin(yaw) * dist, 2.0 + pitch * 4.0, p.z + Math.cos(yaw) * dist);
      camera.position.copy(desiredCamera);
      lookTarget.set(p.x, 2.12, p.z);
      camera.lookAt(lookTarget);
    }
    effects.lock.visible = Boolean(game.lockedTarget) && game.state === 'RUNNING';
    if (game.lockedTarget) {
      const e = game[game.lockedTarget];
      effects.lock.position.set(e.x, e.id === 'boss' ? 3.1 : 1.3, e.z);
      effects.lock.quaternion.copy(camera.quaternion);
    }
    marker.visible = !game.boss.active && !finished();
    marker.position.set(b.x, 6.4, b.z);
    marker.quaternion.copy(camera.quaternion);
  }

  // HUD strings the in-page HUD derives here; read() ships them to the overlay.
  function hudText() {
    return {
      objective: game.boss.health <= 0
        ? 'The Stone Warden has fallen'
        : game.goat.health > 0 ? 'Cross the meadow. Defeat the Stone Warden.' : 'The goat is down. Reach the stone circle.',
      lockLabel: game.lockedTarget === 'boss' ? 'LOCKED · WARDEN' : game.lockedTarget === 'goat' ? 'LOCKED · GOAT' : 'NO LOCK',
      alert: game.feedbackTime > 0 ? game.feedback : (
        game.boss.phase === 'telegraph' ? 'WARDEN STRIKE · ROLL' : game.goat.phase === 'telegraph' ? 'GOAT CHARGE · DODGE' : ''
      ),
      dodgeReady: game.stamina >= 28,
      vignette: Number(Math.min(1, game.hitFlash * 1.6).toFixed(3)),
    };
  }
  function present() {
    const hp = game.playerHealth;
    const text = hudText();
    setWidth(view['hp-fill'], `${hp / 6 * 100}%`);
    setText(view['hp-text'], `${hp} / 6`);
    setWidth(view['stamina-fill'], `${game.stamina}%`);
    setText(view['stamina-text'], `${Math.round(game.stamina)}`);
    setWidth(view['goat-fill'], `${game.goat.health / 3 * 100}%`);
    setText(view['goat-text'], game.goat.health > 0 ? `${game.goat.health} / 3` : 'DOWN');
    setClass(view['goat-hud'], 'down', game.goat.health <= 0);
    setWidth(view['boss-fill'], `${game.boss.health / 12 * 100}%`);
    setText(view['boss-percent'], `${Math.ceil(game.boss.health / 12 * 100)}%`);
    setHidden(view['boss-hud'], !game.boss.active && game.boss.health > 0);
    setText(view.objective, text.objective);
    setText(view['lock-label'], text.lockLabel);
    setText(view.alert, text.alert);
    setText(view['dodge-ready'], text.dodgeReady ? 'ROLL READY' : 'LOW STAMINA');
    setClass(view['dodge-ready'], 'cooldown', !text.dodgeReady);
    setStyleVignette(view.vignette, game.hitFlash);
    // READY is the start line, not an outcome: no card.
    const showOverlay = game.paused || finished();
    setHidden(view.overlay, !showOverlay); setHidden(big.overlay, !showOverlay); setHidden(touch, showOverlay);
    if (view.pause && view.pause.disabled !== showOverlay) view.pause.disabled = showOverlay;
    if (view.resume) view.resume.blur();
    if (big.resume) big.resume.blur();
    if (!showOverlay) return;
    const fill = nodes => {
      setHidden(nodes.resume, !game.paused);
      setText(nodes['result-hint'], game.paused ? 'P / ESC TO RESUME · R TO RESTART' : 'PRESS R TO RESTART');
      if (game.paused) {
        setText(nodes['result-kicker'], 'HOLD');
        setText(nodes['result-title'], 'PAUSED');
        setText(nodes['result-text'], 'Press P or Escape to return to the highland.');
        setText(nodes['result-stats'], '');
        setText(nodes.restart, 'RESTART RUN');
      } else {
        const won = game.state === 'WON';
        setText(nodes['result-kicker'], won ? 'OATH BROKEN' : 'FALLEN');
        setText(nodes['result-title'], won ? 'HIGHLAND STILL' : 'DOWN, NOT DONE');
        setText(nodes['result-text'], won
          ? 'The Stone Warden falls in the circle. The meadow is quiet again.'
          : game.outcomeReason);
        setHTML(nodes['result-stats'], `<span>HITS <b>${game.hitCount}</b></span><span>ROLLS <b>${game.dodgeCount}</b></span><span>TIME <b>${Math.floor(game.elapsed)}s</b></span>`);
        setText(nodes.restart, won ? 'WALK IT AGAIN ↗' : 'TRY AGAIN ↗');
      }
    };
    fill(view); fill(big);
  }
  function setStyleVignette(node, flash) {
    if (!node) return;
    const next = `inset 0 0 90px rgba(255,45,74,${(flash * 1.6).toFixed(3)})`;
    if (node.style.boxShadow !== next) node.style.boxShadow = next;
  }
  // Pure: reads only the event and constant copy, never the live game.
  function describeEvent(event) {
    switch (event.type) {
      case 'round.started': return 'The plate-armoured knight sets off along the worn dirt path toward the distant stone circle.';
      case 'player.attack': return 'The knight swings the sword.';
      case 'player.attack.miss': return 'The knight’s swing finds only air.';
      case 'player.dodge': return 'The knight rolls clear of the strike.';
      case 'player.evade': return 'The knight slips through an incoming blow.';
      case 'player.hit': return event.source === 'boss'
        ? 'The Stone Warden’s strike lands on the knight.'
        : 'The wild goat slams into the knight.';
      case 'goat.alert': return 'The wild goat notices the knight and lowers its head.';
      case 'goat.telegraph': return 'The goat plants its hooves, ready to charge.';
      case 'goat.attack': return 'The goat charges across the meadow.';
      case 'goat.hit': return 'The knight’s blade cuts the goat.';
      case 'goat.defeated': return 'The wild goat collapses on the grass.';
      case 'boss.awaken': return 'The Stone Warden stirs inside the standing-stone circle.';
      case 'boss.telegraph': return 'A red ring flares at the Warden’s feet.';
      case 'boss.attack': return 'The Stone Warden brings the glaive down.';
      case 'boss.attack.miss': return 'The Warden’s glaive slams into empty ground.';
      case 'boss.hit': return 'The knight’s sword bites the Stone Warden.';
      case 'boss.defeated': return 'The Stone Warden falls among the standing stones.';
      case 'round.won': return 'The stone oath breaks and the highland is still.';
      case 'round.lost': return typeof event.reason === 'string' && event.reason ? event.reason : null;
      default: return null;
    }
  }

  poseScene();
  return {
    canvas: renderer.domElement,
    update(dt, nextInput) {
      keyboard = nextInput;
      if (input.consumePress('pause')) togglePause();
      game.handleInput(input);
      game.update(dt, input);
      if (!game.paused) stepTurns(dt);
      if (finished()) clearInput();
    },
    layout(width, height) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    read() {
      const snap = { ...game.read(), ...hudText() };
      // The runtime stitches these sentences into the chunk's dynamic prompt.
      // Null means the event has no prompt line and is dropped.
      snap.events = snap.events.map(event => ({ ...event, prompt: describeEvent(event) }));
      return snap;
    },
    describeEvent,
    // Overlay clicks, and P / Escape themselves: probe() never steps update(),
    // so a paused run must be resumable from here while generation is held.
    // Returning true keeps the keydown away from the game's own pause binding.
    handleUiAction(action) {
      if (action === 'reset' || action === 'restart') {
        clearInput(); host.restart();
        return true;
      }
      if (action === 'p' || action === 'escape' || action === 'pause' || action === 'resume') {
        if (action === 'resume' && !game.paused) return true;
        togglePause();
        return true;
      }
      return false;
    },
    // All animation runs on sim time accumulated in update(); dt is the same
    // span, kept in the signature for the shared host contract.
    render(_dt) { poseScene(); present(); renderer.render(scene, camera); },
    reset() {
      clearInput();
      game.reset();
      resetActors();
      snapTurns();
      poseScene();
    },
    automation: () => ({
      visual: {
        player: playerVisual.mesh.position.toArray(),
        goat: goatVisual.mesh.position.toArray(),
        boss: bossVisual.mesh.position.toArray(),
        camera: camera.position.toArray(),
        yaw: { ...presented },
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
