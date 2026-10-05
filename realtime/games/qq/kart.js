import {
  BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry,
} from 'three';

// Cartoon go-kart from primitives: low chassis, nose, side pods, rear wing, four fat wheels,
// a driver with a round helmet, and twin exhaust flames (hidden until nitro).
// Origin at ground center, -Z forward, about 1.9 x 3.0 units.
export function createKart({ name, body = 0xe63946, accent = 0xffd166, helmet = 0xffffff } = {}) {
  const root = new Group();
  root.name = name;
  const mat = (color, extra = {}) => new MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, flatShading: true, ...extra });
  const bodyMat = mat(body);
  const accentMat = mat(accent);
  const darkMat = mat(0x22252d);
  const tireMat = mat(0x1b1c20, { roughness: 0.9 });

  const add = (geo, material, x, y, z, parent = root) => {
    const m = new Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  add(new BoxGeometry(1.5, 0.28, 2.7), bodyMat, 0, 0.42, 0);
  const nose = add(new BoxGeometry(1.0, 0.24, 0.9), bodyMat, 0, 0.46, -1.55);
  nose.rotation.x = -0.12;
  add(new BoxGeometry(1.8, 0.12, 0.35), accentMat, 0, 0.4, -1.95);
  add(new BoxGeometry(0.32, 0.34, 1.5), accentMat, -0.86, 0.48, 0.1);
  add(new BoxGeometry(0.32, 0.34, 1.5), accentMat, 0.86, 0.48, 0.1);
  add(new BoxGeometry(0.9, 0.5, 0.7), darkMat, 0, 0.75, 0.95);
  add(new BoxGeometry(0.08, 0.5, 0.08), darkMat, -0.55, 1.0, 1.3);
  add(new BoxGeometry(0.08, 0.5, 0.08), darkMat, 0.55, 1.0, 1.3);
  add(new BoxGeometry(1.7, 0.08, 0.42), bodyMat, 0, 1.28, 1.35);

  // Driver
  add(new CylinderGeometry(0.3, 0.36, 0.55, 10), mat(0x2b2d42), 0, 0.85, 0.25);
  add(new SphereGeometry(0.36, 14, 10), mat(helmet), 0, 1.33, 0.2);
  add(new BoxGeometry(0.52, 0.16, 0.12), mat(0x14213d, { metalness: 0.4 }), 0, 1.35, -0.13);
  add(new CylinderGeometry(0.28, 0.28, 0.06, 14), darkMat, 0, 0.98, -0.42).rotation.x = Math.PI / 2.6;

  const wheels = [];
  const wheelGeo = new CylinderGeometry(0.4, 0.4, 0.42, 14);
  for (const [x, z, r] of [[-0.98, -1.05, 0.36], [0.98, -1.05, 0.36], [-1.0, 1.0, 0.44], [1.0, 1.0, 0.44]]) {
    const pivot = new Group();
    pivot.position.set(x, r, z);
    root.add(pivot);
    const w = add(wheelGeo, tireMat, 0, 0, 0, pivot);
    w.rotation.z = Math.PI / 2;
    w.scale.set(r / 0.4, 1, r / 0.4);
    wheels.push({ pivot, front: z < 0 });
  }

  const flames = new Group();
  flames.name = `${name}_flames`;
  const flameMat = new MeshStandardMaterial({ color: 0x5ad1ff, emissive: 0x2aa8ff, emissiveIntensity: 1.6, transparent: true, opacity: 0.85 });
  for (const x of [-0.3, 0.3]) {
    add(new CylinderGeometry(0.1, 0.1, 0.3, 8), darkMat, x, 0.6, 1.45).rotation.x = Math.PI / 2;
    const f = add(new ConeGeometry(0.16, 0.9, 8), flameMat, x, 0.6, 2.0, flames);
    f.rotation.x = Math.PI / 2;
  }
  flames.visible = false;
  root.add(flames);

  return { root, wheels, flames };
}
