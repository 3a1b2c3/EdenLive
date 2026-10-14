// Display mapping only. Call from the game's existing frame; own no gameplay state.
// Accepts one UI or several (mirror + dialog-only) and pushes the same view state to all.
export function createPresenter(ui) {
  const uis = Array.isArray(ui) ? ui : [ui];
  let round=0,previousCoins=0,pickupUntil=0;
  return function present(s){
    if(round!==s.roundId){round=s.roundId;previousCoins=0;pickupUntil=0;}
    if(s.coins>previousCoins){pickupUntil=s.elapsed+1.6;previousCoins=s.coins;}
    // READY is the launch pad, not an outcome: no result card.
    const ended=s.state==='WON'||s.state==='LOST',won=s.state==='WON';
    const state={
      brand:{value:'MOONSTONE\nRUN',text:'LUNAR ADVENTURE'},
      coins:{value:s.coins,max:s.total,displayValue:`${String(s.coins).padStart(2,'0')} / ${s.total}`},
      objective:{value:s.coins===s.total-1?'One last golden spark.':'Follow the gold.',text:'Jump between the giant stones.\nCollect all 12 moon coins to win.'},
      controls:{value:'W A S D  /  ↑ ↓ ← →   Move',text:'SPACE   Jump       R   Restart'},
      pickup:{visible:!ended&&s.elapsed<pickupUntil,value:'+1 MOON COIN',text:`${s.total-s.coins} left to discover`},
      'restart-control':{visible:!ended},
      result:{visible:ended,variant:won?'success':'failure',label:won?'MISSION COMPLETE':'SIGNAL LOST',icon:won?'✦':'×',value:won?'Stellar work!':'One more leap.',text:won?`${s.outcomeReason}. The stars are yours.`:`${s.outcomeReason}. Aim for the pale stone tops and try again.`,stats:[{label:'MOON COINS',value:`${s.coins} / ${s.total}`},{label:'RUN TIME',value:`${s.elapsed.toFixed(1)}s`}]}
    };
    for(const u of uis)u.update(state);
  };
}