// Cross-cutting actions for the simplified factories: every preset of the five
// action-bearing families (equipment, fantasy creature, pickup, mechanism, rock)
// must pose deterministically at an absolute time, keep a fixed resource pool,
// and validate inputs; characters must own and articulate held equipment. The
// simple set drops the old detailed APIs, so vehicle steering/slalom, character
// clothing layers and firefighter hoses are asserted against the surfaces that
// exist now: wheel pivots, hand/action validation and a fixed mesh pool.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import * as equipment from '../../../assets/world/object/factory/EquipmentVisualFactory.js';
import * as fantasy from '../../../assets/world/object/factory/FantasyCreatureVisualFactory.js';
import * as pickup from '../../../assets/world/object/factory/PickupVisualFactory.js';
import * as mechanism from '../../../assets/world/object/factory/MechanismVisualFactory.js';
import * as rock from '../../../assets/world/object/factory/RockVisualFactory.js';
import { createCharacterVisual, CHARACTER_MOTIONS } from '../../../assets/world/object/factory/CharacterVisualFactory.js';
import { createQuadrupedVisual } from '../../../assets/world/object/factory/QuadrupedVisualFactory.js';
import { createBirdVisual } from '../../../assets/world/object/factory/BirdVisualFactory.js';
import { createFishVisual } from '../../../assets/world/object/factory/FishVisualFactory.js';
import { createVehicleVisual, VEHICLE_MOTIONS } from '../../../assets/world/object/factory/VehicleVisualFactory.js';
import { createAircraftVisual } from '../../../assets/world/object/factory/AircraftVisualFactory.js';
import { PickupObject } from '../../../assets/world/object/PickupObject.js';
import { WorldBasis } from '../../../assets/math/WorldBasis.js';

const entries = [
  ['Equipment', equipment, 'EQUIPMENT'], ['FantasyCreature', fantasy, 'FANTASY'],
  ['Pickup', pickup, 'PICKUP'], ['Mechanism', mechanism, 'MECHANISM'],
  ['Rock', rock, 'ROCK'],
].map(([name, module, prefix]) => ({ name, create: module[`create${name}Visual`],
  normalize: module[`normalize${name}Options`], random: module[`random${name}Options`],
  presets: module[`${prefix}_PRESETS`], schema: module[`${prefix}_SCHEMA`],
  fallbackMotions: Object.keys(module[`${prefix}_MOTIONS`] ?? {}) }));
const close = (a, b, message = '') => assert.ok(Math.abs(a - b) < 1e-6, `${message}: ${a} != ${b}`);
const rounded = values => values.map(n => Math.abs(n) < 1e-10 ? 0 : Number(n.toFixed(9)));
// The equipment API exposes its root only as `mesh`; every other family names it `group`.
function rootOf(asset) { return asset.group ?? asset.mesh; }
function transforms(asset) {
  const rows = [];
  rootOf(asset).traverse(n => rows.push([n.name, n.visible, ...rounded([...n.position, ...n.quaternion, ...n.scale])]));
  return rows;
}
function finiteGeometry(asset) {
  assert.ok(!asset.bounds.isEmpty());
  assert.ok(asset.dimensions.toArray().every(n => Number.isFinite(n) && n > 0));
  rootOf(asset).updateWorldMatrix(true, true);
  rootOf(asset).traverse(n => {
    assert.ok(n.matrixWorld.elements.every(Number.isFinite), n.name);
    const positions = n.geometry?.attributes.position.array;
    if (positions) assert.ok(positions.every(Number.isFinite), n.name);
  });
}
function displacedParent(asset) {
  const parent = new Group(); parent.position.set(7, 2, -3); parent.rotation.set(.2, -.6, .1); parent.scale.set(1.2, .9, 1.4);
  parent.add(rootOf(asset)); rootOf(asset).position.set(1, 2, 3); rootOf(asset).rotation.set(.1, .3, -.1);
  return parent;
}

for (const entry of entries) {
  test(`${entry.name}: every preset supports deterministic seeking, endpoints and cleanup`, () => {
    for (const preset of Object.keys(entry.presets)) {
      const asset = entry.create({ preset });
      finiteGeometry(asset); close(asset.bounds.min.y, 0, preset);
      // surfaceBreakup is a build-internal rock constant appended to normalized params,
      // not a schema field, so the round trip must ignore it.
      const roundTrip = { ...asset.params }; delete roundTrip.surfaceBreakup;
      assert.deepEqual(entry.normalize(roundTrip), roundTrip);
      assert.ok(Object.isFrozen(asset.params.colors));
      const rest = transforms(asset), stats = asset.getStats();
      displacedParent(asset);
      const root = [rootOf(asset).position.toArray(), rootOf(asset).quaternion.toArray(), rootOf(asset).scale.toArray()];
      // Pickup has no action table: its four motion keys are the whole surface.
      const surface = Object.entries(asset.actions ?? Object.fromEntries(entry.fallbackMotions.map(id => [id, {}])));
      assert.ok(surface.length > 0, `${preset} exposes a pose surface`);
      for (const [id, spec] of surface) {
        const time = (spec.duration ?? spec.period ?? 1) * .43;
        asset.setPose(id, time); const frame = transforms(asset);
        asset.setPose(id, time + 3); asset.setPose(id, time);
        assert.deepEqual(transforms(asset), frame, `${preset} ${id} is seekable`);
        if (spec.mode === 'once') {
          asset.setPose(id, spec.duration); const end = transforms(asset);
          assert.equal(asset.actionState.finished, true, `${preset} ${id}`);
          asset.setPose(id, spec.duration * 10);
          assert.deepEqual(transforms(asset), end, `${preset} ${id} holds endpoint`);
        }
        finiteGeometry(asset);
      }
      asset.reset();
      assert.deepEqual([rootOf(asset).position.toArray(), rootOf(asset).quaternion.toArray(), rootOf(asset).scale.toArray()], root);
      assert.deepEqual(transforms(asset).slice(1), rest.slice(1), `${preset} reset restores internals`);
      assert.deepEqual(asset.getStats(), stats, `${preset} animation keeps its resource pool`);
      const geometries = new Set(), materials = new Set(); let releases = 0;
      rootOf(asset).traverse(n => { if (n.geometry) geometries.add(n.geometry); if (n.material) materials.add(n.material); });
      for (const resource of [...geometries, ...materials]) resource.addEventListener('dispose', () => releases++);
      const external = new Mesh(new BoxGeometry(), new MeshBasicMaterial()); let externalReleases = 0;
      external.geometry.addEventListener('dispose', () => externalReleases++); rootOf(asset).add(external);
      asset.dispose(); asset.dispose();
      assert.equal(releases, geometries.size + materials.size); assert.equal(externalReleases, 0);
      assert.equal(rootOf(asset).parent, null); assert.throws(() => asset.setPose('still', 0));
      external.geometry.dispose(); external.material.dispose();
    }
  });

  test(`${entry.name}: seeded variation, conditional limits and malformed options`, () => {
    // The simple normalizers only reject unknown presets and non-numeric seeds;
    // stray option containers are tolerated, so the old all-throws matrix is gone.
    assert.throws(() => entry.create({ preset: 'missing' }));
    assert.throws(() => entry.random(NaN));
    const shapeSignatures = new Set();
    for (const preset of Object.keys(entry.presets)) {
      const input = { preset, colors: { body: '#123456' } }, before = structuredClone(input);
      const options = entry.random(42, input);
      assert.deepEqual(entry.random(42, input), options); assert.deepEqual(input, before);
      assert.equal(options.colors.body, '#123456'); assert.equal(options.preset, preset);
      const asset = entry.create(options), clone = entry.create(JSON.parse(JSON.stringify(options)));
      assert.deepEqual(transforms(asset), transforms(clone)); asset.dispose(); clone.dispose();
      const base = entry.normalize({ preset });
      for (const edge of ['min', 'max']) {
        const limits = Object.fromEntries(Object.entries(entry.schema).filter(([, field]) =>
          !field.derived && field[edge] !== undefined && (!field.when || field.when(base)))
          .map(([key, field]) => [key, field[edge]]));
        const extreme = entry.create({ preset, ...limits }); finiteGeometry(extreme); extreme.dispose();
      }
    }
    for (const seed of [1, 7, 42]) {
      const asset = entry.create(entry.random(seed)); shapeSignatures.add(JSON.stringify(transforms(asset))); asset.dispose();
    }
    assert.ok(shapeSignatures.size > 1, 'seed changes geometry');
    const invalid = entry.create(); const before = transforms(invalid);
    assert.throws(() => invalid.setPose('missing', 0)); assert.throws(() => invalid.setPose('still', NaN));
    assert.deepEqual(transforms(invalid), before); invalid.dispose();
  });
}

test('character equipment is replaceable, exclusively owned and reusable after release', () => {
  const a = createCharacterVisual({ preset: 'mage', loadout: { left: null, right: null } });
  const b = createCharacterVisual({ height: 1.1 });
  assert.deepEqual(a.params.loadout, { left: null, right: null });
  const bow = a.equip('right', { preset: 'bow' });
  close(bow.params.referenceHeight, a.params.height); assert.ok(a.getEquipmentActions('right').draw);
  assert.throws(() => b.equip('left', bow), /Unequip/); assert.equal(b.equipment.left, null);
  assert.throws(() => a.equip('left', bow), /Unequip/); assert.throws(() => bow.dispose(), /Unequip/);
  const previous = a.params;
  assert.throws(() => a.equip('right', { preset: 'missing' }));
  assert.deepEqual(a.params, previous); assert.equal(bow.disposed, false);
  a.equip('left', { preset: 'roundShield' });
  assert.equal(a.getEquipmentActions('right').draw, undefined); assert.throws(() => a.setEquipmentAction('right', 'draw', 1));
  a.unequip('left').dispose();
  displacedParent(a); a.setEquipmentAction('right', 'draw', 1);
  assert.ok(a.gripStatus.right.supportUsed); close(a.gripStatus.right.primaryError, 0); close(a.gripStatus.right.supportError, 0);
  const released = a.unequip('right'); assert.equal(released, bow); assert.equal(bow.owner, null);
  b.equip('left', released); close(bow.params.referenceHeight, a.params.height);
  b.equip('left', { preset: 'shortSword' }); assert.equal(bow.disposed, true);
  a.dispose(); const owned = b.equipment.left; b.dispose(); b.dispose(); assert.equal(owned.disposed, true);
});

test('body motions and equipment choreography move independently without moving the placement root', () => {
  const person = createCharacterVisual({ preset: 'rogue' }); displacedParent(person);
  person.group.updateMatrix();
  const placement = person.group.matrix.clone();
  for (const id of Object.keys(CHARACTER_MOTIONS)) {
    person.setPose(id, 1.3); const frame = transforms(person);
    person.setPose(id, 4.3); person.setPose(id, 1.3);
    assert.deepEqual(transforms(person), frame, `${id} is seekable`);
    finiteGeometry(person);
  }
  person.reset(); person.group.updateMatrix(); assert.deepEqual(person.group.matrix, placement);
  person.equip('right', { preset: 'shortSword' });
  person.setPose('idle', 0); const idle = transforms(person);
  person.setPose('right:slash', person.getEquipmentActions('right').slash.duration * .45);
  assert.notDeepEqual(transforms(person), idle); assert.equal(person.actionState.active, true);
  person.dispose();
});

test('equipment articulates a bow, syringe and book, and held jets keep a fixed mesh pool', () => {
  for (const [preset, action] of [['bow', 'draw'], ['syringe', 'inject'], ['spellbook', 'read']]) {
    const item = equipment.createEquipmentVisual({ preset }); const rest = transforms(item);
    item.setPose(action, item.actions[action].duration * .65);
    assert.notDeepEqual(transforms(item), rest, preset);
    item.setPose(action, item.actions[action].duration); const end = transforms(item);
    item.setPose(action, item.actions[action].duration * 10);
    assert.deepEqual(transforms(item), end, `${preset} ${action} holds its endpoint`);
    item.dispose();
  }
  const person = createCharacterVisual({ preset: 'firefighter' }), stats = person.getStats();
  close(person.params.loadout.right.referenceHeight, person.params.height);
  assert.deepEqual(Object.keys(person.attachments), ['head', 'leftHand', 'rightHand', 'weapon']);
  for (let i = 0; i < 50; i++) person.setPose('right:spray', i / 10);
  assert.equal(person.actionState.action, 'spray'); assert.deepEqual(person.getStats(), stats); person.dispose();
});

test('creatures share in-place actions, world attack frames and grounded terminal poses', () => {
  for (const create of [createQuadrupedVisual, createBirdVisual, createFishVisual, fantasy.createFantasyCreatureVisual]) {
    const asset = create(); const duration = asset.actions.pounce.duration;
    asset.setPose('pounce', duration * .6, { inPlace: true, heading: .5 });
    close(asset.actionRig.travel.position.z, 0); assert.equal(asset.actionState.active, true);
    asset.setPose('charge', asset.actions.charge.duration);
    assert.ok(asset.actionRig.travel.position.z < 0);
    asset.setPose('death', asset.actions.death.duration);
    close(new Box3().setFromObject(rootOf(asset), true).min.y, 0, 'death touches floor');
    displacedParent(asset); asset.setPose('pounce', duration * .5, { heading: .7 });
    const frame = asset.getAttackFrame(), mount = asset.attachments.attack;
    assert.ok(frame.origin.distanceTo(mount.getWorldPosition(new Vector3())) < 1e-6);
    const expected = mount.localToWorld(new Vector3(0, 0, -1)).sub(frame.origin).normalize();
    assert.ok(frame.direction.distanceTo(expected) < 1e-6);
    const before = transforms(asset); assert.throws(() => asset.setPose('pounce', 1, { heading: NaN }));
    assert.deepEqual(transforms(asset), before); asset.reset(); asset.dispose();
  }
});

test('vehicles roll wheels by signed distance and keep steering pivots static', () => {
  const car = createVehicleVisual({ preset: 'sedan' }); displacedParent(car);
  const root = car.group.position.clone();
  assert.equal(car.motions, VEHICLE_MOTIONS);
  const radii = car.wheels.map(w => w.radius), radians = car.params.steering * Math.PI / 180;
  assert.equal(car.steeringPivots.length, 2);
  car.steeringPivots.forEach(p => close(p.rotation.y, radians));
  car.setPose('drive', .5); // six metres per second of pose time
  car.wheels.forEach((w, i) => close(w.pivot.rotation.x, -3 / radii[i]));
  car.setPose('drive', -.5);
  car.wheels.forEach((w, i) => close(w.pivot.rotation.x, 3 / radii[i]));
  const pose = transforms(car);
  assert.throws(() => car.setPose('slalom', 0)); assert.throws(() => car.setPose('drive', NaN));
  assert.deepEqual(transforms(car), pose);
  car.setPose('drive', 1.2); car.reset();
  car.wheels.forEach(w => close(w.pivot.rotation.x, 0));
  assert.deepEqual(car.group.position, root); car.dispose();
});

test('aircraft expose only built actions, moving surfaces, gear endpoints and world weapon frames', () => {
  const unarmed = createAircraftVisual({ preset: 'seaplane' });
  assert.equal(unarmed.actions.fire, undefined); assert.equal(unarmed.actions.launch, undefined);
  assert.equal(unarmed.actions.gearUp, undefined); assert.throws(() => unarmed.setPose('fire', 0)); unarmed.dispose();
  const plane = createAircraftVisual({ preset: 'lightFighter' }); displacedParent(plane);
  const origin = plane.group.position.clone();
  assert.ok(plane.rig.cannons.length && plane.rig.missiles.length && plane.rig.gear.length);
  plane.setFlightPose(1, { roll: .5, pitch: -.4, yaw: .3, flaps: .6, gear: .5 });
  assert.ok(plane.rig.surfaces.some(s => Math.abs(s.root.rotation.x) > .01));
  assert.ok(plane.rig.gear.some(g => Math.abs(g.door.rotation.z) > .1));
  plane.setPose('gearUp', plane.actions.gearUp.duration); assert.ok(plane.rig.gear.every(g => !g.root.visible));
  plane.setPose('gearDown', plane.actions.gearDown.duration); assert.ok(plane.rig.gear.every(g => g.root.visible));
  plane.setPose('fire', plane.actions.fire.duration * .2); assert.equal(plane.actionState.active, true);
  for (const frame of plane.getWeaponFrames()) {
    assert.ok(frame.origin.toArray().every(Number.isFinite)); close(frame.direction.length(), 1);
  }
  plane.setPose('launch', plane.actions.launch.duration); assert.ok(plane.rig.missiles.every(m => !m.projectile.visible));
  plane.reset(); assert.ok(plane.rig.missiles.every(m => m.projectile.visible));
  assert.deepEqual(plane.group.position, origin); plane.dispose();
});

test('pickup collection is basis-aware, exactly once and resettable with a real visual', () => {
  const basis = new WorldBasis({ right: '+x', up: '+z', forward: '+y' });
  const visual = pickup.createPickupVisual({ preset: 'coinStack' });
  const object = new PickupObject({ pickupVisual: visual, basis, position: new Vector3(2, 3, 20), floorUp: 4, scale: 2 });
  assert.deepEqual(object.position.toArray(), [2, 3, 4]);
  close(new Vector3(0, 1, 0).applyQuaternion(object.group.quaternion).distanceTo(basis.upVector()), 0);
  const position = object.position.clone(); object.animate(.5); assert.deepEqual(object.position, position);
  assert.equal(object.tryCollect(new Vector3(2, 3, 100)), true); assert.equal(object.tryCollect(position), false);
  assert.equal(object.group.visible, false); object.animate(1); close(object.phase, .5);
  assert.throws(() => object.animate(Infinity)); object.reset(); assert.equal(object.group.visible, true);
  assert.equal(object.phase, 0); assert.equal(object.tryCollect(position), true); object.dispose();
});

test('mechanisms expose endpoint state, continuous cycles and transformed attachment frames', () => {
  const gate = mechanism.createMechanismVisual({ preset: 'gate', actionSpeed: 2 });
  close(gate.actions.operate.duration, gate.params.switchDuration / 2);
  gate.setPose('operate', gate.actions.operate.duration); assert.equal(gate.actionState.open, true);
  const end = transforms(gate); gate.setPose('open', 0); assert.deepEqual(transforms(gate), end); gate.dispose();
  const spikes = mechanism.createMechanismVisual({ preset: 'spikes' });
  const small = spikes.getPoseBounds().getSize(new Vector3());
  spikes.setPose('extended'); assert.ok(spikes.getPoseBounds().getSize(new Vector3()).y > small.y + .1);
  spikes.setPose('cycle', spikes.actions.cycle.period); assert.equal(spikes.actionState.phase, 'retracted');
  spikes.dispose();
  const lift = mechanism.createMechanismVisual({ preset: 'liftPlatform' });
  lift.setPose('travel', lift.actions.travel.period / 2); close(lift.actionState.height, lift.params.platformTravel);
  displacedParent(lift);
  for (const [name, node] of Object.entries(lift.attachments)) {
    const frame = lift.getAttachmentFrame(name);
    close(frame.origin.distanceTo(node.getWorldPosition(new Vector3())), 0);
    close(frame.direction.distanceTo(node.localToWorld(new Vector3(0, 1, 0)).sub(frame.origin).normalize()), 0);
  }
  assert.throws(() => lift.getAttachmentFrame('missing')); lift.dispose();
});