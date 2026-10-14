import * as THREE from 'three';
import { createRenderer } from '/assets/user-interface/PrototypeShell.js';
import { createGame } from './game.mjs';
import { createWorld, poseFighter, faceYaw } from './scene.js';

const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
const setHTML = (node, html) => { if (node && node.innerHTML !== html) node.innerHTML = html; };
const setHidden = (node, hidden) => { if (node && node.hidden !== hidden) node.hidden = hidden; };
const setScaleX = (node, value) => {
  const next = `scaleX(${value})`;
  if (node && node.style.transform !== next) node.style.transform = next;
};

const wrapPi = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const CAMERA_FACE = Math.PI;
const TURN = 0.42;

export function createRuntime(host) {
  const renderer = createRenderer(document.querySelector('#app'), { shadows: true, pixelRatio: 1 });
  renderer.toneMapping = THREE.NoToneMapping;
  const world = createWorld();
  const { scene, camera, player, rival, sparks } = world;
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
    KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
    KeyW: 'jump', ArrowUp: 'jump', Space: 'jump',
    KeyJ: 'punch', KeyK: 'kick', KeyL: 'guard',
    KeyP: 'pause', Escape: 'pause',
  });
  const pad = { held: new Map(), pressed: new Set() };
  let keyboard = host.input;
  function clearInput() { keyboard.clear(); pad.held.clear(); pad.pressed.clear(); }
  const input = {
    isDown: action => keyboard.isDown(action) || [...pad.held.values()].includes(action),
    consumePress(action) {
      const key = keyboard.consumePress(action), pointer = pad.pressed.delete(action);
      return key || pointer;
    },
    axis: (negative, positive) => Number(input.isDown(positive)) - Number(input.isDown(negative)),
    clear: clearInput,
  };
  const game = createGame({ onTransition: () => clearInput() });

  for (const button of touch.querySelectorAll('[data-action]')) {
    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      button.blur();
      const snapshot = game.read();
      if (snapshot.paused || snapshot.state === 'WON' || snapshot.state === 'LOST') {
        if (button.dataset.action === 'pause') pad.pressed.add('pause');
        return;
      }
      button.setPointerCapture(event.pointerId);
      pad.held.set(event.pointerId, button.dataset.action);
      pad.pressed.add(button.dataset.action);
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
  // A background blur only drops held input; it never pauses (that would
  // hold generation on a focus change nobody asked for).
  window.addEventListener('blur', clearInput, options);
  document.addEventListener('visibilitychange', clearInput, options);

  const yaw = { player: faceYaw(1), rival: faceYaw(-1) };
  function snapTurns(s) {
    yaw.player = faceYaw(s.player.facing);
    yaw.rival = faceYaw(s.rival.facing);
  }
  function stepTurns(dt, s) {
    const spin = Math.PI / TURN * dt;
    const seek = (id, facing) => {
      const target = faceYaw(facing);
      const fromS = wrapPi(yaw[id] - CAMERA_FACE), toS = wrapPi(target - CAMERA_FACE);
      const delta = wrapPi(toS - fromS);
      yaw[id] = Math.abs(delta) <= spin ? target : wrapPi(fromS + Math.sign(delta) * spin + CAMERA_FACE);
    };
    seek('player', s.player.facing);
    seek('rival', s.rival.facing);
  }
  snapTurns(game.read());

  let lastImpactId = 0, lastRound = 0, effectAge = 10, terminalAge = 0;

  function poseScene(s, visualDt) {
    if (lastRound !== s.roundId) {
      lastRound = s.roundId;
      terminalAge = 0;
      effectAge = 10;
      lastImpactId = 0;
    }
    const finished = s.state === 'WON' || s.state === 'LOST';
    if (finished) terminalAge += visualDt;
    // READY animates the idle stance on its own idle timer.
    const poseTime = finished ? terminalAge : s.state === 'READY' ? s.readyTime : s.elapsed;
    for (const [id, f] of [['player', s.player], ['rival', s.rival]]) {
      const view3d = world[id];
      poseFighter(view3d, { ...f, actionTime: finished ? terminalAge : f.actionTime }, poseTime);
      view3d.root.rotation.y = yaw[id] ?? faceYaw(f.facing);
      view3d.marker.material.opacity = f.telegraph ? 0.65 : f.hp > 0 ? 0.42 : 0;
      view3d.marker.scale.setScalar(f.telegraph ? 1.25 : 1);
      view3d.marker.scale.y *= 0.45;
    }
    if (s.impact && s.impact.id !== lastImpactId) {
      lastImpactId = s.impact.id;
      effectAge = 0;
    }
    if (!s.paused) effectAge += visualDt;
    for (let i = 0; i < sparks.length; i++) {
      const spark = sparks[i], impact = s.impact;
      spark.visible = !!impact && effectAge < 0.34;
      if (!spark.visible) continue;
      const angle = i * 2.39996, speed = 2.4 + (i % 4) * 0.8, size = (1 - effectAge / 0.34) * (i % 3 === 0 ? 1.8 : 1);
      spark.position.set(impact.x + Math.cos(angle) * effectAge * speed, impact.y + Math.sin(angle) * effectAge * speed - effectAge * effectAge * 4, 0.45 + (i % 3) * 0.06);
      spark.scale.set(size * 2.4, size * 0.6, size * 0.6);
      spark.rotation.z = angle;
      spark.material.color.setHex(impact.blocked ? 0x68dedc : i % 3 ? 0xe8c56a : 0xffffff);
    }
    camera.position.copy(world.baseCamera);
    if (!s.paused && effectAge < 0.14 && s.impact && !s.impact.blocked) {
      camera.position.x += Math.sin(effectAge * 130) * 0.055 * (1 - effectAge / 0.14);
    }
  }

  // HUD strings shared by the in-page HUD and the streamed overlay.
  function hudText(s) {
    const status = s.paused ? 'PAUSED' : s.state === 'WON' ? 'KAI WINS · RIVAL KNOCKED OUT' : s.state === 'LOST' ? 'RAZE WINS · PLAYER KNOCKED OUT' : s.state === 'READY' ? 'STREET DUEL' : s.rival.telegraph ? 'INCOMING ATTACK · L TO GUARD' : 'STREET DUEL';
    const banner = s.paused ? 'PAUSED' : s.state === 'WON' ? 'YOU WIN' : s.state === 'LOST' ? 'K.O.' : s.state === 'RUNNING' && s.elapsed < 0.7 ? 'FIGHT!' : '';
    const feedback = s.state === 'RUNNING' && !s.paused ? s.feedback : '';
    return { status, banner, feedback };
  }

  function present(s) {
    setText(view['player-hp'], String(Math.round(s.player.hp)));
    setText(view['rival-hp'], String(Math.round(s.rival.hp)));
    setScaleX(view['player-health'], s.player.hp / 100);
    setScaleX(view['player-trail'], s.player.hp / 100);
    setScaleX(view['rival-health'], s.rival.hp / 100);
    setScaleX(view['rival-trail'], s.rival.hp / 100);
    const seconds = Math.floor(s.elapsed);
    setText(view['match-clock'], `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`);
    const { status, banner, feedback } = hudText(s);
    setText(view.feedback, feedback);
    setText(view['round-state'], status);
    setText(view['round-banner'], banner);
    setHidden(view['round-banner'], !banner);
    if (view.pause && view.pause.disabled !== (s.state !== 'RUNNING')) view.pause.disabled = s.state !== 'RUNNING';
    const showOverlay = s.paused || s.state === 'WON' || s.state === 'LOST';
    setHidden(view.overlay, !showOverlay);
    setHidden(big.overlay, !showOverlay);
    setHidden(touch, showOverlay);
    if (!showOverlay) return;
    const fill = nodes => {
      setHidden(nodes.resume, !s.paused);
      setText(nodes['result-hint'], s.paused ? 'P / ESC TO RESUME · R TO RESTART' : 'PRESS R TO RESTART');
      if (s.paused) {
        setText(nodes['result-kicker'], 'ROUND ON HOLD');
        setText(nodes['result-title'], 'PAUSED');
        setText(nodes['result-text'], 'Take a breath. The street is waiting.');
        setHTML(nodes['result-stats'], `<span>TIME <b>${Math.floor(s.elapsed)}s</b></span><span>HP <b>${Math.round(s.player.hp)}</b></span>`);
        setText(nodes.restart, 'RESTART ROUND');
      } else {
        const won = s.state === 'WON';
        setText(nodes['result-kicker'], won ? 'RUN COMPLETE' : 'ROUND ENDED');
        setText(nodes['result-title'], won ? 'YOU WIN' : 'K.O.');
        setText(nodes['result-text'], won ? 'Raze is down. The block belongs to Kai.' : 'Raze takes the round. Reset and step back in.');
        setHTML(nodes['result-stats'], `<span>TIME <b>${Math.floor(s.elapsed)}s</b></span><span>HITS <b>${s.player.punchHits + s.player.kickHits}</b></span><span>MAX COMBO <b>${s.player.maxCombo}</b></span>`);
        setText(nodes.restart, won ? 'FIGHT AGAIN ↗' : 'TRY AGAIN ↗');
      }
    };
    fill(view);
    fill(big);
  }

  // Pure: reads only the event payload and constant copy.
  function describeEvent(event) {
    switch (event.type) {
      case 'round.started': return 'Kai and Raze face each other on the street.';
      case 'combat.attack': return event.actor === 'player'
        ? `Kai throws a ${event.kind}.`
        : `Raze throws a ${event.kind}.`;
      case 'combat.jump': return event.actor === 'player' ? 'Kai jumps.' : 'Raze jumps.';
      case 'combat.hit': return event.blocked
        ? `${event.target === 'player' ? 'Kai' : 'Raze'} guards the ${event.kind}.`
        : `${event.actor === 'player' ? 'Kai' : 'Raze'} lands a ${event.kind}.`;
      case 'round.won': return 'Raze is knocked out. Kai wins the street duel.';
      case 'round.lost': return 'Kai is knocked out. Raze takes the round.';
      default: return null;
    }
  }

  poseScene(game.read(), 0);
  return {
    canvas: renderer.domElement,
    update(dt, nextInput) {
      keyboard = nextInput;
      game.handleInput(input);
      game.update(dt, input);
      const s = game.read();
      if (!s.paused && s.state === 'RUNNING') stepTurns(dt, s);
      if (s.state === 'WON' || s.state === 'LOST') clearInput();
    },
    layout(width, height) {
      renderer.setSize(width, height, false);
      const halfHeight = 4.8;
      const aspect = width / height;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.left = -halfHeight * aspect;
      camera.right = halfHeight * aspect;
      camera.updateProjectionMatrix();
    },
    read() {
      const s = game.read();
      Object.assign(s, hudText(s));
      // The runtime stitches these into the chunk's dynamic prompt; null drops.
      s.events = s.events.map(event => ({ ...event, prompt: describeEvent(event) }));
      return s;
    },
    describeEvent,
    // Overlay buttons and the pause keys. probe() never steps update() while
    // paused, so the pause toggle lives here; returning true swallows the key
    // so update() cannot toggle it a second time.
    handleUiAction(action) {
      if (action === 'reset' || action === 'restart') {
        clearInput(); host.restart();
        return true;
      }
      if (action === 'p' || action === 'escape' || action === 'pause' || action === 'resume') {
        const s = game.read();
        if (s.state !== 'RUNNING') return true;
        if (action === 'resume') { if (s.paused) game.pause(false); return true; }
        game.pause();
        return true;
      }
      return false;
    },
    // dt = sim seconds since the last capture, so effects are deterministic.
    render(dt) {
      const visualDt = Math.min(Number.isFinite(dt) ? dt : 0, 0.1);
      const s = game.read();
      poseScene(s, visualDt);
      present(s);
      renderer.render(scene, camera);
    },
    reset() {
      clearInput();
      game.reset();
      lastImpactId = 0;
      lastRound = 0;
      effectAge = 10;
      terminalAge = 0;
      snapTurns(game.read());
      player.visual.reset();
      rival.visual.reset();
      poseScene(game.read(), 0);
    },
    automation: () => ({
      visual: {
        player: player.root.position.toArray(),
        rival: rival.root.position.toArray(),
        camera: camera.position.toArray(),
        drawCalls: renderer.info.render.calls,
        yaw: { ...yaw },
      },
    }),
    destroy() {
      listeners.abort();
      clearInput();
      const geometries = new Set(), materials = new Set(), textures = new Set();
      scene.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (!material) continue;
          materials.add(material);
          for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        }
      });
      for (const resource of [...geometries, ...materials, ...textures]) resource.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
