import * as THREE from 'three';
import { DEFAULT_WORLD_BASIS } from '../../math/WorldBasis.js';
import { DEFAULT_PRNG } from '../../math/RandomUtils.js';
import { disposeObject3D } from '../Object3DUtils.js';

function rampAxes(ramp) {
  const cos = Math.cos(ramp.yaw);
  const sin = Math.sin(ramp.yaw);
  return [
    { right: cos, forward: sin },
    { right: -sin, forward: cos },
  ];
}

export function defaultRampLayout(scale=1.0) {
  return [
    {
      right: 0.10 * scale,
      forward: -0.24 * scale,
      spanRight: 0.07 * scale,
      spanForward: 0.14 * scale,
      spanUp: 0.032 * scale,
      yaw: 0,
    },
    {
      right: -0.20 * scale,
      forward: -0.08 * scale,
      spanRight: 0.068 * scale,
      spanForward: 0.112 * scale,
      spanUp: 0.04 * scale,
      yaw: Math.PI * 0.5,
    },
    {
      right: 0.30 * scale,
      forward: 0.08 * scale,
      spanRight: 0.084 * scale,
      spanForward: 0.16 * scale,
      spanUp: 0.052 * scale,
      yaw: Math.PI,
    },
  ];
}

export function defaultPillarLayout(scale=1.0) {
  const pillars = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const radiusFromCenter = i % 2 === 0 ? 0.20 : 0.28;
    const height = i % 2 === 0 ? 0.07 : 0.08;
    const radius = i % 2 === 0 ? 0.02 : 0.03;
    pillars.push({
      right: Math.cos(angle) * radiusFromCenter * scale,
      forward: -Math.sin(angle) * radiusFromCenter * scale,
      radius: radius * scale,
      spanUp: height * scale,
    });
  }
  return pillars;
}

/**
 * The four perimeter walls, optionally with a gap cut into one of them.
 *
 * `sizeForward` defaults to `sizeRight`, so the old single-argument square call still works.
 *
 * `openings` cuts a doorway or goal mouth into a side by emitting two wall segments with a hole
 * between them instead of one slab. Without it the only way to get an exit through a wall was to
 * hand-author the whole layout, and a "sealed gate marks the exit" scene had no way to say so.
 * Each opening is `{ side: 'forward'|'back'|'left'|'right', centre = 0, width }` in metres along
 * that wall.
 */
export function defaultWallLayout(
  sizeRight,
  floorUp,
  wallHeight,
  wallThickness,
  sizeForward = sizeRight,
  openings = []
) {
  const up = floorUp + wallHeight * 0.5;
  const halfRight = sizeRight * 0.5;
  const halfForward = sizeForward * 0.5;
  const walls = [];

  // One side of the perimeter. `along` is the axis the wall runs down; a wall with an opening
  // becomes the segments either side of the hole.
  function side(name, { right, forward, spanRight, spanUp, spanForward, along, length }) {
    const holes = openings
      .filter((opening) => opening.side === name && Number(opening.width) > 0)
      .map((opening) => ({
        centre: Number(opening.centre) || 0,
        half: Math.min(Number(opening.width), length) * 0.5,
      }))
      .sort((a, b) => a.centre - b.centre);

    if (!holes.length) {
      walls.push({ right, up, forward, spanRight, spanUp, spanForward });
      return;
    }

    // Walk the wall from one end to the other, emitting a segment for each solid stretch.
    let cursor = -length * 0.5;
    const segments = [];
    for (const hole of holes) {
      const holeStart = Math.max(cursor, hole.centre - hole.half);
      if (holeStart > cursor) segments.push([cursor, holeStart]);
      cursor = Math.max(cursor, hole.centre + hole.half);
    }
    if (cursor < length * 0.5) segments.push([cursor, length * 0.5]);

    for (const [from, to] of segments) {
      const span = to - from;
      if (span <= 1e-6) continue;
      const offset = (from + to) * 0.5;
      walls.push({
        right: along === 'right' ? right + offset : right,
        up,
        forward: along === 'forward' ? forward + offset : forward,
        spanRight: along === 'right' ? span : spanRight,
        spanUp,
        spanForward: along === 'forward' ? span : spanForward,
      });
    }
  }

  side('forward', {
    right: 0, forward: halfForward,
    spanRight: sizeRight, spanUp: wallHeight, spanForward: wallThickness,
    along: 'right', length: sizeRight,
  });
  side('back', {
    right: 0, forward: -halfForward,
    spanRight: sizeRight, spanUp: wallHeight, spanForward: wallThickness,
    along: 'right', length: sizeRight,
  });
  side('left', {
    right: -halfRight, forward: 0,
    spanRight: wallThickness, spanUp: wallHeight, spanForward: sizeForward,
    along: 'forward', length: sizeForward,
  });
  side('right', {
    right: halfRight, forward: 0,
    spanRight: wallThickness, spanUp: wallHeight, spanForward: sizeForward,
    along: 'forward', length: sizeForward,
  });

  return walls;
}

export class ArenaEnvironment {
  constructor({
    scene,
    worldSize = 50,
    // A rectangular arena. Defaults to worldSize, so a square arena keeps its one-knob call,
    // but a pitch, a chamber or a corridor-shaped room no longer has to be square: worldSize
    // was a single scalar, and a 60x88 space could not be expressed at all.
    worldSizeForward = null,
    floorUp = 0,
    wallHeight = 3,
    wallThickness = 0.7,
    // Openings cut into the perimeter: [{ side, centre, width }]. See defaultWallLayout.
    wallOpenings = [],
    // Cover, opt-out-able. create() built eight pillars and three ramps unconditionally, so a
    // scene whose prose says "open enough to build speed" or "never blocking movement" had to
    // avoid create() entirely and call the builders one by one. Worse, the default layout places
    // pillars at FRACTIONS of the size, so a small arena collapses all eight onto the spawn.
    pillars = true,
    ramps = true,
    grid = true,
    groundColor = 0x58745e,
    gridMajorColor = 0x89a9cc,
    gridMinorColor = 0x5d7593,
    wallColor = 0x3f5261,
    wallOpacity = 1,
    pillarColor = 0x8d6f53,
    rampColor = 0x8d6f53,
    prng = DEFAULT_PRNG,
    basis = DEFAULT_WORLD_BASIS,
  }) {

    this.scene = scene;
    this.worldSize = worldSize;
    this.worldSizeForward = worldSizeForward === null || worldSizeForward === undefined
      ? worldSize
      : worldSizeForward;
    this.wallOpenings = wallOpenings;
    this.pillars = pillars;
    this.ramps = ramps;
    this.grid = grid;
    this.wallOpacity = wallOpacity;
    this.floorUp = floorUp;
    this.wallHeight = wallHeight;
    this.wallThickness = wallThickness;
    this.groundColor = groundColor;
    this.gridMajorColor = gridMajorColor;
    this.gridMinorColor = gridMinorColor;
    this.wallColor = wallColor;
    this.pillarColor = pillarColor;
    this.rampColor = rampColor;
    this.prng = prng;
    this.basis = basis;
    this.objectRotation = this.basis.threeObjectCanonicalToBasisQuaternion();
    this.planeRotation = this.basis.threePlaneCanonicalToBasisQuaternion();
    this.group = new THREE.Group();
    this.group.name = 'ArenaEnvironment';

    this.bounds = this.createBounds();
    this.wallLayout = defaultWallLayout(
      this.worldSize,
      this.floorUp,
      this.wallHeight,
      this.wallThickness,
      this.worldSizeForward,
      this.wallOpenings
    );
    // An empty layout when cover is off, so isPlanarPointBlockedByGeometry and the physics
    // colliders agree with what was actually built. A suppressed pillar that still blocks
    // spawn sampling is the kind of disagreement nobody finds by looking.
    this.pillarLayout = this.pillars ? defaultPillarLayout(this.worldSize) : [];
    this.rampLayout = this.ramps ? defaultRampLayout(this.worldSize) : [];

    this.physicsWorld = null;
    this.rapier = null;
    this.physicsColliders = [];
  }

  create() {
    this.createGround();
    if (this.grid) this.createGrid();
    this.createWalls();
    if (this.pillars) this.createPillars();
    if (this.ramps) this.createRamps();
    this.scene.add(this.group);
    return this;
  }

  createGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(this.worldSize, this.worldSizeForward),
      new THREE.MeshStandardMaterial({ color: this.groundColor, roughness: 1, metalness: 0 })
    );
    ground.receiveShadow = true;
    ground.position.copy(this.basis.fromBasisComponents(0, this.floorUp, 0));
    ground.quaternion.copy(this.planeRotation);
    this.group.add(ground);
  }

  createGrid() {
    // Built as an explicit line set rather than a GridHelper. A GridHelper is square, and
    // scaling its two axes independently to cover a rectangle changes the line spacing on the
    // shorter axis -- so the cells stop being square and the grid stops reading as a distance
    // reference, which is the only reason it is here.
    const halfRight = this.worldSize * 0.5;
    const halfForward = this.worldSizeForward * 0.5;
    const cell = 1;
    const points = [];

    for (let i = 0; i <= Math.round(this.worldSize / cell); i += 1) {
      const right = -halfRight + i * cell;
      const a = this.basis.fromBasisComponents(right, 0, -halfForward);
      const b = this.basis.fromBasisComponents(right, 0, halfForward);
      points.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    for (let i = 0; i <= Math.round(this.worldSizeForward / cell); i += 1) {
      const forward = -halfForward + i * cell;
      const a = this.basis.fromBasisComponents(-halfRight, 0, forward);
      const b = this.basis.fromBasisComponents(halfRight, 0, forward);
      points.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const grid = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: this.gridMinorColor,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
      })
    );
    grid.position.copy(this.basis.fromBasisComponents(0, this.floorUp + 0.01, 0));
    grid.renderOrder = 1;
    this.group.add(grid);
    // gridMesh, not grid: `this.grid` is the caller's on/off flag, and overwriting it with the
    // mesh would make a second create() skip the grid it had just built.
    this.gridMesh = grid;
  }

  createWalls() {
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: this.wallColor,
      roughness: 0.88,
      metalness: 0,
      // A pitch under "transparent walls" needs to see through them; an opaque perimeter hides
      // the far half of the space from a chase camera.
      transparent: this.wallOpacity < 1,
      opacity: this.wallOpacity,
    });

    for (const wall of this.wallLayout) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(wall.spanRight, wall.spanUp, wall.spanForward), wallMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.copy(this.basis.fromBasisComponents(wall.right, wall.up, wall.forward));
      mesh.quaternion.copy(this.objectRotation);
      this.group.add(mesh);
    }
  }

  createPillars() {
    const pillarMaterial = new THREE.MeshStandardMaterial({
      color: this.pillarColor,
      roughness: 0.86,
      metalness: 0.02,
    });

    for (const pillar of this.pillarLayout) {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(pillar.radius, pillar.radius, pillar.spanUp, 18),
        pillarMaterial
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const pillarUp = this.floorUp + pillar.spanUp * 0.5;
      mesh.position.copy(this.basis.fromBasisComponents(pillar.right, pillarUp, pillar.forward));
      mesh.quaternion.copy(this.objectRotation);
      this.group.add(mesh);
      pillar.mesh = mesh;
    }
  }

  createRamps() {
    const rampMaterial = new THREE.MeshStandardMaterial({
      color: this.rampColor,
      roughness: 0.9,
      metalness: 0,
    });

    for (const ramp of this.rampLayout) {
      const geometry = this.createRampGeometry(ramp);
      const mesh = new THREE.Mesh(geometry, rampMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      ramp.mesh = mesh;
    }
  }

  createRampGeometry(ramp) {
    const halfW = ramp.spanRight * 0.5;
    const halfL = ramp.spanForward * 0.5;
    const [rightAxis, forwardAxis] = rampAxes(ramp);
    const localCorners = [
      [-halfW, 0, halfL],
      [halfW, 0, halfL],
      [-halfW, 0, -halfL],
      [halfW, 0, -halfL],
      [-halfW, ramp.spanUp, -halfL],
      [halfW, ramp.spanUp, -halfL],
    ];
    const positions = [];
    const indices = [];
    const vertex = new THREE.Vector3();

    const addCorner = (cornerIndex) => {
      const [localRight, localUp, localForward] = localCorners[cornerIndex];
      const right = ramp.right + localRight * rightAxis.right + localForward * forwardAxis.right;
      const forward = ramp.forward + localRight * rightAxis.forward + localForward * forwardAxis.forward;
      this.basis.fromBasisComponents(right, this.floorUp + localUp, forward, vertex);
      positions.push(
        vertex.x,
        vertex.y,
        vertex.z
      );
      return positions.length / 3 - 1;
    };

    const addTriangle = (a, b, c) => {
      indices.push(addCorner(a), addCorner(b), addCorner(c));
    };

    const addQuad = (a, b, c, d) => {
      addTriangle(a, b, c);
      addTriangle(a, c, d);
    };

    addQuad(0, 1, 3, 2);
    addQuad(0, 4, 5, 1);
    addQuad(2, 3, 5, 4);
    addTriangle(0, 2, 4);
    addTriangle(1, 5, 3);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  createBounds() {
    // Inset by 1.2 m so a spawned body sits clear of the wall rather than inside it.
    const inset = 1.2;
    const halfRight = this.worldSize * 0.5 - inset;
    const halfForward = this.worldSizeForward * 0.5 - inset;
    return {
      minRight: -halfRight,
      maxRight: halfRight,
      minForward: -halfForward,
      maxForward: halfForward,
      left: -halfRight,
      right: halfRight,
      back: -halfForward,
      front: halfForward,
    };
  }

  isPlanarPointBlockedByGeometry(right, forward, clearance = 1.2) {
    for (const pillar of this.pillarLayout) {
      const dRight = right - pillar.right;
      const dForward = forward - pillar.forward;
      const minDist = pillar.radius + clearance;
      if (dRight * dRight + dForward * dForward < minDist * minDist) return true;
    }

    for (const ramp of this.rampLayout) {
      const [rightAxis, forwardAxis] = rampAxes(ramp);
      const dRight = right - ramp.right;
      const dForward = forward - ramp.forward;
      const localRight = dRight * rightAxis.right + dForward * rightAxis.forward;
      const localForward = dRight * forwardAxis.right + dForward * forwardAxis.forward;

      if (Math.abs(localRight) <= ramp.spanRight * 0.5 + clearance
        && Math.abs(localForward) <= ramp.spanForward * 0.5 + clearance
      ) {
        return true;
      }
    }

    return false;
  }

  sampleSpawn(
    excludePosition = null,
    minDistance = 0,
    attempts = 24,
    clearance = 1.2
  ) {
    const excludePlanar = excludePosition
      ? this.basis.toPlanar(excludePosition)
      : null;
    for (let i = 0; i < attempts; i += 1) {
      const right = this.prng.uniform(this.bounds.minRight, this.bounds.maxRight);
      const forward = this.prng.uniform(this.bounds.minForward, this.bounds.maxForward);

      if (excludePlanar) {
        const dRight = right - excludePlanar.right;
        const dForward = forward - excludePlanar.forward;
        if (dRight * dRight + dForward * dForward < minDistance * minDistance) continue;
      }

      const blocked = this.isPlanarPointBlockedByGeometry(right, forward, clearance);

      if (!blocked) return this.basis.fromBasisComponents(right, this.floorUp, forward);
    }

    return this.basis.fromBasisComponents(0, this.floorUp, 0);
  }

  createStaticCuboidCollider(box, rotation = this.objectRotation, friction = 0.95) {
    const position = this.basis.fromBasisComponents(box.right, box.up, box.forward);
    const body = this.physicsWorld.createRigidBody(
      this.rapier.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y, position.z)
      .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w })
    );
    const collider = this.physicsWorld.createCollider(
      this.rapier.ColliderDesc.cuboid(box.spanRight * 0.5, box.spanUp * 0.5, box.spanForward * 0.5)
      .setFriction(friction)
      .setRestitution(0),
      body
    );
    return { body, collider };
  }

  createStaticPillarCollider(pillar, friction = 1) {
    const position = this.basis.fromBasisComponents(
      pillar.right,
      this.floorUp + pillar.spanUp * 0.5,
      pillar.forward
    );
    const body = this.physicsWorld.createRigidBody(
      this.rapier.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y, position.z)
      .setRotation({
        x: this.objectRotation.x,
        y: this.objectRotation.y,
        z: this.objectRotation.z,
        w: this.objectRotation.w,
      })
    );
    const collider = this.physicsWorld.createCollider(
      this.rapier.ColliderDesc.cylinder(pillar.spanUp * 0.5, pillar.radius)
      .setFriction(friction)
      .setRestitution(0),
      body
    );
    return { body, collider };
  }

  createStaticRampCollider(geometry, friction = 1) {
    const positionAttr = geometry.getAttribute('position');
    const indexAttr = geometry.getIndex();
    const desc = this.rapier.ColliderDesc.trimesh(
      new Float32Array(positionAttr.array),
      new Uint32Array(indexAttr.array)
    )
      .setFriction(friction)
      .setRestitution(0);
    const body = this.physicsWorld.createRigidBody(this.rapier.RigidBodyDesc.fixed());
    const collider = this.physicsWorld.createCollider(desc, body);
    return { body, collider };
  }

  createPhysicsColliders(world, rapier) {
    this.disposePhysicsColliders();
    this.physicsWorld = world;
    this.rapier = rapier;
    this.physicsColliders = [];

    const groundBox = {
      right: 0,
      up: this.floorUp - 0.1,
      forward: 0,
      spanRight: this.worldSize + this.wallThickness * 2,
      spanUp: 0.2,
      spanForward: this.worldSize + this.wallThickness * 2,
    };
    this.physicsColliders.push({
      ...this.createStaticCuboidCollider(groundBox, this.objectRotation, 1),
    });

    for (let index = 0; index < this.wallLayout.length; index += 1) {
      this.physicsColliders.push({
        ...this.createStaticCuboidCollider(this.wallLayout[index], this.objectRotation, 0.95),
      });
    }

    for (let index = 0; index < this.pillarLayout.length; index += 1) {
      this.physicsColliders.push({
        ...this.createStaticPillarCollider(this.pillarLayout[index], 1),
      });
    }

    for (let index = 0; index < this.rampLayout.length; index += 1) {
      const ramp = this.rampLayout[index];
      const geometry = ramp.mesh.geometry;
      this.physicsColliders.push({
        ...this.createStaticRampCollider(geometry, 1),
      });
    }

    this.physicsWorld.updateSceneQueries();
    return this.physicsColliders;
  }

  disposePhysicsColliders() {
    if (this.physicsWorld) {
      for (const entry of this.physicsColliders) {
        this.physicsWorld.removeRigidBody(entry.body);
      }
      this.physicsWorld.updateSceneQueries();
    }
    this.physicsColliders = [];
    this.physicsWorld = null;
    this.rapier = null;
  }

  dispose() {
    this.disposePhysicsColliders();
    disposeObject3D(this.group);
  }
}
