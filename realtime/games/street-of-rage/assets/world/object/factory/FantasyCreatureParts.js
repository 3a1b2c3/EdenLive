// Simplified species anatomies for the fantasy factory. Every builder returns the
// same rig shape the shared creature actions expect, but the geometry is boxes,
// beams and flat panels: no scales, ribs, rags, claws, fangs, bubbles or spots.
// Bodies are built roughly one unit tall; the factory scales the result.

// Locked girths and offsets. The detailed factory exposes each as a slider.
const LIMB = 0.14, JAW_OPEN = 0.12, SPIKE = 0.06;

function wingPair(kit, parent, p, position, span, color) {
  const wings = [];
  for (const side of [-1, 1]) {
    const root = kit.group(parent, `${side < 0 ? 'left' : 'right'}-wing`, [side * position[0], position[1], position[2]]);
    root.rotation.y = side < 0 ? Math.PI : 0;
    root.rotation.z = side * 0.12;
    kit.slab(root, 'wing-panel', [[0, -0.18], [span, -0.3], [span * 0.9, 0.34], [0, 0.26]],
      0.05, [0, 0, 0], color);
    wings.push({ root, side, mirrored: true });
  }
  return wings;
}
function hornPair(kit, head, p, width, height, color) {
  if (p.hornStyle === 'none') return;
  const size = p.hornSize;
  for (const side of [-1, 1]) {
    const tip = p.hornStyle === 'swept' ? [side * width * 0.5, height * 0.5 + size * 0.12, width * 0.7 * size]
      : p.hornStyle === 'ram' ? [side * (width * 0.6 + size * 0.14), height * 0.15, -width * 0.2]
        : [side * width * 0.3, height * 0.5 + size * 0.34, 0];
    kit.beam(head, 'horn', [side * width * 0.34, height * 0.34, 0], tip, width * 0.16, color);
  }
}
function jawBlock(kit, head, width, height, depth, color) {
  const jaw = kit.group(head, 'jaw', [0, -height * 0.32, -depth * 0.2]);
  jaw.rotation.x = JAW_OPEN;
  kit.box(jaw, 'jaw-block', [width * 0.72, height * 0.26, depth * 0.9], [0, 0, -depth * 0.3], color);
  return jaw;
}

export function buildSimpleDragon(kit, motion, p) {
  const c = p.colors, w = 0.52 * p.bodyWidth, len = 1.05 * p.bodyLength;
  const legLength = 0.42 * p.legLength, bodyY = legLength + 0.28;
  const body = kit.group(motion, 'dragon-body', [0, bodyY, 0]);
  kit.box(body, 'torso', [w, 0.5, len], [0, 0, 0], c.body);
  const neck = kit.group(motion, 'neck');
  const neckTop = [0, bodyY + 0.5 * p.neckLength, -len * 0.5 - 0.22 * p.neckLength];
  kit.beam(neck, 'neck-segment', [0, bodyY + 0.14, -len * 0.4], neckTop, w * 0.42, c.body);
  const head = kit.group(neck, 'head', neckTop);
  const headW = 0.3 * p.headScale, headH = 0.26 * p.headScale, headD = 0.42 * p.headScale;
  kit.box(head, 'head-block', [headW, headH, headD], [0, 0, -headD * 0.2], c.body);
  const jaw = jawBlock(kit, head, headW, headH, headD, c.mouth);
  hornPair(kit, head, p, headW, headH, c.accent);

  const legs = [], pairs = p.dragonLegs === 'two' ? [1] : [-1, 1];
  for (const side of [-1, 1]) for (const front of pairs) {
    const root = kit.group(motion, `${side < 0 ? 'left' : 'right'}-leg`,
      [side * w * 0.44, bodyY - 0.18, front * len * 0.3]);
    kit.box(root, 'leg', [LIMB * p.limbThickness, legLength + 0.18, LIMB * p.limbThickness],
      [0, -(legLength + 0.18) / 2, 0], c.body);
    legs.push({ root, side, front: front < 0 ? -1 : 1 });
  }
  const tailRoot = kit.group(motion, 'tail', [0, bodyY + 0.06, len * 0.48]);
  const tailEnd = [0, 0.1 * p.tailLength, 0.9 * p.tailLength];
  kit.beam(tailRoot, 'tail-segment', [0, 0, 0], tailEnd, w * 0.3, c.body);
  if (p.tailTip === 'club') kit.box(tailRoot, 'tail-club', [w * 0.42, w * 0.42, w * 0.42], tailEnd, c.accent);
  else if (p.tailTip === 'arrow') kit.prism(tailRoot, 'tail-arrow', [[-0.5, 0], [0.5, 0], [0, 1]],
    [w * 0.6, 0.24 * p.tailLength, 0.05], tailEnd, c.membrane);
  for (let i = 0; i < p.spikeCount; i++) kit.box(body, 'back-spike',
    [SPIKE, SPIKE * 2.2, SPIKE], [0, 0.28, (i / Math.max(1, p.spikeCount - 1) - 0.5) * len * 0.7], c.accent);
  const wings = p.wings ? wingPair(kit, motion, p, [w * 0.5, bodyY + 0.22, -0.05], 0.85 * p.wingSpan, c.membrane) : [];

  return { body, head, neck, jaw, legs, wings, tail: tailRoot,
    animate({ t, a, wave, moving, special }) {
      if (wings.length && (moving || !p.dragonLegs)) wings.forEach(({ root, side }) => {
        root.rotation.z = side * (0.12 + (moving ? Math.sin(t * 3) * 0.5 : Math.sin(t) * 0.08) * a);
      });
      legs.forEach(({ root, side, front }) => {
        root.rotation.x = moving && !(p.wings && p.dragonLegs === 'two')
          ? Math.sin(t * 3 + (side * front < 0 ? Math.PI : 0)) * 0.42 * a : 0;
      });
      tailRoot.rotation.y = wave * 0.18 * a;
      neck.rotation.x = special ? -0.3 * a : Math.sin(t * 1.5) * 0.04 * a;
      jaw.rotation.x = JAW_OPEN + (special ? 0.4 * a : 0);
      return moving && p.wings ? (0.05 + Math.sin(t * 3) * 0.04) * a : 0;
    },
  };
}

export function buildSimpleHumanoid(kit, motion, p) {
  const c = p.colors, w = 0.4 * p.bodyWidth;
  const legLength = 0.42 * p.legLength, armLength = 0.42 * p.armLength;
  const torsoH = 0.44, limb = LIMB * p.limbThickness;
  const body = kit.group(motion, 'hips', [0, legLength, 0]);
  const chest = kit.group(body, 'chest');
  chest.rotation.x = p.hunch;
  kit.box(chest, 'torso', [w, torsoH, w * 0.6], [0, torsoH / 2, 0], p.species === 'skeleton' ? c.bone : c.body);
  if (p.armor !== 'none') kit.box(chest, 'armor-plate', [w * 1.1, torsoH * 0.6, w * 0.7],
    [0, torsoH * 0.6, 0], c.armor);
  const headH = 0.26 * p.headScale;
  const head = kit.group(chest, 'head', [0, torsoH + headH * 0.55, 0]);
  kit.box(head, 'head-block', [headH * 0.86, headH, headH * 0.86], [0, 0, 0],
    p.species === 'skeleton' ? c.bone : c.body);
  const jaw = jawBlock(kit, head, headH * 0.86, headH, headH * 0.86, c.mouth);
  hornPair(kit, head, p, headH * 0.86, headH, c.accent);
  if (p.species === 'werewolf') kit.box(head, 'snout', [headH * 0.5, headH * 0.4, headH * 0.7],
    [0, -headH * 0.12, -headH * 0.7], c.body);

  const legs = [], arms = [];
  for (const side of [-1, 1]) {
    const label = side < 0 ? 'left' : 'right';
    const hip = kit.group(body, `${label}-hip`, [side * w * 0.26, 0, 0]);
    kit.box(hip, 'thigh', [limb, legLength * 0.55, limb], [0, -legLength * 0.275, 0],
      p.species === 'skeleton' ? c.bone : c.clothing);
    const knee = kit.group(hip, `${label}-knee`, [0, -legLength * 0.55, 0]);
    kit.box(knee, 'shin', [limb * 0.9, legLength * 0.45, limb * 0.9], [0, -legLength * 0.225, 0],
      p.species === 'skeleton' ? c.bone : c.clothing);
    legs.push({ root: hip, knee, side });
    const shoulder = kit.group(chest, `${label}-shoulder`, [side * (w / 2 + limb * 0.6), torsoH * 0.86, 0]);
    kit.box(shoulder, 'upper-arm', [limb, armLength * 0.55, limb], [0, -armLength * 0.275, 0],
      p.species === 'skeleton' ? c.bone : c.body);
    const elbow = kit.group(shoulder, `${label}-elbow`, [0, -armLength * 0.55, 0]);
    kit.box(elbow, 'forearm', [limb * 0.9, armLength * 0.45, limb * 0.9], [0, -armLength * 0.225, 0],
      p.species === 'skeleton' ? c.bone : c.body);
    const hand = kit.group(elbow, `${label}-hand`, [0, -armLength * 0.45, 0]);
    kit.box(hand, 'hand', [limb * 1.1, limb * 1.1, limb * 1.1], [0, 0, 0],
      p.species === 'skeleton' ? c.bone : c.body);
    arms.push({ root: shoulder, elbow, hand, side });
  }
  let cloak = null;
  if (p.cloak) {
    cloak = kit.group(chest, 'cloak', [0, torsoH * 0.9, w * 0.34]);
    kit.box(cloak, 'cloak-panel', [w * 1.1 * p.cloakWidth, torsoH * 1.6 * p.cloakLength, 0.05],
      [0, -torsoH * 0.8 * p.cloakLength, 0], c.clothing);
  }
  const tailRoot = ['werewolf', 'demon'].includes(p.species)
    ? kit.group(motion, 'tail', [0, legLength + torsoH * 0.2, w * 0.34]) : null;
  if (tailRoot) kit.beam(tailRoot, 'tail-segment', [0, 0, 0],
    [0, -0.1 * p.tailLength, 0.55 * p.tailLength], limb * 0.7, c.body);
  for (let i = 0; i < p.spikeCount; i++) kit.box(chest, 'back-spike', [SPIKE, SPIKE * 1.8, SPIKE],
    [0, torsoH * (0.3 + i * 0.7 / Math.max(1, p.spikeCount)), w * 0.32], c.accent);
  const wings = p.species === 'demon' && p.wings
    ? wingPair(kit, chest, p, [w * 0.4, torsoH * 0.8, w * 0.3], 0.7 * p.wingSpan, c.membrane) : [];

  return { body, head, jaw, chest, legs, arms, wings, tail: tailRoot, cloak,
    animate({ t, a, wave, moving, special }) {
      const swing = moving ? 0.4 * a : 0.05 * a;
      legs.forEach(({ root, knee, side }, i) => {
        const phase = Math.sin(t * 2.6 + i * Math.PI);
        root.rotation.x = p.hunch * 0.5 + (moving ? phase * swing : 0);
        knee.rotation.x = moving ? -Math.max(0, -phase) * swing : -0.1;
      });
      arms.forEach(({ root, elbow, side }, i) => {
        root.rotation.x = special ? -1.5 * a : moving ? -Math.sin(t * 2.6 + i * Math.PI) * swing : 0;
        root.rotation.z = side * (special ? 0.4 : 0.06) * a;
        elbow.rotation.x = special ? 0.5 * a : 0.2;
      });
      chest.rotation.x = p.hunch - (special ? 0.15 * a : 0);
      chest.rotation.y = moving ? wave * 0.06 * a : 0;
      head.rotation.x = special ? -0.35 * a : Math.sin(t * 1.4) * 0.03 * a;
      jaw.rotation.x = JAW_OPEN + (special ? 0.35 * a : 0);
      if (tailRoot) tailRoot.rotation.y = wave * 0.2 * a;
      if (cloak) cloak.rotation.x = special ? -0.3 * a : Math.sin(t * 1.2) * 0.04 * a;
      return p.species === 'vampire' && !moving ? 0 : 0;
    },
  };
}

export function buildSimpleSlime(kit, motion, p) {
  const c = p.colors, w = 0.62 * p.bodyWidth, h = 0.5;
  const body = kit.group(motion, 'slime-body', [0, h * 0.5, 0]);
  const size = [w, h, w];
  if (p.slimeShape === 'cube') kit.box(body, 'gel-block', size, [0, 0, 0], c.body);
  else if (p.slimeShape === 'drop') kit.frustum(body, 'gel-drop', size, [0, 0, 0], c.body, 0.55);
  else kit.sphere(body, 'gel-dome', size, [0, 0, 0], c.body);
  const face = kit.group(body, 'face', [0, h * 0.12, -w * 0.42]);
  for (const side of [-1, 1]) kit.box(face, 'eye', [w * 0.11, h * 0.13, 0.04],
    [side * w * 0.17, 0, 0], c.eye);
  const core = p.core ? kit.group(body, 'gel-core', [0, -h * 0.05, 0]) : null;
  if (core) kit.box(core, 'core-block', [w * 0.3, h * 0.3, w * 0.3], [0, 0, 0], c.core);
  if (p.crown) kit.box(body, 'crown', [w * 0.4, h * 0.16, w * 0.4], [0, h * 0.52, 0], c.accent);
  return { body, head: face, core,
    animate({ t, a, moving, special }) {
      const bounce = moving ? Math.abs(Math.sin(t * 2.4)) : Math.sin(t * 1.6) * 0.5 + 0.5;
      const squash = special ? -0.28 * a : (moving ? -0.12 : -0.04) * bounce * a;
      body.scale.set(1 / Math.sqrt(1 + squash), 1 + squash, 1 / Math.sqrt(1 + squash));
      if (core) core.rotation.y = t * 0.6 * a;
      return moving ? bounce * 0.22 * a : 0;
    },
  };
}

export function buildSimpleElemental(kit, motion, p) {
  const c = p.colors, w = 0.6 * p.bodyWidth;
  const body = kit.group(motion, 'element-body'), fragments = [], limbs = [];
  const core = kit.group(body, 'energy-core', [0, 0.62, -w * 0.2]);
  kit.box(core, 'core-block', [0.22, 0.28, 0.22], [0, 0, 0], c.core);
  let head;
  if (p.elementForm === 'golem') {
    kit.box(body, 'stone-chest', [w, 0.46, w * 0.62], [0, 0.68, 0], c.body);
    head = kit.group(body, 'stone-head', [0, 1.02, 0]);
    kit.box(head, 'head-stone', [0.26 * p.headScale, 0.26 * p.headScale, 0.24 * p.headScale], [0, 0, 0], c.body);
    for (const side of [-1, 1]) {
      const arm = kit.group(body, 'stone-arm', [side * w * 0.62, 0.78, 0]);
      kit.box(arm, 'arm-block', [0.22, 0.5, 0.22], [0, -0.2, 0], c.body);
      const leg = kit.group(body, 'stone-leg', [side * w * 0.28, 0.22, 0]);
      kit.box(leg, 'leg-block', [w * 0.36, 0.44, w * 0.5], [0, -0.14, 0], c.accent);
      limbs.push({ arm, leg, side });
    }
  } else if (p.elementForm === 'vortex') {
    for (let i = 0; i < 5; i++) {
      const level = kit.group(body, 'vortex-layer', [0, 0.18 + i * 0.2, 0]);
      kit.cylinder(level, 'vortex-band', w * (0.18 + i * 0.08), 0.2, [0, 0, 0], i % 2 ? c.body : c.accent, 1.2);
      fragments.push({ root: level, phase: i * 0.9, kind: 'layer' });
    }
    head = kit.group(body, 'vortex-face', [0, 0.94, -w * 0.5]);
    core.position.set(0, 0.9, -w * 0.42);
  } else {
    kit.box(body, 'main-crystal', [w * 0.6, 0.86, w * 0.55], [0, 0.55, 0], c.body);
    head = kit.group(body, 'crystal-head', [0, 0.9, 0]);
    core.position.set(0, 0.55, -w * 0.34);
    for (const side of [-1, 1]) {
      const crystal = kit.group(body, 'crystal-branch', [side * w * 0.32, 0.32, 0]);
      crystal.rotation.z = -side * 0.32;
      kit.box(crystal, 'long-crystal', [w * 0.22, 0.7 * p.fragmentScale, w * 0.22], [0, 0.2, 0], c.belly);
      fragments.push({ root: crystal, phase: side, kind: 'crystal' });
    }
  }
  const orbit = kit.group(body, 'fragment-orbit', [0, 0.58, 0]);
  for (let i = 0; i < p.shardCount; i++) {
    const angle = i * Math.PI * 2 / p.shardCount, radius = w * 0.78 * p.orbitRadius;
    const shard = kit.group(orbit, 'orbit-shard',
      [Math.cos(angle) * radius, ((i % 3) - 1) * 0.26, Math.sin(angle) * radius]);
    const s = 0.11 * p.fragmentScale;
    kit.box(shard, 'fragment', [s, s * (p.elementForm === 'crystal' ? 2.4 : 1.3), s], [0, 0, 0],
      i % 2 ? c.belly : c.accent);
    fragments.push({ root: shard, phase: angle, kind: 'shard' });
  }
  return { body, head, core, orbit, fragments, limbs,
    animate({ t, a, wave, moving, special }) {
      orbit.rotation.y = t * (moving ? 0.85 : 0.35) * a;
      core.rotation.y = t * 0.7 * a;
      core.scale.setScalar(1 + (special ? 0.22 + wave * 0.14 : Math.sin(t * 2) * 0.05) * a);
      fragments.forEach(({ root, phase, kind }) => {
        root.position.y += Math.sin(t * 2 + phase) * 0.025 * a;
        if (kind === 'layer') root.rotation.y += t * (0.22 + phase * 0.07) * a;
        else root.rotation.y += t * 0.4 * a;
        if (special && kind === 'shard') {
          root.position.x *= 1 + (0.12 + wave * 0.08) * a; root.position.z *= 1 + (0.12 + wave * 0.08) * a;
        }
      });
      limbs.forEach(({ arm, leg, side }) => {
        arm.rotation.z += side * (special ? 0.65 : 0.08) * a;
        if (leg && moving) leg.rotation.x += Math.sin(t * 3 + side * Math.PI / 2) * 0.2 * a;
      });
      return (0.08 + (Math.sin(t * 2) + 1) * (moving ? 0.06 : 0.025)) * a;
    },
  };
}

// Compatibility exports: the simplified species parts replace the originals
// under this module's historical name, and keep the original builder names.
export { buildSimpleDragon as buildDragon, buildSimpleHumanoid as buildHumanoid,
  buildSimpleSlime as buildSlime, buildSimpleElemental as buildElemental };