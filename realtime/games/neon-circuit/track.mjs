// One continuous rounded city block. All road meshes, racers and pickups use this frame.
export const TRACK_LENGTH = 240;
// Corner radius doubles as the camera's angular-rate knob: the view is locked
// to the track tangent, so a corner turns the world-model control signal at
// v/R. R=14 reached 153 deg/s under boost (6.6% of the frame replaced per
// presented frame at 24 fps). R=20 is the most that fits — at 22 the infield
// buildings at (±10, 26) start overlapping the road surface.
const R = 20, W = 60, H = 84;
const straightA = H - 2 * R, straightB = W - 2 * R, arc = Math.PI * R / 2;
const physicalLength = 2 * (straightA + straightB) + 4 * arc;
export function trackFrame(distance, lane = 0) {
  let d = ((distance % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH * physicalLength / TRACK_LENGTH;
  const sections = [
    [straightA, t => [W / 2, H / 2 - R - t, 0, -1]],
    [arc, t => { const a = t / R; return [W / 2 - R + R * Math.cos(a), -H / 2 + R - R * Math.sin(a), -Math.sin(a), -Math.cos(a)]; }],
    [straightB, t => [W / 2 - R - t, -H / 2, -1, 0]],
    [arc, t => { const a = Math.PI / 2 + t / R; return [-W / 2 + R + R * Math.cos(a), -H / 2 + R - R * Math.sin(a), -Math.sin(a), -Math.cos(a)]; }],
    [straightA, t => [-W / 2, -H / 2 + R + t, 0, 1]],
    [arc, t => { const a = Math.PI + t / R; return [-W / 2 + R + R * Math.cos(a), H / 2 - R - R * Math.sin(a), -Math.sin(a), -Math.cos(a)]; }],
    [straightB, t => [-W / 2 + R + t, H / 2, 1, 0]],
    [arc, t => { const a = 3 * Math.PI / 2 + t / R; return [W / 2 - R + R * Math.cos(a), H / 2 - R - R * Math.sin(a), -Math.sin(a), -Math.cos(a)]; }],
  ];
  for (const [length, fn] of sections) {
    if (d <= length + 1e-8) { const [x,z,fx,fz] = fn(d); return { x:x-fz*lane, z:z+fx*lane, fx,fz, yaw: Math.atan2(-fx,-fz) }; }
    d -= length;
  }
}
