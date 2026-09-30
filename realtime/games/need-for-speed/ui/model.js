// Presentation mapping only. All gameplay values are supplied by the caller.
export function raceDisplay(s) {
  const ready=s.state==='READY', running=s.state==='RUNNING'||ready, won=s.state==='WON';
  const timeLeft=Math.max(0,s.raceLimit-s.elapsed), speed=Math.round(s.speed*8);
  return {
    phase:ready?'ready':running?'running':won?'won':'lost',
    brand:{label:'MIDNIGHT STREET LEAGUE',value:'NEON CIRCUIT',text:'Neon speed / city night race'},
    status:{label:'TIME LEFT',value:`${timeLeft.toFixed(1)} s`,text:ready?'Three laps, first across the line':running?'Fight for first along the neon roads':won?'Race complete':'Race over'},
    position:{label:'POSITION',value:String(s.rank).padStart(2,'0'),text:'/ 04'},
    lap:{label:'LAP',value:String(s.lap).padStart(2,'0'),text:'/ 03'},
    speed:{label:'SPEED',value:String(speed).padStart(3,'0'),text:'KM/H'},
    boost:{label:'NITRO',value:s.boostSeconds,max:3.5,displayValue:running&&s.boostSeconds>0?`${s.boostSeconds.toFixed(1)} s`:'—',text:running&&s.boostSeconds>0?'Boost active':'Run over the green glow strips to boost'},
    damage:{label:'CHASSIS',value:'● '.repeat(Math.min(3,s.crashes))+'○ '.repeat(Math.max(0,3-s.crashes)),text:`${s.crashes} / 3 · ${s.crashes>=2?'Dodge the rivals!':'Keep your distance'}`},
    controls:{label:'DRIVE',value:'W / ↑ throttle    S / ↓ brake',text:'A D / ← → steer'},
    start:{visible:ready},
    result:{visible:!running,won,rank:s.rank,time:`${s.elapsed.toFixed(2)} s`,boosts:String(s.boostCount),laps:`${s.lapsCompleted} / 3`,reason:s.outcomeReason||'',best:s.lapTimes.length?`${Math.min(...s.lapTimes).toFixed(2)} s`:'—'},
    critical:timeLeft<10||s.crashes>=2,
    boosting:running&&s.boostSeconds>0&&!s.braking
  };
}
