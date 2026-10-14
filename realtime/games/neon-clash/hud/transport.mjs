// SPDX-License-Identifier: Apache-2.0
/** Neon Clash HUD snapshot. The runtime forwards this object verbatim. */

function fighter(f = {}) {
  return {
    hp: f.hp ?? 100,
    maxHp: 100,
    hits: (f.punchHits ?? 0) + (f.kickHits ?? 0),
    combo: f.combo ?? 0,
    maxCombo: f.maxCombo ?? 0,
    telegraph: Boolean(f.telegraph),
  };
}

export function encode(read) {
  return {
    state: read.state,
    // Only a live round can be paused; a stale flag must never hold READY or an outcome.
    paused: Boolean(read.paused) && read.state === 'RUNNING',
    roundId: read.roundId,
    elapsed: read.elapsed ?? 0,
    outcomeReason: read.outcomeReason || '',
    player: fighter(read.player),
    rival: fighter(read.rival),
    status: read.status || '',
    banner: read.banner || '',
    feedback: read.feedback || '',
    // Prompt lines for events since the round began. The runtime unions these
    // across a chunk's frames and keeps each line for a few chunks.
    events: Array.isArray(read.events) ? read.events : [],
  };
}
