import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from 'three';
import { createRenderer, installResize } from '/assets/user-interface/PrototypeShell.js';
import { createGameLoop } from './game-loop.mjs';
import { createGame } from './game.mjs';

export async function start() {
  const renderer = createRenderer(document.querySelector('#app'), { shadows: false, pixelRatio: 1 });
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 4);
  scene.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial({ color: 0x91a8c4 })));
  installResize(renderer, camera, renderer.domElement.parentElement);
  const game = createGame();
  // Stage 2 selects discrete or fixed and supplies input only when needed.
  const loop = createGameLoop(game, { mode: 'static' });
  window.__scene = { scene, camera };
  window.__gameTest = Object.freeze({ read: () => loop.read() });
  document.querySelector('#hud').textContent = 'Static scene is not composed yet.';
  document.addEventListener('visibilitychange', () => loop.suspend());
  window.addEventListener('blur', () => loop.suspend());
  const frame = now => {
    loop.tick(now, { active: !document.hidden });
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
