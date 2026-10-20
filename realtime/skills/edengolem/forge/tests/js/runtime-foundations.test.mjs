import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameStepper } from '../../../assets/math/TimeUtils.js';
import { KeyState } from '../../../assets/user-interface/PrototypeShell.js';
// game-loop.mjs uses the page's absolute /assets/ specifier, so Node needs the resolver
// hook registered before it is loaded; a dynamic import defers loading until then.
import '../../_shared/register_assets.mjs';

const { createGameLoop } = await import('../../../assets/template/game-loop.mjs');

test('slow frames are accumulated and recovered without silent time loss', () => {
  const clock = new FrameStepper({ stepSeconds: 0.01, maxSteps: 5, maxBacklogSeconds: 0.5 });
  let integrated = 0;
  const update = dt => { integrated += dt; };
  clock.advance(0.2, update);
  assert.ok(Math.abs(clock.read().backlogSeconds - 0.15) < 1e-9);
  for (let i = 0; i < 5; i++) clock.advance(0.01, update);
  assert.ok(Math.abs(integrated - 0.25) < 1e-9);
  assert.equal(clock.read().droppedSeconds, 0);
  assert.ok(Math.abs(clock.read().activeSeconds - integrated) < 1e-9);
});

test('overload, pause and terminal transitions remain bounded and accounted', () => {
  const clock = new FrameStepper({ stepSeconds: 0.01, maxSteps: 2, maxBacklogSeconds: 0.1 });
  let calls = 0;
  clock.advance(2, () => { calls++; });
  assert.equal(calls, 2);
  assert.equal(clock.frame.rawDt, 2);
  assert.ok(Math.abs(clock.read().droppedSeconds - 1.9) < 1e-9);
  clock.advance(10, () => assert.fail('paused'), { active: false });
  assert.equal(clock.read().pausedSeconds, 10);
  assert.equal(clock.read().backlogSeconds, 0);
  clock.advance(0.08, () => { calls++; return false; });
  assert.equal(calls, 3);
  const s = clock.read();
  assert.ok(Math.abs(s.activeSeconds - s.simulatedSeconds - s.backlogSeconds - s.droppedSeconds) < 1e-9);
  clock.reset();
  assert.equal(clock.read().wallSeconds, 0);
});

test('discrete play has rendering diagnostics without forced time simulation', () => {
  const clock = new FrameStepper({ mode: 'discrete' });
  clock.advance(3, () => assert.fail('turn based game must not auto advance'));
  assert.equal(clock.read().simulatedSeconds, 0);
  assert.equal(clock.read().discreteSeconds, 3);
  assert.equal(clock.read().activeSeconds, 3);
  assert.equal(clock.read().pausedSeconds, 0);
  assert.equal(clock.frame.rawDt, 3);
  clock.advance(2, () => assert.fail('paused'), { active: false });
  assert.equal(clock.read().activeSeconds, 3);
  assert.equal(clock.read().pausedSeconds, 2);
  assert.equal(clock.read().wallSeconds, 5);
  for (const args of [{maxSteps: 0}, {stepSeconds: 0}, {mode: 'guess'}, {maxBacklogSeconds: -1}]) {
    assert.throws(() => new FrameStepper(args));
  }
  assert.throws(() => clock.advance(NaN, () => {}));
});

const CATCH_UP = { stepSeconds: 0.01, maxSteps: 8, maxBacklogSeconds: 0.25 };

function fakeInput() {
  return { cleared: 0, clear() { this.cleared += 1; } };
}

function fakeGame() {
  return {
    inputs: 0,
    updates: [],
    pos: { x: 0 },
    handleInput() { this.inputs += 1; },
    update(dt) { this.updates.push(dt); },
    read() { return { pos: this.pos }; },
  };
}

test('static mode accounts frames without handling input or simulating time', () => {
  const game = fakeGame();
  const input = fakeInput();
  const loop = createGameLoop(game, { mode: 'static', input });
  assert.deepEqual(loop.tick(1000), { id: 1, rawDt: 0, simDt: 0 });
  const frame = loop.tick(1016);
  assert.equal(frame.id, 2);
  assert.ok(Math.abs(frame.rawDt - 0.016) < 1e-9);
  assert.equal(frame.simDt, 0);
  assert.equal(game.inputs, 0, 'a static scene has no bound actions to consume');
  assert.deepEqual(game.updates, []);
});

test('discrete mode consumes input once per frame and never advances time itself', () => {
  const game = fakeGame();
  const loop = createGameLoop(game, { mode: 'discrete', input: fakeInput() });
  loop.tick(0); loop.tick(500); loop.tick(1000);
  assert.equal(game.inputs, 3);
  assert.deepEqual(game.updates, []);
  const clock = loop.read().clock;
  assert.equal(clock.simulatedSeconds, 0);
  assert.ok(Math.abs(clock.discreteSeconds - 1) < 1e-9);
});

test('fixed mode catches up in substeps while still consuming input once per frame', () => {
  const game = fakeGame();
  const loop = createGameLoop(game, { mode: 'fixed', input: fakeInput(), timing: CATCH_UP });
  loop.tick(0);
  const frame = loop.tick(50);
  assert.equal(game.updates.length, 5, 'one 50ms frame owes five 10ms steps');
  assert.ok(Math.abs(frame.simDt - 0.05) < 1e-9);
  assert.equal(game.inputs, 2, 'substep count must not multiply consumed edges');
});

test('suspend clears pending input and discards the interrupted interval', () => {
  const game = fakeGame();
  const input = fakeInput();
  const loop = createGameLoop(game, { mode: 'fixed', input, timing: CATCH_UP });
  loop.tick(0);
  loop.suspend();
  assert.equal(input.cleared, 1);
  loop.tick(1000);
  assert.deepEqual(game.updates, [], 'a paused or restarted interval is not owed simulation');
  assert.equal(game.inputs, 1, 'the discarded frame consumes nothing');
  assert.equal(input.cleared, 2);
  assert.ok(Math.abs(loop.read().clock.pausedSeconds - 1) < 1e-9);
  loop.tick(1010);
  assert.equal(game.inputs, 2, 'the loop resumes on the next frame');
  assert.equal(game.updates.length, 1);
});

test('a disabled frame clears input without simulating it', () => {
  const game = fakeGame();
  const input = fakeInput();
  const loop = createGameLoop(game, { mode: 'fixed', input, timing: CATCH_UP });
  loop.tick(0);
  loop.tick(50, { active: false });
  assert.equal(input.cleared, 1);
  assert.equal(game.inputs, 1);
  assert.deepEqual(game.updates, []);
  assert.ok(Math.abs(loop.read().clock.pausedSeconds - 0.05) < 1e-9);
});

test('a terminal transition stops substeps, clears input and still accepts restart edges', () => {
  const game = fakeGame();
  const input = fakeInput();
  let alive = true;
  game.update = function update(dt) {
    this.updates.push(dt);
    if (this.updates.length === 2) alive = false;
  };
  const loop = createGameLoop(game, {
    mode: 'fixed', input, isActive: () => alive, timing: CATCH_UP,
  });
  loop.tick(0);
  loop.tick(50);
  assert.equal(game.updates.length, 2, 'remaining owed steps stop at the terminal transition');
  assert.equal(input.cleared, 1);
  loop.tick(60);
  assert.equal(game.updates.length, 2, 'a terminal game is not simulated further');
  assert.equal(game.inputs, 3, 'restart or resume actions still reach the game');
});

test('read returns an independent snapshot whose frame and clock cannot be overridden', () => {
  const game = fakeGame();
  game.pos = { x: 1 };
  const loop = createGameLoop(game, { mode: 'static' });
  loop.tick(0);
  const snapshot = loop.read({ extra: 'observation' });
  assert.equal(snapshot.extra, 'observation');
  assert.equal(snapshot.frame.id, 1);
  assert.equal(snapshot.clock.mode, 'discrete');
  snapshot.pos.x = 99;
  assert.equal(game.pos.x, 1, 'a test read must not be able to mutate game state');
  assert.equal(loop.read({ frame: 'forged', clock: 'forged' }).frame.id, 1);
});

test('non-finite or backwards frame timestamps and unknown modes fail loudly', () => {
  const loop = createGameLoop(fakeGame(), { mode: 'static' });
  loop.tick(100);
  for (const now of [NaN, Infinity, 90]) assert.throws(() => loop.tick(now));
  loop.tick(110);
  assert.throws(() => createGameLoop(fakeGame(), { mode: 'guess' }));
});

function key(target, type, code, repeat = false) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { code, repeat });
  target.dispatchEvent(event);
}

test('short taps latch, held aliases persist, repeat/blur/detach never leave stale input', () => {
  const target = new EventTarget();
  const input = new KeyState({ KeyX: 'commit', KeyD: 'right', ArrowRight: 'right' }).attach(target);
  key(target, 'keydown', 'KeyX'); key(target, 'keyup', 'KeyX');
  assert.equal(input.isDown('commit'), false);
  assert.equal(input.consumePress('commit'), true);
  assert.equal(input.consumePress('commit'), false);
  key(target, 'keydown', 'KeyD'); key(target, 'keydown', 'ArrowRight'); key(target, 'keyup', 'KeyD');
  assert.equal(input.isDown('right'), true);
  key(target, 'keydown', 'ArrowRight', true);
  assert.equal(input.consumePress('right'), true);
  assert.equal(input.consumePress('right'), false);
  target.dispatchEvent(new Event('blur'));
  assert.equal(input.isDown('right'), false);
  key(target, 'keydown', 'KeyX', true);
  assert.equal(input.consumePress('commit'), false);
  input.detach(); key(target, 'keydown', 'KeyX');
  assert.equal(input.consumePress('commit'), false);
});
