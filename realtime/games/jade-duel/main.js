// SPDX-License-Identifier: Apache-2.0
import { boot } from '../_shared/app.mjs';
import { createGame } from './game.mjs';
import { createScene } from './scene.mjs';

const CONTROLS = 'A/D move · F punch combo · G guard · Space jump · E uppercut · R energy wave · Shift dash · P pause · Enter restart';
export function start() {
  const game = createGame();
  const scene = createScene(game.read());
  boot({
    game, scene,
    keymap: { KeyA: 'left', KeyD: 'right', ArrowLeft: 'left', ArrowRight: 'right', KeyF: 'fire', KeyG: 'guard', Space: 'jump', KeyE: 'special', KeyR: 'reload', ShiftLeft: 'dash', ShiftRight: 'dash', Enter: 'restart', KeyP: 'pause', Escape: 'pause' },
    hud: { title: 'Jade Duel', controls: CONTROLS, crosshair: 'none',
      bars: [{ id: 'hp', label: 'YOU', color: '#4a9be0' }, { id: 'en', label: 'ENERGY', color: '#59e8c8' }, { id: 'foe', label: 'OPPONENT', color: '#e0793f', top: true }] },
    hudState: (s) => ({
      objective: s.state !== 'RUNNING' ? (s.state === 'WON' ? 'Opponent knocked out' : 'You were knocked out') : s.combo > 1 ? `Combo x${s.combo}` : 'Defeat the orange fighter',
      bars: {
        hp: { value: s.health, max: 100, text: `${Math.ceil(s.health)}` },
        en: { value: s.energy, max: 60, text: `${Math.floor(s.energy)}` },
        foe: { value: s.opponent.hp, max: 100, text: `${Math.ceil(s.opponent.hp)}` },
      },
    }),
    onEvent: (ev, fx) => {
      if (ev.type === 'enemy.attack') fx.say('Strike incoming - guard (G) or jump', '#ffb35a', .6);
      if (ev.type === 'enemy.guarding') fx.say('Opponent guarding - use uppercut / wave', '#8fe8ff', .8);
      if (ev.type === 'strike.blocked') fx.say('Blocked', '#59e8c8', .5);
    },
    result: { win: { label: 'Knockout', value: 'Victory' }, lose: { label: 'Knocked out', value: 'Try again' },
      stats: (s) => [{ label: 'Hits landed', value: `${s.hits}` }, { label: 'Health', value: `${Math.ceil(s.health)}` }, { label: 'Blocks', value: `${s.blocked}` }] },
  });
}
