import { FrameStepper } from '/assets/math/TimeUtils.js';

// Static composition, discrete input and fixed simulation share one clock owner.
// DOM/pointer events may call game.handleInput(action) directly in behavior stages.
export function createGameLoop(game, {
  mode = 'static', input = null, isActive = () => true, timing = {},
} = {}) {
  if (!['static', 'discrete', 'fixed'].includes(mode)) throw new Error('Unknown game loop mode');
  const clock = new FrameStepper({ ...timing, mode: mode === 'fixed' ? 'fixed' : 'discrete' });
  let last = null;
  let interrupted = false;
  return {
    tick(now, { active = true } = {}) {
      if (!Number.isFinite(now) || (last !== null && now < last)) {
        throw new Error('Frame timestamps must be finite and monotonic');
      }
      const rawDt = last === null ? 0 : (now - last) / 1000;
      last = now;
      const enabled = active && !interrupted;
      interrupted = false;
      const wasActive = isActive();
      if (!enabled) input?.clear();
      // Resume/restart inputs still work while simulation is paused or terminal.
      // Consume edges once per frame, independently of fixed substep count.
      if (enabled && mode !== 'static' && input) game.handleInput(input);
      const frame = clock.advance(rawDt, dt => {
        const result = game.update(dt, input);
        if (result === false || !isActive() || interrupted) return false;
      }, { active: enabled && !interrupted && wasActive && isActive() });
      if (wasActive && !isActive()) input?.clear();
      interrupted = false;
      return frame;
    },
    // Call on visibility/pause transitions, including those between RAF callbacks.
    suspend() {
      interrupted = true;
      input?.clear();
    },
    read(observations = {}) {
      return structuredClone({ ...game.read(), ...observations, frame: clock.frame, clock: clock.read() });
    },
  };
}
