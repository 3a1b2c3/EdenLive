// SPDX-License-Identifier: Apache-2.0
/** Ashen Wilds HUD snapshot. The runtime forwards this object verbatim. */

export function encode(read) {
  return {
    state: read.state,
    // Only a live run can be paused; a stale flag must never hold READY or an outcome.
    paused: Boolean(read.paused) && read.state === 'RUNNING',
    roundId: read.roundId,
    elapsed: read.elapsed ?? 0,
    outcomeReason: read.outcomeReason || '',
    playerHealth: read.playerHealth ?? 6,
    playerHealthMax: 6,
    stamina: read.stamina ?? 100,
    goatHealth: read.goatHealth ?? 3,
    goatHealthMax: 3,
    goatActive: Boolean(read.goatActive),
    bossHealth: read.bossHealth ?? 12,
    bossHealthMax: 12,
    bossActive: Boolean(read.bossActive),
    lockedTarget: read.lockedTarget || null,
    hitCount: read.hitCount ?? 0,
    dodgeCount: read.dodgeCount ?? 0,
    objective: read.objective || '',
    lockLabel: read.lockLabel || 'NO LOCK',
    alert: read.alert || '',
    dodgeReady: read.dodgeReady !== false,
    vignette: read.vignette ?? 0,
    // Prompt lines for events since the round began. The runtime unions these
    // across a chunk's frames and keeps each line for a few chunks.
    events: Array.isArray(read.events) ? read.events : [],
  };
}
