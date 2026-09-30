import { createRules } from './rules.mjs';
import { Vector3 } from 'three';
import { WorldCardinalCharacterMotionController } from '/assets/actor-motion/character/WorldCardinalCharacterMotionController.js';
import { BoxObstacleField } from '/assets/world/environment/BoxObstacleField.js';
import { PLATFORMS, COINS } from './level.mjs';

// Gameplay owns world coordinates, support, motion, accepted jumps and collection.
// Visuals are replaceable views of this state. Core uses primitive geometry.
export function createGame() {
  const field = new BoxObstacleField({boxes:PLATFORMS.map(p=>({id:p.id,right:p.x,forward:-p.z,width:p.w,depth:p.d,topUp:p.top,bottomUp:p.bottom})),stepTolerance:0.10});
  let rules, motion, elapsed, readyTime, roundId=0, state, events, eventId, jumps, rejectedJumps, lands, collected, lastSupport, lastLand, contact, lastMove;
  function emit(type,data={}) { events.push({id:++eventId,type,...data}); if(events.length>96)events.shift(); }
  function reset() {
    // walkSpeed is the translation rate of the control signal (the follow camera
    // never rotates). With the camera closer in main.js the visible strip is
    // 21 m, so 6.6 cycled it in 3.2 s while 3.0 takes 7.1 s. Jump reach scales
    // with it: 0.909 s of air time gives 2.73 m against 1.5 m platform gaps.
    motion = new WorldCardinalCharacterMotionController({walkSpeed:3,gravity:22,jumpVelocity:10,accelerationLag:0.055,decelerationLag:0.035,airAccelerationLag:0.07,turnLag:0.09});
    motion.setState({position:new Vector3(0,0,1),grounded:true});
    // A round waits on the launch pad (READY) until the first move or jump, so
    // the model frame rate settles before play. rules.mjs stays RUNNING.
    rules=createRules(COINS.length); elapsed=0; readyTime=0; roundId++; state='READY'; lastLand='launch'; events=[]; eventId=0; jumps=0; rejectedJumps=0; lands=0; collected=rules.collected; lastSupport='launch'; contact=false; lastMove={x:0,z:0};
  }
  reset();
  function update(dt,input) {
    if(state==='READY'){
      readyTime+=dt;
      // The start press is not spent on a jump; a held move key walks from the next tick.
      const moving=['forward','backward','left','right'].some(a=>input.isDown(a));
      if(!input.consumePress('jump')&&!moving)return true;
      state=rules.state; emit('round.started');
      return true;
    }
    if(state!=='RUNNING')return false;
    elapsed+=dt;
    const jump=input.consumePress('jump');
    const wasGrounded=motion.grounded;
    if(jump){ if(wasGrounded){jumps++;emit('robot.jump');}else{rejectedJumps++;emit('jump.rejected');} }
    const intent=motion.planMovement({forward:input.isDown('forward'),backward:input.isDown('backward'),left:input.isDown('left'),right:input.isDown('right'),jump,deltaSeconds:dt});
    const resolved=field.resolve(intent.position,{radius:0.30,height:1.35,referenceUp:intent.startPosition.y,previousPosition:intent.startPosition});
    contact=resolved.blocked;
    const support=field.supportHeightAt(intent.position,intent.startPosition.y);
    let grounded=false;
    if(intent.velocity.y<=0 && intent.position.y<=support && intent.startPosition.y>=support-0.11){intent.position.y=support; grounded=true;}
    const delta=intent.position.clone().sub(intent.startPosition);
    motion.commitMovement(intent,{position:intent.position,velocity:intent.velocity,correctedDelta:delta,grounded});
    lastMove={x:delta.x,z:delta.z};
    const platform=PLATFORMS.find(p=>Math.abs(motion.position.x-p.x)<=p.w/2&&Math.abs(motion.position.z-p.z)<=p.d/2&&Math.abs(motion.position.y-p.top)<0.11);
    lastSupport=grounded&&platform?platform.id:'';
    // `from` is the previous landing, so the prompt line can skip repeat landings without state.
    if(grounded&&!wasGrounded){lands++;emit('robot.land',{platform:lastSupport,from:lastLand});if(lastSupport)lastLand=lastSupport;}
    for(const c of COINS) {
      if(collected.has(c.id))continue;
      if(Math.hypot(motion.position.x-c.x,motion.position.z-c.z)<0.9&&Math.abs(motion.position.y+0.8-c.y)<1.15){rules.collect(c.id);}
    }
    if(motion.position.y < -9)rules.fall();
    for(const event of rules.step(dt)){const {type,...data}=event;emit(type,data);}
    state=rules.state;
    if(state!=='RUNNING')input.clear();
    return state==='RUNNING';
  }
  function read(){
    const p=motion.position,v=motion.velocity;
    const c=COINS.find(c=>!collected.has(c.id));
    return {state,roundId,elapsed,readyTime,terminalCount:rules.terminalCount,outcomeReason:rules.outcomeReason,events:[...events],player:{x:p.x,y:p.y,z:p.z,vx:v.x,vy:v.y,vz:v.z,yaw:motion.yaw,grounded:motion.grounded,support:lastSupport},jumps,rejectedJumps,lands,coins:collected.size,coinIds:[...collected],picked:Object.fromEntries(COINS.map(c=>[c.id,collected.has(c.id)])),total:COINS.length,next:c?{id:c.id,x:c.x,y:c.y,z:c.z,dx:c.x-p.x,dz:c.z-p.z,distance:Math.hypot(c.x-p.x,c.z-p.z),differentPlatform:lastSupport!==c.platform}:null,diagnostics:{inputApplied:lastMove,contact:{blocked:contact,support:lastSupport}}};
  }
  return {update,read,reset};
}
