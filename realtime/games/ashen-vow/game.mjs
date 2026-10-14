const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const normalize = (x, z) => {
  const length = Math.hypot(x, z);
  return length > 1e-8 ? { x: x / length, z: z / length } : { x: 0, z: 0 };
};

const ARENA_RADIUS = 11.4;
const MAX_EVENTS = 128;

function makeWarden(id, x, z, tint) {
  return {
    id, kind: 'warden', tint, x, z, hp: 48, maxHp: 48, alive: true,
    attackRange: 1.95, moveSpeed: 1.65, damage: 12, attackCooldown: 0.35,
    windup: 0, flash: 0, pose: 'idle', deathTimer: 0,
  };
}

function makeBoss() {
  return {
    id: 'asterion', kind: 'boss', x: 0, z: -7.2, hp: 168, maxHp: 168, alive: false,
    attackRange: 3.05, moveSpeed: 1.15, damage: 19, attackCooldown: 0.8,
    windup: 0, flash: 0, pose: 'idle', deathTimer: 0,
  };
}

export function createGame() {
  let roundId = 0;
  let eventSequence = 0;
  let state = null;
  let pendingAttack = false;
  let pendingDash = false;
  let pendingNova = false;
  let pendingPause = false;
  let pointerActions = [];

  // A round opens in READY: the exile holds in the chamber, wardens wait, and
  // no clock runs until the first move or ability, so the model frame rate
  // settles before combat. readyTime drives the idle animation meanwhile.
  const makeState = () => ({
    state: 'READY',
    readyTime: 0,
    paused: false,
    phase: 'WARDENS',
    wardensDefeated: 0,
    totalWardens: 2,
    bossSpawned: false,
    bossDefeated: false,
    playerHealth: 100,
    playerMaxHealth: 100,
    playerX: 0,
    playerZ: 7,
    playerFacing: 0,
    playerMoving: false,
    dashCount: 0,
    novaCount: 0,
    attackCount: 0,
    comboStep: 0,
    attackReady: true,
    attackCooldown: 0,
    dashCharges: 2,
    dashMaxCharges: 2,
    dashRecharge: 0,
    novaReady: true,
    novaCooldown: 0,
    invulnerable: 0,
    hitFlash: 0,
    elapsed: 0,
    outcomeReason: '',
    roundId,
    terminalCount: 0,
    lastEvent: 'round.started',
    events: [],
    wardens: [
      makeWarden('warden-violet', -4, -1.1, 'violet'),
      makeWarden('warden-rust', 4, -3.2, 'rust'),
    ],
    boss: makeBoss(),
  });

  const emit = (type, detail = {}) => {
    const event = { id: ++eventSequence, type, ...detail, elapsed: Number(state.elapsed.toFixed(3)) };
    state.events.push(event);
    if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
    state.lastEvent = type;
    return event;
  };

  const clearCombat = () => {
    pendingAttack = pendingDash = pendingNova = false;
    pointerActions = [];
    if (state) state.playerMoving = false;
  };

  const containPlayer = () => {
    const radius = Math.hypot(state.playerX, state.playerZ);
    const limit = ARENA_RADIUS - 0.65;
    if (radius > limit) { state.playerX *= limit / radius; state.playerZ *= limit / radius; }
  };

  const togglePause = () => {
    if (state.state !== 'RUNNING') return;
    clearCombat();
    state.paused = !state.paused;
    emit(state.paused ? 'round.paused' : 'round.resumed');
  };

  const reset = () => {
    roundId += 1;
    eventSequence = 0;
    pendingAttack = pendingDash = pendingNova = pendingPause = false;
    pointerActions = [];
    state = makeState();
  };

  const finishWin = () => {
    if (state.state !== 'RUNNING') return;
    clearCombat();
    state.state = 'WON';
    state.phase = 'COMPLETE';
    state.bossDefeated = true;
    state.boss.alive = false;
    state.boss.pose = 'death';
    state.terminalCount = 1;
    state.outcomeReason = 'Asterion fell and the Last Gate opens.';
    emit('boss.defeated', { bossId: state.boss.id });
    emit('round.won', { outcomeReason: state.outcomeReason });
  };

  const finishLoss = () => {
    if (state.state !== 'RUNNING') return;
    clearCombat();
    state.state = 'LOST';
    state.phase = 'LOST';
    state.playerHealth = 0;
    state.terminalCount = 1;
    state.outcomeReason = 'The wardens claimed the exile in Erebus.';
    emit('round.lost', { outcomeReason: state.outcomeReason });
  };

  const hurtPlayer = (amount, source) => {
    if (state.state !== 'RUNNING' || state.invulnerable > 0) return false;
    state.playerHealth = Math.max(0, state.playerHealth - amount);
    state.hitFlash = 0.22;
    emit('player.hit', { source, amount, health: state.playerHealth });
    if (state.playerHealth <= 0) finishLoss();
    return true;
  };

  const enemyList = () => {
    const living = state.wardens.filter(enemy => enemy.alive);
    if (state.boss.alive) living.push(state.boss);
    return living;
  };

  const chooseTarget = () => {
    let best = null;
    let bestDistance = Infinity;
    for (const enemy of enemyList()) {
      const d = distance(state.playerX, state.playerZ, enemy.x, enemy.z);
      if (d < bestDistance) { best = enemy; bestDistance = d; }
    }
    return best ? { enemy: best, distance: bestDistance } : null;
  };

  const performAttack = () => {
    if (state.state !== 'RUNNING' || state.attackCooldown > 0) return false;
    state.attackCount += 1;
    state.comboStep = (state.comboStep % 3) + 1;
    state.attackCooldown = 0.28;
    state.attackReady = false;
    const target = chooseTarget();
    if (target && target.distance <= 4.25) state.playerFacing = Math.atan2(state.playerX - target.enemy.x, state.playerZ - target.enemy.z);
    emit('attack.committed', { comboStep: state.comboStep, targetId: target?.enemy.id ?? null });
    if (!target || target.distance > 4.25) return true;
    const damage = 28 + state.comboStep * 4;
    const enemy = target.enemy;
    enemy.hp = Math.max(0, enemy.hp - damage);
    enemy.flash = 0.16;
    enemy.pose = 'hit';
    emit('attack.hit', { targetId: enemy.id, damage, remainingHp: enemy.hp });
    if (enemy.hp <= 0) {
      enemy.alive = false;
      enemy.deathTimer = 0.7;
      enemy.pose = 'death';
      if (enemy.kind === 'warden') {
        state.wardensDefeated += 1;
        emit('warden.defeated', { wardenId: enemy.id, wardensDefeated: state.wardensDefeated });
        if (state.wardensDefeated === state.totalWardens) {
          state.phase = 'BOSS';
          state.bossSpawned = true;
          state.boss.alive = true;
          state.boss.hp = state.boss.maxHp;
          state.boss.x = 0;
          state.boss.z = -7.2;
          emit('boss.spawned', { bossId: state.boss.id, wardensDefeated: state.wardensDefeated });
        }
      } else {
        finishWin();
      }
    }
    return true;
  };

  const performNova = () => {
    if (state.state !== 'RUNNING' || !state.novaReady) return false;
    state.novaCount += 1;
    state.novaReady = false;
    state.novaCooldown = 5;
    emit('nova.committed', {});
    for (const enemy of enemyList()) {
      if (distance(state.playerX, state.playerZ, enemy.x, enemy.z) > 5.7) continue;
      const damage = enemy.kind === 'boss' ? 30 : 34;
      enemy.hp = Math.max(0, enemy.hp - damage);
      enemy.flash = 0.2;
      emit('nova.hit', { targetId: enemy.id, damage, remainingHp: enemy.hp });
      if (enemy.hp <= 0) {
        enemy.alive = false;
        enemy.deathTimer = 0.7;
        enemy.pose = 'death';
        if (enemy.kind === 'warden') {
          state.wardensDefeated += 1;
          emit('warden.defeated', { wardenId: enemy.id, wardensDefeated: state.wardensDefeated });
        } else {
          finishWin();
        }
      }
    }
    if (state.wardensDefeated === state.totalWardens && !state.bossSpawned && state.state === 'RUNNING') {
      state.phase = 'BOSS';
      state.bossSpawned = true;
      state.boss.alive = true;
      state.boss.hp = state.boss.maxHp;
      state.boss.x = 0;
      state.boss.z = -7.2;
      emit('boss.spawned', { bossId: state.boss.id, wardensDefeated: state.wardensDefeated });
    }
    return true;
  };

  const performDash = (input) => {
    if (state.state !== 'RUNNING' || state.dashCharges <= 0) return false;
    let x = input?.axis?.('left', 'right') ?? 0;
    let z = input?.axis?.('up', 'down') ?? 0;
    if (!x && !z) z = -1;
    const dir = normalize(x, z);
    state.playerX = clamp(state.playerX + dir.x * 2.25, -ARENA_RADIUS + 0.7, ARENA_RADIUS - 0.7);
    state.playerZ = clamp(state.playerZ + dir.z * 2.25, -ARENA_RADIUS + 0.7, ARENA_RADIUS - 0.7);
    containPlayer();
    state.playerFacing = Math.atan2(-dir.x, -dir.z);
    state.dashCount += 1;
    state.dashCharges -= 1;
    state.dashRecharge = 0;
    state.invulnerable = 0.34;
    emit('dash.committed', { charges: state.dashCharges });
    return true;
  };

  const handlePointerAction = action => {
    if (state.state !== 'RUNNING') return;
    if (action === 'attack') pointerActions.push('attack');
    if (action === 'nova') pointerActions.push('nova');
  };

  reset();

  return {
    enqueue(action) { handlePointerAction(action); },
    restart: reset,
    togglePause,
    clearInput: clearCombat,
    isActive: () => state.state === 'RUNNING',
    handleInput(input) {
      if (state.state === 'READY') {
        // The start press is consumed, not spent on a slash or dash. Pause
        // presses are dropped: there is nothing to pause yet.
        const pressed = ['attack', 'dash', 'nova'].map(action => input?.consumePress(action) ?? false).some(Boolean);
        const moving = ['left', 'right', 'up', 'down'].some(action => input?.isDown(action));
        input?.consumePress('pause');
        pointerActions = [];
        if (pressed || moving) {
          state.state = 'RUNNING';
          emit('round.started', { roundId });
        }
        return;
      }
      if (input) {
        if (input.consumePress('pause')) pendingPause = true;
        if (input.consumePress('attack')) pendingAttack = true;
        if (input.consumePress('dash')) pendingDash = true;
        if (input.consumePress('nova')) pendingNova = true;
      }
      for (const action of pointerActions.splice(0)) {
        if (action === 'attack') pendingAttack = true;
        if (action === 'nova') pendingNova = true;
      }
      if (pendingPause) {
        pendingPause = false;
        togglePause();
        input?.clear();
        return;
      }
      if (state.state !== 'RUNNING' || state.paused) { clearCombat(); return; }
      if (pendingDash) {
        pendingDash = false;
        performDash(input);
      }
    },
    update(dt, input) {
      if (state.state === 'READY' && Number.isFinite(dt) && dt > 0) { state.readyTime += dt; return true; }
      if (!Number.isFinite(dt) || dt < 0 || state.state !== 'RUNNING' || state.paused) return false;
      state.elapsed += dt;
      state.attackCooldown = Math.max(0, state.attackCooldown - dt);
      state.attackReady = state.attackCooldown <= 1e-6;
      state.novaCooldown = Math.max(0, state.novaCooldown - dt);
      if (state.novaCooldown <= 0) state.novaReady = true;
      state.invulnerable = Math.max(0, state.invulnerable - dt);
      state.hitFlash = Math.max(0, state.hitFlash - dt);
      if (state.dashCharges < state.dashMaxCharges) {
        state.dashRecharge += dt;
        if (state.dashRecharge >= 1.7) {
          state.dashCharges += 1;
          state.dashRecharge = 0;
          emit('dash.recharged', { charges: state.dashCharges });
        }
      }

      if (pendingAttack) { pendingAttack = false; performAttack(); }
      if (pendingNova) { pendingNova = false; performNova(); }
      if (state.state !== 'RUNNING') return false;

      const dx = input?.axis?.('left', 'right') ?? 0;
      const dz = input?.axis?.('up', 'down') ?? 0;
      const move = normalize(dx, dz);
      const moving = Boolean(dx || dz);
      state.playerMoving = moving;
      if (moving) {
        if (state.attackCooldown < 0.08) state.playerFacing = Math.atan2(-dx, -dz);
        const speed = 5.1;
        state.playerX = clamp(state.playerX + move.x * speed * dt, -ARENA_RADIUS + 0.65, ARENA_RADIUS - 0.65);
        state.playerZ = clamp(state.playerZ + move.z * speed * dt, -ARENA_RADIUS + 0.65, ARENA_RADIUS - 0.65);
      }

      containPlayer();
      for (const enemy of state.wardens) {
        updateEnemy(enemy, dt);
        if (state.state !== 'RUNNING') return false;
      }
      if (state.boss.alive) updateEnemy(state.boss, dt);
      for (const enemy of [...state.wardens, state.boss]) {
        enemy.flash = Math.max(0, enemy.flash - dt);
        if (!enemy.alive && enemy.deathTimer > 0) enemy.deathTimer = Math.max(0, enemy.deathTimer - dt);
      }
      if (state.playerHealth <= 0) finishLoss();
      return state.state === 'RUNNING';
    },
    read() {
      return structuredClone({
        state: state.state,
        paused: state.paused,
        phase: state.phase,
        wardensDefeated: state.wardensDefeated,
        totalWardens: state.totalWardens,
        bossSpawned: state.bossSpawned,
        bossDefeated: state.bossDefeated,
        playerHealth: Number(state.playerHealth.toFixed(3)),
        playerMaxHealth: state.playerMaxHealth,
        playerX: Number(state.playerX.toFixed(3)),
        playerZ: Number(state.playerZ.toFixed(3)),
        attackCount: state.attackCount,
        dashCount: state.dashCount,
        novaCount: state.novaCount,
        playerFacing: state.playerFacing,
        playerMoving: state.playerMoving,
        hitFlash: state.hitFlash,
        playerRadius: Number(Math.hypot(state.playerX, state.playerZ).toFixed(3)),
        nearestEnemyDistance: Number((chooseTarget()?.distance ?? 99).toFixed(3)),
        wardenOneHp: state.wardens[0].hp,
        wardenTwoHp: state.wardens[1].hp,
        bossHealth: state.boss.hp,
        comboStep: state.comboStep,
        attackReady: state.attackReady,
        attackCooldown: Number(state.attackCooldown.toFixed(3)),
        dashCharges: state.dashCharges,
        dashMaxCharges: state.dashMaxCharges,
        dashRecharge: Number(state.dashRecharge.toFixed(3)),
        novaReady: state.novaReady,
        novaCooldown: Number(state.novaCooldown.toFixed(3)),
        invulnerable: Number(state.invulnerable.toFixed(3)),
        elapsed: Number(state.elapsed.toFixed(3)),
        readyTime: Number(state.readyTime.toFixed(3)),
        outcomeReason: state.outcomeReason,
        roundId: state.roundId,
        terminalCount: state.terminalCount,
        lastEvent: state.lastEvent,
        events: state.events,
        wardens: state.wardens.map(enemy => ({
          id: enemy.id, tint: enemy.tint, alive: enemy.alive,
          hp: Number(enemy.hp.toFixed(3)), maxHp: enemy.maxHp,
          x: Number(enemy.x.toFixed(3)), z: Number(enemy.z.toFixed(3)),
          windup: Number(enemy.windup.toFixed(3)), flash: Number(enemy.flash.toFixed(3)),
          pose: enemy.pose,
        })),
        boss: {
          id: state.boss.id, alive: state.boss.alive, hp: Number(state.boss.hp.toFixed(3)),
          maxHp: state.boss.maxHp, x: Number(state.boss.x.toFixed(3)), z: Number(state.boss.z.toFixed(3)),
          windup: Number(state.boss.windup.toFixed(3)), flash: Number(state.boss.flash.toFixed(3)),
          pose: state.boss.pose,
        },
      });
    },
  };

  function updateEnemy(enemy, dt) {
    if (!enemy.alive) return;
    enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
    if (enemy.windup > 0) {
      enemy.windup -= dt;
      enemy.pose = 'attack';
      if (enemy.windup <= 0) {
        const d = distance(state.playerX, state.playerZ, enemy.x, enemy.z);
        if (d <= enemy.attackRange + 0.35) hurtPlayer(enemy.damage, enemy.id);
        enemy.attackCooldown = enemy.kind === 'boss' ? 1.35 : 1.05;
        enemy.pose = 'idle';
      }
      return;
    }
    const d = distance(state.playerX, state.playerZ, enemy.x, enemy.z);
    if (d > enemy.attackRange * 0.88) {
      const dir = normalize(state.playerX - enemy.x, state.playerZ - enemy.z);
      const speed = enemy.moveSpeed * (enemy.kind === 'boss' ? 1 : 1.12);
      enemy.x = clamp(enemy.x + dir.x * speed * dt, -ARENA_RADIUS + 0.8, ARENA_RADIUS - 0.8);
      enemy.z = clamp(enemy.z + dir.z * speed * dt, -ARENA_RADIUS + 0.8, ARENA_RADIUS - 0.8);
      enemy.pose = 'move';
    } else if (enemy.attackCooldown <= 0) {
      enemy.windup = enemy.kind === 'boss' ? 0.78 : 0.46;
      enemy.pose = 'attack';
      emit('enemy.telegraph', { enemyId: enemy.id, windup: enemy.windup });
    } else {
      enemy.pose = 'idle';
    }
  }
}

