import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { TimedGuard } from '../../../assets/gameplay/combat/TimedGuard.js';
import { MeleeAttackSystem } from '../../../assets/gameplay/combat/MeleeAttackSystem.js';
import { PlanarRecoil } from '../../../assets/game-feel/PlanarRecoil.js';
import { AttackTelegraphView } from '../../../assets/world/object/AttackTelegraphView.js';
import { ArenaLayout } from '../../../assets/world/environment/ArenaLayout.js';
import { WorldBasis } from '../../../assets/math/WorldBasis.js';
const origin = new Vector3(), facing = new Vector3(0,0,-1), source = new Vector3(0,0,-2);
test('guard separates timing, direction, held inputs and reset',()=>{
 const g=new TimedGuard({windowSeconds:.25});
 const resolve=(now,s=source,enabled=true)=>g.resolve({now,origin,facing,source:s,enabled});
 assert.equal(resolve(0),'hit');g.setHeld(true,1);assert.equal(resolve(1.2),'parry');
 g.setHeld(true,1.2);assert.equal(resolve(1.3),'block'); // repeated held signal does not refresh
 assert.equal(resolve(1.3,new Vector3(0,0,2)),'hit');assert.equal(resolve(1.3,source,false),'hit');
 g.setHeld(false,1.31);assert.equal(resolve(1.32),'hit');g.setHeld(true,2);g.setHeld(false,2.01);
 assert.equal(resolve(2.1),'parry');assert.equal(resolve(2.3),'hit');g.reset();assert.equal(resolve(2.1),'hit');
});
test('opportunity reads actual attack range and same stable hit identity',()=>{
 const attack=new MeleeAttackSystem({range:3,windupSeconds:1}), guard=new TimedGuard({windowSeconds:.25}), target={position:source};
 const cue=()=>guard.opportunity({attack,origin,facing,target});
 attack.requestSwing();assert.equal(cue(),false);attack.step(.8);assert.equal(cue(),true);
 target.position=new Vector3(0,0,-4);assert.equal(cue(),false);target.position=source;
 attack.step(.2);assert.equal(cue(),true);assert.equal(attack.resolveHits({origin,facing,targets:[target]}).length,1);
 assert.equal(cue(),false);assert.equal(attack.resolveHits({origin,facing,targets:[target]}).length,0);
});
test('recoil displacement is bounded, planar, collision-aware and timestep-independent',()=>{
 for(const steps of [[1],[.1,.1,.1],[.02,.03,.2]]){
  const r=new PlanarRecoil({speed:8}),p=new Vector3();r.push(new Vector3(1,9,0),{duration:.25});
  steps.forEach(dt=>r.step(p,dt));assert.ok(Math.abs(p.x-2)<1e-9);assert.equal(p.y,0);
 }
 const r=new PlanarRecoil({speed:8}),p=new Vector3();r.push(new Vector3(1,0,0));r.step(p,1,(p,old)=>{assert.equal(old.x,0);p.x=Math.min(1,p.x);});assert.equal(p.x,1);
 r.push(new Vector3(0,1,0));assert.equal(r.remaining,0);
});
test('telegraph follows attack parameters and alternate world basis',()=>{
 for(const basis of [new WorldBasis(),new WorldBasis({right:'+x',up:'+z',forward:'+y'})]){
  const attack=new MeleeAttackSystem({range:3,halfAngleRadians:.6,basis}),view=new AttackTelegraphView({attack,basis});
  const forward=basis.fromBasisComponents(0,0,1);attack.requestSwing();view.update({origin,facing:forward});view.mesh.updateMatrixWorld();
  const p=new Vector3().fromBufferAttribute(view.geometry.attributes.position,1).applyMatrix4(view.mesh.matrixWorld);basis.flatten(p);
  assert.ok(Math.abs(p.length()-attack.range)<1e-6);assert.ok(attack.isInArc(origin,forward,p.clone().multiplyScalar(.999).addScaledVector(forward,.001)));
  attack.range=5;view.update({origin,facing:forward});assert.ok(view.geometry.boundingSphere.radius>2);view.dispose();
 }
});
test('arena batches architecture and exposes boundary without pretending to collide',()=>{
 const arena=new ArenaLayout({radius:7,sectors:16,tiers:2,gateSectors:[0,8]});
 assert.equal(arena.group.children.length,2);assert.equal(arena.boundary.radius,7);assert.equal(arena.boundary.gateAngles.length,2);
 assert.ok(arena.group.children[1].isInstancedMesh);arena.dispose();
 assert.throws(()=>new ArenaLayout({sectors:2}));
});

test('guard expiry is consistent for held and tapped input, disabled guard is invisible',()=>{
 const g=new TimedGuard({windowSeconds:.25});const resolve=now=>g.resolve({now,origin,facing,source});
 g.setHeld(true,1);assert.equal(resolve(1.25),'block');g.setHeld(false,1.25);assert.equal(resolve(1.25),'hit');
 g.setHeld(true,2,false);assert.equal(g.isRaised(2),false);assert.equal(resolve(2),'hit');
});
