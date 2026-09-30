export const LEVELS = [
  { name: 'First light', subtitle: 'Every journey begins with a little push.', difficulty: 'A gentle start', hint: 'Get behind a crate, then push it toward a brass marker.', map: [
    '########', '#      #', '#  $ . #', '# @ #  #', '#  $ . #', '#      #', '########',
  ] },
];

export const DIRECTIONS = Object.freeze({ up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] });
export const keyOf = (x, y) => `${x},${y}`;
export const pointOf = key => key.split(',').map(Number);

export function parseLevel(level) {
  const floors = new Set(), walls = new Set(), goals = new Set(), crates = [];
  let player = null;
  level.map.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '#') walls.add(keyOf(x, y));
    else if (ch !== '_') floors.add(keyOf(x, y));
    if ('.$*+'.includes(ch)) { if (ch === '.' || ch === '*' || ch === '+') goals.add(keyOf(x, y)); }
    if (ch === '$' || ch === '*') crates.push({ id: `crate${crates.length}`, x, y });
    if (ch === '@' || ch === '+') player = { x, y };
  }));
  if (!player || crates.length !== goals.size || !crates.length) throw new Error('Invalid level');
  const safe = new Set(goals), queue = [...goals];
  // Reverse-pull reachability detects static dead squares without false positives.
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = pointOf(queue[i]);
    for (const [dx, dy] of Object.values(DIRECTIONS)) {
      const previous = keyOf(x - dx, y - dy), support = keyOf(x - 2 * dx, y - 2 * dy);
      if (floors.has(previous) && floors.has(support) && !safe.has(previous)) { safe.add(previous); queue.push(previous); }
    }
  }
  return { ...level, width: Math.max(...level.map.map(r => r.length)), height: level.map.length, floors, walls, goals, crates, player, safe };
}

export function walkingPaths(board, player, crates) {
  const occupied = new Set(crates.map(c => keyOf(c.x, c.y)));
  const paths = new Map([[keyOf(player.x, player.y), []]]), queue = [player];
  for (let i = 0; i < queue.length; i++) {
    for (const [name, [dx, dy]] of Object.entries(DIRECTIONS)) {
      const next = { x: queue[i].x + dx, y: queue[i].y + dy }, key = keyOf(next.x, next.y);
      if (board.floors.has(key) && !occupied.has(key) && !paths.has(key)) {
        paths.set(key, [...paths.get(keyOf(queue[i].x, queue[i].y)), name]); queue.push(next);
      }
    }
  }
  return paths;
}

// Search push states, merging equivalent player regions. Used by hints and level validation.
export function solve(board, player = board.player, crates = board.crates, limit = 120000) {
  const queue = [{ player, crates, path: [] }], seen = new Set();
  for (let cursor = 0; cursor < queue.length && cursor < limit; cursor++) {
    const state = queue[cursor];
    if (state.crates.every(c => board.goals.has(keyOf(c.x, c.y)))) return { path: state.path, visited: cursor + 1 };
    const paths = walkingPaths(board, state.player, state.crates);
    const hash = state.crates.map(c => keyOf(c.x, c.y)).sort().join('|') + ':' + [...paths.keys()].sort()[0];
    if (seen.has(hash)) continue;
    seen.add(hash);
    const occupied = new Set(state.crates.map(c => keyOf(c.x, c.y)));
    for (let i = 0; i < state.crates.length; i++) {
      const crate = state.crates[i];
      for (const [direction, [dx, dy]] of Object.entries(DIRECTIONS)) {
        const behind = keyOf(crate.x - dx, crate.y - dy), ahead = keyOf(crate.x + dx, crate.y + dy);
        if (!paths.has(behind) || occupied.has(ahead) || !board.safe.has(ahead)) continue;
        const next = state.crates.map(c => ({ ...c })); next[i].x += dx; next[i].y += dy;
        queue.push({ player: { x: crate.x, y: crate.y }, crates: next, path: [...state.path, ...paths.get(behind), direction] });
      }
    }
  }
  return { path: null, visited: seen.size, exhausted: queue.length < limit };
}
