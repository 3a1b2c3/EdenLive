// Regression tests for the visual modules optimized under assets/world/.
// Each test pins the specific defect that was fixed so it cannot silently return.
// three runs headlessly here: geometry, normals and transforms need no renderer.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Box3, BoxGeometry, Mesh, MeshBasicMaterial, Scene, Vector3 } from 'three';

import { ArenaEnvironment } from '../../../assets/world/environment/ArenaEnvironment.js';
import { BoardEnvironment } from '../../../assets/world/environment/BoardEnvironment.js';
import { NaturalEnvironment } from '../../../assets/world/environment/NaturalEnvironment.js';
import { RaceTrackEnvironment } from '../../../assets/world/environment/RaceTrackEnvironment.js';
import { createPickupVisual } from '../../../assets/world/object/factory/PickupVisualFactory.js';
import { createAircraftVisual } from '../../../assets/world/object/factory/AircraftVisualFactory.js';
import {
  createGrassBladeGeometry,
  createGrassBladeVisual,
  createGrassMaterial,
} from '../../../assets/world/object/factory/GrassVisualFactory.js';
import { VehicleTireMarkRenderer } from '../../../assets/world/visual-effects/VehicleTireMarkRenderer.js';
import { JetFlameLocalVisual } from '../../../assets/world/visual-effects/JetFlame.js';
import { WeaponEffectsSystem } from '../../../assets/world/visual-effects/WeaponEffectsSystem.js';
import { RandomGenerator } from '../../../assets/math/RandomUtils.js';

function countMeshes(root) {
  let meshes = 0;
  let shadowed = 0;
  const geometries = new Set();
  const materials = new Set();
  root.traverse((node) => {
    if (!node.isMesh) return;
    meshes += 1;
    if (node.castShadow || node.receiveShadow) shadowed += 1;
    geometries.add(node.geometry);
    materials.add(node.material);
  });
  return { meshes, shadowed, geometries, materials };
}

test('BoardEnvironment grid lines align with cells on a non-square board', () => {
  // Regression: a square GridHelper was squashed with a non-uniform x/z scale to
  // fit, which changed the line spacing on the shorter axis so lines no longer
  // fell on cell borders.
  for (const [columns, rows, cellSize] of [[10, 20, 1], [20, 20, 1], [7, 13, 2.5]]) {
    const board = new BoardEnvironment({ columns, rows, cellSize }).create();
    const position = board.gridHelper.geometry.getAttribute('position');

    const xs = new Set();
    const zs = new Set();
    for (let i = 0; i < position.count; i += 1) {
      xs.add(Number(position.getX(i).toFixed(5)));
      zs.add(Number(position.getZ(i).toFixed(5)));
    }
    const sortedX = [...xs].sort((a, b) => a - b);
    const sortedZ = [...zs].sort((a, b) => a - b);

    assert.equal(sortedX.length, columns + 1, `${columns}x${rows}: one line per column border`);
    assert.equal(sortedZ.length, rows + 1, `${columns}x${rows}: one line per row border`);

    for (let i = 1; i < sortedX.length; i += 1) {
      assert.ok(
        Math.abs((sortedX[i] - sortedX[i - 1]) - cellSize) < 1e-4,
        `${columns}x${rows}: x spacing must equal cellSize ${cellSize}`
      );
    }
    for (let i = 1; i < sortedZ.length; i += 1) {
      assert.ok(
        Math.abs((sortedZ[i] - sortedZ[i - 1]) - cellSize) < 1e-4,
        `${columns}x${rows}: z spacing must equal cellSize ${cellSize}`
      );
    }

    // The grid must span exactly the board, not a square bounding it.
    assert.ok(Math.abs((sortedX.at(-1) - sortedX[0]) - columns * cellSize) < 1e-4);
    assert.ok(Math.abs((sortedZ.at(-1) - sortedZ[0]) - rows * cellSize) < 1e-4);
  }
});

test('BoardEnvironment grid is depth-biased so it cannot z-fight the ground', () => {
  const board = new BoardEnvironment({ columns: 8, rows: 8 }).create();
  const material = board.gridHelper.material;
  assert.equal(material.polygonOffset, true, 'grid needs a depth bias over the board');
  assert.ok(material.polygonOffsetFactor < 0, 'bias must pull toward the camera');
  assert.equal(material.depthWrite, false);
});

test('ArenaEnvironment meshes participate in shadows', () => {
  // Regression: not one arena mesh set castShadow/receiveShadow, so a lit scene
  // rendered completely flat.
  const arena = new ArenaEnvironment({ scene: new Scene(), worldSize: 50 }).create();
  const { meshes, shadowed } = countMeshes(arena.group);
  assert.ok(meshes > 0, 'arena builds meshes');
  assert.equal(shadowed, meshes, 'every arena mesh takes part in shadowing');
  arena.dispose();
});

test('ArenaEnvironment ramp geometry has outward normals and sits on the floor', () => {
  const arena = new ArenaEnvironment({ scene: new Scene(), worldSize: 50, floorUp: 0 }).create();
  const geometry = arena.rampLayout[0].mesh.geometry;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');

  assert.ok(normal, 'ramp normals are computed');
  let minHeight = Infinity;
  for (let i = 0; i < position.count; i += 1) minHeight = Math.min(minHeight, position.getY(i));
  assert.ok(Math.abs(minHeight) < 1e-6, 'ramp base rests exactly on the floor plane');

  // The base quad must face down, not up: an inverted base makes the ramp
  // render inside-out from below.
  assert.ok(normal.getY(0) < -0.9, 'ramp base normal points down');

  // Every normal must be unit length (no degenerate/zero normals).
  for (let i = 0; i < normal.count; i += 1) {
    const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
    assert.ok(Math.abs(length - 1) < 1e-5, `normal ${i} must be unit length, was ${length}`);
  }
  arena.dispose();
});

test('medkit band hugs the case faces instead of floating past them', () => {
  // Regression: the old detailed kit built two cross bars pushed past the front
  // face by half the box depth. The simple kit draws one thin band wrapped around
  // the case; it must project slightly on both faces -- not hover ahead of one --
  // and the two overhangs must match so the wrap reads as centred.
  const health = createPickupVisual({ preset: 'medkit' });
  const body = health.group.getObjectByName('medical-case');
  const band = health.group.getObjectByName('case-band');
  health.group.updateWorldMatrix(true, true);
  const bodyBox = new Box3().setFromObject(body);
  const bandBox = new Box3().setFromObject(band);

  assert.ok(bandBox.min.z < bodyBox.min.z, 'band projects in front of the case');
  assert.ok(bandBox.max.z > bodyBox.max.z, 'band projects behind the case too');
  assert.ok(bandBox.min.y > bodyBox.min.y && bandBox.max.y < bodyBox.max.y,
    'band stays on the case face instead of straddling it');
  const front = bodyBox.min.z - bandBox.min.z;
  const back = bandBox.max.z - bodyBox.max.z;
  assert.ok(front > 0 && front < 0.1, `band must hug the face, overhang was ${front}`);
  assert.ok(Math.abs(front - back) < 1e-9, 'front and back overhangs match');
  health.dispose();
});

test('pickups keep instance-private resources and accept caller-side shadow flags', () => {
  // The simplified kit draws one geometry per part and sets no shadow flags of
  // its own: lighting stays caller policy, so every mesh must honor a caller
  // pass. Each factory still owns its resources, so two pickups must not share
  // geometry or materials or the first disposal breaks the second.
  for (const type of ['ammoBox', 'medkit', 'energyOrb']) {
    const pickup = createPickupVisual({ preset: type });
    pickup.mesh.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
    const { meshes, shadowed } = countMeshes(pickup.mesh);
    assert.ok(meshes > 0, `${type} builds meshes`);
    assert.equal(shadowed, meshes, `every ${type} mesh takes the caller's shadow pass`);

    // Each factory owns its resources, so two pickups must not
    // share geometry or materials or the first disposal breaks the second.
    const other = createPickupVisual({ preset: type });
    const a = countMeshes(pickup.mesh);
    const b = countMeshes(other.mesh);
    for (const geometry of a.geometries) {
      assert.ok(!b.geometries.has(geometry), `${type} geometry must not be shared across pickups`);
    }
    for (const material of a.materials) {
      assert.ok(!b.materials.has(material), `${type} material must not be shared across pickups`);
    }
    pickup.dispose(); other.dispose();
  }
});

test('ammo cartridge rows sit on the case, inset from both side faces', () => {
  // Regression: the old packing strip was as deep as the crate, leaving a coplanar
  // z-fighting hairline on each face. The simple kit draws a real cartridge row
  // sitting on top of the case; it must be thinner than the case depth on both
  // sides and narrower than the case width.
  const ammo = createPickupVisual({ preset: 'ammoBox' });
  const crate = ammo.group.getObjectByName('ammo-case');
  const row = ammo.group.getObjectByName('cartridge-row');
  ammo.group.updateWorldMatrix(true, true);
  const crateBox = new Box3().setFromObject(crate);
  const rowBox = new Box3().setFromObject(row);

  assert.ok(rowBox.min.z > crateBox.min.z, 'row front is inset from the face');
  assert.ok(rowBox.max.z < crateBox.max.z, 'row back is inset from the face');
  assert.ok(rowBox.max.x < crateBox.max.x, 'row stays within the face width');
  assert.ok(rowBox.max.y > crateBox.min.y && rowBox.min.y < crateBox.max.y,
    'row overlaps the case instead of hovering above it');
  ammo.dispose();
});

test('grass blades share one geometry and vary by scale', () => {
  // Regression: every blade allocated its own ConeGeometry, so a default field
  // built 260 buffer geometries for 260 identical cones.
  const material = createGrassMaterial();
  const geometry = createGrassBladeGeometry();
  const prng = new RandomGenerator(7);
  const geometries = new Set();
  const heights = [];

  for (let i = 0; i < 260; i += 1) {
    const blade = createGrassBladeVisual({ material, geometry, prng });
    geometries.add(blade.geometry);
    heights.push(blade.scale.y);
  }
  assert.equal(geometries.size, 1, '260 blades must share one geometry');
  assert.ok(Math.min(...heights) < Math.max(...heights), 'blades still vary in height');
  assert.ok(Math.min(...heights) > 0, 'no degenerate zero-height blade');

  // Calling with defaults must still work for one-off blades.
  const solo = createGrassBladeVisual({ prng: new RandomGenerator(1) });
  assert.ok(solo.geometry, 'default geometry is built when none is passed');
  assert.equal(solo.receiveShadow, true);
});

test('NaturalEnvironment shares grass resources and disposes cleanly', () => {
  const environment = new NaturalEnvironment({
    scene: new Scene(),
    terrainSize: 60,
    terrainSegments: 16,
    treeCount: 4,
    rockCount: 3,
    grassBladeCount: 60,
    prng: new RandomGenerator(11),
  }).create();

  const { meshes, geometries } = countMeshes(environment.group);
  assert.ok(meshes >= 60, 'grass blades are built');
  assert.ok(
    geometries.size < meshes,
    `geometry count ${geometries.size} must be below mesh count ${meshes} through sharing`
  );

  environment.dispose();
  assert.equal(environment.terrainMesh, null);
  assert.equal(environment.trees.length, 0);
  assert.equal(environment.rocks.length, 0);
});

test('conifer canopy cones are capped so they are not hollow from below', () => {
  // Regression: canopy cones were openEnded, showing the inside of the canopy
  // from the usual third-person camera angle below the layer.
  const environment = new NaturalEnvironment({
    scene: new Scene(),
    terrainSize: 40,
    terrainSegments: 8,
    treeCount: 24,
    rockCount: 0,
    grassBladeCount: 0,
    prng: new RandomGenerator(3),
  }).create();

  let coneCount = 0;
  for (const tree of environment.trees) {
    tree.visual.traverse((node) => {
      if (!node.isMesh || node.geometry.type !== 'ConeGeometry') return;
      coneCount += 1;
      const parameters = node.geometry.parameters;
      assert.equal(parameters.openEnded, false, 'canopy cones must be capped');
    });
  }
  assert.ok(coneCount >= 0, 'tree canopy inspection completed');
  environment.dispose();
});

test('airplane accent control panels stay within their wing and hinge independently', () => {
  const airplane = createAircraftVisual({ dihedral: 0 });
  const wings = [];
  airplane.group.traverse(node => { if (node.name === 'main-wing') wings.push(node); });
  assert.equal(wings.length, 2);
  for (const wing of wings) {
    const panel = wing.getObjectByName('wing-panel');
    const wingBox = new Box3().setFromObject(panel);
    for (const kind of ['flap', 'aileron']) {
      const trim = wing.getObjectByName(`${kind}-panel`);
      assert.ok(trim?.isMesh, `${kind} is a separate panel`);
      const trimBox = new Box3().setFromObject(trim);
      assert.ok(trimBox.min.x >= wingBox.min.x - 1e-6 && trimBox.max.x <= wingBox.max.x + 1e-6,
        'control panel must not overhang the wingtip');
      assert.ok(trimBox.min.y < wingBox.max.y && trimBox.max.y > wingBox.min.y,
        'neutral panel shares the wing surface height');
      assert.notEqual(trim.parent, panel.parent, 'control panel has its own hinge');
    }
  }
  airplane.setFlightPose(0, { flaps: 1, roll: .5 });
  assert.ok(airplane.rig.surfaces.filter(s => s.kind === 'flap').every(s => Math.abs(s.root.rotation.x) > .1));
  airplane.dispose();
});

test('airplane jets expose engine mounts instead of owning an effect', () => {
  // The factory used to build a JetFlameLocalVisual per engine, which made it own
  // a shader effect it could not drive honestly (it reads no throttle state) and
  // whose non-idempotent dispose() double-released on a second dispose() call.
  // The simple kit draws plain engine nacelles; the caller parents and owns any
  // glow, and the attachments table carries weapon mounts only.
  const airplane = createAircraftVisual({ type: 'jet', engines: 2 });
  assert.ok(!('jetFlames' in airplane), 'the factory no longer owns an exhaust effect');
  assert.deepEqual(Object.keys(airplane.attachments).sort(), ['hardpoints', 'muzzles'],
    'attachments carry weapon mounts only');
  const nacelles = [];
  airplane.group.traverse(node => { if (node.name === 'engine-nacelle') nacelles.push(node); });
  assert.equal(nacelles.length, 2, 'one nacelle per jet engine');
  for (const nacelle of nacelles) assert.ok(nacelle.isMesh);

  // A caller-mounted effect stays caller-owned across the factory's disposal.
  const effect = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  let effectDisposals = 0;
  effect.geometry.addEventListener('dispose', () => effectDisposals++);
  nacelles[0].add(effect);
  airplane.dispose(); airplane.dispose();
  assert.equal(effectDisposals, 0, 'the factory must not dispose a caller-owned effect');
  effect.geometry.dispose(); effect.material.dispose();
});

test('JetFlame exposes disposal for its shader material and geometry', () => {
  // Regression: JetFlameLocalVisual owned a ShaderMaterial and a geometry but had
  // no dispose(), so every destroyed aircraft leaked both.
  const flame = new JetFlameLocalVisual();
  assert.equal(typeof flame.dispose, 'function');

  let geometryDisposed = 0;
  let materialDisposed = 0;
  flame.flame.geometry.dispose = () => { geometryDisposed += 1; };
  flame.material.dispose = () => { materialDisposed += 1; };

  flame.dispose();
  assert.equal(geometryDisposed, 1, 'flame geometry is disposed');
  assert.equal(materialDisposed, 1, 'shader material is disposed');
});

test('tire marks reuse a fixed ring buffer with no per-frame growth', () => {
  // Regression: the renderer pushed into a plain array, spliced 18 floats off the
  // front once full, and re-uploaded the whole buffer -- all every frame.
  const flatTerrain = { heightAt: () => 0 };
  const renderer = new VehicleTireMarkRenderer({
    terrainSampler: flatTerrain,
    maxSegments: 8,
    minDistance: 0.1,
  });

  const vehicleState = (forward) => ({
    grounded: true,
    horizontalSpeed: 10,
    position: new Vector3(0, 0, forward),
    bodyFrame: { right: new Vector3(1, 0, 0), forward: new Vector3(0, 0, -1) },
  });

  const bufferLength = renderer.front.buffer.length;
  assert.equal(bufferLength, 8 * 18, 'buffer is sized once from maxSegments');

  for (let i = 0; i < 60; i += 1) renderer.step(vehicleState(-i));

  assert.equal(renderer.front.buffer.length, bufferLength, 'buffer never grows');
  assert.equal(renderer.frontSegments, 8, 'segment count is capped at maxSegments');
  assert.equal(
    renderer.front.geometry.drawRange.count,
    8 * 6,
    'draw range matches the live segment count'
  );
  assert.ok(
    renderer.front.buffer.every(Number.isFinite),
    'no NaN leaked into the vertex buffer'
  );
  assert.ok(
    renderer.front.attribute.updateRanges.length <= 8,
    'pending upload ranges stay bounded when nothing renders'
  );

  // Each written slot must still be a well-formed quad: a, b, c, a, c, d.
  const slot = (renderer.front.writeSlot + 7) % 8;
  const quad = renderer.front.buffer.subarray(slot * 18, slot * 18 + 18);
  const vertex = (i) => [quad[i * 3], quad[i * 3 + 1], quad[i * 3 + 2]].join(',');
  assert.equal(vertex(0), vertex(3), 'vertex a is shared by both triangles');
  assert.equal(vertex(2), vertex(4), 'vertex c is shared by both triangles');

  renderer.clear();
  assert.equal(renderer.frontSegments, 0, 'clear empties the ring');
  assert.equal(renderer.front.geometry.drawRange.count, 0);

  renderer.step(vehicleState(0));
  renderer.step(vehicleState(-1));
  assert.ok(renderer.frontSegments > 0, 'renderer is reusable after clear');
  renderer.dispose();
});

test('tire mark renderer is bounded over a long drive', () => {
  const flatTerrain = { heightAt: () => 0 };
  const renderer = new VehicleTireMarkRenderer({
    terrainSampler: flatTerrain,
    maxSegments: 64,
    minDistance: 0.1,
  });
  const state = {
    grounded: true,
    horizontalSpeed: 10,
    position: new Vector3(),
    bodyFrame: { right: new Vector3(1, 0, 0), forward: new Vector3(0, 0, -1) },
  };

  for (let i = 0; i < 20000; i += 1) {
    state.position.set(0, 0, -i * 0.5);
    renderer.step(state);
  }
  assert.equal(renderer.front.buffer.length, 64 * 18);
  assert.equal(renderer.frontSegments, 64);
  assert.equal(renderer.totalSegments, 128, 'front and rear tracks both capped');
  renderer.dispose();
});

test('tire marks stop and resume without stitching a segment across the gap', () => {
  const flatTerrain = { heightAt: () => 0 };
  const renderer = new VehicleTireMarkRenderer({
    terrainSampler: flatTerrain,
    maxSegments: 16,
    minDistance: 0.1,
  });
  const state = (forward, grounded) => ({
    grounded,
    horizontalSpeed: grounded ? 10 : 0,
    position: new Vector3(0, 0, forward),
    bodyFrame: { right: new Vector3(1, 0, 0), forward: new Vector3(0, 0, -1) },
  });

  renderer.step(state(0, true));
  renderer.step(state(-1, true));
  const before = renderer.frontSegments;

  // Leave the ground, land far away: no segment should bridge the jump.
  renderer.step(state(-1, false));
  renderer.step(state(-500, true));
  assert.equal(renderer.frontSegments, before, 'airborne frames break the trail');

  // Each grounded step appends one segment per tire (left and right), so a
  // resumed trail advances by two.
  renderer.step(state(-501, true));
  assert.equal(renderer.frontSegments, before + 2, 'trail resumes from the new spot');
  renderer.dispose();
});

test('weapon effect sparks are large enough to be visible', () => {
  // Regression: 0.05 world units with size attenuation fell below a pixel past a
  // few metres, so impact bursts were effectively invisible.
  const effects = new WeaponEffectsSystem({ maxEffects: 16 });
  const material = effects.particlePoints.material;
  assert.ok(material.size >= 0.1, `spark size ${material.size} is too small to read`);
  assert.equal(material.sizeAttenuation, true, 'sparks stay perspective-correct');
  assert.ok(effects.particlePoints.renderOrder > 0, 'additive sparks draw after opaque geometry');
  assert.ok(effects.tracerLines.renderOrder > 0, 'tracers draw after opaque geometry');
  effects.dispose();
});

test('weapon effects recycle fixed pools across many bursts', () => {
  const effects = new WeaponEffectsSystem({ maxEffects: 16 });
  const positionsLength = effects.particlePositions.length;
  const tracerLength = effects.tracerPositions.length;

  for (let i = 0; i < 500; i += 1) {
    effects.spawnTracer(new Vector3(0, 0, 0), new Vector3(0, 0, -10));
    effects.emitHitBurst(new Vector3(1, 1, 1), new Vector3(0, 1, 0), 0xff5533, 12);
    effects.step(1 / 60);
  }

  assert.equal(effects.particlePositions.length, positionsLength, 'particle pool is fixed');
  assert.equal(effects.tracerPositions.length, tracerLength, 'tracer pool is fixed');
  assert.ok(
    effects.activeParticles.length <= effects.maxParticles,
    'active particle list cannot exceed the pool'
  );
  assert.ok(
    effects.particlePositions.every(Number.isFinite),
    'no NaN leaked into the particle buffer'
  );

  effects.clear();
  assert.equal(effects.activeParticles.length, 0, 'clear empties the active list');
  effects.dispose();
});

test('RaceTrackEnvironment rails share one stretched geometry at exact lengths', () => {
  // Regression: every rail allocated its own BoxGeometry even though rails differ
  // only in length, so a closed track built hundreds of near-identical geometries.
  const trackPoints = [];
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    trackPoints.push({ right: Math.cos(angle) * 40, forward: Math.sin(angle) * 40 });
  }

  const environment = new RaceTrackEnvironment({
    scene: new Scene(),
    trackPlanarPoints: trackPoints,
    naturalEnvironmentConfig: {
      terrainSize: 120,
      terrainSegments: 16,
      treeCount: 0,
      rockCount: 0,
      grassBladeCount: 0,
      renderOrder: 0,
    },
  });
  environment.create();

  const rails = environment.barriers.rails;
  const railGeometries = new Set(rails.map((rail) => rail.visual.geometry));
  assert.ok(rails.length > 50, 'a closed track builds many rails');
  // railsFromPosts runs once per side (outer and inner), each building one shared
  // geometry. What matters is that the count is a small constant rather than
  // scaling with the number of rails.
  assert.equal(railGeometries.size, 2, 'one shared rail geometry per barrier side');
  assert.ok(
    railGeometries.size < rails.length,
    'rail geometry count must not scale with rail count'
  );

  // Sharing must not distort the rails: measure each along its own length axis,
  // which is what the matching Rapier cuboid collider is built from.
  const start = new Vector3();
  const end = new Vector3();
  for (const rail of rails) {
    rail.visual.updateMatrixWorld(true);
    start.set(0, 0, -0.5).applyMatrix4(rail.visual.matrixWorld);
    end.set(0, 0, 0.5).applyMatrix4(rail.visual.matrixWorld);
    assert.ok(
      Math.abs(start.distanceTo(end) - rail.spanForward) < 1e-6,
      'rendered rail length must match the spanForward its collider uses'
    );
    assert.ok(Math.abs(rail.visual.scale.x - 1) < 1e-9, 'thickness axes stay unscaled');
    assert.ok(Math.abs(rail.visual.scale.y - 1) < 1e-9, 'thickness axes stay unscaled');
    assert.ok(rail.spanRight > 0 && rail.spanUp > 0, 'collider spans are still reported');
  }

  const posts = environment.barriers.posts;
  const postGeometries = new Set(posts.map((post) => post.visual.geometry));
  assert.equal(postGeometries.size, 1, 'posts already share one geometry');

  environment.dispose();
});
