import * as THREE from 'three';
import { createCharacterVisual } from '/assets/world/object/factory/CharacterVisualFactory.js';
import { buildSimpleFantasyCreatureVisual } from '/assets/world/object/factory/FantasyCreatureVisualFactory.js';

export const actorOptions = {
  hero: {preset:'runner',height:2.25,build:1.1,headShape:'box',loadout:{left:null,right:null},colors:{skin:'#edbb9f',top:'#12dc70',pants:'#1c88dd',accent:'#ffcb78'}},
  vampire_one: {preset:'vampire',referenceHeight:2.35,cloak:true,cloakWidth:1.25,colors:{body:'#ffc1de',clothing:'#e02083',membrane:'#9c164f',accent:'#ec588c',eye:'#ff4c81'}},
  vampire_two: {preset:'vampire',referenceHeight:2.45,cloak:true,cloakWidth:1.2,colors:{body:'#d8c1ff',clothing:'#8625e5',membrane:'#6331c0',accent:'#b891ee',eye:'#c089ff'}},
  dragon_boss: {preset:'dragon',referenceHeight:3.2,heightScale:1.18,bodyLength:1.25,wingSpan:1.3,hornStyle:'swept',hornSize:1.25,tailLength:1.15,colors:{body:'#f45625',belly:'#ffd32e',membrane:'#d02c34',bone:'#ffc582',accent:'#ee8750',eye:'#fff0a0'}}
};
const mats = new Map();
export function material(color,lit=true) {
  const key = `${color}:${lit}`;
  if (!mats.has(key)) mats.set(key,lit?new THREE.MeshLambertMaterial({color}):new THREE.MeshBasicMaterial({color}));
  return mats.get(key);
}
export function block(parent,size,pos,color,lit=true) {
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),material(color,lit));
  mesh.position.set(...pos); parent.add(mesh); return mesh;
}
function textSign(parent,text,x,y,z,color,width=3.2,height=.85) {
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,512,128);
  ctx.fillStyle='#101724';ctx.fillRect(0,0,512,128);
  ctx.strokeStyle=color;ctx.lineWidth=5;ctx.strokeRect(5,5,502,118);
  ctx.font='bold 55px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(text,256,66,468);
  const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map:tex}));sign.position.set(x,y,z);parent.add(sign);return sign;
}
function instances(scene,geo,mat,positions) {
  const mesh=new THREE.InstancedMesh(geo,mat,positions.length),dummy=new THREE.Object3D();
  positions.forEach((p,i)=>{dummy.position.set(...p);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);});scene.add(mesh);return mesh;
}
function shadow(scene,x,z,size,color='#080b18',opacity=.5) {
  const mesh=new THREE.Mesh(new THREE.CircleGeometry(1,24),new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false}));
  mesh.rotation.x=-Math.PI/2;mesh.scale.set(size,size*.65,1);mesh.position.set(x,.035,z);scene.add(mesh);return mesh;
}
export function createWorld({preview=false}={}) {
  const scene=new THREE.Scene();scene.background=new THREE.Color('#4aa8ff');
  scene.add(new THREE.HemisphereLight('#ffffff','#888888',2.0));
  const moonlight=new THREE.DirectionalLight('#ffffff',1.8);moonlight.position.set(-6,12,10);scene.add(moonlight);
  const world=new THREE.Group();scene.add(world);
  const street=block(world,[66,.3,8],[0,-.2,0],'#6654c9');street.name='street';
  block(world,[66,.34,1.3],[0,-.05,-4.1],'#f27a54');
  block(world,[66,.24,.3],[0,-.05,4.1],'#f27a54');
  block(world,[66,.08,.07],[0,.02,-3.42],'#ffda25',false);
  block(world,[66,.05,.07],[0,-.02,3.98],'#ffda25',false);
  const paving=[],stripes=[],windows=[],warmWindows=[];
  for(let x=-32;x<=32;x+=2){paving.push([x,.001,0]);if(x%4===0)stripes.push([x,.015,2.7]);}
  instances(scene,new THREE.BoxGeometry(.024,.022,7.8),material('#5940b3'),paving);
  instances(scene,new THREE.BoxGeometry(1.15,.024,.09),material('#ffed6d'),stripes);
  for(let z=-3;z<=3;z+=1.5)block(world,[66,.02,.018],[0,.008,z],'#5940b3');
  const lamps=new THREE.Group();lamps.name='street_lamps';scene.add(lamps);
  for(let i=0;i<13;i++){
    const x=-31+i*5.2;const height=5+(i%3)*1.45;
    block(world,[4.85,height,3],[x,height/2,-6.5],['#e1a41c','#e7ae26','#d89418'][i%3]);
    block(world,[5,.18,3.1],[x,height,-6.5],'#ac542a');
    block(world,[.12,height,.14],[x-2.35,height/2,-4.91],'#a34cdf');
    block(world,[1.55,2.65,.05],[x,.95,-4.96],'#324edc');
    block(world,[1.7,.09,.09],[x,2.3,-4.86],i%2?'#ff5b4e':'#ff5b4e',false);
    for(let row=0;row<Math.floor(height/1.35)-1;row++)for(let col=0;col<3;col++){
      (i%2?windows:warmWindows).push([x-1.55+col*1.55,3.15+row*1.27,-4.94]);
    }
    if(i%2===0){
      block(lamps,[.12,4.25,.12],[x+2,2.1,-3.65],'#8cc91e');
      block(lamps,[.8,.1,.12],[x+2.3,4.18,-3.65],'#8cc91e');
      block(lamps,[.45,.14,.32],[x+2.65,4.08,-3.65],'#fff06b',false);
    }
  }
  instances(scene,new THREE.BoxGeometry(.55,.63,.035),material('#1ed9d1',false),windows);
  instances(scene,new THREE.BoxGeometry(.55,.63,.035),material('#1ed9d1',false),warmWindows);
  textSign(world,'NIGHTFANG',-21,3.1,-4.84,'#80e0d6',4.1);
  textSign(world,'AFTERLIFE',-10.2,3.1,-4.84,'#e989ad',4.1);
  textSign(world,'BAR 13',.2,3.1,-4.84,'#e8bf8e',3.6);
  textSign(world,'LAST LIGHT',10.6,3.1,-4.84,'#91c6e8',4.1);
  textSign(world,'NO RETURN',21,3.1,-4.84,'#ee8a9a',4.1);
  for(let i=0;i<15;i++)block(world,[3+(i%3),7+(i%5),4],[-45+i*6,3.5+(i%5)/2,-15-(i%3)*3],'#2074ba');
  const gate=new THREE.Group();gate.name='boss_gate';world.add(gate);
  for(let z=-3.2;z<=3.2;z+=.8)block(gate,[.05,2,.065],[12.2,1,z],'#ff304e',false);
  block(gate,[.13,.08,6.8],[12.2,2.02,0],'#ff304e',false);
  for(let x of [-28,-16,5,24]){
    block(world,[.85,.85,.7],[x,.42,-2.95],'#27c597');
    block(world,[.96,.09,.8],[x,.88,-2.95],'#e9db35');
  }
  const actors={},shadows={};
  const positions=preview?{hero:[-8.3,0,.8],vampire_one:[-2.9,0,-.1],vampire_two:[1.6,0,0],dragon_boss:[7.7,0,.1]}:{hero:[-23,0,0],vampire_one:[-14,0,-.8],vampire_two:[-3,0,1],dragon_boss:[21,0,0]};
  for(const [id,options] of Object.entries(actorOptions)){
    const actor=id==='hero'?createCharacterVisual(options):buildSimpleFantasyCreatureVisual(options);
    actor.mesh.name=id;actor.mesh.position.set(...positions[id]);actor.mesh.rotation.y=id==='hero'?-Math.PI/2:Math.PI/2;
    actor.setPose(id==='hero'?'idle':'still',0);scene.add(actor.mesh);actors[id]=actor;
    shadows[id]=shadow(scene,positions[id][0],positions[id][2],id==='dragon_boss'?2.35:.66);
  }
  for(const id of ['vampire_one','vampire_two']){
    const v=actors[id],accent=id==='vampire_one'?'#e95384':'#b081ff';
    block(v.rig.chest,[.41,.4,.26],[0,.23,0],'#d02890');
    block(v.rig.chest,[.11,.35,.028],[0,.25,-.15],accent);
    block(v.rig.head,[.225,.06,.24],[0,.115,0],'#803ace');
    for(const x of [-.06,.06]){
      block(v.rig.head,[.037,.027,.024],[x,.025,-.123],accent,false);
      const fang=new THREE.Mesh(new THREE.ConeGeometry(.014,.06,4),material('#fff0de'));fang.position.set(x,-.082,-.126);fang.rotation.z=Math.PI;v.rig.head.add(fang);
    }
    const collar=block(v.rig.chest,[.53,.17,.13],[0,.43,.1],accent);collar.rotation.x=-.25;
    if(v.rig.cloak){v.rig.cloak.children[0].material=material(id==='vampire_one'?'#c82782':'#7531c8');v.rig.cloak.rotation.y=.25;}
  }
  // Batch static masonry into two draws. Dynamic gates and actors keep their owners.
  const buckets=[[],[]];
  for(const root of [world,lamps])for(const child of [...root.children]){
    if(child.isMesh&&child.geometry.type==='BoxGeometry'){
      child.updateMatrix();buckets[child.material.isMeshBasicMaterial?1:0].push(child);root.remove(child);
    }
  }
  buckets.forEach((items,index)=>{
    const batch=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),index?new THREE.MeshBasicMaterial({color:'white'}):new THREE.MeshLambertMaterial({color:'white'}),items.length);
    const matrix=new THREE.Matrix4(),scale=new THREE.Matrix4();
    items.forEach((item,i)=>{const g=item.geometry.parameters;scale.makeScale(g.width,g.height,g.depth);matrix.copy(item.matrix).multiply(scale);batch.setMatrixAt(i,matrix);batch.setColorAt(i,item.material.color);item.geometry.dispose();});
    if(index===0)batch.name='street';scene.add(batch);
  });
  const hero=actors.hero;
  block(hero.attachments.head,[.43,.17,.42],[0,.2,0],'#154cad');
  block(hero.attachments.head,[.44,.065,.42],[0,.11,0],'#f4c985',false);
  block(hero.rig.chest,[.55,.47,.04],[0,.35,-.239],'#17ec77');
  for(const hand of [hero.attachments.leftHand,hero.attachments.rightHand])block(hand,[.29,.25,.32],[0,0,-.05],'#efb768');
  scene.traverse(object=>{
    if(!object.isMesh)return;
    for(const mat of (Array.isArray(object.material)?object.material:[object.material])){
      if('metalness' in mat)mat.metalness=0;
      if('roughness' in mat)mat.roughness=1;
      if(mat.emissive)mat.emissive.set(0);
    }
  });
  const camera=new THREE.OrthographicCamera(-14,14,8.2,-8.2,.1,120);
  camera.position.set(0,12,20);camera.lookAt(0,1,0);
  return {scene,camera,actors,shadows,gate};
}
export function syncPlacement(world,positions){
  for(const [id,p] of Object.entries(positions)){
    const actor=world.actors[id];actor.mesh.position.set(p.x,p.y||0,p.z);
    world.shadows[id].position.set(p.x,.035,p.z);world.shadows[id].visible=actor.mesh.visible;
  }
}
