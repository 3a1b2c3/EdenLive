import { createGameUI } from '/assets/user-interface/GameUiFactory.js';
const {config}=await (await fetch(new URL('./config.json',import.meta.url))).json();

const INTRO_HTML=`<div class="race-card intro-card"><div class="race-eyebrow"><span class="live-dot"></span> MIDNIGHT STREET LEAGUE / 01</div><h1>NEON<br><span>CIRCUIT</span></h1><div class="intro-subtitle">Neon speed <span>city night race</span></div><p class="race-lead">Tear through the neon blocks and take the final checkered claim.</p><div class="race-specs"><span><b>03</b> lap circuit</span><span><b>04</b> racers</span><span><b>85</b> second limit</span></div><p class="race-instruction"><i class="pack-mark">»</i> Roll over the green boost packs and leave your rivals behind.</p><div class="launch-hint"><kbd>W</kbd><span>or</span><kbd>↑</kbd><strong>hold, and drive into the night</strong><span class="launch-arrow">↗</span></div><div class="intro-controls"><span><kbd>A</kbd><kbd>D</kbd> steer</span><span><kbd>S</kbd> brake</span></div><div class="intro-note">Assisted track steering · keyboard driving · three collisions end the race</div></div>`;
const RESULT_HTML=`<div class="race-card result-card"><div class="race-eyebrow" data-result="eyebrow"></div><div class="result-rank" data-result="rank"></div><h2 data-result="title"></h2><p class="result-reason" data-result="reason"></p><dl class="result-stats"><div><dt>Race time</dt><dd data-result="time"></dd></div><div><dt>Boost packs</dt><dd data-result="boosts"></dd></div><div><dt>Laps completed</dt><dd data-result="laps"></dd></div></dl><div class="best-lap">Fastest lap <strong data-result="best"></strong></div><div class="launch-hint"><kbd>R</kbd><strong>race again</strong><span class="launch-arrow">↻</span></div></div>`;

// The end-of-race result card, shared by the full mirror UI and the no-UI big view.
function appendResult(root){
  const result=document.createElement('section');result.className='race-overlay race-result';result.hidden=true;
  result.innerHTML=RESULT_HTML;
  root.append(result);
  const fields=Object.fromEntries([...result.querySelectorAll('[data-result]')].map(el=>[el.dataset.result,el]));
  const write=(el,value)=>{if(el.textContent!==String(value))el.textContent=String(value);};
  return {result,write(s={}){
    result.hidden=s.result?.visible!==true;
    if(s.result?.visible){
      const d=s.result;
      const values={eyebrow:d.won?'RACE COMPLETE / WINNER':'RACE OVER / DEFEATED',rank:`P${d.rank}`,title:d.won?'The city, it belongs to you.':'Next lap, a little faster.',reason:d.reason,time:d.time,boosts:d.boosts,laps:d.laps,best:d.best};
      for(const [key,value] of Object.entries(values))write(fields[key],value);
    }
  }};
}

export function mountUI({state,mount=document.body}={}){
  const ui=createGameUI({...config,mount});
  ui.root.classList.add('race-ui');
  // Passive overlays preserve the existing window keyboard controller and never
  // take focus, bind keys, alter timing or introduce a second action owner.
  const intro=document.createElement('section');intro.className='race-overlay race-intro';
  intro.innerHTML=INTRO_HTML;
  const resultOverlay=appendResult(ui.root);
  ui.root.append(intro);
  function update(s={}){
    ui.update(s);
    const phase=s.phase||'ready';
    if(ui.root.dataset.phase!==phase)ui.root.dataset.phase=phase;
    ui.root.classList.toggle('is-boosting',!!s.boosting);
    ui.root.classList.toggle('is-critical',!!s.critical);
    intro.hidden=s.start?.visible!==true;
    resultOverlay.write(s);
  }
  if(state)update(state);
  return Object.freeze({root:ui.root,elements:ui.elements,update,dispose:()=>ui.dispose()});
}

// The big view keeps only the round/end popup: an empty factory UI plus the result card.
export function mountResultUI({state,mount=document.body}={}){
  const ui=createGameUI({theme:config.theme,components:[],mount});
  ui.root.classList.add('race-ui');
  const resultOverlay=appendResult(ui.root);
  function update(s={}){
    const phase=s.phase||'ready';
    if(ui.root.dataset.phase!==phase)ui.root.dataset.phase=phase;
    resultOverlay.write(s);
  }
  if(state)update(state);
  return Object.freeze({root:ui.root,elements:ui.elements,update,dispose:()=>ui.dispose()});
}