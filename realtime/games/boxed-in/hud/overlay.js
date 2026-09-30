const ICON = {
  box: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9M7.5 5.5l9 5"/></svg>',
  help: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 8.5a2.5 2.5 0 0 1 5 .5c0 2-2.5 4M12 16.5v.1"/></svg>',
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5 3 10l5 5M3 10h11a6 6 0 0 1 0 12" transform="translate(0 -2)"/></svg>',
  reset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M9 21h6M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 3H9c0-1 0-2-1-3z"/></svg>',
  right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>',
};

const pad = value => String(value).padStart(2, '0');
const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
const setHidden = (node, hidden) => { if (node && node.hidden !== hidden) node.hidden = hidden; };
const setDisabled = (node, disabled) => { if (node && node.disabled !== disabled) node.disabled = disabled; };

export function mount(root) {
  root.innerHTML = `
    <div id="hud">
      <header>
        <div class="brand"><span>BOXED IN</span><strong>A QUIET LITTLE PUZZLE</strong></div>
        <button class="text-button" type="button" data-game-action="help.open">${ICON.help} How to play</button>
      </header>
      <div class="level-header">
        <div>
          <div class="eyebrow" data-field="level-kicker">COURTYARD 01</div>
          <h2 data-field="level-name">First light</h2>
          <p data-field="level-subtitle">Every journey begins with a little push.</p>
        </div>
        <div class="statistics">
          <div><strong data-field="moves">00</strong><span>MOVES</span></div>
          <span class="stat-divider"></span>
          <div><strong data-field="pushes">00</strong><span>PUSHES</span></div>
        </div>
      </div>
      <div class="goal-badge"><span class="goal-symbol"></span><span data-field="goal-count">0 of 2 in place</span><span class="goal-checks" data-field="goal-checks"></span></div>
      <div class="compass" aria-hidden="true"><span class="compass-n">↑</span><span class="compass-w">←</span><span class="compass-e">→</span><span class="compass-s">↓</span><i></i></div>
      <div class="hint-toast" data-field="toast" role="status" hidden></div>
      <div class="play-footer">
        <p class="objective">${ICON.box} Push every crate onto a marked tile.</p>
        <div class="toolbar">
          <button class="tool-button" type="button" data-game-action="undo" data-field="undo">${ICON.undo}Undo <kbd>Z</kbd></button>
          <button class="tool-button" type="button" data-game-action="reset">${ICON.reset}Reset <kbd>R</kbd></button>
          <span class="toolbar-divider"></span>
          <button class="tool-button hint-button" type="button" data-game-action="hint" data-field="hint">${ICON.bulb}Hint <kbd>H</kbd></button>
        </div>
      </div>
    </div>
    <div class="result-wrap" data-field="result" role="dialog" aria-modal="true" hidden>
      <section class="result-card">
        <div class="result-icon" data-field="result-icon">${ICON.check}</div>
        <p class="eyebrow" data-field="result-eyebrow"></p>
        <h2 data-field="result-title"></h2>
        <p data-field="result-copy"></p>
        <div class="result-stats" data-field="result-stats"></div>
        <div class="result-actions">
          <button class="soft-button" type="button" data-game-action="result.secondary" data-field="result-secondary">Play again</button>
          <button class="primary-button" type="button" data-game-action="result.primary" data-field="result-primary">Start again</button>
        </div>
        <div class="small">PRESS R TO RESTART</div>
      </section>
    </div>
    <div class="result-wrap" data-field="help" hidden>
      <section class="help-dialog" role="dialog" aria-modal="true">
        <button class="close-button" type="button" data-game-action="help.close" aria-label="Close instructions">${ICON.close}</button>
        <span class="help-emblem">${ICON.box}</span>
        <p class="eyebrow">WELCOME TO THE GARDEN</p>
        <h2>A little push goes a long way.</h2>
        <p>Help the garden keeper put every wooden crate on a marked destination.</p>
        <div class="help-rules">
          <div><span>01</span><p><b>Find your footing.</b> Move one tile with the arrow keys or WASD.</p></div>
          <div><span>02</span><p><b>Think before you push.</b> Walk into a crate to push it. You can push one at a time, but you cannot pull.</p></div>
          <div><span>03</span><p><b>Make room for mistakes.</b> A box against the wrong wall can get stuck. Press Z to undo, R to restart, or H for a hint.</p></div>
        </div>
        <button class="primary-button" type="button" data-game-action="help.close">Let's make some space ${ICON.right}</button>
      </section>
    </div>
  `;
  const field = name => root.querySelector(`[data-field="${name}"]`);
  return {
    update(state) {
      if (!state) return;
      setText(field('level-kicker'), `COURTYARD ${pad(Number(state.levelIndex) + 1)}`);
      setText(field('level-name'), state.levelName || '');
      setText(field('level-subtitle'), state.levelSubtitle || '');
      setText(field('moves'), pad(state.moves ?? 0));
      setText(field('pushes'), pad(state.pushes ?? 0));
      setText(field('goal-count'), `${state.goalsFilled ?? 0} of ${state.goalCount ?? 0} in place`);
      const checks = field('goal-checks');
      if (checks) {
        const count = Number(state.goalCount) || 0;
        const filled = Number(state.goalsFilled) || 0;
        checks.innerHTML = Array.from({length: count}, (_, i) => `<i class="${i < filled ? 'filled' : ''}"></i>`).join('');
      }
      setDisabled(field('undo'), !state.historyDepth);
      setDisabled(field('hint'), state.state !== 'RUNNING' || state.hintBusy);
      const toast = field('toast');
      const showingToast = Boolean(state.toast);
      setHidden(toast, !showingToast);
      if (showingToast) setText(toast, state.toast);
      setHidden(field('help'), !state.helpOpen);
      const terminal = state.state && state.state !== 'RUNNING';
      setHidden(field('result'), !(terminal && !state.helpOpen));
      if (!terminal) return;
      const won = state.state === 'WON';
      field('result-icon').innerHTML = won ? ICON.check : ICON.undo;
      setText(field('result-eyebrow'), won ? 'A LITTLE MOMENT OF ORDER' : 'THERE IS ALWAYS ANOTHER WAY');
      setText(field('result-title'), won ? 'Everything in its place.' : 'A little room to rethink.');
      setText(field('result-copy'), won
        ? 'Every crate has found its home. Take another run whenever you like.'
        : 'This crate cannot reach a marked tile from here. Undo the last push and try a different approach.');
      setText(field('result-stats'), `${state.moves ?? 0} moves  ·  ${state.pushes ?? 0} pushes`);
      setText(field('result-secondary'), won ? 'Play again' : 'Start over');
      field('result-primary').innerHTML = won
        ? `Start again ${ICON.reset}`
        : `${ICON.undo} Undo last push`;
    },
  };
}
