// SPDX-License-Identifier: Apache-2.0
/** Boxed In HUD snapshot. The runtime forwards this object verbatim. */

export function encode(read) {
  return {
    state: read.state,
    roundId: read.roundId,
    levelIndex: read.levelIndex,
    levelName: read.levelName,
    levelSubtitle: read.levelSubtitle ?? '',
    moves: read.moves,
    pushes: read.pushes,
    goalsFilled: read.goalsFilled,
    goalCount: read.goalCount,
    historyDepth: read.historyDepth,
    helpOpen: Boolean(read.helpOpen),
    hintBusy: Boolean(read.hintBusy),
    toast: read.toast || '',
    // Prompt lines for events since the round began. The runtime unions these
    // across a chunk's frames and keeps each event type for a few chunks.
    events: Array.isArray(read.events) ? read.events : [],
  };
}
