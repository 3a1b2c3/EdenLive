// Headless tests for assets/interaction/MenuSelectionController.js.
// Exhaustive over all options: the point of the module is that no input sequence
// leaves the machine stuck or silently does nothing.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MenuSelectionController,
  MENU_SELECTION_STATES,
  MENU_TRANSITIONS,
} from '../../../assets/interaction/MenuSelectionController.js';

test('move walks every option and wraps when wrap is on', () => {
  const menu = new MenuSelectionController({ optionCount: 4, wrap: true });
  const visited = [menu.index];

  for (let i = 0; i < 3; i += 1) {
    const result = menu.moveNext();
    assert.equal(result.transition, MENU_TRANSITIONS.MOVED);
    assert.equal(result.changed, true);
    visited.push(result.index);
  }
  assert.deepEqual(visited, [0, 1, 2, 3], 'every option is reachable in order');

  // Off the end wraps back to the top.
  const wrapped = menu.moveNext();
  assert.equal(wrapped.transition, MENU_TRANSITIONS.MOVED);
  assert.equal(wrapped.index, 0);

  // And backwards off the top wraps to the bottom.
  const wrappedBack = menu.movePrevious();
  assert.equal(wrappedBack.index, 3);
});

test('wrap off blocks at both edges and says so', () => {
  const menu = new MenuSelectionController({ optionCount: 3, wrap: false });

  const atTop = menu.movePrevious();
  assert.equal(atTop.transition, MENU_TRANSITIONS.BLOCKED);
  assert.equal(atTop.changed, false);
  assert.equal(atTop.index, 0, 'blocked move leaves the index alone');

  menu.moveNext();
  menu.moveNext();
  assert.equal(menu.index, 2);
  const atBottom = menu.moveNext();
  assert.equal(atBottom.transition, MENU_TRANSITIONS.BLOCKED);
  assert.equal(atBottom.index, 2);
});

test('disabled options are skipped over, not landed on', () => {
  // Only 0 and 3 are selectable.
  const enabled = new Set([0, 3]);
  const menu = new MenuSelectionController({
    optionCount: 4,
    wrap: false,
    isOptionEnabled: (index) => enabled.has(index),
  });

  assert.equal(menu.index, 0);
  const moved = menu.moveNext();
  assert.equal(moved.transition, MENU_TRANSITIONS.MOVED);
  assert.equal(moved.index, 3, 'jumped past the two disabled rows');

  // Nothing enabled beyond 3 with wrap off.
  assert.equal(menu.moveNext().transition, MENU_TRANSITIONS.BLOCKED);
});

test('a menu opening on a disabled option starts on the first enabled one', () => {
  const menu = new MenuSelectionController({
    optionCount: 5,
    initialIndex: 0,
    isOptionEnabled: (index) => index >= 2,
  });
  assert.equal(menu.index, 2, 'highlight must not open on a disabled row');
});

test('a fully disabled menu terminates instead of looping and cannot commit', () => {
  const menu = new MenuSelectionController({
    optionCount: 4,
    wrap: true,
    isOptionEnabled: () => false,
  });

  assert.equal(menu.hasEnabledOption(), false);
  // With wrap on, a naive scan would spin forever here.
  const moved = menu.move(1);
  assert.equal(moved.changed, false);
  assert.ok(
    moved.transition === MENU_TRANSITIONS.BLOCKED
      || moved.transition === MENU_TRANSITIONS.SKIPPED,
    `unexpected transition ${moved.transition}`
  );

  const committed = menu.commit();
  assert.equal(committed.transition, MENU_TRANSITIONS.REJECTED);
  assert.equal(menu.state, MENU_SELECTION_STATES.BROWSING, 'stays usable');
});

test('commit closes the menu and records the chosen index', () => {
  const menu = new MenuSelectionController({ optionCount: 3 });
  menu.moveNext();

  const result = menu.commit();
  assert.equal(result.transition, MENU_TRANSITIONS.COMMITTED);
  assert.equal(result.committedIndex, 1);
  assert.equal(menu.isClosed(), true);

  // Every input on a closed menu is explicitly IGNORED, never silently applied.
  assert.equal(menu.moveNext().transition, MENU_TRANSITIONS.IGNORED);
  assert.equal(menu.commit().transition, MENU_TRANSITIONS.IGNORED);
  assert.equal(menu.cancel().transition, MENU_TRANSITIONS.IGNORED);
  assert.equal(menu.index, 1, 'ignored input cannot move the highlight');
});

test('cancel closes the menu and reopen always recovers', () => {
  const menu = new MenuSelectionController({ optionCount: 3 });
  const cancelled = menu.cancel();
  assert.equal(cancelled.transition, MENU_TRANSITIONS.CANCELLED);
  assert.equal(menu.state, MENU_SELECTION_STATES.CANCELLED);

  const reopened = menu.reopen();
  assert.equal(reopened.transition, MENU_TRANSITIONS.REOPENED);
  assert.equal(menu.isBrowsing(), true, 'no state is terminal');
  assert.equal(menu.moveNext().transition, MENU_TRANSITIONS.MOVED, 'usable again');
});

test('focus jumps directly and rejects invalid targets', () => {
  const menu = new MenuSelectionController({
    optionCount: 4,
    isOptionEnabled: (index) => index !== 2,
  });

  assert.equal(menu.focus(3).transition, MENU_TRANSITIONS.MOVED);
  assert.equal(menu.index, 3);
  assert.equal(menu.focus(2).transition, MENU_TRANSITIONS.REJECTED, 'disabled row refused');
  assert.equal(menu.focus(9).transition, MENU_TRANSITIONS.BLOCKED, 'out of range refused');
  assert.equal(menu.focus(3).transition, MENU_TRANSITIONS.SKIPPED, 'already there');
  assert.equal(menu.index, 3, 'no rejected jump moved the highlight');
});

test('multi-step moves land on an enabled option and clamp at the edge', () => {
  const menu = new MenuSelectionController({ optionCount: 6, wrap: false });
  const jumped = menu.move(3);
  assert.equal(jumped.index, 3);

  // A move larger than the remaining distance advances as far as it can.
  const clamped = menu.move(10);
  assert.equal(clamped.transition, MENU_TRANSITIONS.MOVED);
  assert.equal(clamped.index, 5, 'stops at the last option');
  assert.equal(menu.move(0).transition, MENU_TRANSITIONS.SKIPPED, 'zero delta is a no-op');
});

test('every transition returns a fully populated result', () => {
  const menu = new MenuSelectionController({ optionCount: 3 });
  for (const result of [menu.moveNext(), menu.focus(0), menu.commit(), menu.reopen()]) {
    assert.ok(Object.values(MENU_TRANSITIONS).includes(result.transition));
    assert.equal(typeof result.changed, 'boolean');
    assert.equal(typeof result.index, 'number');
    assert.ok(Object.values(MENU_SELECTION_STATES).includes(result.state));
  }
});

test('reset returns to the construction state', () => {
  const menu = new MenuSelectionController({ optionCount: 4, initialIndex: 2 });
  menu.moveNext();
  menu.commit();
  menu.reset();
  assert.equal(menu.index, 2);
  assert.equal(menu.state, MENU_SELECTION_STATES.BROWSING);
  assert.equal(menu.committedIndex, null);
});

test('an exhaustive random input walk never leaves the machine stuck', () => {
  // Deterministic pseudo-random sequence over every entry point.
  let seed = 12345;
  const nextInt = (bound) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % bound;
  };

  for (let optionCount = 1; optionCount <= 6; optionCount += 1) {
    for (const wrap of [true, false]) {
      const menu = new MenuSelectionController({
        optionCount,
        wrap,
        // Disable roughly every third row, keeping at least option 0 usable.
        isOptionEnabled: (index) => index === 0 || index % 3 !== 0,
      });

      for (let step = 0; step < 200; step += 1) {
        const action = nextInt(6);
        if (action === 0) menu.moveNext();
        else if (action === 1) menu.movePrevious();
        else if (action === 2) menu.move(nextInt(5) - 2);
        else if (action === 3) menu.focus(nextInt(optionCount + 2) - 1);
        else if (action === 4) menu.commit();
        else menu.cancel();

        // Invariants that must hold after ANY input, in any state.
        assert.ok(
          Number.isInteger(menu.index) && menu.index >= 0 && menu.index < optionCount,
          `index ${menu.index} out of range for ${optionCount} options`
        );
        assert.ok(Object.values(MENU_SELECTION_STATES).includes(menu.state));

        // A closed menu must always be recoverable.
        if (menu.isClosed()) {
          assert.equal(menu.reopen().transition, MENU_TRANSITIONS.REOPENED);
          assert.equal(menu.isBrowsing(), true);
        }
      }
    }
  }
});

test('construction validates its inputs', () => {
  assert.throws(() => new MenuSelectionController({ optionCount: 0 }), /optionCount/);
  assert.throws(() => new MenuSelectionController({ optionCount: 3, isOptionEnabled: 5 }), /isOptionEnabled/);
});
