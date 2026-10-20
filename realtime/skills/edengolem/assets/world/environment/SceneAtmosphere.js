// Sky, fog and directional light as one coherent palette, set from the scene prose.
//
// Stage 3's Act 10 step 5 asks every game to read ground colour, fog distance, light angle and
// warmth out of the brief's prose. Nothing in this library could express any of it: the greybox
// kit's addKeyLight hardcodes a white key at a fixed position with a 60-unit shadow extent, and
// no module touched THREE.Fog at all. So every prototype hand-rolled `scene.background` and
// either skipped fog or picked a distance by taste.
//
// Fog picked by taste is not a cosmetic problem. Fog far is a LEGIBILITY BUDGET: the goal has to
// be visible from where the player needs to see it, or the round is unwinnable while every
// coordinate stays legal. Two real cases from the stage-2 prototypes -- a boss at forward 7200
// behind fog at 7000, and a 180 m climb with fog at 85 -- both screenshot fine and cannot be
// finished. `fogFarForGoal` exists so the number comes from the goal distance instead.
//
// Still greybox: solid colours, no textures, no atmospheric scattering. The look is feedback --
// it tells the player which way is forward and where the danger is.

import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  FogExp2,
} from 'three';

import { DEFAULT_WORLD_BASIS } from '../../math/WorldBasis.js';

/**
 * Fog far distance that keeps a goal at `goalDistance` visible, with headroom.
 *
 * The goal must not merely touch the fog plane -- three's linear fog reaches full opacity AT
 * `far`, so an object sitting exactly there is already invisible. The margin puts it inside the
 * legible band.
 *
 * @param {number} goalDistance metres from the viewer to the furthest thing that must read.
 * @param {number} margin multiplier for headroom; 1.35 keeps the goal clearly short of full fog.
 */
export function fogFarForGoal(goalDistance, margin = 1.35) {
  const distance = Math.max(0, Number(goalDistance) || 0);
  return distance * Math.max(1.05, margin);
}

/**
 * A directional light's position from an elevation and a compass bearing.
 *
 * Angles rather than a raw vector, because prose describes light in angles ("the sun low on the
 * horizon", "light filtering down from a distant shaft above") and because a hand-written vector
 * is where the axis-sign trap bites: a key light behind the play space lights nothing the camera
 * can see. Routed through the basis, so it holds under any axis convention.
 *
 * @param {number} elevationDeg 0 = at the horizon, 90 = directly overhead.
 * @param {number} azimuthDeg 0 = straight ahead (basis forward), 90 = to the right.
 * @param {number} distance how far out to place the light.
 */
export function lightPositionFromAngles({
  elevationDeg = 55,
  azimuthDeg = 35,
  distance = 60,
  basis = DEFAULT_WORLD_BASIS,
  target = undefined,
} = {}) {
  const elevation = (elevationDeg * Math.PI) / 180;
  const azimuth = (azimuthDeg * Math.PI) / 180;
  const planar = Math.cos(elevation) * distance;
  const right = Math.sin(azimuth) * planar;
  const up = Math.sin(elevation) * distance;
  const forward = Math.cos(azimuth) * planar;
  // `target` is forwarded only when supplied: fromBasisComponents defaults it to a fresh
  // Vector3, and passing an explicit null would defeat that default rather than reuse a buffer.
  return target
    ? basis.fromBasisComponents(right, up, forward, target)
    : basis.fromBasisComponents(right, up, forward);
}

/**
 * Apply a whole look to a scene: background, fog, ambient fill and one directional key.
 *
 * Everything is optional and additive. Passing `fogFar: null` means "no fog", which is the
 * honest choice for a game whose whole space is inside the near plane; it is not the same as
 * forgetting to set it, which is why the parameter is explicit.
 *
 * The shadow extent defaults to covering the fog distance rather than a fixed 60 units: a key
 * light whose shadow frustum is smaller than the space drops half the level out of shadow, which
 * reads as a lighting bug and is really a frustum bug.
 *
 * @returns {{sun: DirectionalLight|null, ambient: AmbientLight|null, fog: Fog|FogExp2|null,
 *            dispose: function}} the pieces, so a caller can animate or remove them.
 */
export function applyAtmosphere(scene, {
  // Sky and fog.
  skyColor = 0x0f141c,
  fogColor = null,
  fogNear = null,
  fogFar = null,
  fogDensity = null,
  // Fill light.
  ambientColor = 0xffffff,
  ambientIntensity = 0.55,
  // Key light.
  keyColor = 0xffffff,
  keyIntensity = 0.85,
  keyElevationDeg = 55,
  keyAzimuthDeg = 35,
  keyDistance = 60,
  shadows = true,
  shadowExtent = null,
  shadowMapSize = 1024,
  basis = DEFAULT_WORLD_BASIS,
} = {}) {
  if (!scene) throw new Error('applyAtmosphere needs a scene');

  if (skyColor !== null && skyColor !== undefined) {
    scene.background = new Color(skyColor);
  }

  let fog = null;
  // Fog colour defaults to the sky: a fog that does not match the horizon draws a visible seam
  // where the ground meets the sky, which reads as a rendering fault.
  const haze = fogColor === null || fogColor === undefined ? skyColor : fogColor;
  if (fogDensity !== null && fogDensity !== undefined) {
    fog = new FogExp2(haze, fogDensity);
  } else if (fogFar !== null && fogFar !== undefined) {
    fog = new Fog(haze, fogNear === null || fogNear === undefined ? fogFar * 0.15 : fogNear, fogFar);
  }
  if (fog) scene.fog = fog;

  let ambient = null;
  if (ambientIntensity > 0) {
    ambient = new AmbientLight(ambientColor, ambientIntensity);
    ambient.name = 'SceneAtmosphere.Ambient';
    scene.add(ambient);
  }

  let sun = null;
  if (keyIntensity > 0) {
    sun = new DirectionalLight(keyColor, keyIntensity);
    sun.name = 'SceneAtmosphere.Key';
    sun.position.copy(lightPositionFromAngles({
      elevationDeg: keyElevationDeg,
      azimuthDeg: keyAzimuthDeg,
      distance: keyDistance,
      basis,
    }));
    if (shadows) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
      // Cover the visible space, not a fixed 60 units.
      const extent = shadowExtent === null || shadowExtent === undefined
        ? Math.max(30, (fogFar ?? keyDistance) * 0.75)
        : shadowExtent;
      Object.assign(sun.shadow.camera, {
        left: -extent, right: extent, top: extent, bottom: -extent,
        far: Math.max(extent * 3, keyDistance * 2.5),
      });
      sun.shadow.radius = 7;
      sun.shadow.blurSamples = 20;
    }
    scene.add(sun);
  }

  function dispose() {
    if (sun) scene.remove(sun);
    if (ambient) scene.remove(ambient);
    if (scene.fog === fog) scene.fog = null;
  }

  return { sun, ambient, fog, dispose };
}
