import { Matrix4, PerspectiveCamera, Scene } from 'three';
import { KeyState, createRenderer, installResize } from '/assets/user-interface/PrototypeShell.js';
import { PoseFollowCameraRig } from '/assets/camera/PoseFollowCameraRig.js';
import { createGameLoop } from './game-loop.mjs';
import { createGame } from './game.mjs';
import { buildCityScene, setGateColor } from './scene.mjs';

const KEY_MAP = {
  KeyW: 'throttle', ArrowUp: 'throttle', KeyS: 'brake', ArrowDown: 'brake',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'handbrake', KeyR: 'restart', Enter: 'restart',
};
const GATE_PENDING = 0x25c7dd;
const GATE_PASSED = 0x59e08a;
const TOAST_SECONDS = 1.4;
const LOW_HEALTH = 35;
const LOW_TIME = 10;
const VERDICT = {
  WON: { title: 'FINISHED', style: 'won' },
  LOST: { title: 'RACE OVER', style: 'lost' },
};
const REASON_TEXT = {
  objectiveComplete: 'You crossed the finish line before the clock ran out.',
  resourceDepleted: 'The taxi is wrecked.',
  timerExpired: 'Time ran out before the finish line.',
};

const byId = id => document.getElementById(id);

function formatClock(seconds) {
  const whole = Math.ceil(Math.max(0, seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function createHud(pipCount) {
  const el = {
    health: byId('hud-health'), healthFill: byId('hud-health-fill'), healthText: byId('hud-health-text'),
    clock: byId('hud-clock'), time: byId('hud-time'),
    progressText: byId('hud-progress-text'), pips: [...byId('hud-pips').querySelectorAll('i')],
    finish: byId('hud-finish'), distance: byId('hud-distance'), speed: byId('hud-speed'), toast: byId('hud-toast'),
    result: byId('result'), title: byId('result-title'), reason: byId('result-reason'),
    resultTime: byId('result-time'), resultCheckpoints: byId('result-checkpoints'),
    resultHealth: byId('result-health'), resultHits: byId('result-hits'),
  };
  if (el.pips.length !== pipCount) throw new Error(`HUD markup has ${el.pips.length} checkpoint pips, expected ${pipCount}`);
  let toastUntil = 0;
  const seenEvents = new Set();

  function toast(text, style, now) {
    el.toast.textContent = text;
    el.toast.className = style;
    el.toast.style.display = 'block';
    toastUntil = now + TOAST_SECONDS * 1000;
  }

  return {
    update(observed, now) {
      const hpMax = observed.round.resources[0].max;
      el.healthFill.style.width = `${(observed.health / hpMax) * 100}%`;
      el.healthText.textContent = `${Math.round(observed.health)} / ${hpMax}`;
      el.health.classList.toggle('low', observed.health <= LOW_HEALTH);
      el.time.textContent = formatClock(observed.timeRemaining);
      el.clock.classList.toggle('warn', observed.timeRemaining <= LOW_TIME);
      el.progressText.textContent = `CHECKPOINT ${observed.checkpoints} / ${observed.checkpointsTotal}`;
      el.pips.forEach((pip, i) => pip.classList.toggle('done', i < observed.checkpoints));
      el.finish.classList.toggle('open', observed.finishUnlocked);
      el.distance.textContent = observed.finishUnlocked ? `${Math.round(observed.distanceToFinish)} m to finish` : ' ';
      el.speed.textContent = String(Math.round(observed.car.speed * 3.6));

      for (const event of observed.events) {
        if (seenEvents.has(event.id)) continue;
        seenEvents.add(event.id);
        if (event.type === 'checkpoint.passed') toast(`CHECKPOINT ${event.index}  +${event.bonusSeconds}s`, 'good', now);
        if (event.type === 'car.hit') toast(`CRASH  -${event.damage}`, 'bad', now);
      }
      if (now > toastUntil) el.toast.style.display = 'none';

      const verdict = VERDICT[observed.state];
      if (verdict) {
        el.result.className = verdict.style;
        el.title.textContent = verdict.title;
        el.reason.textContent = REASON_TEXT[observed.outcomeReason] ?? observed.outcomeReason;
        el.resultTime.textContent = `${observed.elapsed.toFixed(1)} s`;
        el.resultCheckpoints.textContent = `${observed.checkpoints} / ${observed.checkpointsTotal}`;
        el.resultHealth.textContent = `${Math.round(observed.health)} / ${hpMax}`;
        el.resultHits.textContent = String(observed.hits);
        el.result.style.display = 'flex';
      } else {
        el.result.style.display = 'none';
      }
    },
    onRestartClick(handler) {
      el.result.addEventListener('pointerdown', event => {
        event.stopPropagation();
        handler();
      });
    },
    resetEvents() {
      seenEvents.clear();
      el.toast.style.display = 'none';
    },
  };
}

export async function start() {
  const renderer = createRenderer(document.querySelector('#app'), { shadows: false, pixelRatio: 1 });
  const scene = new Scene();
  const camera = new PerspectiveCamera(62, 1, 0.5, 1200);
  const world = buildCityScene(scene, camera);
  installResize(renderer, camera, renderer.domElement.parentElement);

  const game = createGame({ parkedBoxes: world.parkedBoxes, traffic: world.traffic });
  const input = new KeyState(KEY_MAP).attach(window);
  const loop = createGameLoop(game, { mode: 'fixed', input, isActive: game.isActive });
  const rig = new PoseFollowCameraRig({
    cameraOffset: { forward: -9, up: 3.8, right: 0 },
    lookAtOffset: { forward: 12, up: 1.2, right: 0 },
    speedCameraOffset: { forward: -0.07, up: 0.01, right: 0 },
    positionLag: 0.1,
    lookLag: 0.12,
    frameLag: 0.12,
  });
  const trafficById = new Map(world.traffic.map(t => [t.id, t.group]));
  const hud = createHud(world.gates.length);
  hud.onRestartClick(() => game.requestRestart());
  const orientation = new Matrix4();
  let odometer = 0;
  let shownRound = null;
  let shownGates = 0;

  window.__scene = { scene, camera };
  window.__gameTest = Object.freeze({ read: () => loop.read() });
  document.addEventListener('visibilitychange', () => loop.suspend());
  window.addEventListener('blur', () => loop.suspend());

  function syncVisuals(frame) {
    const view = game.view();
    const { car } = view;
    const roundChanged = shownRound !== view.roundId;
    if (roundChanged) {
      odometer = 0;
      shownGates = 0;
      world.gates.forEach(gate => setGateColor(gate, GATE_PENDING));
      hud.resetEvents();
      shownRound = view.roundId;
    }
    const player = world.player;
    player.group.position.set(car.position.x, 0, car.position.z);
    const { right, up, forward } = car.bodyFrame;
    orientation.makeBasis(right, up, forward.clone().negate());
    player.group.quaternion.setFromRotationMatrix(orientation);
    odometer += car.velocity.length() * frame.simDt;
    player.setPose('drive', odometer / 6);
    for (const t of view.trafficState) trafficById.get(t.id).position.z = t.z;
    for (; shownGates < view.checkpointsPassed; shownGates += 1) setGateColor(world.gates[shownGates], GATE_PASSED);
    rig.step({
      targetPosition: car.position, targetFrame: car.bodyFrame, targetSpeed: car.velocity.length(),
      deltaSeconds: Math.max(frame.rawDt, 1 / 240), camera, snapToTarget: roundChanged,
    });
  }

  const frame = now => {
    const tick = loop.tick(now, { active: !document.hidden });
    syncVisuals(tick);
    hud.update(game.read(), now);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
