// SPDX-License-Identifier: Apache-2.0
import { boot } from '../_shared/app.mjs';
import { createGame } from './game.mjs';
import { createScene } from './scene.mjs';

const CONTROLS = 'WASD move · Arrows aim · F swing axe · Space jump (dodge bites) · P pause · Enter restart';
export function start() {
  const game = createGame();
  const scene = createScene(game.read());
  boot({
    game, scene,
    hud: { title: 'Ember Den', controls: CONTROLS, bars: [{ id: 'hp', label: 'HEALTH', color: '#d9452f' }], pips: 3, crosshair: 'dot' },
    hudState: (s) => ({
      objective: s.kills >= 3 ? 'Cave cleared' : `Spiders left: ${3 - s.kills}`,
      pipsOn: s.kills, bars: { hp: { value: s.health, max: s.maxHealth, text: `${Math.ceil(s.health)}` } },
    }),
    onEvent: (ev, fx) => {
      if (ev.type === 'enemy.attack') fx.say('Bite incoming - step back or jump', '#ffcf6b', 1);
      if (ev.type === 'bite.dodged') fx.say('Dodged', '#9fe03c', .6);
    },
    result: { win: { label: 'Cave cleared', value: 'Victory' }, lose: { label: 'Overrun', value: 'Try again' },
      stats: (s) => [{ label: 'Spiders slain', value: `${s.kills} / 3` }, { label: 'Health', value: `${Math.ceil(s.health)}` }, { label: 'Axe swings', value: `${s.swings}` }] },
  });
}
