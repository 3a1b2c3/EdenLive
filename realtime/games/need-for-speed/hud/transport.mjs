// SPDX-License-Identifier: Apache-2.0
/** Need for Speed HUD snapshot. The runtime forwards this object verbatim. */

export function encode(read) {
  return {
    state: read.state,
    roundId: read.roundId,
    elapsed: read.elapsed,
    raceLimit: read.raceLimit,
    speed: read.speed,
    rank: read.rank,
    lap: read.lap,
    lapsCompleted: read.lapsCompleted,
    lapTimes: Array.isArray(read.lapTimes) ? read.lapTimes : [],
    boostSeconds: read.boostSeconds,
    boostCount: read.boostCount,
    braking: Boolean(read.braking),
    crashes: read.crashes,
    crashLimit: read.crashLimit,
    outcomeReason: read.outcomeReason || '',
    // Prompt lines for events since the round began. The runtime unions these
    // across a chunk's frames and keeps each line for a few chunks.
    events: Array.isArray(read.events) ? read.events : [],
  };
}
