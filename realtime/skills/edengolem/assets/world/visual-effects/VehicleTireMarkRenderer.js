import * as THREE from 'three';
import { DEFAULT_WORLD_BASIS } from '../../math/WorldBasis.js';
import { disposeObject3D } from '../Object3DUtils.js';

export class VehicleTireMarkRenderer {
  constructor({
    terrainSampler,
    maxSegments = 1200,
    minDistance = 0.16,
    width = 0.18,
    lift = 0.026,
    halfTrack = 0.84,
    frontForwardOffset = 1.07,
    rearForwardOffset = -1.07,
    frontColor = 0x161719,
    rearColor = 0x8d2119,
    frontOpacity = 0.42,
    rearOpacity = 0.58,
    minSpeed = 0.6,
    basis = DEFAULT_WORLD_BASIS
  }) {
    this.group = new THREE.Group();
    this.group.name = 'VehicleTireMarkRenderer';
    this.basis = basis;
    this.terrainSampler = terrainSampler;
    this.maxSegments = Math.max(1, Math.floor(maxSegments));
    this.minDistance = minDistance;
    this.width = width;
    this.lift = lift;
    this.halfTrack = halfTrack;
    this.frontForwardOffset = frontForwardOffset;
    this.rearForwardOffset = rearForwardOffset;
    this.minSpeed = minSpeed;

    // Scratch reused across frames. Tire marks are appended every frame a vehicle
    // is grounded and moving, so anything allocated per call here becomes garbage
    // at frame rate.
    this._scratchPoint = [new THREE.Vector3(), new THREE.Vector3()];
    this._direction = new THREE.Vector3();
    this._edge = new THREE.Vector3();
    this._corner = new THREE.Vector3();
    this._planarScratch = { right: 0, forward: 0 };
    this._up = this.basis.upVector();

    this.front = this.createTrack(frontColor, frontOpacity);
    this.rear = this.createTrack(rearColor, rearOpacity);
    this._tracks = [this.front, this.rear];
  }

  get frontSegments() {
    return this.front.segmentCount;
  }

  get rearSegments() {
    return this.rear.segmentCount;
  }

  get totalSegments() {
    return this.frontSegments + this.rearSegments;
  }

  setTerrainSampler(terrainSampler) {
    this.terrainSampler = terrainSampler;
  }

  createTrack(color, opacity) {
    const geometry = new THREE.BufferGeometry();
    const buffer = new Float32Array(this.maxSegments * 18);
    const attribute = new THREE.BufferAttribute(buffer, 3);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', attribute);
    geometry.setDrawRange(0, 0);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0);

    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    this.group.add(mesh);

    // Ring buffer over maxSegments slots of 18 floats (6 vertices) each. Segments
    // are independent quads, so overwriting the oldest slot in place needs no
    // array shifting and the draw range stays contiguous.
    const track = {
      geometry,
      attribute,
      buffer,
      material,
      mesh,
      last: [new THREE.Vector3(), new THREE.Vector3()],
      hasLast: [false, false],
      writeSlot: 0,
      writeCursor: 0,
      wrapped: false,
      segmentCount: 0,
    };
    this.refresh(track);
    return track;
  }

  clear() {
    for (const track of this._tracks) {
      track.buffer.fill(0);
      track.hasLast[0] = false;
      track.hasLast[1] = false;
      track.writeSlot = 0;
      track.writeCursor = 0;
      track.wrapped = false;
      track.segmentCount = 0;
      track.attribute.clearUpdateRanges();
      track.attribute.needsUpdate = true;
      this.refresh(track);
    }
  }

  resetLast() {
    for (const track of this._tracks) {
      track.hasLast[0] = false;
      track.hasLast[1] = false;
    }
  }

  step(vehicleState) {
    if (!vehicleState.grounded || vehicleState.horizontalSpeed < this.minSpeed) {
      this.resetLast();
      return;
    }

    this.stepTrack(vehicleState, this.front, this.frontForwardOffset);
    this.stepTrack(vehicleState, this.rear, this.rearForwardOffset);
  }

  stepTrack(vehicleState, track, forwardOffset) {
    let changed = false;

    for (let i = 0; i < 2; i += 1) {
      const side = i === 0 ? -1 : 1;
      const point = this.tirePoint(vehicleState, forwardOffset, side, this._scratchPoint[i]);
      if (track.hasLast[i]) {
        changed = this.appendSegment(track, track.last[i], point) || changed;
      }
      track.last[i].copy(point);
      track.hasLast[i] = true;
    }
    if (changed) this.refresh(track);
  }

  tirePoint(vehicleState, forwardOffset, side, target = new THREE.Vector3()) {
    target.copy(vehicleState.position)
      .addScaledVector(vehicleState.bodyFrame.right, side * this.halfTrack)
      .addScaledVector(vehicleState.bodyFrame.forward, forwardOffset);
    const planar = this.basis.toPlanar(target, this._planarScratch);
    const up = this.terrainSampler.heightAt(planar.right, planar.forward) + this.lift;
    return this.basis.fromBasisComponents(planar.right, up, planar.forward, target);
  }

  appendSegment(track, from, to) {
    const direction = this._direction.copy(to).sub(from);
    if (direction.length() < this.minDistance) return false;

    const edge = this._edge.copy(direction)
      .cross(this._up)
      .normalize()
      .multiplyScalar(this.width * 0.5);

    // Overwrite one 18-float slot in place with the quad a, b, c, a, c, d where
    // a = from+edge, b = from-edge, c = to-edge, d = to+edge. Same winding as
    // before; only the destination changed from a growing array to a ring slot.
    const base = track.writeSlot * 18;
    const buffer = track.buffer;
    const corner = this._corner;

    corner.copy(from).add(edge);
    buffer[base] = corner.x; buffer[base + 1] = corner.y; buffer[base + 2] = corner.z;
    buffer[base + 9] = corner.x; buffer[base + 10] = corner.y; buffer[base + 11] = corner.z;

    corner.copy(from).sub(edge);
    buffer[base + 3] = corner.x; buffer[base + 4] = corner.y; buffer[base + 5] = corner.z;

    corner.copy(to).sub(edge);
    buffer[base + 6] = corner.x; buffer[base + 7] = corner.y; buffer[base + 8] = corner.z;
    buffer[base + 12] = corner.x; buffer[base + 13] = corner.y; buffer[base + 14] = corner.z;

    corner.copy(to).add(edge);
    buffer[base + 15] = corner.x; buffer[base + 16] = corner.y; buffer[base + 17] = corner.z;

    track.attribute.addUpdateRange(base, 18);
    track.writeSlot = (track.writeSlot + 1) % this.maxSegments;
    if (track.writeSlot === 0) track.wrapped = true;
    track.segmentCount = track.wrapped ? this.maxSegments : track.writeSlot;
    return true;
  }

  pushPoint(track, point) {
    // Retained for API compatibility: append a single loose vertex into the
    // current slot. Prefer appendSegment, which writes a whole quad at once.
    const offset = track.writeCursor;
    if (offset + 3 > track.buffer.length) return false;
    track.buffer[offset] = point.x;
    track.buffer[offset + 1] = point.y;
    track.buffer[offset + 2] = point.z;
    track.attribute.addUpdateRange(offset, 3);
    track.writeCursor = offset + 3;
    return true;
  }

  refresh(track) {
    // The renderer drains updateRanges on every upload. If nobody is rendering
    // (headless step, or a hidden tab), they would accumulate without bound, so
    // collapse to a single full-buffer upload once the list outgrows the ring.
    if (track.attribute.updateRanges.length > this.maxSegments) {
      track.attribute.clearUpdateRanges();
    }
    track.attribute.needsUpdate = true;
    track.geometry.setDrawRange(0, track.segmentCount * 6);
  }

  dispose() {
    this.clear();
    for (const track of this._tracks) {
      disposeObject3D(track.mesh);
    }
    disposeObject3D(this.group);
  }
}
