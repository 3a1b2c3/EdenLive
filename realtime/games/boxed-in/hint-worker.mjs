import { LEVELS, parseLevel, solve } from './levels.mjs';

self.onmessage = ({ data }) => {
  try {
    const board = parseLevel(LEVELS[0]);
    const result = solve(board, data.player, data.crates);
    self.postMessage({ token: data.token, ...result });
  } catch {
    self.postMessage({ token: data.token, path: null, exhausted: false });
  }
};
