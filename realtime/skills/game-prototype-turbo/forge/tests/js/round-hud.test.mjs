// Headless tests for the round-status HUD helpers in
// assets/user-interface/PrototypeShell.js.
//
// These were extracted from repeated round presentation code: `meterBar`
// character for character, and the same round-status row block with the same
// ordering convention. The convention is the part worth protecting -- the rows
// that can END the round come first, and the outcome reason reaches the screen --
// so that is what these tests pin.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { meterBar, roundStatusRows } from '../../../assets/user-interface/PrototypeShell.js';
import { ResourcePool } from '../../../assets/gameplay/ResourcePool.js';
import { RoundClock, CLOCK_EXPIRY_MEANINGS } from '../../../assets/gameplay/RoundClock.js';
import {
  ObjectiveTracker,
  OBJECTIVE_SHAPES,
} from '../../../assets/gameplay/ObjectiveTracker.js';
import { RoundDirector } from '../../../assets/gameplay/RoundDirector.js';

const labelOf = (rows, label) => rows.find(([name]) => name === label)?.[1];

// --- meterBar --------------------------------------------------------------

test('meterBar fills proportionally and keeps a constant width', () => {
  assert.equal(meterBar(0, { cells: 8 }), '[........]');
  assert.equal(meterBar(1, { cells: 8 }), '[########]');
  assert.equal(meterBar(0.5, { cells: 8 }), '[####....]');
  // Constant width is what makes a HUD readable as it changes.
  for (const fraction of [0, 0.13, 0.5, 0.77, 1]) {
    assert.equal(meterBar(fraction, { cells: 12 }).length, 14);
  }
});

test('meterBar clamps rather than throwing on bad input', () => {
  // A HUD is the wrong place to fail loud: crashing the readout hides the state
  // it exists to show. Every one of these must still render a bar.
  for (const bad of [null, undefined, Number.NaN, -5, 42, Infinity]) {
    const rendered = meterBar(bad, { cells: 6 });
    assert.equal(rendered.length, 8, `bad input ${bad} produced ${rendered}`);
    assert.ok(/^\[[#.]*\]$/.test(rendered));
  }
  assert.equal(meterBar(-5, { cells: 6 }), '[......]', 'below range reads empty');
  assert.equal(meterBar(42, { cells: 6 }), '[######]', 'above range reads full');
});

// --- roundStatusRows -------------------------------------------------------

function buildRound({ withClock = true, withThen = false } = {}) {
  const objective = new ObjectiveTracker({
    shape: OBJECTIVE_SHAPES.DEPLETE_ALL,
    target: 4,
    label: 'targets',
    then: withThen ? { shape: OBJECTIVE_SHAPES.REACH, target: 1, label: 'exit' } : null,
  });
  const health = new ResourcePool({ id: 'health', initial: 100, max: 100 });
  const director = new RoundDirector({
    objective,
    clock: withClock ? new RoundClock({ limitSeconds: 90 }) : null,
    resources: [health],
  });
  return { director, objective, health };
}

test('the rows that can end the round come first', () => {
  // The ordering IS the convention: state, then every counter that can end it,
  // then the clock, then progress. A hidden health pool is a surprise death.
  const { director } = buildRound();
  director.start();
  const rows = roundStatusRows({ snapshot: director.snapshot() });
  const labels = rows.map(([label]) => label);

  assert.equal(labels[0], 'ROUND', 'the round state leads');
  assert.ok(labels.indexOf('health') < labels.indexOf('time'), 'pools before the clock');
  assert.ok(labels.indexOf('time') < labels.indexOf('targets'), 'clock before progress');
});

test('every pool that can end the round gets a row with a bar', () => {
  const objective = new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.QUOTA, target: 3 });
  const health = new ResourcePool({ id: 'health', initial: 70, max: 100 });
  const lives = new ResourcePool({ id: 'lives', initial: 2, max: 3 });
  const director = new RoundDirector({ objective, resources: [health, lives] });
  director.start();

  const rows = roundStatusRows({ snapshot: director.snapshot() });
  assert.match(labelOf(rows, 'health'), /^\[#+\.+\] 70\/100$/);
  assert.match(labelOf(rows, 'lives'), /^\[#+\.+\] 2\/3$/);
});

test('an unbounded pool shows its number without a meaningless bar', () => {
  // Score and currency have no max, so a fraction would be a lie.
  const objective = new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.QUOTA, target: 2 });
  const cash = new ResourcePool({ id: 'cash', initial: 250 });
  const director = new RoundDirector({ objective, resources: [cash] });
  director.start();

  assert.equal(labelOf(roundStatusRows({ snapshot: director.snapshot() }), 'cash'), '250');
});

test('a round with no clock gets no clock row', () => {
  // Rather than a row reading "null", which is worse than no row.
  const { director } = buildRound({ withClock: false });
  director.start();
  const labels = roundStatusRows({ snapshot: director.snapshot() }).map(([l]) => l);
  assert.ok(!labels.includes('time'), `unexpected clock row in ${labels.join(', ')}`);
});

test('the outcome reason reaches the screen', () => {
  // Acceptance needs an observable reason for the round outcome.
  const { director, health } = buildRound();
  director.start();
  health.lose(100);
  director.step(1 / 60);

  const rows = roundStatusRows({ snapshot: director.snapshot() });
  assert.equal(labelOf(rows, 'because'), 'resourceDepleted');
});

test('a latched banner replaces the state and suppresses the reason row', () => {
  // The banner already carries the reason, so repeating it is noise.
  const { director, health } = buildRound();
  director.start();
  health.lose(100);
  director.step(1 / 60);

  const rows = roundStatusRows({
    snapshot: director.snapshot(),
    banner: 'YOU LOSE  (resourceDepleted)',
  });
  assert.equal(rows[0][1], 'YOU LOSE  (resourceDepleted)');
  assert.equal(labelOf(rows, 'because'), undefined);
});

test('a follow-up clause is reported as locked, then open, then done', () => {
  // The row players miss without a prompt: the exit went live and nothing said so.
  const { director, objective } = buildRound({ withThen: true });
  director.start();

  assert.equal(labelOf(roundStatusRows({ snapshot: director.snapshot() }), 'exit'), 'locked');

  objective.advance(4);
  assert.equal(labelOf(roundStatusRows({ snapshot: director.snapshot() }), 'exit'), 'OPEN');

  objective.noteReached();
  assert.equal(labelOf(roundStatusRows({ snapshot: director.snapshot() }), 'exit'), 'done');
});

test('pool labels can be renamed for the player without renaming the pool', () => {
  // Rules want `id: 'health'`; a HUD may want "hull" or "stocks".
  const { director } = buildRound();
  director.start();
  const rows = roundStatusRows({
    snapshot: director.snapshot(),
    label: 'SORTIE',
    poolLabels: { health: 'hull' },
  });
  assert.equal(rows[0][0], 'SORTIE');
  assert.ok(labelOf(rows, 'hull'), 'the renamed pool is present');
  assert.equal(labelOf(rows, 'health'), undefined, 'the raw id is not');
});

test('a survival clock reads as time remaining, not elapsed', () => {
  const objective = new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.SURVIVE, label: 'hold out' });
  const director = new RoundDirector({
    objective,
    clock: new RoundClock({ limitSeconds: 60, expiryMeaning: CLOCK_EXPIRY_MEANINGS.WIN }),
  });
  director.start();
  for (let i = 0; i < 60; i += 1) director.step(1 / 60);

  const time = labelOf(roundStatusRows({ snapshot: director.snapshot() }), 'time');
  assert.match(time, /59s \/ 60s$/, `expected remaining seconds, got ${time}`);
});

test('the rows are shaped for makeHudWriter, and it validates its input', () => {
  const { director } = buildRound();
  director.start();
  for (const row of roundStatusRows({ snapshot: director.snapshot() })) {
    assert.equal(row.length, 2, 'every row is [label, value]');
    assert.equal(typeof row[0], 'string');
    assert.equal(typeof row[1], 'string');
  }
  assert.throws(() => roundStatusRows({}), /snapshot is required/);
});
