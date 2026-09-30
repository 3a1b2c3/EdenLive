import { DIRECTIONS, LEVELS, keyOf, parseLevel, walkingPaths } from './levels.mjs';

const copyCrates = crates => crates.map(crate => ({ ...crate }));

// Rules own all committed positions, counters and outcomes. Rendering never
// changes a board, and the observation adapter can only return detached copies.
export function createGame({ levels = LEVELS } = {}) {
  let levelIndex = 0, board, player, crates, direction;
  let state, outcomeReason, moves, pushes, terminalCount;
  let roundId = 0, eventId = 0, events = [], history = [], contact = null;
  function emit(type, details = {}) {
    events.push({ id: ++eventId, type, ...details });
    if (events.length > 64) events.shift();
  }
  function reset(index = levelIndex) {
    if (!Number.isInteger(index) || index < 0 || index >= levels.length) return false;
    levelIndex = index; board = parseLevel(levels[index]);
    player = { ...board.player }; crates = copyCrates(board.crates); direction = 'down';
    state = 'RUNNING'; outcomeReason = null; moves = pushes = terminalCount = 0;
    history = []; events = []; eventId = 0; contact = null; roundId += 1;
    return true;
  }
  const goalsFilled = () => crates.filter(c => board.goals.has(keyOf(c.x, c.y))).length;
  function finish(won, reason) {
    if (state !== 'RUNNING') return;
    state = won ? 'WON' : 'LOST'; outcomeReason = reason; terminalCount = 1;
    emit(won ? 'round.won' : 'round.lost', { moves, pushes, outcomeReason });
  }
  function move(name) {
    if (state !== 'RUNNING' || !DIRECTIONS[name]) return { accepted: false, reason: 'inactive' };
    const [dx, dy] = DIRECTIONS[name];
    const target = { x: player.x + dx, y: player.y + dy };
    if (!board.floors.has(keyOf(target.x, target.y))) {
      contact = 'wall'; return { accepted: false, reason: contact };
    }
    const crate = crates.find(c => c.x === target.x && c.y === target.y);
    if (crate) {
      const x = crate.x + dx, y = crate.y + dy;
      if (!board.floors.has(keyOf(x, y)) || crates.some(c => c.x === x && c.y === y)) {
        contact = 'blocked-crate'; return { accepted: false, reason: contact };
      }
    }
    history.push({ player: { ...player }, crates: copyCrates(crates), moves, pushes, direction, events: structuredClone(events) });
    const from = { ...player };
    direction = name; contact = null; moves += 1; player = target;
    let docked = false;
    if (crate) {
      const crateFrom = { x: crate.x, y: crate.y };
      crate.x += dx; crate.y += dy; pushes += 1;
      docked = board.goals.has(keyOf(crate.x, crate.y));
      emit('crate.pushed', { crateId: crate.id, from: crateFrom, to: { x: crate.x, y: crate.y }, docked });
    }
    emit('keeper.moved', { from, to: { ...player }, direction: name, pushed: !!crate });
    if (goalsFilled() === board.goals.size) finish(true, 'all-goals');
    else if (crate && !board.safe.has(keyOf(crate.x, crate.y))) finish(false, 'dead-square');
    return { accepted: true, pushed: !!crate, docked, state };
  }
  function undo() {
    const previous = history.pop();
    if (!previous) return { accepted: false, reason: 'no-history' };
    ({ player, crates, moves, pushes, direction, events } = previous);
    // Undo restores the playable timeline, including a move that got stuck.
    // Event IDs remain monotonic; discarded history can never reuse an ID.
    state = 'RUNNING'; outcomeReason = null; terminalCount = 0; contact = null;
    emit('move.undone', { moves, pushes });
    return { accepted: true, undone: true };
  }
  function handleInput(action) {
    if (typeof action === 'string') action = { type: 'move', direction: action };
    if (action?.type === 'move') return move(action.direction);
    if (action?.type === 'undo') return undo();
    if (action?.type === 'reset') return { accepted: reset(), reset: true };
    if (action?.type === 'level') return { accepted: reset(action.index), reset: true };
    return { accepted: false };
  }
  function read() {
    return {
      state, outcomeReason, roundId, elapsed: 0, terminalCount,
      levelIndex, levelName: levels[levelIndex].name, moves, pushes, direction,
      player: { ...player }, crates: copyCrates(crates),
      cratePositions: Object.fromEntries(crates.map(c => [c.id, { x: c.x, y: c.y }])),
      goalsFilled: goalsFilled(), goalCount: board.goals.size, historyDepth: history.length,
      events: structuredClone(events), diagnostics: { contact },
    };
  }
  reset();
  return {
    handleInput, read, update() {}, get board() { return board; },
    pathTo(target) { return walkingPaths(board, player, crates).get(keyOf(target.x, target.y)) ?? null; },
  };
}
