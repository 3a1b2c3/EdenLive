// SPDX-License-Identifier: Apache-2.0
/** Street of Rage HUD overlay, drawn over the generated video from the transport snapshot. */

const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
const setHTML = (node, html) => { if (node && node.innerHTML !== html) node.innerHTML = html; };
const setHidden = (node, hidden) => { if (node && node.hidden !== hidden) node.hidden = hidden; };
const setWidth = (node, width) => { if (node && node.style.width !== width) node.style.width = width; };
const setClass = (node, name, on) => { if (node && node.classList.contains(name) !== on) node.classList.toggle(name, on); };

export function mount(root) {
  root.innerHTML = `
    <div id="hud">
      <header><div class="brand"><span>STREET OF RAGE</span><strong>NIGHTFANG<span class="dot">.</span></strong></div><div class="chapter"><span>CHAPTER 01</span><b>THE MIDNIGHT DISTRICT</b></div><button type="button" data-game-action="sound" data-field="sound" aria-label="Toggle sound">SOUND OFF</button><button type="button" class="pause" data-game-action="pause" aria-label="Pause game">Ⅱ</button></header>
      <section class="status"><div class="health-head"><b>ROOK</b><span data-field="hp-text">120 / 120</span></div><div class="health-track"><i data-field="hp-fill"></i></div><div class="status-foot"><span>THE LAST FIGHTER</span><span class="score" data-field="score">000000</span></div></section>
      <section class="objective"><span class="label" data-field="objective-label">CLEAR THE STREET</span><strong data-field="objective">Defeat the vampire wardens</strong><div class="seals"><span data-field="seal-one">Ⅰ</span><span data-field="seal-two">Ⅱ</span><b data-field="count">0 / 2</b></div></section>
      <div class="boss-hud" data-field="boss-hud" hidden><div><span>FINAL ENCOUNTER</span><strong>ASHWING, THE CRIMSON DRAKE</strong><b data-field="boss-percent">100%</b></div><div class="boss-track"><i data-field="boss-fill"></i></div></div>
      <div class="banner" data-field="banner" hidden><span>NIGHT 01 · 03:47 AM</span><strong data-field="banner-text"></strong></div>
      <div class="combo" data-field="combo"></div>
      <div class="go" data-field="go" hidden>GO <b>→</b></div>
      <div class="alert" data-field="alert"></div>
      <div class="ready" data-field="ready" hidden><div class="cue">J / MOVE · START</div><div class="hint">Rook waits at the kerb until you move or strike.</div></div>
      <footer><div class="controls"><span><kbd>W A S D</kbd> MOVE</span><span><kbd>J</kbd> STRIKE</span><span><kbd>K</kbd> HEAVY</span><span><kbd>SHIFT</kbd> DODGE</span><span><kbd>P</kbd> PAUSE</span><span><kbd>R</kbd> RESTART</span></div><div class="abilities"><span data-field="heavy-ready">HEAVY READY</span><span data-field="dash-ready">DODGE READY</span></div></footer>
    </div>
    <div class="overlay" data-field="overlay" role="dialog" aria-modal="true" hidden><div class="result"><span data-field="result-kicker"></span><h1 data-field="result-title"></h1><p data-field="result-text"></p><div class="result-stats" data-field="result-stats"></div><div class="buttons"><button type="button" data-game-action="resume" data-field="resume" hidden>BACK TO THE STREET</button><button type="button" data-game-action="reset" data-field="restart">PLAY AGAIN ↗</button></div><small data-field="result-hint">PRESS R TO RESTART</small></div></div>
  `;
  const field = name => root.querySelector(`[data-field="${name}"]`);
  return {
    update(state) {
      if (!state) return;
      const hp = state.hp ?? 120, maxHp = state.maxHp || 120;
      setWidth(field('hp-fill'), `${hp / maxHp * 100}%`);
      setText(field('hp-text'), `${hp} / ${maxHp}`);
      setText(field('score'), String(state.score ?? 0).padStart(6, '0'));
      setText(field('count'), `${state.kills ?? 0} / 2`);
      const seals = state.seals || [];
      setClass(field('seal-one'), 'done', Boolean(seals[0]));
      setClass(field('seal-two'), 'done', Boolean(seals[1]));
      setText(field('objective'), state.objective || '');
      setText(field('objective-label'), state.objectiveLabel || '');
      const boss = state.phase === 'boss';
      setHidden(field('boss-hud'), !boss);
      if (boss) {
        const ratio = (state.bossHp ?? 0) / (state.bossMaxHp || 1);
        setWidth(field('boss-fill'), `${ratio * 100}%`);
        setText(field('boss-percent'), `${Math.ceil(ratio * 100)}%`);
      }
      setHTML(field('combo'), state.combo > 1 ? `<strong>${state.combo}<i> HIT</i></strong><span>${state.comboLabel || 'COMBO'}</span>` : '');
      setHidden(field('banner'), !state.banner);
      setText(field('banner-text'), state.banner || '');
      setHidden(field('go'), !state.go);
      setText(field('alert'), state.alert || '');
      setText(field('heavy-ready'), state.heavyText || 'HEAVY READY');
      setClass(field('heavy-ready'), 'cooldown', Boolean(state.heavyCooldown));
      setText(field('dash-ready'), state.dashText || 'DODGE READY');
      setText(field('sound'), state.soundOn ? 'SOUND ON' : 'SOUND OFF');
      setHidden(field('ready'), state.state !== 'READY');

      // READY is the start line, not an outcome: no card. Pause shares the result card.
      const terminal = state.state === 'WON' || state.state === 'LOST';
      const paused = Boolean(state.paused) && !terminal;
      setHidden(field('overlay'), !(terminal || paused));
      if (!(terminal || paused)) return;
      setHidden(field('resume'), !paused);
      setText(field('result-hint'), paused ? 'P / ESC TO RESUME · R TO RESTART' : 'PRESS R TO RESTART');
      if (paused) {
        setText(field('result-kicker'), 'TAKE A BREATH');
        setText(field('result-title'), 'PAUSED');
        setText(field('result-text'), 'Press P or Escape to return to the street.');
        setHTML(field('result-stats'), '');
        setText(field('restart'), 'RESTART RUN');
        return;
      }
      const won = state.state === 'WON';
      setText(field('result-kicker'), won ? 'CHAPTER 01 · COMPLETE' : 'THE CITY NEVER SLEEPS');
      setText(field('result-title'), won ? 'STREET CLEARED' : 'DOWN, NOT OUT');
      setText(field('result-text'), won ? 'Two wardens silenced. One dragon fallen. Dawn belongs to you.' : 'The night has teeth. Get up and take another shot.');
      setHTML(field('result-stats'), `<span>SCORE <b>${Number(state.score) || 0}</b></span><span>BEST COMBO <b>${Number(state.bestCombo) || 0}</b></span><span>TIME <b>${Math.floor(Number(state.elapsed) || 0)}s</b></span>`);
      setText(field('restart'), won ? 'RUN IT BACK ↗' : 'TRY AGAIN ↗');
    },
  };
}
