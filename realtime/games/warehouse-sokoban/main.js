// SPDX-License-Identifier: Apache-2.0
import { boot } from './lib/app.mjs';
import { createGame } from './game.mjs';
import { createScene } from './scene.mjs';

const CONTROLS = 'WASD / Arrow keys move and push · P pause · Enter restart';
export function start() {
  const game = createGame();
  const scene = createScene(game.read());
  boot({
    game, scene,
    keymap: { KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right', ArrowUp: 'forward', ArrowDown: 'back', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'restart', KeyP: 'pause', Escape: 'pause' },
    hud: { title: 'Warehouse Sokoban', controls: CONTROLS, crosshair: 'none', pips: 2 },
    hudState: (s) => ({
      objective: s.state === 'WON' ? 'Both crates delivered' : s.state === 'LOST' ? 'A crate is stuck' : 'Push both crates onto the brass pads',
      pipsOn: s.goalsFilled,
    }),
    onEvent: (ev, fx) => { if (ev.type === 'move.blocked') fx.say(ev.box ? 'Crate is blocked' : 'Wall', '#ffb35a', .5); },
    result: { win: { label: 'Puzzle solved', value: 'Victory' }, lose: { label: 'Crate stuck', value: 'Try again' },
      stats: (s) => [{ label: 'Crates on pads', value: `${s.goalsFilled} / 2` }, { label: 'Moves', value: `${s.moves}` }, { label: 'Pushes', value: `${s.pushes}` }] },
  });
}
