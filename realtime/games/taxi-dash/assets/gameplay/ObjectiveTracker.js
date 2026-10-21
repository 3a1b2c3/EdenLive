export const OBJECTIVE_SHAPES = Object.freeze({
  // Reduce a set of targets to none: clear every enemy, empty a formation, take a
  // boss to zero health.
  DEPLETE_ALL: 'depleteAll',
  // Accumulate to a threshold: lines cleared, dishes served, gates passed,
  // segments grown, pickups collected.
  QUOTA: 'quota',
  // Touch a place: cross the finish line, reach the end portal, land on the goal
  // platform.
  REACH: 'reach',
  // Still standing when the clock runs out. The clock owns the polarity.
  SURVIVE: 'survive',
  // Be ahead when it ends, as in a timed match with an opposing score.
  SCORE_LEAD: 'scoreLead',
});

export const OBJECTIVE_EVENTS = Object.freeze({
  PROGRESSED: 'objective.progressed',
  PRIMARY_MET: 'objective.primaryMet',
  COMPLETED: 'objective.completed',
});

/**
 * What winning means, as data rather than a branch per genre.
 *
 * A brief's `win_state` reduces to one of the five shapes above. They are different
 * *readings of a counter or a position*, not different pipelines -- so this is one
 * module with a shape enum, and adding a genre does not add a code path.
 *
 * Some wins have a SECOND clause: "clear the room, THEN cross the exit",
 * "eliminate the target, THEN reach extraction", "survive the timer, THEN reach the
 * beacon". That ordering matters -- the exit is locked until the primary is met --
 * so `then` is a first-class option rather than something a caller fakes with two
 * trackers.
 *
 * Headless: positions are plain `{x, y, z}`-ish objects and reaching is reported
 * by the caller via `noteReached()`, so no scene graph is needed to test a rule.
 */
export class ObjectiveTracker {
  constructor({
    shape,
    target = 1,
    // REACH: the caller decides what "arrived" means and calls noteReached().
    // QUOTA / DEPLETE_ALL: progress is reported through the methods below.
    then = null,
    label = 'objective',
  } = {}) {
    if (!Object.values(OBJECTIVE_SHAPES).includes(shape)) {
      throw new Error(
        `ObjectiveTracker: shape must be one of ${Object.values(OBJECTIVE_SHAPES).join(', ')}`
      );
    }
    if (!Number.isFinite(target) || target < 0) {
      throw new Error('ObjectiveTracker: target must be a finite number >= 0');
    }
    if (then !== null && !Object.values(OBJECTIVE_SHAPES).includes(then.shape)) {
      throw new Error('ObjectiveTracker: then.shape must be a valid objective shape');
    }

    this.shape = shape;
    this.target = target;
    this.label = label;

    // The second clause, built as a nested tracker so it validates and reports
    // through exactly the same code.
    this.then = then
      ? new ObjectiveTracker({ ...then, then: null, label: then.label ?? 'then' })
      : null;

    this.progress = 0;
    this.primaryMet = false;
    this.completed = false;
    this._events = [];
  }

  /** True when the follow-up clause is the thing still outstanding. */
  get awaitingSecondClause() {
    return this.primaryMet && this.then !== null && !this.completed;
  }

  get remaining() {
    return Math.max(0, this.target - this.progress);
  }

  get fraction() {
    return this.target <= 0 ? 1 : Math.min(1, this.progress / this.target);
  }

  _emit(type, extra = {}) {
    this._events.push({ type, label: this.label, shape: this.shape, ...extra });
  }

  /**
   * Report progress toward the primary clause: one more line cleared, one more
   * enemy down, one more segment grown.
   *
   * For DEPLETE_ALL, `target` is the number that must be removed, so each
   * removal is one unit of progress -- the same counter as QUOTA read from the
   * other direction. That symmetry is deliberate: "kill all 6" and "collect 6"
   * are the same assertion.
   */
  advance(amount = 1) {
    const delta = Math.max(0, Number.isFinite(amount) ? amount : 0);
    if (delta === 0 || this.completed) return this.progress;

    this.progress += delta;
    this._emit(OBJECTIVE_EVENTS.PROGRESSED, {
      progress: this.progress,
      target: this.target,
      remaining: this.remaining,
    });
    this._checkPrimary();
    return this.progress;
  }

  /** Set absolute progress, for a caller that owns the count (a collectable set). */
  setProgress(value) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error('ObjectiveTracker: setProgress requires a finite number >= 0');
    }
    if (this.completed) return this.progress;
    this.progress = value;
    this._emit(OBJECTIVE_EVENTS.PROGRESSED, {
      progress: this.progress,
      target: this.target,
      remaining: this.remaining,
    });
    this._checkPrimary();
    return this.progress;
  }

  /**
   * Report arrival at the goal. Applies to the primary clause for a REACH
   * objective, and otherwise to the second clause -- which is refused while the
   * primary is still open, because that is exactly the "locked exit" the three
   * two-clause briefs describe.
   *
   * Returns true when the report was accepted.
   */
  noteReached() {
    if (this.completed) return false;

    if (!this.primaryMet) {
      if (this.shape !== OBJECTIVE_SHAPES.REACH) return false; // exit still locked
      this.progress = this.target;
      this._checkPrimary();
      return true;
    }
    if (this.then === null) return false;
    this.then.noteReached();
    this._checkThen();
    return true;
  }

  /** Report that the survival clause held (the clock expired in the player's favour). */
  noteSurvived() {
    if (this.completed) return false;
    if (!this.primaryMet && this.shape === OBJECTIVE_SHAPES.SURVIVE) {
      this.progress = this.target;
      this._checkPrimary();
      return true;
    }
    if (this.primaryMet && this.then?.shape === OBJECTIVE_SHAPES.SURVIVE) {
      this.then.noteSurvived();
      this._checkThen();
      return true;
    }
    return false;
  }

  /** Report the score comparison for a SCORE_LEAD objective. */
  noteScores({ own, opponent }) {
    if (!Number.isFinite(own) || !Number.isFinite(opponent)) {
      throw new Error('ObjectiveTracker.noteScores requires finite own and opponent');
    }
    if (this.completed || this.shape !== OBJECTIVE_SHAPES.SCORE_LEAD) return false;
    // A lead is only decided when the round ends, so this records rather than
    // completes; the director asks `isLeading` at expiry.
    this.progress = own > opponent ? this.target : 0;
    this.ownScore = own;
    this.opponentScore = opponent;
    return true;
  }

  get isLeading() {
    return this.shape === OBJECTIVE_SHAPES.SCORE_LEAD && this.progress >= this.target;
  }

  _checkPrimary() {
    if (this.primaryMet || this.progress < this.target) return;
    this.primaryMet = true;
    this._emit(OBJECTIVE_EVENTS.PRIMARY_MET, { progress: this.progress });
    // No follow-up clause means the primary IS the objective.
    if (this.then === null) {
      this.completed = true;
      this._emit(OBJECTIVE_EVENTS.COMPLETED);
    }
  }

  _checkThen() {
    if (this.completed || !this.then?.completed) return;
    this.completed = true;
    this._emit(OBJECTIVE_EVENTS.COMPLETED);
  }

  drainEvents() {
    const events = this._events;
    this._events = [];
    if (this.then) events.push(...this.then.drainEvents());
    return events;
  }

  snapshot() {
    return {
      label: this.label,
      shape: this.shape,
      progress: this.progress,
      target: this.target,
      remaining: this.remaining,
      fraction: this.fraction,
      primaryMet: this.primaryMet,
      completed: this.completed,
      awaitingSecondClause: this.awaitingSecondClause,
      then: this.then ? this.then.snapshot() : null,
    };
  }

  reset() {
    this.progress = 0;
    this.primaryMet = false;
    this.completed = false;
    this._events = [];
    this.then?.reset();
    return this;
  }
}
