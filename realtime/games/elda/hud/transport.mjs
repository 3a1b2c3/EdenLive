// SPDX-License-Identifier: Apache-2.0
/** Wilds of Elda HUD snapshot. The runtime forwards this object verbatim. */

export function encode(read) {
  return {
    state: read.state,
    // Only a live run can be paused; a stale flag must never hold READY or an outcome.
    paused: Boolean(read.paused) && read.state === 'RUNNING',
    roundId: read.roundId,
    elapsed: read.elapsed ?? 0,
    outcomeReason: read.outcomeReason || '',
    hearts: read.hearts ?? 5,
    heartsMax: read.heartsMax ?? 5,
    monstersAlive: read.monstersAlive ?? 3,
    monstersTotal: read.monstersTotal ?? 3,
    guards: Array.isArray(read.guards) ? read.guards : [],
    shrineDist: read.shrineDist ?? 0,
    drawing: Boolean(read.drawing),
    charge: read.charge ?? 0,
    locked: Boolean(read.locked),
    reticleX: read.reticleX ?? 50,
    reticleY: read.reticleY ?? 50,
    hitFlash: read.hitFlash ?? 0,
    seconds: read.stats?.seconds ?? 0,
    accuracy: read.stats?.accuracy ?? 0,
    // Prompt lines for events since the round began. The runtime unions these
    // across a chunk's frames and keeps each line for a few chunks.
    events: Array.isArray(read.events) ? read.events : [],
  };
}
