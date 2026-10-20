import { CLOCK_EVENTS, CLOCK_EXPIRY_MEANINGS, GATE_MAX_ROUND_SECONDS } from './RoundClock.js';
import { OBJECTIVE_SHAPES } from './ObjectiveTracker.js';
import { RESOURCE_DEPLETION_POLICIES, RESOURCE_EVENTS } from './ResourcePool.js';

export const ROUND_STATES = Object.freeze({
  WAITING: 'WAITING',
  RUNNING: 'RUNNING',
  WON: 'WON',
  LOST: 'LOST',
});

export const ROUND_EVENTS = Object.freeze({
  ROUND_STARTED: 'round.started',
  ROUND_WON: 'round.won',
  ROUND_LOST: 'round.lost',
  PARTIAL_RESET: 'round.partialReset',
});

export const ROUND_OUTCOME_REASONS = Object.freeze({
  OBJECTIVE_COMPLETE: 'objectiveComplete',
  RESOURCE_DEPLETED: 'resourceDepleted',
  TIMER_EXPIRED: 'timerExpired',
  SURVIVED: 'survived',
  SCORE_LEAD: 'scoreLead',
  SCORE_BEHIND: 'scoreBehind',
  HAZARD: 'hazard',
});

/**
 * The stage-2 loop: an objective, a clock and some resources, resolved into
 * exactly one outcome.
 *
 * A round of any genre is this shape. What varies is which parts are present and
 * what "empty" or "expired" means, and all of that is data:
 *
 *   objective   one of five shapes, optionally with a "then reach X" clause
 *   clock       optional; expiry means lose or win
 *   resources   health / lives / stocks / score / quota / cash, each with a policy
 *
 * The single invariant worth more than the rest: **a terminal outcome fires
 * exactly once**. A director that re-announces the win on every subsequent frame
 * looks fine in a HUD and corrupts any replay or gate assertion built on the event
 * stream, so `state` latches and `step()` becomes a no-op once resolved.
 *
 * Determinism is the other one. This owns no clock and no randomness: feed the
 * same delta sequence and the same reported events, and the outcome and the frame
 * it lands on are identical. That is what makes the stage-2 gate's
 * "consistent across replays" mechanically checkable rather than a matter of
 * opinion.
 */
export class RoundDirector {
  constructor({
    objective = null,
    clock = null,
    resources = [],
    maxRoundSeconds = GATE_MAX_ROUND_SECONDS,
    onPartialReset = null,
    expiryLead = null,
  } = {}) {
    if (objective === null && clock === null) {
      throw new Error(
        'RoundDirector: a round needs an objective or a clock, or it can never resolve'
      );
    }
    if (!Array.isArray(resources)) {
      throw new Error('RoundDirector: resources must be an array of ResourcePool');
    }
    if (onPartialReset !== null && typeof onPartialReset !== 'function') {
      throw new Error('RoundDirector: onPartialReset must be a function or null');
    }
    if (expiryLead !== null && (
      typeof expiryLead !== 'object'
      || typeof expiryLead.own !== 'string'
      || typeof expiryLead.opponent !== 'string'
    )) {
      throw new Error('RoundDirector: expiryLead must be null or { own, opponent } resource ids');
    }
    // A survival objective with no clock cannot be satisfied: nothing would ever
    // report that the player lasted. Catch it here rather than at review time.
    if (objective?.shape === OBJECTIVE_SHAPES.SURVIVE && clock === null) {
      throw new Error(
        'RoundDirector: a SURVIVE objective needs a clock to mark the end of the round'
      );
    }
    if (clock && clock.limitSeconds > maxRoundSeconds) {
      throw new Error(
        `RoundDirector: clock limit ${clock.limitSeconds}s exceeds the stage-2 gate ` +
        `of ${maxRoundSeconds}s`
      );
    }

    this.objective = objective;
    this.clock = clock;
    this.resources = resources;
    this.maxRoundSeconds = maxRoundSeconds;
    this.onPartialReset = onPartialReset;
    this.expiryLead = expiryLead;

    this.resourcesById = new Map(resources.map((pool) => [pool.id, pool]));
    this.state = ROUND_STATES.WAITING;
    this.outcomeReason = null;
    this.elapsedSeconds = 0;
    this.partialResetCount = 0;
    this._events = [];
  }

  get isResolved() {
    return this.state === ROUND_STATES.WON || this.state === ROUND_STATES.LOST;
  }

  get isRunning() {
    return this.state === ROUND_STATES.RUNNING;
  }

  resource(id) {
    return this.resourcesById.get(id) ?? null;
  }

  start() {
    if (this.state !== ROUND_STATES.WAITING) return this;
    this.state = ROUND_STATES.RUNNING;
    this.clock?.start();
    this._events.push({ type: ROUND_EVENTS.ROUND_STARTED });
    return this;
  }

  /**
   * Advance the round. Returns the events raised this step.
   *
   * Order matters and is deliberate: resources first (a death this frame beats a
   * simultaneous objective completion, because the player was already out), then
   * the objective, then the clock. Ties therefore resolve the same way every
   * replay, which is the point.
   */
  step(deltaSeconds) {
    const delta = Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);
    if (!this.isRunning) return this.drainEvents();

    this.elapsedSeconds += delta;

    // Pull whatever the pools recorded since the last step.
    for (const pool of this.resources) {
      for (const event of pool.drainEvents()) {
        if (event.type !== RESOURCE_EVENTS.DEPLETED) continue;
        this._handleDepletion(pool, event);
        if (this.isResolved) return this.drainEvents();
      }
    }

    if (this.objective?.completed) {
      this._resolve(ROUND_STATES.WON, ROUND_OUTCOME_REASONS.OBJECTIVE_COMPLETE);
      return this.drainEvents();
    }
    this.objective?.drainEvents();

    if (this.clock) {
      for (const event of this.clock.step(delta)) {
        if (event.type !== CLOCK_EVENTS.EXPIRED) continue;
        this._handleExpiry();
        if (this.isResolved) return this.drainEvents();
      }
    }
    return this.drainEvents();
  }

  _handleDepletion(pool, event) {
    switch (pool.depletionPolicy) {
      case RESOURCE_DEPLETION_POLICIES.END_ROUND:
        this._resolve(ROUND_STATES.LOST, ROUND_OUTCOME_REASONS.RESOURCE_DEPLETED, {
          resourceId: pool.id,
        });
        break;
      case RESOURCE_DEPLETION_POLICIES.PARTIAL_RESET:
        // A caught player loses a life and positions reset, but what was already
        // collected stays collected. The caller owns what "reset" means.
        this.partialResetCount += 1;
        this._events.push({
          type: ROUND_EVENTS.PARTIAL_RESET,
          resourceId: pool.id,
          remaining: pool.value,
        });
        this.onPartialReset?.({ resourceId: pool.id, value: pool.value });
        break;
      case RESOURCE_DEPLETION_POLICIES.DECREMENT_ONLY:
        // A leaked enemy costs a life and nothing else happens. The pool itself
        // decides when zero is fatal, by using END_ROUND instead.
        break;
      default:
        throw new Error(`RoundDirector: unhandled policy "${pool.depletionPolicy}"`);
    }
    void event;
  }

  _handleExpiry() {
    // Survival: lasting to zero is the win, so tell the objective it held.
    if (this.clock.expiryIsWin) {
      this.objective?.noteSurvived();
      if (this.objective === null || this.objective.completed) {
        this._resolve(ROUND_STATES.WON, ROUND_OUTCOME_REASONS.SURVIVED);
        return;
      }
      // A "survive THEN reach" objective is not done yet: the follow-up target is
      // now live and the round keeps running. Returning to RUNNING here is why
      // the clock must not be the only terminal condition.
      this.state = ROUND_STATES.RUNNING;
      return;
    }

    if (this.clock.expiryMeaning === CLOCK_EXPIRY_MEANINGS.NEUTRAL) return;

    // A score-lead brief settles at the whistle rather than on a threshold.
    if (this.objective?.shape === OBJECTIVE_SHAPES.SCORE_LEAD) {
      const won = this.objective.isLeading;
      this._resolve(
        won ? ROUND_STATES.WON : ROUND_STATES.LOST,
        won ? ROUND_OUTCOME_REASONS.SCORE_LEAD : ROUND_OUTCOME_REASONS.SCORE_BEHIND
      );
      return;
    }
    // A lead-at-expiry brief settles at the whistle by comparing two pools rather
    // than one score: "ahead on health when the timer runs out" in a duel with no
    // score anywhere. `expiryLead = { own, opponent }` names the two pools by id;
    // the LOSE-expiry then becomes a lead comparison instead of an unconditional loss.
    if (this.expiryLead) {
      const own = this.resourcesById.get(this.expiryLead.own)?.value;
      const opponent = this.resourcesById.get(this.expiryLead.opponent)?.value;
      const won = Number.isFinite(own) && Number.isFinite(opponent) && own > opponent;
      this._resolve(
        won ? ROUND_STATES.WON : ROUND_STATES.LOST,
        won ? ROUND_OUTCOME_REASONS.SCORE_LEAD : ROUND_OUTCOME_REASONS.SCORE_BEHIND
      );
      return;
    }
    this._resolve(ROUND_STATES.LOST, ROUND_OUTCOME_REASONS.TIMER_EXPIRED);
  }

  /**
   * End the round immediately from a one-shot hazard: a spike, a pipe, a kill
   * volume, a ring-out. Plenty of games end on contact with no health anywhere in
   * them, so this is a first-class path rather than a health pool with one point --
   * which would also put a meaningless health bar on the HUD.
   */
  noteFatalHazard(detail = {}) {
    if (!this.isRunning) return false;
    this._resolve(ROUND_STATES.LOST, ROUND_OUTCOME_REASONS.HAZARD, detail);
    return true;
  }

  /** Force the win, for a caller whose completion test lives elsewhere. */
  noteObjectiveComplete() {
    if (!this.isRunning) return false;
    this._resolve(ROUND_STATES.WON, ROUND_OUTCOME_REASONS.OBJECTIVE_COMPLETE);
    return true;
  }

  _resolve(state, reason, detail = {}) {
    if (this.isResolved) return; // latch: a terminal outcome fires exactly once
    this.state = state;
    this.outcomeReason = reason;
    this.clock?.pause();
    this._events.push({
      type: state === ROUND_STATES.WON ? ROUND_EVENTS.ROUND_WON : ROUND_EVENTS.ROUND_LOST,
      reason,
      elapsedSeconds: this.elapsedSeconds,
      ...detail,
    });
  }

  drainEvents() {
    const events = this._events;
    this._events = [];
    return events;
  }

  snapshot() {
    return {
      state: this.state,
      outcomeReason: this.outcomeReason,
      elapsedSeconds: this.elapsedSeconds,
      partialResetCount: this.partialResetCount,
      objective: this.objective ? this.objective.snapshot() : null,
      clock: this.clock ? this.clock.snapshot() : null,
      resources: this.resources.map((pool) => pool.snapshot()),
    };
  }

  reset() {
    this.state = ROUND_STATES.WAITING;
    this.outcomeReason = null;
    this.elapsedSeconds = 0;
    this.partialResetCount = 0;
    this._events = [];
    this.objective?.reset();
    this.clock?.reset();
    for (const pool of this.resources) pool.reset();
    return this;
  }
}
