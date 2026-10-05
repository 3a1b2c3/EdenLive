/**
 * The screen a round shows once it is over: the verdict, the reason, and the stop.
 *
 * ## Why this is a module
 *
 * Every prototype that reaches stage 2 latches a text banner into its HUD when the
 * director resolves, and then keeps simulating underneath it. The clock row freezes
 * but enemies keep walking, the ball keeps rolling, and the player can still drive
 * around after "YOU LOSE". A round that does not visibly STOP reads as a bug even
 * when the rules resolved perfectly -- and the moment a round ends is the moment the
 * player most needs unambiguous feedback.
 *
 * Two things were missing together, so they belong together:
 *
 *   1. a verdict the player cannot miss -- won/lost, why, and how to replay
 *   2. a HARD STOP of the simulation
 *
 * ## Freeze the delta, do not cancel the loop
 *
 * `scaleDelta()` returns 0 while the verdict is up. Wrap the frame's delta in it:
 *
 *     const delta = overlay.scaleDelta(Math.min(clock.getDelta(), MAX_DELTA));
 *
 * Every per-frame quantity in a prototype is a function of delta, so zeroing that
 * one value stops all of them without touching a single game rule. Cancelling
 * `requestAnimationFrame` instead is worse in three specific ways: the canvas stops
 * compositing so the overlay cannot be drawn over the final frame, the final frame
 * (where the player died, where the ball ended up) is exactly the evidence they want
 * to look at, and a cancelled loop needs restarting on replay -- another thing to
 * get wrong.
 *
 * Keep `clock.getDelta()` INSIDE the wrap. It must still be consumed every frame, or
 * the accumulated time is delivered in one huge delta on the first frame after a
 * restart, which teleports everything.
 *
 * The one precondition: nothing may DIVIDE by delta. Dividing by a frozen delta is a
 * division by zero, and the usual reason to do it -- deriving a velocity from a
 * corrected position -- should read the velocity that already exists instead.
 *
 * ## Usage
 *
 *     const overlay = new RoundOutcomeOverlay({
 *       container,
 *       restartKey: 'R',
 *       onRestart: () => restartRound(),
 *     });
 *
 *     // On the director's single terminal event:
 *     overlay.show({ won: event.type === 'round.won', reason: event.reason });
 *     // In restartRound():
 *     overlay.hide();
 *
 * `onRestart` is invoked lazily, so passing a closure over a `restartRound` declared
 * further down the file is fine and is the normal case.
 *
 * `documentRef` may be injected for headless tests, matching DomHudRenderer.
 */

const WON_COLOR = '#9ae6b4';
const LOST_COLOR = '#ffb4b4';

const ROOT_STYLE = [
  'position: absolute',
  'inset: 0',
  'display: none',
  'align-items: center',
  'justify-content: center',
  // A wash rather than an opaque fill: the final frame underneath is evidence.
  'background: rgba(8, 11, 16, 0.62)',
  'backdrop-filter: blur(2px)',
  'z-index: 10',
  'cursor: pointer',
  'font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace',
].join(';');

const PANEL_STYLE = [
  'min-width: 300px',
  'max-width: 78vw',
  'padding: 22px 26px',
  'text-align: center',
  'background: #141a24',
  'border: 1px solid #2b3648',
  'border-radius: 10px',
  'box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55)',
].join(';');

function resolveDocument(documentRef = null) {
  return documentRef ?? (typeof document !== 'undefined' ? document : null);
}

export class RoundOutcomeOverlay {
  constructor({
    container,
    restartKey = 'R',
    onRestart = null,
    documentRef = null,
    label = 'RoundOutcomeOverlay',
  } = {}) {
    if (!container) throw new Error(`${label}: a container element is required`);
    if (onRestart !== null && typeof onRestart !== 'function') {
      throw new Error(`${label}: onRestart must be a function or null`);
    }

    const doc = resolveDocument(documentRef);
    if (!doc) throw new Error(`${label}: no document available`);

    this.label = label;
    this.restartKey = restartKey;
    this.onRestart = onRestart;
    this.documentRef = doc;
    this.shown = false;
    this.lastOutcome = null;

    this.root = doc.createElement('div');
    this.root.setAttribute('style', ROOT_STYLE);
    this.root.dataset.roundOutcome = 'overlay';

    this.panel = doc.createElement('div');
    this.panel.setAttribute('style', PANEL_STYLE);

    this.verdictEl = doc.createElement('div');
    this.verdictEl.setAttribute(
      'style',
      'font-size: 27px; font-weight: 700; letter-spacing: 0.06em'
    );

    // The reason is what turns "YOU LOSE" into something actionable.
    this.reasonEl = doc.createElement('div');
    this.reasonEl.setAttribute('style', 'margin-top: 8px; color: #aebdd2; font-size: 13px');

    this.detailEl = doc.createElement('div');
    this.detailEl.setAttribute(
      'style',
      'margin-top: 12px; color: #8fa0b8; font-size: 12px; white-space: pre-wrap'
    );

    this.hintEl = doc.createElement('div');
    this.hintEl.setAttribute(
      'style',
      'margin-top: 18px; padding-top: 14px; border-top: 1px solid #26303f;'
      + ' color: #7f8fa6; font-size: 12px'
    );

    this.panel.append(this.verdictEl, this.reasonEl, this.detailEl, this.hintEl);
    this.root.append(this.panel);
    container.appendChild(this.root);

    this.root.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      this.onRestart?.();
    });

    // The restart key is wired, not just hinted at. It listens on the document so a
    // captured pointer (mouse-look) cannot swallow it, but only acts while the verdict
    // is up -- outside a finished round the key stays free for the game.
    this._onKeydown = (event) => {
      if (!this.shown) return;
      if (event.key === this.restartKey || event.key === this.restartKey.toLowerCase()) {
        event.preventDefault();
        this.onRestart?.();
      }
    };
    // A documentRef injected for headless tests may omit addEventListener; in the
    // browser `document` always has it, so the key wiring is real there.
    if (typeof doc.addEventListener === 'function') {
      doc.addEventListener('keydown', this._onKeydown);
    }
  }

  /**
   * Announce the outcome and freeze the simulation.
   *
   * `won` decides the wording and the colour; `reason` is the director's own
   * outcomeReason; `detail` is optional game-specific context.
   */
  show({ won = false, reason = null, detail = null } = {}) {
    this.shown = true;
    this.lastOutcome = { won, reason, detail };

    this.verdictEl.textContent = won ? 'YOU WIN' : 'YOU LOSE';
    this.verdictEl.style.color = won ? WON_COLOR : LOST_COLOR;
    this.reasonEl.textContent = reason ? `reason: ${reason}` : '';
    this.detailEl.textContent = detail ?? '';
    this.hintEl.textContent = `press ${this.restartKey} or click to play again`;
    this.root.style.display = 'flex';

    // A captured pointer cannot click the panel, and a finished round has no more
    // use for mouse look.
    const doc = this.documentRef;
    if (doc.pointerLockElement) doc.exitPointerLock?.();
    return this;
  }

  /** Put the verdict away and let the simulation run again. */
  hide() {
    this.shown = false;
    this.root.style.display = 'none';
    return this;
  }

  get isShown() {
    return this.shown;
  }

  /**
   * The frame's delta, or 0 while the verdict is up.
   *
   * Wrap the delta at its single source so there is one place a reader has to look
   * to know whether the round is advancing.
   */
  scaleDelta(delta) {
    if (this.shown) return 0;
    return Number.isFinite(delta) ? delta : 0;
  }

  /** Remove the overlay from the DOM and release its key listener. */
  dispose() {
    if (typeof this.documentRef.removeEventListener === 'function') {
      this.documentRef.removeEventListener('keydown', this._onKeydown);
    }
    this.root.remove();
    return this;
  }
}

/**
 * Show the overlay from a `RoundDirector` terminal event, or ignore a non-terminal
 * one. Returns true when the event was terminal.
 *
 * Saves every caller re-deriving "which events end a round", which is the kind of
 * duplicated string comparison that drifts.
 *
 *     for (const event of director.step(delta)) {
 *       showOnTerminalEvent(overlay, event);
 *     }
 */
export function showOnTerminalEvent(overlay, event, { detail = null } = {}) {
  if (!overlay) throw new Error('showOnTerminalEvent: an overlay is required');
  const type = event?.type;
  if (type !== 'round.won' && type !== 'round.lost') return false;
  overlay.show({ won: type === 'round.won', reason: event.reason, detail });
  return true;
}
