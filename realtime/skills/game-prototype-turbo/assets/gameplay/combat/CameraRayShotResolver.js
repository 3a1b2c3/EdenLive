// Three.js 0.161.0.
import { Box3, Raycaster, Vector3 } from 'three';

// Target hurt volumes follow their visible mesh every shot, including movement.
// Volume intersections also work when the muzzle is inside a target; triangle
// raycasting with front-face materials silently misses in that situation.
export function resolveCameraRayShot({ camera, targets, blockers, range = 120 }) {
  camera.updateWorldMatrix(true, false);
  blockers.forEach(object => object.updateWorldMatrix(true, true));
  const raycaster = new Raycaster();
  const live = targets.filter(target => !target.destroyed);
  const volumes = live.map(target => {
    target.mesh.updateWorldMatrix(true, true);
    target.hurtbox ??= new Box3();
    target.hurtbox.setFromObject(target.mesh);
    return { target, box: target.hurtbox };
  });
  function trace(origin, direction, distance) {
    raycaster.set(origin, direction);
    raycaster.far = distance;
    const obstruction = raycaster.intersectObjects(blockers, true)[0];
    let result = obstruction ? { point: obstruction.point, distance: obstruction.distance, target: null } : null;
    for (const { target, box } of volumes) {
      const point = box.containsPoint(origin) ? origin.clone() : raycaster.ray.intersectBox(box, new Vector3());
      if (!point) continue;
      const hitDistance = origin.distanceTo(point);
      if (hitDistance <= distance + 1e-6 && (!result || hitDistance < result.distance - 1e-6)) {
        result = { point, distance: hitDistance, target };
      }
    }
    return result;
  }
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const origin = raycaster.ray.origin.clone();
  const direction = raycaster.ray.direction.clone();
  const aimHit = trace(origin, direction, range);
  const aimPoint = aimHit?.point.clone() ?? origin.clone().addScaledVector(direction, range);
  // The reticle ray is authoritative: shoulder/hand offsets must never
  // change the selected target or introduce a second obstruction test.
  return { origin, direction, aimPoint, point: aimPoint, target: aimHit?.target ?? null, blocked: !!aimHit && !aimHit.target };
}
