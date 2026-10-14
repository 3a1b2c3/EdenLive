export const LIMITS = Object.freeze({left:-27,right:27,back:-2.65,front:2.65});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const approach=(v,target,amount)=>v+clamp(target-v,-amount,amount);
function enemy(id,x,z,maxHp){return {id,x,z,maxHp,hp:maxHp,facing:-1,mode:'idle',timer:0,cooldown:1.2,flash:0,deathTime:0,active:false,attacks:0,aimX:x,aimZ:z,moving:false,turnTime:0};}
export function createGame({outcomes=false,onRestart=()=>{}}={}){
  const g={state:'READY',roundId:0,terminalCount:0,elapsed:0,readyTime:0,startGuard:false,events:[],eventId:0,phase:'wardens',outcomeReason:'',paused:false};
  g.emit=(type,data={})=>{g.events.push({id:++g.eventId,type,elapsed:g.elapsed,...data});if(g.events.length>128)g.events.shift();};
  g.reset=()=>{
    // A round waits in READY (idle poses only) until the first move or attack.
    g.roundId++;g.state='READY';g.paused=false;g.terminalCount=0;g.elapsed=0;g.readyTime=0;g.startGuard=false;g.events=[];g.phase='wardens';g.outcomeReason='';
    g.hero={id:'hero',x:-23,z:0,y:0,facing:1,hp:120,maxHp:120,speed:5.7,invuln:0,attackCd:0,attackTime:0,attackKind:'light',attackPending:false,combo:0,comboWindow:0,heavyCd:0,dashCd:0,dashTime:0,dashX:1,dashZ:0,flash:0,moving:false,turnTime:0};
    g.enemies={vampire_one:enemy('vampire_one',-14,-.8,78),vampire_two:enemy('vampire_two',-3,1,92),dragon_boss:enemy('dragon_boss',21,0,340)};
    g.kills=0;g.hits=0;g.damageDealt=0;g.damageTaken=0;g.dashes=0;g.heavyAttacks=0;g.attacks=0;g.score=0;g.bestCombo=0;g.chain=0;g.chainTimer=0;g.bossIntroducedAt=-1;g.cameraX=-19.5;g.pendingAttack=false;g.pendingHeavy=false;g.pendingDash=false;g.shake=0;g.banner='THE MIDNIGHT DISTRICT';g.bannerUntil=3;
  };
  g.reset();
  g.restart=()=>{g.reset();onRestart();};
  g.togglePause=()=>{if(g.state==='RUNNING'){g.paused=!g.paused;onRestart();}};
  g.handleInput=input=>{
    if(input.consumePress('pause')){g.togglePause();return;}
    if(g.state==='READY'){
      // The start press is consumed so it opens the round without a swing;
      // startGuard also ignores a held J/K until it is released.
      const pressed=['attack','heavy','dash'].map(a=>input.consumePress(a)).some(Boolean);
      const moving=['left','right','up','down'].some(a=>input.isDown(a));
      if(!pressed&&!moving)return;
      g.state='RUNNING';g.startGuard=true;g.emit('round.started');return;
    }
    if(g.state!=='RUNNING'||g.paused)return;
    if(input.consumePress('attack'))g.pendingAttack=true;
    if(input.consumePress('heavy'))g.pendingHeavy=true;
    if(input.consumePress('dash'))g.pendingDash=true;
  };
  g.finish=(state,reason)=>{if(g.state!=='RUNNING')return;g.state=state;g.terminalCount++;g.outcomeReason=reason;g.hero.moving=false;g.pendingAttack=g.pendingDash=g.pendingHeavy=false;g.emit(state==='WON'?'round.won':'round.lost',{reason});};
  g.hurtHero=(damage,source)=>{
    const h=g.hero;if(h.invuln>0||h.hp<=0)return;
    h.hp=Math.max(0,h.hp-damage);h.invuln=.7;h.flash=.25;g.shake=.2;g.chain=0;g.damageTaken+=damage;g.emit('hero.hurt',{damage,source,x:h.x,z:h.z});
    if(h.hp===0&&outcomes)g.finish('LOST','The night claimed its last fighter.');
  };
  g.hitEnemy=(e,damage,kind)=>{
    if(e.hp<=0)return;e.hp=Math.max(0,e.hp-damage);e.flash=.18;g.hits++;g.damageDealt+=damage;g.chain++;g.chainTimer=2.2;g.bestCombo=Math.max(g.bestCombo,g.chain);g.score+=damage*10;g.shake=kind==='heavy'?.2:.1;
    g.emit('combat.hit',{target:e.id,damage,kind,x:e.x,z:e.z});
    if(e.id!=='dragon_boss'){
      e.x=clamp(e.x+g.hero.facing*(kind==='heavy'?.7:.18),LIMITS.left,11);
      e.mode='stagger';e.timer=.24;e.cooldown=.5;
    }
    if(e.hp===0){
      e.mode='dead';e.deathTime=0;g.score+=e.id==='dragon_boss'?4000:1200;g.emit('enemy.defeated',{target:e.id,x:e.x,z:e.z});
      if(e.id!=='dragon_boss'){
        g.kills++;g.hero.hp=Math.min(g.hero.maxHp,g.hero.hp+20);g.emit('hero.healed',{amount:20});
        if(g.kills===2){g.phase='boss';g.bossIntroducedAt=g.elapsed;g.banner='ASHWING AWAKENS';g.bannerUntil=g.elapsed+3.2;g.emit('boss.unlocked',{prerequisiteKills:g.kills});}
        else{g.banner='ONE WARDEN REMAINS';g.bannerUntil=g.elapsed+2;}
      }else if(outcomes&&g.kills===2)g.finish('WON','The wardens fell. Ashwing is defeated. The street is yours.');
    }
  };
  g.startAttack=kind=>{
    const h=g.hero;if(h.attackCd>0||h.dashTime>0||h.hp<=0)return;
    if(kind==='heavy'&&h.heavyCd>0)return;
    const target=g.nearest();if(target&&Math.abs(target.x-h.x)<4.1){const face=Math.sign(target.x-h.x)||h.facing;if(face!==h.facing){h.facing=face;h.turnTime=.42;}}
    h.attackKind=kind;h.attackTime=0;h.attackPending=true;h.attackCd=kind==='heavy'?.65:.35;
    if(kind==='heavy'){h.heavyCd=1.7;g.heavyAttacks++;}else{h.combo=h.comboWindow>0?h.combo%3+1:1;h.comboWindow=1;}
    g.attacks++;g.emit('hero.attack',{kind,combo:h.combo,x:h.x,z:h.z});
  };
  g.nearest=()=>Object.values(g.enemies).filter(e=>e.hp>0&&(e.id!=='dragon_boss'||g.phase==='boss')).sort((a,b)=>Math.hypot(a.x-g.hero.x,a.z-g.hero.z)-Math.hypot(b.x-g.hero.x,b.z-g.hero.z))[0]||null;
  g.update=(dt,input)=>{
    if(g.state==='READY'){g.readyTime+=dt;return false;}
    if(g.state!=='RUNNING'||g.paused)return false;
    g.elapsed+=dt;const h=g.hero;
    if(g.startGuard&&!input?.isDown('attack')&&!input?.isDown('heavy'))g.startGuard=false;
    const holdHeavy=!g.startGuard&&input?.isDown('heavy'),holdAttack=!g.startGuard&&input?.isDown('attack');
    for(const key of ['invuln','attackCd','comboWindow','heavyCd','dashCd','flash'])h[key]=Math.max(0,h[key]-dt);
    g.shake=Math.max(0,g.shake-dt);g.chainTimer=Math.max(0,g.chainTimer-dt);if(g.chainTimer===0)g.chain=0;
    let mx=input?.axis('left','right')||0,mz=input?.axis('up','down')||0;const norm=Math.hypot(mx,mz);if(norm>1){mx/=norm;mz/=norm;}
    if(mx){const face=Math.sign(mx);if(face!==h.facing){h.facing=face;h.turnTime=.42;}else h.facing=face;}
    h.turnTime=Math.max(0,h.turnTime-dt);
    if(g.pendingDash&&h.dashCd<=0){
      h.dashTime=.19;h.dashCd=.85;h.invuln=.38;h.dashX=norm?mx:h.facing;h.dashZ=mz;h.turnTime=0;g.dashes++;g.emit('hero.dash',{x:h.x,z:h.z});
    }
    g.pendingDash=false;
    if((g.pendingHeavy||holdHeavy)&&h.heavyCd<=0)g.startAttack('heavy');
    else if(g.pendingAttack||holdAttack)g.startAttack('light');
    g.pendingAttack=false;g.pendingHeavy=false;
    const speed=h.attackCd>.15?3.2:h.speed,turning=h.turnTime>0;
    if(h.dashTime>0){h.x+=h.dashX*18*dt;h.z+=h.dashZ*18*dt;h.dashTime=Math.max(0,h.dashTime-dt);}else if(!turning){h.x+=mx*speed*dt;h.z+=mz*speed*.85*dt;}
    h.x=clamp(h.x,LIMITS.left,g.phase==='boss'?LIMITS.right:11);h.z=clamp(h.z,LIMITS.back,LIMITS.front);h.moving=h.dashTime>0||(!turning&&norm>0);
    h.attackTime+=dt;
    if(h.attackPending&&h.attackTime>=(h.attackKind==='heavy'?.18:.085)){
      h.attackPending=false;
      for(const e of Object.values(g.enemies)){
        if(e.hp<=0||(e.id==='dragon_boss'&&g.phase!=='boss'))continue;
        const boss=e.id==='dragon_boss',dx=e.x-h.x,dz=e.z-h.z;
        const reach=(h.attackKind==='heavy'?2.9:2.1)+(boss?1.4:0);
        if(Math.abs(dx)<reach&&Math.abs(dz)<(h.attackKind==='heavy'?1.6:1.05)&&dx*h.facing>-.65){g.hitEnemy(e,h.attackKind==='heavy'?38:([0,15,18,27][h.combo]||15),h.attackKind);}
      }
    }
    if(g.state!=='RUNNING')return false;
    for(const e of Object.values(g.enemies)){
      e.flash=Math.max(0,e.flash-dt);e.moving=false;
      if(e.hp<=0){e.deathTime+=dt;continue;}
      const boss=e.id==='dragon_boss';
      if(boss){if(g.phase!=='boss'||h.x<10||g.elapsed-g.bossIntroducedAt<1.4)continue;}
      else if(!e.active&&Math.abs(e.x-h.x)>11)continue;
      e.active=true;if(!['windup','strike','breath'].includes(e.mode)){const face=Math.sign(h.x-e.x)||-1;if(face!==e.facing){e.facing=face;e.turnTime=.42;}}e.turnTime=Math.max(0,e.turnTime-dt);e.cooldown=Math.max(0,e.cooldown-dt);e.timer-=dt;
      const dx=h.x-e.x,dz=h.z-e.z,dist=Math.hypot(dx,dz);
      if(e.mode==='stagger'){if(e.timer<=0)e.mode='idle';continue;}
      if(e.mode==='windup'){
        if(e.timer<=0){
          e.mode=e.attackType==='breath'?'breath':'strike';e.timer=e.attackType==='breath'?.95:.24;e.didHit=false;const face=e.aimX<e.x?-1:1;if(face!==e.facing){e.facing=face;e.turnTime=.42;}g.emit('enemy.attack',{source:e.id,kind:e.attackType,x:e.x,z:e.z});
        }
      }else if(e.mode==='strike'||e.mode==='breath'){
        if(e.mode==='breath'){
          const forward=(h.x-e.x)*e.facing;if(forward>0&&forward<9.2&&Math.abs(h.z-e.aimZ)<.9)g.hurtHero(22,e.id);
        }else if(!e.didHit){
          e.didHit=true;if(!boss){e.x=approach(e.x,e.aimX,.8);e.z=approach(e.z,e.aimZ,.35);}
          if(Math.abs(h.x-e.x)<(boss?3.6:1.9)&&Math.abs(h.z-e.z)<(boss?1.45:1.15))g.hurtHero(boss?22:12,e.id);
        }
        if(e.timer<=0){e.mode='recover';e.timer=boss?.8:.6;e.cooldown=boss?.9:.55;}
      }else if(e.mode==='recover'){if(e.timer<=0)e.mode='idle';}
      else{
        const stop=boss?3:1.38;
        if(e.turnTime<=0&&(Math.abs(dx)>stop||Math.abs(dz)>.4)){
          const speed=boss?1.8:2.3;e.x+=Math.sign(dx)*Math.min(Math.max(0,Math.abs(dx)-stop+.12),speed*dt);e.z=approach(e.z,h.z,speed*.75*dt);e.moving=true;
          if(boss)e.x=clamp(e.x,15.5,25);else e.x=clamp(e.x,LIMITS.left,10.5);
          e.z=clamp(e.z,LIMITS.back,LIMITS.front);
        }
        if(e.cooldown<=0&&(dist<(boss?8.8:2.05))&&Math.abs(dz)<1.3){
          e.attacks++;e.attackType=boss&&(e.attacks%2===1||dist>4.1)?'breath':'claw';e.mode='windup';e.timer=boss?(e.attackType==='breath'?1.15:.75):.7;e.aimX=h.x;e.aimZ=h.z;
          g.emit('enemy.windup',{source:e.id,kind:e.attackType,x:e.x,z:e.aimZ});
        }
      }
    }
    g.cameraX+=(clamp(h.x+3.4,-20,22)-g.cameraX)*(1-Math.exp(-dt*2.2));
    return g.state==='RUNNING';
  };
  g.read=()=>{
    const h=g.hero,t=g.nearest();const enemies={};for(const [id,e] of Object.entries(g.enemies))enemies[id]={x:e.x,z:e.z,hp:e.hp,maxHp:e.maxHp,mode:e.mode,active:e.active,attacks:e.attacks,attackType:e.attackType||'none',cueRemaining:Math.max(0,e.timer),aimZ:e.aimZ,facing:e.facing,turnTime:e.turnTime};
    return {implemented:true,state:g.state,paused:g.paused,roundId:g.roundId,terminalCount:g.terminalCount,outcomeReason:g.outcomeReason,elapsed:g.elapsed,readyTime:g.readyTime,events:g.events.map(e=>({...e})),phase:g.phase,vampiresDefeated:g.kills,bossUnlocked:g.phase==='boss',hero:{x:h.x,z:h.z,hp:h.hp,maxHp:h.maxHp,facing:h.facing,invuln:h.invuln,heavyReady:h.heavyCd<=0,dashReady:h.dashCd<=0,turnTime:h.turnTime},enemies,target:{id:t?.id||'',dx:t?t.x-h.x:0,dz:t?t.z-h.z:0,hp:t?.hp||0,mode:t?.mode||'none',distance:t?Math.hypot(t.x-h.x,t.z-h.z):0},camera:{x:g.cameraX},combat:{hits:g.hits,attacks:g.attacks,damageDealt:g.damageDealt,damageTaken:g.damageTaken,dashes:g.dashes,heavyAttacks:g.heavyAttacks,bestCombo:g.bestCombo},score:g.score};
  };
  return g;
}
