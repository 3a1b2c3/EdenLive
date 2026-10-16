// SPDX-License-Identifier: Apache-2.0
// Warehouse Sokoban rules: push two crates onto two pads, one tile at a time.
// Legend: # wall, . floor, G goal pad, B crate, P worker start.
export const LEVEL = [
  '#########',
  '#...#...#',
  '#.G.#.G.#',
  '#.......#',
  '#.B...B.#',
  '#...#...#',
  '#...P...#',
  '#########',
];
export const W = LEVEL[0].length, H = LEVEL.length;

export function parseLevel() {
  const walls = [], goals = [], boxes = []; let player = null;
  LEVEL.forEach((row, z) => [...row].forEach((c, x) => {
    if (c === '#') walls.push({ x, z });
    if (c === 'G') goals.push({ x, z });
    if (c === 'B') boxes.push({ x, z });
    if (c === 'P') player = { x, z };
  }));
  return { walls, goals, boxes, player };
}

export function createGame() {
  const lv = parseLevel();
  let s, seq = 0, round = 0;
  const emit = (type, data = {}) => { s.events.push({ id: ++seq, type, t: +s.elapsed.toFixed(3), ...data }); if (s.events.length > 80) s.events = s.events.slice(-80); };
  const isWall = (x, z) => lv.walls.some((w) => w.x === x && w.z === z);
  const isGoal = (x, z) => lv.goals.some((g) => g.x === x && g.z === z);
  function reset() {
    s = {
      state: 'RUNNING', roundId: ++round, elapsed: 0, terminalCount: 0, outcomeReason: '', events: [], paused: false,
      player: { x: lv.player.x, z: lv.player.z, yaw: Math.PI, y: 0 },
      boxes: lv.boxes.map((b) => ({ ...b })), goals: lv.goals.map((g) => ({ ...g })), walls: lv.walls.map((w) => ({ ...w })),
      moves: 0, pushes: 0, blocked: 0, kills: 0,
    };
  }
  function end(state, reason) { if (s.state !== 'RUNNING') return; s.state = state; s.outcomeReason = reason; s.terminalCount++; emit(state === 'WON' ? 'round.won' : 'round.lost', { reason }); }
  function step(dx, dz) {
    const x = s.player.x + dx, z = s.player.z + dz, box = s.boxes.find((b) => b.x === x && b.z === z);
    s.player.yaw = Math.atan2(dx, dz);
    if (isWall(x, z) || (box && (isWall(x + dx, z + dz) || s.boxes.some((c) => c.x === x + dx && c.z === z + dz)))) {
      s.blocked++; emit('move.blocked', { x, z, dx, dz, box: !!box }); return;
    }
    const from = { x: s.player.x, z: s.player.z };
    if (box) {
      box.x += dx; box.z += dz; s.pushes++;
      emit('box.pushed', { x: box.x, z: box.z, dx, dz, onGoal: isGoal(box.x, box.z) });
      if (isGoal(box.x, box.z)) emit('box.on_goal', { x: box.x, z: box.z });
    }
    s.player.x = x; s.player.z = z; s.moves++;
    emit('player.moved', { x, z, dx, dz, fromX: from.x, fromZ: from.z });
    if (s.boxes.every((b) => isGoal(b.x, b.z))) { end('WON', 'Both crates are on their destination pads.'); return; }
    if (box && !isGoal(box.x, box.z) && (isWall(box.x - 1, box.z) || isWall(box.x + 1, box.z)) && (isWall(box.x, box.z - 1) || isWall(box.x, box.z + 1))) end('LOST', 'A crate is stuck in a wall corner.');
  }
  function handleInput(k) {
    if (k.consumePress('restart')) { reset(); k.clear(); return; }
    if (k.consumePress('pause') && s.state === 'RUNNING') { s.paused = !s.paused; k.clear(); return; }
    if (s.state !== 'RUNNING' || s.paused) return;
    for (const [a, dx, dz] of [['forward', 0, -1], ['back', 0, 1], ['left', -1, 0], ['right', 1, 0]]) if (k.consumePress(a)) { step(dx, dz); break; }
  }
  function update(dt) { if (s.state !== 'RUNNING' || s.paused) return false; s.elapsed += dt; }
  function read() {
    return structuredClone({ ...s, goalsFilled: s.boxes.filter((b) => isGoal(b.x, b.z)).length, w: W, h: H, health: 100, maxHealth: 100 });
  }
  reset();
  return { handleInput, update, read, reset };
}
