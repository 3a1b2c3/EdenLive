// SPDX-License-Identifier: Apache-2.0
import { boot } from '../_shared/app.mjs';
import { createGame } from './game.mjs';
import { createScene } from './scene.mjs';

const CONTROLS = 'WASD move · Arrows turn · Hold F breathe fire · Space stomp · P pause · Enter restart';
export function start() {
  const game = createGame();
  const scene = createScene(game.read());
  boot({
    game, scene,
    hud: { title: 'Iron Colossus', controls: CONTROLS, crosshair: 'dot',
      bars: [{ id: 'hp', label: 'HIDE', color: '#e0583a' }, { id: 'heat', label: 'FLAME', color: '#ffb02e' }], pips: 6 },
    hudState: (s) => ({
      objective: s.towersLeft === 0 ? 'City defenses destroyed' : `Towers left: ${s.towersLeft}`, pipsOn: 6 - s.towersLeft,
      bars: {
        hp: { value: s.health, max: s.maxHealth, text: `${Math.ceil(s.health)}` },
        heat: { value: 100 - s.heat, max: 100, text: s.overheated ? 'COOLING' : s.heat > 0 ? 'BREATHING' : 'READY', color: s.overheated ? '#9a6a5a' : '#ffb02e' },
      },
    }),
    onEvent: (ev, fx) => {
      if (ev.type === 'flame.overheated') fx.say('Flame spent - let it cool', '#ffb02e', 1.1);
      if (ev.type === 'defense.fired') fx.say('Incoming shell', '#ff8a5a', .5);
      if (ev.type === 'ground.stomped') fx.say('Stomp!', '#ffe0a0', .6);
    },
    result: { win: { label: 'City defenses down', value: 'Victory' }, lose: { label: 'Colossus felled', value: 'Try again' },
      stats: (s) => [{ label: 'Towers destroyed', value: `${6 - s.towersLeft} / 6` }, { label: 'Hide', value: `${Math.ceil(s.health)}` }, { label: 'Stomps', value: `${s.stomps}` }] },
  });
}
