import assert from 'node:assert/strict';
import {ArcadeDuelGame,MOVES,dynamicPrompt,DEFAULTS,combinePrompt} from '../arcadeduel/game.js';
const advance=(g,n,u={})=>{for(let i=0;i<n;i++)g.step(u);};
const isolated=()=>{const g=new ArcadeDuelGame();g.s.fighters[1].nextThink=1e6;return g;};
let g=isolated();advance(g,60,{fire:true});assert.equal(g.s.enemyHealth,100,'Out-of-range punches miss');
g=isolated();g.s.fighters[0].x=-.55;g.s.fighters[1].x=.55;advance(g,3,{fire:true});assert.equal(g.s.enemyHealth,94);advance(g,6,{});assert.equal(g.s.enemyHealth,94,'One hit per swing');
g=isolated();g.s.fighters[0].x=-.55;g.s.fighters[1].x=.55;g.s.fighters[1].intent={guard:true};advance(g,3,{fire:true});assert.equal(g.s.enemyHealth,100);assert.ok(g.s.fighters[1].guard<100,'Block consumes guard, not HP');
g=isolated();const [a,b]=g.s.fighters;b.blocking=true;b.guard=1;g.hit(a,b,'spin',1);assert.equal(b.guard,0);assert.equal(b.stun,25);assert.equal(b.blocking,false);assert.equal(b.hp,100,'Guard break opens a punish, no phantom damage');
g=isolated();g.s.fighters[0].energy=0;advance(g,1,{wave:true,upper:true,dash:true});assert.equal(g.s.fighters[0].attack,null);assert.equal(g.s.waves.length,0);
g=isolated();advance(g,1,{wave:true});assert.ok(Math.abs(g.s.fighters[0].energy-10-5/24)<1e-9);advance(g,28);assert.equal(g.s.enemyHealth,86,'Travelling wave hits at range');assert.equal(g.s.waves.length,0);
g=isolated();g.s.fighters[0].x=-.55;g.s.fighters[1].x=.55;advance(g,5,{upper:true});assert.equal(g.s.enemyHealth,88);assert.ok(g.s.fighters[1].vy>0,'Uppercut launches');advance(g,40);assert.equal(g.s.fighters[1].y,0,'Launched enemy lands');
g=isolated();g.s.fighters[1].dash=3;assert.equal(g.hit(g.s.fighters[0],g.s.fighters[1],'wave',1),false);assert.equal(g.s.fighters[1].hp,100);
g=isolated();advance(g,1,{jump:true});advance(g,40);assert.equal(g.s.fighters[0].y,0);
g=isolated();g.s.fighters[0].x=3;g.s.fighters[1].x=3.55;advance(g,60,{side:1});assert.ok(g.s.fighters[1].x-g.s.fighters[0].x>=.82-1e-8);assert.ok(g.s.fighters.every(f=>Math.abs(f.x)<=3.55+1e-9));
g=new ArcadeDuelGame();g.s.fighters[0].x=-.55;g.s.fighters[1].x=.55;advance(g,30);assert.equal(g.s.health,100,'CPU grants over one second of visible windup');advance(g,4);assert.ok(g.s.health<100,'Telegraphed CPU strike eventually connects');
g=new ArcadeDuelGame();g.s.fighters[0].x=-.55;g.s.fighters[1].x=.55;advance(g,30);advance(g,8,{guard:true});assert.equal(g.s.health,100,'Player can react after one second and block');
g=new ArcadeDuelGame();advance(g,30,{side:-1});assert.ok(g.s.fighters[1].walk<0);g.s.fighters[0].x=3;g.step();const intent=g.s.fighters[1].intent.side;advance(g,10);assert.equal(g.s.fighters[1].intent.side,intent,'CPU does not track a changed position every frame');
g=new ArcadeDuelGame();const states=[];for(let i=0;i<1440&&!g.s.won&&!g.s.dead;i++){g.step(g.demoInput());states.push(g.snapshot());}assert.equal(g.s.won,true);assert.equal(g.s.enemyHealth,0);assert.ok(g.s.health>0);assert.ok(g.s.bestCombo>=3);assert.ok(g.s.movesUsed.spin&&g.s.movesUsed.wave);
const replay=new ArcadeDuelGame();for(const state of states){replay.step(state.input);assert.deepEqual(replay.snapshot(),state);}
const checkpoint=new ArcadeDuelGame(states[60]);for(const state of states.slice(61)){checkpoint.step(state.input);assert.deepEqual(checkpoint.snapshot(),state);}
const prompt=combinePrompt(DEFAULTS.global,dynamicPrompt(states));assert.ok(prompt.length<=4096);assert.match(prompt,/spinning kick/);assert.match(prompt,/blue fighter wins/);
const hp=g.s.health;advance(g,24,{fire:true});assert.equal(g.s.health,hp);assert.equal(g.s.enemyHealth,0);
g=isolated();g.s.frame=1439;g.s.fighters[0].hp=40;g.s.fighters[1].hp=50;g.step();assert.equal(g.s.dead,true);assert.equal(g.s.reason,'time');
console.log('PASS: range, one-hit swings, guard/break, energy, projectiles, launch, dash, boundaries, delayed CPU, reactive guard, deterministic replay and victory.');
