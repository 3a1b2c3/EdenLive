import * as THREE from 'three';
import { OrbitFollowCameraRig } from '/assets/camera/OrbitFollowCameraRig.js';
import { createRenderer } from '/assets/user-interface/PrototypeShell.js';
import { createGame } from './game.mjs';
import { buildCity } from './city-scene.mjs';
import { lotColliders, surfaceHeight } from './city-layout.mjs';

const CAMERA_DISTANCE = 8.5;
const CAMERA_LOTS = lotColliders().map(l => ({ x0: l.x0 - 0.6, x1: l.x1 + 0.6, z0: l.z0 - 0.6, z1: l.z1 + 0.6 }));
const TURN = 0.42; // seconds for a half-turn of presented yaw
const SKY = 0x8cc4f0;

const wrapPi = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
const setHidden = (node, hidden) => { if (node && node.hidden !== hidden) node.hidden = hidden; };
const setClass = (node, name, on) => { if (node && node.classList.contains(name) !== on) node.classList.toggle(name, on); };

// Fraction of the anchor->camera segment that stays outside every building lot.
function clearFraction(ax, az, cx, cz) {
  const steps = 24;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const x = ax + (cx - ax) * t;
    const z = az + (cz - az) * t;
    if (CAMERA_LOTS.some(l => x > l.x0 && x < l.x1 && z > l.z0 && z < l.z1)) return (i - 1) / steps;
  }
  return 1;
}

// White key + white/grey hemisphere, flat sky fill, no fog: the view is a control
// signal and the registry prompts own weather and light.
function addLights(scene) {
  scene.background = new THREE.Color(SKY);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(28, 71, -48); // elevation 52 deg, azimuth 30 deg, 90 m out
  scene.add(sun);
}

export function createRuntime(host) {
  const renderer = createRenderer(document.querySelector('#app'), { shadows: false, pixelRatio: 1 });
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.domElement.setAttribute('aria-label', 'City Walk game view');
  const scene = new THREE.Scene();
  addLights(scene);
  const city = buildCity(scene);
  const game = createGame();
  const g = game.state;

  host.input.bind({
    KeyW: 'forward', KeyS: 'backward', KeyA: 'left', KeyD: 'right',
    KeyJ: 'lookLeft', KeyL: 'lookRight', KeyI: 'lookUp', KeyK: 'lookDown',
    KeyP: 'pause', Escape: 'pause',
  });

  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 900);
  const rig = new OrbitFollowCameraRig({
    distance: CAMERA_DISTANCE, anchorHeight: 1.6, anchorForward: 1.5,
    pitchMin: -1.0, pitchMax: 0.15, pitch: -0.32,
  });

  const carViews = new Map(city.cars.map(c => [c.route.id, c.visual]));
  const pedViews = new Map(city.pedestrians.map(p => [p.route.id, p.visual]));

  // Presented pedestrian yaw: routes turn 90 degrees in one step at block
  // corners; the view spins through the camera-facing pose instead of snapping.
  const presentedYaw = new Map();
  function snapTurns() { for (const ped of g.pedestrians) presentedYaw.set(ped.id, ped.heading); }
  function stepTurns(dt) {
    const spin = Math.PI / TURN * dt;
    const camFace = g.camera.yaw + Math.PI;
    for (const ped of g.pedestrians) {
      const from = wrapPi(presentedYaw.get(ped.id) - camFace);
      const delta = wrapPi(wrapPi(ped.heading - camFace) - from);
      presentedYaw.set(ped.id, Math.abs(delta) <= spin ? ped.heading : wrapPi(from + Math.sign(delta) * spin + camFace));
    }
  }
  snapTurns();

  const $ = id => document.getElementById(id);
  const ui = {
    score: $('score'), scoreTarget: $('score-target'), bar: $('score-bar'),
    clock: $('clock'), clockPanel: $('clock-panel'), bonus: $('clock-bonus'),
    arrow: $('guide-arrow'), guideText: $('guide-text'), toast: $('toast'), yielding: $('yielding'),
  };
  const dialogs = [
    { overlay: $('result'), title: $('result-title'), text: $('result-text'), resume: $('resume-btn'), restart: $('restart-btn'), hint: $('result-hint') },
    { overlay: $('result-big'), title: $('big-result-title'), text: $('big-result-text'), resume: $('big-resume-btn'), restart: $('big-restart-btn'), hint: $('big-result-hint') },
  ];

  let keyboard = host.input;
  let paused = false;
  const finished = () => g.state === 'WON' || g.state === 'LOST';
  function togglePause() {
    // Pause is live-play only: READY and outcomes have their own cues.
    if (g.state !== 'RUNNING') return;
    paused = !paused;
    clearInput();
  }
  const listeners = new AbortController(), options = { signal: listeners.signal };
  const clearInput = () => keyboard.clear();
  for (const d of dialogs) {
    d.restart.addEventListener('click', () => { d.restart.blur(); clearInput(); host.restart(); }, options);
    d.resume.addEventListener('click', () => { d.resume.blur(); paused = false; clearInput(); }, options);
  }
  window.addEventListener('blur', clearInput, options);
  document.addEventListener('visibilitychange', clearInput, options);

  let lastScore = 0;
  let flashUntil = -1;
  let lastBearing = null;
  let lastBar = '';
  let cameraDistance = CAMERA_DISTANCE;
  let pendingCameraDt = 0; // sim time accumulated since the last render
  let shownDialog = '';

  function poseScene() {
    // Idle cycles keep breathing through READY on the sim-driven ready clock.
    const t = g.elapsed + g.readyTime;
    for (const car of g.cars) {
      const visual = carViews.get(car.id);
      visual.group.position.set(car.x, 0, car.z);
      visual.group.rotation.y = car.heading;
      visual.setPose(car.speed > 0.05 ? 'drive' : 'still', car.odometer / 6);
    }
    for (const ped of g.pedestrians) {
      const visual = pedViews.get(ped.id);
      visual.group.position.set(ped.x, surfaceHeight(ped.x, ped.z), ped.z);
      visual.group.rotation.y = presentedYaw.get(ped.id);
      visual.setPose('walk', ped.walkTime * 1.6);
    }
    const player = city.player;
    player.group.position.set(g.player.x, g.player.y, g.player.z);
    player.group.rotation.y = g.player.heading;
    player.setPose(g.player.moving ? 'walk' : 'idle', t * (g.player.moving ? 1.9 : 0.5));

    // Rings pulse and drift toward their (respawning) spot.
    for (const ring of g.rings) {
      const index = parseInt(ring.id.split('_')[1], 10);
      const v = city.rings[index].visual;
      v.position.set(ring.x, surfaceHeight(ring.x, ring.z), ring.z);
      v.rotation.y = t * 0.8 + index;
      v.userData.parts.torus.scale.setScalar(1 + Math.sin(t * 3 + index * 1.7) * 0.08);
      v.userData.parts.beam.material.opacity = 0.12 + Math.sin(t * 2.2) * 0.05;
    }

    // Camera orbits behind the player and pulls in when a lot blocks the orbit.
    const dt = pendingCameraDt;
    pendingCameraDt = 0;
    rig.setLook(g.camera.yaw, g.camera.pitch);
    const target = { x: g.player.x, y: g.player.y, z: g.player.z };
    rig.distance = CAMERA_DISTANCE;
    rig.step({ targetPosition: target, deltaSeconds: dt, camera, snapToTarget: true });
    const wanted = Math.max(1.6, CAMERA_DISTANCE * clearFraction(g.player.x, g.player.z, camera.position.x, camera.position.z) - 0.3);
    cameraDistance = wanted < cameraDistance ? wanted : cameraDistance + (wanted - cameraDistance) * Math.min(1, dt * 3);
    rig.distance = cameraDistance;
    rig.step({ targetPosition: target, deltaSeconds: dt, camera, snapToTarget: true });
  }

  function present() {
    const rules = game.rules;
    const clock = game.clock.snapshot();
    if (g.score !== lastScore) {
      if (g.score > lastScore) {
        flashUntil = g.elapsed + 0.9;
        setText(ui.bonus, `+${rules.bonusSeconds} s`);
      }
      lastScore = g.score;
    }
    setText(ui.score, String(g.score));
    setText(ui.scoreTarget, ` / ${rules.targetScore}`);
    const bar = `${Math.min(100, (g.score / rules.targetScore) * 100)}%`;
    if (bar !== lastBar) {
      lastBar = bar;
      ui.bar.style.width = bar;
      ui.bar.parentElement.setAttribute('aria-valuenow', String(g.score));
    }
    const flashing = g.elapsed < flashUntil;
    setClass(ui.toast, 'show', flashing);
    if (!flashing) setText(ui.bonus, '');

    const hud = hudText(clock);
    const clockText = hud.clockText;
    setText(ui.clock, clockText);
    setClass(ui.clockPanel, 'warn', hud.clockWarn);

    if (hud.guideText) {
      if (hud.guideBearing !== lastBearing) { lastBearing = hud.guideBearing; ui.arrow.style.transform = `rotate(${hud.guideBearing}deg)`; }
      setText(ui.guideText, hud.guideText);
    }
    setText(ui.yielding, String(hud.yielding));

    // Pause / win / loss: same card on the big view and the small HUD.
    // READY is the start line, not an outcome: no card.
    const mode = paused && g.state === 'RUNNING' ? 'PAUSED' : finished() ? g.state : '';
    if (mode === shownDialog) return;
    shownDialog = mode;
    for (const d of dialogs) {
      setHidden(d.overlay, !mode);
      setClass(d.overlay, 'won', mode === 'WON');
      setClass(d.overlay, 'lost', mode === 'LOST');
      setHidden(d.resume, mode !== 'PAUSED');
      if (!mode) continue;
      if (mode === 'PAUSED') {
        setText(d.title, 'Paused');
        setText(d.text, 'The city waits. Press P or Escape to keep walking.');
        setText(d.restart, 'Restart');
        setText(d.hint, 'P / Escape resumes · R restarts');
      } else {
        setText(d.title, mode === 'WON' ? 'City explored!' : 'Time is up');
        setText(d.text, mode === 'WON'
          ? `You reached ${g.score} points with ${clockText} to spare.`
          : `You collected ${g.ringsCollected} rings (${g.score} / ${rules.targetScore} points).`);
        setText(d.restart, 'Walk again');
        setText(d.hint, 'Press R to restart');
      }
    }
  }

  // HUD strings the in-page HUD derives here; read() ships them to the overlay.
  function hudText(clock = game.clock.snapshot()) {
    const secs = Math.max(0, Math.ceil(clock.remainingSeconds));
    const guide = game.nearestRing();
    // Points at the next street waypoint toward the ring, relative to the camera view.
    const bearing = guide
      ? Math.round(-wrapPi(Math.atan2(-(guide.x - g.player.x), -(guide.z - g.player.z)) - g.camera.yaw) * 180 / Math.PI)
      : 0;
    return {
      clockText: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`,
      clockWarn: secs <= 10 && g.state === 'RUNNING',
      guideText: guide ? `Nearest ring ${guide.distance.toFixed(0)} m` : '',
      guideBearing: bearing,
      yielding: g.cars.reduce((n, c) => n + (c.yielding ? 1 : 0), 0),
      bonusFlash: g.elapsed < flashUntil,
    };
  }

  // Pure: reads only the event and constant copy, never the live game.
  function describeEvent(event) {
    switch (event.type) {
      case 'round.started': return 'The walker in the red shirt sets off along the sunlit sidewalk into the city grid.';
      case 'ring.collected': return `The walker reaches a glowing ring: ${event.score} points.`;
      case 'car.yield': return event.to === 'player'
        ? 'A car brakes to a stop for the walker.'
        : 'A car stops to let a pedestrian cross.';
      case 'car.resume': return null; // frequent and uneventful
      case 'round.won': return `The walk ends with ${event.score} points on the board.`;
      case 'round.lost': return 'The city clock runs out.';
      default: return null;
    }
  }

  poseScene();
  return {
    canvas: renderer.domElement,
    update(dt, nextInput) {
      keyboard = nextInput;
      if (keyboard.consumePress('pause')) togglePause();
      if (paused) return;
      game.update(dt, keyboard);
      stepTurns(dt);
      pendingCameraDt += dt;
      if (finished()) clearInput();
    },
    layout(width, height) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    read() {
      const snap = game.read();
      // Only a live run can be paused; the flag is what holds the rollout.
      const out = { ...snap, paused: paused && snap.state === 'RUNNING', ...hudText() };
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
    // The camera consumes the sim time update() accumulated; dt is kept in the
    // signature for the shared host contract.
    render(_dt) { poseScene(); present(); renderer.render(scene, camera); },
    reset() {
      clearInput();
      paused = false;
      game.reset();
      snapTurns();
      lastScore = 0;
      flashUntil = -1;
      cameraDistance = CAMERA_DISTANCE;
      pendingCameraDt = 0;
      poseScene();
    },
    automation: () => ({
      visual: {
        player: city.player.group.position.toArray(),
        camera: camera.position.toArray(),
        drawCalls: renderer.info.render.calls,
      },
    }),
    destroy() {
      listeners.abort();
      clearInput();
      const geometries = new Set(), materials = new Set();
      scene.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (material) materials.add(material);
        }
      });
      for (const resource of [...geometries, ...materials]) resource.dispose();
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}
