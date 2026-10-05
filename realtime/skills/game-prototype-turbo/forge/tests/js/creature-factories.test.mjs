// Behavior tests for the simplified animal factories (quadruped, bird, fish).
// They share the scene-visual profile with the world assets and sample named
// poses at absolute time. The simple set keeps the shared combat actions
// (pounce/charge/death) but drops the detailed anatomy options these tests
// used to exercise (knee styles, feet shapes, pectoral counts, shapeSeed).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import {
  buildQuadrupedVisual, createQuadrupedVisual, normalizeQuadrupedOptions,
  randomQuadrupedOptions, QUADRUPED_PRESETS, QUADRUPED_SCHEMA,
} from '../../../assets/world/object/factory/QuadrupedVisualFactory.js';
import {
  buildBirdVisual, createBirdVisual, normalizeBirdOptions,
  randomBirdOptions, BIRD_PRESETS, BIRD_SCHEMA,
} from '../../../assets/world/object/factory/BirdVisualFactory.js';
import {
  buildFishVisual, createFishVisual, normalizeFishOptions,
  randomFishOptions, FISH_PRESETS, FISH_SCHEMA,
} from '../../../assets/world/object/factory/FishVisualFactory.js';

// `colorKey` is a palette key the factory actually has, so invalid-color cases
// exercise validation rather than the ignored-unknown-key path.
const entries = [
  { name: 'quadruped', create: createQuadrupedVisual, build: buildQuadrupedVisual,
    normalize: normalizeQuadrupedOptions, random: randomQuadrupedOptions,
    presets: QUADRUPED_PRESETS, schema: QUADRUPED_SCHEMA,
    colorKey: 'body', numberKey: 'bodyLength' },
  { name: 'bird', create: createBirdVisual, build: buildBirdVisual,
    normalize: normalizeBirdOptions, random: randomBirdOptions,
    presets: BIRD_PRESETS, schema: BIRD_SCHEMA,
    colorKey: 'wing', numberKey: 'bodyLength' },
  { name: 'fish', create: createFishVisual, build: buildFishVisual,
    normalize: normalizeFishOptions, random: randomFishOptions,
    presets: FISH_PRESETS, schema: FISH_SCHEMA,
    colorKey: 'fin', numberKey: 'bodyLength' },
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

// `+ 0` folds -0 into 0, which is geometrically identical but not deepStrictEqual.
const zeroless = value => (typeof value === 'number' ? Number(value.toFixed(12)) + 0 : value);

function transforms(asset) {
  const list = [];
  asset.group.traverse(node => list.push(
    [node.name, ...node.position, ...node.quaternion, ...node.scale].map(zeroless)));
  return list;
}

test('creature entrypoint aliases preserve the prototype API', () => {
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
      // The documented origin contract: finishVisual grounds the root so a
      // caller can place by ground position without measuring first.
      assert.ok(Math.abs(asset.bounds.min.y) < 1e-6,
        `${entry.name} ${JSON.stringify(options.preset ?? 'default')} min.y ${asset.bounds.min.y}`);
      const stats = asset.getStats();
      assert.ok(stats.meshes > 0 && stats.triangles > 0);
      assert.ok(stats.geometries > 0 && stats.materials > 0);
      asset.dispose();
    }
  });

  test(`${entry.name}: every enum choice and range endpoint builds finite geometry that still animates`, () => {
    // Extreme-but-legal inputs are where coupled dimensions collapse into
    // degenerate geometry, so cover each schema field's own limits rather than
    // trusting the presets to have visited them. Posing is included because a
    // zero-size part often survives construction and fails only once rotated.
    for (const [key, field] of Object.entries(entry.schema)) {
      const values = field.choices ? Object.keys(field.choices)
        : typeof field.default === 'boolean' ? [true, false]
          : [field.min, field.max];
      for (const value of values) {
        const asset = entry.create({ [key]: value });
        finiteVisual(asset);
        assert.ok(Math.abs(asset.bounds.min.y) < 1e-6, `${entry.name} ${key}=${value}`);
        asset.setPose('move', 0.37);
        finiteVisual(asset);
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

  test(`${entry.name}: randomization keeps the body type it must not reshuffle`, () => {
    // Randomizing `type` would build a different animal than the preset the caller
    // asked for -- a bird preset must not come back as a different body plan.
    for (const preset of Object.keys(entry.presets)) {
      const base = entry.normalize({ preset });
      for (const seed of [1, 5, 9]) {
        assert.equal(entry.random(seed, { preset }).type, base.type, `${preset} seed ${seed}`);
      }
    }
  });

  test(`${entry.name}: invalid options fail, finite numbers clamp and normalization is idempotent`, () => {
    // Unknown keys are ignored and `colors: null`/`colors: []` are tolerated
    // (spread), as is a null color for one key (readPalette falls back to the
    // default via `??`), so the strict list only covers genuinely invalid values.
    for (const options of [null, { preset: 'missing' }, { [entry.numberKey]: NaN },
      { [entry.numberKey]: Infinity }, { [entry.numberKey]: '2' },
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
  });

  test(`${entry.name}: explicit options beat presets and caller input is never mutated`, () => {
    const options = { preset: Object.keys(entry.presets)[1], [entry.numberKey]: 1.4,
      colors: { [entry.colorKey]: '#334455' } };
    const snapshot = JSON.parse(JSON.stringify(options));
    const resolved = entry.normalize(options);
    assert.deepEqual(options, snapshot, 'normalization must not mutate caller options');
    assert.equal(resolved[entry.numberKey], 1.4);
    assert.equal(resolved.colors[entry.colorKey], '#334455');
    assert.ok(!Object.isFrozen(options.colors));
  });

  test(`${entry.name}: setPose animates parts, preserves placement and is deterministic in absolute time`, () => {
    const asset = entry.create({});
    const parent = new Group();
    parent.position.set(5, -2, 9);
    parent.add(asset.group);
    asset.group.position.set(-3, 1, 4);
    asset.group.rotation.y = 0.6;
    asset.group.scale.setScalar(2.2);
    const placement = [...asset.group.position, ...asset.group.quaternion, ...asset.group.scale];
    const bounds = asset.bounds.clone();
    const rest = transforms(asset);

    asset.setPose('move', 0.42);
    finiteVisual(asset);
    assert.notDeepEqual(transforms(asset), rest, 'setPose must move the rig');
    const posed = transforms(asset);
    asset.setPose('move', 3.9);
    asset.setPose('move', 0.42);
    assert.deepEqual(transforms(asset), posed, 'same absolute time gives the same pose');
    assert.deepEqual([...asset.group.position, ...asset.group.quaternion, ...asset.group.scale],
      placement, 'setPose must not move the root');
    assert.ok(bounds.equals(asset.bounds), 'rest bounds stay local and construction-time');
    assert.equal(asset.group.parent, parent);

    assert.deepEqual(transforms(asset.reset()), rest, 'reset restores the built rest pose');
    asset.dispose();
  });

  test(`${entry.name}: rejected poses change nothing and posing after disposal throws`, () => {
    const asset = entry.create({});
    asset.setPose('move', 0.3);
    const posed = transforms(asset);
    for (const seconds of [NaN, Infinity, -Infinity]) {
      assert.throws(() => asset.setPose('move', seconds), /finite/);
      assert.deepEqual(transforms(asset), posed, `rejected ${seconds} changed the pose`);
    }
    assert.throws(() => asset.setPose('not-a-motion', 1), /unknown creature motion/);
    asset.dispose();
    assert.throws(() => asset.setPose('move', 1), /disposed/);
    assert.throws(() => asset.reset(), /disposed/);
  });

  test(`${entry.name}: resources are bounded, private, disposed exactly once and do not own attachments`, () => {
    const a = entry.create({}), b = entry.create({});
    const owned = resources(a), other = resources(b);
    for (const resource of owned) assert.ok(!other.has(resource), 'instances must not share resources');
    const events = new Map();
    for (const resource of [...owned, ...other]) {
      events.set(resource, 0);
      resource.addEventListener('dispose', () => events.set(resource, events.get(resource) + 1));
    }
    const stats = a.getStats();
    const nodes = [];
    a.group.traverse(node => nodes.push(node));
    for (let i = 0; i < 600; i++) a.setPose('move', i / 60);
    assert.deepEqual(a.getStats(), stats, 'posing must not allocate geometry');
    const after = [];
    a.group.traverse(node => after.push(node));
    assert.deepEqual(after, nodes, 'posing must not add or remove nodes');

    const callerObject = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    let callerDisposals = 0;
    callerObject.geometry.addEventListener('dispose', () => callerDisposals++);
    const mount = Object.values(a.attachments).find(object => object?.isObject3D);
    mount.add(callerObject);
    new Group().add(a.group);
    a.dispose(); a.dispose();
    assert.equal(a.group.parent, null, 'dispose detaches the root');
    for (const resource of owned) assert.equal(events.get(resource), 1);
    for (const resource of other) assert.equal(events.get(resource), 0);
    assert.equal(callerDisposals, 0, 'caller-mounted items stay caller-owned');
    b.setPose('move', 0.2);
    b.dispose();
    for (const resource of other) assert.equal(events.get(resource), 1);
    callerObject.geometry.dispose(); callerObject.material.dispose();
  });

  test(`${entry.name}: attachments are named mounts under the root`, () => {
    const asset = entry.create({});
    for (const [name, object] of Object.entries(asset.attachments)) {
      assert.ok(object?.isObject3D, `${name} must be an Object3D`);
      let node = object, rooted = false;
      while (node) { if (node === asset.group) { rooted = true; break; } node = node.parent; }
      assert.ok(rooted, `${name} must sit under the root`);
    }
    asset.dispose();
  });

  test(`${entry.name}: the shared combat motions install and report state`, () => {
    // The simple factories keep the full named-action set (pounce/charge/death)
    // from the shared CreatureActions module; each anatomy must survive them.
    const asset = entry.create({});
    for (const action of ['still', 'idle', 'move', 'pounce', 'charge', 'death']) {
      asset.setPose(action, 0.45);
      finiteVisual(asset);
      const state = asset.actionState;
      assert.equal(state.id, action);
      assert.ok(Number.isFinite(state.progress));
      assert.ok(Number.isFinite(state.heading));
    }
    const frame = asset.getAttackFrame();
    for (const n of [...frame.origin, ...frame.direction]) assert.ok(Number.isFinite(n));
    assert.ok(Math.abs(frame.direction.length() - 1) < 1e-8, 'attack direction is normalized');
    asset.dispose();
  });
}

test('quadruped: the simplified gait swings the rear pair against the front pair', () => {
  // One rigid box per corner; `move` pivots hips in opposing pairs with a
  // slightly larger front amplitude, and only the `small` body type changes
  // cadence rather than the phase pattern.
  const asset = createQuadrupedVisual({ type: 'canid', stride: 1 });
  asset.setPose('move', 0.3);
  assert.equal(asset.legs.length, 4);
  const fronts = asset.legs.filter(leg => leg.front), rears = asset.legs.filter(leg => !leg.front);
  assert.equal(fronts.length, 2); assert.equal(rears.length, 2);
  const [front] = fronts.map(leg => leg.hip.rotation.x), [rear] = rears.map(leg => leg.hip.rotation.x);
  assert.ok(Math.abs(front) > 0.1, 'stride 1 must swing the legs');
  assert.ok(Math.abs(front + rear * 1.2) < 1e-12, 'rear pair mirrors the front pair at 0.6/0.72');
  assert.ok(Math.abs(fronts[0].hip.rotation.x - fronts[1].hip.rotation.x) < 1e-12,
    'the two front legs share a phase');
  assert.ok(Math.abs(rears[0].hip.rotation.x - rears[1].hip.rotation.x) < 1e-12,
    'the two rear legs share a phase');
  asset.dispose();

  // `small` animals only scale cadence: the same absolute phase is reached at
  // a time scaled by 4.2/2.6.
  const small = createQuadrupedVisual({ type: 'small', stride: 1 });
  const canid = createQuadrupedVisual({ type: 'canid', stride: 1 });
  small.setPose('move', 1.05);
  canid.setPose('move', 1.05 * (4.2 / 2.6));
  assert.deepEqual(small.legs.map(leg => leg.hip.rotation.x.toFixed(6)),
    canid.legs.map(leg => leg.hip.rotation.x.toFixed(6)),
    'small cadence must be the only gait difference');
  small.dispose(); canid.dispose();
});

test('bird: glide keeps the flap residual small and tucks the legs', () => {
  // The simplified wing is one panel per side; the flap amplitude shrinks with
  // glide but never vanishes (0.16 residual at glide 1), and a soaring bird
  // folds its legs to a fixed tuck instead of paddling the air.
  const soaring = createBirdVisual({ glide: 1, flapSpeed: 4 });
  assert.equal(soaring.wings.length, 2);
  for (const seconds of [0.2, 1.4, 7.7]) {
    soaring.setPose('move', seconds);
    soaring.wings.forEach(({ wing, baseX }) => {
      const delta = wing.rotation.x - baseX;
      assert.ok(Math.abs(delta) <= 0.16 + 1e-12, 'glide 1 flaps only the residual amplitude');
    });
    soaring.legs.forEach(leg => assert.ok(Math.abs(leg.rotation.x - 0.6) < 1e-12,
      'legs tuck to a fixed fold while soaring'));
  }
  soaring.dispose();

  // Mirrored wings flap in mirrored phases: the rotation offset is antisymmetric.
  const flapping = createBirdVisual({ glide: 0, flapSpeed: 4 });
  flapping.setPose('move', 0.31);
  const [left, right] = flapping.wings;
  const dl = left.wing.rotation.x - left.baseX, dr = right.wing.rotation.x - right.baseX;
  assert.ok(Math.abs(dl) > 0.5, 'glide 0 must actually flap');
  assert.ok(Math.abs(dl + dr) < 1e-12, 'flap must be mirrored across the body');
  assert.ok(left.wing.position.x < 0 && right.wing.position.x > 0, 'negative-X wing comes first');
  assert.equal(flapping.legs.length, 2);
  flapping.dispose();

  // `legLength` zero replaces the removed feet option: nothing dangles under a
  // swooping bird built without legs.
  assert.equal(createBirdVisual({ legLength: 0 }).legs.length, 0);
  assert.equal(createBirdVisual({ legLength: 0.5 }).legs.length, 2);
});

test('fish: fins are a fixed pair, the dorsal is one wedge and jellyfish keep tentacles', () => {
  const ray = createFishVisual({ preset: 'ray' });
  assert.equal(ray.fins.length, 2, 'every fish keeps the two pectoral mounts');
  assert.equal(ray.dorsal.length, 0, 'dorsal none builds no sail');
  assert.equal(ray.tentacles.length, 0, 'tentacles are jellyfish-only');
  ray.dispose();

  const bony = createFishVisual({ type: 'bony', dorsal: 'sail' });
  assert.equal(bony.fins.length, 2);
  assert.equal(bony.dorsal.length, 1, 'the dorsal option builds one wedge');
  bony.dispose();

  const jelly = createFishVisual({ preset: 'jellyfish' });
  assert.equal(jelly.tentacles.length, jelly.params.tentacles);
  assert.equal(jelly.params.tailShape, 'none');
  assert.equal(jelly.tail.children.length, 0, 'tailShape none builds no tail but keeps the mount');
  jelly.dispose();

  // The fins pivot around their baseZ and swing while swimming.
  const swimming = createFishVisual({});
  const rest = swimming.fins.map(({ root }) => root.rotation.z);
  swimming.setPose('move', 0.5);
  assert.ok(swimming.fins.some(({ root }, i) => Math.abs(root.rotation.z - rest[i]) > 1e-3),
    'swimming must swing the pectoral fins');
  assert.ok(Math.abs(swimming.tail.rotation.y) > 1e-3, 'swimming must sweep the tail');
  swimming.reset();
  swimming.fins.forEach(({ root }, i) => {
    assert.ok(Math.abs(root.rotation.z - rest[i]) < 1e-12, 'reset restores the built fin fold');
  });
  assert.ok(Math.abs(swimming.tail.rotation.y) < 1e-12);
  swimming.dispose();
});

test('local bounds stay local: a rotated creature root needs a transformed copy', () => {
  const asset = createQuadrupedVisual({ preset: 'horse' });
  asset.group.rotation.y = Math.PI / 2;
  asset.group.position.set(10, 0, -4);
  asset.group.updateWorldMatrix(true, true);
  const world = new Box3().setFromObject(asset.group, true);
  assert.ok(!world.equals(asset.bounds), 'local bounds do not follow the root');
  const transformed = asset.bounds.clone().applyMatrix4(asset.group.matrixWorld);
  assert.ok(transformed.containsBox(world) || transformed.intersectsBox(world),
    'a transformed copy covers the world extent');
  asset.dispose();
});