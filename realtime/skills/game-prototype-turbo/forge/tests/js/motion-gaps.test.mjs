// Headless tests for locomotion primitives: lane running, flap flight,
// auto-hop climbing, and decoupled twin-stick aim.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';

import {
  LaneRunnerMotionController,
  LANE_SHIFT_RESULTS,
} from '../../../assets/actor-motion/LaneRunnerMotionController.js';
import { FlapFlightMotionController } from '../../../assets/actor-motion/FlapFlightMotionController.js';
import { AutoHopMotionController } from '../../../assets/actor-motion/AutoHopMotionController.js';
import {
  TwinStickAimController,
  AIM_SOURCES,
} from '../../../assets/actor-motion/TwinStickAimController.js';
import { DEFAULT_WORLD_BASIS as BASIS } from '../../../assets/math/WorldBasis.js';

const FRAME = 1 / 60;

function advance(controller, seconds) {
  const frames = Math.round(seconds / FRAME);
  let last = null;
  for (let i = 0; i < frames; i += 1) last = controller.step(FRAME);
  return last;
}

test('lane runner starts centred and reaches every lane', () => {
  const runner = new LaneRunnerMotionController({ laneCount: 3, laneWidth: 2 });
  assert.equal(runner.laneIndex, 1, 'a 3-lane runner starts in the middle');
  assert.equal(runner.lateralOffset, 0, 'the middle lane is centred on the origin');

  assert.equal(runner.requestLane(1), LANE_SHIFT_RESULTS.MOVED);
  advance(runner, 1);
  assert.equal(runner.laneIndex, 2);
  assert.ok(Math.abs(runner.lateralOffset - 2) < 1e-6, 'lane 2 sits one laneWidth right');

  assert.equal(runner.requestLane(-2), LANE_SHIFT_RESULTS.MOVED);
  advance(runner, 1);
  assert.equal(runner.laneIndex, 0);
  assert.ok(Math.abs(runner.lateralOffset + 2) < 1e-6);
});

test('lane runner interpolates rather than teleporting between lanes', () => {
  const runner = new LaneRunnerMotionController({ laneCount: 3, laneWidth: 2, laneChangeLag: 0.12 });
  runner.requestLane(1);

  // One frame in, the target lane index is already committed but the position is
  // still in transit -- that difference is what makes the change readable.
  runner.step(FRAME);
  assert.equal(runner.targetLaneIndex, 2);
  assert.ok(runner.lateralOffset > 0, 'started moving');
  assert.ok(runner.lateralOffset < 2, 'has not arrived yet');
  assert.equal(runner.settled, false);

  advance(runner, 1);
  assert.equal(runner.settled, true, 'eventually settles exactly on the lane');
  assert.equal(runner.laneIndex, 2);
});

test('lane runner blocks at the edges unless wrapping is enabled', () => {
  const runner = new LaneRunnerMotionController({ laneCount: 3, startLane: 0 });
  assert.equal(runner.requestLane(-1), LANE_SHIFT_RESULTS.BLOCKED);
  assert.equal(runner.targetLaneIndex, 0, 'a blocked request changes nothing');
  assert.equal(runner.requestLane(0), LANE_SHIFT_RESULTS.IGNORED);

  const wrapping = new LaneRunnerMotionController({ laneCount: 3, startLane: 0, wrapLanes: true });
  assert.equal(wrapping.requestLane(-1), LANE_SHIFT_RESULTS.MOVED);
  assert.equal(wrapping.targetLaneIndex, 2, 'wraps to the far lane');
});

test('lane runner advances forward on its own without input', () => {
  const runner = new LaneRunnerMotionController({ forwardSpeed: 10 });
  advance(runner, 1);
  assert.ok(Math.abs(runner.distance - 10) < 0.2, `expected ~10, got ${runner.distance}`);
  // Forward travel must land on the basis forward axis, not raw +z.
  const planar = BASIS.toPlanar(runner.position);
  assert.ok(Math.abs(planar.forward - runner.distance) < 1e-6);
});

test('lane runner jump leaves the ground and lands back on the floor', () => {
  const runner = new LaneRunnerMotionController({ jumpVelocity: 9, gravity: 26, floorUp: 0 });
  assert.equal(runner.grounded, true);
  assert.equal(runner.requestJump(), true);
  assert.equal(runner.requestJump(), false, 'no double jump while airborne');

  runner.step(FRAME);
  assert.equal(runner.grounded, false);
  assert.ok(runner.upOffset > 0);

  advance(runner, 2);
  assert.equal(runner.grounded, true, 'lands again');
  assert.equal(runner.upOffset, 0, 'rests exactly on the floor, no sinking or float');
  assert.equal(runner.verticalVelocity, 0);
});

test('lane runner duck shrinks the collider for a bounded window', () => {
  const runner = new LaneRunnerMotionController({
    duckDurationSeconds: 0.4,
    standingHeight: 1.8,
    duckHeight: 0.9,
  });
  assert.equal(runner.colliderHeight, 1.8);
  assert.equal(runner.requestDuck(), true);
  assert.equal(runner.ducking, true);
  assert.equal(runner.colliderHeight, 0.9, 'ducking shortens the collider');

  advance(runner, 0.5);
  assert.equal(runner.ducking, false, 'the duck expires on its own');
  assert.equal(runner.colliderHeight, 1.8);

  // Airborne ducks are refused; a jump cancels an active duck.
  runner.requestDuck();
  runner.requestJump();
  assert.equal(runner.ducking, false, 'jumping cancels the duck');
  assert.equal(runner.requestDuck(), false, 'cannot duck in mid-air');
});

test('lane runner with one lane is a plain auto-runner', () => {
  // A one-lane auto-runner: auto-run forward, tap to jump, no lanes to switch.
  const runner = new LaneRunnerMotionController({ laneCount: 1, forwardSpeed: 12 });
  assert.equal(runner.laneIndex, 0);
  assert.equal(runner.requestLane(1), LANE_SHIFT_RESULTS.BLOCKED, 'nowhere to go');
  advance(runner, 1);
  assert.ok(runner.distance > 11, 'still auto-runs');
  assert.equal(runner.lateralOffset, 0, 'stays centred');
});

test('flap flight sets velocity so mashing cannot accumulate lift', () => {
  const bird = new FlapFlightMotionController({ flapVelocity: 6, minFlapIntervalSeconds: 0 });
  bird.flap();
  const afterOne = bird.verticalVelocity;
  bird.flap();
  bird.flap();
  assert.equal(bird.verticalVelocity, afterOne, 'every flap produces the same velocity');
  assert.equal(afterOne, 6);
});

test('flap flight refuses flaps inside the minimum interval', () => {
  const bird = new FlapFlightMotionController({ minFlapIntervalSeconds: 0.1 });
  assert.equal(bird.flap(), true);
  assert.equal(bird.flap(), false, 'an immediate second flap is refused');
  assert.equal(bird.canFlap(), false);

  advance(bird, 0.12);
  assert.equal(bird.canFlap(), true);
  assert.equal(bird.flap(), true);
  assert.equal(bird.flapCount, 2);
});

test('flap flight falls under gravity and crashes on the floor', () => {
  const bird = new FlapFlightMotionController({ startUp: 3, floorUp: 0, gravity: 18 });
  assert.equal(bird.crashed, false);
  advance(bird, 3);
  assert.equal(bird.crashed, true);
  assert.equal(bird.crashReason, 'floor');
  assert.equal(bird.upOffset, 0);

  // A crashed bird freezes: no further drift, and flaps are refused.
  const frozen = bird.upOffset;
  advance(bird, 1);
  assert.equal(bird.upOffset, frozen);
  assert.equal(bird.flap(), false);

  bird.reset({ up: 3 });
  assert.equal(bird.crashed, false, 'reset makes it playable again');
});

test('flap flight clamps at the ceiling without crashing', () => {
  const bird = new FlapFlightMotionController({
    startUp: 9.5, ceilingUp: 10, floorUp: 0, flapVelocity: 8, minFlapIntervalSeconds: 0,
  });
  for (let i = 0; i < 30; i += 1) {
    bird.flap();
    bird.step(FRAME);
  }
  assert.ok(bird.upOffset <= 10 + 1e-9, `ceiling held, got ${bird.upOffset}`);
  assert.equal(bird.crashed, false, 'the ceiling is a limit, not a loss');
});

test('flap flight pitch tracks vertical velocity for the visual', () => {
  const bird = new FlapFlightMotionController({ maxPitchRadians: 0.9 });
  bird.flap();
  assert.ok(bird.pitch > 0, 'nose up while rising');
  advance(bird, 2);
  assert.ok(bird.pitch < 0, 'nose down while falling');
  assert.ok(Math.abs(bird.pitch) <= 0.9, 'pitch stays clamped');
});

test('auto-hop re-jumps on every reported landing', () => {
  const hopper = new AutoHopMotionController({ bounceVelocity: 12, gravity: 26 });
  assert.ok(hopper.rising, 'a fresh run starts with a hop, not a fall');

  let landings = 0;
  for (let i = 0; i < 300; i += 1) {
    hopper.step(FRAME);
    if (!hopper.rising && hopper.upOffset <= 0) {
      assert.equal(hopper.noteLanding(0), true);
      landings += 1;
    }
  }
  assert.ok(landings >= 2, `expected repeated hops, got ${landings}`);
  assert.equal(hopper.hopCount, landings);
});

test('auto-hop ignores a landing reported while rising', () => {
  // A platform overlap on the way up is passing through it, not landing on it.
  const hopper = new AutoHopMotionController({});
  assert.ok(hopper.rising);
  assert.equal(hopper.noteLanding(0), false);
  assert.equal(hopper.hopCount, 0);
});

test('auto-hop steers horizontally while airborne', () => {
  const hopper = new AutoHopMotionController({ steerSpeed: 6, steerLag: 0 });
  hopper.setSteer(1);
  advance(hopper, 0.5);
  assert.ok(hopper.rightOffset > 0, 'steering right moves right');

  const atRight = hopper.rightOffset;
  hopper.setSteer(-1);
  advance(hopper, 0.5);
  assert.ok(hopper.rightOffset < atRight, 'steering reverses');
});

test('auto-hop clamps or wraps at the horizontal bound', () => {
  const clamped = new AutoHopMotionController({ horizontalBound: 5, steerSpeed: 40, steerLag: 0 });
  clamped.setSteer(1);
  advance(clamped, 2);
  assert.ok(Math.abs(clamped.rightOffset) <= 5 + 1e-9, `clamped, got ${clamped.rightOffset}`);

  const wrapping = new AutoHopMotionController({
    horizontalBound: 5, wrapHorizontally: true, steerSpeed: 40, steerLag: 0,
  });
  wrapping.setSteer(1);
  advance(wrapping, 1);
  assert.ok(wrapping.rightOffset >= -5 && wrapping.rightOffset <= 5, 'stays inside after wrapping');
});

test('auto-hop records the highest point reached', () => {
  const hopper = new AutoHopMotionController({ bounceVelocity: 12, gravity: 26 });
  advance(hopper, 0.5);
  assert.ok(hopper.highestUp > 0);
  const peak = hopper.highestUp;
  advance(hopper, 0.5);
  assert.ok(hopper.highestUp >= peak, 'the peak never decreases');
});

test('a spring pad can override one hop without reconfiguring', () => {
  const hopper = new AutoHopMotionController({ bounceVelocity: 10, gravity: 26 });
  // Fall to the ground first.
  for (let i = 0; i < 200 && (hopper.rising || hopper.upOffset > 0); i += 1) hopper.step(FRAME);
  hopper.noteLanding(0, 30);
  assert.equal(hopper.verticalVelocity, 30, 'the pad launches harder than the default');
});

test('twin-stick aim is independent of movement direction', () => {
  const aim = new TwinStickAimController({ turnLag: 0, deadzone: 0.2 });
  // Aim right while the body would be travelling forward: the two must not be
  // coupled, which is the whole point of the scheme.
  assert.equal(aim.aimWithStick(1, 0), true);
  const result = aim.step(FRAME);
  assert.equal(result.aimSource, AIM_SOURCES.STICK);
  assert.ok(Math.abs(result.aimDirection.x - 1) < 1e-6, 'aims along +x');
  assert.ok(Math.abs(result.aimDirection.z) < 1e-6);

  assert.equal(aim.aimWithStick(-1, 0), true);
  const flipped = aim.step(FRAME);
  assert.ok(Math.abs(flipped.aimDirection.x + 1) < 1e-6, 'aims along -x');
});

test('twin-stick aim holds its last direction inside the deadzone', () => {
  const aim = new TwinStickAimController({ turnLag: 0, deadzone: 0.25 });
  aim.aimWithStick(1, 0);
  const aimed = aim.step(FRAME).aimDirection.clone();

  assert.equal(aim.aimWithStick(0.1, 0.05), false, 'below the deadzone');
  const held = aim.step(FRAME);
  assert.equal(held.aimSource, AIM_SOURCES.HELD);
  assert.ok(held.aimDirection.distanceTo(aimed) < 1e-6, 'aim is held, not reset');
});

test('twin-stick aim can be driven by a pointer or a lock-on target', () => {
  const aim = new TwinStickAimController({ turnLag: 0 });
  const from = new Vector3(0, 0, 0);

  assert.equal(aim.aimAtPoint(new Vector3(5, 0, 0), from), true);
  assert.equal(aim.step(FRAME).aimSource, AIM_SOURCES.POINTER);
  assert.ok(Math.abs(aim.aimDirection.x - 1) < 1e-6);

  assert.equal(aim.aimAtTarget(new Vector3(0, 0, -5), from), true);
  assert.equal(aim.step(FRAME).aimSource, AIM_SOURCES.TARGET);
  assert.ok(Math.abs(aim.aimDirection.z + 1) < 1e-6);

  // Pointer exactly on the player has no meaningful direction: hold instead.
  assert.equal(aim.aimAtPoint(from, from), false);
});

test('twin-stick aim sweeps rather than snapping when turnLag is set', () => {
  const aim = new TwinStickAimController({ turnLag: 0.1 });
  aim.aimWithStick(0, -1);
  aim.step(FRAME);
  const startYaw = aim.aimYaw;

  aim.aimWithStick(0, 1); // request a 180-degree turn
  aim.step(FRAME);
  assert.notEqual(aim.aimYaw, startYaw, 'started turning');
  assert.equal(aim.settled, false, 'has not arrived in one frame');

  advance(aim, 1);
  assert.equal(aim.settled, true, 'eventually reaches the requested aim');
});

test('twin-stick fire respects its interval and auto-fire', () => {
  const aim = new TwinStickAimController({ fireIntervalSeconds: 0.2, turnLag: 0 });
  aim.setFireHeld(true);

  const first = aim.step(FRAME);
  assert.equal(first.shouldFire, true, 'fires on the first frame held');
  const second = aim.step(FRAME);
  assert.equal(second.shouldFire, false, 'the interval gates the next shot');

  advance(aim, 0.25);
  assert.ok(aim.shotsFired >= 2, 'fires again once the interval elapses');

  // Arena survival: weapons fire on their own with no input at all.
  const auto = new TwinStickAimController({ fireIntervalSeconds: 0.1, autoFire: true, turnLag: 0 });
  advance(auto, 0.35);
  assert.ok(auto.shotsFired >= 3, `auto-fire keeps shooting, got ${auto.shotsFired}`);
});

test('the motion controllers validate their knobs', () => {
  assert.throws(() => new LaneRunnerMotionController({ laneCount: 0 }), /laneCount/);
  assert.throws(() => new LaneRunnerMotionController({ laneWidth: 0 }), /laneWidth/);
  assert.throws(
    () => new LaneRunnerMotionController({ standingHeight: 1, duckHeight: 2 }),
    /duckHeight/
  );
  assert.throws(() => new FlapFlightMotionController({ flapVelocity: 0 }), /flapVelocity/);
  assert.throws(() => new FlapFlightMotionController({ gravity: -1 }), /gravity/);
  assert.throws(
    () => new FlapFlightMotionController({ floorUp: 5, ceilingUp: 1 }),
    /ceilingUp/
  );
  assert.throws(() => new AutoHopMotionController({ bounceVelocity: 0 }), /bounceVelocity/);
  assert.throws(() => new AutoHopMotionController({ horizontalBound: -2 }), /horizontalBound/);
  assert.throws(() => new TwinStickAimController({ deadzone: 1 }), /deadzone/);
  assert.throws(() => new TwinStickAimController({ fireIntervalSeconds: 0 }), /fireIntervalSeconds/);
});
