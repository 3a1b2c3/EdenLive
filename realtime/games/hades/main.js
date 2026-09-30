import * as THREE from 'three';
import { createRenderer } from '/assets/user-interface/PrototypeShell.js';
import { createGame } from './game.mjs';
import { createWorld } from './scene.js';

const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
const setHTML = (node, html) => { if (node && node.innerHTML !== html) node.innerHTML = html; };
const setHidden = (node, hidden) => { if (node && node.hidden !== hidden) node.hidden = hidden; };
const setWidth = (node, width) => { if (node && node.style.width !== width) node.style.width = width; };
const setClass = (node, name, on) => { if (node && node.classList.contains(name) !== on) node.classList.toggle(name, on); };

const wrapPi = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const CAMERA_FACE = Math.PI;
const TURN = 0.42;

export function createRuntime(host) {
  const renderer = createRenderer(document.querySelector('#app'), { shadows: true, pixelRatio: 1 });
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const world = createWorld();
  const { scene, camera, hero, wardens, boss, warnings, slash, nova, flames, gateSeal, portal, heroRing } = world;
  const game = createGame();
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
    KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
    KeyJ: 'attack', KeyK: 'nova', Space: 'dash', KeyP: 'pause', Escape: 'pause',
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

  // Keyboard-only port: the original's left/right mouse shortcuts for slash
  // and nova are gone; J and K are the only bindings.

  for (const button of touch.querySelectorAll('[data-action]')) {
    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      button.blur();
      const snapshot = game.read();
      if (snapshot.paused || (snapshot.state !== 'RUNNING' && snapshot.state !== 'READY')) {
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
  window.addEventListener('blur', clearInput, options);
  document.addEventListener('visibilitychange', clearInput, options);

  const yaw = { hero: 0, 'warden-violet': 0, 'warden-rust': 0, asterion: 0 };
  function faceTarget(id, target) {
    if (yaw[id] == null) yaw[id] = target;
  }
  function snapTurns(s) {
    yaw.hero = s.playerFacing;
    yaw['warden-violet'] = Math.atan2(s.wardens[0].x - s.playerX, s.wardens[0].z - s.playerZ);
    yaw['warden-rust'] = Math.atan2(s.wardens[1].x - s.playerX, s.wardens[1].z - s.playerZ);
    yaw.asterion = Math.atan2(s.boss.x - s.playerX, s.boss.z - s.playerZ);
  }
  function stepTurns(dt, s) {
    const spin = Math.PI / TURN * dt;
    const seek = (id, target) => {
      faceTarget(id, target);
      const fromS = wrapPi(yaw[id] - CAMERA_FACE), toS = wrapPi(target - CAMERA_FACE);
      const delta = wrapPi(toS - fromS);
      yaw[id] = Math.abs(delta) <= spin ? target : wrapPi(fromS + Math.sign(delta) * spin + CAMERA_FACE);
    };
    seek('hero', s.playerFacing);
    seek('warden-violet', Math.atan2(s.wardens[0].x - s.playerX, s.wardens[0].z - s.playerZ));
    seek('warden-rust', Math.atan2(s.wardens[1].x - s.playerX, s.wardens[1].z - s.playerZ));
    seek('asterion', Math.atan2(s.boss.x - s.playerX, s.boss.z - s.playerZ));
  }

  snapTurns(game.read());

  function poseScene(s) {
    // READY has no combat clock; the idle stance runs on readyTime instead.
    const t = s.state === 'READY' ? s.readyTime : s.elapsed;
    const moveT = t * 0.48;
    hero.mesh.position.set(s.playerX, 0.13, s.playerZ);
    hero.mesh.rotation.y = yaw.hero;
    hero.mesh.rotation.z = s.state === 'LOST' ? -1.25 : 0;
    hero.mesh.scale.setScalar(1);
    hero.mesh.visible = true;
    hero.setPose(s.playerMoving ? 'run' : 'idle', s.playerMoving ? moveT : t);
    heroRing.position.set(s.playerX, 0.18, s.playerZ);
    slash.visible = s.attackCooldown > 0;
    slash.position.set(s.playerX, 0, s.playerZ);
    nova.visible = !s.novaReady && s.novaCooldown > 4.2;
    nova.position.set(s.playerX, 0, s.playerZ);

    const allStates = [...s.wardens, s.boss];
    [...wardens, boss].forEach((visual, i) => {
      const enemy = allStates[i];
      const id = enemy.id;
      visual.mesh.visible = i === 2 ? s.bossSpawned && !s.bossDefeated : enemy.alive;
      visual.mesh.position.set(enemy.x, 0.12, enemy.z);
      visual.mesh.rotation.y = yaw[id] ?? 0;
      const action = enemy.pose === 'attack' ? 'action' : enemy.pose === 'move' ? 'move' : enemy.pose === 'death' ? 'idle' : 'idle';
      visual.setPose(action, action === 'move' ? moveT : t, { inPlace: true });
      visual.mesh.scale.setScalar(1);
      warnings[i].visible = enemy.alive && enemy.windup > 0;
      warnings[i].position.set(enemy.x, 0, enemy.z);
    });
    gateSeal.visible = !s.bossDefeated;
    portal.visible = s.bossDefeated;
    if ((s.state === 'RUNNING' || s.state === 'READY') && !s.paused) {
      for (let i = 0; i < flames.length; i++) {
        flames[i].scale.y = 1.5 + Math.sin(t * 7 + i * 2) * 0.17;
        flames[i].rotation.y = t * 0.5 + i;
      }
    }
  }

  function present(s) {
    // READY is not an outcome: the chamber waits without a card.
    const showOverlay = s.paused || s.state === 'WON' || s.state === 'LOST';
    setWidth(view['hp-fill'], `${s.playerHealth / s.playerMaxHealth * 100}%`);
    setText(view['hp-text'], `${Math.round(s.playerHealth)} / ${s.playerMaxHealth}`);
    setText(view.count, `${s.wardensDefeated} / ${s.totalWardens}`);
    setClass(view['seal-one'], 'done', s.wardens[0].hp <= 0);
    setClass(view['seal-two'], 'done', s.wardens[1].hp <= 0);
    setText(view.objective, s.bossDefeated ? 'The Last Gate is open' : s.bossSpawned ? 'Defeat Asterion' : 'Defeat the two wardens');
    setText(view['objective-label'], s.bossSpawned ? 'THE LAST GATE' : 'CHAMBER OF ASHES');
    setHidden(view['boss-hud'], !(s.bossSpawned && !s.bossDefeated));
    if (view['boss-hud'] && !view['boss-hud'].hidden) {
      setWidth(view['boss-fill'], `${s.boss.hp / s.boss.maxHp * 100}%`);
      setText(view['boss-percent'], `${Math.ceil(s.boss.hp / s.boss.maxHp * 100)}%`);
    }
    const dashLabel = s.dashCharges === 2 ? 'DASH READY' : s.dashCharges === 1 ? 'DASH ×1' : `DASH ${Math.max(0, 1.7 - s.dashRecharge).toFixed(1)}s`;
    setText(view['dash-ready'], dashLabel);
    setClass(view['dash-ready'], 'cooldown', s.dashCharges === 0);
    setText(view['nova-ready'], s.novaReady ? 'NOVA READY' : `NOVA ${s.novaCooldown.toFixed(1)}s`);
    setClass(view['nova-ready'], 'cooldown', !s.novaReady);
    const spawn = [...s.events].reverse().find(event => event.type === 'boss.spawned');
    const showBanner = s.state === 'RUNNING' && !s.paused && !!spawn && s.elapsed - spawn.elapsed < 2.7;
    setHidden(view.banner, !showBanner);
    if (!view.banner.hidden) setText(view.banner.querySelector('strong'), 'ASTERION');
    setHidden(view.overlay, !showOverlay);
    setHidden(big.overlay, !showOverlay);
    setHidden(touch, showOverlay);
    if (view.pause && view.pause.disabled !== showOverlay) view.pause.disabled = showOverlay;
    if (!showOverlay) return;
    const fill = nodes => {
      setHidden(nodes.resume, !s.paused);
      setText(nodes['result-hint'], s.paused ? 'P / ESC TO RESUME · R TO RESTART' : 'PRESS R TO RESTART');
      if (s.paused) {
        setText(nodes['result-kicker'], 'A MOMENT BETWEEN FATES');
        setText(nodes['result-title'], 'PAUSED');
        setText(nodes['result-text'], 'Press P or Escape to return to the chamber.');
        setText(nodes['result-stats'], '');
        setText(nodes.restart, 'RESTART RUN');
      } else {
        const won = s.state === 'WON';
        setText(nodes['result-kicker'], won ? 'EREBUS RELEASES YOU' : 'THE UNDERWORLD REMEMBERS');
        setText(nodes['result-title'], won ? 'OATH FULFILLED' : 'DEATH IS A BEGINNING');
        setText(nodes['result-text'], won
          ? 'The two wardens have fallen. Asterion is no more. Beyond the Last Gate, a new dawn awaits.'
          : 'Your flame has faded, but your vow remains. Watch the red circles. Dash beyond their reach.');
        setHTML(nodes['result-stats'], `<span>WARDENS <b>${s.wardensDefeated} / 2</b></span><span>TIME <b>${Math.floor(s.elapsed)}s</b></span><span>VITALITY <b>${Math.round(s.playerHealth)}</b></span>`);
        setText(nodes.restart, won ? 'RISE AGAIN ↗' : 'TRY AGAIN ↗');
      }
    };
    fill(view);
    fill(big);
  }

  function describeEvent(event) {
    switch (event.type) {
      case 'round.started': return 'The exile steps forward into the Chamber of Ashes as the two wardens stir.';
      case 'attack.hit': return `The exile’s sword strikes ${event.targetId === 'asterion' ? 'Asterion' : 'a warden'}.`;
      case 'nova.hit': return `Infernal nova burns ${event.targetId === 'asterion' ? 'Asterion' : 'a warden'}.`;
      case 'warden.defeated': return 'A skeletal warden collapses on the arena floor.';
      case 'boss.spawned': return 'The seal breaks and Asterion, Warden of the Last Gate, appears.';
      case 'boss.defeated': return 'Asterion falls and the Last Gate opens.';
      case 'player.hit': return 'The exile staggers as a warden’s strike lands.';
      case 'dash.committed': return 'The exile dashes through the incoming blow.';
      case 'enemy.telegraph': return event.enemyId === 'asterion'
        ? 'Asterion raises the axe, a red circle blooming on the stone.'
        : 'A warden winds up, a red circle marking the strike.';
      case 'round.won': return 'The Last Gate opens and the exile stands alone in the chamber.';
      case 'round.lost': return 'The exile falls in Erebus, overcome by the wardens.';
      default: return null;
    }
  }

  poseScene(game.read());
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
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    read() {
      const s = game.read();
      // HUD strings present() derives, so the client overlay needs no game logic.
      s.objectiveLabel = s.bossSpawned ? 'THE LAST GATE' : 'CHAMBER OF ASHES';
      s.objective = s.bossDefeated ? 'The Last Gate is open' : s.bossSpawned ? 'Defeat Asterion' : 'Defeat the two wardens';
      s.dashLabel = s.dashCharges === 2 ? 'DASH READY' : s.dashCharges === 1 ? 'DASH ×1' : `DASH ${Math.max(0, 1.7 - s.dashRecharge).toFixed(1)}s`;
      s.novaLabel = s.novaReady ? 'NOVA READY' : `NOVA ${s.novaCooldown.toFixed(1)}s`;
      const spawn = [...s.events].reverse().find(event => event.type === 'boss.spawned');
      s.bannerVisible = s.state === 'RUNNING' && !s.paused && !!spawn && s.elapsed - spawn.elapsed < 2.7;
      // The runtime stitches these sentences into the chunk's dynamic prompt.
      // Null means the event has no prompt line and is dropped.
      s.events = s.events.map(event => ({...event, prompt: describeEvent(event)}));
      return s;
    },
    // Overlay clicks, and P / Escape themselves: probe() never steps update(),
    // so a paused run must be resumable from here while generation is held.
    // Returning true keeps the key away from the game's own pause binding.
    handleUiAction(action) {
      if (action === 'reset' || action === 'restart') { clearInput(); host.restart(); return true; }
      if (action === 'p' || action === 'escape' || action === 'pause' || action === 'resume') {
        if (action === 'resume' && !game.read().paused) return true;
        game.togglePause();
        clearInput();
        return true;
      }
      return false;
    },
    describeEvent,
    // Poses and turns run on sim time from update(); dt is kept in the
    // signature for the shared host contract.
    render(_dt) {
      const s = game.read();
      poseScene(s);
      present(s);
      renderer.render(scene, camera);
    },
    reset() {
      clearInput();
      game.restart();
      snapTurns(game.read());
      hero.reset();
      wardens.forEach(visual => visual.reset?.());
      boss.reset?.();
      poseScene(game.read());
    },
    automation: () => ({
      visual: {
        hero: hero.mesh.position.toArray(),
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
