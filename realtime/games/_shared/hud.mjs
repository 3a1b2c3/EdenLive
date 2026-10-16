// SPDX-License-Identifier: Apache-2.0
// Compact combat HUD: crosshair, hit marker, health and resource bars, objective, controls,
// damage vignette and screen flash. Pure DOM; the result/pause cards come from GameUiFactory.
const CSS = `
.eh{position:absolute;inset:0;pointer-events:none;font:13px/1.35 system-ui,Segoe UI,Arial,sans-serif;color:#f4efe2;overflow:hidden}
.eh *{box-sizing:border-box}
.eh-vig{position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at center,rgba(200,20,10,0) 42%,rgba(190,16,8,.78) 100%)}
.eh-flash{position:absolute;inset:0;opacity:0;background:#fff}
.eh-cross{position:absolute;left:50%;top:50%;width:0;height:0}
.eh-cross i{position:absolute;background:rgba(255,255,255,.92);box-shadow:0 0 3px #000}
.eh-cross .a{left:-1px;top:-14px;width:2px;height:8px}.eh-cross .b{left:-1px;top:6px;width:2px;height:8px}
.eh-cross .c{left:-14px;top:-1px;width:8px;height:2px}.eh-cross .d{left:6px;top:-1px;width:8px;height:2px}
.eh-cross .dot{left:-1.5px;top:-1.5px;width:3px;height:3px;border-radius:50%}
.eh-hit{position:absolute;left:50%;top:50%;width:30px;height:30px;margin:-15px 0 0 -15px;opacity:0}
.eh-hit i{position:absolute;left:50%;top:50%;width:11px;height:2px;margin:-1px 0 0 -5px;background:#ff5a3c;box-shadow:0 0 4px #000}
.eh-hit i:nth-child(1){transform:rotate(45deg) translateX(11px)}.eh-hit i:nth-child(2){transform:rotate(-45deg) translateX(11px)}
.eh-hit i:nth-child(3){transform:rotate(135deg) translateX(11px)}.eh-hit i:nth-child(4){transform:rotate(-135deg) translateX(11px)}
.eh-hit.kill i{background:#ffd34a;width:14px}
.eh-top{position:absolute;top:14px;left:50%;transform:translateX(-50%);text-align:center;text-shadow:0 1px 4px #000}
.eh-top b{display:block;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#ffcf6b}
.eh-top span{font-size:15px;font-weight:600}
.eh-pips{display:flex;gap:6px;justify-content:center;margin-top:5px}
.eh-pips i{width:22px;height:8px;border:1px solid rgba(255,255,255,.6);background:rgba(0,0,0,.4);transform:skewX(-20deg)}
.eh-pips i.on{background:#ffcf6b;border-color:#ffcf6b;box-shadow:0 0 8px #ffb02e}
.eh-bars{position:absolute;left:18px;bottom:44px;display:flex;flex-direction:column;gap:7px;width:230px}
.eh-bar{position:relative;height:16px;background:rgba(6,10,14,.62);border:1px solid rgba(255,255,255,.28);border-radius:2px;overflow:hidden}
.eh-bar>u{position:absolute;inset:0 auto 0 0;width:50%;background:var(--c,#e24d3a);text-decoration:none;transition:width .12s}
.eh-bar>s{position:absolute;inset:0 6px;text-decoration:none;font-size:10px;font-weight:700;letter-spacing:.08em;line-height:15px;display:flex;justify-content:space-between;text-shadow:0 1px 2px #000}
.eh-tbars{position:absolute;top:14px;right:18px;width:250px;display:flex;flex-direction:column;gap:5px}
.eh-tbars .eh-bar{height:18px}
.eh-ammo{position:absolute;right:20px;bottom:44px;text-align:right;text-shadow:0 1px 4px #000;font-variant-numeric:tabular-nums}
.eh-ammo b{font-size:34px;font-weight:800;line-height:1}.eh-ammo span{display:block;font-size:11px;letter-spacing:.12em;color:#cfd8e0}
.eh-ctrl{position:absolute;left:0;right:0;bottom:10px;text-align:center;font-size:11px;color:rgba(240,240,240,.74);text-shadow:0 1px 3px #000;letter-spacing:.02em}
.eh-msg{position:absolute;left:50%;top:62%;transform:translateX(-50%);font-size:20px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;text-shadow:0 2px 6px #000;opacity:0;white-space:nowrap}
.eh-dir{position:absolute;left:50%;top:50%;width:0;height:0}
.eh-dir i{position:absolute;left:-60px;top:-150px;width:120px;height:32px;opacity:0;background:radial-gradient(ellipse at center,rgba(255,40,20,.9),rgba(255,40,20,0) 70%)}
`;
export function createHud(root, { title, controls, bars = [], pips = 0, ammo = false, crosshair = 'cross' } = {}) {
  if (!document.getElementById('eh-css')) {
    const st = document.createElement('style'); st.id = 'eh-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  const el = document.createElement('div');
  el.className = 'eh';
  el.innerHTML = `<div class="eh-vig"></div><div class="eh-dir"><i></i></div><div class="eh-flash"></div>
  <div class="eh-top"><b></b><span></span><div class="eh-pips"></div></div>
  <div class="eh-cross">${crosshair === 'none' ? '' : crosshair === 'dot' ? '<i class="dot"></i>' : '<i class="a"></i><i class="b"></i><i class="c"></i><i class="d"></i><i class="dot"></i>'}</div>
  <div class="eh-hit"><i></i><i></i><i></i><i></i></div>
  <div class="eh-bars"></div><div class="eh-tbars"></div>${ammo ? '<div class="eh-ammo"><b></b><span></span></div>' : ''}
  <div class="eh-msg"></div><div class="eh-ctrl"></div>`;
  root.appendChild(el);
  const q = (s) => el.querySelector(s);
  const barEls = {};
  for (const b of bars) {
    const d = document.createElement('div');
    d.className = 'eh-bar'; d.style.setProperty('--c', b.color);
    d.innerHTML = `<u></u><s><span>${b.label}</span><span class="v"></span></s>`;
    q(b.top ? '.eh-tbars' : '.eh-bars').appendChild(d);
    barEls[b.id] = d;
  }
  const pipRoot = q('.eh-pips');
  for (let i = 0; i < pips; i++) pipRoot.appendChild(document.createElement('i'));
  q('.eh-top b').textContent = title ?? '';
  q('.eh-ctrl').textContent = controls ?? '';
  const last = {};
  const set = (key, node, prop, val) => { if (last[key] !== val) { last[key] = val; node.style[prop] = val; } };
  const text = (key, node, val) => { if (last[key] !== val) { last[key] = val; node.textContent = val; } };
  return {
    el,
    update(v) {
      set('vig', q('.eh-vig'), 'opacity', (v.hurt ?? 0).toFixed(2));
      set('flash', q('.eh-flash'), 'opacity', (v.flash ?? 0).toFixed(2));
      const hm = q('.eh-hit');
      set('hit', hm, 'opacity', (v.hitmark ?? 0).toFixed(2));
      if (hm.classList.contains('kill') !== !!v.hitKill) hm.classList.toggle('kill', !!v.hitKill);
      text('obj', q('.eh-top span'), v.objective ?? '');
      pipRoot.childNodes.forEach((n, i) => { const on = i < (v.pipsOn ?? 0); if (n.classList.contains('on') !== on) n.classList.toggle('on', on); });
      for (const b of bars) {
        const d = barEls[b.id], x = v.bars?.[b.id];
        if (!x) continue;
        set('w' + b.id, d.firstChild, 'width', `${Math.max(0, Math.min(1, x.value / x.max)) * 100}%`);
        text('t' + b.id, d.querySelector('.v'), x.text ?? `${Math.ceil(x.value)}`);
        if (x.color) d.style.setProperty('--c', x.color);
      }
      if (ammo && v.ammo) { text('am', q('.eh-ammo b'), v.ammo.main); text('al', q('.eh-ammo span'), v.ammo.label); }
      const m = q('.eh-msg');
      text('msg', m, v.msg ?? ''); set('msgo', m, 'opacity', v.msg ? '1' : '0');
      if (v.msgColor) set('msgc', m, 'color', v.msgColor);
      const dir = q('.eh-dir i');
      set('diro', dir, 'opacity', (v.dirAlpha ?? 0).toFixed(2));
      set('dirr', q('.eh-dir'), 'transform', `rotate(${(v.dirAngle ?? 0).toFixed(2)}rad)`);
    },
  };
}
