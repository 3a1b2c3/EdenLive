import * as T from 'three';
import { createIrregularRockVisual } from '/assets/world/object/factory/RockVisualFactory.js';
import { RandomGenerator } from '/assets/math/RandomUtils.js';
import { PLATFORMS, COINS } from './level.mjs';

const mat=(color)=>new T.MeshStandardMaterial({color,metalness:0,roughness:1,emissive:0,emissiveIntensity:0});
function mesh(geo,material,parent,pos=[0,0,0],scale){const m=new T.Mesh(geo,material);m.position.set(...pos);if(scale)m.scale.set(...scale);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
function roundedBox(w,h,d){
  return new T.BoxGeometry(w,h,d);
}
function label(text,color='#ffffff',size=100){const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const ctx=canvas.getContext('2d');ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`800 ${size}px sans-serif`;ctx.fillStyle=color;ctx.fillText(text,256,64);const texture=new T.CanvasTexture(canvas);const s=new T.Sprite(new T.SpriteMaterial({map:texture,transparent:true,depthWrite:false}));s.scale.set(3.6,0.9,1);return s;}

function robot(){
  const group=new T.Group(),rig=new T.Group();group.add(rig);
  const white=mat(0xf0f0f0),blue=mat(0x0066ff),glow=mat(0x00d0ff),joint=mat(0x3a4a70);
  mesh(new T.BoxGeometry(0.74,0.78,0.55),white,rig,[0,0.75,0]);
  mesh(new T.BoxGeometry(0.98,0.8,0.84),white,rig,[0,1.31,0]);
  mesh(new T.BoxGeometry(0.32,0.12,0.12),glow,rig,[0,1.32,-0.47]);
  const arms=[],legs=[];
  for(const sign of [-1,1]){
    const arm=new T.Group();arm.position.set(sign*0.37,0.92,0);rig.add(arm);mesh(new T.BoxGeometry(0.21,0.46,0.21),white,arm,[sign*0.08,-0.22,0]);mesh(new T.BoxGeometry(0.24,0.24,0.24),blue,arm,[sign*0.1,-0.42,0]);arms.push(arm);
    const leg=new T.Group();leg.position.set(sign*0.18,0.49,0);rig.add(leg);mesh(new T.BoxGeometry(0.21,0.46,0.21),joint,leg,[0,-0.14,0]);mesh(new T.BoxGeometry(0.34,0.23,0.5),white,leg,[0,-0.34,-0.09]);legs.push(leg);
  }
  const thrusters=[];for(const x of [-0.17,0.17]){mesh(new T.BoxGeometry(0.21,0.28,0.21),blue,rig,[x,0.78,0.3]);const flame=mesh(new T.BoxGeometry(0.16,0.6,0.16),glow,rig,[x,0.37,0.3]);thrusters.push(flame);}
  const shadow=new T.Mesh(new T.CircleGeometry(0.5,12),new T.MeshBasicMaterial({color:0x1a282c,transparent:true,opacity:0.32,depthWrite:false}));shadow.rotation.x=-Math.PI/2;
  return {group,shadow,update(s){const moving=Math.hypot(s.player.vx,s.player.vz)>0.3,phase=s.elapsed*14;group.position.set(s.player.x,s.player.y,s.player.z);group.rotation.y=s.player.yaw;rig.position.y=s.player.grounded?(moving?Math.abs(Math.sin(phase))*0.03:Math.sin(s.elapsed*2.8)*0.025):0;arms.forEach((a,i)=>{a.rotation.x=s.player.grounded?(moving?Math.sin(phase+i*Math.PI)*0.75:0.12):-0.9;a.rotation.z=s.player.grounded?(i===0?0.08:-0.08):(i===0?0.55:-0.55);});legs.forEach((a,i)=>a.rotation.x=s.player.grounded?(moving?Math.sin(phase+i*Math.PI+Math.PI)*0.7:0):0.32);thrusters.forEach(f=>{f.visible=!s.player.grounded&&s.player.vy>0;f.scale.y=0.65+Math.sin(phase*3)*0.15;});const p=PLATFORMS.find(p=>Math.abs(s.player.x-p.x)<p.w/2&&Math.abs(s.player.z-p.z)<p.d/2&&p.top<=s.player.y+0.1);shadow.visible=!!p; if(p){shadow.position.set(s.player.x,p.top+0.015,s.player.z);shadow.scale.setScalar(1+Math.max(0,s.player.y-p.top)*0.1);}}};
}

export function createWorld(scene,{lowPower=false}={}){
  const rand=new RandomGenerator(7231);
  scene.background=new T.Color(0x4aa8ff);
  scene.add(new T.HemisphereLight(0xffffff,0x909090,1.8));
  const sun=new T.DirectionalLight(0xffffff,2.2);sun.position.set(-12,26,16);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-30;sun.shadow.camera.right=30;sun.shadow.camera.top=30;sun.shadow.camera.bottom=-30;sun.shadow.camera.far=75;sun.shadow.normalBias=0.04;sun.target.position.set(6,0,-9);scene.add(sun,sun.target);
  const colors=[0xd4a060,0x6a8ab0,0xc87840,0x70a878,0xc0a050,0x8878c0,0xe8d090];
  const tops=[0xf0c888,0x98c0e0,0xe89858,0x98d0a0,0xe0c868,0xb0a0e8,0xfff0b0];
  for(const [i,p] of PLATFORMS.entries()){
    const island=new T.Group();island.position.set(p.x,p.top,p.z);scene.add(island);
    const thickness=p.top-p.bottom;
    mesh(roundedBox(p.w-0.12,0.64,p.d-0.12,0.42),mat(colors[i]),island,[0,-0.39,0]);
    mesh(roundedBox(p.w-0.13,0.09,p.d-0.13,0.38),mat(tops[i]),island,[0,-0.11,0]);
    const rock=createIrregularRockVisual({radius:1,detail:1,irregularity:0.19,scaleVariance:0,color:colors[i],prng:rand}).mesh;rock.scale.set(p.w*0.53,thickness*0.55,p.d*0.54);rock.position.y=-thickness*0.57-0.3;island.add(rock);
    for(let k=0;k<4;k++){const side=createIrregularRockVisual({radius:1,detail:0,irregularity:0.12,scaleVariance:0,color:colors[i],prng:rand}).mesh;const a=k*Math.PI/2+0.3;side.scale.set(1.4,1.9,1.25);side.position.set(Math.cos(a)*p.w*0.35,-1.7,Math.sin(a)*p.d*0.35);island.add(side);}
    // Shallow markings and flat facets preserve an unambiguous playable top.
    const patchMat=mat(0xffffff);for(let k=0;k<6;k++){const q=mesh(new T.CircleGeometry(rand.uniform(0.14,0.36),6),patchMat,island,[rand.uniform(-p.w*.37,p.w*.37),-0.005,rand.uniform(-p.d*.35,p.d*.35)]);q.rotation.x=-Math.PI/2;}
    for(const side of [-1,1]){const shard=mesh(new T.BoxGeometry(0.4,0.4,0.4),mat(0x00d0ff),island,[side*p.w*.38,-0.85,p.d*.4],[0.55,1.6,0.8]);shard.rotation.z=side*0.5;}
    const badge=label(`0${i+1}`,'#ffffff',68);badge.position.set(-p.w*.34,0.09,p.d*.25);badge.material.depthTest=true;badge.scale.set(1.1,0.28,1);badge.rotation.x=-Math.PI/2;island.add(badge);
  }
  // Direction chevrons follow the actual supported route, without bridging its gaps.
  const arrowMat=new T.MeshBasicMaterial({color:0x00d0ff,side:T.DoubleSide});
  const ag=new T.BoxGeometry(0.55,0.08,0.7);
  for(let i=0;i<PLATFORMS.length-1;i++){const p=PLATFORMS[i],n=PLATFORMS[i+1];const dx=n.x-p.x,dz=n.z-p.z,l=Math.hypot(dx,dz);for(let k=0;k<2;k++){const a=mesh(ag,arrowMat,scene,[p.x+dx/l*(p.w/2-1.0-k*.55),p.top+0.015,p.z+dz/l*(p.d/2-1.0-k*.55)]);a.rotation.x=-Math.PI/2;a.rotation.z=Math.atan2(dx,-dz);}}
  const coinMat=mat(0xffd000);
  const coins=COINS.map(c=>{const group=new T.Group();group.position.set(c.x,c.y,c.z);scene.add(group);const disc=mesh(new T.CylinderGeometry(.34,.34,.10,8),coinMat,group);disc.rotation.x=Math.PI/2;const halo=mesh(new T.BoxGeometry(.92,.92,.02),new T.MeshBasicMaterial({color:0xffd000,transparent:true,opacity:.35}),group);group.traverse(o=>{if(o.isMesh)o.castShadow=false;});return {c,group,halo};});
  // Distant monumental rocks give the traversable stones a lunar landscape context.
  for(let i=0;i<15;i++){const a=i*2.399;const x=7+Math.cos(a)*rand.uniform(25,48),z=-10+Math.sin(a)*rand.uniform(28,50);const r=createIrregularRockVisual({radius:1,detail:0,color:i%2?0x904070:0x2a8098,prng:rand}).mesh;r.position.set(x,rand.uniform(-11,-5),z);r.scale.set(rand.uniform(3,6),rand.uniform(4,11),rand.uniform(3,7));scene.add(r);}
  const beacon=new T.Group();beacon.position.set(-1.6,3.3,-17.5);scene.add(beacon);mesh(new T.BoxGeometry(1.4,.16,1.4),mat(0x8a9aa8),beacon,[0,.08,0]);const beaconRing=mesh(new T.BoxGeometry(1.48,0.14,1.48),mat(0x00e000),beacon,[0,1.25,0]);mesh(new T.BoxGeometry(.06,2.1,.06),mat(0x8a9aa8),beacon,[0,1.15,0]);const top=mesh(new T.BoxGeometry(.4,.4,.4),mat(0x00e000),beacon,[0,2.25,0]);
  const startRing=mesh(new T.BoxGeometry(2,.04,2),new T.MeshBasicMaterial({color:0x00d0ff}),scene,[0,.02,1]);
  const bot=robot();scene.add(bot.group,bot.shadow);bot.group.traverse(o=>{if(o.isMesh)o.castShadow=false;});
  // A fixed-size particle pool is driven only by real coin events.
  const particles=[];const pg=new T.BoxGeometry(.09,.09,.09),pm=new T.MeshBasicMaterial({color:0xffd000});for(let i=0;i<40;i++){const m=new T.Mesh(pg,pm);m.visible=false;scene.add(m);particles.push({m,life:0,v:new T.Vector3()});}
  if(lowPower)scene.traverse(o=>{if(!o.isMesh)return;const m=o.material;if(m.isMeshStandardMaterial)o.material=new T.MeshLambertMaterial({color:m.color,emissive:m.emissive,emissiveIntensity:m.emissiveIntensity,flatShading:m.flatShading,side:m.side,transparent:m.transparent,opacity:m.opacity});});
  let lastRound=0,lastEvent=0,cursor=0;
  return {bot,update(s,dt){if(s.roundId!==lastRound){lastRound=s.roundId;lastEvent=0;for(const p of particles){p.life=0;p.m.visible=false;}}bot.update(s);for(const {c,group,halo}of coins){group.visible=!s.picked[c.id];group.position.y=c.y+Math.sin(s.elapsed*2.6+c.x)*.1;group.rotation.y=s.elapsed*1.7;halo.rotation.z=s.elapsed*.6;}for(const event of s.events){if(event.id<=lastEvent)continue;if(event.type==='coin.collected'){const c=COINS.find(c=>c.id===event.coinId);for(let k=0;k<8;k++){const p=particles[cursor++%particles.length];p.life=.65;p.m.visible=true;p.m.position.set(c.x,c.y,c.z);const a=k*Math.PI/4;p.v.set(Math.cos(a)*1.6,1.3+rand.random(),Math.sin(a)*1.6);}}lastEvent=event.id;}for(const p of particles)if(p.life>0){p.life-=dt;p.m.visible=p.life>0;p.v.y-=dt*4;p.m.position.addScaledVector(p.v,dt);p.m.scale.setScalar(Math.max(0,p.life/.65));}beaconRing.rotation.y=s.elapsed*.4;top.rotation.y=s.elapsed;}};
}
