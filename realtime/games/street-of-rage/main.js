import * as THREE from 'three';
import { createRenderer } from '/assets/user-interface/PrototypeShell.js';
import { createGame } from './game.mjs';
import { createWorld, syncPlacement } from './scene.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
const setHTML = (node, html) => { if (node.innerHTML !== html) node.innerHTML = html; };
const setHidden = (node, hidden) => { if (node.hidden !== hidden) node.hidden = hidden; };
const setWidth = (node, width) => { if (node.style.width !== width) node.style.width = width; };
const setClass = (node, name, on) => { if (node.classList.contains(name) !== on) node.classList.toggle(name, on); };

export function createRuntime(host) {
  const renderer = createRenderer(document.querySelector('#app'));
  renderer.toneMapping = THREE.NoToneMapping;
  const world = createWorld(), { scene, camera } = world;
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
    KeyJ: 'attack', Space: 'attack', KeyK: 'heavy',
    ShiftLeft: 'dash', ShiftRight: 'dash', KeyL: 'dash', KeyP: 'pause', Escape: 'pause',
  });
  // Pointer handlers and the fixed-step input adapter share this live pad.
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
  };
  const game = createGame({ outcomes: true, onRestart: clearInput });
  for (const button of touch.querySelectorAll('[data-action]')) {
    button.addEventListener('pointerdown', event => {
      event.preventDefault(); button.blur();
      if (game.paused || game.state === 'WON' || game.state === 'LOST') return;
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

  let audioContext = null, soundOn = false;
  function toggleSound() {
    soundOn = !soundOn;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (soundOn && Context) { audioContext ??= new Context(); audioContext.resume().catch(() => {}); }
    setText(view.sound, soundOn ? 'SOUND ON' : 'SOUND OFF');
  }
  view.sound.addEventListener('click', () => { toggleSound(); view.sound.blur(); }, options);
  function sound(type) {
    if (!soundOn || audioContext?.state !== 'running') return;
    const osc = audioContext.createOscillator(), gain = audioContext.createGain(), time = audioContext.currentTime;
    osc.type = type === 'hero.hurt' ? 'sawtooth' : 'triangle';
    const frequency = type === 'combat.hit' ? 160 : type === 'enemy.defeated' ? 340 : type === 'round.won' ? 520 : 90;
    osc.frequency.setValueAtTime(frequency, time); osc.frequency.exponentialRampToValueAtTime(frequency * .3, time + .13);
    gain.gain.setValueAtTime(.045, time); gain.gain.exponentialRampToValueAtTime(.001, time + .17);
    osc.connect(gain).connect(audioContext.destination); osc.start(time); osc.stop(time + .18);
  }

  const effects = [], warnings = {}, yaw = {};
  const TURN = .42;
  let lastEvent = 0, aspect = 1280 / 704;
  const wrapPi = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
  const faceYaw = (facing, extra) => -facing * (Math.PI / 2 + extra);
  function snapTurns() {
    yaw.hero = faceYaw(game.hero.facing, .4);
    for (const enemy of Object.values(game.enemies)) yaw[enemy.id] = faceYaw(enemy.facing, .3);
  }
  function stepTurns(dt) {
    const spin = Math.PI / TURN * dt;
    const seek = (id, facing, extra) => {
      const target = faceYaw(facing, extra);
      if (yaw[id] == null) { yaw[id] = target; return; }
      // Interpolate in a space where facing the camera (y = ±π) is 0, so a
      // left/right reverse always spins toward the screen instead of snapping.
      const fromS = wrapPi(yaw[id] - Math.PI), toS = wrapPi(target - Math.PI);
      const delta = wrapPi(toS - fromS);
      yaw[id] = Math.abs(delta) <= spin ? target : wrapPi(fromS + Math.sign(delta) * spin + Math.PI);
    };
    seek('hero', game.hero.facing, .4);
    for (const enemy of Object.values(game.enemies)) seek(enemy.id, enemy.facing, .3);
  }
  snapTurns();
  function removeEffect(effect) {
    scene.remove(effect.mesh); effect.mesh.geometry.dispose(); effect.mesh.material.dispose();
  }
  function clearEffects() { effects.forEach(removeEffect); effects.length = 0; }
  function burst(x, z, color, count) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(.075, .075, .075), new THREE.MeshBasicMaterial({ color, transparent: true }));
      mesh.position.set(x, 1.1, z); scene.add(mesh);
      const angle = i / count * Math.PI * 2;
      effects.push({ mesh, time: 0, max: .4 + i % 3 * .1, vx: Math.cos(angle) * (2 + i % 3), vy: 2 + i % 4, vz: Math.sin(angle) * 2 });
    }
  }
  for (const id of Object.keys(game.enemies)) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#ff274c', side: THREE.DoubleSide, transparent: true, opacity: .3, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = .045; scene.add(mesh); warnings[id] = mesh;
  }
  const flames = Array.from({ length: 14 }, (_, i) => {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(.4, 0), new THREE.MeshBasicMaterial({ color: i % 2 ? '#fb714c' : '#ffd580' }));
    scene.add(mesh); return mesh;
  });
  function updateEffects(dt) {
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i]; e.time += dt;
      e.mesh.position.x += e.vx * dt; e.mesh.position.y += e.vy * dt; e.mesh.position.z += e.vz * dt;
      e.vy -= 14 * dt; e.mesh.material.opacity = Math.max(0, 1 - e.time / e.max);
      if (e.time >= e.max) { removeEffect(e); effects.splice(i, 1); }
    }
    for (const event of game.events) {
      if (event.id <= lastEvent) continue;
      lastEvent = event.id;
      if (event.type === 'combat.hit') burst(event.x, event.z, event.kind === 'heavy' ? '#92ffe0' : '#ffd992', event.kind === 'heavy' ? 18 : 10);
      if (event.type === 'enemy.defeated') burst(event.x, event.z, '#bb89de', 24);
      if (event.type === 'hero.hurt') burst(event.x, event.z, '#ed739a', 8);
      if (['combat.hit', 'enemy.defeated', 'hero.hurt', 'round.won'].includes(event.type)) sound(event.type);
    }
  }
  function poseScene() {
    const h = game.hero, hero = world.actors.hero;
    // Idle clocks run through READY (readyTime) and on into play (elapsed from 0).
    const idleTime = game.readyTime + game.elapsed;
    hero.setPose(h.moving ? 'run' : 'idle', idleTime); hero.mesh.rotation.z = 0;
    if (h.attackCd > 0) {
      const arm = hero.rig.arms[h.combo % 2];
      arm.shoulder.rotation.x = 1.8 * Math.sin(clamp(h.attackTime / (h.attackKind === 'heavy' ? .52 : .3), 0, 1) * Math.PI);
      arm.elbow.rotation.x = .15; hero.rig.chest.rotation.y = Math.sin(h.attackTime * 16) * .15;
    }
    if (h.dashTime > 0) hero.rig.chest.rotation.x = -.5;
    if (game.state === 'LOST') hero.mesh.rotation.z = -Math.PI / 2;
    // Keep the fighter present in every control frame, including damage recovery.
    hero.mesh.visible = true;
    for (const [id, enemy] of Object.entries(game.enemies)) {
      const actor = world.actors[id], dead = enemy.hp <= 0;
      actor.mesh.visible = (id !== 'dragon_boss' || game.phase === 'boss') && !(dead && enemy.deathTime > 1.4);
      const pose = dead ? 'death' : enemy.mode === 'windup' ? 'action' : enemy.mode === 'strike' ? 'pounce' : enemy.moving ? 'move' : 'idle';
      const time = dead ? enemy.deathTime : enemy.mode === 'windup' ? (id === 'dragon_boss' ? 1.15 : .7) - enemy.timer : enemy.mode === 'strike' ? .24 - enemy.timer : idleTime;
      actor.setPose(pose, time, { inPlace: true });
      const warning = warnings[id], breath = enemy.attackType === 'breath';
      warning.visible = !dead && (enemy.mode === 'windup' || enemy.mode === 'breath');
      warning.scale.set(breath ? 9 : 3.2, breath ? 1.8 : 2.5, 1);
      warning.position.set(breath ? enemy.x + enemy.facing * 4.5 : enemy.x + enemy.facing * .9, .05, breath ? enemy.aimZ : enemy.z);
      warning.material.opacity = enemy.mode === 'breath' ? .43 : .26;
    }
    syncPlacement(world, { hero: h, ...game.enemies });
    hero.mesh.rotation.y = yaw.hero ?? faceYaw(h.facing, .4);
    for (const [id, enemy] of Object.entries(game.enemies)) {
      world.actors[id].mesh.rotation.y = yaw[id] ?? faceYaw(enemy.facing, .3);
    }
    world.gate.visible = game.phase === 'wardens';
    const boss = game.enemies.dragon_boss;
    flames.forEach((flame, i) => {
      flame.visible = boss.mode === 'breath' && game.state === 'RUNNING';
      const distance = (game.elapsed * 11 + i * .67) % 9;
      flame.position.set(boss.x + boss.facing * (distance + .3), .7 + Math.sin(i * 2 + game.elapsed * 12) * .35, boss.aimZ + Math.sin(i * 6) * .42);
      flame.scale.setScalar(.6 + distance * .13); flame.rotation.set(game.elapsed + i, 0, game.elapsed * 3);
    });
    const center = aspect < 1 ? game.cameraX - 1.6 : game.cameraX;
    const shake = game.shake > 0 ? Math.sin(game.elapsed * 120) * game.shake * .2 : 0;
    camera.position.set(center + shake, 10.2, 18); camera.lookAt(center, 1.1, 0);
  }
  // HUD strings shared by the in-page HUD (present) and the streamed snapshot (read).
  function hudText() {
    const h = game.hero, boss = game.enemies.dragon_boss, target = game.nearest();
    return {
      objective: game.phase === 'wardens' ? 'Defeat the vampire wardens' : 'Slay Ashwing. Break the curse.',
      objectiveLabel: game.phase === 'wardens' ? 'CLEAR THE STREET' : 'THE FINAL FIGHT',
      combo: game.chain > 1 ? game.chain : 0,
      comboLabel: game.chain > 5 ? 'RELENTLESS' : 'COMBO',
      banner: game.state === 'RUNNING' && game.elapsed <= game.bannerUntil ? game.banner : '',
      heavyText: h.heavyCd <= 0 ? 'HEAVY READY' : `HEAVY ${h.heavyCd.toFixed(1)}s`,
      dashText: h.dashCd <= 0 ? 'DODGE READY' : 'DODGE RECHARGING',
      go: Boolean(target) && target.x - h.x >= 7 && game.state === 'RUNNING',
      alert: boss.mode === 'windup' ? (boss.attackType === 'breath' ? 'FIRE INCOMING · CHANGE LANES' : 'CLAW STRIKE · DODGE AWAY') : boss.mode === 'breath' ? 'KEEP OUT OF THE FIRE LANE' : '',
    };
  }
  function present() {
    const h = game.hero, boss = game.enemies.dragon_boss, text = hudText();
    setWidth(view['hp-fill'], `${h.hp / h.maxHp * 100}%`);
    setText(view['hp-text'], `${h.hp} / ${h.maxHp}`); setText(view.score, String(game.score).padStart(6, '0'));
    setText(view.count, `${game.kills} / 2`);
    setClass(view['seal-one'], 'done', game.enemies.vampire_one.hp <= 0); setClass(view['seal-two'], 'done', game.enemies.vampire_two.hp <= 0);
    setText(view.objective, text.objective);
    setText(view['objective-label'], text.objectiveLabel);
    setHidden(view['boss-hud'], game.phase !== 'boss');
    if (!view['boss-hud'].hidden) {
      setWidth(view['boss-fill'], `${boss.hp / boss.maxHp * 100}%`); setText(view['boss-percent'], `${Math.ceil(boss.hp / boss.maxHp * 100)}%`);
    }
    setHTML(view.combo, text.combo ? `<strong>${text.combo}<i> HIT</i></strong><span>${text.comboLabel}</span>` : '');
    setHidden(view.banner, !text.banner);
    if (!view.banner.hidden) setText(view.banner.querySelector('strong'), text.banner);
    setText(view['heavy-ready'], text.heavyText);
    setClass(view['heavy-ready'], 'cooldown', h.heavyCd > 0); setText(view['dash-ready'], text.dashText);
    setHidden(view.go, !text.go);
    setText(view.alert, text.alert);
    // READY is the start line, not an outcome: only pause and WON/LOST get the card.
    const showOverlay = game.paused || game.state === 'WON' || game.state === 'LOST';
    setHidden(view.overlay, !showOverlay); setHidden(big.overlay, !showOverlay); setHidden(touch, showOverlay);
    for (const name of ['sound', 'pause']) if (view[name].disabled !== showOverlay) view[name].disabled = showOverlay;
    if (!showOverlay) return;
    const fill = nodes => {
      setHidden(nodes.resume, !game.paused);
      setText(nodes['result-hint'], game.paused ? 'P / ESC TO RESUME · R TO RESTART' : 'PRESS R TO RESTART');
      if (game.paused) {
        setText(nodes['result-kicker'], 'TAKE A BREATH'); setText(nodes['result-title'], 'PAUSED');
        setText(nodes['result-text'], 'Press P or Escape to return to the street.'); setText(nodes['result-stats'], ''); setText(nodes.restart, 'RESTART RUN');
      } else {
        const won = game.state === 'WON';
        setText(nodes['result-kicker'], won ? 'CHAPTER 01 · COMPLETE' : 'THE CITY NEVER SLEEPS');
        setText(nodes['result-title'], won ? 'STREET CLEARED' : 'DOWN, NOT OUT');
        setText(nodes['result-text'], won ? 'Two wardens silenced. One dragon fallen. Dawn belongs to you.' : 'The night has teeth. Get up and take another shot.');
        setHTML(nodes['result-stats'], `<span>SCORE <b>${game.score}</b></span><span>BEST COMBO <b>${game.bestCombo}</b></span><span>TIME <b>${Math.floor(game.elapsed)}s</b></span>`);
        setText(nodes.restart, won ? 'RUN IT BACK ↗' : 'TRY AGAIN ↗');
      }
    };
    fill(view); fill(big);
  }
  function describeEvent(event) {
    const name = id => id === 'dragon_boss' ? 'The dragon' : 'The vampire warden';
    switch (event.type) {
      case 'combat.hit': return `${name(event.target)} reels from the fighter's ${event.kind === 'heavy' ? 'heavy blow' : 'punch'}.`;
      case 'enemy.defeated': return `${name(event.target)} collapses onto the street.`;
      case 'hero.hurt': return 'The fighter staggers as an enemy strikes him.';
      case 'hero.dash': return 'The fighter darts across the street to evade the attack.';
      case 'boss.unlocked': return 'The gate opens and a winged dragon confronts the fighter.';
      case 'enemy.windup': return event.kind === 'breath' ? 'The dragon draws back its head, preparing a stream of fire.' : `${name(event.source)} raises its claws to strike.`;
      case 'enemy.attack': return event.kind === 'breath' ? 'Flames sweep along the street from the dragon’s mouth.' : null;
      case 'round.started': return 'The gloved fighter raises his fists and advances along the street toward the vampire wardens.';
      case 'round.won': return 'The dragon falls and the fighter stands alone on the cleared street.';
      case 'round.lost': return 'The fighter falls to the pavement, overcome by the creatures.';
      default: return null;
    }
  }
  poseScene();
  return {
    canvas: renderer.domElement,
    update(dt, nextInput) {
      keyboard = nextInput; game.handleInput(input); game.update(dt, input);
      if (!game.paused) { updateEffects(dt); stepTurns(dt); }
      if (game.state === 'WON' || game.state === 'LOST') clearInput();
    },
    layout(width, height) {
      renderer.setSize(width, height, false); aspect = width / height;
      const half = aspect < 1 ? 11.5 : 5.8;
      camera.top = half; camera.bottom = -half; camera.left = -half * aspect; camera.right = half * aspect;
      camera.updateProjectionMatrix();
    },
    read() {
      const snap = game.read(), h = game.hero, boss = game.enemies.dragon_boss;
      Object.assign(snap, hudText(), {
        hp: h.hp, maxHp: h.maxHp, kills: game.kills, bestCombo: game.bestCombo,
        heavyCooldown: h.heavyCd > 0,
        seals: [game.enemies.vampire_one.hp <= 0, game.enemies.vampire_two.hp <= 0],
        bossHp: boss.hp, bossMaxHp: boss.maxHp, soundOn,
      });
      // The runtime stitches these sentences into the chunk's dynamic prompt;
      // a null prompt drops the event.
      snap.events = snap.events.map(event => ({ ...event, prompt: describeEvent(event) }));
      return snap;
    },
    // Overlay clicks and the P / Escape keys. probe() never steps update(), so a
    // paused run must be resumable from here while generation is held; returning
    // true keeps the keydown away from the game's own pause binding.
    handleUiAction(action) {
      if (action === 'reset' || action === 'restart') { clearInput(); host.restart(); return true; }
      if (action === 'p' || action === 'escape' || action === 'pause' || action === 'resume') {
        if (action === 'resume' && !game.paused) return true;
        game.togglePause();
        return true;
      }
      if (action === 'sound' || action === 'mute') { toggleSound(); return true; }
      return false;
    },
    describeEvent,
    // Animation timing comes from sim time advanced in update(); dt is kept for
    // the host contract, so captures stay deterministic.
    render(_dt) { poseScene(); present(); renderer.render(scene, camera); },
    reset() {
      clearInput(); clearEffects(); game.reset(); lastEvent = 0; snapTurns();
      for (const actor of Object.values(world.actors)) actor.reset();
      poseScene();
    },
    automation: () => ({ visual: { hero: world.actors.hero.mesh.position.toArray(), camera: camera.position.toArray(), drawCalls: renderer.info.render.calls, yaw: { ...yaw } } }),
    destroy() {
      listeners.abort(); clearInput(); clearEffects(); audioContext?.close();
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
