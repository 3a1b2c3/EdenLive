// SPDX-License-Identifier: Apache-2.0
/** Ashen Wilds HUD overlay, drawn over the generated video from the snapshot. */

const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
const setHTML = (node, html) => { if (node && node.innerHTML !== html) node.innerHTML = html; };
const setHidden = (node, hidden) => { if (node && node.hidden !== hidden) node.hidden = hidden; };
const setStyle = (node, prop, value) => { if (node && node.style.getPropertyValue(prop) !== value) node.style.setProperty(prop, value); };
const setClass = (node, name, on) => { if (node && node.classList.contains(name) !== on) node.classList.toggle(name, on); };

export function mount(root) {
  root.innerHTML = `
    <div id="hud">
      <header>
        <div class="brand"><span>ASHEN WILDS</span><strong>HIGHLAND OATH</strong></div>
        <div class="chapter"><span>THE MEADOW</span><b>STONE CIRCLE</b></div>
        <button type="button" data-game-action="pause" data-field="pause" title="Pause (P)" aria-label="Pause game">Ⅱ</button>
      </header>
      <section class="status">
        <div class="health-head"><b>KNIGHT</b><span data-field="hp-text">6 / 6</span></div>
        <div class="health-track"><i data-field="hp-fill"></i></div>
        <div class="status-foot"><span>STAMINA</span><span data-field="stamina-text">100</span></div>
        <div class="stamina-track"><i data-field="stamina-fill"></i></div>
      </section>
      <section class="objective">
        <span class="label">THE PATH</span>
        <strong data-field="objective">Cross the meadow. Defeat the Stone Warden.</strong>
        <div class="seals" data-field="goat-hud"><span>GOAT</span><b data-field="goat-text">3 / 3</b></div>
        <div class="health-track goat-track"><i data-field="goat-fill"></i></div>
      </section>
      <div class="boss-hud" data-field="boss-hud" hidden><div><span>FINAL ENCOUNTER</span><strong>STONE WARDEN</strong><b data-field="boss-percent">100%</b></div><div class="boss-track"><i data-field="boss-fill"></i></div></div>
      <div class="lock-label" data-field="lock-label">NO LOCK</div>
      <div class="alert" data-field="alert" role="status"></div>
      <div class="ready" data-field="ready" hidden><div class="cue">WASD / J · RISE, ASHEN ONE</div><div class="hint">The knight waits at the path head. Move or strike to begin.</div></div>
      <div class="vignette" data-field="vignette" aria-hidden="true"></div>
      <footer>
        <div class="controls">
          <span><kbd>WASD</kbd> MOVE</span>
          <span><kbd>SHIFT</kbd> SPRINT</span>
          <span><kbd>J</kbd> STRIKE</span>
          <span><kbd>SPACE</kbd> ROLL</span>
          <span><kbd>Q</kbd> LOCK</span>
          <span><kbd>ARROWS</kbd> LOOK</span>
          <span><kbd>P</kbd> PAUSE</span>
        </div>
        <div class="abilities"><span data-field="dodge-ready">ROLL READY</span></div>
      </footer>
    </div>
    <div class="overlay" data-field="overlay" role="dialog" aria-modal="true" hidden>
      <div class="result">
        <span data-field="result-kicker"></span>
        <h1 data-field="result-title"></h1>
        <p data-field="result-text"></p>
        <div class="result-stats" data-field="result-stats"></div>
        <button type="button" data-game-action="resume" data-field="resume" hidden>BACK TO THE MEADOW</button>
        <button type="button" data-game-action="reset" data-field="restart">PLAY AGAIN ↗</button>
        <small data-field="result-hint">PRESS R TO RESTART</small>
      </div>
    </div>
  `;
  const field = name => root.querySelector(`[data-field="${name}"]`);
  return {
    update(state) {
      if (!state) return;
      const hpMax = state.playerHealthMax || 6, goatMax = state.goatHealthMax || 3, bossMax = state.bossHealthMax || 12;
      const hp = state.playerHealth ?? hpMax, stamina = state.stamina ?? 100;
      const goat = state.goatHealth ?? goatMax, boss = state.bossHealth ?? bossMax;
      setStyle(field('hp-fill'), 'width', `${hp / hpMax * 100}%`);
      setText(field('hp-text'), `${hp} / ${hpMax}`);
      setStyle(field('stamina-fill'), 'width', `${stamina}%`);
      setText(field('stamina-text'), String(Math.round(stamina)));
      setStyle(field('goat-fill'), 'width', `${goat / goatMax * 100}%`);
      setText(field('goat-text'), goat > 0 ? `${goat} / ${goatMax}` : 'DOWN');
      setClass(field('goat-hud'), 'down', goat <= 0);
      setStyle(field('boss-fill'), 'width', `${boss / bossMax * 100}%`);
      setText(field('boss-percent'), `${Math.ceil(boss / bossMax * 100)}%`);
      setHidden(field('boss-hud'), !state.bossActive && boss > 0);
      setText(field('objective'), state.objective || '');
      setText(field('lock-label'), state.lockLabel || 'NO LOCK');
      setText(field('alert'), state.alert || '');
      const ready = state.dodgeReady !== false;
      setText(field('dodge-ready'), ready ? 'ROLL READY' : 'LOW STAMINA');
      setClass(field('dodge-ready'), 'cooldown', !ready);
      setStyle(field('vignette'), 'box-shadow', `inset 0 0 90px rgba(255,45,74,${Number(state.vignette || 0).toFixed(3)})`);
      setHidden(field('ready'), state.state !== 'READY');

      // READY is the start line, not an outcome: no card. Pause shares the card.
      const terminal = state.state === 'WON' || state.state === 'LOST';
      const paused = Boolean(state.paused) && !terminal;
      const show = terminal || paused;
      setHidden(field('overlay'), !show);
      const pause = field('pause');
      if (pause && pause.disabled !== show) pause.disabled = show;
      if (!show) return;
      setHidden(field('resume'), !paused);
      setText(field('result-hint'), paused ? 'P / ESC TO RESUME · R TO RESTART' : 'PRESS R TO RESTART');
      if (paused) {
        setText(field('result-kicker'), 'HOLD');
        setText(field('result-title'), 'PAUSED');
        setText(field('result-text'), 'Press P or Escape to return to the highland.');
        setHTML(field('result-stats'), '');
        setText(field('restart'), 'RESTART RUN');
        return;
      }
      const won = state.state === 'WON';
      setText(field('result-kicker'), won ? 'OATH BROKEN' : 'FALLEN');
      setText(field('result-title'), won ? 'HIGHLAND STILL' : 'DOWN, NOT DONE');
      setText(field('result-text'), state.outcomeReason
        || (won ? 'The Stone Warden falls in the circle. The meadow is quiet again.' : ''));
      const n = v => String(Math.max(0, Math.floor(Number(v) || 0)));
      setHTML(field('result-stats'),
        `<span>HITS <b>${n(state.hitCount)}</b></span><span>ROLLS <b>${n(state.dodgeCount)}</b></span><span>TIME <b>${n(state.elapsed)}s</b></span>`);
      setText(field('restart'), won ? 'WALK IT AGAIN ↗' : 'TRY AGAIN ↗');
    },
  };
}
