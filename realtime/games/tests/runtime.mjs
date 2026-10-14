import assert from 'node:assert/strict';
import {createDemoRuntime} from '../host/demo-runtime.js';

const bindings = {}, held = new Set(), pressed = new Set(), calls = [];
const input = {
  bind(map) { Object.assign(bindings, map); },
  clear() { held.clear(); pressed.clear(); },
  isDown(action) { return held.has(action); },
  consumePress(action) { const value = pressed.has(action); pressed.delete(action); return value; },
};
class Game {
  constructor(snapshot) { this.s = structuredClone(snapshot); }
  step(controls) {
    calls.push(controls);
    this.s.frame++;
    this.s.time += 1 / 24;
    this.s.events = this.s.frame === 11 ? [{kind: 'shot'}] : [];
  }
  snapshot() { return structuredClone(this.s); }
}
const initial = {frame: 10, time: 10 / 24, health: 100, events: []};
let described;
const runtime = createDemoRuntime({input}, {
  Game, FPS: 24,
  config: {id:'test', title:'Test', objective:'Test', instruction:'Test', statLabels:[], stats:()=>[], extraActions:[{action:'reload',codes:['KeyR']}]},
  createScene: () => ({renderer: {domElement: {}, setSize() {}, dispose() {}}, render() {}}),
  dynamicPrompt(states) { described = states; return states.flatMap(s => s.events).map(e => e.kind).join(' '); },
}, initial);
runtime.reset();
assert.equal(bindings.KeyR, 'reload');
pressed.add('jump');
runtime.update(1 / 60);
assert.ok(pressed.has('jump'), 'edge input survives until the next 24 Hz tick');
for (let i = 1; i < 60; i++) runtime.update(1 / 60);
assert.equal(calls.length, 24);
assert.equal(calls.filter(c => c.jump).length, 1);
const state = runtime.read();
assert.equal(state.frame, 34);
assert.equal(state.events[0].prompt, 'shot', 'events between captures are retained');
assert.equal(described.length, 24);
assert.deepEqual(runtime.read().events, [], 'captured events do not leak to the next frame');
runtime.handleUiAction('p');
runtime.update(1);
assert.equal(runtime.read().frame, 34);
runtime.handleUiAction('p');
pressed.add('reload');
runtime.update(1 / 24);
assert.equal(calls.at(-1).reload, true);
assert.equal(runtime.read().frame, 35, 'reload never restarts');
runtime.reset();
assert.equal(runtime.read().frame, initial.frame);
assert.equal(runtime.read().time, initial.time);
assert.deepEqual(initial.events, []);
console.log('PASS: 60-to-24 Hz clock, queued edge actions, reload binding, intermediate prompt events, pause and saved-state reset.');
