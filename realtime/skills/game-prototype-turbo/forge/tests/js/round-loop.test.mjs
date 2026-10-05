// Headless tests for reusable round-loop components:
//   assets/gameplay/ResourcePool.js
//   assets/gameplay/RoundClock.js
//   assets/gameplay/ObjectiveTracker.js
//   assets/gameplay/RoundDirector.js
//
// Two invariants make deterministic round diagnostics useful:
//   1. A terminal outcome fires EXACTLY ONCE. A director that re-announces the
//      win every frame looks fine in a HUD and corrupts every replay assertion.
//   2. The same delta sequence produces the same outcome on the same frame. That
//      is what makes "consistent across replays" checkable instead of arguable.
//
// The win/lose shapes exercised here are the ones the round loop is built for,
// with the mechanic each one stands for named in the test.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ResourcePool,
  RESOURCE_DEPLETION_POLICIES,
  RESOURCE_EVENTS,
} from '../../../assets/gameplay/ResourcePool.js';
import {
  RoundClock,
  CLOCK_EVENTS,
  CLOCK_EXPIRY_MEANINGS,
  GATE_MAX_ROUND_SECONDS,
} from '../../../assets/gameplay/RoundClock.js';
import {
  ObjectiveTracker,
  OBJECTIVE_SHAPES,
} from '../../../assets/gameplay/ObjectiveTracker.js';
import {
  RoundDirector,
  ROUND_STATES,
  ROUND_EVENTS,
  ROUND_OUTCOME_REASONS,
} from '../../../assets/gameplay/RoundDirector.js';

const FRAME = 1 / 60;

/** Run frames until resolved or the budget runs out; collect every event. */
function runRound(director, { seconds = 200, perFrame = null } = {}) {
  const events = [];
  const frames = Math.ceil(seconds / FRAME);
  for (let i = 0; i < frames; i += 1) {
    perFrame?.(i, director);
    events.push(...director.step(FRAME));
    if (director.isResolved) break;
  }
  return events;
}

function terminalEvents(events) {
  return events.filter(
    (e) => e.type === ROUND_EVENTS.ROUND_WON || e.type === ROUND_EVENTS.ROUND_LOST
  );
}

// --- ResourcePool ----------------------------------------------------------

test('a pool gains, loses and reports depletion once at the crossing', () => {
  const health = new ResourcePool({ id: 'health', initial: 100, max: 100 });
  health.gain(50);
  assert.equal(health.value, 100, 'clamped at max');

  health.lose(40);
  assert.equal(health.value, 60);
  assert.equal(health.fraction, 0.6);
  assert.equal(health.isDepleted, false);

  const events = health.drainEvents();
  assert.equal(events.filter((e) => e.type === RESOURCE_EVENTS.DEPLETED).length, 0);

  health.lose(60);
  assert.equal(health.isDepleted, true);
  assert.equal(
    health.drainEvents().filter((e) => e.type === RESOURCE_EVENTS.DEPLETED).length,
    1,
    'depletion is the crossing, so it fires once'
  );

  // Losing again while already empty must NOT re-fire: a director counting
  // stocks would otherwise burn every stock on one hit.
  health.lose(10);
  assert.equal(
    health.drainEvents().filter((e) => e.type === RESOURCE_EVENTS.DEPLETED).length,
    0,
    're-depletion must not fire'
  );
});

test('spending is refused rather than clamped, and is distinct from losing', () => {
  // Currency funds placements. A partial purchase is never what a caller meant,
  // and "I bought something" must not look like "I took damage".
  const cash = new ResourcePool({ id: 'cash', initial: 250 });
  assert.equal(cash.canSpend(100), true);
  assert.equal(cash.spend(100), true);
  assert.equal(cash.value, 150);

  assert.equal(cash.canSpend(500), false);
  assert.equal(cash.spend(500), false, 'refused, not clamped');
  assert.equal(cash.value, 150, 'a refused spend changes nothing');

  cash.refund(60);
  assert.equal(cash.value, 210);

  const kinds = cash.drainEvents().map((e) => e.type);
  assert.ok(kinds.includes(RESOURCE_EVENTS.SPENT));
  assert.ok(kinds.includes(RESOURCE_EVENTS.GAINED));
  assert.ok(!kinds.includes(RESOURCE_EVENTS.LOST), 'spending is not losing');
});

test('a quota pool reports filling, which is the same counter read upward', () => {
  // A quota of ten. Same machinery as health, read from the opposite end.
  const lines = new ResourcePool({ id: 'lines', initial: 0, fillAt: 10 });
  for (let i = 0; i < 9; i += 1) lines.gain(1);
  assert.equal(lines.isFilled, false);
  lines.gain(1);
  assert.equal(lines.isFilled, true);
  assert.ok(lines.drainEvents().some((e) => e.type === RESOURCE_EVENTS.FILLED));
});

test('a pool validates its knobs', () => {
  assert.throws(() => new ResourcePool({ id: '' }), /id/);
  assert.throws(() => new ResourcePool({ id: 'x', initial: Number.NaN }), /initial/);
  assert.throws(() => new ResourcePool({ id: 'x', min: 5, max: 1 }), /max/);
  assert.throws(
    () => new ResourcePool({ id: 'x', depletionPolicy: 'nope' }),
    /depletionPolicy/
  );
});

// --- RoundClock ------------------------------------------------------------

test('the clock counts down, warns once, and expires exactly once', () => {
  const clock = new RoundClock({ limitSeconds: 10, warningSeconds: 3 });
  clock.start();

  let warnings = 0;
  let expiries = 0;
  for (let i = 0; i < 900; i += 1) {
    for (const event of clock.step(FRAME)) {
      if (event.type === CLOCK_EVENTS.WARNING) warnings += 1;
      if (event.type === CLOCK_EVENTS.EXPIRED) expiries += 1;
    }
  }
  assert.equal(warnings, 1, 'the warning is a crossing, not a state');
  assert.equal(expiries, 1, 'expiry fires once even after many further steps');
  assert.equal(clock.remainingSeconds, 0);
  assert.equal(clock.running, false);
});

test('expiry polarity is a knob, not a second module', () => {
  // Usually running out is the loss; in a survival round reaching zero IS the win.
  const losing = new RoundClock({ limitSeconds: 1, expiryMeaning: CLOCK_EXPIRY_MEANINGS.LOSE });
  const winning = new RoundClock({ limitSeconds: 1, expiryMeaning: CLOCK_EXPIRY_MEANINGS.WIN });
  assert.equal(losing.expiryIsWin, false);
  assert.equal(winning.expiryIsWin, true);

  winning.start();
  const events = [];
  for (let i = 0; i < 120; i += 1) events.push(...winning.step(FRAME));
  const expired = events.find((e) => e.type === CLOCK_EVENTS.EXPIRED);
  assert.equal(expired.isWin, true, 'the event carries the polarity');
});

test('the clock applies its default cap and accepts an explicit gameplay cap', () => {
  assert.equal(GATE_MAX_ROUND_SECONDS, 180);
  assert.doesNotThrow(() => new RoundClock({ limitSeconds: 150 }));
  assert.doesNotThrow(() => new RoundClock({ limitSeconds: 180 }));
  assert.throws(() => new RoundClock({ limitSeconds: 181 }), /exceeds the configured clock cap/);
  const longer = new RoundClock({ limitSeconds: 300, maxRoundSeconds: 300 });
  longer.start();
  assert.equal(longer.step(299).some((event) => event.type === CLOCK_EVENTS.EXPIRED), false);
  assert.equal(longer.step(1).some((event) => event.type === CLOCK_EVENTS.EXPIRED), true);
  assert.throws(() => new RoundClock({ limitSeconds: 0 }), /limitSeconds/);
});

// --- ObjectiveTracker -----------------------------------------------------

test('the five win shapes are all reachable', () => {
  for (const shape of Object.values(OBJECTIVE_SHAPES)) {
    assert.doesNotThrow(() => new ObjectiveTracker({ shape, target: 1 }));
  }
  assert.throws(() => new ObjectiveTracker({ shape: 'nope' }), /shape must be one of/);
});

test('QUOTA completes at the threshold and not before', () => {
  // A service quota: four completions.
  const dishes = new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.QUOTA, target: 4 });
  for (let i = 0; i < 3; i += 1) dishes.advance(1);
  assert.equal(dishes.completed, false);
  assert.equal(dishes.remaining, 1);
  dishes.advance(1);
  assert.equal(dishes.completed, true);
  assert.equal(dishes.fraction, 1);
});

test('DEPLETE_ALL is the same counter as QUOTA, read from the other end', () => {
  // A room of six. "Clear all 6" and "collect 6" are one assertion.
  const room = new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.DEPLETE_ALL, target: 6 });
  for (let i = 0; i < 6; i += 1) room.advance(1);
  assert.equal(room.completed, true);
});

test('a two-clause objective keeps the exit locked until the primary is met', () => {
  // "Clear the room, THEN cross the unlocked exit." The ordering is the point:
  // the exit does not exist as an option until the primary clause is met.
  const objective = new ObjectiveTracker({
    shape: OBJECTIVE_SHAPES.DEPLETE_ALL,
    target: 6,
    then: { shape: OBJECTIVE_SHAPES.REACH, target: 1, label: 'exit' },
  });

  assert.equal(objective.noteReached(), false, 'the exit is locked');
  assert.equal(objective.completed, false);

  for (let i = 0; i < 6; i += 1) objective.advance(1);
  assert.equal(objective.primaryMet, true);
  assert.equal(objective.completed, false, 'primary met is not the whole objective');
  assert.equal(objective.awaitingSecondClause, true);

  assert.equal(objective.noteReached(), true, 'the exit is live now');
  assert.equal(objective.completed, true);
});

test('a REACH objective completes on arrival', () => {
  // Touch the goal: an end portal, a finish line, a summit platform.
  const portal = new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.REACH });
  assert.equal(portal.completed, false);
  assert.equal(portal.noteReached(), true);
  assert.equal(portal.completed, true);
});

test('SCORE_LEAD records the comparison and settles at the whistle', () => {
  // Behind 0-1, win by leading when the timer expires.
  const match = new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.SCORE_LEAD });
  match.noteScores({ own: 0, opponent: 1 });
  assert.equal(match.isLeading, false);
  assert.equal(match.completed, false, 'a lead is not a win until the round ends');

  match.noteScores({ own: 2, opponent: 1 });
  assert.equal(match.isLeading, true);
});

// --- RoundDirector: the two load-bearing invariants ----------------------

test('a terminal outcome fires exactly once, however long the round runs on', () => {
  const objective = new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.QUOTA, target: 3 });
  const director = new RoundDirector({ objective, clock: new RoundClock({ limitSeconds: 60 }) });
  director.start();

  objective.advance(3);
  // Keep stepping well past the resolution: nothing may fire twice.
  const events = [];
  for (let i = 0; i < 600; i += 1) events.push(...director.step(FRAME));

  assert.equal(terminalEvents(events).length, 1, 'exactly one terminal event');
  assert.equal(director.state, ROUND_STATES.WON);
  assert.equal(director.outcomeReason, ROUND_OUTCOME_REASONS.OBJECTIVE_COMPLETE);
});

test('the same delta sequence gives the same outcome on the same frame', () => {
  // "Consistent across replays" as a mechanical assertion, not an opinion.
  function play() {
    const objective = new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.QUOTA, target: 5 });
    const health = new ResourcePool({ id: 'health', initial: 30, max: 30 });
    const director = new RoundDirector({
      objective,
      clock: new RoundClock({ limitSeconds: 20 }),
      resources: [health],
    });
    director.start();

    let frame = 0;
    const events = runRound(director, {
      seconds: 30,
      perFrame: (i) => {
        frame = i;
        // A fixed input script: progress on some frames, damage on others.
        if (i % 90 === 89) objective.advance(1);
        if (i % 140 === 139) health.lose(7);
      },
    });
    return {
      state: director.state,
      reason: director.outcomeReason,
      frames: frame,
      elapsed: Number(director.elapsedSeconds.toFixed(6)),
      terminal: terminalEvents(events).length,
    };
  }

  const a = play();
  const b = play();
  assert.deepEqual(a, b, 'identical inputs must give an identical outcome and frame');
  assert.equal(a.terminal, 1);
});

test('resources resolve before the objective, so ties break the same way', () => {
  // A death and a completion on the same frame: the player was already out.
  const objective = new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.QUOTA, target: 1 });
  const health = new ResourcePool({ id: 'health', initial: 10, max: 10 });
  const director = new RoundDirector({ objective, resources: [health] });
  director.start();

  objective.advance(1);
  health.lose(10);
  const events = director.step(FRAME);

  assert.equal(director.state, ROUND_STATES.LOST, 'death this frame wins the tie');
  assert.equal(director.outcomeReason, ROUND_OUTCOME_REASONS.RESOURCE_DEPLETED);
  assert.equal(terminalEvents(events).length, 1);
});

test('the three depletion policies behave differently, as the briefs require', () => {
  // END_ROUND: the common case.
  const endRound = new ResourcePool({ id: 'health', initial: 1 });
  const a = new RoundDirector({
    objective: new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.QUOTA, target: 99 }),
    resources: [endRound],
  });
  a.start();
  endRound.lose(1);
  a.step(FRAME);
  assert.equal(a.state, ROUND_STATES.LOST);

  // DECREMENT_ONLY: a leaked enemy costs a life and nothing else stops.
  const leak = new ResourcePool({
    id: 'lives',
    initial: 1,
    depletionPolicy: RESOURCE_DEPLETION_POLICIES.DECREMENT_ONLY,
  });
  const b = new RoundDirector({
    objective: new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.QUOTA, target: 99 }),
    resources: [leak],
  });
  b.start();
  leak.lose(1);
  b.step(FRAME);
  assert.equal(b.state, ROUND_STATES.RUNNING, 'the round carries on');

  // PARTIAL_RESET: caught by a chaser -- positions reset, pickups stay collected.
  const resets = [];
  const lives = new ResourcePool({
    id: 'lives',
    initial: 3,
    depletionPolicy: RESOURCE_DEPLETION_POLICIES.PARTIAL_RESET,
  });
  const c = new RoundDirector({
    objective: new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.QUOTA, target: 99 }),
    resources: [lives],
    onPartialReset: (detail) => resets.push(detail),
  });
  c.start();
  lives.lose(3);
  const events = c.step(FRAME);
  assert.equal(c.state, ROUND_STATES.RUNNING, 'a partial reset does not end the round');
  assert.equal(c.partialResetCount, 1);
  assert.equal(resets.length, 1, 'the caller is told to reposition');
  assert.ok(events.some((e) => e.type === ROUND_EVENTS.PARTIAL_RESET));
});

test('timer expiry loses by default and wins for a survival round', () => {
  // A timed objective: out of time is the loss.
  const losing = new RoundDirector({
    objective: new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.REACH }),
    clock: new RoundClock({ limitSeconds: 1 }),
  });
  losing.start();
  const lostEvents = runRound(losing, { seconds: 5 });
  assert.equal(losing.state, ROUND_STATES.LOST);
  assert.equal(losing.outcomeReason, ROUND_OUTCOME_REASONS.TIMER_EXPIRED);
  assert.equal(terminalEvents(lostEvents).length, 1);

  // A survival round: last until the shift ends and you have won.
  const surviving = new RoundDirector({
    objective: new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.SURVIVE }),
    clock: new RoundClock({ limitSeconds: 1, expiryMeaning: CLOCK_EXPIRY_MEANINGS.WIN }),
  });
  surviving.start();
  const wonEvents = runRound(surviving, { seconds: 5 });
  assert.equal(surviving.state, ROUND_STATES.WON);
  assert.equal(surviving.outcomeReason, ROUND_OUTCOME_REASONS.SURVIVED);
  assert.equal(terminalEvents(wonEvents).length, 1);
});

test('survive-then-reach keeps running after the clock, until the beacon', () => {
  // "Remain alive until the timer, THEN reach extraction."
  // The clock expiring must NOT end the round here -- that is the subtle case.
  const objective = new ObjectiveTracker({
    shape: OBJECTIVE_SHAPES.SURVIVE,
    then: { shape: OBJECTIVE_SHAPES.REACH, target: 1, label: 'beacon' },
  });
  const director = new RoundDirector({
    objective,
    clock: new RoundClock({ limitSeconds: 1, expiryMeaning: CLOCK_EXPIRY_MEANINGS.WIN }),
  });
  director.start();

  runRound(director, { seconds: 3 });
  assert.equal(director.state, ROUND_STATES.RUNNING, 'the beacon is still outstanding');
  assert.equal(objective.primaryMet, true, 'the survival clause held');
  assert.equal(objective.awaitingSecondClause, true);

  objective.noteReached();
  const events = director.step(FRAME);
  assert.equal(director.state, ROUND_STATES.WON);
  assert.equal(terminalEvents(events).length, 1);
});

test('score-lead settles at the whistle in both directions', () => {
  function match(own, opponent) {
    const objective = new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.SCORE_LEAD });
    const director = new RoundDirector({
      objective,
      clock: new RoundClock({ limitSeconds: 1 }),
    });
    director.start();
    objective.noteScores({ own, opponent });
    runRound(director, { seconds: 3 });
    return [director.state, director.outcomeReason];
  }
  assert.deepEqual(match(2, 1), [ROUND_STATES.WON, ROUND_OUTCOME_REASONS.SCORE_LEAD]);
  assert.deepEqual(match(0, 1), [ROUND_STATES.LOST, ROUND_OUTCOME_REASONS.SCORE_BEHIND]);
});

test('a one-shot hazard ends the round without any health pool', () => {
  // Many games end on contact with no health involved: a spike, a pipe, an
  // oncoming obstacle, a kill volume.
  const director = new RoundDirector({
    objective: new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.REACH }),
  });
  director.start();
  assert.equal(director.noteFatalHazard({ tag: 'spike' }), true);
  assert.equal(director.state, ROUND_STATES.LOST);
  assert.equal(director.outcomeReason, ROUND_OUTCOME_REASONS.HAZARD);

  // And it cannot fire twice.
  assert.equal(director.noteFatalHazard({ tag: 'spike' }), false);
});

test('reset returns a resolved round to a replayable start', () => {
  const objective = new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.QUOTA, target: 2 });
  const health = new ResourcePool({ id: 'health', initial: 5, max: 5 });
  const director = new RoundDirector({
    objective,
    clock: new RoundClock({ limitSeconds: 10 }),
    resources: [health],
  });
  director.start();
  objective.advance(2);
  director.step(FRAME);
  assert.equal(director.state, ROUND_STATES.WON);

  director.reset();
  assert.equal(director.state, ROUND_STATES.WAITING);
  assert.equal(director.outcomeReason, null);
  assert.equal(objective.progress, 0);
  assert.equal(health.value, 5);
  assert.equal(director.clock.remainingSeconds, 10);

  // And it plays again identically.
  director.start();
  objective.advance(2);
  const events = director.step(FRAME);
  assert.equal(director.state, ROUND_STATES.WON);
  assert.equal(terminalEvents(events).length, 1);
});

test('the director refuses a round that can never resolve', () => {
  assert.throws(() => new RoundDirector({}), /objective or a clock/);
  // A survival objective with no clock: nothing would ever say the player lasted.
  assert.throws(
    () => new RoundDirector({ objective: new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.SURVIVE }) }),
    /needs a clock/
  );
  assert.throws(
    () => new RoundDirector({ objective: new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.REACH }), resources: 'no' }),
    /resources must be an array/
  );
});
