// Three.js 0.161.0. Y-up radial arena; visual architecture is separate from collision.
import { Group, Mesh, InstancedMesh, BoxGeometry, CylinderGeometry, MeshStandardMaterial, Object3D } from 'three';
export class ArenaLayout {
  constructor({ radius = 12, sectors = 32, tiers = 3, tierDepth = 1.6, tierHeight = 1, gateSectors = [0, 16], color = 0xa98d70 } = {}) {
    if (![radius, tierDepth, tierHeight].every(v => Number.isFinite(v) && v > 0) || !Number.isInteger(sectors) || sectors < 8 || !Number.isInteger(tiers) || tiers < 1 || !Array.isArray(gateSectors) || gateSectors.some(v => !Number.isInteger(v) || v < 0 || v >= sectors)) throw new Error('ArenaLayout: invalid dimensions');
    this.group = new Group(); this.radius = radius; this.gates = [...new Set(gateSectors)];
    this._box = new BoxGeometry(1, 1, 1); this._floor = new CylinderGeometry(radius, radius, .2, sectors);
    this._material = new MeshStandardMaterial({ color, roughness: 1 });
    const floor = new Mesh(this._floor, this._material); floor.position.y = -.1; this.group.add(floor);
    const matrices = [], object = new Object3D();
    const add = (angle, r, y, w, h, d) => {
      object.position.set(Math.sin(angle) * r, y, Math.cos(angle) * r); object.rotation.y = angle;
      object.scale.set(w, h, d); object.updateMatrix(); matrices.push(object.matrix.clone());
    };
    for (let s = 0; s < sectors; s++) {
      const a = s / sectors * Math.PI * 2, gate = this.gates.includes(s);
      for (let t = 0; t < tiers; t++) {
        const r = radius + (t + .5) * tierDepth, h = (t + 1) * tierHeight, w = 2 * r * Math.tan(Math.PI / sectors);
        if (!gate) add(a, r, h / 2, w, h, tierDepth);
        else { // Open bay with two piers and a lintel; a greybox arch silhouette.
          for (const side of [-1, 1]) add(a + side * Math.PI / sectors * .78, r, h / 2 + 1, w * .2, h + 2, tierDepth);
          add(a, r, h + 2, w, .35, tierDepth);
        }
      }
    }
    const stands = new InstancedMesh(this._box, this._material, matrices.length);
    matrices.forEach((m, i) => stands.setMatrixAt(i, m)); stands.computeBoundingSphere(); this.group.add(stands);
    // Description only. Caller decides whether gates are traversable and supplies collision.
    this.boundary = { kind: 'circle', radius, gateAngles: this.gates.map(s => s / sectors * Math.PI * 2) };
  }
  dispose() { this.group.removeFromParent(); this._box.dispose(); this._floor.dispose(); this._material.dispose(); }
}
