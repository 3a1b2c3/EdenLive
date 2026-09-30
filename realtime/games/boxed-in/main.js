import { LEVELS, DIRECTIONS } from './levels.mjs';
import { createGarden } from './scene.mjs';
import { fillIcons, icon } from './icons.mjs';
import { createGame } from './game.mjs';

const STEP = .145;
const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
const setHTML = (node, html) => { if (node && node.innerHTML !== html) node.innerHTML = html; };
const setHidden = (node, hidden) => { if (node && node.hidden !== hidden) node.hidden = hidden; };
const setDisabled = (node, disabled) => { if (node && node.disabled !== disabled) node.disabled = disabled; };
const prettyKey = { up: '↑', right: '→', down: '↓', left: '←' };
const fingerprint = state => `${state.roundId}:${state.moves}:${state.player.x},${state.player.y}:${state.crates.map(c => `${c.x},${c.y}`).join('|')}`;

export function createRuntime(host) {
  fillIcons();
  const game = createGame();
  let elapsed = 0, queue = [], walkWait = 0, toastText = '', toastUntil = 0;
  let hintToken = 0, hintBusy = false, hintCache = null, hintElapsed = 0, hintWorker = null;
  let lastPresentedOutcome = '';
  let helpOpen = false;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Both views carry the same instructions card, so the small stage's scale
  // applies to it exactly like the outcome card (a native <dialog> renders in
  // the top layer and would ignore that transform).
  const helpWraps = [document.getElementById('help-wrap'), document.getElementById('help-big')];
  const read = () => {
    const snap = game.read();
    snap.elapsed = elapsed;
    snap.helpOpen = helpOpen;
    snap.hintBusy = hintBusy;
    snap.toast = toastText && elapsed < toastUntil ? toastText : '';
    snap.levelSubtitle = LEVELS[snap.levelIndex]?.subtitle ?? '';
    // The runtime stitches these sentences into the chunk's dynamic prompt.
    // Null means the event has no prompt line and is dropped.
    snap.events = snap.events.map(event => ({...event, prompt: describeEvent(event)}));
    return snap;
  };
  const garden = createGarden(document.querySelector('#app'), game.board, read());

  host.input.bind({
    ArrowUp: 'up', KeyW: 'up', ArrowRight: 'right', KeyD: 'right',
    ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left',
    KeyZ: 'undo', KeyH: 'hint',
  });
  const listeners = new AbortController(), options = { signal: listeners.signal };
  const pad = { pressed: new Set() };
  const clearInput = () => { host.input.clear(); pad.pressed.clear(); };
  const view = Object.fromEntries([...document.querySelectorAll('#small-stage [id]')].map(node => [node.id, node]));
  const big = {
    overlay: document.getElementById('overlay-big'),
    icon: document.getElementById('big-result-icon'),
    eyebrow: document.getElementById('big-result-eyebrow'),
    title: document.getElementById('big-result-title'),
    copy: document.getElementById('big-result-copy'),
    stats: document.getElementById('big-result-stats'),
    secondary: document.getElementById('big-result-secondary'),
    primary: document.getElementById('big-result-primary'),
  };
  const touch = document.querySelector('.touch');

  function clearHint() {
    hintToken += 1;
    hintBusy = false;
    hintElapsed = 0;
    hintWorker?.terminate();
    hintWorker = null;
    toastText = '';
    toastUntil = 0;
    garden.showHint(null);
  }
  function toast(message, duration = 4.5) {
    toastText = message;
    toastUntil = duration === 0 ? Infinity : elapsed + duration;
  }
  function fillResult(nodes, snap) {
    const won = snap.state === 'WON';
    setHTML(nodes.icon, icon(won ? 'check' : 'undo'));
    setText(nodes.eyebrow, won ? 'A LITTLE MOMENT OF ORDER' : 'THERE IS ALWAYS ANOTHER WAY');
    setText(nodes.title, won ? 'Everything in its place.' : 'A little room to rethink.');
    setText(nodes.copy, won
      ? 'Every crate has found its home. Take another run whenever you like.'
      : 'This crate cannot reach a marked tile from here. Undo the last push and try a different approach.');
    setText(nodes.stats, `${snap.moves} moves  ·  ${snap.pushes} pushes`);
    setText(nodes.secondary, won ? 'Play again' : 'Start over');
    setHTML(nodes.primary, won ? `Start again ${icon('reset')}` : `${icon('undo')} Undo last push`);
  }
  function present() {
    const snap = read();
    const level = LEVELS[snap.levelIndex];
    setText(view['level-kicker'], `COURTYARD ${String(snap.levelIndex + 1).padStart(2, '0')}`);
    setHTML(view['level-name'], `${level.name}<span class="difficulty-dots" aria-hidden="true"><i></i><i></i><i></i></span>`);
    setText(view['level-subtitle'], level.subtitle);
    setText(view['move-count'], String(snap.moves).padStart(2, '0'));
    setText(view['push-count'], String(snap.pushes).padStart(2, '0'));
    setText(view['goal-count'], `${snap.goalsFilled} of ${snap.goalCount} in place`);
    setHTML(view['goal-checks'], Array.from({ length: snap.goalCount }, (_, i) => `<i class="${i < snap.goalsFilled ? 'filled' : ''}"></i>`).join(''));
    setDisabled(view['undo-button'], snap.historyDepth === 0);
    setDisabled(view['hint-button'], snap.state !== 'RUNNING' || hintBusy);
    if (view['hint-button']) view['hint-button'].setAttribute('aria-busy', String(hintBusy));
    const showingToast = Boolean(toastText) && elapsed < toastUntil;
    setHidden(view['hint-toast'], !showingToast);
    if (showingToast) setText(view['hint-toast'], toastText);
    for (const wrap of helpWraps) setHidden(wrap, !helpOpen);
    const terminal = snap.state !== 'RUNNING';
    const showOutcome = terminal && !helpOpen;
    setHidden(view['result-wrap'], !showOutcome);
    setHidden(big.overlay, !showOutcome);
    setHidden(touch, terminal || helpOpen);
    if (!terminal) { lastPresentedOutcome = ''; return; }
    const outcome = `${snap.roundId}:${snap.state}`;
    if (lastPresentedOutcome === outcome) return;
    lastPresentedOutcome = outcome;
    fillResult({
      icon: view['result-icon'], eyebrow: view['result-eyebrow'], title: view['result-title'],
      copy: view['result-copy'], stats: view['result-stats'], secondary: view['result-secondary'],
      primary: view['result-primary'],
    }, snap);
    fillResult(big, snap);
  }
  function commit(action, { queued = false } = {}) {
    if (helpOpen) return { accepted: false };
    if (!queued) { queue = []; walkWait = 0; }
    clearHint();
    const before = read();
    const result = game.handleInput(action);
    const snap = read();
    if (snap.roundId !== before.roundId) {
      hintCache = null;
      garden.build(game.board, snap);
    }
    if (result.accepted) {
      if (snap.state !== 'RUNNING') queue = [];
    } else if (snap.state === 'RUNNING' && action.type === 'move') {
      toast(result.reason === 'blocked-crate'
        ? 'One crate at a time. Find another way around.'
        : 'A garden wall. Try another direction.', 1.7);
    }
    return result;
  }
  function applyUndo() {
    // Pointer path: host freezes update() after LOST, so overlay undo must
    // restore RUNNING here rather than waiting for a sim step.
    const result = game.handleInput({ type: 'undo' });
    if (result.accepted) {
      queue = [];
      walkWait = 0;
      clearHint();
      lastPresentedOutcome = '';
      garden.sync(read(), 1, true);
    }
    return result;
  }
  function displayHint(path) {
    const direction = path[0];
    if (!direction) return;
    const [dx, dy] = DIRECTIONS[direction];
    const snap = read();
    garden.showHint({ x: snap.player.x + dx, y: snap.player.y + dy });
    toast(`Try one step ${prettyKey[direction]} ${direction}. Follow the golden ring.`, 6.5);
    hintCache = { fingerprint: fingerprint(snap), path };
  }
  function requestHint() {
    const snap = read();
    if (snap.state !== 'RUNNING' || helpOpen || hintBusy) return;
    queue = [];
    walkWait = 0;
    if (hintCache?.fingerprint === fingerprint(snap)) { displayHint(hintCache.path); return; }
    clearHint();
    hintBusy = true;
    hintElapsed = 0;
    toast('Finding a thoughtful next move…', 0);
    const token = hintToken;
    try {
      hintWorker = new Worker(new URL('./hint-worker.mjs', import.meta.url), { type: 'module' });
      hintWorker.onmessage = ({ data }) => {
        if (data.token !== hintToken) return;
        hintWorker?.terminate();
        hintWorker = null;
        hintBusy = false;
        hintElapsed = 0;
        if (data.path) displayHint(data.path);
        else toast(data.exhausted
          ? 'These crates have blocked each other. Undo a few moves or start fresh.'
          : LEVELS[snap.levelIndex].hint, 6.5);
      };
      hintWorker.onerror = event => {
        event.preventDefault();
        clearHint();
        toast(LEVELS[read().levelIndex].hint, 6.5);
      };
      hintWorker.postMessage({ token, levelIndex: snap.levelIndex, player: snap.player, crates: snap.crates });
    } catch {
      clearHint();
      toast(LEVELS[snap.levelIndex].hint, 6.5);
    }
  }
  function failHint() {
    if (!hintBusy) return;
    clearHint();
    toast(LEVELS[read().levelIndex].hint, 6.5);
  }

  document.querySelector('#hud .brand')?.addEventListener('click', event => {
    event.preventDefault();
    host.restart();
  }, options);
  view['undo-button']?.addEventListener('click', () => { view['undo-button'].blur(); applyUndo(); }, options);
  view['reset-button']?.addEventListener('click', () => { view['reset-button'].blur(); host.restart(); }, options);
  view['hint-button']?.addEventListener('click', () => { view['hint-button'].blur(); requestHint(); }, options);
  for (const button of [view['result-secondary'], big.secondary]) {
    button?.addEventListener('click', () => { button.blur(); host.restart(); }, options);
  }
  for (const button of [view['result-primary'], big.primary]) {
    button?.addEventListener('click', () => {
      button.blur();
      if (read().state === 'LOST') applyUndo();
      else host.restart();
    }, options);
  }
  const openHelp = () => {
    queue = [];
    walkWait = 0;
    clearHint();
    clearInput();
    helpOpen = true;
  };
  const closeHelp = () => { helpOpen = false; clearInput(); };
  view['help-button']?.addEventListener('click', () => { view['help-button'].blur(); openHelp(); }, options);
  for (const id of ['close-help', 'start-playing', 'big-close-help', 'big-start-playing']) {
    const button = document.getElementById(id);
    button?.addEventListener('click', () => { button.blur(); closeHelp(); }, options);
  }
  for (const button of touch?.querySelectorAll('[data-action]') ?? []) {
    button.addEventListener('click', () => {
      button.blur();
      const action = button.dataset.action;
      if (action === 'undo') applyUndo();
      else if (action === 'hint') requestHint();
      else if (read().state === 'RUNNING' && !helpOpen) pad.pressed.add(action);
    }, options);
  }
  garden.renderer.domElement.addEventListener('click', event => {
    if (read().state !== 'RUNNING' || helpOpen) return;
    const cell = garden.pick(event.clientX, event.clientY);
    if (!cell) return;
    const path = game.pathTo(cell);
    clearHint();
    if (path) { queue = [...path]; walkWait = 0; }
    else toast('Click a reachable empty tile. Use the arrow keys to push a crate.', 3.5);
  }, options);
  window.addEventListener('blur', () => { queue = []; walkWait = 0; clearHint(); clearInput(); }, options);
  document.addEventListener('visibilitychange', () => { queue = []; walkWait = 0; clearHint(); clearInput(); }, options);

  function describeEvent(event) {
    switch (event.type) {
      case 'keeper.moved':
        return event.pushed
          ? `The garden keeper steps ${event.direction} and pushes a crate.`
          : `The garden keeper steps ${event.direction} across the courtyard.`;
      case 'crate.pushed':
        return event.docked
          ? 'A wooden crate slides onto a marked destination tile.'
          : 'A wooden crate slides one tile across the courtyard.';
      case 'move.undone':
        return 'The last courtyard move is taken back.';
      case 'round.won':
        return 'Both crates rest on their marked tiles and the courtyard is in order.';
      case 'round.lost':
        return 'A crate sits on a square from which no marked tile can be reached.';
      default:
        return null;
    }
  }

  garden.sync(read(), 1, true);
  return {
    canvas: garden.renderer.domElement,
    update(dt, input) {
      elapsed += dt;
      if (hintBusy) {
        hintElapsed += dt;
        if (hintElapsed > 20) failHint();
      }
      const directions = ['up', 'right', 'down', 'left'];
      const keyMove = directions.find(action => input.consumePress(action));
      const padMove = directions.find(action => pad.pressed.delete(action));
      const undoPress = input.consumePress('undo');
      const hintPress = input.consumePress('hint');
      if (helpOpen) {
        pad.pressed.clear();
        return;
      }
      if (undoPress) applyUndo();
      else if (hintPress) requestHint();
      else if (keyMove || padMove) commit({ type: 'move', direction: keyMove || padMove });
      if (queue.length && read().state === 'RUNNING') {
        walkWait -= dt;
        if (walkWait <= 0) {
          commit({ type: 'move', direction: queue.shift() }, { queued: true });
          walkWait = STEP;
        }
      }
      if (read().state !== 'RUNNING') { queue = []; clearInput(); }
    },
    layout(width, height) { garden.fit(width, height); },
    read,
    handleUiAction(action) {
      if (action === 'undo') { applyUndo(); return true; }
      if (action === 'hint') { requestHint(); return true; }
      if (action === 'reset' || action === 'restart') { host.restart(); return true; }
      if (action === 'help.open') { openHelp(); return true; }
      if (action === 'help.close') { closeHelp(); return true; }
      if (action === 'result.primary') {
        if (read().state === 'LOST') applyUndo();
        else host.restart();
        return true;
      }
      if (action === 'result.secondary') { host.restart(); return true; }
      return false;
    },
    describeEvent,
    // dt is the sim time since the last captured model frame (tick delta / 60).
    // Game2V always passes it; there is no fixed 24 fps visual rate.
    render(dt) {
      // Host freezes update() after WON/LOST; Z-undo still has to restore RUNNING
      // from a live input latch because overlay clicks are the only other path.
      if (read().state !== 'RUNNING' && !helpOpen && host.input.consumePress('undo')) {
        applyUndo();
      }
      garden.sync(read(), Number.isFinite(dt) ? dt : 0, reducedMotion);
      present();
      garden.render();
    },
    reset() {
      clearInput();
      queue = [];
      walkWait = 0;
      elapsed = 0;
      lastPresentedOutcome = '';
      hintCache = null;
      clearHint();
      helpOpen = false;
      game.handleInput({ type: 'reset' });
      const snap = read();
      garden.build(game.board, snap);
      garden.sync(snap, 1, true);
    },
    automation: () => {
      const snap = read();
      return {
        helpOpen,
        hintBusy,
        queueLength: queue.length,
        player: snap.player,
        crates: snap.crates,
        visual: {
          camera: garden.camera.position.toArray(),
          drawCalls: garden.renderer.info.render.calls,
        },
      };
    },
    destroy() {
      listeners.abort();
      clearInput();
      clearHint();
      garden.dispose();
      garden.renderer.domElement.remove();
    },
  };
}
