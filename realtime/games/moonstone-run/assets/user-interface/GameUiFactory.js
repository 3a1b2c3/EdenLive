/** Presentation only: caller-owned state, actions, input and simulation. */
export const DEFAULT_UI_THEME = Object.freeze({
  panel: '#193439ed', raised: '#203b41', border: '#b7cab433', text: '#f6f1dc',
  muted: '#b8cabc', accent: '#ffcb51', danger: '#f08b80', radius: '3px',
  font: 'Arial, "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
  displayFont: 'Impact, "Arial Narrow", sans-serif', numericFont: 'Arial, sans-serif'
});
export const GAME_UI_TYPES = Object.freeze(['brand', 'metric', 'meter', 'panel', 'notice', 'controls', 'dialog', 'actions', 'slot']);
const DOCKS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const DIALOG_VARIANTS = ['neutral', 'success', 'failure', 'paused'];
const DIALOG_ICONS = { neutral: '', success: '↗', failure: '×', paused: 'Ⅱ' };
const BUTTON_KINDS = ['primary', 'secondary'];

function keys(value, allowed, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError(`Unknown ${name}.${key}`);
}
function freeze(value) {
  Object.values(value).forEach(v => { if (v && typeof v === 'object') freeze(v); });
  return Object.freeze(value);
}
export function resolveUIConfig(config = {}) {
  keys(config, ['theme', 'components'], 'config');
  keys(config.theme || {}, Object.keys(DEFAULT_UI_THEME), 'theme');
  const theme = { ...DEFAULT_UI_THEME, ...config.theme };
  for (const value of Object.values(theme)) if (typeof value !== 'string' || !value.trim()) throw new TypeError('Theme values must be nonempty CSS strings');
  if (!Array.isArray(config.components || [])) throw new TypeError('components must be an array');
  const ids = new Set();
  const components = (config.components || []).map(spec => {
    keys(spec, ['id', 'type', 'dock', 'label', 'variant', 'buttons'], 'component');
    if (typeof spec.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(spec.id) || ids.has(spec.id)) throw new TypeError('Component ids must be unique lowercase slugs');
    ids.add(spec.id);
    if (!GAME_UI_TYPES.includes(spec.type)) throw new TypeError(`Unknown component type: ${spec.type}`);
    if (spec.dock !== undefined && !DOCKS.includes(spec.dock)) throw new TypeError(`Unknown dock: ${spec.dock}`);
    if (spec.label !== undefined && typeof spec.label !== 'string') throw new TypeError('label must be a string');
    if (spec.variant !== undefined && (!DIALOG_VARIANTS.includes(spec.variant) || spec.type !== 'dialog')) {
      throw new TypeError('variant belongs to dialog components and must be neutral, success, failure or paused');
    }
    if (spec.buttons !== undefined && (!['dialog', 'actions'].includes(spec.type) || !Array.isArray(spec.buttons))) throw new TypeError('buttons belong to dialog/actions components');
    const buttons = (spec.buttons || []).map(b => {
      keys(b, ['id', 'label', 'kind'], 'button');
      if (typeof b.id !== 'string' || !b.id.trim() || typeof b.label !== 'string' || !b.label.trim()) throw new TypeError('Buttons need id and label');
      if (b.kind !== undefined && !BUTTON_KINDS.includes(b.kind)) throw new TypeError('Button kind must be primary or secondary');
      return { id: b.id, label: b.label, kind: b.kind || 'primary' };
    });
    if (new Set(buttons.map(b => b.id)).size !== buttons.length) throw new TypeError('Duplicate button id in component');
    return { id: spec.id, type: spec.type, dock: spec.dock || 'top-left', label: spec.label || '',
      ...(spec.type === 'dialog' ? { variant: spec.variant || 'neutral' } : {}), buttons };
  });
  return freeze({ theme, components });
}

export function createGameUI(options = {}) {
  keys(options, ['document', 'mount', 'theme', 'components', 'state', 'actions'], 'options');
  const doc = options.document || globalThis.document;
  const mount = options.mount || doc?.body;
  if (!doc || !mount?.appendChild) throw new TypeError('A browser document and mount are required');
  const config = resolveUIConfig({ theme: options.theme, components: options.components });
  const actions = options.actions || {};
  if (typeof actions !== 'object' || Array.isArray(actions)) throw new TypeError('Actions must be a callback map');
  for (const action of Object.values(actions)) if (typeof action !== 'function') throw new TypeError('Actions must be callbacks');
  const node = (tag, cls, parent) => {
    const el = doc.createElement(tag); el.className = cls; parent?.appendChild(el); return el;
  };
  const root = node('div', 'gbui', mount);
  for (const [key, value] of Object.entries(config.theme)) root.style.setProperty(`--gbui-${key}`, value);
  const docks = Object.fromEntries(DOCKS.map(d => [d, node('div', `gbui__dock gbui__dock--${d}`, root)]));
  const elements = {}, views = new Map(), cleanups = [];
  let disposed = false, activeDialog = null, previousFocus = null;
  const on = (el, event, handler) => { el.addEventListener(event, handler); cleanups.push(() => el.removeEventListener(event, handler)); };
  for (const spec of config.components) {
    const el = node('section', `gbui__${spec.type}`, spec.type === 'dialog' ? root : docks[spec.dock]);
    el.dataset.uiId = spec.id; elements[spec.id] = el;
    if (spec.label) el.setAttribute('aria-label', spec.label);
    if (spec.type === 'slot') { views.set(spec.id, { el, spec }); continue; }
    const body = spec.type === 'dialog' ? node('div', 'gbui__card', el) : el;
    const label = node('div', 'gbui__label', body);
    const icon = spec.type === 'dialog' ? node('div', 'gbui__icon', body) : null;
    icon?.setAttribute('aria-hidden', 'true');
    const value = node(spec.type === 'brand' || spec.type === 'dialog' ? 'h2' : 'div', 'gbui__value', body);
    const detail = node('div', 'gbui__detail', body);
    const stats = spec.type === 'dialog' ? node('dl', 'gbui__stats', body) : null;
    let bar;
    if (spec.type === 'meter') {
      bar = node('progress', 'gbui__bar', body); bar.max = 1; bar.value = 0;
      bar.setAttribute('aria-label', spec.label || spec.id);
    }
    if (spec.type === 'notice') el.setAttribute('aria-live', 'polite');
    if (spec.type === 'dialog') {
      el.hidden = true; body.setAttribute('role', 'dialog'); body.setAttribute('aria-modal', 'true');
      body.setAttribute('aria-label', spec.label || spec.id); body.tabIndex = -1;
      for (const event of ['click', 'pointerdown', 'pointerup', 'keyup']) on(el, event, e => e.stopPropagation());
    }
    for (const b of spec.buttons) {
      const button = node('button', 'gbui__button', body);
      button.type = 'button'; button.textContent = b.label; button.dataset.uiAction = b.id;
      button.classList.add(`gbui__button--${b.kind}`);
      button.disabled = typeof actions[b.id] !== 'function';
      on(button, 'click', event => { event.stopPropagation(); actions[b.id]?.({ component: spec.id, event }); });
      on(button, 'pointerdown', event => event.stopPropagation());
      on(button, 'pointerup', event => event.stopPropagation());
      on(button, 'keyup', event => event.stopPropagation());
    }
    on(el, 'keydown', event => {
      if (spec.type !== 'dialog' && !event.target.closest('button')) return;
      event.stopPropagation();
      if (spec.type === 'dialog' && event.key === 'Tab') {
        const list = [...el.querySelectorAll('button:not(:disabled)')];
        const current = list.indexOf(doc.activeElement);
        event.preventDefault();
        (list[(current + (event.shiftKey ? -1 : 1) + list.length) % list.length] || body).focus();
      }
    });
    views.set(spec.id, { el, spec, body, label, icon, value, detail, stats, bar });
  }
  const cache = new Map();
  function update(state = {}) {
    if (disposed) return;
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('State must be a display-value map');
    // Serialize the supplied display value, not its identity: mutable caller objects work too.
    for (const [id, raw] of Object.entries(state)) {
      const view = views.get(id);
      if (!view) continue; // A deliberately omitted capability has no DOM or work.
      const data = raw && typeof raw === 'object' ? raw : { value: raw };
      const signature = JSON.stringify(data);
      if (cache.get(id) === signature) continue;
      cache.set(id, signature);
      const { el, spec, body, label, icon, value, detail, stats, bar } = view;
      el.hidden = data.visible === false || (spec.type === 'dialog' && data.visible !== true);
      if (spec.type === 'slot') continue;
      label.textContent = String(data.label ?? spec.label);
      value.textContent = String(data.displayValue ?? data.value ?? '');
      detail.textContent = String(data.text ?? '');
      if (stats) {
        stats.replaceChildren();
        const entries = Array.isArray(data.stats) ? data.stats : [];
        for (const stat of entries) {
          if (!stat || typeof stat !== 'object' || Array.isArray(stat)) continue;
          const item = node('div', 'gbui__stat', stats);
          const statLabel = node('dt', '', item); statLabel.textContent = String(stat.label ?? '');
          const statValue = node('dd', '', item); statValue.textContent = String(stat.value ?? '');
        }
        stats.hidden = stats.childElementCount === 0;
      }
      if (spec.type === 'dialog') {
        const variant = DIALOG_VARIANTS.includes(data.variant) ? data.variant : spec.variant;
        for (const name of DIALOG_VARIANTS) el.classList.toggle(`gbui__dialog--${name}`, name === variant);
        icon.textContent = String(data.icon ?? DIALOG_ICONS[variant]);
        icon.hidden = !icon.textContent.trim();
      }
      if (bar) {
        bar.max = Number.isFinite(data.max) && data.max > 0 ? data.max : 1;
        bar.value = Number.isFinite(data.value) ? Math.max(0, Math.min(bar.max, data.value)) : 0;
      }
      if (spec.type === 'dialog') body.setAttribute('aria-label', String(data.value || data.label || spec.label || id));
    }
    const dialog = [...views.values()].find(v => v.spec.type === 'dialog' && !v.el.hidden);
    if (dialog?.el !== activeDialog) {
      if (!activeDialog && dialog) previousFocus = doc.activeElement;
      activeDialog = dialog?.el || null;
      if (dialog) (dialog.el.querySelector('button:not(:disabled)') || dialog.body).focus();
      else if (previousFocus?.isConnected) { previousFocus.focus(); previousFocus = null; }
    }
  }
  update(Object.fromEntries(config.components.map(c => [c.id, {}])));
  update(options.state);
  return Object.freeze({ root, elements: Object.freeze(elements), config, update,
    dispose() {
      if (disposed) return;
      disposed = true; cleanups.forEach(remove => remove()); root.remove();
      if (activeDialog && previousFocus?.isConnected) previousFocus.focus();
      views.clear(); cache.clear();
    }
  });
}
