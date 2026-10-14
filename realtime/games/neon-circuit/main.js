import { NoToneMapping, PerspectiveCamera, Scene } from 'three';
import { createRenderer } from '/assets/user-interface/PrototypeShell.js';
import { createGame } from './game.mjs';
import { trackFrame } from './track.mjs';
import { createWorld } from './visuals.js';
import { mountUI, mountResultUI } from './ui/view.js';
import { raceDisplay } from './ui/model.js';

// Game contract surface (docs/game-contract.md). The race is a pure
// keyboard loop: held throttle/brake and a steer axis read through the
// host input (the persistent shim below adds the axis() reading the old
// KeyState offered), with R-owned restarts handled by the host. The two
// UI mounts are game-owned DOM subtrees built by the generator's factory.

export function createRuntime(host) {
  const renderer = createRenderer(document.querySelector('#app'), { shadows: false, antialias: false, pixelRatio: 1 });
  renderer.toneMapping = NoToneMapping;
  const scene = new Scene();
  const camera = new PerspectiveCamera(63, 1, 0.1, 320);
  const world = createWorld(scene);

  host.input.bind({
    KeyW: 'throttle', ArrowUp: 'throttle', Enter: 'throttle',
    KeyS: 'brake', ArrowDown: 'brake',
    KeyA: 'steerLeft', ArrowLeft: 'steerLeft',
    KeyD: 'steerRight', ArrowRight: 'steerRight',
  });

  const game = createGame();

  // -- persistent input shim -------------------------------------------------
  // The sim reads the old KeyState shape: isDown()/consumePress()/clear()
  // plus axis(negative, positive) for steering. One object, no per-step
  // allocation; the host input supplies the real state.
  const shim = {
    isDown: null, consumePress: null, clear: null,
    axis(negativeAction, positiveAction) {
      return (shim.isDown(positiveAction) ? 1 : 0) - (shim.isDown(negativeAction) ? 1 : 0);
    },
  };
  function padFor(input) {
    shim.isDown = input.isDown;
    shim.consumePress = input.consumePress;
    shim.clear = input.clear;
    return shim;
  }

  // -- game-owned DOM subtrees (generator UI factory) -------------------------
  const ui = mountUI({ mount: document.querySelector('#small-stage') });
  const uiBig = mountResultUI({ mount: document.querySelector('#view-big') });

  // -- narration (the host pump drains read().events into the live box) -------
  function describeEvent(e) {
    switch (e.type) {
      case 'boost.collected':
        return 'The car scoops up a glowing boost pack and surges down the straight.';
      case 'lap.completed':
        return `The car sweeps across the line to complete lap ${e.lap} of 3.`;
      case 'rival.contact':
        return 'The car clips a rival racer and the chassis takes a dent.';
      case 'round.won':
        return 'Three laps in first place — the neon circuit is conquered.';
      case 'round.started':
        return 'The lights go green and the car launches off the grid into the neon night.';
      case 'round.lost':
        // Pure: the cause travels on the event, so no snapshot is read here.
        if (e.cause === 'crash') return 'A third collision wrecks the car and the night race ends in smoke.';
        if (e.cause === 'clock') return 'The clock runs out before the third lap is complete.';
        return 'A rival racer storms across the line first and the race is lost.';
      default:
        return null;
    }
  }

  // -- per-frame camera + presentation ----------------------------------------
  // The camera sits rigidly on the track frame instead of easing toward it.
  // A per-frame `lerp(target, .24)` was frame-rate coupled: presentation runs at
  // 24 fps over a 60 Hz sim, so a presented frame spans two or three sim steps
  // and the car advanced a different distance each time. With a fixed
  // coefficient the catch-up per frame was uneven, which read as longitudinal
  // judder that grew with speed (0.17 m of gap swing at the old throttle 22).
  // Pinning the pose removes the oscillation outright; the trailing distance is
  // constant, so nothing about the framing changes.
  function poseCamera(s) {
    world.update(s);
    const p = trackFrame(s.distance, s.lane);
    camera.position.set(p.x - p.fx * 7.8, 4.1, p.z - p.fz * 7.8);
    camera.lookAt(p.x + p.fx * 9, .7, p.z + p.fz * 9);
  }
  // Lives in render(), not update(): the race UI must keep painting after
  // the outcome freezes the host clock (state !== 'RUNNING' stops stepping).
  function present(s) {
    const view = raceDisplay(s);
    ui.update(view);
    uiBig.update(view);
  }

  // -- legacy debugging handles (tolerated, not part of the contract) ----------
  window.__step1 = { scene, camera };
  window.__visualParams = Object.freeze({ read: () => JSON.parse(JSON.stringify(world.params)) });

  return {
    canvas: renderer.domElement,

    start() {
      // All construction happened in createRuntime; the race begins on the
      // first throttle/steer input.
    },

    update(dt, input) {
      const pad = padFor(input);
      game.handleInput(pad);
      game.update(dt, pad);
    },

    layout(width, height) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },

    read() {
      const snap = game.read();
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

    // The camera is pinned to the track frame, so dt is unused; the argument
    // keeps the host contract shared with the other games.
    render(_dt) {
      const s = game.read();
      poseCamera(s);
      present(s);
      renderer.render(scene, camera); // host feeds recorder/p2r right after
    },

    reset() {
      game.reset(); // freshRound(roundId + 1); host input clear follows
    },

    automation() {
      return { visual: world.read() };
    },

    destroy() {
      ui.dispose();
      uiBig.dispose();
    },
  };
}