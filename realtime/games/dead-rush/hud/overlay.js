const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
const setHidden = (node, hidden) => { if (node && node.hidden !== hidden) node.hidden = hidden; };
const setStyle = (node, prop, value) => { if (node && node.style.getPropertyValue(prop) !== value) node.style.setProperty(prop, value); };

// Mirrors simulation.js: the client only loads hud/, so the city grid and the
// profession colours are restated here for the minimap.
const ROLE_COLORS = {mage: '#a000ff', warrior: '#ff2000', nurse: '#00d8d8', firefighter: '#ff8000', police: '#0060ff', worker: '#00c000'};
const BLOCKS = [];
for (const x of [-37, -14, 14, 37]) for (const z of [-37, -14, 14, 37]) {
  BLOCKS.push({x, z, w: Math.abs(x) === 37 ? 12 : 13, d: Math.abs(z) === 37 ? 12 : 13});
}

export function mount(root) {
  root.innerHTML = `
    <div id="hud">
      <header class="topbar">
        <div class="brand"><span class="eyebrow">ARCADE / VOL. 01</span><h1>DEAD<span>RUSH</span><b>↗</b></h1><small>City Rush</small></div>
        <div class="score-panel"><span class="eyebrow">Round score</span><div><strong data-field="score">000</strong><span class="target" data-field="target"> / 600</span></div><div class="score-pips" data-field="pips">${'<i></i>'.repeat(6)}</div></div>
        <div class="health-panel"><div class="health-line"><span class="eyebrow">Vehicle health</span><b data-field="health">100%</b></div><div class="health-track"><i data-field="health-fill"></i></div><span class="health-hint">Wall hit −20 · empty fails the run</span></div>
        <div class="top-buttons"><button type="button" data-game-action="pause" aria-label="Pause game">Ⅱ</button><button type="button" data-game-action="mute" data-field="sound" aria-label="Toggle sound">♪</button></div>
      </header>
      <aside class="mission"><span class="eyebrow">Street challenge</span><h2>Six professions, random encounters.</h2><p>Each launch <b>+100</b><br>Same pedestrian twice — fatality</p><div class="profession-list"><span style="--role:#a481ff">Mage</span><span style="--role:#ee7864">Warrior</span><span style="--role:#68d5cd">Nurse</span><span style="--role:#fbc75b">Firefighter</span><span style="--role:#77a7ef">Police</span><span style="--role:#e8a760">Worker</span></div><div class="mission-footer"><span>Launches <b data-field="hits">0</b></span><span>Deaths <b data-field="deaths">0</b></span></div></aside>
      <div class="feed" data-field="toast" role="status"></div>
      <div class="ready" data-field="ready" hidden><div class="cue">W / ↑ · HIT THE GAS</div><div class="hint">The coupe idles at the kerb until you drive.</div></div>
      <div class="speedometer"><span class="eyebrow" data-field="gear">READY</span><div><strong data-field="speed">0</strong><span>KM/H</span></div><div class="speed-line"><i data-field="speed-fill"></i></div><small data-field="drive-hint">Hold W or ↑ to throttle</small></div>
      <aside class="map-panel"><div class="map-title"><span class="eyebrow">City map</span><span class="live-dot">LIVE</span></div><canvas data-field="map" width="180" height="180" aria-label="City minimap — the yellow triangle is your car, the coloured dots are pedestrians"></canvas><div class="map-caption">Yellow arrow · your car <span>N ↑</span></div></aside>
      <footer class="controls"><span><kbd>W A S D</kbd> / <kbd>↑ ← ↓ →</kbd> drive</span><span><kbd>SPACE</kbd> brake</span><span><kbd>SHIFT</kbd> boost</span><span><kbd>P</kbd> pause</span><span><kbd>R</kbd> restart</span></footer>
      <div class="vignette" data-field="vignette" aria-hidden="true"></div>
    </div>
    <div class="result" data-field="result" role="dialog" aria-modal="true" hidden>
      <section class="result-card">
        <span class="eyebrow" data-field="result-kicker"></span>
        <div class="result-icon" data-field="result-icon"></div>
        <h2 data-field="result-title"></h2>
        <p data-field="result-reason"></p>
        <div class="result-stats">
          <div><strong data-field="result-score"></strong><small>Round score</small></div>
          <div><strong data-field="result-hits"></strong><small>Launches</small></div>
          <div><strong data-field="result-deaths"></strong><small>Deaths</small></div>
        </div>
        <button class="primary" type="button" data-game-action="reset">Play again <span>R</span></button>
        <button class="secondary" type="button" data-game-action="resume" data-field="resume" hidden>Keep driving <span>P</span></button>
      </section>
    </div>
  `;
  const field = name => root.querySelector(`[data-field="${name}"]`);
  const pips = [...field('pips').querySelectorAll('i')];
  const map = field('map').getContext('2d');
  function drawMap(state) {
    map.clearRect(0, 0, 180, 180);
    map.fillStyle = '#25434a'; map.fillRect(4, 4, 172, 172);
    const scale = 1.72, pos = v => 90 + v * scale;
    map.fillStyle = '#658278';
    for (const b of BLOCKS) map.fillRect(pos(b.x - b.w / 2), pos(b.z - b.d / 2), b.w * scale, b.d * scale);
    map.strokeStyle = '#91a68a'; map.lineWidth = 1; map.strokeRect(7, 7, 166, 166);
    for (const p of state.people || []) {
      map.fillStyle = ROLE_COLORS[p.role] || '#ffffff';
      map.beginPath(); map.arc(pos(p.x), pos(p.z), p.hit ? 2.6 : 1.7, 0, Math.PI * 2); map.fill();
    }
    const car = state.car || {x: 0, z: 0, yaw: 0};
    map.save(); map.translate(pos(car.x), pos(car.z)); map.rotate(-car.yaw);
    map.fillStyle = '#ffe074'; map.strokeStyle = '#263e42'; map.lineWidth = 1.5;
    map.beginPath(); map.moveTo(0, -6); map.lineTo(4, 4); map.lineTo(0, 2); map.lineTo(-4, 4); map.closePath();
    map.fill(); map.stroke(); map.restore();
  }
  return {
    update(state) {
      if (!state) return;
      const health = state.health ?? 100;
      setText(field('score'), String(state.score ?? 0).padStart(3, '0'));
      setText(field('target'), ` / ${state.targetScore ?? 600}`);
      pips.forEach((pip, i) => pip.classList.toggle('on', (state.hits ?? 0) > i));
      setText(field('health'), `${health}%`);
      setStyle(field('health-fill'), 'width', `${health}%`);
      setStyle(field('health-fill'), 'background', health <= 40 ? '#ef7760' : '#a9dcc6');
      setText(field('hits'), String(state.hits ?? 0));
      setText(field('deaths'), String(state.deaths ?? 0));
      setText(field('gear'), state.gear || 'READY');
      setText(field('speed'), String(state.speedKmh ?? 0));
      setStyle(field('speed-fill'), 'width', `${(state.speedRatio ?? 0) * 100}%`);
      setText(field('drive-hint'), state.driveHint || '');
      setText(field('toast'), state.toast || '');
      setStyle(field('vignette'), 'opacity', String((state.flash ?? 0) * 0.7));
      setText(field('sound'), state.muted ? '♪̸' : '♪');
      setHidden(field('ready'), state.state !== 'READY');
      drawMap(state);
      // READY is the start line, not an outcome: no card. Pause shares the card.
      const terminal = state.state === 'WON' || state.state === 'LOST';
      const paused = Boolean(state.paused) && !terminal;
      setHidden(field('result'), !(terminal || paused));
      if (!(terminal || paused)) return;
      const won = state.state === 'WON';
      setHidden(field('resume'), !paused);
      setText(field('result-kicker'), paused ? 'TAKE A BREATH' : won ? 'MISSION COMPLETE' : 'RUN ENDED');
      setText(field('result-title'), paused ? 'Hold on' : won ? 'City Legend' : 'Wrecked');
      setText(field('result-icon'), paused ? 'Ⅱ' : won ? '↗' : '×');
      setText(field('result-reason'), paused ? 'Game paused — press P to get moving again.'
        : won ? '600 points! The city remembers your tail lights.'
        : 'A wall crash drained the car. Next run, leave some braking distance.');
      setText(field('result-score'), String(state.score ?? 0));
      setText(field('result-hits'), String(state.hits ?? 0));
      setText(field('result-deaths'), String(state.deaths ?? 0));
    },
  };
}
