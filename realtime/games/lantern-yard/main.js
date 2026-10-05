import { PerspectiveCamera, Scene } from 'three';
import {
  createRenderer, installResize, KeyState, MouseLookDelta,
} from '/assets/user-interface/PrototypeShell.js';
import { OrbitFollowCameraRig } from '/assets/camera/OrbitFollowCameraRig.js';
import { createGameLoop } from './game-loop.mjs';
import { createGame } from './game.mjs';
import { buildCourtyard, LAYOUT } from './scene.mjs';

export async function start() {
  const renderer = createRenderer(document.querySelector('#app'), { shadows: true });
  const scene = new Scene();
  const camera = new PerspectiveCamera(55, 1, 0.1, 200);
  const actors = buildCourtyard(scene);
  installResize(renderer, camera, renderer.domElement.parentElement);

  const game = createGame();
  const keys = new KeyState({
    KeyW: 'forward', ArrowUp: 'forward',
    KeyS: 'back', ArrowDown: 'back',
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right',
    KeyQ: 'lookLeft', KeyE: 'lookRight',
    ShiftLeft: 'sprint', ShiftRight: 'sprint',
    KeyR: 'restart',
  }).attach(window);
  const look = new MouseLookDelta(renderer.domElement, { pointerLock: true });
  const rig = new OrbitFollowCameraRig({
    distance: 8.5, anchorHeight: 1.45, pitch: -0.32, yaw: 0, positionLag: 0.04,
  });

  const loop = createGameLoop(game, {
    mode: 'fixed',
    input: keys,
    isActive: () => game.state === 'RUNNING',
    // Coarser steps keep simulation near real time on slow (software) renderers.
    timing: { stepSeconds: 1 / 30, maxSteps: 12, maxBacklogSeconds: 0.5 },
  });

  const total = LAYOUT.lanterns.length;
  const pipsEl = document.querySelector('#lantern-pips');
  const pips = Array.from({ length: total }, () => {
    const el = document.createElement('span');
    el.className = 'pip';
    pipsEl.appendChild(el);
    return el;
  });
  const countEl = document.querySelector('#lantern-count');
  const timeEl = document.querySelector('#time-value');
  const resultEl = document.querySelector('#result');
  const titleEl = document.querySelector('#result-title');
  const reasonEl = document.querySelector('#result-reason');
  const REASONS = {
    all_lanterns: 'Every lantern is lit. The yard glows.',
    caught_by_guard: 'The guard caught you.',
    time_up: 'Time ran out before all five lanterns were found.',
  };

  // UI only reflects game state; the game owns outcome and restart.
  function paintHud(snap) {
    pips.forEach((el, i) => el.classList.toggle('lit', i < snap.lanternsCollected));
    countEl.textContent = `${snap.lanternsCollected}/${total}`;
    timeEl.textContent = `${Math.ceil(snap.timeLeft)}s`;
    timeEl.classList.toggle('low', snap.timeLeft <= 15);
    const ended = snap.state !== 'RUNNING';
    resultEl.classList.toggle('show', ended);
    resultEl.classList.toggle('won', snap.state === 'WON');
    resultEl.classList.toggle('lost', snap.state === 'LOST');
    if (ended) {
      titleEl.textContent = snap.state === 'WON' ? 'Lanterns Gathered' : 'Round Lost';
      reasonEl.textContent = REASONS[snap.outcomeReason] ?? snap.outcomeReason ?? '';
    }
  }

  let bobTime = 0;
  function syncVisuals() {
    const vis = game.visuals();
    const p = vis.player.position;
    actors.player.group.position.set(p.x, 0, p.z);
    actors.player.group.rotation.y = vis.player.yaw;
    actors.player.setPose(vis.moving ? 'walk' : 'idle', game.elapsed);
    actors.guard.group.position.set(vis.guard.x, 0, vis.guard.z);
    actors.guard.group.rotation.y = vis.guard.yaw;
    bobTime += 1 / 60;
    actors.lanterns.forEach((node, i) => {
      node.visible = vis.lanternTaken[i] !== true;
      const body = node.getObjectByName('lantern-body');
      if (body) body.position.y = 1.45 + Math.sin(bobTime * 2 + i) * 0.08;
    });
    actors.guard.setPose(vis.state === 'RUNNING' ? 'walk' : 'idle', game.elapsed);
    rig.setLook(vis.cameraYaw, vis.cameraPitch);
    rig.step({
      targetPosition: p,
      deltaSeconds: 1 / 60,
      camera,
    });
  }

  window.__scene = { scene, camera };
  window.__gameTest = Object.freeze({
    read: () => loop.read(),
  });

  paintHud(game.read());
  syncVisuals();

  document.addEventListener('visibilitychange', () => loop.suspend());
  window.addEventListener('blur', () => loop.suspend());

  const frame = now => {
    const d = look.consume();
    game.addLook(d.x, d.y);
    loop.tick(now, { active: !document.hidden });
    syncVisuals();
    paintHud(game.read());
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
