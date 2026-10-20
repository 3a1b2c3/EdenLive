export class Clock {
  constructor({ manual = false, nowMs = 0 } = {}) {
    this.manual = manual;
    this.currentMs = nowMs;
  }

  now() {
    return this.manual ? this.currentMs : Date.now();
  }

  nowSeconds() {
    return this.now() * 0.001;
  }

  useSystem() {
    this.manual = false;
    return this;
  }

  useManual(nowMs = this.currentMs) {
    this.manual = true;
    this.currentMs = nowMs;
    return this;
  }

  setMs(nowMs) {
    this.currentMs = nowMs;
    return this;
  }

  advanceMs(deltaMs) {
    this.currentMs += deltaMs;
    return this;
  }
}

export const DEFAULT_CLOCK = new Clock();

/** Bounded fixed-step accumulation, or render-only accounting for discrete games.
 * Feed the unmodified RAF delta in seconds. Callers own pause/terminal policy and
 * pass active=false while hidden or paused. No gameplay countdown is implied.
 */
export class FrameStepper {
  constructor({ mode = 'fixed', stepSeconds = 1 / 60, maxSteps = 8, maxBacklogSeconds = 0.25 } = {}) {
    if (!['fixed', 'discrete'].includes(mode)
      || !Number.isFinite(stepSeconds) || stepSeconds <= 0
      || !Number.isInteger(maxSteps) || maxSteps < 1
      || !Number.isFinite(maxBacklogSeconds) || maxBacklogSeconds < stepSeconds) {
      throw new Error('Invalid FrameStepper configuration');
    }
    Object.assign(this, { mode, stepSeconds, maxSteps, maxBacklogSeconds });
    this.reset();
  }

  reset() {
    this.frame = { id: 0, rawDt: 0, simDt: 0 };
    this.wallSeconds = this.activeSeconds = this.simulatedSeconds = 0;
    this.backlogSeconds = this.droppedSeconds = this.pausedSeconds = this.discreteSeconds = 0;
  }

  advance(rawDt, update, { active = true } = {}) {
    if (!Number.isFinite(rawDt) || rawDt < 0) throw new Error('rawDt must be finite and nonnegative');
    this.wallSeconds += rawDt;
    let simDt = 0;
    if (!active) {
      this.pausedSeconds += rawDt;
      this.droppedSeconds += this.backlogSeconds;
      this.backlogSeconds = 0;
    } else if (this.mode === 'discrete') {
      // Active wall time is useful for every mode; discreteSeconds additionally
      // records render time that was intentionally not fed into simulation.
      this.activeSeconds += rawDt;
      this.discreteSeconds += rawDt;
      this.droppedSeconds += this.backlogSeconds;
      this.backlogSeconds = 0;
    } else {
      this.activeSeconds += rawDt;
      const pending = this.backlogSeconds + rawDt;
      this.droppedSeconds += Math.max(0, pending - this.maxBacklogSeconds);
      this.backlogSeconds = Math.min(pending, this.maxBacklogSeconds);
      for (let i = 0; i < this.maxSteps && this.backlogSeconds + 1e-10 >= this.stepSeconds; i++) {
        this.backlogSeconds = Math.max(0, this.backlogSeconds - this.stepSeconds);
        simDt += this.stepSeconds;
        // Returning false stops remaining substeps at a terminal/pause transition.
        if (update(this.stepSeconds) === false) {
          this.droppedSeconds += this.backlogSeconds;
          this.backlogSeconds = 0;
          break;
        }
      }
    }
    this.simulatedSeconds += simDt;
    this.frame = { id: this.frame.id + 1, rawDt, simDt };
    return { ...this.frame };
  }

  read() {
    const { mode, wallSeconds, activeSeconds, simulatedSeconds, backlogSeconds, droppedSeconds, pausedSeconds, discreteSeconds } = this;
    return { mode, wallSeconds, activeSeconds, simulatedSeconds, backlogSeconds, droppedSeconds, pausedSeconds, discreteSeconds };
  }
}
