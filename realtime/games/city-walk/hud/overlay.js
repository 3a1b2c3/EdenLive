// SPDX-License-Identifier: Apache-2.0
/** City Walk HUD overlay, drawn over the generated video from the snapshot. */

const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
const setHidden = (node, hidden) => { if (node && node.hidden !== hidden) node.hidden = hidden; };
const setStyle = (node, prop, value) => { if (node && node.style.getPropertyValue(prop) !== value) node.style.setProperty(prop, value); };
const setClass = (node, name, on) => { if (node && node.classList.contains(name) !== on) node.classList.toggle(name, on); };

// Seconds a ring adds to the clock (RULES.bonusSeconds in game.mjs).
const BONUS_SECONDS = 8;

export function mount(root) {
  root.innerHTML = `
    <div id="hud">
      <div class="panel" id="score-panel">
        <div class="label">Score</div>
        <div class="score-line"><span class="score" data-field="score">0</span><small class="score-target" data-field="score-target"> / 100</small></div>
        <div class="meter" data-field="meter" role="progressbar" aria-label="Score progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i data-field="score-bar"></i></div>
      </div>
      <div class="panel" id="clock-panel" data-field="clock-panel">
        <div class="label">Time left</div>
        <div class="clock" data-field="clock">0:30</div>
        <div class="clock-bonus" data-field="clock-bonus"></div>
      </div>
      <div class="panel" id="guide">
        <span class="guide-arrow" data-field="guide-arrow" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2 L20 20 L12 15 L4 20 Z"/></svg></span>
        <span class="guide-text" data-field="guide-text">Nearest ring</span>
      </div>
      <div class="toast" data-field="toast">+10</div>
      <div class="ready" data-field="ready" hidden>
        <div class="cue">WASD · START WALKING</div>
        <div class="hint">The city clock starts on your first step.</div>
      </div>
      <div class="panel" id="traffic">Cars yielding: <b data-field="yielding">0</b></div>
      <div class="panel" id="controls"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk &nbsp; <kbd>I</kbd><kbd>J</kbd><kbd>K</kbd><kbd>L</kbd> camera &nbsp; <kbd>P</kbd> pause &nbsp; <kbd>R</kbd> restart</span>
        <button type="button" data-game-action="pause" data-field="pause" title="Pause (P)" aria-label="Pause game">Ⅱ</button></div>
    </div>
    <div class="overlay" data-field="overlay" role="dialog" aria-modal="true" aria-labelledby="city-walk-result-title" hidden>
      <div class="card">
        <h1 id="city-walk-result-title" data-field="title"></h1>
        <p data-field="text"></p>
        <button type="button" data-game-action="resume" data-field="resume" hidden>Resume</button>
        <button type="button" data-game-action="reset" data-field="restart">Walk again</button>
        <small data-field="hint">Press R to restart</small>
      </div>
    </div>
  `;
  const field = name => root.querySelector(`[data-field="${name}"]`);
  return {
    update(s) {
      if (!s) return;
      const score = s.score ?? 0, target = s.targetScore || 100;
      setText(field('score'), String(score));
      setText(field('score-target'), ` / ${target}`);
      setStyle(field('score-bar'), 'width', `${Math.min(100, score / target * 100)}%`);
      const meter = field('meter');
      if (meter.getAttribute('aria-valuenow') !== String(score)) meter.setAttribute('aria-valuenow', String(score));
      setText(field('clock'), s.clockText || '0:00');
      setClass(field('clock-panel'), 'warn', Boolean(s.clockWarn));
      setText(field('clock-bonus'), s.bonusFlash ? `+${BONUS_SECONDS} s` : '');
      setClass(field('toast'), 'show', Boolean(s.bonusFlash));
      if (s.guideText) {
        setStyle(field('guide-arrow'), 'transform', `rotate(${s.guideBearing ?? 0}deg)`);
        setText(field('guide-text'), s.guideText);
      }
      setText(field('yielding'), String(s.yielding ?? 0));
      setHidden(field('ready'), s.state !== 'READY');

      // READY is the start line, not an outcome: no card. Pause shares the card.
      const terminal = s.state === 'WON' || s.state === 'LOST';
      const paused = Boolean(s.paused) && !terminal;
      const show = terminal || paused;
      const overlay = field('overlay');
      setHidden(overlay, !show);
      setClass(overlay, 'won', s.state === 'WON');
      setClass(overlay, 'lost', s.state === 'LOST');
      const pause = field('pause');
      const pauseOff = show || s.state !== 'RUNNING';
      if (pause.disabled !== pauseOff) pause.disabled = pauseOff;
      if (!show) return;
      setHidden(field('resume'), !paused);
      if (paused) {
        setText(field('title'), 'Paused');
        setText(field('text'), 'The city waits. Press P or Escape to keep walking.');
        setText(field('restart'), 'Restart');
        setText(field('hint'), 'P / Escape resumes · R restarts');
        return;
      }
      const won = s.state === 'WON';
      setText(field('title'), won ? 'City explored!' : 'Time is up');
      setText(field('text'), won
        ? `You reached ${score} points with ${s.clockText || '0:00'} to spare.`
        : `You collected ${s.ringsCollected ?? 0} rings (${score} / ${target} points).`);
      setText(field('restart'), 'Walk again');
      setText(field('hint'), 'Press R to restart');
    },
  };
}
