/** Decorate existing nodes without replacing their identity, listeners or text. */
import { DEFAULT_UI_THEME, GAME_UI_TYPES, resolveUIConfig } from './GameUiFactory.js';
export function resolveAdaptConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('Adapt config must be an object');
  for (const key of Object.keys(config)) if (!['roots', 'roles', 'theme'].includes(key)) throw new TypeError(`Unknown adapt option: ${key}`);
  if (!Array.isArray(config.roots) || !config.roots.length || config.roots.some(s => typeof s !== 'string' || !s.trim())) throw new TypeError('roots needs explicit selectors');
  if (!config.roles || typeof config.roles !== 'object' || Array.isArray(config.roles)) throw new TypeError('roles must map roles to selector arrays');
  for (const [role, selectors] of Object.entries(config.roles)) {
    if (![...GAME_UI_TYPES, 'card', 'label', 'value', 'detail', 'button', 'bar'].includes(role)) throw new TypeError(`Unknown role: ${role}`);
    if (!Array.isArray(selectors) || selectors.some(s => typeof s !== 'string' || !s.trim())) throw new TypeError(`Invalid selectors for ${role}`);
  }
  return { roots: [...config.roots], roles: structuredClone(config.roles), theme: resolveUIConfig({ theme: config.theme }).theme };
}
export function adaptGameUI(config, doc = document) {
  const resolved = resolveAdaptConfig(config), restore = [], roots = [];
  const select = selector => {
    const nodes = [...doc.querySelectorAll(selector)];
    if (!nodes.length) throw new Error(`UI selector matched no nodes: ${selector}`);
    return nodes;
  };
  const decorate = (el, cls) => {
    const had = el.classList.contains(cls); el.classList.add(cls);
    if (!had) restore.push(() => el.classList.remove(cls));
  };
  try {
    for (const selector of resolved.roots) for (const el of select(selector)) {
      decorate(el, 'gbui'); decorate(el, 'gbui--adapt'); roots.push(el);
      for (const key of Object.keys(DEFAULT_UI_THEME)) {
        const prop = `--gbui-${key}`, previous = el.style.getPropertyValue(prop), priority = el.style.getPropertyPriority(prop);
        el.style.setProperty(prop, resolved.theme[key]);
        restore.push(() => previous ? el.style.setProperty(prop, previous, priority) : el.style.removeProperty(prop));
      }
    }
    for (const [role, selectors] of Object.entries(resolved.roles)) for (const selector of selectors) for (const el of select(selector)) {
      if (!roots.some(root => root === el || root.contains(el))) throw new Error(`UI role is outside roots: ${selector}`);
      decorate(el, `gbui__${role}`);
    }
  } catch (error) { restore.reverse().forEach(fn => fn()); throw error; }
  let disposed = false;
  return Object.freeze({ roots: Object.freeze(roots), dispose() {
    if (disposed) return;
    disposed = true; restore.reverse().forEach(fn => fn());
  } });
}
