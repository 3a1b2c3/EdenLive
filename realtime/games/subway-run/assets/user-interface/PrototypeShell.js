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

export function createRenderer(container) {
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);
  return renderer;
}

export function installResize(renderer, camera, container) {
  function resize() {
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
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
    this.pressHandlers = new Map();
    this.releaseHandlers = new Map();
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
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

  /** -1 / 0 / +1 from a pair of actions, for an axis. */
  axis(negativeAction, positiveAction) {
    return (this.isDown(positiveAction) ? 1 : 0) - (this.isDown(negativeAction) ? 1 : 0);
  }

  _onKeyDown(event) {
    const action = this.map[event.code];
    if (!action) return;
    // Arrows and space scroll the page otherwise.
    event.preventDefault();
    if (this.down.has(action)) return; // key repeat is not a new press
    this.down.add(action);
    for (const handler of this.pressHandlers.get(action) ?? []) handler();
  }

  _onKeyUp(event) {
    const action = this.map[event.code];
    if (!action) return;
    event.preventDefault();
    this.down.delete(action);
    for (const handler of this.releaseHandlers.get(action) ?? []) handler();
  }

  attach(target = window) {
    target.addEventListener('keydown', this._onKeyDown);
    target.addEventListener('keyup', this._onKeyUp);
    return this;
  }
}

/**
 * Mouse-look delta bridge. `MouseLookCharacterMotionController` (and the other
 * mouse-look character schemes) wants PIXEL deltas in `planMovement({ mouseDeltaX,
 * mouseDeltaY })`, but `PointerState` reports NDC only. Every mouse-look prototype
 * otherwise hand-rolls the same listener and gets the vertical sign wrong at least
 * once. Accumulate per-frame pointer deltas and hand them back one-shot:
 *
 *     const look = new MouseLookDelta(renderer.domElement);
 *     // per frame:
 *     const d = look.consume();
 *     const intent = controller.planMovement({ mouseDeltaX: d.x, mouseDeltaY: d.y, ... });
 *
 * X is screen-right positive and passes straight through. Y is NEGATED because
 * pointer movement is screen-down positive (+Y down) while the controller reads +Y
 * as screen-up. The first-move guard drops a synthetic jump (pointer-lock enter, or
 * the checker's `page.mouse.move`) so it does not read as a teleport-sized turn.
 */
export class MouseLookDelta {
  constructor(element) {
    this.x = 0;
    this.y = 0;
    this._last = null;
    element.addEventListener('mousemove', (event) => {
      if (this._last) {
        this.x += event.movementX ?? (event.clientX - this._last.x);
        this.y -= event.movementY ?? (event.clientY - this._last.y);
      }
      this._last = { x: event.clientX, y: event.clientY };
    });
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
