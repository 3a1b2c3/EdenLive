// SPDX-License-Identifier: Apache-2.0
/** Moorland Archer HUD overlay, drawn over the generated video from the snapshot. */

const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
const setHidden = (node, hidden) => { if (node && node.hidden !== hidden) node.hidden = hidden; };
const setStyle = (node, prop, value) => { if (node && node.style.getPropertyValue(prop) !== value) node.style.setProperty(prop, value); };
const setClass = (node, name, on) => { if (node && node.classList.contains(name) !== on) node.classList.toggle(name, on); };

export function mount(root) {
  root.innerHTML = `
    <div id="hud">
      <div id="hud-hearts" data-field="hearts" aria-label="hearts"></div>
      <div id="compass">Shrine <b data-field="shrine-dist">--</b> m</div>
      <div id="hud-monsters"><div class="label">Shrine guards</div><div class="count" data-field="monster-count">3 / 3</div><div class="pips" data-field="monster-pips"></div></div>
      <div id="reticle" data-field="reticle" aria-hidden="true"></div>
      <div id="charge" data-field="charge" aria-hidden="true"></div>
      <div id="lock-label" data-field="lock-label">LOCKED</div>
      <div id="damage" data-field="damage" aria-hidden="true"></div>
      <div id="banner" data-field="banner"><div class="title">Moorland Archer</div><div class="sub">Defeat the monsters guarding the shrine</div></div>
      <div class="ready" data-field="ready" hidden>
        <div class="cue">WASD / B · SET OUT FOR THE SHRINE</div>
        <div class="hint">The guards idle until you make the first move.</div>
      </div>
      <div id="hint" data-field="hint"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Shift</kbd> sprint · <kbd>I</kbd><kbd>J</kbd><kbd>K</kbd><kbd>L</kbd> camera · hold <kbd>B</kbd> draw, release to shoot · <kbd>P</kbd> pause</div>
      <button type="button" class="pause-btn" data-game-action="pause" data-field="pause" title="Pause (P)" aria-label="Pause game">Ⅱ</button>
    </div>
    <div class="overlay" data-field="overlay" role="dialog" aria-modal="true" aria-labelledby="archer-result-title" hidden>
      <div class="card">
        <div class="eyebrow" data-field="eyebrow"></div>
        <h2 id="archer-result-title" data-field="title"></h2>
        <div class="msg" data-field="msg"></div>
        <div class="stats" data-field="stats">
          <div class="stat"><b data-field="stat-time">0</b><span>seconds</span></div>
          <div class="stat"><b data-field="stat-hearts">0</b><span>hearts left</span></div>
          <div class="stat"><b data-field="stat-acc">0%</b><span>accuracy</span></div>
        </div>
        <button type="button" data-game-action="resume" data-field="resume" hidden>Resume</button>
        <button type="button" data-game-action="reset" data-field="restart">Play again</button>
        <div class="keyhint" data-field="result-hint">Press R to restart</div>
      </div>
    </div>
  `;
  const field = name => root.querySelector(`[data-field="${name}"]`);
  const heartEls = [];
  const pipEls = [];
  // Hearts and pips are built lazily so a snapshot decides their counts.
  const sync = (els, parent, count, make) => {
    while (els.length < count) { const el = make(); parent.appendChild(el); els.push(el); }
    while (els.length > count) els.pop().remove();
  };
  let lastHearts = null;
  return {
    update(s) {
      if (!s) return;
      const heartsMax = s.heartsMax || 5, hearts = s.hearts ?? heartsMax;
      sync(heartEls, field('hearts'), heartsMax, () => {
        const el = document.createElement('span');
        el.className = 'heart';
        el.textContent = '♥';
        return el;
      });
      heartEls.forEach((el, i) => setClass(el, 'empty', i >= hearts));
      const heartsNode = field('hearts');
      if (lastHearts !== null && hearts < lastHearts) {
        heartsNode.classList.remove('hit'); void heartsNode.offsetWidth; heartsNode.classList.add('hit');
      }
      lastHearts = hearts;

      const guards = s.guards || [];
      sync(pipEls, field('monster-pips'), guards.length, () => document.createElement('span'));
      guards.forEach((guard, i) => {
        const cls = `pip${guard.boss ? ' boss' : ''}${guard.dead ? ' dead' : ''}`;
        if (pipEls[i].className !== cls) pipEls[i].className = cls;
      });
      setText(field('monster-count'), `${s.monstersAlive ?? 0} / ${s.monstersTotal ?? guards.length}`);
      setText(field('shrine-dist'), String(Math.round(s.shrineDist ?? 0)));

      const terminal = s.state === 'WON' || s.state === 'LOST';
      const reticle = field('reticle'), charge = field('charge'), lock = field('lock-label');
      const x = `${s.locked ? s.reticleX : 50}%`, y = `${s.locked ? s.reticleY : 50}%`;
      for (const el of [reticle, charge, lock]) { setStyle(el, 'left', x); setStyle(el, 'top', y); }
      setClass(reticle, 'locked', Boolean(s.locked));
      setClass(reticle, 'drawing', Boolean(s.drawing));
      setStyle(reticle, 'opacity', terminal ? '0' : '1');
      setStyle(lock, 'opacity', s.locked ? '1' : '0');
      setStyle(charge, 'opacity', s.drawing ? '1' : '0');
      const level = Math.max(0, Math.min(1, s.charge ?? 0));
      setStyle(charge, 'background', `conic-gradient(${level >= 1 ? '#fff6a8' : '#6ff0e0'} ${Math.round(level * 360)}deg, transparent 0deg)`);
      setStyle(field('damage'), 'opacity', String(s.hitFlash ?? 0));

      const elapsed = s.elapsed ?? 0;
      setStyle(field('banner'), 'opacity', s.state === 'RUNNING' && elapsed < 5 ? '1' : '0');
      setHidden(field('ready'), s.state !== 'READY');
      setStyle(field('hint'), 'opacity', terminal ? '0' : elapsed < 15 ? '1' : '0.4');

      // READY is the start line, not an outcome: no card. Pause shares the card.
      const paused = Boolean(s.paused) && !terminal;
      const show = terminal || paused;
      setHidden(field('overlay'), !show);
      setClass(field('overlay'), 'lost', s.state === 'LOST');
      const pause = field('pause');
      const pauseOff = show || s.state !== 'RUNNING';
      if (pause.disabled !== pauseOff) pause.disabled = pauseOff;
      if (!show) return;
      setHidden(field('resume'), !paused);
      setHidden(field('stats'), paused);
      if (paused) {
        setText(field('eyebrow'), 'Held');
        setText(field('title'), 'Paused');
        setText(field('msg'), 'The valley waits. Press P or Escape to pick the bow back up.');
        setText(field('restart'), 'Restart the round');
        setText(field('result-hint'), 'P / Escape resumes · R restarts');
        return;
      }
      const won = s.state === 'WON';
      setText(field('eyebrow'), won ? 'Shrine cleared' : 'Hearts depleted');
      setText(field('title'), won ? 'Victory' : 'You Fell');
      setText(field('msg'), won
        ? 'Every monster guarding the shrine has fallen. The way inside is open.'
        : 'The shrine guards overwhelmed you. Keep your distance and shoot from range.');
      setText(field('stat-time'), String(Math.round(s.seconds ?? 0)));
      setText(field('stat-hearts'), String(hearts));
      setText(field('stat-acc'), `${s.accuracy ?? 0}%`);
      setText(field('restart'), 'Play again');
      setText(field('result-hint'), 'Press R to restart');
    },
  };
}
