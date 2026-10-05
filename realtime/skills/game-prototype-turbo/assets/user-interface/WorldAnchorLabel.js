// Three.js 0.161.0. Overlay container must be positioned; coords are CSS pixels.
import { Vector3 } from 'three';
import { DEFAULT_WORLD_BASIS } from '../math/WorldBasis.js';
export class WorldAnchorLabel {
  constructor({ element, container, height = 3, basis = DEFAULT_WORLD_BASIS }) {
    Object.assign(this, { element, container, height, basis }); this._point = new Vector3();
    element.style.position = 'absolute'; element.style.pointerEvents = 'none';
    element.style.transform = 'translate(-50%, -100%)'; this.hide();
  }
  update({ position, camera, viewport, visible = true, occluded = false, text = null }) {
    if (!visible || occluded) { this.hide(); return false; }
    camera.updateMatrixWorld(); this._point.copy(position); this.basis.addHeight(this._point, this.height); this._point.project(camera);
    const p = this._point;
    if (![p.x, p.y, p.z].every(Number.isFinite) || Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || Math.abs(p.z) > 1) { this.hide(); return false; }
    const box = this.container.getBoundingClientRect();
    this.element.style.left = `${viewport.left - box.left - this.container.clientLeft + this.container.scrollLeft + (p.x + 1) * viewport.width / 2}px`;
    this.element.style.top = `${viewport.top - box.top - this.container.clientTop + this.container.scrollTop + (1 - p.y) * viewport.height / 2}px`;
    if (text !== null) this.element.textContent = text;
    this.element.hidden = false; return true;
  }
  hide() { this.element.hidden = true; }
  dispose() { this.hide(); } // Caller owns the supplied element.
}
