// DOM view only; ResourcePool remains the authoritative resource model.
export class SegmentedResourceView {
  constructor({ container, segments = 3, label = 'Charge', readyText = 'Ready', emptyText = 'Charge to use' }) {
    if (!Number.isInteger(segments) || segments < 1) throw new Error('SegmentedResourceView: positive segment count required');
    this.container = container; this.readyText = readyText; this.emptyText = emptyText;
    const doc = container.ownerDocument;
    this.root = doc.createElement('div'); this.root.className = 'resource-meter';
    this.title = doc.createElement('span'); this.title.textContent = label;
    this.track = doc.createElement('div'); this.track.className = 'resource-track'; this.track.setAttribute('role', 'progressbar'); this.track.setAttribute('aria-label', label);
    this.fill = doc.createElement('div'); this.fill.className = 'resource-fill'; this.track.append(this.fill);
    for (let i = 1; i < segments; i++) { const line = doc.createElement('i'); line.className = 'resource-divider'; line.style.left = `${i / segments * 100}%`; this.track.append(line); }
    this.value = doc.createElement('span'); this.hint = doc.createElement('small');
    this.root.append(this.title, this.value, this.track, this.hint); container.append(this.root);
  }
  update(pool, { readyAt = pool.max } = {}) {
    if (![pool.min, pool.max, pool.value, readyAt].every(Number.isFinite) || pool.max <= pool.min) throw new Error('SegmentedResourceView: finite bounded pool required');
    const ratio = Math.max(0, Math.min(1, (pool.value - pool.min) / (pool.max - pool.min)));
    this.fill.style.width = `${ratio * 100}%`; this.value.textContent = ` ${pool.value} / ${pool.max}`;
    this.track.setAttribute('aria-valuemin', String(pool.min)); this.track.setAttribute('aria-valuemax', String(pool.max)); this.track.setAttribute('aria-valuenow', String(pool.value));
    const ready = pool.value >= readyAt; this.root.classList.toggle('ready', ready); this.hint.textContent = ready ? this.readyText : this.emptyText;
  }
  dispose() { this.root.remove(); }
}
