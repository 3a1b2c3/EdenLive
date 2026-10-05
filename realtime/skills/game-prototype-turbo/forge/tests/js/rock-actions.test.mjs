import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Group, Vector3 } from 'three';
import {
  buildRockVisual, createRockVisual, ROCK_PRESETS, ROCK_TYPES, ROCK_MOTIONS, ROCK_SCHEMA,
  ROCK_PRESET_LOCKED_FIELDS, normalizeRockOptions, randomRockOptions,
} from '../../../assets/world/object/factory/RockVisualFactory.js';
const close = (a, b, epsilon = 1e-8, message = `${a} != ${b}`) => assert.ok(Math.abs(a - b) < epsilon, message);
const snap = root => {
  root.updateWorldMatrix(true, true);
  const values = []; root.traverse(node => values.push(...node.matrixWorld.elements, Number(node.visible)));
  return values;
};
const same = (a, b, message = 'pose mismatch') => {
  assert.equal(a.length, b.length, message); a.forEach((n, i) => close(n, b[i], 1e-8, message));
};
const span = spec => spec.duration ?? spec.period ?? 1;
const boxOf = node => { node.updateWorldMatrix(true, true); return new Box3().setFromObject(node, true); };

// These tests verify externally useful pose, timing and frame contracts for the
// simplified rock factory: the same ten presets, attachments and six actions as
// the previous detailed module, minus facets, sockets and colour jitter.
// Grounded silhouettes, deterministic seeds, once/loop semantics and disposal
// must survive the simplification unchanged.
test('createRockVisual is the scene-visual alias of buildRockVisual', () => {
  assert.equal(createRockVisual, buildRockVisual);
  const a = createRockVisual();
  assert.equal(a.group, a.mesh);
  a.dispose();
});

test('ten rock presets: finite grounded actions, absolute sampling, static states, loops and held endpoints', () => {
  let count = 0;
  for (const preset of Object.keys(ROCK_PRESETS)) {
    const a = buildRockVisual({ preset }), neutral = snap(a.mesh);
    assert.equal(a.params.rockShape, ROCK_PRESETS[preset].rockShape);
    assert.equal(a.params.kind, ROCK_PRESETS[preset].kind);
    assert.equal(a.mesh.name, `simple-rock-${preset}`);
    close(a.bounds.min.y, 0, 1e-6);
    assert.ok(a.bounds.max.y >= a.bounds.min.y);
    for (const name of ['base', 'center', 'surface', 'top', 'hazard', 'impact', 'focus', 'activation'])
      assert.ok(Object.hasOwn(a.attachments, name), `${preset}/${name}`);
    for (const [id, spec] of Object.entries(a.actions)) {
      assert.ok(['static', 'once', 'loop'].includes(spec.mode));
      assert.equal(spec.mode === 'static', id === 'still');
      const duration = span(spec);
      for (const u of [0, .13, .5, .9, 1, 2.4, .37]) {
        a.setPose(id, duration * u);
        assert.ok(snap(a.mesh).every(Number.isFinite), `${preset}/${id}/${u}`);
        assert.ok(a.getPoseBounds().min.y >= -1e-6, `${preset}/${id}/${u} is underground`);
        assert.ok(a.actionState.progress >= 0 && a.actionState.progress <= 1);
        assert.equal(a.actionState.id, id);
      }
      const pose = snap(a.mesh), state = a.actionState;
      a.setPose(id, duration * 1.9); a.setPose('still', 0); a.setPose(id, duration * .37);
      assert.deepEqual(a.actionState, state);
      same(snap(a.mesh), pose, `${preset}/${id}: order-independent sampling`);
      if (spec.mode === 'once') {
        a.setPose(id, duration); const end = snap(a.mesh);
        assert.equal(a.actionState.finished, true);
        a.setPose(id, duration * 20); same(snap(a.mesh), end, `${preset}/${id}: no motion after completion`);
        assert.equal(a.actionState.active, false);
      } else if (spec.loop) {
        a.setPose(id, duration * 8.37); same(snap(a.mesh), pose, `${preset}/${id}: loop wraps exactly`);
        assert.equal(a.actionState.finished, false);
      } else {
        a.setPose(id, 0); const start = snap(a.mesh);
        a.setPose(id, 9876); same(snap(a.mesh), start);
        assert.equal(a.actionState.finished, false);
        assert.equal(a.actionState.active, false);
        assert.equal(a.actionState.progress, 0);
      }
      a.reset(); same(snap(a.mesh), neutral, `${preset}/${id}: reset`);
      assert.equal(a.actionState.id, 'still');
    }
    a.dispose(); count++;
  }
  assert.equal(count, 10);
});

test('presets own shape and kind while sizes, colours and action timings remain editable', () => {
  assert.equal(Object.keys(ROCK_PRESETS).length, 10);
  assert.equal(Object.keys(ROCK_TYPES).length, 10);
  assert.deepEqual(Object.keys(ROCK_MOTIONS), ['still', 'rotate', 'impact', 'settle', 'scatter', 'pulse']);
  assert.equal(ROCK_SCHEMA.rockShape.derived, true);
  assert.equal(ROCK_SCHEMA.kind.derived, true);
  for (const preset of Object.keys(ROCK_PRESETS)) {
    assert.ok(Object.hasOwn(ROCK_TYPES, ROCK_PRESETS[preset].kind));
    assert.ok(ROCK_TYPES[ROCK_PRESETS[preset].kind].label);
    const clean = normalizeRockOptions({ preset });
    const conflicting = normalizeRockOptions({ preset, rockShape: 'crystal', kind: 'ridge', referenceHeight: 1.2,
      width: 5.5, meteoriteTail: false, colors: { body: '#123456' } });
    for (const key of ROCK_PRESET_LOCKED_FIELDS) assert.deepEqual(conflicting[key], clean[key], `${preset}/${key} follows preset`);
    assert.equal(conflicting.referenceHeight, 1.2);
    assert.equal(conflicting.width, 5.5);
    assert.equal(conflicting.colors.body, '#123456');
    assert.equal(conflicting.meteoriteTail, 0);
    assert.deepEqual(normalizeRockOptions(JSON.parse(JSON.stringify(conflicting))), conflicting);
    const random = randomRockOptions(7, { preset });
    assert.deepEqual(random, randomRockOptions(7, { preset }));
    assert.equal(random.preset, preset);
    for (const key of ['rockShape', 'kind']) assert.equal(random[key], clean[key], 'random keeps locked fields');
    const a = buildRockVisual(random), b = buildRockVisual(JSON.parse(JSON.stringify(random)));
    assert.deepEqual(a.params, b.params);
    same(snap(a.mesh), snap(b.mesh));
    for (const [id, spec] of Object.entries(a.actions)) {
      a.setPose(id, span(spec) * .37); b.setPose(id, span(spec) * .37);
      same(snap(a.mesh), snap(b.mesh), `${preset}/${id}: deterministic from options`);
    }
    a.dispose(); b.dispose();
  }
  assert.equal(normalizeRockOptions({ meteoriteTail: true }).meteoriteTail, .7);
  // Parameters the simplified factory no longer models are dropped, not carried.
  assert.equal(Object.hasOwn(normalizeRockOptions({ groundContact: 'flat' }), 'groundContact'), false);
  assert.equal(Object.hasOwn(normalizeRockOptions({ facets: 20, shapeSeed: 3 }), 'facets'), false);
  const a = buildRockVisual({ rotatePeriod: 6, impactDuration: 1.5, settleDuration: 2.4, pulsePeriod: 2.1, actionSpeed: 3 });
  close(a.actions.rotate.period, 2); close(a.actions.impact.duration, .5);
  close(a.actions.settle.duration, .8); close(a.actions.scatter.duration, .8); close(a.actions.pulse.period, .7);
  assert.ok(Object.isFrozen(a.actions)); assert.equal(a.motions, ROCK_MOTIONS); a.dispose();
});

test('impact falls from the sky and lands grounded, settle respects clearance, scatter spreads fragments, pulse pulses', () => {
  const falling = buildRockVisual({ preset: 'meteorite', impactHeight: 4.5 });
  const neutralMotion = falling.rig.motion.position.y;
  const neutralTop = falling.getAttachmentWorldPosition('top').y;
  falling.setPose('impact', 0);
  close(falling.rig.motion.position.y - neutralMotion, 4.5);
  close(falling.rig.motion.rotation.x, .16);
  close(falling.getAttachmentWorldPosition('top').y - neutralTop, 4.5, 0.03, 'top lifts with the fall (rotated by the tilt)');
  assert.equal(falling.actionState.phase, 'falling');
  assert.equal(falling.actionState.active, true);
  assert.ok(falling.getPoseBounds().min.y >= -1e-6);
  falling.setPose('impact', falling.actions.impact.duration / 2);
  assert.ok(falling.getAttachmentWorldPosition('top').y > neutralTop, 'mid-flight');
  falling.setPose('impact', falling.actions.impact.duration);
  close(falling.rig.motion.position.y, neutralMotion);
  close(falling.getAttachmentWorldPosition('top').y, neutralTop, 1e-6);
  assert.equal(falling.actionState.phase, 'landed');
  assert.equal(falling.actionState.finished, true);
  assert.equal(falling.actionState.active, false);
  assert.ok(falling.getPoseBounds().min.y >= -1e-6);
  const landed = snap(falling.mesh);
  falling.setPose('impact', falling.actions.impact.duration * 20); same(snap(falling.mesh), landed);
  falling.dispose();

  const settling = buildRockVisual({ preset: 'boulder', settleAmount: .8, settleDuration: 1 });
  const settlingNeutral = settling.rig.motion.position.y;
  const clearance = Math.min(.8, settling.rig.clearance * .9);
  settling.setPose('settle', settling.actions.settle.duration);
  close(settling.rig.motion.position.y - settlingNeutral, -clearance);
  assert.equal(settling.actionState.phase, 'settled');
  assert.equal(settling.actionState.value, 1);
  assert.ok(settling.getPoseBounds().min.y >= -1e-6);
  const settled = snap(settling.mesh);
  settling.setPose('settle', settling.actions.settle.duration * 40); same(snap(settling.mesh), settled);
  settling.dispose();
  const small = buildRockVisual({ preset: 'boulder', settleAmount: .01 });
  const smallNeutral = small.rig.motion.position.y;
  small.setPose('settle', small.actions.settle.duration);
  close(small.rig.motion.position.y - smallNeutral, -.01); small.dispose();
  const zero = buildRockVisual({ preset: 'boulder', settleAmount: 0 }), zeroY = zero.rig.motion.position.y;
  zero.setPose('settle', zero.actions.settle.duration);
  close(zero.rig.motion.position.y, zeroY, 1e-9, 'zero amplitude does not move the rock');
  assert.ok(zero.getPoseBounds().min.y >= -1e-6); zero.dispose();

  // Meteorite tail fragments fan out along their forward axis.
  const scattered = buildRockVisual({ preset: 'meteorite', scatterAmount: 2 });
  assert.equal(scattered.rig.fragments.length, 2);
  const before = scattered.rig.fragments.map(f => f.position.clone());
  const bodyPose = snap(scattered.rig.body);
  const initialDepth = scattered.getPoseBounds().getSize(new Vector3()).z;
  scattered.setPose('scatter', scattered.actions.scatter.duration);
  same(snap(scattered.rig.body), bodyPose, 'scatter moves fragments only');
  const distances = scattered.rig.fragments.map((f, i) => f.position.distanceTo(before[i]));
  assert.ok(distances.every(d => d > .99), 'full scatter travels outward');
  assert.ok(scattered.rig.fragments.every(f => f.position.z > 0), 'tail fragments fan to the front');
  assert.ok(scattered.getPoseBounds().getSize(new Vector3()).z > initialDepth + 1);
  assert.equal(scattered.actionState.phase, 'scattered');
  // Crater rim blocks spread radially instead.
  const rim = buildRockVisual({ preset: 'impactCrater', scatterAmount: .9 });
  const rimBefore = rim.rig.fragments.map(f => new Vector3(f.position.x, 0, f.position.z).length());
  rim.setPose('scatter', rim.actions.scatter.duration);
  const rimAfter = rim.rig.fragments.map(f => new Vector3(f.position.x, 0, f.position.z).length());
  assert.ok(rimAfter.every((d, i) => d > rimBefore[i] + .2), 'rim fragments push outward');
  assert.ok(rim.getPoseBounds().min.y >= -1e-6); rim.dispose(); scattered.dispose();

  const pulsing = buildRockVisual({ preset: 'crystalRock' });
  const core = pulsing.rig.coreMesh, crystal = pulsing.rig.crystals[0];
  pulsing.setPose('pulse', 0);
  close(core.scale.x, 1.08, 1e-6);
  const dimCrystal = crystal.scale.x;
  pulsing.setPose('pulse', pulsing.actions.pulse.period / 4);
  close(core.scale.x, 1.16, 1e-6);
  assert.ok(crystal.scale.x > dimCrystal);
  pulsing.setPose('pulse', pulsing.actions.pulse.period / 2);
  close(core.scale.x, 1.08, 1e-6);
  assert.equal(pulsing.actionState.phase, 'pulsing');
  assert.equal(pulsing.actionState.active, true);
  pulsing.dispose();
  const plain = buildRockVisual({ preset: 'boulder' }), plainNeutral = snap(plain.mesh);
  plain.setPose('pulse', plain.actions.pulse.period * .37);
  same(snap(plain.mesh), plainNeutral, 'plain rock has no pulse targets');
  plain.dispose();
});

test('ridges, craters, stacks, crystals, tails and burial respond to their parameters', () => {
  const ridgeLong = buildRockVisual({ preset: 'ridge', width: .25, ridgeLength: 16, ridgeHeight: 5 });
  const ridgeShort = buildRockVisual({ preset: 'ridge', width: .25, ridgeLength: .8, ridgeHeight: .2 });
  assert.ok(ridgeLong.rig.ridge && ridgeShort.rig.ridge);
  const longSize = ridgeLong.getPoseBounds().getSize(new Vector3());
  const shortSize = ridgeShort.getPoseBounds().getSize(new Vector3());
  assert.ok(longSize.x > shortSize.x + 8, 'ridge length');
  assert.ok(longSize.y > shortSize.y + 2, 'ridge peak height');
  ridgeLong.dispose(); ridgeShort.dispose();

  const craterWide = buildRockVisual({ preset: 'impactCrater', craterRadius: 1.2, craterRim: 2.5, craterDepth: 2.8 });
  const craterSmall = buildRockVisual({ preset: 'impactCrater', craterRadius: .25, craterRim: .05, craterDepth: 0 });
  close(craterWide.mesh.getObjectByName('crater-floor').scale.x, 1.2 * 1.08, 1e-6);
  close(craterSmall.mesh.getObjectByName('crater-floor').scale.x, .25 * 1.08, 1e-6);
  close(craterWide.mesh.getObjectByName('impact-core').scale.y, Math.max(.08, 2.8 * .28), 1e-6);
  close(craterSmall.mesh.getObjectByName('impact-core').scale.y, .08, 1e-6);
  assert.ok(boxOf(craterWide.rig.craterRim).getSize(new Vector3()).x
    > boxOf(craterSmall.rig.craterRim).getSize(new Vector3()).x * 1.2, 'crater rim spread');
  assert.ok(boxOf(craterWide.rig.craterRim).max.y > boxOf(craterSmall.rig.craterRim).max.y * 5, 'crater rim height');
  close(craterWide.getAttachmentFrame('impact').origin.y - craterWide.getAttachmentFrame('base').origin.y,
    Math.max(.1, 2.8 * .38), 1e-6);
  close(craterSmall.getAttachmentFrame('impact').origin.y - craterSmall.getAttachmentFrame('base').origin.y, .1, 1e-6);
  assert.equal(craterWide.rig.fragments.length, 4);
  assert.equal(craterWide.rig.impactFragments.length, craterWide.rig.fragments.length);
  craterWide.dispose(); craterSmall.dispose();

  const stack = buildRockVisual({ preset: 'stackedRocks' });
  assert.equal(stack.rig.fragments.length, 3);
  assert.ok(stack.attachments['fragment[0]'] && stack.attachments.fragment0 && stack.attachments.fragment2);
  close(stack.getAttachmentWorldPosition('fragment[1]').distanceTo(
    stack.getAttachmentWorldPosition('fragment1')), 0, 1e-8, 'aliased anchors coincide');
  const anchorBefore = stack.getAttachmentWorldPosition('fragment[1]');
  stack.setPose('scatter', stack.actions.scatter.duration);
  close(stack.getAttachmentWorldPosition('fragment[1]').distanceTo(
    stack.rig.fragments[1].getWorldPosition(new Vector3())), 0, 1e-8, 'anchor tracks its rock');
  assert.ok(stack.getAttachmentWorldPosition('fragment[1]').distanceTo(anchorBefore) > 0);
  stack.dispose();

  const crystalRock = buildRockVisual({ preset: 'crystalRock' });
  assert.equal(crystalRock.rig.crystals.length, 2);
  assert.equal(crystalRock.rig.fragments.length, 2);
  assert.ok(crystalRock.rig.coreMesh);
  crystalRock.dispose();

  const tailLong = buildRockVisual({ preset: 'meteorite', meteoriteTail: 5 });
  const tailShort = buildRockVisual({ preset: 'meteorite', meteoriteTail: 0 });
  assert.ok(tailLong.getPoseBounds().getSize(new Vector3()).z
    > tailShort.getPoseBounds().getSize(new Vector3()).z + 2);
  tailLong.dispose(); tailShort.dispose();

  const raised = buildRockVisual({ preset: 'boulder', buriedAmount: 0 });
  const buried = buildRockVisual({ preset: 'boulder', buriedAmount: .8 });
  assert.ok(raised.getPoseBounds().max.y > buried.getPoseBounds().max.y + .3);
  raised.dispose(); buried.dispose();
});

test('random variants, JSON round trips, schema extremes and reference heights stay deterministic and finite', () => {
  for (const preset of Object.keys(ROCK_PRESETS)) {
    for (const seed of [1, 42, 2147483647]) {
      const random = randomRockOptions(seed, { preset });
      assert.deepEqual(random, randomRockOptions(seed, { preset }));
      assert.equal(random.preset, preset);
      const a = buildRockVisual(random), b = buildRockVisual(JSON.parse(JSON.stringify(random)));
      assert.deepEqual(a.params, b.params);
      same(snap(a.mesh), snap(b.mesh));
      for (const [id, spec] of Object.entries(a.actions)) {
        a.setPose(id, span(spec) * .37); b.setPose(id, span(spec) * .37);
        same(snap(a.mesh), snap(b.mesh));
      }
      a.dispose(); b.dispose();
    }
    for (const extreme of ['min', 'max']) {
      const options = { preset };
      for (const [key, spec] of Object.entries(ROCK_SCHEMA)) if (spec[extreme] !== undefined) options[key] = spec[extreme];
      const a = buildRockVisual(options);
      for (const [id, spec] of Object.entries(a.actions)) for (const u of [0, .25, .5, .75, 1, 2.1]) {
        a.setPose(id, span(spec) * u);
        assert.ok(snap(a.mesh).every(Number.isFinite), `${preset} ${extreme} ${id} ${u}`);
        assert.ok(a.getPoseBounds().min.y >= -1e-6, `${preset} ${extreme} ${id} ${u}`);
      }
      a.dispose();
    }
  }
  const short = buildRockVisual({ preset: 'boulder', referenceHeight: .8 });
  const tall = buildRockVisual({ preset: 'boulder', referenceHeight: 3.2 });
  assert.deepEqual(short.dimensions, tall.dimensions, 'referenceHeight never scales the asset');
  assert.deepEqual(short.bounds, tall.bounds);
  assert.equal(short.scaleInfo.units, 'm');
  assert.equal(short.scaleInfo.referenceHeight, .8);
  assert.equal(tall.scaleInfo.referenceHeight, 3.2);
  close(short.scaleInfo.neutralHeight, short.dimensions.y);
  close(short.scaleInfo.width, short.dimensions.x);
  short.dispose(); tall.dispose();
  assert.throws(() => randomRockOptions(.3), TypeError);
  assert.throws(() => normalizeRockOptions({ preset: 'bad' }), RangeError);
  assert.throws(() => normalizeRockOptions({ width: NaN }), TypeError);
});

test('caller transforms and world attachment frames survive every action, and disposal releases resources once', () => {
  for (const preset of Object.keys(ROCK_PRESETS)) {
    const parent = new Group(); parent.position.set(4, 2, -3); parent.rotation.set(.2, .6, -.3); parent.scale.set(.7, 1.1, 1.3);
    const a = buildRockVisual({ preset }); parent.add(a.mesh);
    a.mesh.position.set(1, .8, -2); a.mesh.rotation.set(.1, -.2, .3); a.mesh.scale.set(1.2, .9, 1.1);
    const transform = node => [...node.position, ...node.quaternion, ...node.scale];
    const rootTransform = transform(a.mesh), parentTransform = transform(parent);
    const baseFrame = a.getAttachmentFrame('base');
    for (const [id, spec] of Object.entries(a.actions)) {
      a.setPose(id, span(spec) * .37);
      assert.deepEqual(transform(a.mesh), rootTransform, `${preset}/${id}: root untouched`);
      assert.deepEqual(transform(parent), parentTransform);
      for (const [name, node] of Object.entries(a.attachments)) {
        const frame = a.getAttachmentFrame(name);
        close(frame.origin.distanceTo(node.getWorldPosition(new Vector3())), 0, 1e-8, `${preset}/${id}/${name}: origin`);
        close(frame.direction.length(), 1);
        const direct = node.localToWorld(new Vector3(0, 1, 0)).sub(frame.origin).normalize();
        close(direct.distanceTo(frame.direction), 0);
      }
      const baseNow = a.getAttachmentFrame('base');
      close(baseNow.origin.distanceTo(baseFrame.origin), 0);
      close(baseNow.direction.distanceTo(baseFrame.direction), 0);
    }
    const resources = new Set(); a.mesh.traverse(node => { if (node.isMesh) { resources.add(node.geometry); resources.add(node.material); } });
    let disposed = 0; for (const resource of resources) resource.addEventListener('dispose', () => disposed++);
    a.dispose(); a.dispose(); assert.equal(disposed, resources.size); assert.equal(a.mesh.parent, null);
    assert.equal(a.disposed, true);
    for (const call of [() => a.setPose('still'), () => a.reset(), () => a.getPoseBounds(),
      () => a.getAttachmentFrame('base'), () => a.getAttachmentWorldPosition('top'), () => a.getStats()]) assert.throws(call, /disposed/);
  }
  const meteorite = buildRockVisual({ preset: 'meteorite' });
  close(meteorite.getAttachmentFrame('hazard').direction.z, 1, 1e-6, 'meteorite hazard faces forward');
  meteorite.dispose();
  const boulder = buildRockVisual();
  close(boulder.getAttachmentFrame('hazard').direction.y, 1, 1e-6);
  assert.equal(boulder.attachments.focus, boulder.attachments.surface);
  assert.equal(boulder.attachments.activation, boulder.attachments.hazard);
  assert.equal(boulder.setPose('still'), boulder, 'setPose chains');
  assert.throws(() => boulder.setPose('explode'), RangeError);
  for (const time of [NaN, Infinity, '1']) assert.throws(() => boulder.setPose('impact', time), TypeError);
  assert.throws(() => boulder.getAttachmentFrame('missing'), RangeError);
  boulder.setPose('impact', -1); assert.equal(boulder.actionState.progress, 0);
  const state = boulder.actionState; state.id = 'corrupt'; assert.notEqual(boulder.actionState.id, 'corrupt');
  const pose = snap(boulder.mesh);
  assert.throws(() => boulder.setPose('impact', NaN), TypeError); same(snap(boulder.mesh), pose, 'bad input leaves pose intact');
  boulder.dispose();
  assert.throws(() => buildRockVisual({ preset: 'bad' }), RangeError);
  assert.throws(() => buildRockVisual({ width: NaN }), TypeError);
  assert.throws(() => buildRockVisual({ colors: { body: 'red' } }), TypeError);
});