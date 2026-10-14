import { createGameUI } from '/assets/user-interface/GameUiFactory.js';
const { config } = await (await fetch(new URL('./config.json', import.meta.url))).json();
export function mountUI({ state, actions, mount } = {}) {
  return createGameUI({ ...config, state, actions, mount });
}
// The no-UI big view keeps only the result dialog; the full original UI lives in the mirror.
export function mountDialogUI({ state, actions, mount } = {}) {
  return createGameUI({ theme: config.theme, components: config.components.filter(c => c.type === 'dialog'), state, actions, mount });
}