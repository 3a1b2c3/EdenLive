import * as THREE from 'three';
import { DEFAULT_PRNG } from '../../../math/RandomUtils.js';

export function createGrassMaterial(color = 0xa2b86a) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.92 });
}

// A unit-height blade, centred on the origin exactly like the per-blade cones it
// replaces. Height variation now comes from scale.y, so a whole grass field can
// share one geometry the same way it already shares one material. Build one per
// field and pass it in; the default keeps single-call sites working unchanged.
export function createGrassBladeGeometry(radius = 0.08, radialSegments = 4) {
  return new THREE.ConeGeometry(radius, 1, radialSegments);
}

export function createGrassBladeVisual({
  material = createGrassMaterial(),
  geometry = createGrassBladeGeometry(),
  prng = DEFAULT_PRNG,
}) {

  const blade = new THREE.Mesh(geometry, material);
  blade.scale.y = prng.uniform(0.45, 1.2);
  blade.rotation.y = prng.uniform(0, Math.PI * 2);
  // Grass receives shadow but does not cast: a few hundred tiny shadow casters
  // cost far more than they add to a greybox scene.
  blade.receiveShadow = true;
  return blade;
}

