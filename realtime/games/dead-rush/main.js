import * as THREE from 'three';
import { createRenderer } from '/assets/user-interface/PrototypeShell.js';
import { Simulation, BLOCKS, PROFESSIONS } from './simulation.js';
import { makeVisuals } from './visuals.js';

// Game contract surface (docs/game-contract.md). This game runs a
// canonical full-keyboard loop: the drive keys are held actions read
// through the host input, the pause/mute toggles are one-shot presses
// (consumePress; the host latch ignores OS auto-repeat), and the touch
// pads are game-local pointer state folded into the same persistent pad.

export function createRuntime(host) {
  const sim = new Simulation();
  const scene = new THREE.Scene();
  // The rendered view is the world model's control signal: every entity class
  // keeps a distinct hue so boundaries read. No fog, white light, no tone
  // mapping — style and weather stay in the registry prompt.
  scene.background = new THREE.Color('#4aa8ff');
  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 190);

  const renderer = createRenderer(document.querySelector('#app'));
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;

  // Shadows and shading stay: they carry height and contact, which is
  // structure. Only the colour of the light is neutralised.
  scene.add(new THREE.HemisphereLight('#ffffff', '#909090', 1.8));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2);
  sun.position.set(-28, 50, 12); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -65; sun.shadow.camera.right = 65;
  sun.shadow.camera.top = 65; sun.shadow.camera.bottom = -65;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 140; sun.shadow.normalBias = .08; sun.shadow.bias = -.00015;
  scene.add(sun);

  // Shared virtual screen size (the big view's CSS px). The 3D camera matches
  // it, and the head-up tags project into the same space so the small mirror
  // aligns. The host hands the values in through layout(width, height).
  const view = { w: 1, h: 1 };
  const visuals = makeVisuals(scene, sim, view);

  // -- keys ---------------------------------------------------------------
  host.input.bind({
    KeyW: 'throttle', ArrowUp: 'throttle', KeyS: 'reverse', ArrowDown: 'reverse',
    KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
    Space: 'brake', ShiftLeft: 'boost', ShiftRight: 'boost',
    KeyP: 'pause', KeyM: 'mute',
  });

  const $ = (s) => document.querySelector(s);
  const dom = {
    score: $('#score'), health: $('#health'), healthFill: $('#health-fill'),
    hits: $('#hits'), deaths: $('#deaths'), speed: $('#speed'), speedFill: $('#speed-fill'),
    gear: $('#gear'), hint: $('#drive-hint'), feed: $('#event-feed'),
    pause: $('#pause'), sound: $('#sound'),
  };
  const overlays = [document.querySelector('#overlay'), document.querySelector('#overlay-big')];

  // -- one persistent input pad (no per-step allocation) --------------------
  const pad = { throttle: false, reverse: false, left: false, right: false, brake: false, boost: false };
  const touch = new Set();
  function padFor(input) {
    pad.throttle = touch.has('throttle') || input.isDown('throttle');
    pad.reverse = touch.has('reverse') || input.isDown('reverse');
    pad.left = touch.has('left') || input.isDown('left');
    pad.right = touch.has('right') || input.isDown('right');
    pad.brake = touch.has('brake') || input.isDown('brake');
    pad.boost = touch.has('boost') || input.isDown('boost');
    return pad;
  }
  function clearTouch() {
    touch.clear();
    document.querySelectorAll('[data-drive]').forEach((b) => b.classList.remove('active'));
  }

  // -- game-local keys and pointers -----------------------------------------
  // Pause and mute are one-shot toggles; R is host-owned, so this game never
  // listens for it. Blur pauses the run exactly like the original glue.
  // Pause only while driving: READY and outcomes have their own cards.
  function togglePause(input) {
    if (sim.rules.isResolved || sim.ready) return;
    sim.paused = !sim.paused;
    if (input) input.clear();
    clearTouch();
  }
  function toggleMute() { muted = !muted; if (muted) stopAudio(); else ensureAudio(); }
  // Headless capture: a blur only drops held input. Auto-pausing here would
  // hold generation on a background focus change nobody asked for.
  window.addEventListener('blur', () => { host.input.clear(); clearTouch(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { host.input.clear(); clearTouch(); } });
  document.querySelectorAll('.replay').forEach((b) => b.addEventListener('click', host.restart));
  document.querySelectorAll('.resume').forEach((b) => b.addEventListener('click', () => togglePause(null)));
  document.querySelectorAll('[data-drive]').forEach((button) => {
    button.addEventListener('pointerdown', (e) => { e.preventDefault(); ensureAudio(); button.setPointerCapture(e.pointerId); touch.add(button.dataset.drive); button.classList.add('active'); });
    const release = () => { touch.delete(button.dataset.drive); button.classList.remove('active'); };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
  });

  // -- audio (game-local, muted until the player opts in) --------------------
  let muted = true;
  let audioCtx = null, audioMaster = null, engineOsc = null, engineGain = null, terminalTonePlayed = false;
  function ensureAudio() {
    if (muted) return false;
    try {
      if (!audioCtx) { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); audioMaster = audioCtx.createGain(); audioMaster.gain.value = .16; audioMaster.connect(audioCtx.destination); }
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return true;
    } catch (_) { return false; }
  }
  function tone(freq, duration = .12, type = 'sine', level = .08) {
    if (!ensureAudio()) return;
    const now = audioCtx.currentTime, osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(level, now); gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
    osc.connect(gain).connect(audioMaster); osc.start(now); osc.stop(now + duration + .02);
  }
  function engineAudio(active, boost) {
    if (!active || muted || !ensureAudio()) {
      if (engineGain && audioCtx) { engineGain.gain.setTargetAtTime(0, audioCtx.currentTime, .06); try { engineOsc.stop(audioCtx.currentTime + .12); } catch (_) {} }
      engineOsc = null; engineGain = null; return;
    }
    const now = audioCtx.currentTime;
    if (!engineOsc) { engineOsc = audioCtx.createOscillator(); engineGain = audioCtx.createGain(); engineOsc.type = 'sawtooth'; engineOsc.frequency.value = 75; engineGain.gain.value = 0; engineOsc.connect(engineGain).connect(audioMaster); engineOsc.start(); }
    engineOsc.frequency.setTargetAtTime(72 + Math.min(95, Math.abs(sim.speed) * 4) + (boost ? 35 : 0), now, .09);
    engineGain.gain.setTargetAtTime(.018 + (boost ? .012 : 0), now, .1);
  }
  function stopAudio() {
    if (engineGain && audioCtx) { engineGain.gain.setTargetAtTime(0, audioCtx.currentTime, .04); try { engineOsc.stop(audioCtx.currentTime + .1); } catch (_) {} }
    engineOsc = null; engineGain = null;
  }

  // -- narration (the host pump drains read().events into the live box) ------
  const ROLE_LABEL = { mage: 'mage', warrior: 'warrior', nurse: 'nurse', firefighter: 'firefighter', police: 'police officer', worker: 'worker' };
  function personLabel(id) {
    const p = sim.people.find((person) => person.id === id);
    return p ? (ROLE_LABEL[PROFESSIONS[p.role].id] || 'pedestrian') : 'pedestrian';
  }
  function describeEvent(e) {
    switch (e.type) {
      case 'round.started':
        return 'The yellow coupe pulls away from the kerb and heads into the city streets.';
      case 'ped.hit':
        if (e.count === 1) return `The coupe slams into a ${personLabel(e.personId)} and sends them flying across the street.`;
        return null;
      case 'ped.death':
        return `Struck a second time, the ${personLabel(e.personId)} lies dead on the asphalt.`;
      case 'wall.crash':
        return 'The coupe grinds against a building wall and shudders from the impact.';
      case 'round.won':
        return 'Victory — the streets are clear and the round comes to an end.';
      case 'round.lost':
        return 'The wrecked coupe grinds to a halt — the round ends in defeat.';
      default:
        return null;
    }
  }

  // -- per-frame presentation -------------------------------------------------
  // Lives in render(), not update(): it must keep running after the outcome
  // freezes the host clock (state !== 'RUNNING' stops stepping), so the
  // round overlay is filled in on the very frame the run ends.
  let feedTime = 0, feedback = '', flash = 0;
  let uiDt = 0; // stepped sim time owed to the presentation pass
  const map = $('#minimap').getContext('2d');

  // Change-guarded presentation writes: updateUI runs every render frame,
  // and identical textContent/style assignments still dirty the DOM, so
  // write only when the displayed value changed. Colors keep a cached
  // intent because style.background reads back normalized (rgb()).
  const setText = (el, value) => { const t = String(value); if (el.textContent !== t) el.textContent = t; };
  const setStyle = (el, prop, value) => { const v = String(value); if (el.style.getPropertyValue(prop) !== v) el.style.setProperty(prop, v); };
  const pips = [...document.querySelectorAll('#score-pips i')];
  const vignette = $('#impact-vignette');
  let healthBg = '';
  function drawMap() {
    map.clearRect(0, 0, 180, 180);
    map.fillStyle = '#25434a'; map.fillRect(4, 4, 172, 172);
    const scale = 1.72, pos = (v) => 90 + v * scale;
    map.fillStyle = '#658278';
    for (const b of BLOCKS) map.fillRect(pos(b.x - b.w / 2), pos(b.z - b.d / 2), b.w * scale, b.d * scale);
    map.strokeStyle = '#91a68a'; map.lineWidth = 1; map.strokeRect(7, 7, 166, 166);
    for (const p of sim.people) {
      if (p.dead) continue;
      map.fillStyle = PROFESSIONS[p.role].color;
      map.beginPath(); map.arc(pos(p.x), pos(p.z), p.hits ? 2.6 : 1.7, 0, Math.PI * 2); map.fill();
    }
    map.save(); map.translate(pos(sim.car.position.x), pos(sim.car.position.z)); map.rotate(-sim.car.yaw);
    map.fillStyle = '#ffe074'; map.strokeStyle = '#263e42'; map.lineWidth = 1.5;
    map.beginPath(); map.moveTo(0, -6); map.lineTo(4, 4); map.lineTo(0, 2); map.lineTo(-4, 4); map.closePath();
    map.fill(); map.stroke(); map.restore();
  }
  function updateUI(dt) {
    const r = sim.rules;
    setText(dom.score, String(r.score).padStart(3, '0'));
    const healthHtml = `${r.health}<span>%</span>`;
    if (dom.health.innerHTML !== healthHtml) dom.health.innerHTML = healthHtml;
    setStyle(dom.healthFill, 'width', r.health + '%');
    const bg = r.health <= 40 ? '#ef7760' : '#a9dcc6';
    if (healthBg !== bg) { healthBg = bg; dom.healthFill.style.background = bg; }
    setText(dom.hits, r.hits);
    setText(dom.deaths, r.deaths);
    setText(dom.speed, Math.round(Math.abs(sim.speed) * 3.6));
    setStyle(dom.speedFill, 'width', Math.min(100, Math.abs(sim.speed) / 34.5 * 100) + '%');
    setText(dom.gear, sim.braking ? 'BRAKE' : sim.boosting ? 'BOOST' : sim.speed < -0.2 ? 'REVERSE' : Math.abs(sim.speed) > 0.2 ? 'DRIVE' : 'READY');
    setText(dom.hint, sim.moved ? 'Coast to slow · space for a hard brake' : 'Hold W or ↑ to throttle');
    for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('on', r.hits > i);
    feedTime = Math.max(0, feedTime - dt);
    setText(dom.feed, feedTime > 0 ? feedback : '');
    flash = Math.max(0, flash - dt * 2);
    setStyle(vignette, 'opacity', flash * .7);
    setText(dom.sound, muted ? '♪̸' : '♪');
    const soundTitle = muted ? 'M to unmute' : 'M to mute';
    if (dom.sound.title !== soundTitle) dom.sound.title = soundTitle;

    // The round popup is shown in the big view AND in the small mirror.
    // Hidden overlays get no per-frame writes at all.
    const hidden = !sim.paused && !r.isResolved;
    for (const o of overlays) {
      if (o.hidden !== hidden) o.hidden = hidden;
      if (hidden) continue;
      const resume = o.querySelector('.resume');
      const resumeHidden = !sim.paused || r.isResolved;
      if (resume.hidden !== resumeHidden) resume.hidden = resumeHidden;
      setText(o.querySelector('.result-kicker'), sim.paused ? 'TAKE A BREATH' : r.state === 'WON' ? 'MISSION COMPLETE' : 'RUN ENDED');
      setText(o.querySelector('.result-title'), sim.paused ? 'Hold on' : r.state === 'WON' ? 'City Legend' : 'Wrecked');
      setText(o.querySelector('.result-icon'), sim.paused ? 'Ⅱ' : r.state === 'WON' ? '↗' : '×');
      setText(o.querySelector('.result-reason'), sim.paused ? 'Game paused — press P to get moving again.' : r.state === 'WON' ? "600 points! The city remembers your tail lights." : 'A wall crash drained the car. Next run, leave some braking distance.');
      const statsHtml = `<div><strong>${r.score}</strong><small>Round score</small></div><div><strong>${r.hits}</strong><small>Launches</small></div><div><strong>${r.deaths}</strong><small>Deaths</small></div>`;
      const statsEl = o.querySelector('.result-stats');
      if (statsEl.innerHTML !== statsHtml) statsEl.innerHTML = statsHtml;
    }
    drawMap();
  }

  // The chase view never rotates, so new content arrives purely as translation.
  // Pulled to 0.5x of the original distance (19, 38, 27) — the whole offset and
  // the look-ahead scale together, so the framing is unchanged and only the
  // distance drops: the car reads at 148 px against the original 74. Closing in
  // shortens the visible strip too (69 m to 35 m), so the speed in
  // simulation.js carries the whole refresh-rate budget.
  function setCamera() {
    camera.position.set(sim.car.position.x + 9.5, 19, sim.car.position.z + 13.5);
    camera.lookAt(sim.car.position.x, 0, sim.car.position.z - 2.5);
    camera.updateMatrixWorld();
  }
  setCamera();

  // -- legacy debugging handle (tolerated, not part of the contract) -----------
  window.__step1 = { scene, camera };

  return {
    canvas: renderer.domElement,

    start() {
      // All construction happened in createRuntime; the round begins on the
      // first sim step.
    },

    update(dt, input) {
      const effDt = sim.paused || sim.rules.isResolved ? 0 : dt;
      if (input.consumePress('pause')) togglePause(input);
      if (input.consumePress('mute')) toggleMute();
      if (effDt > 0) {
        for (const e of sim.step(dt, padFor(input))) {
          if (e.type === 'ped.hit') {
            const p = sim.people.find((person) => person.id === e.personId);
            feedback = `+100  ${PROFESSIONS[p.role].name} · ${e.count === 2 ? 'second launch — fatal' : 'first launch'}`;
            feedTime = 2.2; visuals.spawnHit(p, e);
            tone(e.count === 2 ? 130 : 220, e.count === 2 ? .22 : .11, 'triangle', .1);
          } else if (e.type === 'wall.crash') {
            feedback = 'Wall crash −20 health'; feedTime = 2; flash = 1;
            visuals.spawnCrash(sim.lastCrash); tone(74, .2, 'square', .11);
          }
        }
        if (sim.rules.isResolved && !terminalTonePlayed) {
          terminalTonePlayed = true; stopAudio();
          tone(sim.rules.state === 'WON' ? 660 : 96, .35, 'sine', .12);
          if (sim.rules.state === 'WON') setTimeout(() => tone(880, .3, 'sine', .1), 120);
        }
      }
      engineAudio(effDt > 0 && !sim.paused && !sim.rules.isResolved && Math.abs(sim.speed) > .35, sim.boosting);
      setCamera();
      visuals.update(camera, effDt);
      uiDt += effDt; // presentation pass consumes it in render()
    },

    layout(width, height) {
      view.w = width; view.h = height;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },

    read() {
      const snap = sim.read();
      const r = sim.rules;
      snap.toast = snap.state === 'RUNNING' && feedTime > 0 ? feedback : '';
      snap.flash = flash;
      snap.speedKmh = Math.round(Math.abs(sim.speed) * 3.6);
      snap.speedRatio = Math.min(1, Math.abs(sim.speed) / 34.5);
      snap.gear = snap.state === 'READY' ? 'READY' : sim.braking ? 'BRAKE' : sim.boosting ? 'BOOST'
        : sim.speed < -0.2 ? 'REVERSE' : Math.abs(sim.speed) > 0.2 ? 'DRIVE' : 'READY';
      snap.driveHint = sim.moved ? 'Coast to slow · space for a hard brake' : 'Hold W or ↑ to throttle';
      snap.muted = muted;
      snap.targetScore = 600;
      snap.health = r.health;
      // The runtime stitches these sentences into the chunk's dynamic prompt.
      // Null means the event has no prompt line and is dropped.
      snap.events = snap.events.map(event => ({...event, prompt: describeEvent(event)}));
      return snap;
    },

    // Overlay clicks, and the P key itself: probe() never steps update(), so
    // a paused run must be resumable from here while generation is held.
    // Returning true keeps the keydown away from the game's own P binding.
    handleUiAction(action) {
      if (action === 'reset' || action === 'restart') {
        host.input.clear(); clearTouch(); host.restart();
        return true;
      }
      if (action === 'p' || action === 'pause' || action === 'resume') {
        if (action === 'resume' && !sim.paused) return true;
        togglePause(host.input);
        return true;
      }
      if (action === 'mute') { toggleMute(); return true; }
      return false;
    },

    describeEvent,

    // Presentation timers run on sim time accumulated in update(); dt is the
    // same span, kept in the signature for the shared host contract.
    render(_dt) {
      updateUI(uiDt); uiDt = 0;
      renderer.render(scene, camera); // host feeds recorder/p2r right after
    },

    reset() {
      stopAudio();
      terminalTonePlayed = false;
      sim.reset(); // fresh round (rules, car, people; paused cleared)
      visuals.reset();
      clearTouch();
      feedTime = 0; feedback = ''; flash = 0;
      uiDt = 0;
      setCamera();
    },

    automation() {
      return {
        observations: {
          northApproach: sim.car.position.z < -36,
          southApproach: sim.car.position.z > 32,
        },
        presentation: {
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
          wheelRotation: visuals.vehicle.wheels[0].rotation.x,
          steeringAngle: visuals.vehicle.steeringPivots[0].rotation.y,
          muted,
        },
      };
    },

    destroy() {},
  };
}