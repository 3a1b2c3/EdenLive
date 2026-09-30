const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
const setHidden = (node, hidden) => { if (node && node.hidden !== hidden) node.hidden = hidden; };
const pad = (value, width = 2) => String(value).padStart(width, '0');

export function mount(root) {
  root.innerHTML = `
    <div id="hud">
      <div class="top-left">
        <div class="brand">
          <div class="label">MIDNIGHT STREET LEAGUE</div>
          <div class="value">NEON CIRCUIT</div>
          <div class="detail">NEON SPEED / CITY NIGHT RACE</div>
        </div>
        <div class="panel status">
          <div class="label">TIME LEFT</div>
          <div class="value" data-field="time">85.0 s</div>
          <div class="detail" data-field="status">Three laps, first across the line</div>
        </div>
      </div>
      <div class="top-right">
        <div class="panel metric"><div class="label">POSITION</div><div class="value accent" data-field="rank">04</div><div class="detail">/ 04</div></div>
        <div class="panel metric"><div class="label">LAP</div><div class="value" data-field="lap">01</div><div class="detail">/ 03</div></div>
      </div>
      <div class="bottom-left">
        <div class="panel speed"><div class="label">SPEED</div><div class="value" data-field="speed">000</div><div class="unit">KM/H</div></div>
        <div class="panel boost">
          <div class="label">NITRO BOOST</div><div class="boost-value" data-field="boost">—</div>
          <div class="bar"><div data-field="boost-bar"></div></div>
          <div class="detail" data-field="boost-hint">Run over the green glow strips to boost</div>
        </div>
      </div>
      <div class="bottom-right">
        <div class="panel damage">
          <div class="label">CONTACTS</div>
          <div class="value" data-field="damage">○ ○ ○</div>
          <div class="detail" data-field="damage-hint">0 / 3 · Keep your distance</div>
        </div>
        <div class="controls">W / ↑ throttle &nbsp; S / ↓ brake<br>A D / ← → steer &nbsp; R restart</div>
      </div>
      <div class="ready" data-field="ready" hidden>
        <div class="eyebrow"><span class="live-dot"></span> MIDNIGHT STREET LEAGUE / 01</div>
        <div class="launch"><kbd>W</kbd><span>or</span><kbd>↑</kbd><strong>hold, and drive into the night</strong><span class="arrow">↗</span></div>
        <div class="note">3 laps · 4 racers · 85 second limit · roll over the green boost packs</div>
      </div>
    </div>
    <div class="result" data-field="result" role="dialog" aria-modal="true" hidden>
      <div class="card">
        <div class="eyebrow" data-field="result-eyebrow"></div>
        <div class="rank" data-field="result-rank"></div>
        <h2 data-field="result-title"></h2>
        <p data-field="result-reason"></p>
        <dl class="stats">
          <div><dt>Race time</dt><dd data-field="result-time"></dd></div>
          <div><dt>Boost packs</dt><dd data-field="result-boosts"></dd></div>
          <div><dt>Laps completed</dt><dd data-field="result-laps"></dd></div>
        </dl>
        <div class="best">Fastest lap <strong data-field="result-best"></strong></div>
        <button class="restart" type="button" data-game-action="reset"><kbd>R</kbd> race again ↻</button>
      </div>
    </div>
  `;
  const field = name => root.querySelector(`[data-field="${name}"]`);
  const hud = root.querySelector('#hud');
  return {
    update(state) {
      if (!state) return;
      const ready = state.state === 'READY';
      const running = state.state === 'RUNNING' || ready;
      const won = state.state === 'WON';
      const crashes = state.crashes ?? 0;
      const limit = state.crashLimit ?? 3;
      const timeLeft = Math.max(0, (state.raceLimit ?? 85) - (state.elapsed ?? 0));
      const boost = state.boostSeconds ?? 0;
      setText(field('time'), `${timeLeft.toFixed(1)} s`);
      setText(field('status'), ready ? 'Three laps, first across the line'
        : running ? 'Fight for first along the neon roads' : won ? 'Race complete' : 'Race over');
      setText(field('rank'), pad(state.rank ?? 4));
      setText(field('lap'), pad(state.lap ?? 1));
      setText(field('speed'), pad(Math.round((state.speed ?? 0) * 8), 3));
      setText(field('boost'), running && boost > 0 ? `${boost.toFixed(1)} s` : '—');
      setText(field('boost-hint'), running && boost > 0 ? 'Boost active' : 'Run over the green glow strips to boost');
      const bar = field('boost-bar');
      const width = `${Math.min(1, boost / 3.5) * 100}%`;
      if (bar && bar.style.width !== width) bar.style.width = width;
      setText(field('damage'), `${'● '.repeat(Math.min(limit, crashes))}${'○ '.repeat(Math.max(0, limit - crashes))}`.trim());
      setText(field('damage-hint'), `${crashes} / ${limit} · ${crashes >= 2 ? 'Dodge the rivals!' : 'Keep your distance'}`);
      hud.classList.toggle('boosting', running && boost > 0 && !state.braking);
      hud.classList.toggle('critical', timeLeft < 10 || crashes >= 2);
      setHidden(field('ready'), !ready);
      // READY is the grid, not an outcome: no result card.
      const terminal = state.state === 'WON' || state.state === 'LOST';
      setHidden(field('result'), !terminal);
      if (!terminal) return;
      const laps = Array.isArray(state.lapTimes) ? state.lapTimes : [];
      setText(field('result-eyebrow'), won ? 'RACE COMPLETE / WINNER' : 'RACE OVER / DEFEATED');
      setText(field('result-rank'), `P${state.rank ?? 4}`);
      setText(field('result-title'), won ? 'The city, it belongs to you.' : 'Next lap, a little faster.');
      setText(field('result-reason'), state.outcomeReason || '');
      setText(field('result-time'), `${(state.elapsed ?? 0).toFixed(2)} s`);
      setText(field('result-boosts'), String(state.boostCount ?? 0));
      setText(field('result-laps'), `${state.lapsCompleted ?? 0} / 3`);
      setText(field('result-best'), laps.length ? `${Math.min(...laps).toFixed(2)} s` : '—');
    },
  };
}
