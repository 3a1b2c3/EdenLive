// SPDX-License-Identifier: Apache-2.0
/** Subway Run HUD snapshot. The runtime forwards this object verbatim. */

const LANES = ['LEFT LANE', 'CENTER LANE', 'RIGHT LANE'];

export function encode(read) {
  return {
    state: read.state,
    roundId: read.roundId,
    score: read.score,
    targetScore: read.targetScore,
    distance: read.distance,
    targetLaneIndex: read.targetLaneIndex,
    cue: read.cue,
    cueTitle: read.cueTitle || '',
    cueHint: read.cueHint || '',
    toast: read.toast || '',
    outcomeReason: read.outcomeReason || '',
    laneLabel: LANES[read.targetLaneIndex] || LANES[1],
    // Prompt lines for events since the round began. The runtime unions these
    // across a chunk's frames and keeps each event type for a few chunks.
    events: Array.isArray(read.events) ? read.events : [],
  };
}
