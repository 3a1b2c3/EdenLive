import { Group, Color } from 'three';
import { createPrimitiveKit, freezeConfig, normalizeFactoryOptions,
  seededRandom, measure } from './VisualFactoryUtils.js';
import { CREATURE_ACTIONS, CREATURE_ACTION_SCHEMA, installCreatureActions } from './CreatureActions.js';
import { buildSimpleDragon, buildSimpleHumanoid, buildSimpleSlime,
  buildSimpleElemental } from './FantasyCreatureParts.js';

// Simplified fantasy creature: the same nine species and the same actions, drawn
// with body blocks, beam limbs and flat wing panels. Scales, ribs, rags, fangs,
// claws, bubbles, pattern seeds and per-part thickness sliders are gone.
// The Simple-prefixed exports are canonical; the unprefixed aliases at the end
// keep this module's historical name and consumers unchanged.
export const SIMPLE_FANTASY_MOTIONS = freezeConfig({ still: 'still pose', idle: 'idle',
  move: 'move (per species)', action: 'signature action (per species)',
  ...Object.fromEntries(Object.entries(CREATURE_ACTIONS).map(([id, spec]) => [id, spec.label])) });

export const SIMPLE_FANTASY_PRESETS = freezeConfig({
  dragon: { species: 'dragon', heightScale: 2.2, bodyLength: 1.15, hornStyle: 'swept', spikeCount: 5, wings: true,
    colors: { body: '#638f78', belly: '#d5c994', membrane: '#b68260' } },
  wyvern: { species: 'dragon', heightScale: 1.65, dragonLegs: 'two', bodyWidth: 0.82, neckLength: 1.3, wingSpan: 1.4, hornStyle: 'spires',
    colors: { body: '#697d9d', belly: '#bdc9c7', membrane: '#8f88b1' } },
  drake: { species: 'dragon', heightScale: 1.05, wings: false, bodyLength: 1.4, bodyWidth: 1.4, legLength: 0.7, tailTip: 'club', spikeCount: 7,
    colors: { body: '#ac785b', belly: '#e2b882', accent: '#6c8574' } },
  hatchling: { species: 'dragon', heightScale: 0.55, headScale: 1.4, bodyLength: 0.75, neckLength: 0.65, wingSpan: 0.65, tailLength: 0.65, hornSize: 0.55, spikeCount: 2,
    colors: { body: '#86a9a0', belly: '#e8d8a5', membrane: '#d5a37f' } },
  zombie: { species: 'zombie', heightScale: 0.95, hunch: 0.24, armLength: 1.2,
    colors: { body: '#99a781', clothing: '#7e8c96', accent: '#bea477', eye: '#dbd191' } },
  slime: { species: 'slime', heightScale: 0.38, slimeShape: 'dome',
    colors: { body: '#78b698', belly: '#a9d5b6', core: '#e6d896', eye: '#284e49' } },
  cubeSlime: { species: 'slime', heightScale: 0.65, slimeShape: 'cube', bodyWidth: 1.2, crown: true,
    colors: { body: '#88acc1', belly: '#c1d9d8', core: '#e0b788', accent: '#d6b262' } },
  skeleton: { species: 'skeleton', heightScale: 1, bodyWidth: 0.86,
    colors: { body: '#e1dac1', belly: '#b7b29d', eye: '#718eb3' } },
  skeletonGuard: { species: 'skeleton', heightScale: 1.15, armor: 'plate', cloak: true, cloakLength: 0.65,
    colors: { body: '#d5d6c5', armor: '#708a91', clothing: '#88616a', eye: '#8cbcb0' } },
  orc: { species: 'orc', heightScale: 1.25, bodyWidth: 1.35, limbThickness: 1.25, armor: 'scrap', hunch: 0.08,
    colors: { body: '#829661', belly: '#b5b67e', clothing: '#886047', armor: '#89928b', accent: '#c09b68' } },
  vampire: { species: 'vampire', heightScale: 1.1, bodyWidth: 0.85, legLength: 1.12, cloak: true, cloakWidth: 1.25, cloakLength: 1.1,
    colors: { body: '#d2c7c6', clothing: '#465060', membrane: '#995d6d', accent: '#d2b576', eye: '#ba665f' } },
  werewolf: { species: 'werewolf', heightScale: 1.3, bodyWidth: 1.25, armLength: 1.25, hunch: 0.22, spikeCount: 5,
    colors: { body: '#7f858b', belly: '#b8bcb0', clothing: '#696776', accent: '#555f69', eye: '#e1bd72' } },
  demon: { species: 'demon', heightScale: 1.55, bodyWidth: 1.15, hornStyle: 'ram', hornSize: 1.25, wings: true, wingSpan: 1.05, tailTip: 'arrow', spikeCount: 3,
    colors: { body: '#b27670', belly: '#cba591', membrane: '#865a70', accent: '#d0b184', eye: '#efd79a' } },
  imp: { species: 'demon', heightScale: 0.5, headScale: 1.35, bodyWidth: 0.8, legLength: 0.7, wingSpan: 0.75, hornStyle: 'spires', hornSize: 0.65, spikeCount: 0,
    colors: { body: '#ab9270', belly: '#dcca98', membrane: '#818d9e', eye: '#d2dfac' } },
  earthElemental: { species: 'elemental', heightScale: 1.65, elementForm: 'golem', bodyWidth: 1.3, fragmentScale: 1.2,
    colors: { body: '#899589', belly: '#b0bda1', core: '#d8c277', accent: '#687f72' } },
  fireElemental: { species: 'elemental', heightScale: 1.2, elementForm: 'vortex', shardCount: 6, orbitRadius: 0.8,
    colors: { body: '#d78d61', belly: '#e6b877', core: '#f3d995', accent: '#ad6559' } },
  iceElemental: { species: 'elemental', heightScale: 1.4, elementForm: 'crystal', shardCount: 7,
    colors: { body: '#8fb8c6', belly: '#c2d8d4', core: '#e2dfae', accent: '#728faa' } },
  stormElemental: { species: 'elemental', heightScale: 1.1, elementForm: 'vortex', shardCount: 9, orbitRadius: 1.25, fragmentScale: 0.85,
    colors: { body: '#a5a4bc', belly: '#cfccd4', core: '#dfd496', accent: '#788ca5' } },
});

const species = (...values) => p => values.includes(p.species);
const humanoid = p => !['dragon', 'slime', 'elemental'].includes(p.species);
const winged = p => ['dragon', 'demon'].includes(p.species) && p.wings;
const horned = species('dragon', 'orc', 'demon');
const number = (group, label, value, min, max, step = 0.05, when) => ({ group, label, default: value, min, max, step, when });
const choice = (group, label, value, choices, when) => ({ group, label, default: value, choices, when });
const flag = (group, label, value, when) => ({ group, label, default: value, when });
export const SIMPLE_FANTASY_SCHEMA = freezeConfig({
  referenceHeight: number('size & build', 'Character reference height', 2.2, 0.8, 3.2),
  heightScale: number('size & build', 'height scale vs character', 1, 0.15, 4),
  bodyWidth: number('size & build', 'body width', 1, 0.65, 1.6),
  headScale: number('size & build', 'head scale', 1, 0.65, 1.4, 0.05, p => p.species !== 'slime' && (p.species !== 'elemental' || p.elementForm === 'golem')),
  legLength: number('limbs & pose', 'leg length', 1, 0.65, 1.4, 0.05, p => humanoid(p) || p.species === 'dragon'),
  armLength: number('limbs & pose', 'arm length', 1, 0.7, 1.4, 0.05, humanoid),
  limbThickness: number('limbs & pose', 'limb thickness', 1, 0.6, 1.6, 0.05, p => humanoid(p) || p.species === 'dragon'),
  hunch: number('limbs & pose', 'hunch', 0.05, 0, 0.45, 0.05, humanoid),
  hornStyle: choice('head & spikes', 'horn style', 'none', { none: 'none', swept: 'swept back', spires: 'upright spikes', ram: 'ram curl' }, horned),
  hornSize: number('head & spikes', 'horn size', 1, 0.45, 1.7, 0.05, p => horned(p) && p.hornStyle !== 'none'),
  spikeCount: number('head & spikes', 'back spike count', 4, 0, 7, 1, species('dragon', 'werewolf', 'demon')),
  dragonLegs: choice('dragon build', 'leg count', 'four', { four: 'four legs', two: 'two legs (wyvern)' }, species('dragon')),
  bodyLength: number('dragon build', 'body length', 1, 0.65, 1.7, 0.05, species('dragon')),
  neckLength: number('dragon build', 'neck length', 1, 0.5, 1.7, 0.05, species('dragon')),
  wings: flag('wings & tail', 'bat wings', true, species('dragon', 'demon')),
  wingSpan: number('wings & tail', 'wing span', 1, 0.6, 1.8, 0.05, winged),
  tailLength: number('wings & tail', 'tail length', 1, 0.4, 1.8, 0.05, species('dragon', 'demon', 'werewolf')),
  tailTip: choice('wings & tail', 'tail tip', 'point', { point: 'point', club: 'club', arrow: 'arrow' }, species('dragon', 'demon')),
  armor: choice('clothing', 'armor', 'none', { none: 'none', scrap: 'scrap armor', plate: 'solid plate' }, species('zombie', 'skeleton', 'orc', 'demon')),
  cloak: flag('clothing', 'cloak', false, species('skeleton', 'vampire', 'demon')),
  cloakLength: number('clothing', 'cloak length', 1, 0.5, 1.2, 0.05, p => ['skeleton', 'vampire', 'demon'].includes(p.species) && p.cloak),
  cloakWidth: number('clothing', 'cloak spread', 1, 0.7, 1.6, 0.05, p => ['skeleton', 'vampire', 'demon'].includes(p.species) && p.cloak),
  slimeShape: choice('slime & elemental', 'slime shape', 'dome', { dome: 'dome', drop: 'drop', cube: 'cube' }, species('slime')),
  core: flag('slime & elemental', 'visible gel core', true, species('slime')),
  crown: flag('slime & elemental', 'slime crown', false, species('slime')),
  elementForm: choice('slime & elemental', 'elemental form', 'golem', { golem: 'stone golem', vortex: 'vortex cluster', crystal: 'floating crystals' }, species('elemental')),
  shardCount: number('slime & elemental', 'orbit shard count', 6, 3, 10, 1, species('elemental')),
  fragmentScale: number('slime & elemental', 'fragment scale', 1, 0.6, 1.5, 0.05, species('elemental')),
  orbitRadius: number('slime & elemental', 'orbit radius', 1, 0.6, 1.5, 0.05, species('elemental')),
  motionSpeed: number('motion', 'species motion speed', 1, 0.2, 3),
  motionAmount: number('motion', 'species motion amount', 1, 0, 1.5),
  ...CREATURE_ACTION_SCHEMA,
});

const PALETTE = { body: '#869887', belly: '#c8c7a1', clothing: '#737b8d', armor: '#7e9394',
  membrane: '#9c6c7b', bone: '#e6d9b8', accent: '#d2b075', core: '#e0d295', eye: '#d7c480', mouth: '#3f4952' };

export function normalizeSimpleFantasyCreatureOptions(options = {}) {
  const p = normalizeFactoryOptions(options, SIMPLE_FANTASY_PRESETS, SIMPLE_FANTASY_SCHEMA, PALETTE);
  const type = SIMPLE_FANTASY_PRESETS[p.preset].species;
  if (options.species !== undefined && options.species !== type) throw new RangeError('species must match the selected fantasy preset');
  return freezeConfig({ ...p, species: type });
}

export function randomSimpleFantasyCreatureOptions(seed = 1, overrides = {}) {
  const r = seededRandom(seed), pick = a => a[Math.floor(r() * a.length)];
  for (let i = 0; i < 5; i++) r();
  const preset = overrides.preset ?? pick(Object.keys(SIMPLE_FANTASY_PRESETS));
  const base = normalizeSimpleFantasyCreatureOptions({ preset }), options = { ...base };
  // Keep species, characteristic anatomy and palette. Vary applicable features only.
  for (const [key, f] of Object.entries(SIMPLE_FANTASY_SCHEMA)) {
    if (f.randomize === false || f.when && !f.when(base)
      || ['referenceHeight', 'motionSpeed', 'motionAmount'].includes(key)) continue;
    if (f.choices) {
      if (['slimeShape', 'tailTip'].includes(key)) options[key] = pick(Object.keys(f.choices));
    } else if (typeof f.default === 'boolean') {
      if (['crown', 'core'].includes(key)) options[key] = r() > 0.4;
    } else {
      const value = base[key] === 0 ? f.min + r() * (f.max - f.min) * 0.4 : base[key] * (0.72 + r() * 0.56);
      options[key] = Math.max(f.min, Math.min(f.max, Math.round(value / f.step) * f.step));
    }
  }
  const hueShift = (r() - 0.5) * 0.12, lightShift = (r() - 0.5) * 0.12;
  const colors = Object.fromEntries(Object.entries(base.colors).map(([key, value]) => {
    const color = new Color(value).offsetHSL(key === 'bone' || key === 'mouth' ? 0 : hueShift, 0, lightShift);
    return [key, `#${color.getHexString()}`];
  }));
  return normalizeSimpleFantasyCreatureOptions({ ...options, ...overrides, colors: { ...colors, ...overrides.colors } });
}

export function simpleFantasyMotionLabels(p) {
  if (!p) return SIMPLE_FANTASY_MOTIONS;
  const labels = { dragon: [p.wings ? 'winged flight' : 'four-leg walk', 'rearing roar'], zombie: ['shambling walk', 'arm grab'],
    slime: ['bounce', 'charge squash'], skeleton: ['bone walk', 'arm swing'], orc: ['heavy walk', 'arm raise roar'],
    vampire: ['hover glide', 'cloak cast'], werewolf: ['loping run', 'head-up howl'],
    demon: [p.wings ? 'wing hover' : 'heavy walk', 'wing threat'], elemental: ['drift orbit', 'core surge'] }[p.species];
  return { ...SIMPLE_FANTASY_MOTIONS, move: labels[0], action: labels[1] };
}

/** Simplified fantasy creature. +Y up, -Z forward, neutral height = referenceHeight * heightScale. */
export function buildSimpleFantasyCreatureVisual(options = {}) {
  const p = normalizeSimpleFantasyCreatureOptions(options), kit = createPrimitiveKit(), mesh = new Group();
  mesh.name = `simple-fantasy-${p.preset}`;
  const scaleRoot = kit.group(mesh, 'character-relative-scale');
  const motion = kit.group(scaleRoot, 'creature-motion');
  const builder = p.species === 'dragon' ? buildSimpleDragon : p.species === 'slime' ? buildSimpleSlime
    : p.species === 'elemental' ? buildSimpleElemental : buildSimpleHumanoid;
  const rig = builder(kit, motion, p);
  const native = measure(motion), targetHeight = p.referenceHeight * p.heightScale;
  motion.position.y -= native.bounds.min.y;
  const scale = targetHeight / native.dimensions.y;
  scaleRoot.scale.setScalar(scale);
  const api = { mesh, params: p, rig: { motion, ...rig }, ...measure(mesh),
    scaleInfo: freezeConfig({ referenceHeight: p.referenceHeight, heightScale: p.heightScale, neutralHeight: targetHeight }),
    attachments: { body: rig.body, head: rig.head, mouth: rig.jaw,
      leftHand: rig.arms?.[0]?.hand, rightHand: rig.arms?.[1]?.hand, tail: rig.tail, core: rig.core },
    getStats: () => kit.stats(mesh), dispose: () => kit.dispose(mesh),
  };
  const family = ['dragon', 'slime', 'elemental'].includes(p.species) ? p.species : 'humanoid';
  return installCreatureActions(api, kit, { motion, rig, family, scale, labels: SIMPLE_FANTASY_MOTIONS,
    animate(action, seconds) {
      if (p.motionAmount === 0) return 0;
      const t = seconds * p.motionSpeed, a = p.motionAmount;
      return rig.animate({ t, a, wave: Math.sin(t * 3), moving: action === 'move', special: action === 'action' });
    },
  });
}

// Species label map inlined from the detailed factory (labels terse).
export const SIMPLE_FANTASY_SPECIES = freezeConfig({ dragon: 'dragon', zombie: 'zombie', slime: 'slime',
  skeleton: 'skeleton', orc: 'orc', vampire: 'vampire', werewolf: 'werewolf', demon: 'demon', elemental: 'elemental' });

// Compatibility exports: the simplified factory replaces the original under
// this module's historical name, and keeps the original consumer surface.
export { SIMPLE_FANTASY_MOTIONS as FANTASY_MOTIONS };
export { SIMPLE_FANTASY_SPECIES as FANTASY_SPECIES };
export { SIMPLE_FANTASY_PRESETS as FANTASY_PRESETS };
export { SIMPLE_FANTASY_SCHEMA as FANTASY_SCHEMA };
export { normalizeSimpleFantasyCreatureOptions as normalizeFantasyCreatureOptions };
export { randomSimpleFantasyCreatureOptions as randomFantasyCreatureOptions };
export { simpleFantasyMotionLabels as fantasyMotionLabels };
export { buildSimpleFantasyCreatureVisual as createFantasyCreatureVisual, buildSimpleFantasyCreatureVisual as buildFantasyCreatureVisual };