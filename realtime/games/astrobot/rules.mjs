// Pure rules shared by the browser and deterministic round adapter.
// Fall has same-tick precedence; collection is unique; terminal state is latched.
export function createRules(total=12) {
  const collected=new Set(), pending=[];
  let state='RUNNING',outcomeReason='',terminalCount=0;
  function finish(next,reason){if(state!=='RUNNING')return;state=next;outcomeReason=reason;terminalCount++;pending.push({type:next==='WON'?'round.won':'round.lost',reason});}
  return {
    get state(){return state},get isResolved(){return state!=='RUNNING'},get outcomeReason(){return outcomeReason},get terminalCount(){return terminalCount},get collected(){return collected},
    collect(id){if(state!=='RUNNING'||collected.has(id)||!/^c(0[1-9]|1[0-2])$/.test(id))return false;collected.add(id);pending.push({type:'coin.collected',coinId:id,total:collected.size});return true},
    fall(){finish('LOST','Fell into the moon mist')},
    start(){},
    step(){if(state==='RUNNING'&&collected.size>=total)finish('WON','All 12 moon coins collected');return pending.splice(0)}
  };
}
