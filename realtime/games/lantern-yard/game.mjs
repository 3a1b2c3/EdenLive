import { CameraRelativeCharacterMotionController } from '/assets/actor-motion/character/CameraRelativeCharacterMotionController.js';
import { WaypointProgressTracker } from '/assets/behavior/WaypointProgressTracker.js';
import { ResourcePool, RESOURCE_EVENTS } from '/assets/gameplay/ResourcePool.js';
import { LAYOUT } from './scene.mjs';

const ROUND_SECONDS = 90;
const PLAYER_RADIUS = 0.42;
const GUARD_RADIUS = 0.5;
const LANTERN_RADIUS = 0.95;
const INNER = LAYOUT.half - PLAYER_RADIUS;
const GUARD_SPEED = 3.2;
const LOOK_YAW_RATE = 1.6;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function circleVsAabb(x, z, r, cx, cz, hx, hz) {
  const nx = clamp(x, cx - hx, cx + hx);
  const nz = clamp(z, cz - hz, cz + hz);
  const dx = x - nx;
  const dz = z - nz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r || d2 === 0) return null;
  const d = Math.sqrt(d2);
  const push = (r - d) / d;
  return { x: x + dx * push, z: z + dz * push };
}

function circleVsCircle(x, z, r, cx, cz, cr) {
  const dx = x - cx;
  const dz = z - cz;
  const min = r + cr;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min) return null;
  if (d2 === 0) return { x: x + min, z };
  const d = Math.sqrt(d2);
  const push = (min - d) / d;
  return { x: x + dx * push, z: z + dz * push };
}

function resolvePlanar(x, z, radius) {
  let px = clamp(x, -INNER, INNER);
  let pz = clamp(z, -INNER, INNER);
  for (let n = 0; n < 3; n += 1) {
    let hit = false;
    for (const [cx, cz, hx, hz] of LAYOUT.boxes) {
      const out = circleVsAabb(px, pz, radius, cx, cz, hx, hz);
      if (out) { px = out.x; pz = out.z; hit = true; }
    }
    for (const [cx, cz, cr] of LAYOUT.circles) {
      const out = circleVsCircle(px, pz, radius, cx, cz, cr);
      if (out) { px = out.x; pz = out.z; hit = true; }
    }
    px = clamp(px, -INNER, INNER);
    pz = clamp(pz, -INNER, INNER);
    if (!hit) break;
  }
  return { x: px, z: pz };
}

export function createGame() {
  const motion = new CameraRelativeCharacterMotionController({
    walkSpeed: 5.6,
    sprintSpeed: 7.4,
    accelerationLag: 0.05,
    decelerationLag: 0.06,
    turnLag: 0.08,
    jumpVelocity: 0,
  });
  const lanterns = new ResourcePool({
    id: 'lanterns', initial: 0, min: 0, max: LAYOUT.lanterns.length, fillAt: LAYOUT.lanterns.length,
  });
  const patrol = new WaypointProgressTracker({
    waypoints: LAYOUT.guardPath.map(([x, z]) => ({ x, y: 0, z })),
    reachDistance: 0.55,
    closed: true,
  });

  const game = {
    state: 'RUNNING',
    roundId: 1,
    elapsed: 0,
    terminalCount: 0,
    outcomeReason: null,
    events: [],
    eventSeq: 0,
    timeLeft: ROUND_SECONDS,
    cameraYaw: 0,
    cameraPitch: -0.32,
    intent: { forward: 0, back: 0, left: 0, right: 0, sprint: false },
    lanternTaken: LAYOUT.lanterns.map(() => false),
    guard: { x: LAYOUT.guardPath[0][0], z: LAYOUT.guardPath[0][1], yaw: 0, moved: false },
    guardOriginX: LAYOUT.guardPath[0][0],
    approach: { forward: false, back: false, left: false, right: false },
    chase: { forward: false, back: false, left: false, right: false },

    _emit(type, extra = {}) {
      this.eventSeq += 1;
      this.events.push({ id: `e${this.eventSeq}`, type, ...extra });
      if (this.events.length > 24) this.events.shift();
    },

    _end(state, reason) {
      if (this.state !== 'RUNNING') return;
      this.state = state;
      this.outcomeReason = reason;
      this.terminalCount += 1;
      this._emit(state === 'WON' ? 'round.won' : 'round.lost', { reason });
    },

    _dirFlags(dx, dz) {
      const s = Math.sin(this.cameraYaw);
      const c = Math.cos(this.cameraYaw);
      // Camera forward at yaw 0 is -Z; right is +X.
      const fwd = -s * dx - c * dz;
      const right = c * dx - s * dz;
      return { forward: fwd > 0.35, back: fwd < -0.35, left: right < -0.35, right: right > 0.35 };
    },

    _refreshApproach() {
      this.chase = this._dirFlags(this.guard.x - motion.position.x, this.guard.z - motion.position.z);
      const remaining = LAYOUT.lanterns.filter((_, i) => !this.lanternTaken[i]);
      if (!remaining.length) {
        this.approach = { forward: false, back: false, left: false, right: false };
        return;
      }
      const pos = motion.position;
      let best = remaining[0];
      let bestD = Infinity;
      for (const [lx, lz] of remaining) {
        const d = (lx - pos.x) ** 2 + (lz - pos.z) ** 2;
        if (d < bestD) { bestD = d; best = [lx, lz]; }
      }
      this.approach = this._dirFlags(best[0] - pos.x, best[1] - pos.z);
    },

    reset() {
      this.state = 'RUNNING';
      this.roundId += 1;
      this.elapsed = 0;
      this.terminalCount = 0;
      this.outcomeReason = null;
      this.events = [];
      this.eventSeq = 0;
      this.timeLeft = ROUND_SECONDS;
      this.cameraYaw = 0;
      this.cameraPitch = -0.32;
      this.intent = { forward: 0, back: 0, left: 0, right: 0, sprint: false };
      this.lanternTaken = LAYOUT.lanterns.map(() => false);
      lanterns.reset();
      const [sx, , sz] = LAYOUT.playerSpawn;
      motion.setState({ position: { x: sx, y: 0, z: sz }, velocity: { x: 0, y: 0, z: 0 }, yaw: 0, grounded: true });
      const [gx, gz] = LAYOUT.guardPath[0];
      this.guard = { x: gx, z: gz, yaw: 0, moved: false };
      this.guardOriginX = gx;
      patrol.reset(0);
      this._refreshApproach();
    },

    handleInput(input) {
      if (!input) return;
      if (input.consumePress?.('restart')) {
        this.reset();
        input.clear?.();
        return;
      }
      this.intent.forward = input.isDown?.('forward') ? 1 : 0;
      this.intent.back = input.isDown?.('back') ? 1 : 0;
      this.intent.left = input.isDown?.('left') ? 1 : 0;
      this.intent.right = input.isDown?.('right') ? 1 : 0;
      this.intent.sprint = Boolean(input.isDown?.('sprint'));
      this.intent.lookLeft = input.isDown?.('lookLeft') ? 1 : 0;
      this.intent.lookRight = input.isDown?.('lookRight') ? 1 : 0;
    },

    addLook(dx, dy) {
      if (this.state !== 'RUNNING') return;
      this.cameraYaw += dx * 0.0035;
      this.cameraPitch = clamp(this.cameraPitch + dy * 0.0035, -1.05, 0.35);
    },

    update(dt) {
      if (this.state !== 'RUNNING') return false;
      const t = Math.max(0, dt);
      this.elapsed += t;
      this.timeLeft = Math.max(0, this.timeLeft - t);

      this.cameraYaw += (this.intent.lookRight - this.intent.lookLeft) * LOOK_YAW_RATE * t;

      const intent = motion.planMovement({
        forward: this.intent.forward,
        backward: this.intent.back,
        strafeLeft: this.intent.left,
        strafeRight: this.intent.right,
        cameraYaw: this.cameraYaw,
        sprint: this.intent.sprint,
        jump: false,
        deltaSeconds: t,
        commit: false,
      });
      const resolved = resolvePlanar(intent.position.x, intent.position.z, PLAYER_RADIUS);
      motion.commitMovement(intent, {
        position: { x: resolved.x, y: 0, z: resolved.z },
        velocity: intent.velocity,
        correctedDelta: { x: resolved.x - intent.startPosition.x, y: 0, z: resolved.z - intent.startPosition.z },
        grounded: true,
      });

      const progress = patrol.step({ x: this.guard.x, y: 0, z: this.guard.z });
      if (progress?.currentWaypoint) {
        const tx = progress.currentWaypoint.x - this.guard.x;
        const tz = progress.currentWaypoint.z - this.guard.z;
        const len = Math.hypot(tx, tz) || 1;
        const step = Math.min(GUARD_SPEED * t, len);
        this.guard.x += (tx / len) * step;
        this.guard.z += (tz / len) * step;
        this.guard.yaw = Math.atan2(-(tx / len), -(tz / len));
        if (Math.abs(this.guard.x - this.guardOriginX) > 0.15) this.guard.moved = true;
      }

      const px = motion.position.x;
      const pz = motion.position.z;
      LAYOUT.lanterns.forEach(([lx, lz], i) => {
        if (this.lanternTaken[i]) return;
        if ((px - lx) ** 2 + (pz - lz) ** 2 <= LANTERN_RADIUS * LANTERN_RADIUS) {
          this.lanternTaken[i] = true;
          lanterns.gain(1);
          this._emit('lantern.collected', { index: i, count: lanterns.value });
        }
      });
      for (const ev of lanterns.drainEvents()) {
        if (ev.type === RESOURCE_EVENTS.FILLED && this.state === 'RUNNING') {
          this._end('WON', 'all_lanterns');
        }
      }
      if (this.state !== 'RUNNING') {
        this._refreshApproach();
        return false;
      }

      const catchR = PLAYER_RADIUS + GUARD_RADIUS;
      if ((px - this.guard.x) ** 2 + (pz - this.guard.z) ** 2 <= catchR * catchR) {
        this._end('LOST', 'caught_by_guard');
        this._refreshApproach();
        return false;
      }
      if (this.timeLeft <= 0) {
        this._end('LOST', 'time_up');
        this._refreshApproach();
        return false;
      }

      this._refreshApproach();
      return undefined;
    },

    read() {
      const pos = motion.snapshot();
      return {
        state: this.state,
        roundId: this.roundId,
        elapsed: this.elapsed,
        terminalCount: this.terminalCount,
        outcomeReason: this.outcomeReason,
        events: this.events.map((e) => ({ ...e })),
        lanternsCollected: lanterns.value,
        remaining: LAYOUT.lanterns.length - lanterns.value,
        timeLeft: this.timeLeft,
        player: { x: pos.position.x, z: pos.position.z, yaw: pos.yaw },
        guard: { x: this.guard.x, z: this.guard.z, yaw: this.guard.yaw, moved: this.guard.moved },
        approach: { ...this.approach },
        chase: { ...this.chase },
        lanternTaken: this.lanternTaken.slice(),
        cameraYaw: this.cameraYaw,
        cameraPitch: this.cameraPitch,
        implemented: true,
      };
    },

    visuals() {
      const pos = motion.snapshot();
      return {
        player: pos,
        guard: this.guard,
        lanternTaken: this.lanternTaken,
        state: this.state,
        outcomeReason: this.outcomeReason,
        timeLeft: this.timeLeft,
        collected: lanterns.value,
        cameraYaw: this.cameraYaw,
        cameraPitch: this.cameraPitch,
        moving: Math.hypot(pos.velocity.x, pos.velocity.z) > 0.2,
      };
    },
  };

  game.reset();
  game.roundId = 1;
  return game;
}
