// Three.js 0.161.0. Geometry reads the same attack object as hit resolution.
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, DoubleSide } from 'three';
import { DEFAULT_WORLD_BASIS } from '../../math/WorldBasis.js';
export class AttackTelegraphView {
  constructor({ attack, segments = 32, color = 0xd74831, height = .035, basis = DEFAULT_WORLD_BASIS } = {}) {
    if (!attack || !Number.isInteger(segments) || segments < 3) throw new Error('AttackTelegraphView: attack and >=3 segments required');
    Object.assign(this, { attack, segments, height, basis });
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(segments * 9), 3));
    this.mesh = new Mesh(this.geometry, new MeshBasicMaterial({ color, transparent: true, opacity: .3, side: DoubleSide, depthWrite: false }));
    this.mesh.visible = false; this._range = null; this._angle = null; this._up = basis.upVector();
  }
  update({ origin, facing, enabled = true }) {
    const a = this.attack;
    if (this._range !== a.range || this._angle !== a.halfAngleRadians) {
      const p = this.geometry.attributes.position;
      for (let i = 0; i < this.segments; i++) {
        const lo = -a.halfAngleRadians + i / this.segments * 2 * a.halfAngleRadians;
        const hi = -a.halfAngleRadians + (i + 1) / this.segments * 2 * a.halfAngleRadians;
        const v = this.basis.fromBasisComponents(0, 0, 0); p.setXYZ(i * 3, v.x, v.y, v.z);
        this.basis.fromBasisComponents(Math.sin(lo) * a.range, 0, Math.cos(lo) * a.range, v); p.setXYZ(i * 3 + 1, v.x, v.y, v.z);
        this.basis.fromBasisComponents(Math.sin(hi) * a.range, 0, Math.cos(hi) * a.range, v); p.setXYZ(i * 3 + 2, v.x, v.y, v.z);
      }
      p.needsUpdate = true; this.geometry.computeBoundingSphere(); this._range = a.range; this._angle = a.halfAngleRadians;
    }
    this.mesh.position.copy(origin); this.basis.addHeight(this.mesh.position, this.height);
    this.mesh.quaternion.setFromAxisAngle(this._up, this.basis.forwardToYaw(facing));
    this.mesh.visible = enabled && (a.phase === 'windup' || a.isActive);
    this.mesh.material.opacity = a.isActive ? .6 : .3;
  }
  dispose() { this.mesh.removeFromParent(); this.geometry.dispose(); this.mesh.material.dispose(); }
}
