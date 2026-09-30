const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const heading = (a, b) => Math.atan2(a.x - b.x, a.z - b.z);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const point = (x, z) => ({ x, z });
const PLAYER_START = point(0, 13);

export function createGame({ obstacles = [] } = {}) {
  const game = { roundId: 0, paused: false, eventId: 0 };
  let pending = [];
  let move = point(0, 0);
  let rollDirection = point(0, 1);
  let attackResolved = false;
  let staminaDelay = 0;
  let immunity = 0;
  let attackBuffer = 0;
  let hitSource = '';

  const emit = (type, extra = {}) => {
    game.events.push({ id: ++game.eventId, type, elapsed: Number(game.elapsed.toFixed(3)), ...extra });
    if (game.events.length > 96) game.events.shift();
  };
  function makeEnemy(id, x, z, health) {
    return {
      id, x, z, home: point(x, z), health, active: false, phase: 'idle', timer: 0,
      yaw: id === 'goat' ? -0.55 : Math.PI, cooldown: 0.7, attackCount: 0, telegraphCount: 0,
      direction: point(0, 0), hit: false, flash: 0, deadTime: 0, moved: false,
    };
  }
  function reset() {
    game.roundId += 1;
    game.eventId = 0;
    Object.assign(game, {
      state: 'READY', paused: false, elapsed: 0, readyTime: 0, terminalCount: 0, outcomeReason: '', events: [],
      player: { ...PLAYER_START, yaw: 0 }, playerHealth: 6, stamina: 100,
      goat: makeEnemy('goat', 3.9, 5.4, 3), boss: makeEnemy('boss', 12, -58, 12),
      action: 'idle', actionTime: 0, invulnerable: 0, attackCount: 0, dodgeCount: 0,
      damageTaken: 0, avoidedHits: 0, hitCount: 0, collisionCount: 0, rejectedActions: 0,
      displacement: 0, hasGameplayActivity: false, inputApplied: false, moving: false,
      cameraYaw: 0, cameraPitch: 0.20, lockedTarget: null, hitFlash: 0, hitSpark: 0,
      sparkPosition: point(0, 0), feedback: '', feedbackTime: 0,
      rollDirection: point(0, 1),
    });
    pending = []; move = point(0, 0); rollDirection = point(0, 1);
    attackResolved = false; staminaDelay = 0; immunity = 0; attackBuffer = 0; hitSource = '';
    // READY: the knight waits at the path head until the first gameplay input,
    // so the round (and the goat/Warden AI) only starts once someone plays.
  }
  function orbitCamera(dt, input) {
    const yawInput = Number(input?.isDown?.('cameraLeft')) - Number(input?.isDown?.('cameraRight'));
    const pitchInput = Number(input?.isDown?.('cameraDown')) - Number(input?.isDown?.('cameraUp'));
    if (!yawInput && !pitchInput) return;
    game.lockedTarget = null;
    game.cameraYaw += yawInput * dt * 1.7;
    game.cameraPitch = clamp(game.cameraPitch + pitchInput * dt, -0.08, 0.85);
  }
  // Any held WASD move or a press of strike / roll / lock / sprint starts the
  // round. The start press is consumed, so it never also swings or rolls.
  function startFrom(input) {
    const moving = ['forward', 'back', 'left', 'right'].some(a => input?.isDown?.(a));
    const presses = ['attack', 'dodge', 'lock', 'sprint'].map(a => Boolean(input?.consumePress?.(a)));
    if (!moving && !presses.some(Boolean)) return;
    pending = [];
    game.state = 'RUNNING';
    emit('round.started');
  }
  function feedback(text) { game.feedback = text; game.feedbackTime = 1.8; }
  function terminal(state, reason) {
    if (game.state !== 'RUNNING') return;
    game.state = state; game.outcomeReason = reason; game.terminalCount += 1;
    game.action = 'idle'; game.actionTime = 0; game.invulnerable = 0;
    game.moving = false; game.inputApplied = false; game.lockedTarget = null;
    game.boss.phase = 'idle'; game.goat.phase = 'idle';
    pending = []; attackBuffer = 0;
    emit(state === 'WON' ? 'round.won' : 'round.lost', { reason });
  }
  function target() {
    const locked = game[game.lockedTarget];
    if (locked?.health > 0 && distance(game.player, locked) < 32) return locked;
    return [game.goat, game.boss].filter(e => e.health > 0 && distance(game.player, e) < 6)
      .sort((a, b) => distance(game.player, a) - distance(game.player, b))[0];
  }
  function spend(amount) {
    if (game.stamina < amount) { feedback('Not enough stamina — catch your breath'); game.rejectedActions++; return false; }
    game.stamina -= amount; staminaDelay = 0.6; return true;
  }
  function attack() {
    if (game.action !== 'idle') {
      if (game.action === 'attack' && game.actionTime > 0.48) attackBuffer = 0.22;
      else game.rejectedActions++;
      return;
    }
    if (!spend(22)) return;
    const enemy = target();
    if (enemy) game.player.yaw = heading(game.player, enemy);
    game.action = 'attack'; game.actionTime = 0; attackResolved = false;
    game.attackCount++; emit('player.attack');
  }
  function dodge() {
    if (game.action !== 'idle' && !(game.action === 'attack' && game.actionTime > 0.45)) { game.rejectedActions++; return; }
    if (!spend(28)) return;
    const length = Math.hypot(move.x, move.z);
    rollDirection = length ? { ...move } : { x: Math.sin(game.player.yaw), z: Math.cos(game.player.yaw) };
    game.rollDirection = { ...rollDirection };
    game.action = 'dodge'; game.actionTime = 0; game.invulnerable = 0.5;
    game.dodgeCount++; attackBuffer = 0; emit('player.dodge');
  }
  function toggleLock() {
    if (game.lockedTarget) { game.lockedTarget = null; return; }
    const nearest = [game.goat, game.boss].filter(e => e.health > 0 && distance(game.player, e) < 32)
      .sort((a, b) => distance(game.player, a) - distance(game.player, b))[0];
    if (nearest) {
      game.lockedTarget = nearest.id;
      feedback(nearest.id === 'boss' ? 'Locked · Stone Warden' : 'Locked · wild goat');
    }
  }
  game.clearInput = () => { pending = []; attackBuffer = 0; move = point(0, 0); };
  game.handleInput = input => {
    if (game.state === 'READY' && !game.paused) { startFrom(input); return; }
    if (game.state !== 'RUNNING' || game.paused) { pending = []; return; }
    const pressed = name => input?.consumePress?.(name) || pending.includes(name);
    const mx = Number(input?.isDown?.('right')) - Number(input?.isDown?.('left'));
    const mz = Number(input?.isDown?.('back')) - Number(input?.isDown?.('forward'));
    const len = Math.hypot(mx, mz) || 1, c = Math.cos(game.cameraYaw), s = Math.sin(game.cameraYaw);
    move = { x: (mx * c + mz * s) / len, z: (-mx * s + mz * c) / len };
    if (pressed('lock')) toggleLock();
    if (pressed('dodge')) dodge();
    if (pressed('attack')) attack();
    pending = [];
  };
  function resolveMovement(actor, dx, dz, radius, skipEnemy = false) {
    const old = point(actor.x, actor.z);
    actor.x = clamp(actor.x + dx, -26 + radius, 30 - radius);
    actor.z = clamp(actor.z + dz, -75 + radius, 35 - radius);
    let collided = actor.x !== old.x + dx || actor.z !== old.z + dz;
    const solids = skipEnemy ? obstacles : [...obstacles, ...[game.goat, game.boss]
      .filter(e => e.health > 0).map(e => ({ x: e.x, z: e.z, radius: e.id === 'boss' ? 1.45 : 0.65 }))];
    for (const obstacle of solids) {
      const x = actor.x - obstacle.x, z = actor.z - obstacle.z, dist = Math.hypot(x, z), reach = radius + obstacle.radius;
      if (dist >= reach) continue;
      const nx = dist > 0.001 ? x / dist : 1, nz = dist > 0.001 ? z / dist : 0;
      actor.x = obstacle.x + nx * reach; actor.z = obstacle.z + nz * reach;
      collided = true;
    }
    if (actor === game.player) {
      game.displacement += distance(old, actor);
      if (collided && (dx || dz)) game.collisionCount++;
    }
  }
  function hurt(amount, source) {
    if (game.state !== 'RUNNING') return;
    if (game.invulnerable > 0) { game.avoidedHits++; emit('player.evade', { source }); feedback('Dodge successful'); return; }
    if (immunity > 0) return;
    game.playerHealth = Math.max(0, game.playerHealth - amount);
    game.damageTaken += amount; game.hitFlash = 0.38; immunity = 0.85; hitSource = source;
    emit('player.hit', { source, remaining: game.playerHealth });
    feedback(source === 'boss' ? 'Heavy blow — watch the red warning, then roll' : 'Goat charge — step off its line');
    if (!game.playerHealth) {
      terminal('LOST', source === 'boss'
        ? 'You fall under the Stone Warden’s strike.'
        : 'The wild goat’s charge takes the last of your health.');
    }
  }
  function resolveStrike() {
    const p = game.player;
    let didHit = false;
    for (const e of [game.goat, game.boss]) {
      if (e.health <= 0) continue;
      const d = distance(p, e), range = e.id === 'boss' ? 4.5 : 2.65;
      if (d > range || Math.abs(wrap(heading(p, e) - p.yaw)) > 1.1) continue;
      e.health = Math.max(0, e.health - (e.id === 'boss' ? 2 : 1));
      e.active = true; e.flash = 0.24; game.hitCount++; didHit = true;
      game.hitSpark = 0.25; game.sparkPosition = point((p.x + e.x) / 2, (p.z + e.z) / 2);
      emit(`${e.id}.hit`, { remaining: e.health });
      if (e.id === 'goat') { e.phase = 'recover'; e.timer = 0.7; }
      if (e.health === 0) {
        e.active = false; emit(`${e.id}.defeated`);
        if (game.lockedTarget === e.id) game.lockedTarget = null;
        if (e.id === 'boss') { terminal('WON', 'The stone oath breaks. The Warden falls. The highland is still again.'); return; }
        feedback('Goat down · continue toward the distant stone circle');
      }
    }
    if (!didHit) emit('player.attack.miss');
  }
  function enemyUpdate(e, dt) {
    e.flash = Math.max(0, e.flash - dt); e.moved = false;
    if (e.health <= 0) { e.deadTime += dt; return; }
    const boss = e.id === 'boss', p = game.player;
    const d = distance(p, e), alert = boss ? 26 : 6.7;
    if (!e.active && d < alert) {
      e.active = true; e.phase = 'pursue';
      emit(boss ? 'boss.awaken' : 'goat.alert');
      feedback(boss ? 'The Stone Warden has awakened' : 'The goat has noticed you — watch the charge');
    }
    if (!e.active) return;
    if (d > (boss ? 39 : 17) && e.phase === 'pursue') {
      e.active = false; e.phase = 'idle'; return;
    }
    if (e.phase === 'idle') e.phase = 'pursue';
    e.cooldown = Math.max(0, e.cooldown - dt);
    if (e.phase === 'pursue') {
      e.yaw = heading(e, p);
      const stopRange = boss ? 3.65 : 1.9;
      if (d > stopRange) {
        const speed = boss ? 2.45 : 2.8;
        resolveMovement(e, (p.x - e.x) / d * speed * dt, (p.z - e.z) / d * speed * dt, boss ? 1.45 : 0.65, true);
        e.moved = true;
      }
      if (d < (boss ? 5.2 : 3.3) && e.cooldown <= 0) {
        e.phase = 'telegraph'; e.timer = boss ? 1.05 : 0.8; e.telegraphCount++;
        e.direction = { x: (p.x - e.x) / Math.max(d, 0.001), z: (p.z - e.z) / Math.max(d, 0.001) };
        emit(`${e.id}.telegraph`);
      }
    } else if (e.phase === 'telegraph') {
      e.timer -= dt;
      if (e.timer <= 0) {
        e.phase = 'impact'; e.timer = boss ? 0.38 : 0.32; e.attackCount++; e.hit = false;
        emit(`${e.id}.attack`);
        if (boss) {
          if (d <= 5.2) hurt(2, 'boss'); else emit('boss.attack.miss');
        }
      }
    } else if (e.phase === 'impact') {
      e.timer -= dt;
      if (!boss) {
        resolveMovement(e, e.direction.x * 10 * dt, e.direction.z * 10 * dt, 0.65, true);
        if (!e.hit && distance(p, e) < 1.8) { e.hit = true; hurt(1, 'goat'); }
      }
      if (e.timer <= 0) { e.phase = 'recover'; e.timer = boss ? 1.6 : 1.0; }
    } else if (e.phase === 'recover') {
      e.timer -= dt;
      if (e.timer <= 0) { e.phase = 'pursue'; e.cooldown = boss ? 0.35 : 0.45; }
    }
  }
  game.update = (dt, input) => {
    if (game.state === 'READY' && !game.paused) {
      // Idle poses and camera orbit only; AI, stamina and damage stay frozen.
      game.readyTime += dt;
      orbitCamera(dt, input);
      return false;
    }
    if (game.state !== 'RUNNING' || game.paused) return false;
    game.elapsed += dt;
    game.hitFlash = Math.max(0, game.hitFlash - dt); game.hitSpark = Math.max(0, game.hitSpark - dt);
    game.feedbackTime = Math.max(0, game.feedbackTime - dt); immunity = Math.max(0, immunity - dt);
    staminaDelay = Math.max(0, staminaDelay - dt); attackBuffer = Math.max(0, attackBuffer - dt);
    orbitCamera(dt, input);
    const locked = game[game.lockedTarget];
    if (locked?.health > 0 && distance(game.player, locked) < 32) {
      const targetYaw = heading(game.player, locked);
      game.cameraYaw += wrap(targetYaw - game.cameraYaw) * Math.min(1, dt * 6);
      if (game.action === 'idle') game.player.yaw = targetYaw;
    } else game.lockedTarget = null;
    const mx = Number(input?.isDown?.('right')) - Number(input?.isDown?.('left'));
    const mz = Number(input?.isDown?.('back')) - Number(input?.isDown?.('forward'));
    const len = Math.hypot(mx, mz) || 1, c = Math.cos(game.cameraYaw), s = Math.sin(game.cameraYaw);
    move = { x: (mx * c + mz * s) / len, z: (-mx * s + mz * c) / len };
    const moving = Math.hypot(move.x, move.z) > 0.1;
    game.inputApplied = moving; game.moving = moving && game.action === 'idle';
    if (moving || game.action !== 'idle') game.hasGameplayActivity = true;
    let speed = game.action === 'attack' ? 1.3 : 5.6;
    if (input?.isDown?.('sprint') && moving && game.action === 'idle' && game.stamina > 5) {
      speed = 8.2; game.stamina = Math.max(0, game.stamina - dt * 14); staminaDelay = 0.4;
    }
    if (game.action === 'dodge') {
      game.actionTime += dt;
      game.invulnerable = game.actionTime < 0.50 ? 0.5 - game.actionTime : 0;
      const t = game.actionTime / 0.66;
      resolveMovement(game.player, rollDirection.x * 7.8 * dt * (1 - t * 0.25), rollDirection.z * 7.8 * dt * (1 - t * 0.25), 0.42);
      if (t >= 1) { game.action = 'idle'; game.actionTime = 0; game.invulnerable = 0; }
    } else {
      if (moving) {
        resolveMovement(game.player, move.x * speed * dt, move.z * speed * dt, 0.5);
        if (game.action === 'idle' && !game.lockedTarget) game.player.yaw = Math.atan2(-move.x, -move.z);
      }
      if (game.action === 'attack') {
        game.actionTime += dt;
        if (!attackResolved && game.actionTime >= 0.24) { attackResolved = true; resolveStrike(); }
        if (game.state !== 'RUNNING') return false;
        if (game.actionTime >= 0.66) { game.action = 'idle'; game.actionTime = 0; if (attackBuffer > 0) attack(); }
      }
    }
    if (staminaDelay <= 0 && game.action === 'idle') game.stamina = Math.min(100, game.stamina + dt * 30);
    enemyUpdate(game.goat, dt);
    if (game.state !== 'RUNNING') return false;
    enemyUpdate(game.boss, dt);
    return game.state === 'RUNNING';
  };
  game.read = () => {
    const p = game.player, b = game.boss, g = game.goat;
    const precise = n => Number(n.toFixed(3));
    return {
      state: game.state, paused: game.paused, roundId: game.roundId, elapsed: precise(game.elapsed), readyTime: precise(game.readyTime),
      terminalCount: game.terminalCount, outcomeReason: game.outcomeReason, events: game.events.map(e => ({ ...e })),
      playerHealth: game.playerHealth, bossHealth: b.health, goatHealth: g.health, stamina: precise(game.stamina),
      playerAction: game.action, playerActionTime: precise(game.actionTime), invulnerable: precise(game.invulnerable),
      playerPosition: { x: precise(p.x), y: 0, z: precise(p.z) }, playerYaw: precise(p.yaw),
      bossPosition: { x: precise(b.x), z: precise(b.z) }, goatPosition: { x: precise(g.x), z: precise(g.z) },
      bossDistance: precise(distance(p, b)), goatDistance: precise(distance(p, g)),
      bossRelativeX: precise(b.x - p.x), bossRelativeZ: precise(b.z - p.z),
      goatRelativeX: precise(g.x - p.x), goatRelativeZ: precise(g.z - p.z),
      cameraYaw: precise(game.cameraYaw), cameraPitch: precise(game.cameraPitch), lockedTarget: game.lockedTarget,
      bossActive: b.active, goatActive: g.active, bossAttackPhase: b.phase, goatAttackPhase: g.phase,
      bossWindup: precise(b.timer), goatWindup: precise(g.timer), bossTelegraphCount: b.telegraphCount,
      bossAttackCount: b.attackCount, goatAttackCount: g.attackCount, attackCount: game.attackCount, dodgeCount: game.dodgeCount,
      hitCount: game.hitCount, damageTaken: game.damageTaken, avoidedHits: game.avoidedHits,
      collisionCount: game.collisionCount, rejectedActions: game.rejectedActions, displacement: precise(game.displacement),
      inputApplied: game.inputApplied, hitFlash: game.hitFlash, hitSource, feedback: game.feedbackTime > 0 ? game.feedback : '',
    };
  };
  game.reset = reset;
  reset();
  return game;
}
