import test from 'node:test';
import assert from 'node:assert/strict';
import { MouseLookDelta } from '../../../assets/user-interface/PrototypeShell.js';

function emit(target, type, properties = {}) {
  const event = new Event(type);
  Object.assign(event, properties);
  target.dispatchEvent(event);
}

function fixture(options = {}) {
  const document = new EventTarget();
  document.pointerLockElement = null;
  const canvas = new EventTarget();
  canvas.ownerDocument = document;
  canvas.style = { cursor: 'crosshair' };
  let requests = 0;
  canvas.requestPointerLock = () => { requests++; };
  const changes = [];
  const look = new MouseLookDelta(canvas, { onLockChange: locked => changes.push(locked), ...options });
  return {
    document, canvas, look, changes,
    get requests() { return requests; },
    click() { emit(canvas, 'pointerdown'); },
    lock(element = canvas) {
      document.pointerLockElement = element;
      emit(document, 'pointerlockchange');
    },
    move(properties = {}) {
      // A browser mousemove reaches the canvas and then bubbles to document.
      emit(canvas, 'mousemove', properties);
      emit(document, 'mousemove', properties);
    },
  };
}

test('default look ignores the visible pointer and hides it only after capture succeeds', () => {
  const f = fixture();
  f.move({ clientX: 100, clientY: 80, movementX: 100, movementY: 80 });
  f.move({ clientX: 160, clientY: 40, movementX: 60, movementY: -40 });
  assert.deepEqual(f.look.consume(), { x: 0, y: 0 });
  f.click();
  f.click();
  assert.equal(f.requests, 1, 'do not request again while capture is pending');
  assert.equal(f.canvas.style.cursor, 'crosshair');
  f.lock();
  assert.equal(f.canvas.style.cursor, 'none');
  assert.deepEqual(f.changes, [true]);
  f.click();
  assert.equal(f.requests, 1, 'shooting while captured must not request another lock');
});

test('locked relative movement keeps the first delta, inverts Y, and consumes once', () => {
  const f = fixture();
  f.lock();
  f.move({ clientX: 600, clientY: 400, movementX: 12, movementY: -5 });
  assert.deepEqual(f.look.consume(), { x: 12, y: 5 });
  assert.deepEqual(f.look.consume(), { x: 0, y: 0 });
  // The frozen cursor position never limits repeated turns beyond the viewport.
  for (let i = 0; i < 10; i++) {
    f.move({ clientX: 600, clientY: 400, movementX: 900, movementY: 2 });
  }
  assert.deepEqual(f.look.consume(), { x: 9000, y: -20 });
  f.move({ clientX: 10000, clientY: -10000, movementX: NaN, movementY: undefined });
  assert.deepEqual(f.look.consume(), { x: 0, y: 0 });
});

test('release clears queued look and held actions, restores the cursor and allows recapture', () => {
  const input = { fire: false, forward: false };
  const f = fixture({ onLockChange: locked => { if (!locked) Object.assign(input, { fire: false, forward: false }); } });
  f.click();
  f.lock();
  Object.assign(input, { fire: true, forward: true });
  f.move({ movementX: 20, movementY: -10 });
  f.lock(null);
  assert.deepEqual(input, { fire: false, forward: false });
  assert.equal(f.canvas.style.cursor, 'crosshair');
  f.move({ clientX: 1000, clientY: 1000, movementX: 300, movementY: 300 });
  assert.deepEqual(f.look.consume(), { x: 0, y: 0 });
  f.click();
  f.lock();
  assert.deepEqual(f.look.consume(), { x: 0, y: 0 });
  f.move({ movementX: -7, movementY: 4 });
  assert.deepEqual(f.look.consume(), { x: -7, y: -4 });
  assert.equal(f.requests, 2);
});

test('movement captured by another element cannot rotate this view', () => {
  const f = fixture();
  f.lock();
  f.move({ movementX: 50, movementY: 20 });
  f.lock(new EventTarget());
  f.move({ movementX: 100, movementY: 200 });
  assert.deepEqual(f.look.consume(), { x: 0, y: 0 });
  assert.equal(f.canvas.style.cursor, 'crosshair');
  assert.deepEqual(f.changes, [true, false]);
});

test('promise rejection and the browser error event leave the pointer usable and permit retry', async () => {
  const f = fixture();
  f.canvas.requestPointerLock = () => Promise.reject(new Error('capture denied'));
  f.click();
  await Promise.resolve();
  emit(f.document, 'pointerlockerror');
  assert.deepEqual(f.changes, [false], 'one notification for a failed request');
  assert.equal(f.canvas.style.cursor, 'crosshair');
  f.move({ movementX: 50, movementY: 30 });
  assert.deepEqual(f.look.consume(), { x: 0, y: 0 });
  let requests = 0;
  f.canvas.requestPointerLock = () => { requests++; return Promise.resolve(); };
  f.click();
  await Promise.resolve();
  f.lock();
  assert.equal(requests, 1);
  assert.deepEqual(f.changes, [false, true]);
  assert.equal(f.canvas.style.cursor, 'none');
});

test('pointer-lock error events and synchronous failures clear the initiating click', async () => {
  for (const failure of ['event', 'throw', 'unavailable']) {
    let fireHeld = false;
    const f = fixture({ onLockChange: locked => { if (!locked) fireHeld = false; } });
    f.canvas.addEventListener('pointerdown', () => { fireHeld = true; });
    if (failure === 'throw') f.canvas.requestPointerLock = () => { throw new Error('denied'); };
    if (failure === 'unavailable') delete f.canvas.requestPointerLock;
    f.click();
    if (failure === 'event') emit(f.document, 'pointerlockerror');
    await Promise.resolve();
    assert.equal(fireHeld, false, failure);
    assert.equal(f.canvas.style.cursor, 'crosshair');
    f.move({ clientX: 10, clientY: 10 });
    f.move({ clientX: 40, clientY: 50 });
    assert.deepEqual(f.look.consume(), { x: 0, y: 0 });
  }
});

test('explicit free-cursor mode preserves pixel deltas and never captures or hides the cursor', () => {
  const f = fixture({ pointerLock: false });
  f.click();
  assert.equal(f.requests, 0);
  f.move({ clientX: 100, clientY: 90, movementX: 100, movementY: 90 });
  assert.deepEqual(f.look.consume(), { x: 0, y: 0 }, 'first free move establishes a baseline');
  f.move({ clientX: 112, clientY: 86, movementX: 12, movementY: -4 });
  f.move({ clientX: 115, clientY: 88 });
  assert.deepEqual(f.look.consume(), { x: 15, y: 2 });
  assert.deepEqual(f.look.consume(), { x: 0, y: 0 });
  assert.equal(f.canvas.style.cursor, 'crosshair');
});

test('hideCursor:false preserves the inline cursor style throughout capture', () => {
  const f = fixture({ hideCursor: false });
  f.lock();
  f.move({ movementX: 5, movementY: -2 });
  assert.deepEqual(f.look.consume(), { x: 5, y: 2 });
  assert.equal(f.canvas.style.cursor, 'crosshair');
  f.lock(null);
  assert.equal(f.canvas.style.cursor, 'crosshair');
});
