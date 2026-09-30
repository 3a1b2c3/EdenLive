// SPDX-License-Identifier: Apache-2.0
/** Astrobot HUD snapshot. The runtime forwards this object verbatim. */

export function encode(read) {
  return {
    state: read.state,
    roundId: read.roundId,
    elapsed: read.elapsed,
    coins: read.coins,
    total: read.total,
    outcomeReason: read.outcomeReason || '',
    toast: read.toast || '',
    // Prompt lines for events since the round began. The runtime unions these
    // across a chunk's frames and keeps each line for a few chunks.
    events: Array.isArray(read.events) ? read.events : [],
  };
}
