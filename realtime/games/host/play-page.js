// SPDX-License-Identifier: Apache-2.0
/**
 * Live-preview host for a hand-ported game. Capture uses host/backend.js and
 * a virtual clock; this page keeps the game's own RAF loop so a person can
 * play it in an iframe before selecting it as the next session's proxy.
 */
import {createInput} from '/ext/game2v/host/input.js';

const input = createInput();
input.bind({KeyR: 'restart'});
input.attach();
const {createRuntime} = await import(`/game/${window.gameSlug}/main.js`);
const runtime = await createRuntime({input, mode: 'play', restart: () => runtime.reset()});
runtime.reset();
const surface = document.querySelector('#app') || document.body;
function surfaceSize() {
  const rect = surface.getBoundingClientRect();
  return {width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height))};
}
function layout() {
  const {width, height} = surfaceSize();
  runtime.layout(width, height);
}
layout();
window.addEventListener('resize', layout);

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (input.consumePress('restart')) runtime.reset();
  runtime.update(dt, input);
  runtime.render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
