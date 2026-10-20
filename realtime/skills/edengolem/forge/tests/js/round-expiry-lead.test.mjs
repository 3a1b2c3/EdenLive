// Headless tests for RoundDirector's `expiryLead`: a lead-at-expiry brief settles
// at the whistle by comparing two pools instead of an unconditional timeout loss.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ResourcePool,
} from '../../../assets/gameplay/ResourcePool.js';
import {
  RoundClock,
  CLOCK_EXPIRY_MEANINGS,
} from '../../../assets/gameplay/RoundClock.js';
import {
  ObjectiveTracker,
  OBJECTIVE_SHAPES,
} from '../../../assets/gameplay/ObjectiveTracker.js';
import {
  RoundDirector,
  ROUND_STATES,
} from '../../../assets/gameplay/RoundDirector.js';

const FRAME = 1 / 60;

function buildLeadRound(playerHp, cpuHp) {
  const objective = new ObjectiveTracker({ shape: OBJECTIVE_SHAPES.DEPLETE_ALL, target: 100 });
  const player = new ResourcePool({ id: 'playerHealth', initial: playerHp, max: 100 });
  const cpu = new ResourcePool({ id: 'cpuHealth', initial: cpuHp, max: 100 });
  const director = new RoundDirector({
    objective,
    clock: new RoundClock({ limitSeconds: 30, expiryMeaning: CLOCK_EXPIRY_MEANINGS.LOSE }),
    resources: [player, cpu],
    expiryLead: { own: 'playerHealth', opponent: 'cpuHealth' },
  });
  return { director };
}

function runToResolution(director) {
  director.start();
  let frames = 0;
  while (!director.isResolved && frames < 31 / FRAME) {
    director.step(FRAME);
    frames += 1;
  }
  return director;
}

test('expiryLead wins when the own pool leads at the whistle', () => {
  const { director } = buildLeadRound(80, 40);
  runToResolution(director);
  assert.equal(director.state, ROUND_STATES.WON);
  assert.equal(director.outcomeReason, 'scoreLead');
});

test('expiryLead loses when the own pool trails at the whistle', () => {
  const { director } = buildLeadRound(40, 80);
  runToResolution(director);
  assert.equal(director.state, ROUND_STATES.LOST);
  assert.equal(director.outcomeReason, 'scoreBehind');
});

test('expiryLead rejects a malformed shape', () => {
  assert.throws(
    () => new RoundDirector({
      clock: new RoundClock({ limitSeconds: 30, expiryMeaning: CLOCK_EXPIRY_MEANINGS.LOSE }),
      expiryLead: { own: 'a' },
    }),
    /expiryLead must be null or \{ own, opponent \}/
  );
});