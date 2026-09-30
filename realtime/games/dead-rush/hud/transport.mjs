// SPDX-License-Identifier: Apache-2.0
/** Dead Rush HUD snapshot. The runtime forwards this object verbatim. */

export function encode(read) {
  const car = read.car || {};
  return {
    state: read.state,
    // Only a live run can be paused; a stale flag must never hold READY or an outcome.
    paused: Boolean(read.paused) && read.state === 'RUNNING',
    roundId: read.roundId,
    score: read.score,
    targetScore: read.targetScore ?? 600,
    health: read.health,
    hits: read.hits,
    deaths: read.deaths,
    speedKmh: read.speedKmh ?? 0,
    speedRatio: read.speedRatio ?? 0,
    gear: read.gear || 'READY',
    driveHint: read.driveHint || '',
    toast: read.toast || '',
    flash: read.flash ?? 0,
    muted: read.muted !== false,
    outcomeReason: read.outcomeReason || '',
    car: {x: car.x ?? 0, z: car.z ?? 0, yaw: car.yaw ?? 0},
    people: Array.isArray(read.people)
      ? read.people.filter(p => !p.dead).map(p => ({role: p.role, x: p.x, z: p.z, hit: p.hits > 0}))
      : [],
    // Prompt lines for events since the round began. The runtime unions these
    // across a chunk's frames and keeps each line for a few chunks.
    events: Array.isArray(read.events) ? read.events : [],
  };
}
