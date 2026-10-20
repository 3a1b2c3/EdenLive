import { Box3, Matrix4, Vector3 } from 'three';

export const radians = degrees => degrees * Math.PI / 180;
export const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));
export const smooth = n => { const t = clamp(n); return t * t * (3 - 2 * t); };
export function finite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}
export function controlsObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('controls must be an object');
}

// Matrices are relative to the internal motion node, independent of caller transforms.
export function captureTransportPose(root) {
  const nodes = [];
  function visit(object, parent) {
    const node = { object, parent, matrix: new Matrix4(), position: object.position.clone(),
      quaternion: object.quaternion.clone(), scale: object.scale.clone(), visible: object.visible };
    nodes.push(node); object.children.forEach(child => visit(child, node));
  }
  visit(root, null);
  return {
    restore() {
      for (const n of nodes) {
        n.object.position.copy(n.position); n.object.quaternion.copy(n.quaternion);
        n.object.scale.copy(n.scale); n.object.visible = n.visible;
      }
    },
    minY(filter = () => true) {
      let min = Infinity;
      for (const n of nodes) {
        n.object.updateMatrix();
        if (n.parent) n.matrix.multiplyMatrices(n.parent.matrix, n.object.matrix);
        else n.matrix.copy(n.object.matrix);
        const vertices = n.object.geometry?.attributes.position;
        if (!vertices || !filter(n.object)) continue;
        const e = n.matrix.elements;
        for (let i = 0; i < vertices.count; i++) min = Math.min(min,
          e[1] * vertices.getX(i) + e[5] * vertices.getY(i) + e[9] * vertices.getZ(i) + e[13]);
      }
      return min;
    },
  };
}

// Hidden projectiles and stowed gear must not enlarge preview bounds.
export function visibleTransportBounds(root) {
  root.updateWorldMatrix(true, true);
  const box = new Box3();
  root.traverseVisible(node => { if (node.isMesh) box.expandByObject(node, true); });
  return box;
}
export function transportFrame(node) {
  node.updateWorldMatrix(true, false);
  const origin = node.getWorldPosition(new Vector3());
  return { origin, direction: node.localToWorld(new Vector3(0, 0, -1)).sub(origin).normalize() };
}