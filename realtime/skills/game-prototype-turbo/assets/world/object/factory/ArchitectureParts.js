// Coarse roof silhouettes for the simplified building factories. No eaves
// overhang, no parapets, no clerestories: one primitive per roof.
export function addSimpleRoof(kit, parent, { width, depth, height, style, color, y = 0 }) {
  if (style === 'flat') return kit.box(parent, 'flat-roof', [width, 0.24, depth], [0, y + 0.12, 0], color);
  if (style === 'hip' || style === 'pyramid') {
    return kit.frustum(parent, `${style}-roof`, [width, height, depth], [0, y + height / 2, 0], color,
      style === 'pyramid' ? 0 : 0.28);
  }
  const profiles = {
    gable: [[-0.5, 0], [0.5, 0], [0, 1]],
    shed: [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 0.2]],
  };
  return kit.prism(parent, `${style}-roof`, profiles[style], [width, height, depth], [0, y, 0], color);
}

// Compatibility exports: the simplified helper replaces the original under this
// module's historical name, and keeps the original consumer surface. The
// detailed facade cell machinery is gone with its only consumers.
export { addSimpleRoof as addRoof };