// SPDX-License-Identifier: Apache-2.0
// Shared boot: renderer, input map, fixed-step loop, HUD, result and pause cards.
import { createRenderer, installResize, KeyState } from '/assets/user-interface/PrototypeShell.js';
import { createGameUI } from '/assets/user-interface/GameUiFactory.js';
import { createGameLoop } from './game-loop.mjs';
import { createHud } from './hud.mjs';

export const KEYMAP = {
  KeyW: 'forward', KeyS: 'back', KeyA: 'left', KeyD: 'right',
  ArrowLeft: 'aimLeft', ArrowRight: 'aimRight', ArrowUp: 'aimUp', ArrowDown: 'aimDown',
  KeyF: 'fire', KeyE: 'special', KeyR: 'reload', ShiftLeft: 'dash', ShiftRight: 'dash', Space: 'jump', KeyG: 'guard',
  Enter: 'restart', KeyP: 'pause', Escape: 'pause',
};

/**
 * cfg: {game, scene:{scene,camera,sync(s,dt)}, keymap?, hud:{title,controls,bars,pips,ammo,crosshair},
 *       hudState(s, fx)->{objective,bars,...}, onEvent?(ev, fx), events?: (s)=>events (default s.events),
 *       result:{win:{value,text?}, lose:{value}, stats?(s)->[{label,value}]}, fixedMode?}
 */
export function boot(cfg) {
  const root = document.querySelector('#app');
  const { game, scene: view } = cfg;
  const renderer = createRenderer(root, { shadows: false, pixelRatio: 1 });
  installResize(renderer, view.camera, root);
  const keys = new KeyState(cfg.keymap ?? KEYMAP).attach();
  const loop = createGameLoop(game, { mode: 'fixed', input: keys, isActive: () => game.read().state === 'RUNNING' && !game.read().paused });
  window.__scene = { scene: view.scene, camera: view.camera };
  window.__gameTest = Object.freeze({ read: () => loop.read() });

  const hudRoot = document.createElement('div');
  hudRoot.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  root.appendChild(hudRoot);
  const hud = createHud(hudRoot, cfg.hud);
  const fxState = { hurt: 0, flash: 0, hitmark: 0, hitKill: false, dirAngle: 0, dirAlpha: 0, msg: '', msgT: 0, msgColor: '#fff' };
  const restart = () => { game.reset(); keys.clear(); ui.update({ result: { visible: false }, pause: { visible: false } }); };
  const ui = createGameUI({
    components: [
      { id: 'result', type: 'dialog', label: 'Round result', buttons: [{ id: 'restart', label: 'Play again', kind: 'primary' }] },
      { id: 'pause', type: 'dialog', variant: 'paused', label: 'Paused', buttons: [] },
    ],
    actions: { restart },
    theme: cfg.theme,
  });
  const say = (text, color = '#fff', t = 1.2) => { fxState.msg = text; fxState.msgT = t; fxState.msgColor = color; };
  fxState.say = say;

  window.addEventListener('blur', () => loop.suspend());
  document.addEventListener('visibilitychange', () => loop.suspend());
  let last = null, lastRound = -1;
  function frame(now) {
    const dt = last === null ? 0 : Math.min(.05, Math.max(0, (now - last) / 1000));
    last = now;
    loop.tick(now, { active: !document.hidden });
    const s = game.read();
    if (s.roundId !== lastRound) { lastRound = s.roundId; Object.assign(fxState, { hurt: 0, flash: 0, hitmark: 0, dirAlpha: 0, msg: '', msgT: 0 }); }
    const vdt = s.paused ? 0 : dt;
    // HUD reacts to the same event stream the scene consumes.
    const evs = view.pendingEvents?.(s) ?? [];
    for (const ev of evs) {
      if (ev.type === 'player.hit') { fxState.hurt = Math.min(1, .55 + ev.damage / 30); fxState.dirAngle = ev.angle ?? 0; fxState.dirAlpha = ev.angle ? 1 : 0; }
      if (ev.type === 'enemy.hit' && ev.by === 'player') { fxState.hitmark = 1; fxState.hitKill = !!ev.killed; }
      cfg.onEvent?.(ev, fxState, s);
    }
    view.sync(s, vdt, evs);
    fxState.hurt = Math.max(0, fxState.hurt - vdt * 1.6);
    fxState.flash = Math.max(0, fxState.flash - vdt * 1.5);
    fxState.hitmark = Math.max(0, fxState.hitmark - vdt * 5);
    fxState.dirAlpha = Math.max(0, fxState.dirAlpha - vdt * 1.4);
    fxState.msgT = Math.max(0, fxState.msgT - vdt);
    const h = cfg.hudState(s, fxState);
    hud.update({ hurt: s.health !== undefined && s.health < 30 && s.state === 'RUNNING' ? Math.max(fxState.hurt, .22 + .08 * Math.sin(s.elapsed * 6)) : fxState.hurt,
      flash: fxState.flash, hitmark: fxState.hitmark, hitKill: fxState.hitKill, dirAngle: fxState.dirAngle, dirAlpha: fxState.dirAlpha,
      msg: fxState.msgT > 0 ? fxState.msg : '', msgColor: fxState.msgColor, ...h });
    const r = cfg.result ?? {};
    const terminal = s.state !== 'RUNNING';
    ui.update({
      result: {
        visible: terminal, variant: s.state === 'WON' ? 'success' : 'failure',
        label: s.state === 'WON' ? (r.win?.label ?? 'Round complete') : (r.lose?.label ?? 'Round ended'),
        value: s.state === 'WON' ? (r.win?.value ?? 'Victory') : (r.lose?.value ?? 'Try again'),
        text: s.outcomeReason, stats: r.stats?.(s) ?? [],
      },
      pause: { visible: s.paused && !terminal, value: 'Paused', text: 'P / Escape to resume' },
    });
    renderer.render(view.scene, view.camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return { renderer, keys, ui, hud };
}
