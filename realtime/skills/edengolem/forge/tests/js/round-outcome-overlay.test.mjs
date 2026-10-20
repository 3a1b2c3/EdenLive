// Headless tests for assets/user-interface/RoundOutcomeOverlay.js.
//
// The load-bearing property is scaleDelta: the overlay is what STOPS a resolved
// round, and a verdict shown over a still-running simulation is the bug this module
// exists to remove. The DOM surface used is tiny (createElement, append, style,
// textContent, dataset, addEventListener), so it is stubbed here rather than pulling
// in jsdom for it -- a new pinned dependency for six methods is a poor trade.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RoundOutcomeOverlay,
  showOnTerminalEvent,
} from '../../../assets/user-interface/RoundOutcomeOverlay.js';

/** The smallest element that satisfies the module. */
function makeElement(tag = 'div') {
  return {
    tagName: tag.toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    textContent: '',
    attributes: {},
    listeners: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
      if (name === 'style') this.style.cssText = value;
    },
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); return node; },
    remove() { this.removed = true; },
    addEventListener(type, handler) {
      this.listeners[type] = this.listeners[type] ?? [];
      this.listeners[type].push(handler);
    },
    emit(type, event = {}) {
      for (const handler of this.listeners[type] ?? []) {
        handler({ stopPropagation() {}, ...event });
      }
    },
  };
}

function makeDocument({ pointerLocked = false } = {}) {
  const state = { pointerLocked };
  const doc = {
    listeners: {},
    createElement: (tag) => makeElement(tag),
    get pointerLockElement() {
      return state.pointerLocked ? makeElement() : null;
    },
    set pointerLockElement(value) {
      state.pointerLocked = Boolean(value);
    },
    exitPointerLockCalls: 0,
    exitPointerLock() { this.exitPointerLockCalls += 1; state.pointerLocked = false; },
    addEventListener(type, handler) {
      this.listeners[type] = this.listeners[type] ?? [];
      this.listeners[type].push(handler);
    },
    removeEventListener(type, handler) {
      this.listeners[type] = (this.listeners[type] ?? []).filter((h) => h !== handler);
    },
    emit(type, event = {}) {
      for (const handler of this.listeners[type] ?? []) {
        handler({ preventDefault() {}, ...event });
      }
    },
  };
  return doc;
}

function makeOverlay(options = {}) {
  const container = makeElement();
  const documentRef = options.documentRef ?? makeDocument();
  const overlay = new RoundOutcomeOverlay({ container, documentRef, ...options });
  return { overlay, container, documentRef };
}

test('scaleDelta freezes the simulation once a verdict is up', () => {
  const { overlay } = makeOverlay();

  // Running: the delta passes through untouched.
  assert.equal(overlay.scaleDelta(1 / 60), 1 / 60);
  assert.equal(overlay.isShown, false);

  overlay.show({ won: false, reason: 'hazard' });
  assert.equal(overlay.isShown, true);
  assert.equal(overlay.scaleDelta(1 / 60), 0, 'a resolved round must not advance');
  assert.equal(overlay.scaleDelta(10), 0, 'not even a huge catch-up delta');

  // Restarting releases it, so replay works without rebuilding the loop.
  overlay.hide();
  assert.equal(overlay.scaleDelta(1 / 60), 1 / 60);
});

test('scaleDelta treats a non-finite delta as zero rather than propagating NaN', () => {
  // A NaN delta poisons every downstream position in one frame and is invisible
  // until the scene silently vanishes.
  const { overlay } = makeOverlay();
  assert.equal(overlay.scaleDelta(Number.NaN), 0);
  assert.equal(overlay.scaleDelta(undefined), 0);
});

test('the verdict states outcome, reason and how to replay', () => {
  const { overlay } = makeOverlay({ restartKey: 'R' });

  overlay.show({ won: true, reason: 'objectiveComplete' });
  assert.equal(overlay.verdictEl.textContent, 'YOU WIN');
  assert.equal(overlay.reasonEl.textContent, 'reason: objectiveComplete');
  assert.match(overlay.hintEl.textContent, /press R or click to play again/);
  assert.equal(overlay.root.style.display, 'flex');

  overlay.show({ won: false, reason: 'timerExpired', detail: 'ran out at 90s' });
  assert.equal(overlay.verdictEl.textContent, 'YOU LOSE');
  assert.equal(overlay.reasonEl.textContent, 'reason: timerExpired');
  assert.equal(overlay.detailEl.textContent, 'ran out at 90s');

  overlay.hide();
  assert.equal(overlay.root.style.display, 'none');
});

test('a missing reason leaves the row empty rather than printing null', () => {
  const { overlay } = makeOverlay();
  overlay.show({ won: true });
  assert.equal(overlay.reasonEl.textContent, '');
  assert.equal(overlay.detailEl.textContent, '');
});

test('showing releases a captured pointer so the panel can be clicked', () => {
  const documentRef = makeDocument({ pointerLocked: true });
  const { overlay } = makeOverlay({ documentRef });

  overlay.show({ won: false, reason: 'hazard' });
  assert.equal(documentRef.exitPointerLockCalls, 1);
});

test('clicking the overlay restarts', () => {
  let restarts = 0;
  const { overlay } = makeOverlay({ onRestart: () => { restarts += 1; } });

  overlay.show({ won: false, reason: 'hazard' });
  overlay.root.emit('pointerdown');
  assert.equal(restarts, 1);
});

test('pressing the restart key restarts while shown, and only then', () => {
  let restarts = 0;
  const documentRef = makeDocument();
  const { overlay } = makeOverlay({
    documentRef,
    restartKey: 'R',
    onRestart: () => { restarts += 1; },
  });

  overlay.show({ won: false, reason: 'hazard' });
  documentRef.emit('keydown', { key: 'R' });
  assert.equal(restarts, 1, 'the key is wired, not just hinted at');

  overlay.hide();
  documentRef.emit('keydown', { key: 'R' });
  assert.equal(restarts, 1, 'the key stays free for the game while the round runs');
});

test('onRestart is called lazily, so it may close over a later declaration', () => {
  // The normal shape: restartRound is declared below the overlay in every prototype.
  let restartRound = null;
  const { overlay } = makeOverlay({ onRestart: () => restartRound() });
  let called = false;
  restartRound = () => { called = true; };

  overlay.root.emit('pointerdown');
  assert.equal(called, true);
});

test('showOnTerminalEvent shows on exactly the two terminal events', () => {
  const { overlay } = makeOverlay();

  assert.equal(showOnTerminalEvent(overlay, { type: 'round.started' }), false);
  assert.equal(overlay.isShown, false, 'a non-terminal event must not stop the round');
  assert.equal(showOnTerminalEvent(overlay, { type: 'round.partialReset' }), false);
  assert.equal(overlay.isShown, false, 'a partial reset is not the end of the round');

  assert.equal(
    showOnTerminalEvent(overlay, { type: 'round.lost', reason: 'resourceDepleted' }),
    true
  );
  assert.equal(overlay.isShown, true);
  assert.equal(overlay.reasonEl.textContent, 'reason: resourceDepleted');

  overlay.hide();
  assert.equal(showOnTerminalEvent(overlay, { type: 'round.won', reason: 'survived' }), true);
  assert.equal(overlay.verdictEl.textContent, 'YOU WIN');
});

test('showOnTerminalEvent tolerates a malformed event', () => {
  const { overlay } = makeOverlay();
  assert.equal(showOnTerminalEvent(overlay, null), false);
  assert.equal(showOnTerminalEvent(overlay, {}), false);
  assert.equal(overlay.isShown, false);
});

test('construction fails loud without a container or a document', () => {
  assert.throws(
    () => new RoundOutcomeOverlay({ documentRef: makeDocument() }),
    /container element is required/
  );
  assert.throws(
    () => new RoundOutcomeOverlay({ container: makeElement(), documentRef: null }),
    /no document available/
  );
  assert.throws(
    () => new RoundOutcomeOverlay({
      container: makeElement(),
      documentRef: makeDocument(),
      onRestart: 'nope',
    }),
    /onRestart must be a function or null/
  );
});

test('the overlay attaches to its container and can be disposed', () => {
  const { overlay, container } = makeOverlay();
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0], overlay.root);
  assert.equal(overlay.root.dataset.roundOutcome, 'overlay');

  overlay.dispose();
  assert.equal(overlay.root.removed, true);
});
