const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
const setHidden = (node, hidden) => { if (node && node.hidden !== hidden) node.hidden = hidden; };
const pad = value => String(value).padStart(2, '0');

export function mount(root) {
  root.innerHTML = `
    <div id="hud">
      <div class="brand">
        <div class="eyebrow">✦ EXPEDITION 01</div>
        <div class="title">MOONSTONE<br>RUN</div>
        <div class="sub">ASTROBOT / LUNAR ADVENTURE</div>
      </div>
      <div class="meter">
        <span class="star">✦</span>
        <div class="label">MOON COINS</div>
        <div class="value" data-field="coins">00 / 12</div>
        <div class="bar"><div data-field="progress"></div></div>
      </div>
      <div class="bottom-left">
        <div class="panel">
          <div class="label">YOUR MISSION</div>
          <div class="value" data-field="objective">Follow the gold.</div>
          <div class="detail">Jump between the giant stones. Collect all 12 moon coins to win.</div>
        </div>
        <div class="controls"><b>W A S D / ↑ ↓ ← →</b> Move · <b>SPACE</b> Jump · <b>R</b> Restart</div>
      </div>
      <div class="notice" data-field="toast" hidden>
        <div class="label">CACHE UPDATED</div>
        <div class="value">+1 MOON COIN</div>
        <div class="detail" data-field="toast-left"></div>
      </div>
      <div class="ready" data-field="ready" hidden>
        <div class="cue">SPACE / WASD · LIFT OFF</div>
        <div class="hint">The robot waits on the launch pad until you move.</div>
      </div>
    </div>
    <div class="result" data-field="result" role="dialog" aria-modal="true" hidden>
      <div class="card">
        <div class="kicker" data-field="result-kicker"></div>
        <div class="icon" data-field="result-icon"></div>
        <h1 data-field="result-title"></h1>
        <p data-field="result-reason"></p>
        <div class="stats">
          <div><strong data-field="result-coins"></strong><span>MOON COINS</span></div>
          <div><strong data-field="result-time"></strong><span>RUN TIME</span></div>
        </div>
        <button class="restart" type="button" data-game-action="reset">Let's go again ↗</button>
        <div class="small">PRESS R TO RESTART</div>
      </div>
    </div>
  `;
  const field = name => root.querySelector(`[data-field="${name}"]`);
  const card = root.querySelector('.result');
  return {
    update(state) {
      if (!state) return;
      const coins = state.coins ?? 0;
      const total = state.total ?? 12;
      setText(field('coins'), `${pad(coins)} / ${total}`);
      const progress = field('progress');
      const width = `${Math.min(1, coins / Math.max(1, total)) * 100}%`;
      if (progress && progress.style.width !== width) progress.style.width = width;
      setText(field('objective'), coins === total - 1 ? 'One last golden spark.' : 'Follow the gold.');
      setHidden(field('ready'), state.state !== 'READY');
      setHidden(field('toast'), !state.toast);
      setText(field('toast-left'), `${total - coins} left to discover`);
      // READY is the launch pad, not an outcome: no result card.
      const terminal = state.state === 'WON' || state.state === 'LOST';
      setHidden(field('result'), !terminal);
      if (!terminal) return;
      const won = state.state === 'WON';
      card.classList.toggle('failure', !won);
      setText(field('result-kicker'), won ? 'MISSION COMPLETE' : 'SIGNAL LOST');
      setText(field('result-icon'), won ? '✦' : '×');
      setText(field('result-title'), won ? 'Stellar work!' : 'One more leap.');
      setText(field('result-reason'), won
        ? `${state.outcomeReason}. The stars are yours.`
        : `${state.outcomeReason}. Aim for the pale stone tops and try again.`);
      setText(field('result-coins'), `${coins} / ${total}`);
      setText(field('result-time'), `${(state.elapsed ?? 0).toFixed(1)}s`);
    },
  };
}
