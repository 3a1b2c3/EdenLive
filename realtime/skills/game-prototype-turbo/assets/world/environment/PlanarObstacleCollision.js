// Three.js 0.161.0.
import { Box3, Vector3 } from 'three';

// Yaw-oriented boxes preserve the gaps alongside diagonally parked cars.
export function makeCollider(object) {
  object.updateWorldMatrix(true, true);
  const inverse = object.matrixWorld.clone().invert();
  const bounds = new Box3();
  object.traverse(child => {
    if (!child.geometry) return;
    child.geometry.computeBoundingBox();
    const transform = inverse.clone().multiply(child.matrixWorld);
    bounds.union(child.geometry.boundingBox.clone().applyMatrix4(transform));
  });
  return { bounds, inverse, matrix: object.matrixWorld.clone() };
}

export function collideMovement(intent, colliders, radius, height) {
  const position = intent.startPosition.clone();
  const steps = Math.max(1, Math.ceil(intent.desiredDelta.length() / (radius * 0.25)));
  const step = intent.desiredDelta.clone().divideScalar(steps);
  for (let i = 0; i < steps; i++) {
    position.add(step);
    for (let pass = 0; pass < 4; pass++) {
      for (const c of colliders) {
        const p = position.clone().applyMatrix4(c.inverse);
        const b = c.bounds;
        if (p.y >= b.max.y || p.y + height <= b.min.y) continue;
        const x = Math.max(b.min.x, Math.min(b.max.x, p.x));
        const z = Math.max(b.min.z, Math.min(b.max.z, p.z));
        const dx = p.x - x, dz = p.z - z;
        const distance = Math.hypot(dx, dz);
        if (distance >= radius) continue;
        if (distance > 1e-8) {
          p.x += dx / distance * (radius - distance + 1e-5);
          p.z += dz / distance * (radius - distance + 1e-5);
        } else {
          const exits = [
            { d: p.x - b.min.x, x: b.min.x - radius, z: p.z },
            { d: b.max.x - p.x, x: b.max.x + radius, z: p.z },
            { d: p.z - b.min.z, x: p.x, z: b.min.z - radius },
            { d: b.max.z - p.z, x: p.x, z: b.max.z + radius },
          ].sort((a, b) => a.d - b.d);
          p.x = exits[0].x; p.z = exits[0].z;
        }
        position.copy(p.applyMatrix4(c.matrix));
      }
    }
  }
  intent.position.copy(position);
  intent.desiredDelta.copy(position).sub(intent.startPosition);
  if (intent.deltaSeconds > 0) intent.velocity.copy(intent.desiredDelta).divideScalar(intent.deltaSeconds);
  return intent;
}
