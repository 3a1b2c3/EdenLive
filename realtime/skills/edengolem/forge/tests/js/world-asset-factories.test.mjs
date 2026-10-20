const sample = (asset, motion, seconds) => asset.setPose(motion, seconds);
// Behavior tests for the simplified world asset factories added after character/train.
// Those two are covered by visual-factories.test.mjs; these five share the same
// scene-visual profile but are static or pose-only, so they need their own checks.
// Grass is deliberately excluded: it is a shared-resource helper with no profile
// ports, and visual-regressions.test.mjs already pins its sharing contract.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { createWorldBasis } from '../../../assets/math/WorldBasis.js';
import {
  buildHouseVisual, createHouseVisual, normalizeHouseOptions,
  randomHouseOptions, HOUSE_PRESETS, HOUSE_SCHEMA,
} from '../../../assets/world/object/factory/HouseVisualFactory.js';
import {
  buildBuildingVisual, createBuildingVisual, normalizeBuildingOptions,
  randomBuildingOptions, BUILDING_PRESETS, BUILDING_SCHEMA,
} from '../../../assets/world/object/factory/BuildingVisualFactory.js';
import {
  buildTreeVisual, createTreeVisual, normalizeTreeOptions,
  randomTreeOptions, TREE_PRESETS, TREE_SCHEMA,
} from '../../../assets/world/object/factory/TreeVisualFactory.js';
import {
  buildVehicleVisual, createVehicleVisual, normalizeVehicleOptions,
  randomVehicleOptions, VEHICLE_PRESETS, VEHICLE_SCHEMA,
} from '../../../assets/world/object/factory/VehicleVisualFactory.js';
import {
  buildAircraftVisual, createAircraftVisual, normalizeAircraftOptions,
  randomAircraftOptions, AIRCRAFT_PRESETS, AIRCRAFT_SCHEMA,
} from '../../../assets/world/object/factory/AircraftVisualFactory.js';

// `colorKey` is a palette key the factory actually has, so invalid-color cases
// exercise validation rather than the ignored-unknown-key path.
const entries = [
  { name: 'house', create: createHouseVisual, build: buildHouseVisual,
    normalize: normalizeHouseOptions, random: randomHouseOptions,
    presets: HOUSE_PRESETS, schema: HOUSE_SCHEMA, colorKey: 'wall', numberKey: 'width' },
  { name: 'building', create: createBuildingVisual, build: buildBuildingVisual,
    normalize: normalizeBuildingOptions, random: randomBuildingOptions,
    presets: BUILDING_PRESETS, schema: BUILDING_SCHEMA, colorKey: 'wall', numberKey: 'width' },
  { name: 'tree', create: createTreeVisual, build: buildTreeVisual,
    normalize: normalizeTreeOptions, random: randomTreeOptions,
    presets: TREE_PRESETS, schema: TREE_SCHEMA, colorKey: 'bark', numberKey: 'height' },
  { name: 'vehicle', create: createVehicleVisual, build: buildVehicleVisual,
    normalize: normalizeVehicleOptions, random: randomVehicleOptions,
    presets: VEHICLE_PRESETS, schema: VEHICLE_SCHEMA, colorKey: 'body', numberKey: 'length' },
  { name: 'aircraft', create: createAircraftVisual, build: buildAircraftVisual,
    normalize: normalizeAircraftOptions, random: randomAircraftOptions,
    presets: AIRCRAFT_PRESETS, schema: AIRCRAFT_SCHEMA, colorKey: 'body', numberKey: 'length' },
];

function finiteVisual(asset) {
  assert.ok(asset.group.isObject3D);
  assert.equal(asset.mesh, asset.group);
  assert.ok(!asset.bounds.isEmpty());
  for (const n of [...asset.bounds.min, ...asset.bounds.max, ...asset.dimensions]) {
    assert.ok(Number.isFinite(n));
  }
  assert.ok(asset.dimensions.x > 0 && asset.dimensions.y > 0 && asset.dimensions.z > 0);
  assert.ok(asset.bounds.getSize(new Vector3()).distanceTo(asset.dimensions) < 1e-8);
  asset.group.updateMatrixWorld(true, true);
  asset.group.traverse(node => {
    assert.ok(node.matrixWorld.elements.every(Number.isFinite), node.name);
    if (node.isMesh) {
      assert.ok(Array.from(node.geometry.attributes.position.array).every(Number.isFinite), node.name);
      assert.ok(Array.from(node.geometry.attributes.normal.array).every(Number.isFinite), node.name);
      assert.ok([...node.scale].every(n => n > 0), node.name);
    }
  });
}

function resources(asset) {
  const result = new Set();
  asset.group.traverse(node => {
    if (node.geometry) result.add(node.geometry);
    for (const material of [node.material].flat().filter(Boolean)) result.add(material);
  });
  return result;
}

function transforms(asset) {
  const list = [];
  asset.group.traverse(node => list.push([node.name, ...node.position, ...node.quaternion, ...node.scale]
    .map(value => typeof value === 'number' ? Number(value.toFixed(12)) + 0 : value)));
  return list;
}

// The one field per factory whose value must survive randomization, because it
// selects which parts get built rather than tuning a built part.
const structuralField = { house: 'layout', building: 'massing', tree: 'shape', vehicle: 'type', aircraft: 'type' };

test('world asset entrypoint aliases preserve the prototype API', () => {
  for (const entry of entries) assert.equal(entry.create, entry.build, entry.name);
});

for (const entry of entries) {
  test(`${entry.name}: defaults, all presets and sampled seeds construct finite visuals seated on y=0`, () => {
    for (const options of [{}, ...Object.keys(entry.presets).map(preset => ({ preset })),
      ...Array.from({ length: 16 }, (_, seed) => entry.random(seed))]) {
      const asset = entry.create(options);
      finiteVisual(asset);
      assert.ok(Object.isFrozen(asset.params));
      assert.ok(Object.isFrozen(asset.params.colors));
      // The documented origin contract: the root rests on the ground plane, so a
      // caller can place by ground position without measuring first.
      assert.ok(Math.abs(asset.bounds.min.y) < 1e-6,
        `${entry.name} ${JSON.stringify(options.preset ?? 'default')} min.y ${asset.bounds.min.y}`);
      const stats = asset.getStats();
      assert.ok(stats.meshes > 0 && stats.triangles > 0);
      assert.ok(stats.geometries > 0 && stats.materials > 0);
      asset.dispose();
    }
  });

  test(`${entry.name}: every enum choice and range endpoint builds finite geometry`, () => {
    // Extreme-but-legal inputs are where coupled dimensions collapse into
    // degenerate geometry, so cover each schema field's own limits rather than
    // trusting the presets to have visited them.
    for (const [key, field] of Object.entries(entry.schema)) {
      const values = field.choices ? Object.keys(field.choices)
        : typeof field.default === 'boolean' ? [true, false]
          : [field.min, field.max];
      for (const value of values) {
        const asset = entry.create({ [key]: value });
        finiteVisual(asset);
        assert.ok(Math.abs(asset.bounds.min.y) < 1e-6, `${entry.name} ${key}=${value}`);
        asset.dispose();
      }
    }
  });

  test(`${entry.name}: reproducible geometry and structural variety with explicit override precedence`, () => {
    const options = entry.random(42, { colors: { [entry.colorKey]: '#112233' } });
    assert.deepEqual(options, entry.random(42, { colors: { [entry.colorKey]: '#112233' } }));
    const a = entry.create(options), b = entry.create(JSON.parse(JSON.stringify(options)));
    assert.deepEqual(transforms(a), transforms(b));
    const signatures = new Set();
    for (let seed = 1; seed <= 8; seed++) {
      const c = entry.create(entry.random(seed));
      signatures.add(JSON.stringify(transforms(c)));
      c.dispose();
    }
    assert.ok(signatures.size > 1, 'randomization must change shape, not only paint');
    const overrides = { [entry.numberKey]: entry.schema[entry.numberKey].min,
      colors: { [entry.colorKey]: '#112233' } };
    const normalized = entry.random(42, overrides);
    assert.equal(normalized[entry.numberKey], entry.schema[entry.numberKey].min);
    assert.equal(normalized.colors[entry.colorKey], '#112233');
    assert.ok(!Object.isFrozen(overrides.colors), 'do not freeze caller-owned input');
    a.dispose(); b.dispose();
  });

  test(`${entry.name}: randomization keeps the structural field it must not reshuffle`, () => {
    // Randomizing e.g. a vehicle's `type` would build a different asset category
    // than the preset the caller asked for, so those fields are pinned.
    const field = structuralField[entry.name];
    for (const preset of Object.keys(entry.presets)) {
      const base = entry.normalize({ preset });
      for (const seed of [1, 5, 9]) {
        assert.equal(entry.random(seed, { preset })[field], base[field], `${preset} seed ${seed}`);
      }
    }
  });

  test(`${entry.name}: invalid options fail, finite numbers clamp and normalization is idempotent`, () => {
    // Unknown keys are ignored and an empty palette falls back to defaults, so a
    // null color for one key is tolerated by readPalette's `??` fallback.
    for (const options of [null, { preset: 'missing' },
      { [entry.numberKey]: NaN }, { [entry.numberKey]: Infinity }, { [entry.numberKey]: '2' },
      { colors: { [entry.colorKey]: 'not-a-color' } }]) {
      assert.throws(() => entry.create(options), `${entry.name} ${JSON.stringify(options)}`);
    }
    for (const [key, field] of Object.entries(entry.schema)) {
      if (field.choices) assert.throws(() => entry.create({ [key]: 'not-a-choice' }), key);
      else if (typeof field.default === 'boolean') assert.throws(() => entry.create({ [key]: 'yes' }), key);
    }
    for (const seed of [NaN, Infinity, 1.2, '42']) assert.throws(() => entry.random(seed));
    const clamped = entry.normalize({ [entry.numberKey]: -1e6 });
    assert.equal(clamped[entry.numberKey], entry.schema[entry.numberKey].min);
    assert.equal(entry.normalize({ [entry.numberKey]: 1e6 })[entry.numberKey],
      entry.schema[entry.numberKey].max);
    assert.deepEqual(clamped, entry.normalize(clamped));
    assert.deepEqual(entry.normalize(entry.normalize({})), entry.normalize({}));
  });

  test(`${entry.name}: explicit options beat presets and caller input is never mutated`, () => {
    const preset = Object.keys(entry.presets)[1];
    const input = { preset, [entry.numberKey]: entry.schema[entry.numberKey].max,
      colors: { [entry.colorKey]: '#0a0b0c' } };
    const snapshot = JSON.parse(JSON.stringify(input));
    const resolved = entry.normalize(input);
    assert.deepEqual(input, snapshot, 'normalization must not mutate caller options');
    assert.ok(!Object.isFrozen(input) && !Object.isFrozen(input.colors));
    assert.equal(resolved[entry.numberKey], entry.schema[entry.numberKey].max);
    assert.equal(resolved.colors[entry.colorKey], '#0a0b0c');
    // Per-key palette merge: an unspecified key keeps the preset/base value
    // rather than being dropped by a shallow palette replacement.
    const presetColors = entry.presets[preset].colors ?? {};
    for (const [key, value] of Object.entries(presetColors)) {
      if (key === entry.colorKey) continue;
      assert.equal(resolved.colors[key], value, `preset color ${key} must survive a partial override`);
    }
    // An integer color is as legal as a hex string.
    assert.equal(entry.normalize({ colors: { [entry.colorKey]: 0xff0000 } }).colors[entry.colorKey], 0xff0000);
  });

  test(`${entry.name}: resources are bounded, private, disposed exactly once and do not own attachments`, () => {
    const a = entry.create({}), b = entry.create({});
    const owned = resources(a), other = resources(b);
    for (const resource of owned) assert.ok(!other.has(resource), 'instances must not share GPU resources');
    const events = new Map();
    for (const resource of [...owned, ...other]) {
      events.set(resource, 0);
      resource.addEventListener('dispose', () => events.set(resource, events.get(resource) + 1));
    }
    const callerObject = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    let callerDisposals = 0;
    callerObject.geometry.addEventListener('dispose', () => callerDisposals++);
    a.group.add(callerObject);
    const parent = new Group();
    parent.add(a.group);
    a.dispose(); a.dispose();
    assert.equal(a.group.parent, null, 'dispose detaches the root');
    assert.equal(parent.children.length, 0);
    for (const resource of owned) assert.equal(events.get(resource), 1, 'owned resources release exactly once');
    for (const resource of other) assert.equal(events.get(resource), 0, 'another instance must survive');
    assert.equal(callerDisposals, 0, 'caller attachments stay caller-owned');
    b.dispose();
    for (const resource of other) assert.equal(events.get(resource), 1);
    callerObject.geometry.dispose(); callerObject.material.dispose();
  });
}

// These three take motion ids, unlike the number-only clocks of the detailed set.
// Pose APIs take an absolute value rather than a delta, so they have no hidden
// clock to reset: passing 0 is the documented way back to rest.
const posed = [
  { name: 'tree', create: createTreeVisual, options: {}, motion: 'wind', sample: 1.7 },
  { name: 'vehicle', create: createVehicleVisual, options: {}, motion: 'drive', sample: 12.5 },
  { name: 'aircraft', create: createAircraftVisual, options: { preset: 'twinprop' }, motion: 'fly', sample: 2.4 },
];

for (const entry of posed) {
  test(`${entry.name}: setPose animates parts, preserves placement and is deterministic in absolute time`, () => {
    const asset = entry.create(entry.options);
    const parent = new Group();
    const basis = createWorldBasis({ right: '+x', up: '+z', forward: '+y' });
    parent.quaternion.copy(basis.threeObjectCanonicalToBasisQuaternion());
    parent.position.set(7, 12, -3);
    parent.add(asset.group);
    asset.group.position.set(-4, 2, 8);
    asset.group.rotation.y = 0.43;
    asset.group.scale.setScalar(1.7);
    const placement = [...asset.group.position, ...asset.group.quaternion, ...asset.group.scale];
    const bounds = asset.bounds.clone();
    const rest = transforms(asset);
    const stats = asset.getStats();

    assert.equal(sample(asset, entry.motion, entry.sample), asset, 'setPose returns the instance');
    finiteVisual(asset);
    assert.notDeepEqual(transforms(asset), rest, 'setPose must move something');
    assert.deepEqual([...asset.group.position, ...asset.group.quaternion, ...asset.group.scale], placement,
      'setPose must not move the placement root');
    assert.equal(asset.group.parent, parent);
    assert.ok(bounds.equals(asset.bounds), 'rest bounds remain a local construction snapshot');

    // Absolute time in, same pose out: no hidden clock accumulating across calls.
    const sampled = transforms(asset);
    sample(asset, entry.motion, entry.sample * 3);
    sample(asset, entry.motion, entry.sample);
    assert.deepEqual(transforms(asset), sampled, 'the same argument must reproduce the same pose');

    // A bounded animation must not allocate per call.
    for (let i = 0; i < 500; i++) sample(asset, entry.motion, i / 60);
    assert.deepEqual(asset.getStats(), stats, 'posing must not allocate meshes or resources');

    sample(asset, entry.motion, 0);
    assert.deepEqual(transforms(asset), rest, 'setPose(0) returns to the rest pose');
    asset.dispose();
  });

  test(`${entry.name}: rejected poses change nothing and posing after disposal throws`, () => {
    const asset = entry.create(entry.options);
    sample(asset, entry.motion, entry.sample);
    const good = transforms(asset);
    for (const value of [NaN, Infinity, -Infinity]) {
      assert.throws(() => sample(asset, entry.motion, value), /finite/, `setPose(${value})`);
      assert.deepEqual(transforms(asset), good, 'a rejected pose must not half-apply');
    }
    asset.dispose();
    assert.throws(() => sample(asset, entry.motion, entry.sample), /disposed/);
  });
}

test('tree: parameters pin the silhouette and wind scales the sway', () => {
  // No shape seed in the simplified factory: the parameters fully determine the
  // tree, so equal options must rebuild the same geometry.
  const options = { shape: 'cone', height: 9, crownWidth: 4 };
  const a = createTreeVisual(options), b = createTreeVisual(options);
  const c = createTreeVisual({ ...options, crownWidth: 7 });
  assert.deepEqual(transforms(a), transforms(b), 'equal options must rebuild the same tree');
  assert.notDeepEqual(transforms(a), transforms(c), 'a different crown must reshape the silhouette');
  assert.equal(a.params.height, c.params.height);

  const still = createTreeVisual({ wind: 0 });
  const rest = transforms(still);
  still.setPose('wind', 9);
  assert.deepEqual(transforms(still), rest, 'wind: 0 must hold the rest pose at every time');
  const windy = createTreeVisual({ wind: 1 });
  windy.setPose('wind', 9);
  assert.ok(Math.abs(windy.rig.rotation.z) > 0, 'wind: 1 must sway');
  for (const asset of [a, b, c, still, windy]) asset.dispose();
});

test('vehicle: wheels roll from travel distance and steering is fixed at construction', () => {
  const car = createVehicleVisual({ preset: 'sedan' });
  assert.equal(car.wheels.length, 4, 'two axles on both sides');
  assert.equal(car.wheels.filter(wheel => wheel.axle === 0).length, 2);
  assert.equal(car.steeringPivots.length, 2, 'both front wheel pivots steer');

  // Rotation is derived from distance, not integrated, so it cannot drift out of
  // sync with actual travel and reversing distance reverses the wheels.
  car.setPose('drive', 10);
  for (const wheel of car.wheels) {
    assert.ok(wheel.radius > 0);
    assert.ok(Math.abs(wheel.pivot.rotation.x - (-60 / wheel.radius)) < 1e-9,
      `drive 10s must roll each wheel by -60 / its own radius`);
  }
  car.setPose('drive', -10);
  for (const wheel of car.wheels) {
    assert.ok(wheel.pivot.rotation.x > 0, 'reverse travel rolls the wheels backward');
    assert.ok(Math.abs(wheel.pivot.rotation.x - (60 / wheel.radius)) < 1e-9);
  }
  // Rolling without slipping: every wheel's angle-radius product is the distance.
  const distances = car.wheels.map(wheel => wheel.pivot.rotation.x * wheel.radius);
  assert.ok(distances.every(distance => Math.abs(distance - 60) < 1e-9));

  // Steering is a construction option, so posing must not touch the front angle,
  // and both front wheels share it (no inner/outer differential in the simple set).
  const steered = createVehicleVisual({ steering: 30 });
  const expected = Math.PI * 30 / 180;
  assert.ok(steered.steeringPivots.every(pivot => Math.abs(pivot.rotation.y - expected) < 1e-9));
  steered.setPose('drive', 4);
  assert.ok(steered.steeringPivots.every(pivot => Math.abs(pivot.rotation.y - expected) < 1e-9),
    'posing must not touch the steering');

  // A tractor's rear wheels are larger, so per-wheel radii must differ.
  const tractor = createVehicleVisual({ preset: 'tractor' });
  assert.ok(new Set(tractor.wheels.map(wheel => wheel.radius)).size > 1);
  for (const asset of [car, steered, tractor]) asset.dispose();
});

test('aircraft: rotors, cannon muzzles and hardpoints populate per type', () => {
  // The simplified engine split: a propeller engine or helicopter rotor gives a
  // spinning rotor and everything else has none. Engine nacelles carry no
  // exhaust mounts anymore; fighters trade them for a cannon muzzle and hardpoints.
  const expected = {
    trainer: { rotors: 1 }, biplane: { rotors: 1 },
    twinprop: { rotors: 2 }, turboprop: { rotors: 2 },
    helicopter: { rotors: 2 },
    business: { rotors: 0 }, airliner: { rotors: 0 }, jumbo: { rotors: 0 },
    cargo: { rotors: 0 }, delta: { rotors: 0 }, flyingwing: { rotors: 0 },
    glider: { rotors: 0 },
  };
  for (const [preset, counts] of Object.entries(expected)) {
    const asset = createAircraftVisual({ preset });
    assert.equal(asset.rotors.length, counts.rotors, `${preset} rotors`);
    for (const rotor of asset.rotors) assert.ok(rotor.isObject3D);
    if (counts.rotors === 0) {
      // Nothing spins, but the control surfaces still answer: banking must
      // deflect them so a jet or glider still reads as posed.
      const rest = transforms(asset);
      asset.setPose('bank', 3);
      assert.notDeepEqual(transforms(asset), rest, `${preset} must still steer its control surfaces`);
    }
    asset.dispose();
  }
  const fighter = createAircraftVisual({ preset: 'lightFighter' });
  assert.equal(fighter.rotors.length, 0);
  assert.equal(fighter.attachments.muzzles.length, 1, 'one cannon muzzle');
  assert.equal(fighter.attachments.hardpoints.length, 2, 'one weapon pair');
  const airliner = createAircraftVisual({ preset: 'airliner' });
  assert.equal(airliner.attachments.muzzles.length, 0);
  assert.equal(airliner.attachments.hardpoints.length, 0);
  fighter.dispose(); airliner.dispose();
});

test('aircraft: the factory owns no exhaust effect and leaves mounts to the caller', () => {
  // Regression: the detailed factory built a jet flame per engine and stepped it
  // at a hard-coded throttle; its dispose() was not idempotent, so a second
  // factory dispose() double-released resources. The simplified factory ships no
  // exhaust effect and no exhaust mounts at all.
  const jet = createAircraftVisual({ preset: 'airliner' });
  assert.equal(jet.attachments.exhausts, undefined, 'no factory exhaust mounts');
  const stats = jet.getStats();
  for (let i = 0; i < 400; i++) jet.setPose('fly', i / 60);
  assert.deepEqual(jet.getStats(), stats, 'posing must not allocate');

  // A cannon muzzle is a caller-facing mount: an effect hung off it survives
  // factory disposal and stays caller-owned.
  const fighter = createAircraftVisual({ preset: 'lightFighter' });
  const effect = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  let effectDisposals = 0;
  effect.geometry.addEventListener('dispose', () => effectDisposals++);
  fighter.attachments.muzzles[0].add(effect);
  fighter.dispose(); fighter.dispose();
  assert.equal(effectDisposals, 0, 'a caller-mounted effect survives repeated factory disposal');
  jet.dispose();
  effect.geometry.dispose(); effect.material.dispose();
});

test('house: the entrance attachment sits under the root and stays caller-owned', () => {
  const house = createHouseVisual({ preset: 'farmhouse' });
  const entrance = house.attachments.entrance;
  assert.ok(entrance.isObject3D);
  assert.equal(entrance.parent, house.group, 'attachments mount under the placement root');

  // A mount must follow the root through a parent transform, which is what makes
  // it usable for caller-owned markers.
  const parent = new Group();
  parent.position.set(5, 0, -2);
  parent.add(house.group);
  house.group.position.set(1, 0, 3);
  parent.updateMatrixWorld(true);
  const world = entrance.getWorldPosition(new Vector3());
  assert.ok(Math.abs(world.x - 6) < 1e-6 && Math.abs(world.z - (3 - 2 + entrance.position.z)) < 1e-6);

  const marker = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  let markerDisposals = 0;
  marker.geometry.addEventListener('dispose', () => markerDisposals++);
  entrance.add(marker);
  house.dispose();
  assert.equal(markerDisposals, 0, 'a mounted marker is released by the caller, not the factory');
  marker.geometry.dispose(); marker.material.dispose();
});

test('building: simplified massing stays inside a tight mesh budget at any floor count', () => {
  // Regression: the detailed factory punched windows per cell and could reach
  // ~10k meshes and ~121k triangles on the largest legal massings -- far past a
  // greybox budget. The simplified builder is a few boxes per volume, so even
  // the biggest floor counts stay trivial.
  for (const options of [
    { massing: 'row', blocks: 6, floors: 30, width: 20, depth: 22 },
    { massing: 'courtyard', floors: 30 },
    { massing: 'setback', floors: 30, tiers: 5, width: 20, depth: 22 },
    { massing: 'row', blocks: 6, floors: 30 },
    { massing: 'podium', floors: 30, podiumScale: 1.8, width: 20, depth: 22 },
  ]) {
    const asset = createBuildingVisual(options);
    const stats = asset.getStats();
    assert.ok(stats.meshes < 400,
      `${JSON.stringify(options)} built ${stats.meshes} meshes; box massing must stay cheap`);
    finiteVisual(asset);
    // The floor count still determines the actual height.
    assert.ok(asset.dimensions.y > options.floors * 2,
      'the floor count must survive the simplified massing');
    asset.dispose();
  }

  // Ordinary buildings stay far below the budget, so their silhouette is untouched.
  for (const preset of Object.keys(BUILDING_PRESETS)) {
    const asset = createBuildingVisual({ preset });
    assert.ok(asset.getStats().meshes < 100, `${preset} is a small scene asset`);
    asset.dispose();
  }
});

test('building: multi-volume massing reports a footprint wider than its width option', () => {
  // Placing a row or twin block against `width` overlaps neighbours; the
  // documented answer is to place against `dimensions`.
  for (const options of [{ massing: 'row', blocks: 4, width: 6, spacing: 1 },
    { massing: 'twins', width: 6, spacing: 2 }]) {
    const asset = createBuildingVisual(options);
    assert.ok(asset.dimensions.x > options.width * 1.5,
      `${options.massing} footprint ${asset.dimensions.x} must exceed width ${options.width}`);
    finiteVisual(asset);
    asset.dispose();
  }
  // Setback tiers stack instead of spreading, and clamp to the floor count.
  const tall = createBuildingVisual({ massing: 'setback', floors: 12, tiers: 4, floorHeight: 3 });
  assert.ok(Math.abs(tall.dimensions.y - 12 * 3) < 3, 'stacked tiers total the requested floors');
  const shallow = createBuildingVisual({ massing: 'setback', floors: 2, tiers: 5 });
  finiteVisual(shallow);
  tall.dispose(); shallow.dispose();
});

test('local bounds stay local: a rotated root needs a transformed copy', () => {
  // The trap this pins: reading `bounds` after rotating the root and treating it
  // as a world AABB. It is a construction snapshot and never updates.
  const asset = createVehicleVisual({ preset: 'bus' });
  const snapshot = asset.bounds.clone();
  asset.group.position.set(10, 0, -5);
  asset.group.rotation.y = Math.PI / 4;
  asset.group.updateMatrixWorld(true);
  assert.ok(asset.bounds.equals(snapshot), 'bounds must not track the root transform');
  const world = asset.bounds.clone().applyMatrix4(asset.group.matrixWorld);
  const measured = new Box3().setFromObject(asset.group, true);
  // A rotated AABB is conservative, so it must contain the true measured box.
  assert.ok(world.containsBox(measured) || world.intersectsBox(measured));
  assert.ok(world.min.distanceTo(snapshot.min) > 1, 'the transformed copy differs from the local box');
  asset.dispose();
});