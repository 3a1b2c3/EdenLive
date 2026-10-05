import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_UI_THEME, resolveUIConfig } from '../../../assets/user-interface/GameUiFactory.js';
import { resolveAdaptConfig } from '../../../assets/user-interface/GameUiAdapter.js';

test('UI composition omits unsupported capabilities and permits independent repeated views', () => {
  assert.deepEqual(resolveUIConfig().components, []);
  const input = { components: [
    { id: 'turns', type: 'metric', label: 'Turns' },
    { id: 'phase', type: 'metric', label: 'Phase' },
    { id: 'custom-view', type: 'slot', dock: 'bottom-right' },
    { id: 'chapter', type: 'banner' },
    { id: 'seals', type: 'tracker', label: 'Seals', dock: 'top-center', count: 3 },
    { id: 'stars', type: 'tracker' }
  ], theme: { accent: '#ee88dd' } };
  const output = resolveUIConfig(input);
  input.components[0].label = 'Changed';
  assert.equal(output.components[0].label, 'Turns');
  assert.equal(output.theme.accent, '#ee88dd');
  assert.equal(output.theme.panel, DEFAULT_UI_THEME.panel);
  assert.equal(output.components[3].type, 'banner');
  assert.equal(output.components[3].dock, 'center');
  assert.equal(output.components[4].count, 3);
  assert.equal(output.components[4].dock, 'top-center');
  assert.equal(output.components[5].count, 2);
  assert.equal(Object.hasOwn(output.components[0], 'count'), false);
  assert(Object.isFrozen(output.components[0].buttons));
  assert.throws(() => { output.theme.accent = 'red'; }, TypeError);
});

test('malformed views fail before mounting or generating files', () => {
  for (const config of [
    { components: [{ type: 'metric' }] },
    { components: [{ id: 'unknown', type: 'vehicle' }] },
    { components: [{ id: 'same', type: 'metric' }, { id: 'same', type: 'panel' }] },
    { components: [{ id: 'counter', type: 'meter', buttons: [] }] },
    { theme: { health: 'green' } },
    { components: [{ id: 'actions', type: 'actions', buttons: [{ id: 'go', label: 'Go' }, { id: 'go', label: 'Again' }] }] },
    { components: [{ id: 'meter', type: 'meter', variant: 'success' }] },
    { components: [{ id: 'result', type: 'dialog', variant: 'unknown' }] },
    { components: [{ id: 'result', type: 'dialog', buttons: [{ id: 'again', label: 'Again', kind: 'tertiary' }] }] },
    { components: [{ id: 'chapter', type: 'banner', count: 3 }] },
    { components: [{ id: 'seals', type: 'tracker', count: 0 }] },
    { components: [{ id: 'seals', type: 'tracker', count: 13 }] },
    { components: [{ id: 'seals', type: 'tracker', dock: 'middle' }] }
  ]) assert.throws(() => resolveUIConfig(config), TypeError);
  assert.throws(() => resolveAdaptConfig({ roots: [], roles: {} }), TypeError);
  assert.throws(() => resolveAdaptConfig({ roots: ['#ui'], roles: { vehicle: ['#speed'] } }), TypeError);
  const config = resolveAdaptConfig({ roots: ['#ui'], roles: { slot: ['#custom'], banner: ['#title'], tracker: ['#marks'] } });
  assert.deepEqual(config.roles.slot, ['#custom']);
  assert.deepEqual(config.roles.banner, ['#title']);
});

test('result cards resolve state variants and button hierarchy without changing old defaults', () => {
  const output = resolveUIConfig({ components: [
    { id: 'result', type: 'dialog', label: 'Round result', variant: 'failure', buttons: [
      { id: 'again', label: 'Play again' }, { id: 'close', label: 'Close', kind: 'secondary' }
    ]},
    { id: 'health', type: 'meter', label: 'Health' }
  ]});
  assert.equal(output.components[0].variant, 'failure');
  assert.deepEqual(output.components[0].buttons.map(({ id, label, kind }) => ({ id, label, kind })), [
    { id: 'again', label: 'Play again', kind: 'primary' },
    { id: 'close', label: 'Close', kind: 'secondary' }
  ]);
  assert.equal(Object.hasOwn(output.components[1], 'variant'), false);
});
