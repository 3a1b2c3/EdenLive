import { EQUIPMENT_PRESETS, normalizeEquipmentOptions } from './EquipmentVisualFactory.js';

// Legacy profession options remain an input adapter, never a geometry builder.
const aliases = { sword: 'shortSword', axe: 'battleAxe', hammer: 'warHammer', book: 'spellbook' };
export const CHARACTER_FIREARMS = Object.freeze(['rifle', 'smg', 'shotgun', 'sniperRifle', 'machineGun', 'pistol']);
export const HANDHELD_CHOICES = Object.freeze({ none: 'none', sword: 'sword', axe: 'battle axe', hammer: 'war hammer', book: 'spellbook',
  shortSword: 'short sword', greatSword: 'greatsword', curvedSword: 'curved sword', dagger: 'dagger', battleAxe: 'single-edge axe', doubleAxe: 'double axe',
  warHammer: 'war hammer', mace: 'mace', spear: 'spear', staff: 'staff', wand: 'wand', bow: 'bow', crossbow: 'crossbow',
  roundShield: 'round shield', kiteShield: 'kite shield', towerShield: 'tower shield', spellbook: 'spellbook', orb: 'orb',
  rifle: 'rifle', smg: 'smg', shotgun: 'shotgun', sniperRifle: 'sniper rifle', machineGun: 'machine gun', pistol: 'pistol',
  waterNozzle: 'water nozzle', syringe: 'syringe', flashlight: 'flashlight', radio: 'radio', medkit: 'medkit', clipboard: 'clipboard' });

function legacyEquipment(p, hand) {
  const type = hand === 'right' ? p.weapon : p.offhand;
  if (type === 'none') return null;
  const preset = aliases[type] ?? type, kind = EQUIPMENT_PRESETS[preset].kind, c = p.colors;
  const modern = ['firearm', 'waterNozzle', 'syringe', 'flashlight', 'radio', 'medkit', 'clipboard'].includes(kind);
  const colors = { body: modern ? (['syringe', 'medkit'].includes(kind) ? c.medical : c.equipment) : kind === 'shield' ? c.armor : c.leather,
    metal: c.metal, grip: modern ? c.armor : c.leather, accent: c.accent, core: modern ? c.liquid : c.magic, paper: c.medical };
  const scale = (hand === 'right' ? p.weaponScale : p.offhandScale) * (kind === 'syringe' ? p.syringeSize : 1);
  return normalizeEquipmentOptions({ preset, referenceHeight: p.height, sizeRatio: EQUIPMENT_PRESETS[preset].sizeRatio * scale,
    colors, barrelLength: p.barrelLength, gunStock: p.gunStock, gunSight: p.gunSight, gunMagazine: p.gunMagazine,
    nozzleLength: p.nozzleLength, nozzleTip: p.nozzleTip === 'straight' ? 'narrow' : p.nozzleTip,
    syringeFill: p.syringeFill, staffTop: p.staffTop, symbol: p.emblem });
}

export function normalizeCharacterLoadout(p, source) {
  if (source !== undefined && (!source || typeof source !== 'object' || Array.isArray(source))) throw new TypeError('loadout must be an object');
  if (source && Object.keys(source).some(hand => !['left', 'right'].includes(hand))) throw new RangeError('loadout slots are left and right');
  return Object.fromEntries(['left', 'right'].map(hand => {
    if (!source || !Object.hasOwn(source, hand)) return [hand, legacyEquipment(p, hand)];
    const item = source[hand];
    if (item === null) return [hand, null];
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`loadout.${hand} must be equipment options or null`);
    return [hand, normalizeEquipmentOptions({ ...item, referenceHeight: item.referenceHeight === undefined ? p.height : item.referenceHeight })];
  }));
}
