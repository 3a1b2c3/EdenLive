import { Box3, Group, Vector3 } from 'three';
import { choiceOption as choice, freezeConfig, objectOption, seededRandom,
  normalizeFactoryOptions, createPrimitiveKit, measure } from './VisualFactoryUtils.js';

// API, parameter ranges and copy dependencies: docs/api/character-visual-factory.md.
// Simplified prototype presentation: same options / setPose contract, box-and-cylinder body.

const CHARACTER_FIREARMS = Object.freeze(['rifle', 'smg', 'shotgun', 'sniperRifle', 'machineGun', 'pistol']);
export const CHARACTER_MOTIONS = Object.freeze(['idle', 'walk', 'run', 'jump', 'crouch', 'slide']);
export const CHARACTER_PRESETS = freezeConfig({
  runner: { height: 2.2, build: 1, torso: 'tapered', hat: 'cap', backpack: true },
  child: { height: 1.3, build: 0.88, headScale: 1.3, legRatio: 0.38, hat: 'beanie', hair: 'bob' },
  tall: { height: 2.85, build: 0.66, legRatio: 0.56, headScale: 0.8, torso: 'box', hair: 'crop' },
  stocky: { height: 1.7, build: 1.42, depth: 1.35, legRatio: 0.39, torso: 'round', hat: 'brim' },
  heavy: { height: 2.15, build: 1.7, depth: 1.5, legRatio: 0.39, torso: 'round', hair: 'crop' },
  sprinter: { height: 2.4, build: 0.83, shoulders: 1.3, legRatio: 0.53, limbThickness: 0.85, hair: 'mohawk' },
  worker: { height: 2.12, build: 1.2, hat: 'helmet', torso: 'box', colors: { top: '#ffc253', accent: '#36c7bf' } },
  hiker: { height: 2.05, build: 0.95, hat: 'brim', backpack: true, hair: 'ponytail', colors: { top: '#75af7b', accent: '#efaa56' } },
  commuter: { height: 2.35, build: 0.85, torso: 'coat', hair: 'bob', colors: { top: '#7186b5', accent: '#e8ae90' } },
  blocky: { height: 1.85, build: 1.15, headShape: 'box', torso: 'box', hat: 'none', hair: 'mohawk' },
  mage: { height: 2.25, build: 0.86, torso: 'robe', sleeves: 'flared', hat: 'wizard', beard: 'long',
    belt: 'belt', cape: 'long', weapon: 'staff', offhand: 'book', emblem: 'gem',
    colors: { top: '#737cae', cloak: '#515c8a', accent: '#ebc476', hair: '#e1ddcd', shoes: '#535364' } },
  warrior: { height: 2.35, build: 1.2, shoulders: 1.18, torso: 'tunic', armor: 'leather',
    pauldrons: 'both', bracers: true, bootHeight: 0.72, belt: 'belt', weapon: 'sword', offhand: 'roundShield', emblem: 'chevron',
    colors: { top: '#ad6253', pants: '#574c44', shoes: '#6c5141', accent: '#e8be76', cloak: '#a05e50' } },
  rogue: { height: 2.1, build: 0.78, legRatio: 0.51, torso: 'tunic', hat: 'hood', faceMask: true,
    armor: 'leather', bracers: true, belt: 'sash', pouches: 3, bootHeight: 0.8, cape: 'split', capeLength: 0.42,
    weapon: 'dagger', offhand: 'dagger',
    colors: { top: '#465568', pants: '#303c4c', cloak: '#364352', leather: '#66544b', shoes: '#414750', accent: '#9fb9b1' } },
  soldier: { height: 2.2, build: 1.12, torso: 'tunic', hair: 'none', hat: 'greatHelm', armor: 'plate',
    pauldrons: 'both', bracers: true, bootHeight: 0.82, belt: 'belt', tabard: true, emblem: 'chevron',
    weapon: 'spear', offhand: 'kiteShield',
    colors: { top: '#6b8497', armor: '#a8b7bd', cloak: '#5b758c', accent: '#dfbf7b', shoes: '#63717e' } },
  paladin: { height: 2.5, build: 1.18, shoulders: 1.25, torso: 'tunic', hair: 'none', hat: 'greatHelm', crest: 'plume',
    armor: 'plate', armorThickness: 1.3, pauldrons: 'both', pauldronSize: 1.4, bracers: true, bootHeight: 0.9,
    cape: 'long', belt: 'belt', tabard: true, emblem: 'sun', weapon: 'hammer', offhand: 'kiteShield',
    colors: { top: '#e4debf', armor: '#bcbda5', accent: '#d8af63', cloak: '#8f5b62', shoes: '#8e978f' } },
  ranger: { height: 2.25, build: 0.84, torso: 'tunic', hat: 'hood', hair: 'ponytail', armor: 'leather',
    cape: 'short', bracers: true, belt: 'belt', pouches: 2, bootHeight: 0.65, weapon: 'bow', quiver: true,
    colors: { top: '#6e9073', cloak: '#4f7664', pants: '#535d49', shoes: '#705840', accent: '#d6bf83' } },
  cleric: { height: 2.2, build: 0.94, torso: 'robe', sleeves: 'flared', hat: 'hood',
    cape: 'short', belt: 'sash', emblem: 'cross', weapon: 'staff', staffTop: 'cross', offhand: 'book',
    colors: { top: '#e7dfc6', cloak: '#b8cab8', accent: '#d3a45d', shoes: '#817460', magic: '#dfeec8' } },
  barbarian: { height: 2.6, build: 1.45, shoulders: 1.3, limbThickness: 1.25, torso: 'box',
    hat: 'openHelm', crest: 'horns', beard: 'short', armor: 'leather', pauldrons: 'left', pauldronSize: 1.5,
    bracers: true, bootHeight: 0.55, belt: 'belt', weapon: 'axe', weaponScale: 1.2,
    colors: { top: '#a27c58', leather: '#795643', armor: '#8b9995', accent: '#d8bd84', pants: '#605040', shoes: '#796044' } },
  monk: { height: 2.1, build: 0.86, torso: 'robe', robeLength: 0.55, robeFlare: 1.1, sleeves: 'long',
    hair: 'none', belt: 'sash', bracers: true, emblem: 'sun', bootHeight: 0.3,
    colors: { top: '#d89d55', pants: '#795c46', accent: '#9d5e48', shoes: '#d0bc90', leather: '#a7774b' } },
  necromancer: { height: 2.4, build: 0.72, torso: 'robe', sleeves: 'flared', hat: 'hood', hair: 'none',
    robeLength: 0.94, cape: 'split', capeLength: 0.7, belt: 'belt', pauldrons: 'both', emblem: 'gem',
    weapon: 'staff', staffTop: 'fork', offhand: 'orb',
    colors: { top: '#54536d', cloak: '#373d53', armor: '#bbb9a0', accent: '#9dccb7', magic: '#8cdbc0', shoes: '#414359' } },
  modernSoldier: { height: 2.25, build: 1.08, torso: 'box', sleeves: 'long', uniform: 'tactical',
    uniformPattern: 'camo', hat: 'combatHelmet', hair: 'none', armor: 'tactical', vestPouches: 3,
    gloves: true, kneePads: true, bootHeight: 0.7, belt: 'belt', pouches: 2,
    weapon: 'rifle', holdPose: 'twoHand', gunSight: 'reflex',
    colors: { top: '#7e8a62', pants: '#637553', armor: '#59684f', accent: '#b9bd87', equipment: '#3e4c49', shoes: '#515b49', leather: '#666950' } },
  commando: { height: 2.15, build: 0.95, torso: 'tapered', sleeves: 'long', uniform: 'tactical',
    uniformPattern: 'panels', hat: 'beret', eyewear: 'goggles', faceMask: true, armor: 'tactical',
    gloves: true, kneePads: true, bootHeight: 0.8, belt: 'belt', pouches: 3,
    weapon: 'smg', holdPose: 'twoHand', gunSight: 'reflex', gunStock: 'folded',
    colors: { top: '#526777', pants: '#3d505e', armor: '#40535a', accent: '#a0b7b1', cloak: '#45585e', equipment: '#374951', shoes: '#40515b' } },
  marksman: { height: 2.4, build: 0.85, torso: 'tapered', sleeves: 'long', uniform: 'tactical',
    uniformPattern: 'camo', hat: 'brim', armor: 'tactical', gloves: true, kneePads: true,
    belt: 'belt', bootHeight: 0.65, weapon: 'sniperRifle', holdPose: 'twoHand', gunSight: 'scope',
    barrelLength: 1.3, backGear: 'radioPack',
    colors: { top: '#a59b77', pants: '#7c8060', armor: '#79826a', accent: '#c6bb90', equipment: '#4d5a50', shoes: '#636550' } },
  supportGunner: { height: 2.4, build: 1.3, shoulders: 1.15, torso: 'box', sleeves: 'long', uniform: 'tactical',
    uniformPattern: 'camo', hat: 'combatHelmet', hair: 'none', armor: 'tactical', armorThickness: 1.25, vestPouches: 4,
    gloves: true, kneePads: true, belt: 'belt', bootHeight: 0.8,
    weapon: 'machineGun', holdPose: 'twoHand', weaponScale: 1.1, gunMagazine: 'box', gunSight: 'iron',
    colors: { top: '#89916b', pants: '#5f7058', armor: '#65735a', accent: '#b8b888', equipment: '#48534d', shoes: '#525c50' } },
  breacher: { height: 2.2, build: 1.18, torso: 'box', sleeves: 'long', uniform: 'tactical',
    uniformPattern: 'panels', hat: 'combatHelmet', hair: 'none', eyewear: 'visor', armor: 'tactical',
    gloves: true, kneePads: true, bootHeight: 0.8, belt: 'belt', weapon: 'shotgun', holdPose: 'twoHand',
    gunSight: 'iron',
    colors: { top: '#697783', pants: '#495a68', armor: '#516373', accent: '#bec6b8', equipment: '#3d4e5b', shoes: '#485661' } },
  police: { height: 2.2, build: 1.02, torso: 'box', sleeves: 'short', uniform: 'police',
    hat: 'policeCap', belt: 'belt', pouches: 2, idBadge: true,
    weapon: 'pistol', holdPose: 'ready', offhand: 'radio',
    colors: { top: '#6487a1', pants: '#354e66', accent: '#e2bc72', armor: '#526c83', equipment: '#364957', shoes: '#3b4d59' } },
  firefighter: { height: 2.25, build: 1.16, torso: 'coat', sleeves: 'long', uniform: 'turnout',
    hat: 'fireHelmet', hair: 'none', eyewear: 'visor', gloves: true, reflectiveStrips: true,
    belt: 'belt', bootHeight: 0.85, backGear: 'twinTanks',
    weapon: 'waterNozzle', holdPose: 'twoHand', hose: true,
    colors: { top: '#c99c65', pants: '#ad865a', accent: '#e4b957', equipment: '#48545a', shoes: '#4d5552', reflective: '#ecde83' } },
  nurse: { height: 2.05, build: 0.88, torso: 'tapered', sleeves: 'short', uniform: 'scrubs',
    hat: 'nurseCap', hair: 'bob', faceMask: true, maskStyle: 'surgical', gloves: true, idBadge: true,
    weapon: 'syringe', holdPose: 'ready', offhand: 'medkit',
    colors: { top: '#89bfc2', pants: '#639baf', accent: '#62a8a9', equipment: '#8ccac8', shoes: '#e4ede4', medical: '#edf1e6', liquid: '#89cfcc' } },
  doctor: { height: 2.3, build: 0.92, torso: 'coat', sleeves: 'long', uniform: 'medical',
    hat: 'surgicalCap', hair: 'none', faceMask: true, maskStyle: 'surgical', idBadge: true, stethoscope: true,
    weapon: 'syringe', syringeSize: 0.8, holdPose: 'ready', offhand: 'clipboard',
    colors: { top: '#e4e9de', pants: '#668f9e', accent: '#6da9a9', equipment: '#699297', shoes: '#d9e3d8', medical: '#f0eee1' } },
  paramedic: { height: 2.2, build: 1.05, torso: 'box', sleeves: 'long', uniform: 'rescue',
    hat: 'cap', reflectiveStrips: true, gloves: true, idBadge: true, stethoscope: true,
    belt: 'belt', backGear: 'medicalPack', weapon: 'radio', holdPose: 'ready', offhand: 'medkit',
    colors: { top: '#be7058', pants: '#456576', accent: '#e5d49a', equipment: '#536d76', shoes: '#4b6068', medical: '#e9e9d8' } },
});

// Shared with the factory preview so editor ranges and factory validation stay identical.
// `when` predicates drive preview field visibility only: normalization resolves every
// field regardless, so `params.staffTop` exists even for a character holding no staff.
export const CHARACTER_SCHEMA = freezeConfig({
  torso: { label: 'torso', default: 'tapered', choices: { box: 'box', tapered: 'tapered', round: 'round', coat: 'coat', tunic: 'tunic', robe: 'robe' } },
  sleeves: { label: 'sleeves', default: 'short', choices: { short: 'short', long: 'long', flared: 'flared' } },
  uniform: { label: 'uniform', default: 'none', choices: { none: 'none', tactical: 'tactical', turnout: 'turnout', scrubs: 'scrubs', medical: 'medical', police: 'police', rescue: 'rescue' }, randomize: false },
  uniformPattern: { label: 'uniformPattern', default: 'plain', choices: { plain: 'plain', panels: 'panels', camo: 'camo' }, when: p => p.uniform === 'tactical' },
  patternScale: { label: 'patternScale', default: 1, min: 0.65, max: 1.5, step: 0.05, when: p => p.uniform === 'tactical' && p.uniformPattern === 'camo' },
  patternSeed: { label: 'patternSeed', default: 42, min: 0, max: 4294967295, step: 1, input: 'number', when: p => p.uniform === 'tactical' && p.uniformPattern === 'camo' },
  reflectiveStrips: { label: 'reflectiveStrips', default: false },
  gloves: { label: 'gloves', default: false },
  kneePads: { label: 'kneePads', default: false },
  idBadge: { label: 'idBadge', default: false },
  stethoscope: { label: 'stethoscope', default: false },
  robeLength: { label: 'robeLength', default: 0.85, min: 0.35, max: 0.95, step: 0.05, when: p => p.torso === 'robe' },
  robeFlare: { label: 'robeFlare', default: 1.25, min: 0.9, max: 1.7, step: 0.05, when: p => ['robe', 'tunic'].includes(p.torso) },
  armor: { label: 'armor', default: 'none', choices: { none: 'none', leather: 'leather', plate: 'plate', layered: 'layered', tactical: 'tactical' } },
  armorThickness: { label: 'armorThickness', default: 1, min: 0.6, max: 1.6, step: 0.05, when: p => p.armor !== 'none' },
  vestPouches: { label: 'vestPouches', default: 3, min: 0, max: 5, step: 1, when: p => p.armor === 'tactical' },
  pauldrons: { label: 'pauldrons', default: 'none', choices: { none: 'none', both: 'both', left: 'left', right: 'right' } },
  pauldronSize: { label: 'pauldronSize', default: 1, min: 0.65, max: 1.6, step: 0.05, when: p => p.pauldrons !== 'none' },
  bracers: { label: 'bracers', default: false },
  bootHeight: { label: 'bootHeight', default: 0, min: 0, max: 0.9, step: 0.05 },
  belt: { label: 'belt', default: 'none', choices: { none: 'none', belt: 'belt', sash: 'sash' } },
  tabard: { label: 'tabard', default: false },
  emblem: { label: 'emblem', default: 'none', choices: { none: 'none', gem: 'gem', chevron: 'chevron', sun: 'sun', cross: 'cross' } },
  hat: { label: 'hat', default: 'none', choices: { none: 'none', cap: 'cap', beanie: 'beanie', helmet: 'helmet', brim: 'brim', wizard: 'wizard', hood: 'hood', openHelm: 'openHelm', greatHelm: 'greatHelm', combatHelmet: 'combatHelmet', beret: 'beret', fireHelmet: 'fireHelmet', nurseCap: 'nurseCap', surgicalCap: 'surgicalCap', policeCap: 'policeCap' } },
  hatHeight: { label: 'hatHeight', default: 1.25, min: 0.7, max: 1.9, step: 0.05, when: p => p.hat === 'wizard' },
  crest: { label: 'crest', default: 'none', choices: { none: 'none', plume: 'plume', horns: 'horns' }, when: p => ['openHelm', 'greatHelm'].includes(p.hat) },
  faceMask: { label: 'faceMask', default: false },
  maskStyle: { label: 'maskStyle', default: 'cloth', choices: { cloth: 'cloth', surgical: 'surgical', respirator: 'respirator' }, when: p => p.faceMask },
  eyewear: { label: 'eyewear', default: 'none', choices: { none: 'none', goggles: 'goggles', visor: 'visor' } },
  hair: { label: 'hair', default: 'crop', choices: { none: 'none', crop: 'crop', bob: 'bob', mohawk: 'mohawk', ponytail: 'ponytail' } },
  beard: { label: 'beard', default: 'none', choices: { none: 'none', short: 'short', long: 'long' } },
  headShape: { label: 'headShape', default: 'round', choices: { round: 'round', box: 'box' } },
  weapon: { label: 'weapon', default: 'none', choices: { none: 'none', sword: 'sword', dagger: 'dagger', axe: 'axe', hammer: 'hammer', spear: 'spear', staff: 'staff', wand: 'wand', bow: 'bow', rifle: 'rifle', smg: 'smg', shotgun: 'shotgun', sniperRifle: 'sniperRifle', machineGun: 'machineGun', pistol: 'pistol', waterNozzle: 'waterNozzle', syringe: 'syringe', radio: 'radio', flashlight: 'flashlight' } },
  weaponScale: { label: 'weaponScale', default: 1, min: 0.65, max: 1.4, step: 0.05, when: p => p.weapon !== 'none' },
  holdPose: { label: 'holdPose', default: 'swing', choices: { swing: 'swing', ready: 'ready', twoHand: 'twoHand' }, when: p => p.weapon !== 'none' },
  barrelLength: { label: 'barrelLength', default: 1, min: 0.65, max: 1.5, step: 0.05, when: p => CHARACTER_FIREARMS.includes(p.weapon) },
  gunStock: { label: 'gunStock', default: 'full', choices: { full: 'full', folded: 'folded', none: 'none' }, when: p => CHARACTER_FIREARMS.includes(p.weapon) && p.weapon !== 'pistol' },
  gunSight: { label: 'gunSight', default: 'iron', choices: { iron: 'iron', reflex: 'reflex', scope: 'scope' }, when: p => CHARACTER_FIREARMS.includes(p.weapon) },
  gunMagazine: { label: 'gunMagazine', default: 'straight', choices: { straight: 'straight', curved: 'curved', drum: 'drum', box: 'box' }, when: p => ['rifle', 'smg', 'sniperRifle', 'machineGun'].includes(p.weapon) },
  nozzleLength: { label: 'nozzleLength', default: 1, min: 0.7, max: 1.5, step: 0.05, when: p => p.weapon === 'waterNozzle' },
  nozzleTip: { label: 'nozzleTip', default: 'wide', choices: { wide: 'wide', straight: 'straight' }, when: p => p.weapon === 'waterNozzle' },
  hose: { label: 'hose', default: false, when: p => p.weapon === 'waterNozzle' },
  hoseLength: { label: 'hoseLength', default: 0.65, min: 0.35, max: 1.15, step: 0.05, when: p => p.weapon === 'waterNozzle' && p.hose },
  syringeSize: { label: 'syringeSize', default: 1, min: 0.65, max: 1.4, step: 0.05, when: p => p.weapon === 'syringe' },
  syringeFill: { label: 'syringeFill', default: 0.65, min: 0, max: 1, step: 0.05, when: p => p.weapon === 'syringe' },
  staffTop: { label: 'staffTop', default: 'crystal', choices: { crystal: 'crystal', orb: 'orb', cross: 'cross', fork: 'fork' }, when: p => p.weapon === 'staff' },
  offhand: { label: 'offhand', default: 'none', choices: { none: 'none', roundShield: 'roundShield', kiteShield: 'kiteShield', dagger: 'dagger', book: 'book', orb: 'orb', medkit: 'medkit', clipboard: 'clipboard', radio: 'radio', flashlight: 'flashlight' } },
  offhandScale: { label: 'offhandScale', default: 1, min: 0.65, max: 1.4, step: 0.05, when: p => p.offhand !== 'none' },
  cape: { label: 'cape', default: 'none', choices: { none: 'none', short: 'short', long: 'long', split: 'split' } },
  capeLength: { label: 'capeLength', default: 0.62, min: 0.35, max: 0.8, step: 0.05, when: p => p.cape !== 'none' },
  capeWidth: { label: 'capeWidth', default: 1.05, min: 0.65, max: 1.6, step: 0.05, when: p => p.cape !== 'none' },
  pouches: { label: 'pouches', default: 0, min: 0, max: 4, step: 1 },
  quiver: { label: 'quiver', default: false },
  backpack: { label: 'backpack', default: false },
  backGear: { label: 'backGear', default: 'none', choices: { none: 'none', airTank: 'airTank', twinTanks: 'twinTanks', medicalPack: 'medicalPack', radioPack: 'radioPack' } },
  tankScale: { label: 'tankScale', default: 1, min: 0.7, max: 1.35, step: 0.05, when: p => ['airTank', 'twinTanks'].includes(p.backGear) },
  height: { label: 'height', default: 2.2, min: 0.8, max: 3.2, step: 0.05 },
  build: { label: 'build', default: 1, min: 0.55, max: 1.8, step: 0.05 },
  depth: { label: 'depth', default: 1, min: 0.65, max: 1.65, step: 0.05 },
  legRatio: { label: 'legRatio', default: 0.46, min: 0.34, max: 0.58, step: 0.01 },
  headScale: { label: 'headScale', default: 1, min: 0.72, max: 1.35, step: 0.01 },
  shoulders: { label: 'shoulders', default: 1, min: 0.75, max: 1.4, step: 0.05 },
  limbThickness: { label: 'limbThickness', default: 1, min: 0.65, max: 1.5, step: 0.05 },
  footScale: { label: 'footScale', default: 1, min: 0.75, max: 1.5, step: 0.05 },
  stride: { label: 'stride', default: 1, min: 0.4, max: 1.3, step: 0.05 },
});

const BASE_COLORS = { skin: '#f5c5a4', top: '#ff784f', pants: '#253e59',
  shoes: '#e5eee3', accent: '#39c9b8', hair: '#343442', eye: '#343442',
  armor: '#9eafb3', leather: '#7d604b', cloak: '#657c8c', metal: '#d4dfd8', magic: '#91d6cc',
  equipment: '#435963', medical: '#e5eee4', reflective: '#eade8b', liquid: '#8bcfc9' };

export function normalizeCharacterOptions(options = {}) {
  return normalizeFactoryOptions(options, CHARACTER_PRESETS, CHARACTER_SCHEMA, BASE_COLORS);
}

/**
 * Reproducible resolved options. Unlike the generic sampler this keeps the preset's
 * outfit identity: a nurse stays a nurse. It varies proportions, and only swaps
 * equipment within the same profession, because rerolling `uniform` or `weapon`
 * freely would return a different character than the caller asked for.
 */
export function randomCharacterOptions(seed = 1, overrides = {}) {
  objectOption(overrides, 'overrides');
  if (overrides.colors !== undefined) objectOption(overrides.colors, 'colors');
  const random = seededRandom(seed);
  for (let i = 0; i < 5; i += 1) random();
  const pick = values => values[Math.floor(random() * values.length)];
  const preset = overrides.preset ?? pick(Object.keys(CHARACTER_PRESETS));
  const base = normalizeCharacterOptions({ preset });
  const modern = base.uniform !== 'none';
  const profession = modern || base.weapon !== 'none' || base.torso === 'robe';
  const varied = {};
  // Vary proportions only for fields this outfit actually uses, so a preview slider
  // never reports a value that changes nothing visible.
  for (const [key, field] of Object.entries(CHARACTER_SCHEMA)) {
    if (typeof field.default !== 'number' || (field.when && !field.when(base))) continue;
    const value = base[key] * (0.8 + random() * 0.4);
    const stepped = field.step === 1 ? Math.round(value) : Math.round(value / field.step) * field.step;
    varied[key] = Math.max(field.min, Math.min(field.max, Number(stepped.toFixed(4))));
  }
  const palette = pick([
    ['#737cae', '#515c8a', '#ebc476'], ['#a86353', '#724b4f', '#e2c185'],
    ['#6e927d', '#4b6a5d', '#dec692'], ['#668697', '#405d74', '#dbb27d'],
    ['#c5b698', '#817363', '#ecdaaa'], ['#716b89', '#4c465f', '#aaccc0'],
  ]);
  const colors = {
    skin: pick(['#f5c5a4', '#ce9572', '#945f4e', '#704c42', '#ecd0b7']),
    top: palette[0], cloak: palette[1], accent: palette[2],
    armor: pick(['#9eafb3', '#b7b7a2', '#788b99', '#b99c7b']),
    magic: pick(['#91d6cc', '#b6b2e2', '#eac687', '#b9d88e']),
  };
  if (modern) {
    // A uniform is a recognizable livery, so its colors are kept and only its
    // equipment and proportions vary.
    Object.assign(colors, { top: base.colors.top, accent: base.colors.accent, armor: base.colors.armor });
    if (base.uniform === 'tactical') {
      const military = pick([
        ['#7e8a62', '#637553', '#59684f', '#b9bd87'], ['#a69c7e', '#847e63', '#777c64', '#cbbd91'],
        ['#718596', '#536b7d', '#4e6676', '#acc0bd'], ['#87948e', '#65756f', '#586b66', '#bbc6ad'],
      ]);
      [colors.top, colors.pants, colors.armor, colors.accent] = military;
      varied.uniformPattern = pick(['plain', 'panels', 'camo']);
      varied.patternSeed = seed >>> 0;
    }
    if (['rifle', 'smg'].includes(base.weapon)) varied.weapon = pick(['rifle', 'smg']);
    if (CHARACTER_FIREARMS.includes(base.weapon) && base.weapon !== 'pistol') {
      varied.gunStock = pick(['full', 'folded', 'none']);
      if (base.weapon !== 'sniperRifle') varied.gunSight = pick(['iron', 'reflex', 'scope']);
      varied.gunMagazine = pick(['straight', 'curved', 'drum', 'box']);
    }
    if (base.uniform === 'turnout') {
      colors.top = pick(['#c99c65', '#b98655', '#bd7956', '#667782']);
      colors.pants = colors.top;
      varied.backGear = pick(['airTank', 'twinTanks']);
      varied.nozzleTip = pick(['wide', 'straight']);
    }
    if (['scrubs', 'medical'].includes(base.uniform)) {
      if (base.uniform === 'scrubs') colors.top = pick(['#89bfc2', '#87aebf', '#b8acc7', '#b6c8b3']);
      varied.offhand = pick(['medkit', 'clipboard']);
      varied.syringeFill = Math.round(random() * 20) / 20;
    }
  } else if (profession) {
    if (base.armor === 'plate') varied.armor = pick(['plate', 'layered']);
  } else {
    // Everyday presets carry no profession to preserve, so their whole silhouette
    // is fair game.
    Object.assign(varied, {
      torso: pick(['box', 'tapered', 'round', 'coat']),
      hat: pick(['none', 'cap', 'beanie', 'helmet', 'brim']),
      hair: pick(['none', 'crop', 'bob', 'mohawk', 'ponytail']),
      backpack: random() > 0.55,
    });
  }
  return normalizeCharacterOptions({ ...base, ...varied, ...overrides,
    colors: { ...base.colors, ...colors, ...overrides.colors } });
}


/** Simplified humanoid. Same pose / group contract as the detailed factory. */
export function buildCharacterVisual(options = {}) {
  const params = normalizeCharacterOptions(options), p = params, c = p.colors;
  const kit = createPrimitiveKit(), mesh = new Group();
  mesh.name = `simple-character-${p.preset}`;
  const h = p.height, hipY = h * p.legRatio, headH = h * 0.22 * p.headScale;
  const torsoH = Math.max(0.08, h - headH - hipY);
  const torsoW = h * 0.3 * p.build, torsoD = torsoW * 0.62 * p.depth;
  const legW = h * 0.1 * p.limbThickness * Math.sqrt(p.build);
  const armW = h * 0.075 * p.limbThickness, armLength = h * 0.32;
  const upper = armLength * 0.53, lower = armLength * 0.47;

  const body = kit.group(mesh, 'hips', [0, hipY, 0]);
  const chest = kit.group(body, 'chest');
  kit.box(chest, 'torso', [torsoW, torsoH, torsoD], [0, torsoH / 2, 0], c.top);
  const head = kit.group(chest, 'head', [0, torsoH + headH / 2, 0]);
  kit[p.headShape === 'box' ? 'box' : 'sphere'](head, 'head-block',
    [headH * 0.9, headH, headH * 0.9], [0, 0, 0], c.skin);

  const legs = [], arms = [];
  for (const side of [-1, 1]) {
    const label = side < 0 ? 'left' : 'right';
    const hip = kit.group(body, `${label}-hip`, [side * torsoW * 0.26, 0, 0]);
    kit.box(hip, 'leg', [legW, hipY, legW], [0, -hipY / 2, 0], c.pants);
    const knee = kit.group(hip, `${label}-knee`);
    const ankle = kit.group(knee, `${label}-ankle`);
    legs.push({ hip, knee, ankle });
    const shoulder = kit.group(chest, `${label}-shoulder`,
      [side * (torsoW / 2 + armW * 0.55), torsoH - armW * 0.6, 0]);
    kit.box(shoulder, 'upper-arm', [armW, upper, armW], [0, -upper / 2, 0], c.top);
    const elbow = kit.group(shoulder, `${label}-elbow`, [0, -upper, 0]);
    kit.box(elbow, 'forearm', [armW * 0.9, lower, armW * 0.9], [0, -lower / 2, 0], c.skin);
    const hand = kit.group(elbow, `${label}-hand`, [0, -lower, 0]);
    kit.box(hand, 'hand', [armW * 1.2, armW * 1.2, armW * 1.2], [0, 0, 0], c.skin);
    if (side > 0 && p.weapon !== 'none') {
      kit.box(hand, 'held-item', [armW * 0.45, armW * 0.45, h * 0.28], [0, 0, -h * 0.1], c.equipment);
    }
    if (side < 0 && p.offhand !== 'none') {
      kit.box(hand, 'offhand-item', [armW * 1.4, armW * 1.6, armW * 0.3], [0, 0, -armW], c.armor);
    }
    arms.push({ shoulder, elbow, hand });
  }

  const rig = { body, chest, head, legs, arms };
  const bounds = new Box3(), dimensions = new Vector3();
  let time = 0;
  function setPose(motion = 'idle', seconds = 0) {
    kit.assertLive();
    choice(motion, 'idle', CHARACTER_MOTIONS, 'motion');
    if (!Number.isFinite(seconds)) throw new TypeError('time must be finite');
    const moving = motion === 'walk' || motion === 'run';
    const run = motion === 'run';
    const phase = seconds * Math.PI * 2 * (run ? 2.5 : 1.45);
    const idlePhase = seconds * 2.2;
    chest.rotation.set(0, 0, 0); head.rotation.set(0, 0, 0);
    body.position.y = hipY;
    const support = [];
    for (let i = 0; i < 2; i++) {
      const wave = Math.sin(phase + i * Math.PI);
      let hip = 0, shoulder = 0, elbow = 0.12;
      if (moving) {
        hip = wave * (run ? 0.8 : 0.5) * p.stride;
        shoulder = -wave * (run ? 0.8 : 0.42) * p.stride;
        elbow = run ? 1.1 : 0.3;
        chest.rotation.x = run ? -0.14 : -0.04;
      } else if (motion === 'jump') {
        hip = i === 0 ? 0.75 : -0.25;
        shoulder = 2.2; elbow = 0.5; chest.rotation.x = -0.12;
      } else if (motion === 'crouch' || motion === 'slide') {
        hip = motion === 'slide' ? 1.3 : 0.95;
        shoulder = motion === 'slide' ? -0.55 : 0.6;
        elbow = 0.8; chest.rotation.x = motion === 'slide' ? 0.3 : -0.35;
      } else {
        chest.rotation.x = Math.sin(idlePhase) * 0.014;
        shoulder = Math.sin(idlePhase + i) * 0.02;
      }
      legs[i].hip.rotation.x = hip;
      arms[i].shoulder.rotation.set(shoulder, 0, (i === 0 ? -1 : 1) * 0.07);
      arms[i].elbow.rotation.set(elbow, 0, 0);
      arms[i].hand.rotation.set(0, 0, 0);
      support.push(hipY * Math.cos(hip));
    }
    if (motion !== 'jump') body.position.y = Math.max(...support);
    mesh.updateMatrixWorld(true);
    return api;
  }
  const api = {
    group: mesh, mesh, rig, params, bounds, dimensions,
    attachments: { head, chest, leftHand: arms[0].hand, rightHand: arms[1].hand,
      leftFoot: legs[0].ankle, rightFoot: legs[1].ankle },
    collisionHint: { height: h, radius: Math.max(torsoW / 2, torsoD / 2), center: new Vector3(0, h / 2, 0) },
    setPose,
    update(dt, { motion = 'idle', speed = 1 } = {}) {
      kit.assertLive();
      if (!Number.isFinite(dt) || dt < 0) throw new RangeError('dt must be finite and nonnegative');
      if (!Number.isFinite(speed) || speed < 0) throw new RangeError('speed must be finite and nonnegative');
      const nextTime = time + dt * speed;
      setPose(motion, nextTime);
      time = nextTime;
      return api;
    },
    reset() { setPose('idle', 0); time = 0; return api; },
    getStats: () => kit.stats(mesh),
    dispose: () => kit.dispose(mesh),
  };
  api.reset();
  const rest = measure(mesh);
  bounds.copy(rest.bounds);
  dimensions.copy(rest.dimensions);
  return api;
}

export const createCharacterVisual = buildCharacterVisual;
