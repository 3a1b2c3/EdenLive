// Headless behaviour tests for assets/game-feel/*. No DOM, no three import.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CoyoteTime } from '../../../assets/game-feel/CoyoteTime.js';
import { JumpBuffer } from '../../../assets/game-feel/JumpBuffer.js';
import { HitStop } from '../../../assets/game-feel/HitStop.js';
import { Clock } from '../../../assets/math/TimeUtils.js';

function manualClock(nowMs = 0) {
  return new Clock({ manual: true, nowMs });
}

test('CoyoteTime allows a jump for ~0.1s after walking off a ledge', () => {
  const clock = manualClock(1000);
  const coyote = new CoyoteTime({ coyoteMs: 100, clock });

  coyote.noteGrounded(true);
  assert.equal(coyote.allowJump(), true, 'grounded jump must be allowed');

  // Walk off the ledge.
  coyote.noteGrounded(false);
  assert.equal(coyote.allowJump(), true, 'jump allowed on the frame we leave ground');

  clock.advanceMs(99);
  coyote.noteGrounded(false);
  assert.equal(coyote.allowJump(), true, 'still inside the 100ms window');

  clock.advanceMs(2); // 101ms since leaving ground
  coyote.noteGrounded(false);
  assert.equal(coyote.allowJump(), false, 'window has closed');
});

test('CoyoteTime reports remaining grace and closes it exactly at the boundary', () => {
  const clock = manualClock(0);
  const coyote = new CoyoteTime({ coyoteMs: 120, clock });
  coyote.noteGrounded(true);
  assert.equal(coyote.remainingMs(), 120, 'grounded reports a full window');

  coyote.noteGrounded(false);
  clock.advanceMs(50);
  assert.equal(coyote.remainingMs(), 70);

  clock.advanceMs(70); // exactly at the boundary
  assert.equal(coyote.allowJump(), true, 'boundary is inclusive');
  assert.equal(coyote.remainingMs(), 0);

  clock.advanceMs(1);
  assert.equal(coyote.allowJump(), false);
});

test('CoyoteTime grants only one jump per airborne period', () => {
  const clock = manualClock(0);
  const coyote = new CoyoteTime({ coyoteMs: 100, clock });

  coyote.noteGrounded(true);
  coyote.noteGrounded(false);
  assert.equal(coyote.consumeJump(), true, 'first jump succeeds');
  assert.equal(coyote.consumeJump(), false, 'no double jump from the same window');
  assert.equal(coyote.allowJump(), false);

  // Landing re-arms.
  coyote.noteGrounded(true);
  assert.equal(coyote.allowJump(), true);
  assert.equal(coyote.consumeJump(), true);
});

test('CoyoteTime does not arm a window for a character already airborne', () => {
  const clock = manualClock(0);
  const coyote = new CoyoteTime({ coyoteMs: 100, clock });

  // Never grounded: falling from spawn must not grant a free mid-air jump.
  coyote.noteGrounded(false);
  assert.equal(coyote.allowJump(), false);
  assert.equal(coyote.consumeJump(), false);
});

test('CoyoteTime rejects a negative window', () => {
  assert.throws(() => new CoyoteTime({ coyoteMs: -1 }), /coyoteMs/);
});

test('JumpBuffer fires a jump pressed ~0.1s before landing', () => {
  const clock = manualClock(500);
  const buffer = new JumpBuffer({ bufferMs: 100, clock });

  buffer.queueJump(); // pressed while still airborne
  clock.advanceMs(80);
  // Landing happens here.
  assert.equal(buffer.takeBufferedJump(), true, 'buffered press fires on landing');
  assert.equal(buffer.takeBufferedJump(), false, 'press is consumed exactly once');
});

test('JumpBuffer drops a press that is older than the window', () => {
  const clock = manualClock(0);
  const buffer = new JumpBuffer({ bufferMs: 100, clock });

  buffer.queueJump();
  clock.advanceMs(101);
  assert.equal(buffer.hasBufferedJump(), false);
  assert.equal(buffer.takeBufferedJump(), false, 'stale press must not fire');

  // Boundary case: exactly at the window edge still counts.
  const edge = new JumpBuffer({ bufferMs: 100, clock });
  edge.queueJump();
  clock.advanceMs(100);
  assert.equal(edge.takeBufferedJump(), true);
});

test('JumpBuffer keeps the newest press and reports remaining time', () => {
  const clock = manualClock(0);
  const buffer = new JumpBuffer({ bufferMs: 100, clock });

  buffer.queueJump();
  clock.advanceMs(90);
  buffer.queueJump(); // re-press refreshes the window
  assert.equal(buffer.remainingMs(), 100);

  clock.advanceMs(60);
  assert.equal(buffer.remainingMs(), 40);
  assert.equal(buffer.takeBufferedJump(), true, 'refreshed press is still live');
});

test('JumpBuffer clear discards a pending press', () => {
  const clock = manualClock(0);
  const buffer = new JumpBuffer({ bufferMs: 100, clock });
  buffer.queueJump();
  buffer.clear();
  assert.equal(buffer.takeBufferedJump(), false);
});

test('CoyoteTime and JumpBuffer together cover a late and an early press', () => {
  const clock = manualClock(0);
  const coyote = new CoyoteTime({ coyoteMs: 100, clock });
  const buffer = new JumpBuffer({ bufferMs: 100, clock });

  // Late press: run off a ledge, press 60ms later.
  coyote.noteGrounded(true);
  coyote.noteGrounded(false);
  clock.advanceMs(60);
  buffer.queueJump();
  const lateJump = coyote.allowJump() && buffer.takeBufferedJump();
  assert.equal(lateJump, true, 'late press still jumps');

  // Early press: press while falling, land 50ms later.
  clock.advanceMs(400);
  coyote.noteGrounded(false);
  buffer.queueJump();
  clock.advanceMs(50);
  coyote.noteGrounded(true); // touchdown re-arms the jump
  const earlyJump = coyote.allowJump() && buffer.takeBufferedJump();
  assert.equal(earlyJump, true, 'early press fires on landing');
});

test('HitStop freezes gameplay time for 50-80ms and never blocks the loop', () => {
  const stop = new HitStop({ defaultSeconds: 0.065, frozenTimeScale: 0 });
  assert.equal(stop.timeScale(), 1, 'idle runs at full speed');

  stop.trigger();
  assert.equal(stop.isFrozen(), true);
  assert.equal(stop.timeScale(), 0, 'gameplay time is held');

  // The rAF loop keeps calling step with REAL deltas; the freeze drains.
  let frames = 0;
  while (stop.isFrozen() && frames < 100) {
    stop.step(1 / 60);
    frames += 1;
  }
  assert.equal(stop.isFrozen(), false, 'freeze ends on its own');
  assert.equal(stop.timeScale(), 1);
  assert.ok(frames >= 3 && frames <= 6, `65ms is ~4 frames at 60fps, got ${frames}`);
});

test('HitStop overlapping hits take the longer window instead of summing', () => {
  const stop = new HitStop({ defaultSeconds: 0.05 });
  stop.trigger(0.08);
  stop.step(0.02); // 0.06 left
  stop.trigger(0.05); // shorter than what remains: must not shorten or extend
  assert.ok(Math.abs(stop.remainingSeconds - 0.06) < 1e-9, 'shorter hit does not extend');

  stop.trigger(0.2);
  assert.ok(Math.abs(stop.remainingSeconds - 0.2) < 1e-9, 'longer hit extends');
});

test('HitStop scales delta and clamps a runaway request', () => {
  const stop = new HitStop({ frozenTimeScale: 0.1, maxSeconds: 0.5 });
  stop.trigger(10);
  assert.equal(stop.remainingSeconds, 0.5, 'request clamped to maxSeconds');
  assert.ok(Math.abs(stop.scaleDelta(1 / 60) - (1 / 60) * 0.1) < 1e-12);

  stop.clear();
  assert.equal(stop.scaleDelta(1 / 60), 1 / 60, 'cleared stop passes delta through');
});

test('HitStop rejects an out-of-range time scale', () => {
  assert.throws(() => new HitStop({ frozenTimeScale: 1.5 }), /frozenTimeScale/);
  assert.throws(() => new HitStop({ defaultSeconds: -1 }), /defaultSeconds/);
});
