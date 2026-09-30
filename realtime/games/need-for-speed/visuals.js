import * as T from 'three';
import { createVehicleVisual } from '/assets/world/object/factory/VehicleVisualFactory.js';
import { createBuildingVisual } from '/assets/world/object/factory/BuildingVisualFactory.js';
import { createTreeVisual } from '/assets/world/object/factory/TreeVisualFactory.js';
import { trackFrame } from './track.mjs';
import { BOOST_PACKS, PACK_LANES } from './game.mjs';
const lime=0x00e000;
const mat=(color,extra={})=>new T.MeshLambertMaterial({color,...extra});
const litCache=new WeakMap();
function simpleLit(m){if(!m.isMeshStandardMaterial)return m;if(!litCache.has(m))litCache.set(m,new T.MeshLambertMaterial({color:m.color}));return litCache.get(m);}
const glow=color=>new T.MeshBasicMaterial({color});
function box(parent,w,h,d,x,y,z,material){const o=new T.Mesh(new T.BoxGeometry(w,h,d),material);o.position.set(x,y,z);parent.add(o);return o;}
function signTexture(text,sub,color='#ffffff'){
 const c=document.createElement('canvas');c.width=1024;c.height=256;const g=c.getContext('2d');g.fillStyle='#1a3040';g.fillRect(0,0,1024,256);g.strokeStyle=color;g.lineWidth=8;g.strokeRect(10,10,1004,236);g.fillStyle=color;g.font='900 italic 92px sans-serif';g.textAlign='center';g.fillText(text,512,125);g.font='600 28px sans-serif';g.fillStyle='#ffffff';g.fillText(sub,512,197);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t;
}
const params={vehicles:[],buildings:[],trees:[]};
// Collapse static factory output by material so the skyline costs a small draw-call count.
function batchStatic(root){root.updateMatrixWorld(true);const groups=new Map();root.traverse(o=>{if(!o.isMesh)return;let g=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();g.applyMatrix4(o.matrixWorld);const m=o.material,key=[m.color.getHex(),m.emissive?.getHex(),m.emissiveIntensity,m.roughness,m.metalness].join(':');if(!groups.has(key))groups.set(key,{mat:m,position:[],normal:[]});const a=groups.get(key);a.position.push(...g.attributes.position.array);a.normal.push(...g.attributes.normal.array);g.dispose();});const result=new T.Group();for(const a of groups.values()){const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(a.position,3));g.setAttribute('normal',new T.Float32BufferAttribute(a.normal,3));result.add(new T.Mesh(g,simpleLit(a.mat)));}return result;}
function roadStrip(parent,left,right,y,material){const pos=[],uv=[];for(let d=0;d<240;d+=.5){const ps=[trackFrame(d,left),trackFrame(d+.5,left),trackFrame(d,right),trackFrame(d,right),trackFrame(d+.5,left),trackFrame(d+.5,right)];ps.forEach(p=>{pos.push(p.x,y,p.z);uv.push(p.x*.35,p.z*.35);});}const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();parent.add(new T.Mesh(g,material));}
function createRoad(scene){
 roadStrip(scene,-8,8,.015,mat(0xb8a070,{side:T.DoubleSide}));roadStrip(scene,-6,6,.045,mat(0x3a4a52,{side:T.DoubleSide}));
 const staticRoad=new T.Group(),white=glow(0xffffff),edge=mat(0xc0c0c0),kerb=mat(0xe07040);
 for(let d=0;d<240;d+=2){
  for(const l of [-2,2]){const p=trackFrame(d,l),m=box(staticRoad,.065,.012,.82,p.x,.062,p.z,white);m.rotation.y=p.yaw;}
  for(const l of [-6.2,6.2]){const p=trackFrame(d,l),m=box(staticRoad,.35,.3,2.28,p.x,.15,p.z,edge);m.rotation.y=p.yaw;const e=box(staticRoad,.07,.025,1.96,p.x,.315,p.z,kerb);e.rotation.y=p.yaw;}
 }
 for(let row=0;row<3;row++)for(let col=0;col<18;col++){const p=trackFrame(row*.55,col*.65-5.5);const m=box(staticRoad,.65,.02,.61,p.x,.085,p.z,glow((col+row)%2?0x202020:0xffffff));m.rotation.y=p.yaw;}
 for(let d=50;d<240;d+=60){const p=trackFrame(d,6.8),g=new T.Group();g.position.set(p.x,1.4,p.z);g.rotation.y=p.yaw;const panel=new T.Mesh(new T.PlaneGeometry(4,1.1),new T.MeshBasicMaterial({map:signTexture('<<<','CITY CIRCUIT','#ffffff'),side:T.DoubleSide}));g.add(panel);scene.add(g);}
 scene.add(batchStatic(staticRoad));
 const arch=new T.Group(),p=trackFrame(0);arch.position.set(p.x,0,p.z);arch.rotation.y=p.yaw;
 for(const x of [-6.9,6.9]){box(arch,.5,6,.6,x,3,0,mat(0x2a70a8));box(arch,.08,5.7,.65,x,3,0,mat(0xffd000));}
 const sign=new T.Mesh(new T.BoxGeometry(14.5,1.4,.4),mat(0x1a3040));sign.position.y=6;arch.add(sign);const banner=new T.Mesh(new T.PlaneGeometry(14,1.25),new T.MeshBasicMaterial({map:signTexture('NEON CIRCUIT','MIDNIGHT STREET LEAGUE','#ffffff'),side:T.DoubleSide}));banner.position.set(0,6,.23);arch.add(banner);scene.add(arch);
}
const WALL_COLORS=['#e07040','#3a88c8','#e0c040','#c05078','#2aa080','#7a6ad0'];
function createCity(scene){
 const staticCity=new T.Group();const positions=[];
 for(const x of [-48,48])for(let z=-58;z<=64;z+=23)positions.push([x,z]);
 for(const z of [-61,62])for(const x of [-22,0,23])positions.push([x,z]);
 for(const x of [-10,10])for(const z of [-17,6,26])positions.push([x,z]);
 for(let i=0;i<positions.length;i++){
  const [x,z]=positions[i],inner=Math.abs(x)<20&&Math.abs(z)<40;
  const wall=WALL_COLORS[i%WALL_COLORS.length];
  const opts={preset:i%4===0?'skyscraper':'office',massing:i%3===0?'setback':'block',width:inner?11:12+i%3,depth:inner?12:14,floors:inner?3+i%4:5+i%9,floorHeight:2.8,facade:i%4===0?'grid':'glass',windows:3,bands:true,balconies:false,storefront:true,roof:i%5===0?'spire':'flat',colors:{wall,roof:'#a05038',trim:'#f0e0c8',window:'#1e3a48',accent:'#e8a040',base:'#6a4030'}};
  const b=createBuildingVisual(opts);params.buildings.push({position:[x,z],...b.params});b.group.position.set(x,.06,z);staticCity.add(b.group);
  const h=opts.floors*2.8;
  for(const side of [-1,1])box(staticCity,.095,h,.095,x+side*opts.width*.5,h*.5,z-opts.depth*.5,mat(0xe8c040));
  if(i%2===0){const face=new T.Mesh(new T.PlaneGeometry(7,1.75),new T.MeshBasicMaterial({map:signTexture(['AFTERHOURS','NOVA / 24','MIDNIGHT','ARCADE'][i%4],'DOWNTOWN  ·  OPEN LATE','#ffffff'),side:T.DoubleSide}));face.position.set(x,4,z-opts.depth*.5-.16);scene.add(face);}
 }
 // Distant skyline remains decorative and sits well beyond the race corridor.
 for(let i=0;i<32;i++){const a=i/32*Math.PI*2,r=106+(i%3)*15,h=18+(i*13)%49,x=Math.cos(a)*r,z=Math.sin(a)*r;box(staticCity,8+i%5,h,8,x,h/2,z,mat(i%2?0x3a78b0:0xc06050));for(let y=4;y<h;y+=3.4)box(staticCity,7,.08,8.04,x,y,z,mat(0x1e3a48));}
 for(let d=8;d<240;d+=14){
  const p=trackFrame(d,8),g=new T.Group();g.position.set(p.x,0,p.z);g.rotation.y=p.yaw;
  box(g,.11,6,.11,0,3,0,mat(0xc87820));box(g,2.3,.11,.11,-1.1,6,0,mat(0xe8a040));box(g,1.1,.055,.4,-1.8,5.96,0,mat(0xffffff));staticCity.add(g);
 }
 for(let d=12;d<240;d+=26){const p=trackFrame(d,-9.3),b=createTreeVisual({preset:'palm',height:5.8,crownWidth:3.4,branches:5,fruit:false,roots:false,wind:0,colors:{bark:'#8a5a30',leaf:'#2ea82e',leafLight:'#50d050'},shapeSeed:d});params.trees.push(b.params);b.group.position.set(p.x,.08,p.z);staticCity.add(b.group);box(staticCity,2,.35,2,p.x,.18,p.z,mat(0xc07040));}
 scene.add(batchStatic(staticCity));
}
function raceCar(color,isPlayer){
 const v=createVehicleVisual({preset:'coupe',width:1.8,length:3.6,height:1.12,cabinRatio:.47,cabinWidth:.82,spoiler:true,wheelScale:.88,mirrors:true,stripe:true,colors:{body:color,roof:color,window:'#1a3040',chassis:'#1a1a1a',wheel:'#1a1a1a',hub:'#d0d0d0',accent:'#ffffff',lamp:'#ffffff'}});params.vehicles.push(v.params);
 v.group.traverse(o=>{if(o.isMesh)o.material=simpleLit(o.material);});
 const shell=new T.Group();for(const o of [...v.group.children])if(o.name!=='steering-pivot')shell.add(o);v.group.add(batchStatic(shell));
 const tail=new T.Group();box(tail,1.5,.055,.04,0,.48,1.82,glow(0xff2000));for(const x of [-.65,.65])box(tail,.34,.04,.03,x,.57,-1.82,glow(0xffffff));v.group.add(tail);
 box(v.group,.18,.025,1.0,-.28,.52,-1.05,glow(isPlayer?0xffffff:0x202020));
 const flame=new T.Group();for(const x of [-.57,.57]){const m=new T.Mesh(new T.BoxGeometry(.22,1.6,.22),new T.MeshBasicMaterial({color:lime,transparent:true,opacity:.9}));m.rotation.x=Math.PI/2;m.position.set(x,.27,2.48);flame.add(m);}v.group.add(flame);
 return {...v,flame};
}
export function createWorld(scene){
 scene.background=new T.Color(0x4aa8ff);scene.add(new T.HemisphereLight(0xffffff,0x909090,1.8));const key=new T.DirectionalLight(0xffffff,2.2);key.position.set(40,65,25);scene.add(key);
 const ground=new T.Mesh(new T.PlaneGeometry(460,460),mat(0x4a7a40));ground.rotation.x=-Math.PI/2;ground.position.y=-.04;scene.add(ground);createRoad(scene);createCity(scene);
 const player=raceCar('#0066ff',true),rivals=['#ff2000','#ff00d0','#ff8000'].map(c=>raceCar(c,false));scene.add(player.group);rivals.forEach(v=>scene.add(v.group));
 const packs=BOOST_PACKS.map((d,i)=>{const root=new T.Group(),p=trackFrame(d,PACK_LANES[i]);root.position.set(p.x,.09,p.z);root.rotation.y=p.yaw;box(root,1.75,.06,3,0,.02,0,mat(0x186018));for(let z=-.85;z<1;z+=.65){const a=box(root,.95,.045,.19,-.31,.08,z,glow(lime));a.rotation.y=-.58;const b=box(root,.95,.045,.19,.31,.08,z,glow(lime));b.rotation.y=.58;}for(const x of [-.9,.9])box(root,.035,.04,3,x,.08,0,glow(lime));scene.add(root);return root;});
 // Collision feedback flickers the body for collisionCooldown's 1.25 s; the
 // round guard clears it so a fresh round never starts mid-blink.
 let prevRound=0;
 return {params,player,rivals,packs,update(s){
  const fresh=s.roundId!==prevRound;prevRound=s.roundId;
  const p=trackFrame(s.distance,s.lane);player.group.position.set(p.x,.08,p.z);player.group.rotation.set(0,p.yaw-s.steering*.075,-s.steering*.025);player.setPose(s.distance*1.1);player.wheelPivots.forEach((w,i)=>w.rotation.x=-s.distance*1.1/player.wheelRecords[i].radius);player.steeringPivots.forEach(x=>x.rotation.y=-s.steering*.22);player.flame.visible=s.boostSeconds>0&&!s.braking&&s.state==='RUNNING';player.group.visible=s.collisionCooldown<1.25||Math.floor(s.elapsed*14)%2===0;
  rivals.forEach((v,i)=>{const r=trackFrame(s.rivalDistances[i],s.rivalLanes[i]);v.group.position.set(r.x,.08,r.z);v.group.rotation.y=r.yaw;v.setPose(s.rivalDistances[i]*1.1);v.wheelPivots.forEach((w,j)=>w.rotation.x=-s.rivalDistances[i]*1.1/v.wheelRecords[j].radius);v.flame.visible=false;});packs.forEach((v,i)=>{v.visible=!s.collected[i];});if(fresh)player.group.visible=true;
 },read(){return{player:{x:player.group.position.x,z:player.group.position.z,yaw:player.group.rotation.y},rivals:rivals.map(v=>({x:v.group.position.x,z:v.group.position.z})),visiblePacks:packs.filter(v=>v.visible).length};}};
}
