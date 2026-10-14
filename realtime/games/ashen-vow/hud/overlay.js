const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };
const setHidden = (node, hidden) => { if (node && node.hidden !== hidden) node.hidden = hidden; };
const setWidth = (node, width) => { if (node && node.style.width !== width) node.style.width = width; };
const setClass = (node, name, on) => { if (node && node.classList.contains(name) !== on) node.classList.toggle(name, on); };

export function mount(root) {
  root.innerHTML = `
    <div id="hud">
      <header>
        <div class="brand"><span>A TALE FROM THE UNDERWORLD</span><strong>ASHEN VOW</strong></div>
        <div class="chapter"><span>CHAMBER I</span><b>ESCAPE FROM EREBUS</b></div>
        <button type="button" data-game-action="pause" data-field="pause" title="Pause (P)" aria-label="Pause game">Ⅱ</button>
      </header>
      <section class="status">
        <div class="health-head"><b>THE EXILE</b><span data-field="hp-text">100 / 100</span></div>
        <div class="health-track"><i data-field="hp-fill"></i></div>
        <div class="status-foot"><span>VITALITY</span><span data-field="count">0 / 2</span></div>
      </section>
      <section class="objective">
        <span class="label" data-field="objective-label">CHAMBER OF ASHES</span>
        <strong data-field="objective">Defeat the two wardens</strong>
        <div class="seals"><span data-field="seal-one">Ⅰ</span><span data-field="seal-two">Ⅱ</span></div>
      </section>
      <div class="boss-hud" data-field="boss-hud" hidden>
        <div><span>FINAL ENCOUNTER</span><strong>ASTERION, LAST GATE</strong><b data-field="boss-percent">100%</b></div>
        <div class="boss-track"><i data-field="boss-fill"></i></div>
      </div>
      <div class="banner" data-field="banner" hidden><span>THE SEAL IS BROKEN</span><strong>ASTERION</strong></div>
      <div class="ready" data-field="ready" hidden>
        <div class="cue">WASD / J · ENTER THE CHAMBER</div>
        <div class="hint">The wardens wait until you make the first move.</div>
      </div>
      <footer>
        <div class="controls"><span><kbd>W A S D</kbd> MOVE</span><span><kbd>J</kbd> SLASH</span><span><kbd>SPACE</kbd> DASH</span><span><kbd>K</kbd> NOVA</span><span><kbd>P</kbd> PAUSE</span><span><kbd>R</kbd> RESTART</span></div>
        <div class="abilities"><span data-field="dash-ready">DASH READY</span><span data-field="nova-ready">NOVA READY</span></div>
      </footer>
      <div class="vignette" data-field="vignette" aria-hidden="true"></div>
    </div>
    <div class="overlay" data-field="overlay" role="dialog" aria-modal="true" hidden>
      <div class="result">
        <span data-field="result-kicker"></span>
        <h1 data-field="result-title"></h1>
        <p data-field="result-text"></p>
        <div class="result-stats" data-field="result-stats">
          <span>WARDENS <b data-field="stat-wardens"></b></span>
          <span>TIME <b data-field="stat-time"></b></span>
          <span>VITALITY <b data-field="stat-hp"></b></span>
        </div>
        <button type="button" data-game-action="resume" data-field="resume" hidden>RETURN TO THE FIGHT</button>
        <button type="button" data-game-action="reset" data-field="restart">PLAY AGAIN ↗</button>
        <small data-field="result-hint">PRESS R TO RESTART</small>
      </div>
    </div>
  `;
  const field = name => root.querySelector(`[data-field="${name}"]`);
  return {
    update(s) {
      if (!s) return;
      const maxHp = s.playerMaxHealth || 100;
      setWidth(field('hp-fill'), `${(s.playerHealth ?? 0) / maxHp * 100}%`);
      setText(field('hp-text'), `${Math.round(s.playerHealth ?? 0)} / ${maxHp}`);
      setText(field('count'), `${s.wardensDefeated ?? 0} / ${s.totalWardens ?? 2}`);
      setClass(field('seal-one'), 'done', Boolean(s.sealOne));
      setClass(field('seal-two'), 'done', Boolean(s.sealTwo));
      setText(field('objective'), s.objective || 'Defeat the two wardens');
      setText(field('objective-label'), s.objectiveLabel || 'CHAMBER OF ASHES');
      const bossShown = s.bossSpawned && !s.bossDefeated;
      setHidden(field('boss-hud'), !bossShown);
      if (bossShown) {
        const ratio = (s.bossHealth ?? 0) / (s.bossMaxHealth || 1);
        setWidth(field('boss-fill'), `${ratio * 100}%`);
        setText(field('boss-percent'), `${Math.ceil(ratio * 100)}%`);
      }
      setText(field('dash-ready'), s.dashLabel || 'DASH READY');
      setClass(field('dash-ready'), 'cooldown', s.dashCharges === 0);
      setText(field('nova-ready'), s.novaLabel || 'NOVA READY');
      setClass(field('nova-ready'), 'cooldown', !s.novaReady);
      setHidden(field('banner'), !s.bannerVisible);
      setHidden(field('ready'), s.state !== 'READY');
      const flash = String(Math.min(1, (s.hitFlash ?? 0) / 0.22) * 0.8);
      if (field('vignette').style.opacity !== flash) field('vignette').style.opacity = flash;
      // READY is not an outcome: the chamber waits without a card.
      const terminal = s.state === 'WON' || s.state === 'LOST';
      const paused = Boolean(s.paused) && !terminal;
      const showOverlay = paused || terminal;
      setHidden(field('overlay'), !showOverlay);
      const pause = field('pause');
      if (pause.disabled !== (showOverlay || s.state !== 'RUNNING')) pause.disabled = showOverlay || s.state !== 'RUNNING';
      if (!showOverlay) return;
      setHidden(field('resume'), !paused);
      setText(field('result-hint'), paused ? 'P / ESC TO RESUME · R TO RESTART' : 'PRESS R TO RESTART');
      setHidden(field('result-stats'), paused);
      if (paused) {
        setText(field('result-kicker'), 'A MOMENT BETWEEN FATES');
        setText(field('result-title'), 'PAUSED');
        setText(field('result-text'), 'Press P or Escape to return to the chamber.');
        setText(field('restart'), 'RESTART RUN');
        return;
      }
      const won = s.state === 'WON';
      setText(field('result-kicker'), won ? 'EREBUS RELEASES YOU' : 'THE UNDERWORLD REMEMBERS');
      setText(field('result-title'), won ? 'OATH FULFILLED' : 'DEATH IS A BEGINNING');
      setText(field('result-text'), won
        ? 'The two wardens have fallen. Asterion is no more. Beyond the Last Gate, a new dawn awaits.'
        : 'Your flame has faded, but your vow remains. Watch the red circles. Dash beyond their reach.');
      setText(field('stat-wardens'), `${s.wardensDefeated ?? 0} / 2`);
      setText(field('stat-time'), `${Math.floor(s.elapsed ?? 0)}s`);
      setText(field('stat-hp'), String(Math.round(s.playerHealth ?? 0)));
      setText(field('restart'), won ? 'RISE AGAIN ↗' : 'TRY AGAIN ↗');
    },
  };
}
