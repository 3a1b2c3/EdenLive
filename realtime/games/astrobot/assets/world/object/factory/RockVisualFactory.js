import * as THREE from 'three';
import { DEFAULT_PRNG } from '../../../math/RandomUtils.js';

export function createRockMaterial(color = 0x7b827a) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.96, flatShading: true });
}

export function createGroundRockVisual({
  material = createRockMaterial(),
  prng = DEFAULT_PRNG,
}) {
  const rock = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  rock.name = 'GroundRock';
  const size = prng.uniform(0.7, 2.0);
  rock.scale.set(size, size * prng.uniform(0.35, 0.8), size);
  rock.castShadow = true;
  rock.receiveShadow = true;
  return rock;
}

/** Simplified rock: a box in place of the displaced icosahedron. Same return shape. */
export function createIrregularRockVisual({
  radius = 1,
  color = 0x8e95a3,
  scaleVariance = 0.12,
  roughness = 0.9,
  metalness = 0.05,
  castShadow = true,
  receiveShadow = true,
  prng = DEFAULT_PRNG,
}) {
  const safeRadius = Math.max(0.05, radius);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(safeRadius * 2, safeRadius * 2, safeRadius * 2),
    new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true }),
  );
  mesh.name = 'IrregularRock';
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.scale.set(
    prng.uniform(1 - scaleVariance, 1 + scaleVariance),
    prng.uniform(1 - scaleVariance, 1 + scaleVariance),
    prng.uniform(1 - scaleVariance, 1 + scaleVariance),
  );
  return { mesh, radius: safeRadius };
}
