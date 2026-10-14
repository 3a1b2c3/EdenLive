import { Vector3 } from 'three';
import { createRenderer, installResize, KeyState } from '/assets/user-interface/PrototypeShell.js';
import { PoseFollowCameraRig } from '/assets/camera/PoseFollowCameraRig.js';
import { ResourcePool } from '/assets/gameplay/ResourcePool.js';
import { createGameLoop } from './game-loop.mjs';
import { createGame } from './game.mjs';
import { buildScene } from './scene.js';

const KEYS = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'drift', ShiftRight: 'drift', Space: 'nitro', KeyR: 'restart',
};

export async function start() {
  const renderer = createRenderer(document.querySelector('#app'), { shadows: true, pixelRatio: 1 });
  const { scene, camera, track, karts, nitroBoxes } = buildScene();
  installResize(renderer, camera, renderer.domElement.parentElement);
  const input = new KeyState(KEYS).attach(window);
  const game = createGame({ track, createPool: (opts) => new ResourcePool(opts) });
  const loop = createGameLoop(game, {
    mode: 'fixed', input, isActive: () => game.state === 'RUNNING',
    timing: { maxSteps: 30, maxBacklogSeconds: 0.5 },
  });
  const rig = new PoseFollowCameraRig({
    cameraOffset: { forward: -7.2, up: 3.3, right: 0 },
    lookAtOffset: { forward: 5, up: 1.1, right: 0 },
    speedCameraOffset: { forward: -0.06, up: 0, right: 0 },
    positionLag: 0.12, lookLag: 0.06,
  });
  const byId = Object.fromEntries(karts.map((k) => [k.id, k]));
  const banner = document.querySelector('#banner');
  let lastRound = -1;
  let lastT = 0;

  function syncKart(view, state, steer = 0, slip = 0) {
    view.root.position.set(state.x, 0, state.z);
    view.root.rotation.y = state.yaw + slip;
    for (const w of view.wheels) {
      w.pivot.rotation.x = -state.wheelSpin;
      if (w.front) w.pivot.rotation.y = steer * 0.4;
    }
  }

  function sync(dt) {
    const snap = game.read();
    const { player, rivals } = game.karts;
    const driftLean = player.drifting ? (player.driftDir ?? 0) * Math.min(0.5, player.slip + 0.15) : 0;
    syncKart(byId.player, player, player.steer, driftLean);
    byId.player.flames.visible = player.boost > 0;
    for (const r of rivals) syncKart(byId[r.id], r);
    game.boxes.forEach((b, i) => {
      nitroBoxes[i].visible = b.respawn <= 0;
      nitroBoxes[i].rotation.y += dt * 1.6;
    });
    const yaw = player.yaw;
    const forward = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    rig.step({
      targetPosition: new Vector3(player.x, 0.6, player.z),
      targetFrame: { forward, up: new Vector3(0, 1, 0) },
      targetSpeed: player.speed,
      snapToTarget: snap.roundId !== lastRound,
      deltaSeconds: dt,
      camera,
    });
    lastRound = snap.roundId;
    renderUi(snap);
  }

  const el = (id) => document.getElementById(id);
  const ui = { pos: el('pos').querySelector('b'), lap: el('lap'), time: el('time'), spd: el('spd'),
    cells: el('cells'), charge: el('charge'), tags: el('tags'), result: el('result') };
  const NAMES = { player: 'You', rival_blue: 'Blue', rival_green: 'Green', rival_yellow: 'Yellow' };
  let resultRound = -1;

  function renderUi(snap) {
    ui.pos.textContent = String(snap.position);
    ui.lap.textContent = `${snap.player.displayLap}/${snap.lapsToWin}`;
    ui.time.textContent = snap.timeLeft.toFixed(1);
    ui.time.className = snap.timeLeft < 20 ? 'low' : '';
    ui.spd.textContent = String(Math.round(snap.player.speed * 6));
    ui.cells.innerHTML = Array.from({ length: snap.nitro.max }, (_, i) => `<i class="${i < snap.nitro.charges ? 'on' : ''}"></i>`).join('');
    ui.charge.style.width = `${Math.round(snap.nitro.gauge * 100)}%`;
    ui.tags.innerHTML = (snap.player.drifting ? '<span class="tag">DRIFT!</span>' : '')
      + (snap.player.boosting ? '<span class="tag boost">NITRO BOOST</span>' : '');

    let msg = '';
    let hint = false;
    if (snap.phase === 'grid') { msg = 'Press W to start the race'; hint = true; }
    else if (snap.phase === 'countdown') msg = String(snap.countdown);
    else if (snap.state === 'RUNNING' && snap.raceTime < 0.8) msg = 'GO!';
    banner.textContent = msg;
    banner.className = hint ? 'hint' : '';
    banner.style.display = msg ? 'block' : 'none';

    const done = snap.state !== 'RUNNING';
    if (done && resultRound !== snap.roundId) {
      resultRound = snap.roundId;
      const won = snap.state === 'WON';
      const title = won ? '1st Place!' : (snap.outcomeReason === 'time_up' ? 'Time Up' : 'Race Lost');
      const sub = won ? `You won in ${snap.raceTime.toFixed(1)} s`
        : (snap.outcomeReason === 'time_up' ? 'The race clock ran out' : `${NAMES[snap.finishOrder[0]]} crossed the line first`);
      const order = [...snap.finishOrder];
      const rest = Object.entries(snap.rivals).filter(([id]) => !order.includes(id)).sort((x, y) => y[1].progress - x[1].progress).map(([id]) => id);
      if (!order.includes('player')) {
        const pp = snap.player.progress;
        const idx = rest.findIndex((id) => snap.rivals[id].progress < pp);
        rest.splice(idx < 0 ? rest.length : idx, 0, 'player');
      }
      const standings = [...order, ...rest].map((id) => `<li class="${id === 'player' ? 'me' : ''}">${NAMES[id]}</li>`).join('');
      ui.result.className = `panel ${won ? 'won' : 'lost'}`;
      ui.result.innerHTML = `<h1>${title}</h1><p>${sub}</p><ol>${standings}</ol><span class="again">Press R to race again</span>`;
    }
    ui.result.style.display = done ? 'block' : 'none';
    if (!done) resultRound = -1;
  }

  window.__scene = { scene, camera, player: byId.player.root };
  window.__gameTest = Object.freeze({ read: () => loop.read() });
  document.addEventListener('visibilitychange', () => loop.suspend());
  window.addEventListener('blur', () => loop.suspend());
  const frame = (now) => {
    loop.tick(now, { active: !document.hidden });
    const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 1 / 60;
    lastT = now;
    sync(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
