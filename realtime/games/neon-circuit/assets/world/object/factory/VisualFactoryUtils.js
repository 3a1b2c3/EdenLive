import * as THREE from 'three';
import { RandomGenerator } from '../../../math/RandomUtils.js';

// Small, instance-owned primitive kit. No global GPU resources or browser state.
export function objectOption(value, name = 'options') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value;
}

export function numberOption(value, fallback, min, max, name) {
  const n = value === undefined ? fallback : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new TypeError(`${name} must be finite`);
  return Math.min(max, Math.max(min, n));
}

export function choiceOption(value, fallback, choices, name) {
  const selected = value === undefined ? fallback : value;
  if (!choices.includes(selected)) throw new RangeError(`${name}: choose ${choices.join(', ')}`);
  return selected;
}

export function boolOption(value, fallback, name) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be boolean`);
  return value;
}

export function freezeConfig(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeConfig);
    Object.freeze(value);
  }
  return value;
}

export function seededRandom(seed = 1) {
  if (!Number.isInteger(seed)) throw new TypeError('seed must be an integer');
  const generator = new RandomGenerator(seed);
  return () => generator.random();
}

export function readPalette(defaults, overrides = {}) {
  const palette = {};
  for (const key of Object.keys(defaults)) {
    // An omitted key (or explicit undefined) uses the default; other values,
    // including null, are validated so an invalid explicit color cannot be
    // silently replaced by a fallback.
    const color = overrides[key] === undefined ? defaults[key] : overrides[key];
    if (!(Number.isInteger(color) && color >= 0 && color <= 0xffffff)
      && !(typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))) {
      throw new TypeError(`colors.${key} must be 0xRRGGBB or #RRGGBB`);
    }
    palette[key] = color;
  }
  return palette;
}

function finiteVector(values, name, length = 3) {
  if (!Array.isArray(values) || values.length !== length || !values.every(Number.isFinite)) {
    throw new TypeError(`${name} must contain ${length} finite numbers`);
  }
  return values;
}

export function createPrimitiveKit() {
  const geometries = new Map();
  const materials = new Map();
  let disposed = false;
  const geometry = (key, build) => {
    if (!geometries.has(key)) geometries.set(key, build());
    return geometries.get(key);
  };
  function material(color) {
    if (!(Number.isInteger(color) && color >= 0 && color <= 0xffffff)
      && !(typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))) {
      throw new TypeError('color must be 0xRRGGBB or #RRGGBB');
    }
    const key = new THREE.Color(color).getHex();
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({
      color: key, roughness: 0.72, metalness: 0.04, flatShading: true,
    }));
    return materials.get(key);
  }
  function mesh(parent, name, geo, size, position, color) {
    finiteVector(size, `${name} size`);
    if (size.some(value => !(value > 0))) throw new RangeError(`${name} size must be positive`);
    finiteVector(position, `${name} position`);
    const object = new THREE.Mesh(geo, material(color));
    object.name = name;
    object.castShadow = true;
    object.receiveShadow = true;
    object.scale.set(...size);
    object.position.set(...position);
    parent.add(object);
    return object;
  }
  const box = (parent, name, size, position, color) => mesh(parent, name,
    geometry('box', () => new THREE.BoxGeometry(1, 1, 1)), size, position, color);
  const sphere = (parent, name, size, position, color) => mesh(parent, name,
    geometry('sphere', () => new THREE.SphereGeometry(0.5, 12, 8)), size, position, color);
  const cylinder = (parent, name, radius, height, position, color, topRatio = 1) => {
    if (!(Number.isFinite(radius) && radius > 0) || !(Number.isFinite(height) && height > 0)) {
      throw new RangeError(`${name} radius and height must be positive finite numbers`);
    }
    if (!(Number.isFinite(topRatio) && topRatio >= 0)) throw new RangeError(`${name} topRatio must be finite and nonnegative`);
    return mesh(parent, name,
    geometry(`cylinder-${topRatio}`, () => new THREE.CylinderGeometry(topRatio, 1, 1, 12)),
    [radius, height, radius], position, color);
  };
  const rock = (parent, name, size, position, color) => mesh(parent, name,
    geometry('icosahedron', () => new THREE.IcosahedronGeometry(0.5, 0)), size, position, color);
  function frustum(parent, name, size, position, color, topRatio = 0.5) {
    finiteVector(size, `${name} size`);
    finiteVector(position, `${name} position`);
    if (size.some(value => !(value > 0))) throw new RangeError(`${name} size must be positive`);
    if (!(Number.isFinite(topRatio) && topRatio >= 0)) throw new RangeError(`${name} topRatio must be finite and nonnegative`);
    const safeRatio = topRatio;
    const geo = geometry(`frustum-${safeRatio}`, () => {
      const g = new THREE.BoxGeometry(1, 1, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) {
        p.setX(i, p.getX(i) * safeRatio);
        p.setZ(i, p.getZ(i) * safeRatio);
      }
      g.computeVertexNormals();
      return g;
    });
    return mesh(parent, name, geo, size, position, color);
  }
  function prism(parent, name, profile, size, position, color) {
    if (!Array.isArray(profile) || profile.length < 3) throw new TypeError('profile must have at least three points');
    profile.forEach((point, index) => finiteVector(point, `profile[${index}]`, 2));
    const key = `prism-${JSON.stringify(profile)}`;
    const geo = geometry(key, () => {
      const shape = new THREE.Shape(profile.map(point => new THREE.Vector2(...point)));
      return new THREE.ExtrudeGeometry(shape, {
        depth: 1, bevelEnabled: false, curveSegments: 1,
      }).translate(0, 0, -0.5);
    });
    return mesh(parent, name, geo, size, position, color);
  }
  // A thick polygon in the XZ plane, useful for broad leaves and swept wings.
  function slab(parent, name, outline, thickness, position, color) {
    if (!Array.isArray(outline) || outline.length < 3) throw new TypeError('outline must have at least three points');
    outline.forEach((point, index) => finiteVector(point, `outline[${index}]`, 2));
    if (!(Number.isFinite(thickness) && thickness > 0)) throw new RangeError('thickness must be positive and finite');
    const safeThickness = thickness;
    const key = `slab-${JSON.stringify(outline)}`;
    const geo = geometry(key, () => {
      const shape = new THREE.Shape(outline.map(point => new THREE.Vector2(...point)));
      return new THREE.ExtrudeGeometry(shape, {
        depth: 1, bevelEnabled: false, curveSegments: 1,
      }).rotateX(Math.PI / 2).translate(0, 0.5, 0);
    });
    return mesh(parent, name, geo, [1, safeThickness, 1], position, color);
  }
  function beam(parent, name, start, end, width, color) {
    if (!Array.isArray(start) || !Array.isArray(end) || start.length !== 3 || end.length !== 3) {
      throw new TypeError('beam endpoints must be three-element arrays');
    }
    finiteVector(start, 'beam start'); finiteVector(end, 'beam end');
    if (!(Number.isFinite(width) && width > 0)) throw new RangeError('beam width must be positive and finite');
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
    const direction = b.clone().sub(a);
    const length = direction.length();
    if (!(length > 0) || !Number.isFinite(length)) throw new RangeError('beam endpoints must differ');
    const object = box(parent, name, [width, length, width],
      a.add(b).multiplyScalar(0.5).toArray(), color);
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return object;
  }
  function taperedBox(parent, name, width, height, depth, position, color, bottomRatio = 0.8) {
    const key = `taper-${bottomRatio}`;
    const geo = geometry(key, () => {
      const g = new THREE.BoxGeometry(1, 1, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) p.setX(i, p.getX(i) * bottomRatio);
      g.computeVertexNormals();
      return g;
    });
    return mesh(parent, name, geo, [width, height, depth], position, color);
  }
  // A tapered train nose: rear cross section is full size, front is low and narrow.
  function nose(parent, name, size, position, color, tipWidth = 0.45, tipHeight = 0.45) {
    const geo = geometry(`nose-${tipWidth}-${tipHeight}`, () => {
      const g = new THREE.BoxGeometry(1, 1, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getZ(i) < 0) {
        p.setX(i, p.getX(i) * tipWidth);
        p.setY(i, (p.getY(i) + 0.5) * tipHeight - 0.5);
      }
      g.computeVertexNormals();
      return g;
    });
    return mesh(parent, name, geo, size, position, color);
  }
  function group(parent, name, position = [0, 0, 0]) {
    const object = new THREE.Group();
    object.name = name;
    object.position.set(...position);
    parent.add(object);
    return object;
  }
  function stats(root) {
    let meshes = 0, triangles = 0;
    root.traverse(o => {
      if (!o.isMesh) return;
      meshes++;
      triangles += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
    });
    return { meshes, triangles, geometries: geometries.size, materials: materials.size };
  }
  function dispose(root) {
    if (disposed) return;
    root.removeFromParent();
    geometries.forEach(g => g.dispose());
    materials.forEach(m => m.dispose());
    disposed = true;
  }
  return { box, sphere, cylinder, rock, frustum, prism, slab, beam, taperedBox, nose, group, stats, dispose,
    assertLive() { if (disposed) throw new Error('Visual has been disposed'); } };
}

export function measure(root) {
  // Construction-time measurement: root and its ancestors must have identity transforms
  // except for intentional part offsets. The factories publish the result in root-local space.
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root, true);
  return { bounds, dimensions: bounds.getSize(new THREE.Vector3()) };
}

// New parameterized factories share their definitions with the preview/editor.
// The returned object is frozen so callers can safely persist resolved params;
// caller-owned input objects are never mutated or frozen.
export function normalizeFactoryOptions(options = {}, presets, schema, palette) {
  objectOption(options);
  if (options.colors !== undefined) objectOption(options.colors, 'colors');
  const presetNames = Object.keys(presets);
  const preset = choiceOption(options.preset, presetNames[0], presetNames, 'preset');
  const presetOptions = presets[preset] ?? {};
  const source = { ...presetOptions, ...options };
  const result = { preset };
  for (const [key, field] of Object.entries(schema)) {
    if (field.choices) result[key] = choiceOption(source[key], field.default, Object.keys(field.choices), key);
    else if (typeof field.default === 'boolean') result[key] = boolOption(source[key], field.default, key);
    else {
      const value = numberOption(source[key], field.default, field.min, field.max, key);
      result[key] = field.step === 1 ? Math.round(value) : value;
    }
  }
  const presetColors = presetOptions.colors === undefined ? {} : presetOptions.colors;
  result.colors = readPalette(palette, { ...presetColors, ...options.colors });
  return freezeConfig(result);
}

export function randomFactoryOptions(seed, overrides = {}, presets, schema, palettes, normalize) {
  objectOption(overrides, 'overrides');
  if (overrides.colors !== undefined) objectOption(overrides.colors, 'colors');
  const random = seededRandom(seed);
  // Skip a short prefix so nearby integer seeds do not produce nearly identical
  // first silhouettes while retaining the repository RandomGenerator sequence.
  for (let i = 0; i < 5; i += 1) random();
  const pick = values => values[Math.floor(random() * values.length)];
  const preset = overrides.preset ?? pick(Object.keys(presets));
  const base = normalize({ preset });
  const options = { preset };
  for (const [key, field] of Object.entries(schema)) {
    if (field.randomize === false) options[key] = base[key];
    else if (field.choices) options[key] = pick(Object.keys(field.choices));
    else if (typeof field.default === 'boolean') options[key] = random() > 0.5;
    else {
      const span = field.max - field.min;
      const value = field.fullRange ? field.min + random() * span : base[key] * (0.65 + random() * 0.7);
      const stepped = field.step === 1 ? Math.round(value) : Math.round(value / field.step) * field.step;
      options[key] = Math.max(field.min, Math.min(field.max, stepped));
    }
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'shapeSeed')) options.shapeSeed = seed >>> 0;
  const palette = palettes?.length ? pick(palettes) : {};
  return normalize({ ...options, ...overrides, colors: { ...palette, ...overrides.colors } });
}

// Root is always seated on y=0 in its neutral pose. Bounds and dimensions are
// local construction snapshots; placement and animation remain caller-owned.
export function finishVisual(kit, mesh, params, extras = {}) {
  const before = measure(mesh);
  if (!before.bounds.isEmpty() && Number.isFinite(before.bounds.min.y)) {
    for (const child of mesh.children) child.position.y -= before.bounds.min.y;
  }
  const measured = measure(mesh);
  const api = {
    group: mesh,
    mesh,
    params,
    bounds: measured.bounds,
    dimensions: measured.dimensions,
    getStats: () => kit.stats(mesh),
    dispose: () => kit.dispose(mesh),
    ...extras,
  };
  return api;
}
