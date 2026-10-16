// Offline-demo autopilot for standalone games (injected only when EDEN_GAME_AUTOPILOT is set).
// Plays the game with the rules in /<slug>/demo.json, evaluated once per virtual tick against
// window.__gameTest.read(): {rules:[{when,hold|action}], duty:[onTicks,offTicks]|null, startDelay}.
// Same rule semantics as playthrough.json (hold rows are unioned, actions tap with a cooldown).
(() => {
  const slug = location.pathname.split('/').filter(Boolean)[0];
  const KEY = { ' ': [' ', 'Space'], enter: ['Enter', 'Enter'], escape: ['Escape', 'Escape'], shift: ['Shift', 'ShiftLeft'] };
  const keyCode = (a) => {
    const l = String(a).toLowerCase();
    if (KEY[l]) return KEY[l];
    if (l.length === 1) return [l, `Key${l.toUpperCase()}`];
    if (l.startsWith('arrow')) { const n = `Arrow${l[5].toUpperCase()}${l.slice(6)}`; return [n, n]; }
    return [a, a];
  };
  const send = (a, type) => {
    const [key, code] = keyCode(a);
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true }));
  };
  const get = (o, path) => path.split('.').reduce((v, k) => (v && typeof v === 'object' && k in v ? v[k] : undefined), o);
  const test = (cond, v) => {
    if (v === undefined) return false;
    if (cond && typeof cond === 'object') {
      return Object.entries(cond).every(([op, x]) => ({ $gt: v > x, $lt: v < x, $gte: v >= x, $lte: v <= x, $eq: v === x, $ne: v !== x })[op]);
    }
    return v === cond;
  };
  const matches = (when, st) => Object.entries(when || {}).every(([p, c]) => test(c, get(st, p)));
  let cfg = null, tick = 0;
  const held = new Set(), lastAct = new Map(), used = new Set();
  fetch(`/${slug}/demo.json`).then((r) => r.json()).then((c) => { cfg = c; }).catch((e) => console.error('autopilot: no demo.json', e));
  function frame() {
    window.requestAnimationFrame(frame);
    tick++;
    if (!cfg || !window.__gameTest) return;
    const st = window.__gameTest.read();
    const [on, off] = cfg.duty ?? [1, 0];
    const t = tick - (cfg.startDelay ?? 0);
    const active = st.state === 'RUNNING' && t >= 0 && (t % (on + off)) < on;
    const want = new Set();
    if (active) {
      cfg.rules.forEach((r, i) => {
        if (!matches(r.when, st)) return;
        if (r.hold) r.hold.forEach((k) => want.add(k));
        if (r.action) {
          const now = tick * 1000 / 60;
          if (r.once && used.has(i)) return;
          if (now - (lastAct.get(i) ?? -1e9) >= (r.cooldown_ms ?? 100)) { lastAct.set(i, now); used.add(i); send(r.action.key, 'keydown'); send(r.action.key, 'keyup'); }
        }
      });
    }
    for (const k of [...held]) if (!want.has(k)) { send(k, 'keyup'); held.delete(k); }
    for (const k of want) if (!held.has(k)) { send(k, 'keydown'); held.add(k); }
  }
  window.requestAnimationFrame(frame);
})();
