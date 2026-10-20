// Greybox building blocks for an early prototype: solid colours, primitive
// geometry, readable silhouettes.
//
// The point of a greybox is legibility, not looks. Every default here exists so
// that motion and state can be judged by eye -- a capsule that shows which way it
// faces, a marker that reads against the floor, a grid that makes speed visible.
// No textures, no materials worth tuning, nothing that invites art direction.
//
// These builders are pure three: no DOM, no input, no per-frame state. The
// DOM-facing half of a prototype shell (renderer, resize, keyboard, pointer, HUD)
// lives in user-interface/PrototypeShell.js, because this library keeps DOM code
// out of everything except user-interface/.
//
// Every placement goes through WorldBasis. Writing axis signs by hand is the
// single most common way to put a whole scene behind the camera.

import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  SphereGeometry,
} from 'three';

import { DEFAULT_WORLD_BASIS as BASIS } from '../../../math/WorldBasis.js';

/**
 * One directional key plus an ambient fill. Defaults unchanged, so existing calls are untouched.
 *
 * `color`, `position` and `extent` are knobs because stage 3 reads lighting out of the scene
 * prose, and the old fixed white key at (18, 26, 14) with a 60-unit shadow extent could express
 * none of it: "cool blue light filtering down from a distant shaft above" and "the sun low on the
 * horizon" are different lights, and an 84 m arena or a 9 km terrain drops most of itself out of
 * a 60-unit shadow frustum -- which reads as a lighting bug and is really a frustum bug.
 *
 * For a whole look (sky colour and fog as well as lights), prefer
 * world/environment/SceneAtmosphere.js; this stays the two-line greybox default.
 */
export function addKeyLight(scene, {
  intensity = 0.85,
  ambient = 0.55,
  color = 0xffffff,
  ambientColor = 0xffffff,
  position = { right: 18, up: 26, forward: 14 },
  extent = 60,
  shadowFar = null,
  shadows = true,
} = {}) {
  scene.add(new AmbientLight(ambientColor, ambient));
  const key = new DirectionalLight(color, intensity);
  key.position.copy(BASIS.fromBasisComponents(position.right, position.up, position.forward));
  if (shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, {
      left: -extent,
      right: extent,
      top: extent,
      bottom: -extent,
      // Scale with the extent rather than pinning 140: a far plane shorter than the space
      // clips the shadow of everything past it.
      far: shadowFar === null || shadowFar === undefined ? Math.max(140, extent * 2.5) : shadowFar,
    });
  }
  scene.add(key);
  return key;
}

export function addGroundGrid(scene, { size = 120, divisions = 60, up = 0 } = {}) {
  const grid = new GridHelper(size, divisions, 0x2f3d52, 0x1e2733);
  grid.position.copy(BASIS.fromBasisComponents(0, up + 0.01, 0));
  grid.material.transparent = true;
  grid.material.opacity = 0.65;
  grid.material.depthWrite = false;
  scene.add(grid);
  return grid;
}

/** Lane border stripes along the run direction, so lanes read at speed. */

/** Lane border stripes along the run direction, so lanes read at speed. */
export function createLaneStripes({
  laneCount = 3, laneWidth = 2.4, length = 300, behind = 20, up = 0.02,
}) {
  const points = [];
  const half = (laneCount * laneWidth) * 0.5;
  for (let i = 0; i <= laneCount; i += 1) {
    const right = -half + i * laneWidth;
    // Stripes run AHEAD of the origin: an auto-runner's forward component grows
    // positive, so the track has to be laid out at positive forward values. A
    // short tail behind the spawn keeps the start from looking cut off.
    const a = BASIS.fromBasisComponents(right, up, -behind);
    const b = BASIS.fromBasisComponents(right, up, length);
    points.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
  const stripes = new LineSegments(
    geometry,
    new LineBasicMaterial({ color: 0x4d6480, transparent: true, opacity: 0.9, depthWrite: false })
  );
  stripes.renderOrder = 1;
  return stripes;
}

/**
 * A capsule avatar whose height can change (for ducking) without rebuilding
 * geometry: the mesh is scaled and re-seated so its feet stay on the ground.
 * A nose marker shows facing, which is otherwise invisible on a capsule.
 */

/**
 * A capsule avatar whose height can change (for ducking) without rebuilding
 * geometry: the mesh is scaled and re-seated so its feet stay on the ground.
 * A nose marker shows facing, which is otherwise invisible on a capsule.
 */
export function createCapsuleActor({ height = 1.7, radius = 0.42, color = 0x7fb3ff } = {}) {
  const group = new Group();
  const baseHeight = height;
  const bodyLength = Math.max(0.05, height - radius * 2);

  const body = new Mesh(
    new CapsuleGeometry(radius, bodyLength, 6, 12),
    new MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 })
  );
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const nose = new Mesh(
    new BoxGeometry(radius * 0.5, radius * 0.5, radius * 1.3),
    new MeshStandardMaterial({ color: 0xffe9a8, roughness: 0.5 })
  );
  nose.castShadow = true;
  group.add(nose);

  function setHeight(current = baseHeight) {
    const scale = Math.max(0.05, current / baseHeight);
    body.scale.set(1, scale, 1);
    // Capsule geometry is centred, so lift it by half its scaled height.
    const centre = (baseHeight * scale) * 0.5;
    body.position.copy(BASIS.fromBasisComponents(0, centre, 0));
    nose.position.copy(BASIS.fromBasisComponents(0, centre, radius * 1.1));
  }
  setHeight(baseHeight);

  return { group, body, nose, setHeight, baseHeight };
}

/**
 * A box marker. `emissive` makes it glow, which createMarkerSphere already did and this did not
 * -- so any prose calling for a "glowing" wall, pad or gate had to use a sphere or go without.
 */
export function createMarkerBox({
  width = 1, height = 1, depth = 1, color = 0xff6b6b, opacity = 1,
  emissive = false, emissiveIntensity = 0.35,
} = {}) {
  const mesh = new Mesh(
    new BoxGeometry(width, height, depth),
    new MeshStandardMaterial({
      color,
      emissive: emissive ? new Color(color).multiplyScalar(emissiveIntensity) : 0x000000,
      roughness: 0.7,
      transparent: opacity < 1,
      opacity,
    })
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * A flat ring on the ground: a kickoff circle, a capture zone, a spawn circle, a telegraph.
 *
 * The kit had a filled disc (createGroundMarker) and corridor lane stripes, and nothing that
 * draws an outline -- so pitch markings and zone boundaries had no greybox vocabulary at all.
 */
export function createGroundRing({
  radius = 1, thickness = 0.12, color = 0xffffff, opacity = 0.75,
} = {}) {
  const inner = Math.max(0.001, radius - thickness);
  const ring = new Mesh(
    new RingGeometry(inner, radius, 48),
    new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
  );
  ring.quaternion.copy(BASIS.threePlaneCanonicalToBasisQuaternion());
  ring.renderOrder = 2;
  return ring;
}

/**
 * A straight line on the ground between two basis-planar points: a midline, a start line, a
 * boundary a player should read but not collide with.
 */
export function createGroundLine({
  from = { right: 0, forward: 0 },
  to = { right: 0, forward: 1 },
  width = 0.12,
  up = 0.02,
  color = 0xffffff,
  opacity = 0.75,
} = {}) {
  const dRight = to.right - from.right;
  const dForward = to.forward - from.forward;
  const length = Math.hypot(dRight, dForward);
  const line = new Mesh(
    new BoxGeometry(width, 0.01, Math.max(0.001, length)),
    new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
  );
  line.position.copy(BASIS.fromBasisComponents(
    (from.right + to.right) * 0.5,
    up,
    (from.forward + to.forward) * 0.5
  ));
  // Yaw about the basis up axis so the box lies along the from->to direction. Built from the
  // basis quaternion rather than a raw Euler, so it holds under any axis convention.
  line.quaternion.copy(BASIS.threeObjectCanonicalToBasisQuaternion());
  line.rotateY(Math.atan2(dRight, dForward));
  line.renderOrder = 2;
  return line;
}

export function createMarkerSphere({ radius = 0.5, color = 0x8ce99a, emissive = true } = {}) {
  const mesh = new Mesh(
    new SphereGeometry(radius, 16, 12),
    new MeshStandardMaterial({
      color,
      emissive: emissive ? new Color(color).multiplyScalar(0.35) : 0x000000,
      roughness: 0.5,
    })
  );
  mesh.castShadow = true;
  return mesh;
}

/** A flat ground disc + ring, for goals, pads and aim indicators. */

/** A flat ground disc + ring, for goals, pads and aim indicators. */
export function createGroundMarker({ radius = 1, color = 0x76f0c9, opacity = 0.35 } = {}) {
  const group = new Group();
  const disc = new Mesh(
    new CircleGeometry(radius, 32),
    new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
  );
  const ring = new Mesh(
    new RingGeometry(radius * 0.95, radius * 1.1, 32),
    new MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false })
  );
  for (const mesh of [disc, ring]) {
    mesh.quaternion.copy(BASIS.threePlaneCanonicalToBasisQuaternion());
    mesh.renderOrder = 2;
    group.add(mesh);
  }
  return group;
}

/**
 * Keyboard state with edge detection.
 *
 * Stage 1 lives and dies on this distinction: a lane change or a jump must fire
 * once per press, while movement must read the held state. Mapping codes to
 * action names keeps the game code free of `event.code` noise.
 */
