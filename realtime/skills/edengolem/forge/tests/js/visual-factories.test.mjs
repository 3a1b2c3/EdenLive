import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { createWorldBasis } from '../../../assets/math/WorldBasis.js';
import {
  buildCharacterVisual, createCharacterVisual, normalizeCharacterOptions,
  randomCharacterOptions, CHARACTER_PRESETS, CHARACTER_MOTIONS, CHARACTER_SCHEMA,
} from '../../../assets/world/object/factory/CharacterVisualFactory.js';
import {
  buildTrainVisual, createTrainVisual, normalizeTrainOptions,
  randomTrainOptions, TRAIN_PRESETS,
} from '../../../assets/world/object/factory/TrainVisualFactory.js';

const entries = [
  { name: 'character', create: createCharacterVisual, normalize: normalizeCharacterOptions,
    random: randomCharacterOptions, presets: CHARACTER_PRESETS },
  { name: 'train', create: createTrainVisual, normalize: normalizeTrainOptions,
    random: randomTrainOptions, presets: TRAIN_PRESETS },
];

function finiteVisual(asset) {
  assert.ok(asset.group.isObject3D);
  assert.equal(asset.mesh, asset.group);
  assert.ok(!asset.bounds.isEmpty());
  for (const n of [...asset.bounds.min, ...asset.bounds.max, ...asset.dimensions]) assert.ok(Number.isFinite(n));
  assert.ok(asset.dimensions.x > 0 && asset.dimensions.y > 0 && asset.dimensions.z > 0);
  assert.ok(asset.bounds.getSize(new Vector3()).distanceTo(asset.dimensions) < 1e-8);
  asset.group.updateWorldMatrix(true, true);
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
  asset.group.traverse(node => list.push([node.name, ...node.position, ...node.quaternion, ...node.scale]));
  return list;
}

test('visual entrypoint aliases preserve the prototype API', () => {
  assert.equal(createCharacterVisual, buildCharacterVisual);
  assert.equal(createTrainVisual, buildTrainVisual);
});

for (const entry of entries) {
  test(`${entry.name}: defaults, all presets and sampled seeds construct finite visuals`, () => {
    for (const options of [{}, ...Object.keys(entry.presets).map(preset => ({ preset })),
      ...Array.from({ length: 16 }, (_, seed) => entry.random(seed))]) {
      const asset = entry.create(options);
      finiteVisual(asset);
      assert.ok(Object.isFrozen(asset.params));
      assert.ok(Object.isFrozen(asset.params.colors));
      asset.dispose();
    }
  });

  test(`${entry.name}: reproducible geometry and structural variety with explicit override precedence`, () => {
    const options = entry.random(42, { colors: { body: '#112233', top: '#445566' } });
    assert.deepEqual(options, entry.random(42, { colors: { body: '#112233', top: '#445566' } }));
    const a = entry.create(options), b = entry.create(JSON.parse(JSON.stringify(options)));
    assert.deepEqual(transforms(a), transforms(b));
    const signatures = new Set();
    for (let seed = 1; seed <= 8; seed++) {
      const c = entry.create(entry.random(seed));
      signatures.add(JSON.stringify(transforms(c)));
      c.dispose();
    }
    assert.ok(signatures.size > 1, 'randomization must change shape, not only paint');
    const overrides = { height: 3, colors: { [entry.name === 'train' ? 'body' : 'top']: '#112233' } };
    const normalized = entry.random(42, overrides);
    assert.equal(normalized.height, 3);
    assert.equal(normalized.colors[entry.name === 'train' ? 'body' : 'top'], '#112233');
    assert.ok(!Object.isFrozen(overrides.colors), 'do not freeze caller-owned input');
    a.dispose(); b.dispose();
  });

  test(`${entry.name}: invalid options fail, finite numbers clamp and normalization is idempotent`, () => {
    for (const options of [null, { height: NaN }, { height: Infinity }, { height: '2' },
      { preset: 'missing' },
      { colors: { [entry.name === 'train' ? 'body' : 'top']: 'not-a-color' } }]) {
      assert.throws(() => entry.create(options));
    }
    for (const seed of [NaN, Infinity, 1.2, '42']) assert.throws(() => entry.random(seed));
    assert.throws(() => entry.random(1, { colors: { [entry.name === 'train' ? 'body' : 'top']: 'not-a-color' } }));
    const normalized = entry.normalize({ height: -100 });
    assert.ok(normalized.height > 0);
    assert.deepEqual(normalized, entry.normalize(normalized));
  });

  test(`${entry.name}: posing/reset preserve parent placement and construction bounds`, () => {
    const asset = entry.create(entry.name === 'train' ? { preset: 'steam' } : {});
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
    for (let i = 0; i < 120; i++) {
      entry.name === 'character' ? asset.setPose('run', i / 60) : asset.setPose('roll', i / 60);
    }
    finiteVisual(asset);
    asset.reset();
    assert.deepEqual([...asset.group.position, ...asset.group.quaternion, ...asset.group.scale], placement);
    assert.ok(bounds.equals(asset.bounds), 'rest bounds remain local, not a world-space live AABB');
    assert.equal(asset.group.parent, parent);
    asset.dispose();
  });

  test(`${entry.name}: resources are bounded, private, disposed exactly once and do not own attachments`, () => {
    const options = entry.name === 'train' ? { preset: 'steam' } : {};
    const a = entry.create(options), b = entry.create(options);
    const owned = resources(a), other = resources(b);
    for (const resource of owned) assert.ok(!other.has(resource));
    const events = new Map();
    for (const resource of [...owned, ...other]) {
      events.set(resource, 0);
      resource.addEventListener('dispose', () => events.set(resource, events.get(resource) + 1));
    }
    const stats = a.getStats();
    const nodes = [];
    a.group.traverse(node => nodes.push(node));
    for (let i = 0; i < 1000; i++) {
      entry.name === 'character' ? a.setPose('run', i / 60) : a.setPose('roll', i / 60);
    }
    assert.deepEqual(a.getStats(), stats);
    const after = [];
    a.group.traverse(node => after.push(node));
    assert.deepEqual(after, nodes);
    const callerObject = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    let callerDisposals = 0;
    callerObject.geometry.addEventListener('dispose', () => callerDisposals++);
    a.group.add(callerObject);
    new Group().add(a.group);
    a.dispose(); a.dispose();
    assert.equal(a.group.parent, null);
    for (const resource of owned) assert.equal(events.get(resource), 1);
    for (const resource of other) assert.equal(events.get(resource), 0);
    assert.equal(callerDisposals, 0);
    assert.throws(() => entry.name === 'character' ? a.setPose('idle', 0) : a.setPose('roll', 0), /disposed/);
    assert.throws(() => a.reset(), /disposed/);
    if (entry.name === 'character') b.setPose('walk', .1); else b.setPose('roll', .1);
    b.dispose();
    for (const resource of other) assert.equal(events.get(resource), 1);
    callerObject.geometry.dispose(); callerObject.material.dispose();
  });

  test(`${entry.name}: rejected poses leave the animation clock usable`, () => {
    const a = entry.create(), b = entry.create();
    if (entry.name === 'character') {
      for (const time of [NaN, Infinity, -Infinity]) assert.throws(() => a.setPose('walk', time));
      assert.throws(() => a.setPose('missing', .5));
      a.setPose('walk', .1); b.setPose('walk', .1);
    } else {
      for (const time of [NaN, Infinity, -Infinity]) assert.throws(() => a.setPose('roll', time));
      assert.throws(() => a.setPose('missing', .5));
      a.setPose('roll', .1); b.setPose('roll', .1);
    }
    assert.deepEqual(transforms(a), transforms(b));
    a.dispose(); b.dispose();
  });
}

test('character: all motions animate the rig and return to the documented rest bounds', () => {
  // The simplified rig keeps exactly three motions: idle, walk and run.
  const asset = createCharacterVisual({ preset: 'runner' });
  const rest = transforms(asset);
  const restingBox = new Box3().setFromObject(asset.group, true);
  assert.ok(restingBox.min.distanceTo(asset.bounds.min) < 1e-7);
  assert.ok(restingBox.max.distanceTo(asset.bounds.max) < 1e-7);
  for (const motion of Object.keys(CHARACTER_MOTIONS)) {
    asset.setPose(motion, 0.17);
    finiteVisual(asset);
    assert.notDeepEqual(transforms(asset), rest);
  }
  asset.setPose('walk', 0.17);
  const walk = transforms(asset);
  asset.setPose('run', 0.17);
  assert.notDeepEqual(transforms(asset), walk);
  asset.reset();
  assert.deepEqual(transforms(asset), rest);
  for (const point of Object.values(asset.attachments)) assert.ok(point.isObject3D);
  asset.dispose();
});

test('character: extreme legal proportions and held gear retain finite geometry and scaled mounts', () => {
  for (const height of [0.8, 3.2]) for (const build of [0.6, 1.7]) {
    const asset = createCharacterVisual({ height, build, headShape: 'box', stride: 1.3,
      loadout: { right: { preset: 'rifle' }, left: { preset: 'kiteShield' } }, holdPose: 'twoHand' });
    for (const motion of Object.keys(CHARACTER_MOTIONS)) { asset.setPose(motion, 0.17); finiteVisual(asset); }
    asset.dispose();
  }
  const small = createCharacterVisual({ height: 1 }), tall = createCharacterVisual({ height: 3 });
  assert.ok(tall.dimensions.y > small.dimensions.y * 2.9);
  const y = asset => asset.attachments.head.getWorldPosition(new Vector3()).y;
  assert.ok(y(tall) > y(small) * 2.9);
  small.dispose(); tall.dispose();
});

test('character: every schema endpoint builds finite geometry in every motion', () => {
  // Equipment multiplies the legal option space well past what the presets visit,
  // and a prop is easiest to break at a range endpoint while a limb is rotated.
  for (const [key, field] of Object.entries(CHARACTER_SCHEMA)) {
    const values = field.choices ? Object.keys(field.choices)
      : typeof field.default === 'boolean' ? [true, false]
        : [field.min, field.max];
    for (const value of values) {
      const asset = createCharacterVisual({ [key]: value });
      for (const motion of Object.keys(CHARACTER_MOTIONS)) { asset.setPose(motion, 0.29); finiteVisual(asset); }
      asset.dispose();
    }
  }
  // Everything on at once: the combination no preset covers.
  const loaded = createCharacterVisual({ height: 3.2, build: 1.7, headShape: 'box', stride: 1.3,
    loadout: { right: { preset: 'machineGun' }, left: { preset: 'kiteShield' } }, holdPose: 'twoHand' });
  for (const motion of Object.keys(CHARACTER_MOTIONS)) { loaded.setPose(motion, 0.4); finiteVisual(loaded); }
  loaded.dispose();
});

test('character: held equipment follows the hand it is mounted to', () => {
  // The point of attaching props to the arm joints rather than the root: a weapon
  // must travel with its hand through the pose, not float beside the body.
  for (const [preset, mount] of [['warrior', 'rightHand'], ['nurse', 'rightHand'], ['modernSoldier', 'rightHand']]) {
    const asset = createCharacterVisual({ preset });
    const weapon = asset.attachments.weapon;
    assert.ok(weapon?.isObject3D, `${preset} exposes its weapon mount`);
    let node = weapon, hand = false;
    while (node) { if (node === asset.attachments[mount]) { hand = true; break; } node = node.parent; }
    assert.ok(hand, `${preset} weapon must hang off ${mount}`);

    asset.setPose('idle', 0);
    asset.group.updateMatrixWorld(true);
    const rest = weapon.getWorldPosition(new Vector3());
    const restHand = asset.attachments[mount].getWorldPosition(new Vector3());
    asset.setPose('run', 0.31);
    asset.group.updateMatrixWorld(true);
    const posed = weapon.getWorldPosition(new Vector3());
    const posedHand = asset.attachments[mount].getWorldPosition(new Vector3());
    assert.ok(posed.distanceTo(rest) > 1e-6, `${preset} weapon must move with the pose`);
    // The weapon keeps its offset from the hand rather than drifting independently.
    assert.ok(Math.abs(posed.distanceTo(posedHand) - rest.distanceTo(restHand)) < 1e-6,
      `${preset} weapon must stay fixed relative to the hand`);
    asset.dispose();
  }
});

test('character: two-handed support needs a free offhand and a prop that offers a grip', () => {
  // holdPose twoHand is a request, not a guarantee: a pistol has no support grip and
  // an occupied left hand cannot reach one, so those cases must not fight over the arm.
  const supported = createCharacterVisual({ loadout: { right: { preset: 'rifle' } } });
  const occupied = createCharacterVisual({ loadout: { right: { preset: 'rifle' }, left: { preset: 'kiteShield' } } });
  const pistol = createCharacterVisual({ loadout: { right: { preset: 'pistol' } }, holdPose: 'twoHand' });
  assert.equal(supported.gripStatus.right.supportUsed, true);
  assert.ok(supported.gripStatus.right.supportError < 1e-6, 'support hand reaches its actual grip');
  assert.equal(occupied.gripStatus.right.supportUsed, false);
  assert.equal(pistol.gripStatus.right.supportUsed, false);
  for (const asset of [supported, occupied, pistol]) { finiteVisual(asset); asset.dispose(); }
});

test('character: every preset keeps its profession weapon through randomization', () => {
  // Rerolling a nurse into a soldier would return a different character than the
  // caller asked for, so the loadout slots are pinned to each preset's legacy
  // weapon/offhand keys while the randomized silhouette fields may vary.
  for (const preset of Object.keys(CHARACTER_PRESETS)) {
    const base = normalizeCharacterOptions({ preset });
    const profession = base.loadout.right !== null || base.loadout.left !== null;
    for (const seed of [1, 5, 9, 17]) {
      const sampled = randomCharacterOptions(seed, { preset });
      assert.equal(sampled.preset, preset);
      if (profession) {
        assert.equal(sampled.loadout.right?.preset, base.loadout.right?.preset,
          `${preset} seed ${seed} weapon`);
        assert.equal(sampled.loadout.left?.preset, base.loadout.left?.preset,
          `${preset} seed ${seed} offhand`);
      }
      const asset = createCharacterVisual(sampled);
      finiteVisual(asset);
      asset.dispose();
    }
  }
  // Everyday presets carry no pinned profession, so their silhouette may vary.
  const silhouettes = new Set();
  for (const seed of [1, 3, 5, 7, 9, 11]) {
    const sampled = randomCharacterOptions(seed, { preset: 'runner' });
    silhouettes.add(`${sampled.height.toFixed(2)}/${sampled.build.toFixed(2)}/${sampled.headShape}`);
  }
  assert.ok(silhouettes.size > 1, 'an everyday preset should still explore silhouettes');
});

test('train: cars stay separate, in order, and the consist keeps its coupling mounts', () => {
  // No per-car collision hints in the simplified consist; the gaps must be
  // verifiable from the car meshes themselves.
  for (const preset of Object.keys(TRAIN_PRESETS)) {
    const asset = createTrainVisual({ preset, cars: 3 });
    assert.equal(asset.cars.length, asset.params.cars);
    asset.group.updateMatrixWorld(true);
    asset.cars.forEach((car, i) => {
      assert.equal(car.index, i);
      const measured = new Box3().setFromObject(car.mesh, true);
      assert.ok(!measured.isEmpty(), `${preset} car ${i}`);
      assert.ok(Number.isFinite(car.centerZ), `${preset} car ${i} center`);
    });
    for (let i = 1; i < asset.cars.length; i++) {
      const left = new Box3().setFromObject(asset.cars[i - 1].mesh, true);
      const right = new Box3().setFromObject(asset.cars[i].mesh, true);
      assert.ok(left.max.z < right.min.z, `${preset} cars ${i - 1}/${i} must not overlap`);
    }
    assert.ok(asset.attachments.front.position.z < asset.attachments.rear.position.z);
    asset.dispose();
  }
});

test('train: rolling rotates every wheel against travel and reset clears the motion', () => {
  // Rolling without slipping: each pivot spins by seconds * 4 / radius, so the
  // angle-radius product is the same for bogie, drive and trailing wheels.
  const a = createTrainVisual({ preset: 'steam', cars: 1 });
  assert.ok(a.wheels.length > 2, 'a steam locomotive has drive and trailing wheels');
  a.setPose('roll', 0.5);
  for (const wheel of a.wheels) {
    assert.ok(Math.abs(wheel.pivot.rotation.x * wheel.radius + 2) < 1e-6,
      'all wheels roll the same ground distance');
  }
  const angle = a.wheels[0].pivot.rotation.x;
  a.setPose('roll', -0.5);
  assert.ok(Math.abs(a.wheels[0].pivot.rotation.x + angle) < 1e-6);
  a.reset();
  assert.ok(a.wheels.every(wheel => wheel.pivot.rotation.x === 0));
  a.dispose();

  // The heavy steam configuration is the one that used to need update-state
  // effects; posing it must stay finite.
  const express = createTrainVisual({ preset: 'express', cars: 3 });
  for (let i = 0; i < 60; i++) express.setPose('roll', i / 30);
  finiteVisual(express);
  express.dispose();
});

test('train: extreme consist configurations have finite geometry', () => {
  for (const options of [
    { preset: 'bullet', length: 5, nose: 4, width: 3.6, height: 2.3, cars: 6 },
    { preset: 'steam', length: 5, width: 3.6, height: 2.3, driveWheels: 5, chimney: 1.2, wheelScale: 1.25 },
    { preset: 'tank', length: 15, width: 1.5, height: 5, cars: 6, gap: 1.6 },
  ]) {
    const asset = createTrainVisual(options);
    asset.setPose('roll', 1.2); finiteVisual(asset); asset.dispose();
  }
});