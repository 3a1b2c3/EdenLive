// Headless behaviour tests for assets/gameplay/PaddleBallModel.js.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PaddleBallModel } from '../../../assets/gameplay/PaddleBallModel.js';

test('a centre paddle hit returns straight up, an edge hit returns at max angle', () => {
  const ball = new PaddleBallModel({ speed: 10 });

  ball.reflectFromPaddle(0, Math.PI / 2);
  assert.ok(Math.abs(ball.velocity.y - 10) < 1e-9, 'straight up');
  assert.ok(Math.abs(ball.velocity.x) < 1e-9);

  ball.reflectFromPaddle(1, Math.PI / 2);
  assert.ok(Math.abs(ball.velocity.x - 10) < 1e-9, 'edge hit goes sideways');
  assert.ok(Math.abs(ball.velocity.y) < 1e-9);
});

test('step integrates position and reflects off a wall', () => {
  const ball = new PaddleBallModel({ position: { x: 0.5, y: 2 }, speed: 10 });
  ball.launch(-Math.PI / 2); // straight left, x shrinks
  const events = ball.step(0.1, { minX: 0, maxX: 10, ceilingY: 10 });

  assert.ok(events.includes('leftWall'), 'left wall was hit');
  assert.ok(ball.position.x >= 0, 'never below the wall');
  assert.ok(ball.velocity.x > 0, 'reflected to the right');
});

test('fellBelow flips once the ball passes the paddle line', () => {
  const ball = new PaddleBallModel({ position: { x: 0, y: 0 } });
  ball.launch(Math.PI); // straight down
  ball.step(0.1);
  assert.equal(ball.fellBelow(0), true);
});

test('keeps its speed constant through a step', () => {
  const ball = new PaddleBallModel({ speed: 12 });
  ball.launch(Math.PI / 4);
  ball.step(0.05, { minX: 0, maxX: 10, ceilingY: 10 });
  const mag = Math.hypot(ball.velocity.x, ball.velocity.y);
  assert.ok(Math.abs(mag - 12) < 1e-9, `speed stays 12, got ${mag}`);
});