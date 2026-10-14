// SPDX-License-Identifier: Apache-2.0
/** Nightfang HUD snapshot. The runtime forwards this object verbatim. */

export function encode(read) {
  const hero = read.hero || {};
  return {
    state: read.state,
    // Only a live run can be paused; a stale flag must never hold READY or an outcome.
    paused: Boolean(read.paused) && read.state === 'RUNNING',
    roundId: read.roundId,
    outcomeReason: read.outcomeReason || '',
    elapsed: read.elapsed ?? 0,
    phase: read.phase || 'wardens',
    hp: read.hp ?? hero.hp ?? 120,
    maxHp: read.maxHp ?? hero.maxHp ?? 120,
    score: read.score ?? 0,
    kills: read.kills ?? 0,
    seals: Array.isArray(read.seals) ? read.seals : [false, false],
    bossHp: read.bossHp ?? 0,
    bossMaxHp: read.bossMaxHp ?? 1,
    bestCombo: read.bestCombo ?? 0,
    combo: read.combo ?? 0,
    comboLabel: read.comboLabel || 'COMBO',
    objective: read.objective || '',
    objectiveLabel: read.objectiveLabel || '',
    banner: read.banner || '',
    alert: read.alert || '',
    go: Boolean(read.go),
    heavyText: read.heavyText || 'HEAVY READY',
    heavyCooldown: Boolean(read.heavyCooldown),
    dashText: read.dashText || 'DODGE READY',
    soundOn: Boolean(read.soundOn),
    // Prompt lines for events since the round began. The runtime unions these
    // across a chunk's frames and keeps each line for a few chunks.
    events: Array.isArray(read.events) ? read.events : [],
  };
}
