// Headless tests for assets/actor-motion/character/SupportHeightCommitResolver.js.
//
// The load-bearing test is the ledge walk. Three of the four prototypes that
// hand-rolled this resolver omitted the grounded -> airborne report and got away
// with it only because their floors were flat: the bug was latent, waiting for a
// platform. That case is asserted here so the module cannot regress into it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';

import { SupportHeightCommitResolver } from '../../../assets/actor-motion/character/SupportHeightCommitResolver.js';
import { BaseCharacterMotionController } from '../../../assets/actor-motion/character/BaseCharacterMotionController.js';
import { DEFAULT_WORLD_BASIS as BASIS } from '../../../assets/math/WorldBasis.js';

/** A stub controller that records what the resolver handed it. */
function recordingController() {
  const seen = [];
  return {
    seen,
    commitMovement(intent, resolved) {
      seen.push({
        grounded: resolved.grounded,
        up: BASIS.upComponent(resolved.position),
        correctedUp: BASIS.upComponent(resolved.correctedDelta),
        velocity: resolved.velocity,
      });
      return { grounded: resolved.grounded, position: resolved.position.clone() };
    },
  };
}

function intentAt({ startUp, plannedUp, grounded, right = 0, forward = 0 }) {
  return {
    startPosition: BASIS.fromBasisComponents(right, startUp, forward),
    position: BASIS.fromBasisComponents(right, plannedUp, forward),
    velocity: new Vector3(0, -3, 0),
    grounded,
  };
}

test('a capsule sinking below the floor is snapped up and reported grounded', () => {
  const resolver = new SupportHeightCommitResolver({ floorUp: 0 });
  const controller = recordingController();

  resolver.commit(controller, intentAt({ startUp: 0.4, plannedUp: -0.6, grounded: false }));

  const [call] = controller.seen;
  assert.equal(call.grounded, true, 'landing must be reported');
  assert.ok(Math.abs(call.up) < 1e-9, `snapped to the floor, got ${call.up}`);
});

test('a capsule above the floor is left alone and stays airborne', () => {
  const resolver = new SupportHeightCommitResolver({ floorUp: 0 });
  const controller = recordingController();

  resolver.commit(controller, intentAt({ startUp: 6, plannedUp: 5, grounded: false }));

  const [call] = controller.seen;
  assert.equal(call.grounded, false);
  assert.ok(Math.abs(call.up - 5) < 1e-9, 'a falling capsule is not teleported');
});

test('walking off a ledge is reported as leaving the ground', () => {
  // THE regression test. A resolver that only clamps upward leaves `grounded`
  // true here, and BaseCharacterMotionController only applies gravity to a
  // character it already believes is airborne -- so the capsule floats off the
  // edge at platform height instead of falling.
  const platformTop = 3;
  const resolver = new SupportHeightCommitResolver({
    floorUp: 0,
    // On the platform for right < 5, open air beyond it.
    supportHeightAt: (position) =>
      BASIS.toBasisComponents(position).right < 5 ? platformTop : 0,
  });
  const controller = recordingController();

  // Standing on the platform, then stepping past its edge at the same height.
  resolver.commit(
    controller,
    intentAt({ startUp: platformTop, plannedUp: platformTop, grounded: true, right: 6 })
  );

  const [call] = controller.seen;
  assert.equal(call.grounded, false, 'stepping off the edge must report airborne');
  assert.equal(resolver.lastLeftLedge, true);
  assert.ok(
    Math.abs(call.up - platformTop) < 1e-9,
    'the capsule is not snapped down to the floor on the frame it leaves'
  );
});

test('the ledge report actually makes gravity resume in the real controller', () => {
  // The stub above proves the flag; this proves the flag matters. Same walk, run
  // through BaseCharacterMotionController, with and without the ledge report.
  const platformTop = 3;
  const supportHeightAt = (position) =>
    BASIS.toBasisComponents(position).right < 5 ? platformTop : 0;

  function fall({ reportLedge }) {
    const controller = new BaseCharacterMotionController({ gravity: 20 });
    controller.setState({
      position: BASIS.fromBasisComponents(4.5, platformTop, 0),
      grounded: true,
    });

    for (let step = 0; step < 30; step += 1) {
      // Drive the controller the way a prototype does: prepare a move, then
      // resolve it. Push steadily right so the capsule leaves the platform.
      const state = controller._prepareLocomotion({
        moveDirection: BASIS.fromBasisComponents(1, 0, 0),
        deltaSeconds: 1 / 60,
      });
      const support = supportHeightAt(state.position);
      const position = state.position.clone();
      let grounded = state.grounded;
      if (BASIS.upComponent(position) <= support) {
        BASIS.setHeight(position, support);
        grounded = true;
      } else if (grounded && reportLedge) {
        grounded = false;
      }
      controller.commitMovement(state, {
        position,
        velocity: state.velocity,
        correctedDelta: position.clone().sub(state.startPosition),
        grounded,
      });
    }
    return BASIS.upComponent(controller.position);
  }

  const withReport = fall({ reportLedge: true });
  const withoutReport = fall({ reportLedge: false });

  assert.ok(
    withReport < platformTop - 0.5,
    `with the ledge report the capsule falls, ended at ${withReport}`
  );
  assert.ok(
    Math.abs(withoutReport - platformTop) < 1e-6,
    `without it the capsule floats at platform height, ended at ${withoutReport}`
  );
});

test('a support above where the frame started is ignored by the caller predicate', () => {
  // The resolver passes the start height through so a caller can reject surfaces
  // it should not snap up to; a box top higher than the start is a wall, and
  // snapping to it teleports the character through the side of the box.
  const seenReferences = [];
  const resolver = new SupportHeightCommitResolver({
    floorUp: 0,
    supportHeightAt: (position, referenceUp) => {
      seenReferences.push(referenceUp);
      return referenceUp + 5 > 5 ? 0 : 5;
    },
  });
  resolver.commit(recordingController(), intentAt({ startUp: 1, plannedUp: 0.5, grounded: true }));
  assert.deepEqual(seenReferences, [1], 'the frame-start height reaches the predicate');
});

test('support height never falls below the floor', () => {
  const resolver = new SupportHeightCommitResolver({
    floorUp: 2,
    supportHeightAt: () => -50,
  });
  const controller = recordingController();
  resolver.commit(controller, intentAt({ startUp: 2, plannedUp: 1, grounded: true }));
  assert.ok(Math.abs(controller.seen[0].up - 2) < 1e-9, 'clamped to floorUp, not to -50');
});

test('a non-finite support height falls back to the floor', () => {
  const resolver = new SupportHeightCommitResolver({
    floorUp: 0,
    supportHeightAt: () => Number.NaN,
  });
  assert.equal(resolver.supportHeight(new Vector3(), 0), 0, 'NaN must not poison the position');
});

test('the resolver reuses its scratch objects across frames', () => {
  const resolver = new SupportHeightCommitResolver({ floorUp: 0 });
  const seen = new Set();
  const controller = {
    commitMovement(intent, resolved) {
      seen.add(resolved.position);
      seen.add(resolved.correctedDelta);
      return null;
    },
  };
  for (let i = 0; i < 50; i += 1) {
    resolver.commit(controller, intentAt({ startUp: 1, plannedUp: -1, grounded: false }));
  }
  assert.equal(seen.size, 2, 'one position and one delta vector, reused every frame');
});

test('the resolver validates its knobs and arguments', () => {
  assert.throws(() => new SupportHeightCommitResolver({ floorUp: Number.NaN }), /floorUp/);
  assert.throws(
    () => new SupportHeightCommitResolver({ supportHeightAt: 'nope' }),
    /supportHeightAt/
  );

  const resolver = new SupportHeightCommitResolver({});
  assert.throws(() => resolver.commit(null, intentAt({ startUp: 1, plannedUp: 0, grounded: true })), /motion controller/);
  assert.throws(() => resolver.commit(recordingController(), {}), /movement intent/);
});
