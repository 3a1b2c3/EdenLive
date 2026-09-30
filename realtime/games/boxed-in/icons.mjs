const paths = {
  box: '<path d="m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9M7.5 5.5l9 5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 8.5a2.5 2.5 0 0 1 5 .5c0 2-2.5 2-2.5 2-2.5 4M12 16.5v.1"/>'.replace('2-2.5 2-2.5 4','2-2.5 4'),
  leaf: '<path d="M19 3C7 2 2 8 6 15c6 5 13-1 13-12zM4 21 15 8M9 15l-1-5M9 15l5 1"/>',
  undo: '<path d="M8 5 3 10l5 5M3 10h11a6 6 0 0 1 0 12" transform="translate(0 -2)"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/>',
  bulb: '<path d="M9 18h6M9 21h6M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 3H9c0-1 0-2-1-3z"/>',
  right: '<path d="M4 12h15m-6-6 6 6-6 6"/>', check: '<path d="m5 12 5 5L20 7"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
};
export const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.box}</svg>`;
export function fillIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML = icon(node.dataset.icon); }); }
