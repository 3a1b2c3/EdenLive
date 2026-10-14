import * as THREE from 'three';

// Small, instance-owned primitive kit. No global GPU resources or browser state.
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
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function readPalette(defaults, overrides = {}) {
  const palette = {};
  for (const key of Object.keys(defaults)) {
    const color = overrides[key] ?? defaults[key];
    if (!(Number.isInteger(color) && color >= 0 && color <= 0xffffff)
      && !(typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))) {
      throw new TypeError(`colors.${key} must be 0xRRGGBB or #RRGGBB`);
    }
    palette[key] = color;
  }
  return palette;
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
    const key = new THREE.Color(color).getHex();
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({
      color: key, roughness: 0.72, metalness: 0.04, flatShading: true,
    }));
    return materials.get(key);
  }
  function mesh(parent, name, geo, size, position, color) {
    const object = new THREE.Mesh(geo, material(color));
    object.name = name;
    object.scale.set(...size);
    object.position.set(...position);
    parent.add(object);
    return object;
  }
  const box = (parent, name, size, position, color) => mesh(parent, name,
    geometry('box', () => new THREE.BoxGeometry(1, 1, 1)), size, position, color);
  const sphere = (parent, name, size, position, color) => mesh(parent, name,
    geometry('sphere', () => new THREE.SphereGeometry(0.5, 12, 8)), size, position, color);
  const cylinder = (parent, name, radius, height, position, color, topRatio = 1) => mesh(parent, name,
    geometry(`cylinder-${topRatio}`, () => new THREE.CylinderGeometry(topRatio, 1, 1, 12)),
    [radius, height, radius], position, color);
  const rock = (parent, name, size, position, color) => mesh(parent, name,
    geometry('icosahedron', () => new THREE.IcosahedronGeometry(0.5, 0)), size, position, color);
  function frustum(parent, name, size, position, color, topRatio = 0.5) {
    const geo = geometry(`frustum-${topRatio}`, () => {
      const g = new THREE.BoxGeometry(1, 1, 1), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) {
        p.setX(i, p.getX(i) * topRatio); p.setZ(i, p.getZ(i) * topRatio);
      }
      g.computeVertexNormals();
      return g;
    });
    return mesh(parent, name, geo, size, position, color);
  }
  function prism(parent, name, profile, size, position, color) {
    const geo = geometry(`prism-${JSON.stringify(profile)}`, () => {
      const shape = new THREE.Shape(profile.map(p => new THREE.Vector2(...p)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 1 });
      return g.translate(0, 0, -0.5);
    });
    return mesh(parent, name, geo, size, position, color);
  }
  // A flat polygonal ring in XY, with a real hole and thickness along Z.
  function ring(parent, name, radius, width, depth, position, color, sides = 12) {
    const inner = 1 - width / radius;
    const geo = geometry(`ring-${inner}-${sides}`, () => {
      const shape = new THREE.Shape(), hole = new THREE.Path();
      for (let i = 0; i < sides; i++) {
        const a = i / sides * Math.PI * 2;
        const x = Math.cos(a), y = Math.sin(a);
        if (i === 0) { shape.moveTo(x, y); hole.moveTo(x * inner, -y * inner); }
        else { shape.lineTo(x, y); hole.lineTo(x * inner, -y * inner); }
      }
      shape.closePath(); hole.closePath();
      shape.holes.push(hole);
      return new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 1 }).translate(0, 0, -0.5);
    });
    return mesh(parent, name, geo, [radius, radius, depth], position, color);
  }
  // A thick, flat polygon in the XZ plane, used for swept wings and broad leaves.
  function slab(parent, name, outline, thickness, position, color) {
    const geo = geometry(`slab-${JSON.stringify(outline)}`, () => {
      const shape = new THREE.Shape(outline.map(p => new THREE.Vector2(...p)));
      return new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 1 })
        .rotateX(Math.PI / 2).translate(0, 0.5, 0);
    });
    return mesh(parent, name, geo, [1, thickness, 1], position, color);
  }
  function beam(parent, name, start, end, width, color) {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end), direction = b.clone().sub(a);
    const object = box(parent, name, [width, direction.length(), width], a.add(b).multiplyScalar(0.5).toArray(), color);
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
  return { box, sphere, cylinder, rock, frustum, prism, ring, slab, beam, taperedBox, nose, group, stats, dispose,
    assertLive() { if (disposed) throw new Error('Visual has been disposed'); } };
}

export function measure(root) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root, true);
  return { bounds, dimensions: bounds.getSize(new THREE.Vector3()) };
}

// New factories share their parameter definitions with the editor to keep limits in sync.
export function normalizeFactoryOptions(options, presets, schema, palette) {
  const preset = choiceOption(options.preset, Object.keys(presets)[0], Object.keys(presets), 'preset');
  const source = { ...presets[preset], ...options }, result = { preset };
  for (const [key, field] of Object.entries(schema)) {
    if (field.choices) result[key] = choiceOption(source[key], field.default, Object.keys(field.choices), key);
    else if (typeof field.default === 'boolean') result[key] = boolOption(source[key], field.default, key);
    else {
      const value = numberOption(source[key], field.default, field.min, field.max, key);
      result[key] = field.step === 1 ? Math.round(value) : value;
    }
  }
  result.colors = readPalette(palette, { ...presets[preset].colors, ...options.colors });
  return freezeConfig(result);
}

export function randomFactoryOptions(seed, overrides, presets, schema, palettes, normalize) {
  const random = seededRandom(seed);
  // Mix early LCG values so consecutive seeds also explore different silhouettes.
  for (let i = 0; i < 5; i++) random();
  const pick = values => values[Math.floor(random() * values.length)];
  const preset = overrides.preset ?? pick(Object.keys(presets));
  const base = normalize({ preset }), options = { preset };
  for (const [key, field] of Object.entries(schema)) {
    if (field.derived || field.randomize === false) options[key] = base[key];
    else if (field.choices) options[key] = pick(Object.keys(field.choices));
    else if (typeof field.default === 'boolean') options[key] = random() > 0.5;
    else {
      const value = field.fullRange ? field.min + random() * (field.max - field.min)
        : base[key] * (0.65 + random() * 0.7);
      options[key] = Math.max(field.min, Math.min(field.max, Math.round(value / field.step) * field.step));
    }
  }
  if ('shapeSeed' in schema) options.shapeSeed = seed >>> 0;
  return normalize({ ...options, ...overrides, colors: { ...pick(palettes), ...overrides.colors } });
}

// Root is always at ground level; bounds describe the neutral, untransformed asset.
// The `group` alias mirrors the historical skill contract (`visual.group` in consumers
// such as NaturalEnvironment.js, and tests asserting `asset.mesh === asset.group`).
export function finishVisual(kit, mesh, params, extras = {}) {
  const before = measure(mesh);
  for (const child of mesh.children) child.position.y -= before.bounds.min.y;
  return { mesh, group: mesh, params, ...measure(mesh), ...extras,
    getStats: () => kit.stats(mesh), dispose: () => kit.dispose(mesh) };
}
