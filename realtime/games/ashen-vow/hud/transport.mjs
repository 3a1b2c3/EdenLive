// SPDX-License-Identifier: Apache-2.0
/** Ashen Vow HUD snapshot. The runtime forwards this object verbatim. */

export function encode(read) {
  const boss = read.boss || {};
  return {
    state: read.state,
    // Only a live run can be paused; a stale flag must never hold READY or an outcome.
    paused: Boolean(read.paused) && read.state === 'RUNNING',
    roundId: read.roundId,
    elapsed: read.elapsed,
    outcomeReason: read.outcomeReason || '',
    playerHealth: read.playerHealth,
    playerMaxHealth: read.playerMaxHealth,
    wardensDefeated: read.wardensDefeated,
    totalWardens: read.totalWardens,
    sealOne: (read.wardenOneHp ?? 1) <= 0,
    sealTwo: (read.wardenTwoHp ?? 1) <= 0,
    bossSpawned: Boolean(read.bossSpawned),
    bossDefeated: Boolean(read.bossDefeated),
    bossHealth: boss.hp ?? 0,
    bossMaxHealth: boss.maxHp ?? 1,
    dashCharges: read.dashCharges,
    novaReady: Boolean(read.novaReady),
    objectiveLabel: read.objectiveLabel || '',
    objective: read.objective || '',
    dashLabel: read.dashLabel || '',
    novaLabel: read.novaLabel || '',
    bannerVisible: Boolean(read.bannerVisible),
    hitFlash: read.hitFlash ?? 0,
    // Prompt lines for events since the round began. The runtime unions these
    // across a chunk's frames and keeps each line for a few chunks.
    events: Array.isArray(read.events) ? read.events : [],
  };
}
