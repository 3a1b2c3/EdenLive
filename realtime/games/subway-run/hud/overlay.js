const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
const setHidden = (node, hidden) => { if (node && node.hidden !== hidden) node.hidden = hidden; };
const pad = value => String(value).padStart(2, '0');

export function mount(root) {
  root.innerHTML = `
    <div id="hud">
      <div class="top">
        <div>
          <div class="eyebrow">THREE LANES / ONE RUN</div>
          <div class="brand">SUBWAY RUN</div>
          <div class="sub">Ride the rooftops. Follow the coins.</div>
        </div>
        <div class="scorebox">
          <div class="goal">COLLECT 10 COINS TO WIN</div>
          <div class="scoreline"><span class="coin">◉</span><span class="score" data-field="score">00</span><span class="denom" data-field="denom">/ 10</span></div>
          <div class="meter"><div data-field="progress"></div></div>
          <div class="meta"><span data-field="lane">CENTER LANE</span><span data-field="distance">0 m</span></div>
        </div>
      </div>
      <div id="toast" data-field="toast"></div>
      <div class="bottom">
        <div id="cue" data-field="cue">KEEP YOUR RHYTHM</div>
        <div id="hint" data-field="hint">Follow the coin trail and collect 10 coins.</div>
        <div class="controls">
          <span><kbd>← →</kbd>LANES</span>
          <span><kbd>SPACE</kbd>JUMP</span>
          <span><kbd>↓</kbd>SLIDE</span>
          <span><kbd>R</kbd>RESTART</span>
        </div>
      </div>
    </div>
    <div class="result" data-field="result" role="dialog" aria-modal="true" hidden>
      <div class="card">
        <div class="badge">SUBWAY RUN / RESULT</div>
        <h1 data-field="result-title"></h1>
        <p class="result-reason" data-field="result-reason"></p>
        <button class="restart" type="button" data-game-action="reset">RUN AGAIN ↗</button>
        <div class="small">PRESS R TO RESTART</div>
      </div>
    </div>
  `;
  const field = name => root.querySelector(`[data-field="${name}"]`);
  const hud = root.querySelector('#hud');
  return {
    update(state) {
      if (!state) return;
      setText(field('score'), pad(state.score ?? 0));
      setText(field('denom'), `/ ${state.targetScore ?? 10}`);
      setText(field('distance'), `${Math.floor(state.distance || 0)} m`);
      setText(field('lane'), state.laneLabel || 'CENTER LANE');
      const progress = field('progress');
      const width = `${Math.min(1, (state.score || 0) / Math.max(1, state.targetScore || 10)) * 100}%`;
      if (progress && progress.style.width !== width) progress.style.width = width;
      setText(field('cue'), state.cueTitle || 'KEEP YOUR RHYTHM');
      setText(field('hint'), state.cueHint || '');
      if (hud && hud.dataset.cue !== state.cue) hud.dataset.cue = state.cue || '';
      const toast = field('toast');
      const showingToast = Boolean(state.toast);
      if (toast) {
        toast.classList.toggle('show', showingToast);
        if (showingToast) setText(toast, state.toast);
      }
      // READY is the starting line, not an outcome: no result card.
      const terminal = state.state && state.state !== 'RUNNING' && state.state !== 'READY';
      setHidden(field('result'), !terminal);
      if (!terminal) return;
      setText(field('result-title'), state.state === 'WON' ? 'RUN COMPLETE!' : 'TRY AGAIN');
      setText(
        field('result-reason'),
        `${state.outcomeReason || ''} Coins ${state.score ?? 0}/${state.targetScore ?? 10} · Distance ${Math.floor(state.distance || 0)} m`,
      );
    },
  };
}
