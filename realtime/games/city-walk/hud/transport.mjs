// SPDX-License-Identifier: Apache-2.0
/** City Walk HUD snapshot. The runtime forwards this object verbatim. */

export function encode(read) {
  return {
    state: read.state,
    // Only a live run can be paused; a stale flag must never hold READY or an outcome.
    paused: Boolean(read.paused) && read.state === 'RUNNING',
    roundId: read.roundId,
    elapsed: read.elapsed ?? 0,
    outcomeReason: read.outcomeReason || '',
    score: read.score ?? 0,
    targetScore: read.targetScore ?? 100,
    ringsCollected: read.ringsCollected ?? 0,
    clockText: read.clockText || '0:00',
    clockWarn: Boolean(read.clockWarn),
    guideText: read.guideText || '',
    guideBearing: read.guideBearing ?? 0,
    yielding: read.yielding ?? 0,
    bonusFlash: Boolean(read.bonusFlash),
    // Prompt lines for events since the round began. The runtime unions these
    // across a chunk's frames and keeps each line for a few chunks.
    events: Array.isArray(read.events) ? read.events : [],
  };
}
