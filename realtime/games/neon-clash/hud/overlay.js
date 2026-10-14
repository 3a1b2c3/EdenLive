// SPDX-License-Identifier: Apache-2.0
/** Neon Clash HUD overlay, drawn over the generated video from the transport snapshot. */

const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
const setHTML = (node, html) => { if (node && node.innerHTML !== html) node.innerHTML = html; };
const setHidden = (node, hidden) => { if (node && node.hidden !== hidden) node.hidden = hidden; };
const setScaleX = (node, value) => {
  const next = `scaleX(${value})`;
  if (node && node.style.transform !== next) node.style.transform = next;
};
const ratio = f => Math.max(0, Math.min(1, (f?.hp ?? 100) / (f?.maxHp || 100)));

export function mount(root) {
  root.innerHTML = `
    <div id="hud">
      <header><div class="brand"><span>ARCADE SERIES / 001</span><strong>NEON CLASH</strong></div><div class="chapter"><span>ROUND 01</span><b>STREET DUEL</b></div></header>
      <section class="status player-hud">
        <div class="fighter-name"><span><b>KAI</b><small>YOU / THE CHALLENGER</small></span><em data-field="player-hp">100</em></div>
        <div class="health-track"><div data-field="player-trail" class="health-trail"></div><div data-field="player-health" class="health-fill"></div></div>
      </section>
      <section class="objective rival-hud">
        <div class="fighter-name"><em data-field="rival-hp">100</em><span><b>RAZE</b><small>CPU / THE STREET KING</small></span></div>
        <div class="health-track"><div data-field="rival-trail" class="health-trail"></div><div data-field="rival-health" class="health-fill"></div></div>
      </section>
      <div class="versus"><span>ROUND 01</span><strong>VS</strong><small data-field="match-clock">00:00</small></div>
      <div class="feedback" data-field="feedback" aria-live="polite"></div>
      <div class="round-banner" data-field="round-banner" hidden></div>
      <div class="ready" data-field="ready" hidden><div class="cue">MOVE / J · START THE DUEL</div><div class="hint">Kai and Raze hold their stance until you make the first move.</div></div>
      <footer>
        <div class="controls">
          <span><kbd>A D</kbd> MOVE</span>
          <span><kbd>W / SPACE</kbd> JUMP</span>
          <span><kbd>J</kbd> PUNCH</span>
          <span><kbd>K</kbd> KICK</span>
          <span><kbd>L</kbd> GUARD</span>
          <span><kbd>P</kbd> PAUSE</span>
          <span><kbd>R</kbd> RESTART</span>
        </div>
        <div class="abilities"><span data-field="round-state">STREET DUEL</span></div>
      </footer>
    </div>
    <div class="overlay" data-field="overlay" role="dialog" aria-modal="true" hidden>
      <div class="result">
        <span data-field="result-kicker"></span>
        <h1 data-field="result-title"></h1>
        <p data-field="result-text"></p>
        <div class="result-stats" data-field="result-stats"></div>
        <button type="button" data-game-action="resume" data-field="resume" hidden>CONTINUE</button>
        <button type="button" data-game-action="reset" data-field="restart">PLAY AGAIN <span>↗</span></button>
        <small data-field="result-hint">PRESS R TO RESTART</small>
      </div>
    </div>
  `;
  const field = name => root.querySelector(`[data-field="${name}"]`);
  return {
    update(state) {
      if (!state) return;
      const player = state.player || {}, rival = state.rival || {};
      setText(field('player-hp'), String(Math.round(player.hp ?? 100)));
      setText(field('rival-hp'), String(Math.round(rival.hp ?? 100)));
      setScaleX(field('player-health'), ratio(player));
      setScaleX(field('player-trail'), ratio(player));
      setScaleX(field('rival-health'), ratio(rival));
      setScaleX(field('rival-trail'), ratio(rival));
      const seconds = Math.floor(state.elapsed ?? 0);
      setText(field('match-clock'), `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`);
      setText(field('feedback'), state.feedback || '');
      setText(field('round-state'), state.status || 'STREET DUEL');
      // The card already says PAUSED / YOU WIN / K.O.; the banner would sit under it.
      const terminal = state.state === 'WON' || state.state === 'LOST';
      const paused = Boolean(state.paused) && !terminal;
      const banner = terminal || paused ? '' : state.banner || '';
      setText(field('round-banner'), banner);
      setHidden(field('round-banner'), !banner);
      setHidden(field('ready'), state.state !== 'READY');
      // READY is the start line, not an outcome: no card.
      setHidden(field('overlay'), !(terminal || paused));
      if (!(terminal || paused)) return;
      setHidden(field('resume'), !paused);
      setText(field('result-hint'), paused ? 'P / ESC TO RESUME · R TO RESTART' : 'PRESS R TO RESTART');
      if (paused) {
        setText(field('result-kicker'), 'ROUND ON HOLD');
        setText(field('result-title'), 'PAUSED');
        setText(field('result-text'), 'Take a breath. The street is waiting.');
        setHTML(field('result-stats'), `<span>TIME <b>${seconds}s</b></span><span>HP <b>${Math.round(player.hp ?? 100)}</b></span>`);
        setText(field('restart'), 'RESTART ROUND');
      } else {
        const won = state.state === 'WON';
        setText(field('result-kicker'), won ? 'RUN COMPLETE' : 'ROUND ENDED');
        setText(field('result-title'), won ? 'YOU WIN' : 'K.O.');
        setText(field('result-text'), won ? 'Raze is down. The block belongs to Kai.' : 'Raze takes the round. Reset and step back in.');
        setHTML(field('result-stats'), `<span>TIME <b>${seconds}s</b></span><span>HITS <b>${player.hits ?? 0}</b></span><span>MAX COMBO <b>${player.maxCombo ?? 0}</b></span>`);
        setText(field('restart'), won ? 'FIGHT AGAIN ↗' : 'TRY AGAIN ↗');
      }
    },
  };
}
