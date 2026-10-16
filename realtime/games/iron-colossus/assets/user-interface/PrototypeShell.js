// SPDX-FileCopyrightText: Copyright (c) 2026 Vast AI
// SPDX-License-Identifier: Apache-2.0
// The DOM-facing half of a prototype shell: renderer, resize, keyboard, pointer
// and a HUD writer.
//
// This lives in user-interface/ because it touches `window` and `document`, which
// the rest of the library deliberately does not. The art-free scene builders are
// the other half, in world/object/factory/GreyboxKitFactory.js.
//
// KeyState is the load-bearing piece. Prototype input divides into two kinds that
// are easy to conflate and produce opposite bugs when confused:
//
//   held   -- movement. Read with isDown()/axis() every frame; a key held down
//             must keep moving the actor.
//   edge   -- a jump, a lane change, a turn, a menu commit. Fired once per press
//             with onPress(); a held key must NOT repeat it.
//
// Browser key repeat delivers keydown over and over while a key is held, so an
// edge action wired to raw keydown fires dozens of times. KeyState suppresses the
// repeat and keeps the two readings separate.

import { WebGLRenderer } from 'three';

export function createRenderer(container, { antialias = true, pixelRatio = Math.min(window.devicePixelRatio, 2), shadows = true } = {}) {
  const renderer = new WebGLRenderer({ antialias });
  renderer.setPixelRatio(pixelRatio);
  renderer.shadowMap.enabled = shadows;
  container.appendChild(renderer.domElement);
  return renderer;
}

// CSS owns the canvas display size (template: `#app canvas { width:100%; height:100% }`).
// setSize(..., false) updates the drawing buffer only, so a pixelRatio > 1 cannot
// inflate the CSS box and crop the view. Observe the container as well as the
// window: `#app` can change size without a window resize.
export function installResize(renderer, camera, container) {
  function resize() {
    const width = Math.max(1, container.clientWidth || window.innerWidth);
    const height = Math.max(1, container.clientHeight || window.innerHeight);
    renderer.setSize(width, height, false);
    if (camera.isPerspectiveCamera) {
      camera.aspect = width / height;
    } else {
      // Orthographic: keep the vertical extent and widen horizontally.
      const halfHeight = (camera.top - camera.bottom) * 0.5;
      const halfWidth = halfHeight * (width / height);
      camera.left = -halfWidth;
      camera.right = halfWidth;
    }
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize.observer = observer;
  }
  return resize;
}

/**
 * Keyboard state with edge detection.
 *
 * Stage 1 lives and dies on this distinction: a lane change or a jump must fire
 * once per press, while movement must read the held state. Mapping codes to
 * action names keeps the game code free of `event.code` noise.
 */
export class KeyState {
  constructor(map = {}) {
    this.map = map;
    this.down = new Set();
    this.codes = new Set();
    this.pressed = new Map();
    this.pressHandlers = new Map();
    this.releaseHandlers = new Map();
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._clear = () => this.clear();
    this._visibility = () => { if (document.hidden) this.clear(); };
  }

  onPress(action, handler) {
    const list = this.pressHandlers.get(action) ?? [];
    list.push(handler);
    this.pressHandlers.set(action, list);
    return this;
  }

  onRelease(action, handler) {
    const list = this.releaseHandlers.get(action) ?? [];
    list.push(handler);
    this.releaseHandlers.set(action, list);
    return this;
  }

  isDown(action) {
    return this.down.has(action);
  }

  /** Consume one queued press, even when down/up both occurred between frames.
   * Choose this OR onPress() as the owner of an action, not both.
   */
  consumePress(action) {
    const count = this.pressed.get(action) ?? 0;
    if (!count) return false;
    this.pressed.set(action, count - 1);
    return true;
  }

  clear() {
    this.down.clear();
    this.codes.clear();
    this.pressed.clear();
  }

  /** -1 / 0 / +1 from a pair of actions, for an axis. */
  axis(negativeAction, positiveAction) {
    return (this.isDown(positiveAction) ? 1 : 0) - (this.isDown(negativeAction) ? 1 : 0);
  }

  _onKeyDown(event) {
    const action = this.map[event.code];
    if (!action) return;
    // Arrows and space scroll the page otherwise.
    event.preventDefault();
    if (event.repeat || this.codes.has(event.code)) return;
    this.codes.add(event.code);
    if (this.down.has(action)) return;
    this.down.add(action);
    this.pressed.set(action, (this.pressed.get(action) ?? 0) + 1);
    for (const handler of this.pressHandlers.get(action) ?? []) handler();
  }

  _onKeyUp(event) {
    const action = this.map[event.code];
    if (!action) return;
    event.preventDefault();
    this.codes.delete(event.code);
    if ([...this.codes].some(code => this.map[code] === action)) return;
    const wasDown = this.down.delete(action);
    if (!wasDown) return;
    for (const handler of this.releaseHandlers.get(action) ?? []) handler();
  }

  attach(target = window) {
    this.detach();
    this.target = target;
    target.addEventListener('keydown', this._onKeyDown);
    target.addEventListener('keyup', this._onKeyUp);
    target.addEventListener('blur', this._clear);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this._visibility);
    return this;
  }

  detach() {
    this.target?.removeEventListener('keydown', this._onKeyDown);
    this.target?.removeEventListener('keyup', this._onKeyUp);
    this.target?.removeEventListener('blur', this._clear);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this._visibility);
    this.target = null;
    this.clear();
  }
}

/**
 * Mouse-look delta bridge. `MouseLookCharacterMotionController` (and the other
 * mouse-look character schemes) wants PIXEL deltas in `planMovement({ mouseDeltaX,
 * mouseDeltaY })`, but `PointerState` reports NDC only. Every mouse-look prototype
 * otherwise hand-rolls the same listener and gets the vertical sign wrong at least
 * once. Mouse-look uses Pointer Lock by default: the system cursor is hidden after
 * the first click on the element and movement is read as relative `movementX/Y`,
 * so a centered crosshair is the only visible focus. Accumulate per-frame pointer
 * deltas and hand them back one-shot:
 *
 *     const look = new MouseLookDelta(renderer.domElement);
 *     // per frame:
 *     const d = look.consume();
 *     const intent = controller.planMovement({ mouseDeltaX: d.x, mouseDeltaY: d.y, ... });
 *
 * X is screen-right positive and passes straight through. Y is NEGATED because
 * pointer movement is screen-down positive (+Y down) while the controller reads +Y
 * as screen-up. Only locked movement is accepted by default. Lock transitions
 * clear pending deltas; the first relative movement after capture is preserved.
 * Use onLockChange(false) to clear held gameplay actions on release. Explicit
 * pointerLock:false retains free-cursor deltas, with a first-event baseline.
 */
export class MouseLookDelta {
  constructor(element, { pointerLock = true, hideCursor = true, onLockChange = null } = {}) {
    this.element = element;
    this.pointerLock = pointerLock;
    this.hideCursor = hideCursor;
    this.onLockChange = onLockChange;
    this._document = element.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
    this.x = 0;
    this.y = 0;
    this._last = null;
    this._locked = false;
    this._requestPending = false;
    this._previousCursor = null;
    this._onMove = this._onMove.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);
    this._onPointerLockError = this._onPointerLockError.bind(this);
    if (pointerLock && this._document) {
      // Locked events bubble to the document; listening once avoids double deltas.
      this._document.addEventListener('mousemove', this._onMove);
      element.addEventListener('pointerdown', this._onPointerDown);
      this._document.addEventListener('pointerlockchange', this._onPointerLockChange);
      this._document.addEventListener('pointerlockerror', this._onPointerLockError);
    } else if (!pointerLock) {
      element.addEventListener('mousemove', this._onMove);
    }
  }

  _onMove(event) {
    if (this.pointerLock) {
      if (this._document?.pointerLockElement !== this.element) return;
      // Pointer Lock reports relative pixels. There is no client position to
      // compare, and movement while locked must never depend on the viewport.
      this.x += Number.isFinite(event.movementX) ? event.movementX : 0;
      this.y -= Number.isFinite(event.movementY) ? event.movementY : 0;
      this._last = null;
      return;
    }
    // Free-cursor input is an explicit opt-out, never a silent capture fallback.
    // The first event establishes a baseline.
    if (this._last) {
      this.x += event.movementX ?? (event.clientX - this._last.x);
      this.y -= event.movementY ?? (event.clientY - this._last.y);
    }
    this._last = { x: event.clientX, y: event.clientY };
  }

  _onPointerDown() {
    if (!this.pointerLock || this._requestPending || this._document?.pointerLockElement === this.element) return;
    // The call stays inside the browser's pointer gesture. Some engines return
    // a promise while others return undefined; both forms are supported.
    try {
      this._requestPending = true;
      const result = this.element.requestPointerLock();
      result?.catch?.(this._onPointerLockError);
    } catch {
      // Run after other pointerdown handlers have latched the initiating click.
      queueMicrotask(this._onPointerLockError);
    }
  }

  _onPointerLockChange() {
    this._setLockState(this._document.pointerLockElement === this.element);
  }

  _setLockState(locked, notify = false) {
    this._requestPending = false;
    if (locked === this._locked && !notify) return;
    this._locked = locked;
    this._last = null;
    this.x = 0;
    this.y = 0;
    if (this.hideCursor && this.element.style) {
      if (locked && this._previousCursor === null) {
        this._previousCursor = this.element.style.cursor;
        this.element.style.cursor = 'none';
      } else if (!locked && this._previousCursor !== null) {
        this.element.style.cursor = this._previousCursor;
        this._previousCursor = null;
      }
    }
    this.onLockChange?.(locked);
  }

  _onPointerLockError() {
    if (!this._requestPending) return;
    // Notify a failed request too, so the initiating click cannot leave fire held.
    this._setLockState(this._document.pointerLockElement === this.element, true);
  }

  /** Return and clear the deltas accumulated since the last call. */
  consume() {
    const out = { x: this.x, y: this.y };
    this.x = 0;
    this.y = 0;
    return out;
  }
}

/** Pointer position in NDC plus click edges, for cursor-modality prototypes. */
export class PointerState {
  constructor(element) {
    this.element = element;
    this.ndc = { x: 0, y: 0 };
    this.inside = false;
    this.clickHandlers = [];
    this.rightClickHandlers = [];
    this.moveHandlers = [];

    element.addEventListener('pointermove', (event) => {
      const rect = element.getBoundingClientRect();
      this.ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.inside = true;
      for (const handler of this.moveHandlers) handler(this.ndc);
    });
    element.addEventListener('pointerleave', () => { this.inside = false; });
    element.addEventListener('pointerdown', (event) => {
      if (event.button === 2) {
        for (const handler of this.rightClickHandlers) handler(this.ndc);
      } else {
        for (const handler of this.clickHandlers) handler(this.ndc);
      }
    });
    element.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  onClick(handler) { this.clickHandlers.push(handler); return this; }
  onRightClick(handler) { this.rightClickHandlers.push(handler); return this; }

  /**
   * Fires on every pointermove. Needed to distinguish "the pointer is inside the
   * canvas" from "the pointer just moved": a frame loop that re-previews on the
   * former cannot honour a cancel, because the next frame rebuilds what was
   * cancelled. Subscribe here to re-preview on actual movement instead.
   */
  onMove(handler) { this.moveHandlers.push(handler); return this; }
}

/**
 * HUD writer. Takes [label, value] rows so every prototype's readout looks the
 * same and the reviewer can compare runs without re-reading the layout.
 */
export function makeHudWriter(element, { width = 15 } = {}) {
  return function write(rows) {
    element.textContent = rows
      .map(([label, value]) => `${String(label).padEnd(width)} ${value}`)
      .join('\n');
  };
}

/**
 * A text meter for a 0..1 fraction: `[#######.........]`.
 *
 * Every stage-2 prototype wrote this, character for character, because every
 * counter that can end a round wants a bar next to its number -- a bare "63/100"
 * does not show how close the player is to losing at a glance.
 *
 * Takes the fraction a `ResourcePool` or `RoundClock` snapshot already exposes.
 * A null or out-of-range fraction is clamped rather than throwing: a HUD is the
 * wrong place to fail loud, since crashing the readout hides the state it was
 * meant to show.
 */
export function meterBar(fraction, { cells = 16, filledChar = '#', emptyChar = '.' } = {}) {
  const safe = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const filled = Math.round(safe * cells);
  return `[${filledChar.repeat(filled)}${emptyChar.repeat(cells - filled)}]`;
}

/**
 * The round-status rows every stage-2 HUD opens with, in one call.
 *
 * The convention these encode is worth more than the code: **the rows that can
 * end the round come first**. A hidden health pool is a surprise death, and a
 * clock the player cannot see is an unfair loss. Stage 2's gate also asks for the
 * outcome REASON on screen, so a reviewer never has to guess why a round ended.
 *
 * Pass a `RoundDirector` snapshot plus the banner latched from its terminal
 * event. Returns `[label, value]` rows for `makeHudWriter`, so a caller appends
 * its own game-specific rows after these:
 *
 *   writeHud([
 *     ...roundStatusRows({ snapshot, banner: outcomeBanner, label: 'ROUND' }),
 *     ['crosshair on', aimedTarget ?? '-'],
 *   ]);
 *
 * Only rows that exist are emitted: a round with no clock gets no clock row
 * rather than a row reading "null".
 */
export function roundStatusRows({
  snapshot,
  banner = null,
  label = 'ROUND',
  showReason = true,
  poolLabels = {},
  cells = 16,
} = {}) {
  if (!snapshot) {
    throw new Error('roundStatusRows: a RoundDirector snapshot is required');
  }

  const rows = [[label, banner ?? snapshot.state]];

  // The reason is what turns "YOU LOSE" into something actionable.
  if (showReason && snapshot.outcomeReason && !banner) {
    rows.push(['because', snapshot.outcomeReason]);
  }

  for (const pool of snapshot.resources ?? []) {
    const name = poolLabels[pool.id] ?? pool.id;
    const amount = pool.max === null ? `${pool.value}` : `${pool.value}/${pool.max}`;
    rows.push([
      name,
      pool.fraction === null ? amount : `${meterBar(pool.fraction, { cells })} ${amount}`,
    ]);
  }

  if (snapshot.clock) {
    const clock = snapshot.clock;
    rows.push([
      'time',
      `${meterBar(clock.fraction, { cells })} ${clock.displaySeconds.toFixed(0)}s`
      + ` / ${clock.limitSeconds}s`,
    ]);
  }

  const objective = snapshot.objective;
  if (objective) {
    const progress = objective.target > 1
      ? `${objective.progress}/${objective.target}`
      : (objective.primaryMet ? 'met' : 'open');
    rows.push([
      objective.label ?? 'objective',
      `${meterBar(objective.fraction, { cells })} ${progress}`,
    ]);
    // The follow-up clause is the row players miss without a prompt: the exit is
    // live and nothing on screen said so.
    if (objective.then) {
      rows.push([
        objective.then.label ?? 'then',
        objective.awaitingSecondClause
          ? 'OPEN'
          : (objective.completed ? 'done' : 'locked'),
      ]);
    }
  }

  return rows;
}
