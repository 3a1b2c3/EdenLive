import * as THREE from 'three';
import { SIMPLE_CHARACTER_PRESETS, SIMPLE_CHARACTER_SCHEMA, buildSimpleCharacterVisual, randomSimpleCharacterOptions }
  from '/assets/world/object/factory/CharacterVisualFactory.js';
import { SIMPLE_EQUIPMENT_PRESETS, SIMPLE_EQUIPMENT_SCHEMA, buildSimpleEquipmentVisual, randomSimpleEquipmentOptions }
  from '/assets/world/object/factory/EquipmentVisualFactory.js';
import { SIMPLE_QUADRUPED_PRESETS, SIMPLE_QUADRUPED_SCHEMA, buildSimpleQuadrupedVisual, randomSimpleQuadrupedOptions }
  from '/assets/world/object/factory/QuadrupedVisualFactory.js';
import { SIMPLE_BIRD_PRESETS, SIMPLE_BIRD_SCHEMA, buildSimpleBirdVisual, randomSimpleBirdOptions }
  from '/assets/world/object/factory/BirdVisualFactory.js';
import { SIMPLE_FISH_PRESETS, SIMPLE_FISH_SCHEMA, buildSimpleFishVisual, randomSimpleFishOptions }
  from '/assets/world/object/factory/FishVisualFactory.js';
import { SIMPLE_FANTASY_PRESETS, SIMPLE_FANTASY_SCHEMA, buildSimpleFantasyCreatureVisual, randomSimpleFantasyCreatureOptions }
  from '/assets/world/object/factory/FantasyCreatureVisualFactory.js';
import { SIMPLE_PICKUP_PRESETS, SIMPLE_PICKUP_SCHEMA, SIMPLE_PICKUP_MOTIONS, buildSimplePickupVisual, randomSimplePickupOptions }
  from '/assets/world/object/factory/PickupVisualFactory.js';
import { SIMPLE_MECHANISM_PRESETS, SIMPLE_MECHANISM_SCHEMA, buildSimpleMechanismVisual, randomSimpleMechanismOptions }
  from '/assets/world/object/factory/MechanismVisualFactory.js';
import { SIMPLE_VEHICLE_PRESETS, SIMPLE_VEHICLE_SCHEMA, buildSimpleVehicleVisual, randomSimpleVehicleOptions }
  from '/assets/world/object/factory/VehicleVisualFactory.js';
import { SIMPLE_AIRCRAFT_PRESETS, SIMPLE_AIRCRAFT_SCHEMA, buildSimpleAircraftVisual, randomSimpleAircraftOptions }
  from '/assets/world/object/factory/AircraftVisualFactory.js';
import { SIMPLE_HOUSE_PRESETS, SIMPLE_HOUSE_SCHEMA, buildSimpleHouseVisual, randomSimpleHouseOptions }
  from '/assets/world/object/factory/HouseVisualFactory.js';
import { SIMPLE_BUILDING_PRESETS, SIMPLE_BUILDING_SCHEMA, buildSimpleBuildingVisual, randomSimpleBuildingOptions }
  from '/assets/world/object/factory/BuildingVisualFactory.js';
import { SIMPLE_TREE_PRESETS, SIMPLE_TREE_SCHEMA, buildSimpleTreeVisual, randomSimpleTreeOptions }
  from '/assets/world/object/factory/TreeVisualFactory.js';
import { SIMPLE_ROCK_PRESETS, SIMPLE_ROCK_SCHEMA, buildSimpleRockVisual, randomSimpleRockOptions }
  from '/assets/world/object/factory/RockVisualFactory.js';
import { SIMPLE_TRAIN_PRESETS, SIMPLE_TRAIN_SCHEMA, buildSimpleTrainVisual, randomSimpleTrainOptions }
  from '/assets/world/object/factory/TrainVisualFactory.js';

// This preview chooses families; runtime projects copy only their selected factory.
const families = {
  character: { label: 'Character', mode: 'named', schema: SIMPLE_CHARACTER_SCHEMA,
    create: buildSimpleCharacterVisual, random: randomSimpleCharacterOptions, presets: SIMPLE_CHARACTER_PRESETS },
  equipment: { label: 'Equipment', mode: 'named', schema: SIMPLE_EQUIPMENT_SCHEMA,
    create: buildSimpleEquipmentVisual, random: randomSimpleEquipmentOptions, presets: SIMPLE_EQUIPMENT_PRESETS },
  quadruped: { label: 'Quadruped', mode: 'named', schema: SIMPLE_QUADRUPED_SCHEMA,
    create: buildSimpleQuadrupedVisual, random: randomSimpleQuadrupedOptions, presets: SIMPLE_QUADRUPED_PRESETS },
  bird: { label: 'Bird', mode: 'named', schema: SIMPLE_BIRD_SCHEMA,
    create: buildSimpleBirdVisual, random: randomSimpleBirdOptions, presets: SIMPLE_BIRD_PRESETS },
  fish: { label: 'Fish', mode: 'named', schema: SIMPLE_FISH_SCHEMA,
    create: buildSimpleFishVisual, random: randomSimpleFishOptions, presets: SIMPLE_FISH_PRESETS },
  fantasy: { label: 'Fantasy creature', mode: 'named', schema: SIMPLE_FANTASY_SCHEMA,
    create: buildSimpleFantasyCreatureVisual, random: randomSimpleFantasyCreatureOptions, presets: SIMPLE_FANTASY_PRESETS },
  pickup: { label: 'Pickup', mode: 'named', schema: SIMPLE_PICKUP_SCHEMA,
    create: buildSimplePickupVisual, random: randomSimplePickupOptions, presets: SIMPLE_PICKUP_PRESETS,
    // The simplified pickup keeps its four motion keys as a module constant
    // instead of exposing them on the api.
    motions: SIMPLE_PICKUP_MOTIONS },
  mechanism: { label: 'Mechanism', mode: 'named', schema: SIMPLE_MECHANISM_SCHEMA,
    create: buildSimpleMechanismVisual, random: randomSimpleMechanismOptions, presets: SIMPLE_MECHANISM_PRESETS },
  vehicle: { label: 'Vehicle', mode: 'named', schema: SIMPLE_VEHICLE_SCHEMA,
    create: buildSimpleVehicleVisual, random: randomSimpleVehicleOptions, presets: SIMPLE_VEHICLE_PRESETS },
  aircraft: { label: 'Aircraft', mode: 'named', schema: SIMPLE_AIRCRAFT_SCHEMA,
    create: buildSimpleAircraftVisual, random: randomSimpleAircraftOptions, presets: SIMPLE_AIRCRAFT_PRESETS },
  house: { label: 'House', mode: 'static', schema: SIMPLE_HOUSE_SCHEMA,
    create: buildSimpleHouseVisual, random: randomSimpleHouseOptions, presets: SIMPLE_HOUSE_PRESETS },
  building: { label: 'Building', mode: 'static', schema: SIMPLE_BUILDING_SCHEMA,
    create: buildSimpleBuildingVisual, random: randomSimpleBuildingOptions, presets: SIMPLE_BUILDING_PRESETS },
  tree: { label: 'Tree', mode: 'named', schema: SIMPLE_TREE_SCHEMA,
    create: buildSimpleTreeVisual, random: randomSimpleTreeOptions, presets: SIMPLE_TREE_PRESETS },
  rock: { label: 'Rock', mode: 'named', schema: SIMPLE_ROCK_SCHEMA,
    create: buildSimpleRockVisual, random: randomSimpleRockOptions, presets: SIMPLE_ROCK_PRESETS },
  train: { label: 'Train', mode: 'train', schema: SIMPLE_TRAIN_SCHEMA,
    create: buildSimpleTrainVisual, random: randomSimpleTrainOptions, presets: SIMPLE_TRAIN_PRESETS },
};

const ui = Object.fromEntries([...document.querySelectorAll('[id]')].map(node => [node.id, node]));
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e9efe3');
const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
scene.add(new THREE.HemisphereLight('#f6faf0', '#a3b3a0', 2.4));
const sun = new THREE.DirectionalLight('#fff0d2', 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.normalBias = 0.025;
scene.add(sun, sun.target);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
  new THREE.MeshStandardMaterial({ color: '#e1e8d8', roughness: 1 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.04;
floor.receiveShadow = true;
scene.add(floor);

let asset, boundsHelper;
let family = 'character', playing = true, frameId;
// This example owns the clock for the pose-only factories: they take absolute
// seconds (or travelled distance) and deliberately keep no clock of their own.
let elapsed = 0;
// The simplified train rolls from a caller-owned distance accumulator.
let travel = 0;
let yaw = 2.65, elevation = 0.24, zoom = 1, fitDistance = 7;
const focus = new THREE.Vector3();
const sphere = new THREE.Sphere();

function reportError(error) {
  ui.error.textContent = error ? error.message : '';
  ui.error.hidden = !error;
}

function refreshCamera() {
  const distance = fitDistance * zoom;
  camera.position.set(Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation),
    Math.cos(yaw) * Math.cos(elevation)).multiplyScalar(distance).add(focus);
  camera.lookAt(focus);
}

function frameAsset(resetView) {
  if (!asset) return;
  asset.bounds.getBoundingSphere(sphere);
  focus.copy(sphere.center);
  const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
  const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
  fitDistance = sphere.radius / Math.sin(Math.min(vertical, horizontal)) * 1.12;
  if (resetView) {
    zoom = 1;
    yaw = family === 'train' ? 2.08 : 2.65;
    elevation = family === 'train' ? 0.35 : 0.24;
  }
  camera.near = Math.max(0.01, sphere.radius / 100);
  camera.far = Math.max(200, sphere.radius * 120);
  camera.updateProjectionMatrix();
  const extent = Math.max(4, sphere.radius * 1.4);
  floor.scale.setScalar(extent * 30);
  sun.position.set(extent, extent * 1.7, -extent).add(focus);
  sun.target.position.copy(focus);
  Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent,
    bottom: -extent, near: 0.1, far: extent * 7 });
  sun.shadow.camera.updateProjectionMatrix();
  refreshCamera();
}

function refreshFields() {
  const info = families[family];
  ui.shape.replaceChildren();
  const groups = new Map();
  for (const [key, spec] of Object.entries(info.schema)) {
    if (spec.derived || (spec.when && !spec.when(asset.params))) continue;
    const label = document.createElement('label');
    label.htmlFor = `shape-${key}`;
    const span = document.createElement('span');
    span.textContent = spec.label;
    const output = document.createElement('output');
    output.value = String(asset.params[key]);
    span.append(output);
    let input;
    if (spec.choices) {
      input = document.createElement('select');
      input.replaceChildren(...Object.entries(spec.choices).map(([value, name]) => new Option(name, value)));
      input.value = asset.params[key];
    } else {
      input = document.createElement('input');
      if (typeof spec.default === 'boolean') {
        input.type = 'checkbox'; input.checked = asset.params[key];
      } else {
        Object.assign(input, { type: spec.input === 'number' ? 'number' : 'range',
          min: spec.min, max: spec.max, step: spec.step ?? .01, value: asset.params[key] });
      }
    }
    input.id = `shape-${key}`;
    input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
      const value = spec.choices ? input.value : input.type === 'checkbox' ? input.checked : Number(input.value);
      rebuild({ ...asset.params, [key]: value });
    });
    label.append(span, input);
    if (!groups.has(spec.group)) {
      const section = document.createElement('details');
      section.open = groups.size === 0;
      const title = document.createElement('summary'); title.textContent = spec.group ?? 'Shape';
      section.append(title); groups.set(spec.group, section); ui.shape.append(section);
    }
    groups.get(spec.group).append(label);
  }
  if (family === 'character') {
    const section = document.createElement('fieldset');
    const legend = document.createElement('legend'); legend.textContent = 'Hand equipment'; section.append(legend);
    for (const hand of ['left', 'right']) {
      const label = document.createElement('label'); label.textContent = `${hand} hand`;
      const input = document.createElement('select'); input.id = `loadout-${hand}`;
      input.replaceChildren(new Option('Empty', ''), ...Object.keys(SIMPLE_EQUIPMENT_PRESETS).map(id => new Option(id, id)));
      input.value = asset.params.loadout[hand]?.preset ?? '';
      input.addEventListener('change', () => rebuild({ ...asset.params, loadout: { ...asset.params.loadout,
        [hand]: input.value ? { preset: input.value } : null } }));
      label.append(input); section.append(label);
    }
    ui.shape.prepend(section);
  }
  ui.preset.value = asset.params.preset;
  ui.params.value = JSON.stringify(asset.params, null, 2);
  ui['asset-title'].textContent = `${info.label} / ${asset.params.preset}`;
  ui['asset-subtitle'].textContent = [asset.params.species ?? asset.params.kind ?? asset.params.type,
    asset.params.torso, asset.params.roof].filter(Boolean).join(' · ');
  ui.dimensions.textContent = `Rest size · ${asset.dimensions.toArray().map(n => n.toFixed(2)).join(' × ')} units`;
  const stats = asset.getStats();
  ui.stats.textContent = `${stats.meshes} meshes · ${stats.triangles.toLocaleString('en')} triangles`;
}

function samplePose(target = asset, time = elapsed, motion = ui.motion.value) {
  const mode = families[family].mode;
  if (mode === 'named') target.setPose(motion, time);
  else if (mode === 'seconds') target.setPose(time);
}

function rebuild(options, resetView = false) {
  let next;
  try {
    // Sample before replacing the live model so invalid edits retain a usable preview.
    next = families[family].create(options);
    // Pose surface: api motions when present (or a config fallback like pickup),
    // plus action tables for families that carry only actions (creatures, items).
    const template = (families[family].motions ?? next.motions) ?? {};
    const entries = new Map(Object.entries(template).map(([id, label]) => [id, label]));
    for (const [id, spec] of Object.entries(next.actions ?? {})) {
      if (!entries.has(id)) entries.set(id, spec.label ?? id);
    }
    const selected = entries.has(ui.motion.value) ? ui.motion.value
      : next.actionState?.id ?? [...entries.keys()][0];
    samplePose(next, elapsed, selected);
    asset?.dispose();
    asset = next;
    boundsHelper?.removeFromParent();
    boundsHelper?.geometry.dispose(); boundsHelper?.material.dispose();
    scene.add(asset.group ?? asset.mesh);
    boundsHelper = new THREE.Box3Helper(asset.bounds.clone(), '#397c75');
    boundsHelper.visible = ui['show-bounds'].checked; scene.add(boundsHelper);
    const motionOptions = [...entries].map(([id, label]) => new Option(label, id));
    // Held equipment actions compose through the character's hand slots, keyed like `right:draw`.
    const hands = typeof next.getEquipmentActions === 'function' ? ['right', 'left'] : [];
    for (const hand of hands) {
      for (const [id, spec] of Object.entries(next.getEquipmentActions(hand) ?? {})) {
        motionOptions.push(new Option(`${hand} ${spec.label}`, `${hand}:${id}`));
      }
    }
    ui.motion.replaceChildren(...motionOptions);
    ui.motion.value = motionOptions.some(o => o.value === ui.motion.value) ? ui.motion.value : (selected ?? '');
    frameAsset(resetView); refreshFields(); reportError(null);
    return true;
  } catch (error) {
    if (next && next !== asset) next.dispose();
    reportError(error); return false;
  }
}

function selectFamily() {
  family = ui.family.value;
  const info = families[family], { mode } = info;
  ui.preset.replaceChildren(...Object.keys(info.presets).map(name => new Option(name, name)));
  ui.motion.replaceChildren();
  ui['motion-label'].hidden = mode !== 'named';
  // Simplified trains have no steam puff; the checkbox stays hidden.
  ui['steam-label'].hidden = true;
  ui['speed-label'].textContent = mode === 'train' ? 'Travel speed (model units/s)' : 'Animation multiplier';
  ui.speed.min = mode === 'train' ? -12 : 0;
  ui.speed.max = mode === 'train' ? 12 : 2;
  ui.speed.step = .1; ui.speed.value = mode === 'train' ? 6 : 1;
  ui.speed.disabled = mode === 'static'; ui.reset.disabled = mode === 'static';
  ui['speed-value'].value = ui.speed.value;
  travel = 0; elapsed = 0; rebuild({}, true);
}

function sample(nextSeed = false) {
  const seed = ui.seed.valueAsNumber;
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
    reportError(new RangeError('Choose an integer seed between 0 and 4294967295.'));
    return;
  }
  const selected = nextSeed ? (seed + 1) >>> 0 : seed;
  ui.seed.value = selected;
  rebuild(families[family].random(selected), true);
}

function setPlaying(value) {
  playing = value;
  ui.pause.textContent = playing ? 'Pause' : 'Resume';
  ui.pause.setAttribute('aria-pressed', String(!playing));
}

// Built from the config above so the selector cannot drift out of sync with it.
ui.family.replaceChildren(...Object.entries(families).map(([key, info]) => new Option(info.label, key)));
ui.family.value = family;
ui.family.addEventListener('change', selectFamily);
ui.preset.addEventListener('change', () => rebuild({ preset: ui.preset.value }, true));
ui.sample.addEventListener('click', () => sample());
ui.next.addEventListener('click', () => sample(true));
ui.apply.addEventListener('click', () => {
  try { rebuild(JSON.parse(ui.params.value), true); }
  catch (error) { reportError(error); }
});
ui.speed.addEventListener('input', () => { ui['speed-value'].value = ui.speed.value; });
ui.pause.addEventListener('click', () => setPlaying(!playing));
ui.reset.addEventListener('click', () => {
  elapsed = 0; travel = 0;
  if (typeof asset.reset === 'function') asset.reset();
  else asset.setPose(0);
  if (asset.actionState) ui.motion.value = asset.actionState.id;
  setPlaying(false);
});
ui['show-bounds'].addEventListener('change', () => { boundsHelper.visible = ui['show-bounds'].checked; });
ui.motion.addEventListener('change', () => { elapsed = 0; samplePose(); });

let drag;
ui.canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  ui.canvas.setPointerCapture(event.pointerId);
});
ui.canvas.addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.id) return;
  yaw -= (event.clientX - drag.x) * 0.008;
  elevation = THREE.MathUtils.clamp(elevation + (event.clientY - drag.y) * 0.006, 0.05, 1.25);
  drag.x = event.clientX;
  drag.y = event.clientY;
  refreshCamera();
});
ui.canvas.addEventListener('lostpointercapture', () => { drag = null; });
ui.canvas.addEventListener('wheel', event => {
  event.preventDefault();
  zoom = THREE.MathUtils.clamp(zoom * Math.exp(event.deltaY * 0.001), 0.45, 3);
  refreshCamera();
}, { passive: false });

const resizeObserver = new ResizeObserver(() => {
  const { width, height } = ui.viewport.getBoundingClientRect();
  camera.aspect = width / Math.max(height, 1);
  renderer.setSize(width, height, false);
  frameAsset(false);
});
resizeObserver.observe(ui.viewport);
selectFamily();
let previous;
function frame(now) {
  const dt = previous === undefined ? 0 : THREE.MathUtils.clamp((now - previous) / 1000, 0, 0.05);
  previous = now;
  if (playing) {
    const speed = Number(ui.speed.value);
    if (families[family].mode === 'train') {
      travel += dt * speed;
      asset.setPose(speed === 0 ? 'still' : 'roll', travel);
    } else { elapsed += dt * speed; samplePose(); }
  }

  renderer.render(scene, camera);
  document.body.dataset.ready = 'true';
  frameId = requestAnimationFrame(frame);
}
frameId = requestAnimationFrame(frame);

window.addEventListener('pagehide', () => {
  cancelAnimationFrame(frameId);
  resizeObserver.disconnect();
  asset.dispose();
  boundsHelper.geometry.dispose();
  boundsHelper.material.dispose();
  floor.geometry.dispose();
  floor.material.dispose();
  sun.shadow.dispose();
  renderer.dispose();
}, { once: true });
