// Headless tests for assets/interaction/FeedToggleController.js.
// The load-bearing property is that a press during the cooldown is never lost.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FeedToggleController,
  TOGGLE_RESULTS,
} from '../../../assets/interaction/FeedToggleController.js';
import { Clock } from '../../../assets/math/TimeUtils.js';

function manualClock(nowMs = 0) {
  return new Clock({ manual: true, nowMs });
}

test('select switches the active feed and rejects out-of-range indices', () => {
  const feeds = new FeedToggleController({ feedCount: 4, clock: manualClock() });

  const moved = feeds.select(2);
  assert.equal(moved.result, TOGGLE_RESULTS.APPLIED);
  assert.equal(moved.feedIndex, 2);
  assert.equal(moved.changed, true);

  const same = feeds.select(2);
  assert.equal(same.result, TOGGLE_RESULTS.APPLIED);
  assert.equal(same.changed, false, 'reselecting the same feed is not a change');

  for (const bad of [-1, 4, 99, Number.NaN]) {
    const rejected = feeds.select(bad);
    assert.equal(rejected.result, TOGGLE_RESULTS.IGNORED, `index ${bad} must be refused`);
    assert.equal(feeds.feedIndex, 2, 'a refused select cannot move the feed');
  }

  // A fractional index snaps down to a whole feed rather than being refused,
  // matching how the constructor and cycle() normalize indices.
  assert.equal(feeds.select(1.5).feedIndex, 1);
});

test('cycle wraps or clamps according to the wrap knob', () => {
  const wrapping = new FeedToggleController({ feedCount: 3, wrap: true, clock: manualClock() });
  assert.equal(wrapping.nextFeed().feedIndex, 1);
  assert.equal(wrapping.nextFeed().feedIndex, 2);
  assert.equal(wrapping.nextFeed().feedIndex, 0, 'wraps past the end');
  assert.equal(wrapping.previousFeed().feedIndex, 2, 'wraps past the start');

  const clamping = new FeedToggleController({ feedCount: 3, wrap: false, clock: manualClock() });
  assert.equal(clamping.previousFeed().feedIndex, 0, 'clamped at the start');
  clamping.select(2);
  assert.equal(clamping.nextFeed().feedIndex, 2, 'clamped at the end');
});

test('the toggle flips immediately when off cooldown', () => {
  const clock = manualClock(1000);
  const feeds = new FeedToggleController({ feedCount: 2, toggleCooldownMs: 250, clock });

  assert.equal(feeds.toggleOn, false);
  const first = feeds.toggle();
  assert.equal(first.result, TOGGLE_RESULTS.APPLIED);
  assert.equal(first.toggleOn, true);
  assert.equal(feeds.toggleCount, 1);
});

test('a press during the cooldown is queued and fires when the cooldown expires', () => {
  const clock = manualClock(0);
  const feeds = new FeedToggleController({ feedCount: 2, toggleCooldownMs: 250, clock });

  feeds.toggle(); // applied, door now open
  assert.equal(feeds.toggleOn, true);

  clock.advanceMs(100);
  const queued = feeds.toggle(); // player slams the button mid-cooldown
  assert.equal(queued.result, TOGGLE_RESULTS.QUEUED, 'input must not be dropped');
  assert.equal(feeds.toggleOn, true, 'not applied yet');
  assert.equal(feeds.pendingToggle, true);

  // Still cooling down: step does nothing yet.
  clock.advanceMs(100); // t=200, cooldown ends at 250
  assert.equal(feeds.step(), false);
  assert.equal(feeds.toggleOn, true);

  clock.advanceMs(60); // t=260, past the cooldown
  assert.equal(feeds.step(), true, 'queued press fires');
  assert.equal(feeds.toggleOn, false, 'door closed by the queued press');
  assert.equal(feeds.pendingToggle, false);
  assert.equal(feeds.step(), false, 'queue is empty afterwards');
});

test('no press is ever lost across a long mashing sequence', () => {
  const clock = manualClock(0);
  const feeds = new FeedToggleController({ feedCount: 2, toggleCooldownMs: 100, clock });

  let presses = 0;
  // Mash every 10ms for 2 seconds, stepping the controller each tick.
  for (let t = 0; t < 200; t += 1) {
    const result = feeds.toggle();
    presses += 1;
    assert.notEqual(result.result, TOGGLE_RESULTS.IGNORED, 'powered presses are never ignored');
    clock.advanceMs(10);
    feeds.step();
  }
  // Every press was either applied or folded into a queued press; the counters
  // must account for all of them with nothing silently vanishing.
  assert.equal(
    feeds.toggleCount + feeds.droppedToggleCount + (feeds.pendingToggle ? 1 : 0),
    presses,
    'applied + folded + still-pending must equal total presses'
  );
  assert.ok(feeds.toggleCount > 1, 'the door actually cycled');
});

test('cooldown remaining counts down and canToggle tracks it', () => {
  const clock = manualClock(0);
  const feeds = new FeedToggleController({ feedCount: 2, toggleCooldownMs: 200, clock });

  assert.equal(feeds.canToggle(), true, 'ready before the first press');
  feeds.toggle();
  assert.equal(feeds.toggleCooldownRemainingMs(), 200);
  assert.equal(feeds.canToggle(), false);

  clock.advanceMs(150);
  assert.equal(feeds.toggleCooldownRemainingMs(), 50);

  clock.advanceMs(50);
  assert.equal(feeds.toggleCooldownRemainingMs(), 0);
  assert.equal(feeds.canToggle(), true, 'ready exactly at the boundary');
});

test('a zero cooldown applies every press immediately', () => {
  const clock = manualClock(0);
  const feeds = new FeedToggleController({ feedCount: 2, toggleCooldownMs: 0, clock });
  for (let i = 0; i < 5; i += 1) {
    assert.equal(feeds.toggle().result, TOGGLE_RESULTS.APPLIED);
  }
  assert.equal(feeds.toggleCount, 5);
  assert.equal(feeds.toggleOn, true, 'five flips from false ends on true');
});

test('cutting power forces the toggle off, drops the queue and blocks input', () => {
  const clock = manualClock(0);
  const feeds = new FeedToggleController({ feedCount: 3, toggleCooldownMs: 100, clock });

  feeds.toggle(); // on
  feeds.toggle(); // queued behind the cooldown
  assert.equal(feeds.pendingToggle, true);

  feeds.setPowered(false);
  assert.equal(feeds.toggleOn, false, 'an unpowered door cannot stay open');
  assert.equal(feeds.pendingToggle, false, 'queued press dies with the power');

  assert.equal(feeds.toggle().result, TOGGLE_RESULTS.IGNORED);
  assert.equal(feeds.select(1).result, TOGGLE_RESULTS.IGNORED, 'no feed switching either');
  assert.equal(feeds.step(), false);

  feeds.setPowered(true);
  assert.equal(feeds.select(1).result, TOGGLE_RESULTS.APPLIED, 'usable again once powered');
});

test('snapshot reports the full observable state', () => {
  const feeds = new FeedToggleController({ feedCount: 4, clock: manualClock() });
  feeds.select(3);
  const snapshot = feeds.snapshot();
  assert.equal(snapshot.feedIndex, 3);
  assert.equal(snapshot.feedCount, 4);
  assert.equal(snapshot.toggleOn, false);
  assert.equal(snapshot.powered, true);
  assert.equal(snapshot.pendingToggle, false);

  feeds.reset();
  assert.equal(feeds.snapshot().feedIndex, 0);
});

test('construction validates its inputs', () => {
  assert.throws(() => new FeedToggleController({ feedCount: 0 }), /feedCount/);
  assert.throws(() => new FeedToggleController({ feedCount: 2, toggleCooldownMs: -5 }), /toggleCooldownMs/);
});
