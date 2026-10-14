import * as THREE from 'three';
import { createRenderer } from '/assets/user-interface/PrototypeShell.js';
import { PositionFollowCameraRig } from '/assets/camera/PositionFollowCameraRig.js';
import { createGame } from './game.mjs';
import { createWorld } from './visuals.js';
import { mountUI, mountDialogUI } from './ui/view.js';
import { createPresenter } from './ui/presenter.js';

// Game contract surface (docs/game-contract.md): the host owns the loop,
// clock, input device, narration, recorder and modes; this module owns the
// renderer, world, UI and the state protocol. Everything mechanical that
// the old main.js duplicated per game is gone from here.

const PLATFORM_NAMES = {
  launch: 'launch pad', ridge: 'stone ridge', steps: 'stepped platforms',
  lookout: 'lookout stone', cove: 'shaded cove', spire: 'rocky spire', summit: 'summit',
};

export function createRuntime(host) {
  // ---- renderer / scene / camera (game-owned, host never touches) ----------
  const renderer = createRenderer(document.querySelector('#app'), { shadows: true, antialias: false, pixelRatio: 1 });
  const gl = renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
  const software = debug && /swiftshader|llvmpipe|software/i.test(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
  if (software) renderer.shadowMap.enabled = false;
  renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 300);
  const world = createWorld(scene, { lowPower: software });
  // Fixed-azimuth follow: the view never rotates, so new content arrives as
  // translation. Pulled to 0.5x of the original distance (12.4, 10.6, 0.7) —
  // distance, height and look height scale together, so the framing holds and
  // the robot reads at 151 px against the original 76. Closing in shrinks the
  // visible strip (42 m to 21 m), so walkSpeed in game.mjs carries the refresh
  // budget.
  const cameraRig = new PositionFollowCameraRig({ azimuth: -0.30, distance: 6.2, height: 5.3, lookHeight: 0.35, positionLag: 0.12, lookLag: 0.09 });

  // ---- input: declare bindings on the host device, never touch key codes
  host.input.bind({
    KeyW: 'forward', ArrowUp: 'forward', KeyS: 'backward', ArrowDown: 'backward',
    KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'jump',
  });

  // ---- game state + UI ------------------------------------------------------
  const game = createGame();
  const uiSmall = mountUI({ actions: { restart: host.restart }, mount: document.querySelector('#small-stage') });
  const uiBig = mountDialogUI({ actions: { restart: host.restart }, mount: document.querySelector('#view-big') });
  const present = createPresenter([uiSmall, uiBig]);

  let renderRound = 0;
  // HUD pickup toast, timed in sim seconds like the page presenter.
  let toastRound = 0, toastCoins = 0, toastUntil = 0;

  // Legacy debugging handle used by the old cover-capture scripts;
  // tolerated, not part of the contract.
  window.__step1 = { scene, camera };

  return {
    canvas: renderer.domElement, // required: host wires recorder/mirror to this

    start() {
      // The world is fully built in createRuntime; a fresh round is armed
      // by reset() below, which the host also calls on restart.
    },

    update(dt, input) {
      game.update(dt, input);
      const s = game.read();
      world.update(s, dt);
      if (toastRound !== s.roundId) { toastRound = s.roundId; toastCoins = 0; toastUntil = 0; }
      if (s.coins > toastCoins) { toastCoins = s.coins; toastUntil = s.elapsed + 1.6; }
    },

    layout(width, height) {
      renderer.setSize(width, height, false);
      renderer.domElement.style.width = width + 'px';
      renderer.domElement.style.height = height + 'px';
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },

    read() {
      const snap = game.read();
      snap.toast = snap.state === 'RUNNING' && snap.elapsed < toastUntil ? '+1 MOON COIN' : '';
      // The runtime stitches these sentences into the chunk's dynamic prompt.
      // Null means the event has no prompt line and is dropped.
      snap.events = snap.events.map(event => ({...event, prompt: describeEvent(event)}));
      return snap;
    },

    handleUiAction(action) {
      if (action === 'reset' || action === 'restart') {
        host.input.clear();
        host.restart();
        return true;
      }
      return false;
    },

    describeEvent,

    // dt is the sim time since the last captured model frame (tick delta / 60),
    // so the follow camera smooths against sim time, not the wall clock.
    render(dt) {
      const s = game.read();
      present(s);
      const target = new THREE.Vector3(s.player.x, s.player.y, s.player.z - 1.8);
      cameraRig.step({ targetPosition: target, snapToTarget: renderRound !== s.roundId, deltaSeconds: Number.isFinite(dt) ? dt : 0, camera });
      renderRound = s.roundId;
      renderer.render(scene, camera);
    },

    reset() {
      game.reset();
      for (const ui of [uiSmall, uiBig]) {
        if (ui.root.contains(document.activeElement)) document.activeElement.blur();
      }
    },

    destroy() {},
  };

  // Pure: reads only the event. robot.land carries the previous landing in
  // `from`, so a repeat landing on the same stone has no line.
  function describeEvent(e) {
    switch (e.type) {
      case 'round.started': return 'The little robot hops off the launch pad and sets out across the moonstones.';
      case 'coin.collected': return 'The robot snatches a golden moon coin.';
      case 'robot.land': {
        if (e.platform && e.platform !== e.from) {
          return `The robot clears the gap and lands on the ${PLATFORM_NAMES[e.platform] || e.platform}.`;
        }
        return null;
      }
      case 'round.won': return 'Every moon coin gathered — the beacon flares and the mission succeeds.';
      case 'round.lost': return 'The robot slips off the stones and vanishes into the moon mist.';
      default: return null;
    }
  }
}
