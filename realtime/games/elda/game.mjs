// One gameplay owner: archer movement, orbit camera, bow draw/charge/fire with
// screen-center auto-aim, arrows, monster AI, hearts, win/loss and restart.
// Visuals read this state; nothing here touches the DOM.
import { Vector3 } from 'three';
import { OrbitFollowCameraRig } from '/assets/camera/OrbitFollowCameraRig.js';
import { CameraRelativeCharacterMotionController } from '/assets/actor-motion/character/CameraRelativeCharacterMotionController.js';
import { ResourcePool, RESOURCE_EVENTS } from '/assets/gameplay/ResourcePool.js';

export const TUNING = Object.freeze({
  hearts: 5,
  walkSpeed: 6.2,
  sprintSpeed: 9.6,
  drawMoveFactor: 0.45,
  wadeFactor: 0.55,
  playerRadius: 0.45,
  camYawRate: 2.1, // rad/s for J/L
  camPitchRate: 1.3, // rad/s for I/K
  camDistance: 7.2,
  camAimDistance: 4.4,
  camAnchorHeight: 1.75,
  camAimRight: 0.85,
  camPitch: -0.16,
  fullDrawSeconds: 0.9,
  minCharge: 0.15,
  arrowSpeedMin: 32,
  arrowSpeedMax: 78,
  arrowGravity: 5,
  arrowLife: 3.5,
  stuckLife: 6,
  aimYawDeg: 12, // auto-aim window half-width around screen center
  aimPitchDeg: 18,
  aimRange: 80,
  lockHoldFactor: 2.2,
  aggroRadius: 28,
  alertShare: 18,
  clubSpeed: 3.2,
  clubReach: 2.0,
  clubHitRange: 2.6,
  clubWindup: 0.75,
  clubRecover: 1.1,
  throwerSpeed: 2.6,
  throwRange: 17,
  throwWindup: 0.6,
  throwCooldown: 2.8,
  rockSpeed: 15,
  rockGravity: 12,
  rockHitRadius: 1.1,
  invulnSeconds: 1.2,
  deathSeconds: 1.1,
});

const D2R = Math.PI / 180;
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
const round = (v, k = 100) => Math.round(v * k) / k;

export function createGame({ heightAt, isDeepWater, colliders, monsterSpawns, world }) {
  const rig = new OrbitFollowCameraRig({
    distance: TUNING.camDistance, anchorHeight: TUNING.camAnchorHeight,
    pitchMin: -0.85, pitchMax: 0.32, lockLag: 0, positionLag: 0.06, lookLag: 0.03, pitch: TUNING.camPitch,
  });
  const motion = new CameraRelativeCharacterMotionController({
    walkSpeed: TUNING.walkSpeed, sprintSpeed: TUNING.sprintSpeed, turnLag: 0.07,
    accelerationLag: 0.06, decelerationLag: 0.06,
  });
  const hearts = new ResourcePool({ id: 'hearts', initial: TUNING.hearts, max: TUNING.hearts, min: 0 });

  // A round opens in READY: the archer holds on the start rise, guards idle,
  // and no clock runs until the first move or draw, so the model frame rate
  // settles before combat. readyTime drives the idle animation meanwhile.
  const g = {
    state: 'READY', roundId: 0, elapsed: 0, readyTime: 0, terminalCount: 0, outcomeReason: '',
    events: [], nextEventId: 1,
    player: null, monsters: [], arrows: [], rocks: [], nextArrowId: 1, nextRockId: 1,
    bow: null, aim: null, cam: { position: new Vector3(), lookAt: new Vector3(), forward: new Vector3(0, 0, -1) },
    stats: null,
  };

  function emit(type, extra = {}) {
    g.events.push({ id: g.nextEventId++, type, t: round(g.elapsed), ...extra });
    if (g.events.length > 40) g.events.shift();
  }

  function groundPoint(x, z) { return new Vector3(x, heightAt(x, z), z); }

  function reset() {
    const s = world.playerStart;
    g.state = 'READY';
    g.roundId += 1;
    g.elapsed = 0;
    g.readyTime = 0;
    g.terminalCount = 0;
    g.outcomeReason = '';
    g.events = [];
    g.nextEventId = 1;
    hearts.reset();
    hearts.drainEvents();
    motion.setState({ position: groundPoint(s.x, s.z), velocity: new Vector3(), yaw: s.yaw, grounded: true });
    g.player = { invuln: 0, hitFlash: 0, moving: false, sprinting: false, animTime: 0, speed: 0, wading: false, looseTime: 99 };
    g.monsters = monsterSpawns.map(sp => ({
      id: sp.id, kind: sp.kind, maxHp: sp.hp, hp: sp.hp,
      pos: groundPoint(sp.x, sp.z), vel: new Vector3(), yaw: sp.yaw,
      state: 'idle', timer: 0, cooldown: 1 + Math.random() * 0.5, animTime: Math.random() * 3, hitFlash: 0, deathTime: 0,
    }));
    g.arrows = [];
    g.rocks = [];
    g.bow = { drawing: false, drawTime: 0, charge: 0, fired: 0, hits: 0 };
    g.aim = { targetId: '', locked: false, nearestId: '', nearestDist: 999, nearestBearingDeg: 0, nearestPitchDeg: 0, targetYawDeg: 0, targetPitchDeg: 0 };
    rig.reset({ yaw: s.yaw, pitch: TUNING.camPitch });
    rig.distance = TUNING.camDistance;
    rig.anchorRight = 0;
    stepCamera(1 / 60, 0, 0, true);
    updateAim();
  }

  function playerPos() { return motion.position; }
  function monsterChest(m) { return m.pos.clone().setY(m.pos.y + (m.kind === 'thrower' ? 1.5 : 1.1)); }
  function monsterRadius(m) { return m.kind === 'thrower' ? 1.15 : 0.85; }
  const alive = () => g.monsters.filter(m => m.hp > 0);

  function stepCamera(dt, yawInput, pitchInput, snap = false) {
    const aiming = g.bow?.drawing;
    // Over-the-shoulder tightening while the bow is drawn.
    const k = Math.min(1, dt * 8);
    rig.distance += ((aiming ? TUNING.camAimDistance : TUNING.camDistance) - rig.distance) * (snap ? 1 : k);
    rig.anchorRight += ((aiming ? TUNING.camAimRight : 0) - rig.anchorRight) * (snap ? 1 : k);
    // anchorRight is in world basis; rotate it with the camera yaw by offsetting the target instead.
    const right = new Vector3(Math.cos(rig.yaw), 0, -Math.sin(rig.yaw));
    const target = playerPos().clone().addScaledVector(right, rig.anchorRight);
    const savedRight = rig.anchorRight;
    rig.anchorRight = 0;
    const pose = rig.step({ targetPosition: target, yawInput, pitchInput, deltaSeconds: dt, snapToTarget: snap });
    rig.anchorRight = savedRight;
    const floor = heightAt(pose.position.x, pose.position.z) + 0.7;
    if (pose.position.y < floor) pose.position.y = floor;
    g.cam.position.copy(pose.position);
    g.cam.lookAt.copy(pose.lookAt);
    g.cam.forward.copy(pose.lookAt).sub(pose.position).normalize();
  }

  // Screen-center auto-aim: yaw/pitch offset of each live monster from the camera ray.
  function angularOffset(point) {
    const d = point.clone().sub(g.cam.position);
    const dist = d.length();
    const f = g.cam.forward;
    const camYaw = Math.atan2(-f.x, -f.z);
    const camPitch = Math.asin(Math.max(-1, Math.min(1, f.y)));
    const yaw = Math.atan2(-d.x, -d.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, d.y / Math.max(dist, 1e-6))));
    return { yawDeg: wrapAngle(yaw - camYaw) / D2R, pitchDeg: (pitch - camPitch) / D2R, dist };
  }

  function updateAim() {
    const a = g.aim;
    let best = null, bestScore = Infinity, nearest = null, nearestDist = Infinity;
    // While the bow is drawn, a locked target stays locked inside a wider window.
    const sticky = g.bow.drawing && a.targetId ? a.targetId : '';
    for (const m of alive()) {
      const pd = m.pos.distanceTo(playerPos());
      const off = angularOffset(monsterChest(m));
      if (pd < nearestDist) { nearestDist = pd; nearest = { m, off }; }
      if (pd > TUNING.aimRange) continue;
      const widen = m.id === sticky ? TUNING.lockHoldFactor : 1;
      if (Math.abs(off.yawDeg) > TUNING.aimYawDeg * widen || Math.abs(off.pitchDeg) > TUNING.aimPitchDeg * widen) continue;
      if (m.id === sticky) { best = { m, off }; bestScore = -Infinity; continue; }
      const score = Math.hypot(off.yawDeg, off.pitchDeg * 0.8) + pd * 0.05;
      if (score < bestScore) { bestScore = score; best = { m, off }; }
    }
    a.targetId = best ? best.m.id : '';
    a.locked = Boolean(best && g.bow.drawing);
    a.targetYawDeg = best ? round(best.off.yawDeg) : 0;
    a.targetPitchDeg = best ? round(best.off.pitchDeg) : 0;
    a.nearestId = nearest ? nearest.m.id : '';
    a.nearestDist = nearest ? round(nearestDist) : 999;
    a.nearestBearingDeg = nearest ? round(nearest.off.yawDeg) : 0;
    a.nearestPitchDeg = nearest ? round(nearest.off.pitchDeg) : 0;
  }

  function fireArrow() {
    const b = g.bow;
    const charge = Math.max(TUNING.minCharge, b.charge);
    const speed = TUNING.arrowSpeedMin + (TUNING.arrowSpeedMax - TUNING.arrowSpeedMin) * charge;
    const damage = charge >= 0.999 ? 2 : 1;
    const yaw = motion.yaw;
    const fwd = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const origin = playerPos().clone().add(new Vector3(0, 1.45, 0)).addScaledVector(fwd, 0.5);
    const target = g.monsters.find(m => m.id === g.aim.targetId && m.hp > 0);
    let aimPoint;
    if (target) {
      // Lead the target and lift for gravity so an assisted shot lands on the chest.
      const chest = monsterChest(target);
      const t = chest.distanceTo(origin) / speed;
      aimPoint = chest.addScaledVector(target.vel, t);
      aimPoint.y += 0.5 * TUNING.arrowGravity * t * t;
    } else {
      aimPoint = g.cam.position.clone().addScaledVector(g.cam.forward, 60);
    }
    const dir = aimPoint.sub(origin).normalize();
    g.arrows.push({ id: g.nextArrowId++, pos: origin, vel: dir.multiplyScalar(speed), age: 0, stuck: false, damage, targetId: target?.id ?? '' });
    b.fired += 1;
    emit('arrow.fired', { charge: round(charge), assisted: Boolean(target), targetId: target?.id ?? '' });
    b.drawing = false;
    b.drawTime = 0;
    b.charge = 0;
    g.player.looseTime = 0;
  }

  function alertAll(from, radius) {
    for (const m of alive()) {
      if (m.state === 'idle' && m.pos.distanceTo(from) < radius) { m.state = 'chase'; emit('monster.alerted', { monsterId: m.id }); }
    }
  }

  function damageMonster(m, amount) {
    m.hp = Math.max(0, m.hp - amount);
    m.hitFlash = 0.35;
    g.bow.hits += 1;
    emit('monster.hit', { monsterId: m.id, damage: amount, hp: m.hp });
    if (m.state === 'idle') m.state = 'chase';
    alertAll(m.pos, TUNING.alertShare);
    if (m.hp === 0) {
      m.state = 'dead';
      m.deathTime = 0;
      emit('monster.killed', { monsterId: m.id, remaining: alive().length });
    }
  }

  function damagePlayer(amount, from, cause) {
    const p = g.player;
    if (p.invuln > 0 || g.state !== 'RUNNING') return;
    hearts.lose(amount);
    p.invuln = TUNING.invulnSeconds;
    p.hitFlash = 0.5;
    // Knockback away from the source.
    const push = playerPos().clone().sub(from).setY(0);
    if (push.lengthSq() > 1e-6) {
      push.normalize().multiplyScalar(1.4);
      const next = playerPos().clone().add(push);
      if (!isDeepWater(next.x, next.z)) { next.y = heightAt(next.x, next.z); motion.position.copy(next); }
    }
    emit('player.hit', { cause, hearts: hearts.value });
  }

  function segmentSphere(a, b, c, r) {
    const ab = b.clone().sub(a);
    const t = Math.max(0, Math.min(1, c.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-9)));
    return a.clone().addScaledVector(ab, t).distanceToSquared(c) <= r * r;
  }

  function blockedByProp(p) {
    for (const c of colliders) {
      const top = c.type === 'tree' ? 9 : c.type === 'rock' ? 1.6 : c.type === 'house' ? 7 : c.type === 'shrine' ? 13 : 1;
      if (Math.hypot(p.x - c.x, p.z - c.z) < c.r + 0.1 && p.y < heightAt(c.x, c.z) + top) return true;
    }
    return false;
  }

  function stepArrows(dt) {
    for (const a of g.arrows) {
      a.age += dt;
      if (a.stuck) continue;
      const start = a.pos.clone();
      a.vel.y -= TUNING.arrowGravity * dt;
      a.pos.addScaledVector(a.vel, dt);
      let hit = null;
      for (const m of alive()) {
        if (segmentSphere(start, a.pos, monsterChest(m), monsterRadius(m))) { hit = m; break; }
      }
      if (hit) { damageMonster(hit, a.damage); a.done = true; continue; }
      if (a.pos.y < heightAt(a.pos.x, a.pos.z) || blockedByProp(a.pos)) {
        a.stuck = true;
        a.age = 0;
        emit('arrow.missed', {});
      }
    }
    g.arrows = g.arrows.filter(a => !a.done && (a.stuck ? a.age < TUNING.stuckLife : a.age < TUNING.arrowLife));
  }

  function stepRocks(dt) {
    const chest = playerPos().clone().setY(playerPos().y + 1.1);
    for (const r of g.rocks) {
      r.age += dt;
      const start = r.pos.clone();
      r.vel.y -= TUNING.rockGravity * dt;
      r.pos.addScaledVector(r.vel, dt);
      if (segmentSphere(start, r.pos, chest, TUNING.rockHitRadius)) { damagePlayer(1, start, 'rock'); r.done = true; continue; }
      if (r.pos.y < heightAt(r.pos.x, r.pos.z) - 0.2 || r.age > 4) r.done = true;
    }
    g.rocks = g.rocks.filter(r => !r.done);
  }

  function moveMonster(m, dir, speed, dt) {
    const next = m.pos.clone().addScaledVector(dir, speed * dt);
    for (const c of colliders) {
      const d = Math.hypot(next.x - c.x, next.z - c.z), min = c.r + 0.6;
      if (d < min && d > 1e-6) { next.x = c.x + (next.x - c.x) / d * min; next.z = c.z + (next.z - c.z) / d * min; }
    }
    if (isDeepWater(next.x, next.z)) return;
    next.y = heightAt(next.x, next.z);
    m.vel.copy(next).sub(m.pos).divideScalar(dt);
    m.pos.copy(next);
  }

  function stepMonsters(dt) {
    const pp = playerPos();
    for (const m of g.monsters) {
      m.hitFlash = Math.max(0, m.hitFlash - dt);
      m.animTime += dt;
      m.vel.set(0, 0, 0);
      if (m.state === 'dead') { m.deathTime += dt; continue; }
      const toP = pp.clone().sub(m.pos).setY(0);
      const dist = toP.length();
      const dir = dist > 1e-6 ? toP.clone().divideScalar(dist) : new Vector3();
      if (m.state === 'idle') {
        if (dist < TUNING.aggroRadius) { m.state = 'chase'; emit('monster.alerted', { monsterId: m.id }); alertAll(m.pos, TUNING.alertShare); }
        continue;
      }
      m.yaw = Math.atan2(-dir.x, -dir.z);
      m.cooldown = Math.max(0, m.cooldown - dt);
      if (m.state === 'windup') {
        m.timer += dt;
        const windup = m.kind === 'thrower' && m.attack === 'throw' ? TUNING.throwWindup : TUNING.clubWindup;
        if (m.timer >= windup) {
          if (m.attack === 'throw') {
            const from = m.pos.clone().setY(m.pos.y + 2.4);
            const target = pp.clone().setY(pp.y + 1.1);
            const flat = target.clone().sub(from).setY(0);
            const t = Math.max(0.35, flat.length() / TUNING.rockSpeed);
            const vel = flat.divideScalar(t);
            vel.y = (target.y - from.y) / t + 0.5 * TUNING.rockGravity * t;
            g.rocks.push({ id: g.nextRockId++, pos: from, vel, age: 0 });
            emit('monster.threw', { monsterId: m.id });
            m.cooldown = TUNING.throwCooldown;
          } else {
            emit('monster.swung', { monsterId: m.id });
            if (dist < TUNING.clubHitRange * (m.kind === 'thrower' ? 1.2 : 1)) damagePlayer(1, m.pos, 'club');
            m.cooldown = TUNING.clubRecover;
          }
          m.state = 'recover';
          m.timer = 0;
        }
        continue;
      }
      if (m.state === 'recover') {
        m.timer += dt;
        if (m.timer >= 0.5) m.state = 'chase';
        continue;
      }
      // chase
      const reach = TUNING.clubReach * (m.kind === 'thrower' ? 1.25 : 1);
      if (dist <= reach && m.cooldown <= 0) { m.state = 'windup'; m.attack = 'club'; m.timer = 0; continue; }
      if (m.kind === 'thrower' && dist > reach && dist <= TUNING.throwRange && m.cooldown <= 0) {
        m.state = 'windup'; m.attack = 'throw'; m.timer = 0; continue;
      }
      const wantDist = m.kind === 'thrower' ? (dist > TUNING.throwRange * 0.8 ? 0 : reach * 0.9) : reach * 0.85;
      if (dist > wantDist + 0.05) moveMonster(m, dir, m.kind === 'thrower' ? TUNING.throwerSpeed : TUNING.clubSpeed, dt);
    }
    // Keep live monsters from stacking.
    const live = alive();
    for (let i = 0; i < live.length; i += 1) for (let j = i + 1; j < live.length; j += 1) {
      const a = live[i].pos, b = live[j].pos;
      const d = Math.hypot(a.x - b.x, a.z - b.z), min = 1.5;
      if (d < min && d > 1e-6) {
        const push = (min - d) / 2, nx = (a.x - b.x) / d, nz = (a.z - b.z) / d;
        a.x += nx * push; a.z += nz * push; b.x -= nx * push; b.z -= nz * push;
        a.y = heightAt(a.x, a.z); b.y = heightAt(b.x, b.z);
      }
    }
  }

  function stepPlayer(dt, input) {
    const p = g.player;
    p.invuln = Math.max(0, p.invuln - dt);
    p.hitFlash = Math.max(0, p.hitFlash - dt);
    p.looseTime += dt;
    const fw = input?.isDown('forward') ? 1 : 0, bk = input?.isDown('backward') ? 1 : 0;
    const lf = input?.isDown('left') ? 1 : 0, rt = input?.isDown('right') ? 1 : 0;
    const sprint = Boolean(input?.isDown('sprint')) && !g.bow.drawing;
    let faceTarget = null;
    if (g.bow.drawing) {
      const t = g.monsters.find(m => m.id === g.aim.targetId && m.hp > 0);
      faceTarget = t ? t.pos.clone() : playerPos().clone().add(new Vector3(g.cam.forward.x, 0, g.cam.forward.z).normalize().multiplyScalar(20));
    }
    const intent = motion.planMovement({ forward: fw, backward: bk, strafeLeft: lf, strafeRight: rt, cameraYaw: rig.yaw, faceTarget, sprint, deltaSeconds: dt });
    const start = intent.startPosition;
    const wading = heightAt(start.x, start.z) < world.waterLevel - 0.25;
    const factor = (g.bow.drawing ? TUNING.drawMoveFactor : 1) * (wading ? TUNING.wadeFactor : 1);
    const delta = intent.desiredDelta.clone().setY(0).multiplyScalar(factor);
    let next = start.clone().add(delta);
    for (const c of colliders) {
      const d = Math.hypot(next.x - c.x, next.z - c.z), min = c.r + TUNING.playerRadius;
      if (d < min && d > 1e-6) { next.x = c.x + (next.x - c.x) / d * min; next.z = c.z + (next.z - c.z) / d * min; }
    }
    const rr = Math.hypot(next.x, next.z);
    if (rr > world.playableRadius) { next.x *= world.playableRadius / rr; next.z *= world.playableRadius / rr; }
    if (isDeepWater(next.x, next.z)) {
      const alongX = new Vector3(next.x, 0, start.z), alongZ = new Vector3(start.x, 0, next.z);
      next = !isDeepWater(alongX.x, alongX.z) ? alongX : !isDeepWater(alongZ.x, alongZ.z) ? alongZ : start.clone();
    }
    next.y = heightAt(next.x, next.z);
    const moved = next.clone().sub(start);
    const velocity = moved.clone().setY(0).divideScalar(dt);
    motion.commitMovement(intent, { position: next, velocity, correctedDelta: moved, grounded: true });
    p.speed = velocity.length();
    p.moving = p.speed > 0.4;
    p.sprinting = sprint && p.moving;
    p.wading = wading;
    p.animTime += dt * (p.sprinting ? 1.4 : 1);
  }

  function checkOutcome() {
    for (const e of hearts.drainEvents()) if (e.type === RESOURCE_EVENTS.DEPLETED) g.heartsDepleted = true;
    // Victory takes precedence when both happen in the same step.
    if (alive().length === 0) {
      g.state = 'WON'; g.outcomeReason = 'monsters_cleared'; g.terminalCount += 1;
      emit('round.won', { reason: g.outcomeReason });
    } else if (hearts.value <= 0) {
      g.state = 'LOST'; g.outcomeReason = 'hearts_depleted'; g.terminalCount += 1;
      emit('round.lost', { reason: g.outcomeReason });
    }
    if (g.state !== 'RUNNING') { g.bow.drawing = false; g.bow.charge = 0; }
  }

  reset();

  return {
    TUNING,
    rig,
    motion,
    get state() { return g.state; },
    get internals() { return g; },
    // R is host-reserved: the host calls reset() for a fresh round.
    reset,
    handleInput(input) {
      if (g.state === 'READY') {
        // The start press is consumed, not spent on a draw.
        const drew = Boolean(input?.consumePress('draw'));
        const sprinted = Boolean(input?.consumePress('sprint'));
        const moving = ['forward', 'backward', 'left', 'right'].some(action => input?.isDown(action));
        if (drew || sprinted || moving) {
          g.state = 'RUNNING';
          emit('round.started', {});
        }
        return;
      }
      if (g.state !== 'RUNNING') { input.consumePress('draw'); return; }
      if (input.consumePress('draw') && !g.bow.drawing) {
        g.bow.drawing = true; g.bow.drawTime = 0; g.bow.charge = 0;
        emit('bow.drawn', {});
      }
    },
    update(dt, input) {
      if (g.state === 'READY') {
        this.handleInput(input);
      }
      const yawIn = (input?.isDown('camLeft') ? 1 : 0) - (input?.isDown('camRight') ? 1 : 0);
      const pitchIn = (input?.isDown('camUp') ? 1 : 0) - (input?.isDown('camDown') ? 1 : 0);
      if (g.state === 'READY') {
        // Idle poses and camera orbit only; AI, arrows and damage stay frozen.
        if (!Number.isFinite(dt) || dt <= 0) return false;
        g.readyTime += dt;
        g.player.animTime += dt;
        for (const m of g.monsters) m.animTime += dt;
        stepCamera(dt, yawIn * TUNING.camYawRate, pitchIn * TUNING.camPitchRate);
        updateAim();
        return false;
      }
      if (g.state !== 'RUNNING') return false;
      this.handleInput(input);
      g.elapsed += dt;
      if (g.bow.drawing) {
        g.bow.drawTime += dt;
        g.bow.charge = Math.min(1, g.bow.drawTime / TUNING.fullDrawSeconds);
        // A held draw whose key was already released (lost edge) still fires.
        if (input && !input.isDown('draw')) fireArrow();
      }
      stepPlayer(dt, input);
      stepCamera(dt, yawIn * TUNING.camYawRate, pitchIn * TUNING.camPitchRate);
      updateAim();
      stepArrows(dt);
      stepRocks(dt);
      stepMonsters(dt);
      checkOutcome();
      if (g.state !== 'RUNNING') return false;
      return true;
    },
    read() {
      const pp = playerPos();
      const monstersById = {};
      for (const m of g.monsters) {
        monstersById[m.id] = { hp: m.hp, maxHp: m.maxHp, state: m.state, alive: m.hp > 0, dist: round(m.pos.distanceTo(pp)) };
      }
      return {
        state: g.state,
        roundId: g.roundId,
        elapsed: round(g.elapsed, 1000),
        readyTime: round(g.readyTime, 1000),
        terminalCount: g.terminalCount,
        outcomeReason: g.outcomeReason,
        events: g.events.map(e => ({ ...e })),
        hearts: hearts.value,
        heartsMax: TUNING.hearts,
        monstersAlive: alive().length,
        monstersTotal: g.monsters.length,
        monstersById,
        player: { x: round(pp.x), y: round(pp.y), z: round(pp.z), yaw: round(motion.yaw, 1000), speed: round(g.player.speed), wading: g.player.wading, invuln: g.player.invuln > 0 },
        camera: { yaw: round(rig.yaw, 1000), pitch: round(rig.pitch, 1000), distance: round(rig.distance) },
        stats: { seconds: round(g.elapsed, 10), accuracy: g.bow.fired ? Math.round(100 * g.bow.hits / g.bow.fired) : 0 },
        shrineDist: round(Math.hypot(pp.x - world.shrine.x, pp.z - world.shrine.z), 1),
        bow: { drawing: g.bow.drawing, charge: round(g.bow.charge), arrowsFired: g.bow.fired, arrowHits: g.bow.hits, arrowsInFlight: g.arrows.filter(a => !a.stuck).length },
        aim: { ...g.aim, hasTarget: g.aim.targetId !== '' },
        diagnostics: {
          activation: { alerted: g.monsters.filter(m => m.state !== 'idle' && m.hp > 0).length },
          targetFilter: { yawWindowDeg: TUNING.aimYawDeg, pitchWindowDeg: TUNING.aimPitchDeg, rangeM: TUNING.aimRange },
        },
      };
    },
  };
}
