import * as THREE from 'three';
import { createCharacterVisual } from '/assets/world/object/factory/CharacterVisualFactory.js';
import { createVehicleVisual } from '/assets/world/object/factory/VehicleVisualFactory.js';
import { createBuildingVisual } from '/assets/world/object/factory/BuildingVisualFactory.js';
import { BLOCKS, WALLS, PROFESSIONS } from './simulation.js';
import { CAR_OPTIONS, CHARACTER_OPTIONS, buildingOptions } from './tuning.mjs';

// Consolidate rigid pieces without touching the character's animation joints.
const batchMaterial = new THREE.MeshLambertMaterial({ vertexColors:true });
function mergeMeshes(meshes, matrixOf) {
  const positions=[], normals=[], colors=[];
  for(const mesh of meshes) {
    const g=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();
    g.applyMatrix4(matrixOf(mesh)); const pos=g.getAttribute('position'), normal=g.getAttribute('normal'), color=mesh.material.color;
    for(let i=0;i<pos.count;i++) { positions.push(pos.getX(i),pos.getY(i),pos.getZ(i));
      normals.push(normal.getX(i),normal.getY(i),normal.getZ(i));colors.push(color.r,color.g,color.b); }
    g.dispose();
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geo.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geo.computeBoundingSphere();const mesh=new THREE.Mesh(geo,batchMaterial);mesh.castShadow=true;mesh.receiveShadow=true;return mesh;
}
function optimizeJoints(root) {
  for(const child of [...root.children]) if(!child.isMesh) optimizeJoints(child);
  const parts=root.children.filter(c=>c.isMesh&&!c.children.length&&!Array.isArray(c.material));
  if(parts.length>1) { parts.forEach(p=>p.updateMatrix());const combined=mergeMeshes(parts,p=>p.matrix);
    root.remove(...parts);root.add(combined); }
}
const materialCache=new Map();const boxGeo=new THREE.BoxGeometry(1,1,1);
function box(parent,size,pos,color) {
  if(!materialCache.has(color))materialCache.set(color,new THREE.MeshLambertMaterial({color}));
  const mesh=new THREE.Mesh(boxGeo,materialCache.get(color));mesh.scale.set(...size);mesh.position.set(...pos);
  mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
}
function sign(text,color='#ffffff',background='#3c3c3c') {
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
  const c=canvas.getContext('2d');c.fillStyle=background;c.fillRect(0,0,512,128);
  c.fillStyle=color;c.textAlign='center';c.textBaseline='middle';c.font='bold 62px sans-serif';c.fillText(text,256,66);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(5.8,1.45),new THREE.MeshBasicMaterial({map:texture}));
}
export function makeVisuals(scene,sim,view={w:innerWidth,h:innerHeight}) {
  const city=new THREE.Group();scene.add(city);
  box(city,[103,.5,103],[0,-.36,0],'#2a3c44');box(city,[104,1,104],[0,-1,0],'#1e2e34');
  for(const b of BLOCKS) {
    const x=b.x,z=b.z;
    box(city,[b.w+2.4,.02,b.d+2.4],[x+b.h*.28,.024,z-b.h*.12],'#1a282c');
    box(city,[b.w+1.5,.18,b.d+1.5],[b.x,0,b.z],'#c9b07a');
    box(city,[b.w+1.1,.08,b.d+1.1],[b.x,.13,b.z],'#d8c89a');
    const building=createBuildingVisual(buildingOptions(b));building.group.position.set(b.x,.17,b.z);city.add(building.group);
    const plaque=sign(['咖啡  ·  CAFE','街区  /  01','诊所  +','消防  119'][b.index%4]);
    plaque.position.set(b.x,2.3,b.z+b.d/2+.11);scene.add(plaque);
    const front=sign(['CAFE','NORTH 27','MEDICAL +','FIRE STATION'][b.index%4]);
    front.position.set(b.x,2.3,b.z-b.d/2-.11);front.rotation.y=Math.PI;scene.add(front);
    box(city,[2,.7,1.7],[b.x+2,b.h+.55,b.z-2],'#c06040');
    box(city,[2.8,.28,2.8],[b.x-2.3,b.h+.3,b.z+2],'#e8a040');
    box(city,[2,.6,2],[b.x-2.3,b.h+.65,b.z+2],'#3aa0a8');
  }
  for(const b of WALLS.slice(16)) {
    box(city,[b.w,b.h,b.d],[b.x,b.h/2,b.z],'#4a6a6c');
    box(city,[b.w+.1,.15,b.d+.1],[b.x,b.h+.075,b.z],'#e8c878');
  }
  for(const lane of [-27,0,27]) for(let k=-43;k<=43;k+=5.5) {
    if([-27,0,27].some(v=>Math.abs(k-v)<6))continue;
    for(const side of [-.22,.22]) {
      box(city,[.11,.016,2.3],[lane+side,.035,k],'#ffd000');
      box(city,[2.3,.016,.11],[k,.035,lane+side],'#ffd000');
    }
  }
  for(const x of [-27,0,27])for(const z of [-27,0,27])for(const side of [-1,1])for(let k=-3;k<=3;k++) {
    box(city,[.65,.016,1.8],[x+k*1.12,.04,z+side*6],'#ffffff');
    box(city,[1.8,.016,.65],[x+side*6,.04,z+k*1.12],'#ffffff');
  }
  for(let i=-42;i<46;i+=6) {
    box(city,[1.7,.025,.5],[i,.05,-47.65],i%12===0?'#ffd000':'#1e2e34');
    box(city,[1.7,.025,.5],[i,.05,47.65],i%12===0?'#ffd000':'#1e2e34');
  }
  city.updateMatrixWorld(true);const staticParts=[];city.traverse(o=>{if(o.isMesh)staticParts.push(o);});
  const combined=mergeMeshes(staticParts,m=>m.matrixWorld);scene.remove(city);scene.add(combined);
  const shade=new THREE.Mesh(new THREE.CircleGeometry(1,24),new THREE.MeshBasicMaterial({color:'#1a282c',transparent:true,opacity:.5,depthWrite:false}));
  shade.rotation.x=-Math.PI/2;shade.scale.set(1.25,2.45,1);scene.add(shade);
  const vehicle=createVehicleVisual(CAR_OPTIONS);optimizeJoints(vehicle.group);scene.add(vehicle.group);
  const rearLights=[];for(const x of [-.66,.66]) {const m=box(vehicle.group,[.42,.18,.05],[x,.68,2.04],'#ff2000');
    m.material=m.material.clone();rearLights.push(m);}
  const ringGeo=new THREE.RingGeometry(.65,.82,24);const shadowGeo=new THREE.CircleGeometry(.68,20);
  const people=sim.people.map(p=>{
    const visual=createCharacterVisual(CHARACTER_OPTIONS[p.role]);optimizeJoints(visual.group);
    const root=new THREE.Group();root.add(visual.group);
    const ring=new THREE.Mesh(ringGeo,new THREE.MeshBasicMaterial({color:PROFESSIONS[p.role].color,transparent:true,opacity:.75,depthWrite:false}));
    ring.rotation.x=-Math.PI/2;scene.add(ring);
    const shadow=new THREE.Mesh(shadowGeo,new THREE.MeshBasicMaterial({color:'#1a282c',transparent:true,opacity:.32,depthWrite:false}));
    shadow.rotation.x=-Math.PI/2;scene.add(shadow);
    const tag=document.createElement('div');tag.className='person-tag';tag.style.setProperty('--role',PROFESSIONS[p.role].color);
    tag.innerHTML=`<span>${PROFESSIONS[p.role].name}</span><i></i><i></i>`;document.querySelector('#labels').append(tag);
    return {visual,root,ring,shadow,tag};
  });
  // The factory rigs remain live, while one world-space buffer renders their evaluated poses.
  // This preserves profession details and joints at one draw call for all 24 people.
  const chunks=[];let vertexCount=0;
  people.forEach(v=>v.root.traverse(m=>{if(!m.isMesh)return;
    const g=m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone();const count=g.attributes.position.count;
    chunks.push({mesh:m,position:g.attributes.position.array.slice(),normal:g.attributes.normal.array.slice(),
      colors:g.attributes.color?.array.slice(),color:m.material.color,offset:vertexCount*3,count});vertexCount+=count;g.dispose();
  }));
  const posArray=new Float32Array(vertexCount*3),normArray=new Float32Array(vertexCount*3),colArray=new Float32Array(vertexCount*3);
  for(const c of chunks)for(let j=0;j<c.count*3;j++)colArray[c.offset+j]=c.colors?c.colors[j]:[c.color.r,c.color.g,c.color.b][j%3];
  const dynamicGeo=new THREE.BufferGeometry();dynamicGeo.setAttribute('position',new THREE.BufferAttribute(posArray,3).setUsage(THREE.DynamicDrawUsage));
  dynamicGeo.setAttribute('normal',new THREE.BufferAttribute(normArray,3).setUsage(THREE.DynamicDrawUsage));dynamicGeo.setAttribute('color',new THREE.BufferAttribute(colArray,3));
  const crowd=new THREE.Mesh(dynamicGeo,batchMaterial);crowd.frustumCulled=false;scene.add(crowd);
  const normalMatrix=new THREE.Matrix3();
  function updateCrowd(){for(const c of chunks){const m=c.mesh.matrixWorld.elements,n=normalMatrix.getNormalMatrix(c.mesh.matrixWorld).elements;
    for(let i=0;i<c.count;i++){const a=i*3,o=c.offset+a,x=c.position[a],y=c.position[a+1],z=c.position[a+2],nx=c.normal[a],ny=c.normal[a+1],nz=c.normal[a+2];
      posArray[o]=m[0]*x+m[4]*y+m[8]*z+m[12];posArray[o+1]=m[1]*x+m[5]*y+m[9]*z+m[13];posArray[o+2]=m[2]*x+m[6]*y+m[10]*z+m[14];
      normArray[o]=n[0]*nx+n[3]*ny+n[6]*nz;normArray[o+1]=n[1]*nx+n[4]*ny+n[7]*nz;normArray[o+2]=n[2]*nx+n[5]*ny+n[8]*nz;
    }}dynamicGeo.attributes.position.needsUpdate=true;dynamicGeo.attributes.normal.needsUpdate=true;
  }
  const replacements=new Map();scene.traverse(o=>{if(o.isMesh&&o.material.isMeshStandardMaterial){
    const old=o.material;if(!replacements.has(old))replacements.set(old,new THREE.MeshLambertMaterial({color:old.color,emissive:old.emissive,transparent:old.transparent,opacity:old.opacity}));o.material=replacements.get(old);
  }});
  const projected=new THREE.Vector3();
  // Small pooled event presentation: particles and expanding rings are reused so
  // repeated hits never allocate a growing scene graph.
  const fxGroup=new THREE.Group(); scene.add(fxGroup);
  const particleLimit=112, particlePositions=new Float32Array(particleLimit*3), particleColors=new Float32Array(particleLimit*3);
  const particleGeometry=new THREE.BufferGeometry();
  particleGeometry.setAttribute('position',new THREE.BufferAttribute(particlePositions,3).setUsage(THREE.DynamicDrawUsage));
  particleGeometry.setAttribute('color',new THREE.BufferAttribute(particleColors,3));
  const particleMaterial=new THREE.PointsMaterial({size:.24,vertexColors:true,transparent:true,opacity:.95,depthWrite:false,sizeAttenuation:true});
  const particleCloud=new THREE.Points(particleGeometry,particleMaterial);particleCloud.frustumCulled=false;fxGroup.add(particleCloud);
  const pulsePool=Array.from({length:10},()=>{const m=new THREE.Mesh(new THREE.RingGeometry(.52,.64,20),new THREE.MeshBasicMaterial({color:'#ffd400',transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false}));m.rotation.x=-Math.PI/2;m.visible=false;fxGroup.add(m);return {mesh:m,life:0,max:.65};});
  const sparks=[]; const popups=[]; let pulseCursor=0;
  function colorOf(hex){const c=new THREE.Color(hex);return [c.r,c.g,c.b];}
  function spawnBurst(x,z,color,large=false){
    const [cr,cg,cb]=colorOf(color); const count=large?18:11;
    for(let i=0;i<count;i++){
      if(sparks.length>=particleLimit) sparks.shift();
      const a=(i*2.399+sim.rules.eventId*.17), speed=(large?4.8:3.7)+(i%4)*.55;
      sparks.push({x,y:.65+(i%3)*.16,z,vx:Math.sin(a)*speed,vz:Math.cos(a)*speed,vy:3.5+(i%5)*.45,life:large?.9:.68,max:large?.9:.68,color:[cr,cg,cb]});
    }
    const pulse=pulsePool[pulseCursor++%pulsePool.length];pulse.mesh.position.set(x,.065,z);pulse.mesh.scale.setScalar(large?1.25:.9);pulse.mesh.visible=true;pulse.life=pulse.max;pulse.mesh.material.opacity=.9;
  }
  function spawnHit(person,event){
    spawnBurst(person.x,person.z,PROFESSIONS[person.role].color,event.count>=2);
    const tag=document.createElement('div');tag.className='score-pop';tag.textContent=event.count>=2?'☠  +100  DEAD':'✦  +100';document.querySelector('#labels').append(tag);
    popups.push({tag,x:person.x,z:person.z,y:person.height+2.8,life:1.05});
  }
  function spawnCrash(crash){if(crash)spawnBurst(crash.x,crash.z,'#ff8000',true);}
  function clearEffects(){sparks.length=0;popups.splice(0).forEach(p=>p.tag.remove());pulsePool.forEach(p=>{p.life=0;p.mesh.visible=false;});particleMaterial.opacity=.95;}
  function updateEffects(camera,dt){
    for(let i=sparks.length-1;i>=0;i--){const s=sparks[i];s.life-=dt;if(s.life<=0){sparks.splice(i,1);continue;}s.vy-=8.5*dt;s.x+=s.vx*dt;s.z+=s.vz*dt;s.y=Math.max(.08,s.y+s.vy*dt);}
    for(let i=0;i<particleLimit;i++){const s=sparks[i];const o=i*3;if(s){particlePositions[o]=s.x;particlePositions[o+1]=s.y;particlePositions[o+2]=s.z;particleColors[o]=s.color[0];particleColors[o+1]=s.color[1];particleColors[o+2]=s.color[2];}else{particlePositions[o]=particlePositions[o+1]=particlePositions[o+2]=0;particleColors[o]=particleColors[o+1]=particleColors[o+2]=0;}}
    particleGeometry.attributes.position.needsUpdate=true;particleGeometry.attributes.color.needsUpdate=true;
    pulsePool.forEach(p=>{if(!p.life)return;p.life-=dt;if(p.life<=0){p.mesh.visible=false;return;}const t=1-p.life/p.max;p.mesh.scale.setScalar((p.mesh.scale.x||1)+dt*1.7);p.mesh.material.opacity=Math.max(0,p.life/p.max*.8);});
    for(let i=popups.length-1;i>=0;i--){const p=popups[i];p.life-=dt;if(p.life<=0){p.tag.remove();popups.splice(i,1);continue;}projected.set(p.x,p.y+(1-p.life)*1.7,p.z).project(camera);const x=(projected.x*.5+.5)*view.w,y=(-projected.y*.5+.5)*view.h;p.tag.style.transform=`translate(${x}px,${y}px) translate(-50%,-50%)`;p.tag.style.opacity=Math.min(1,p.life*2);}
  }
  function update(camera) {
    shade.position.set(sim.car.position.x,.048,sim.car.position.z);shade.rotation.z=sim.car.yaw;
    vehicle.group.position.copy(sim.car.position);vehicle.group.rotation.y=sim.car.yaw;
    vehicle.setPose(sim.distance);vehicle.steeringPivots.forEach(p=>p.rotation.y=sim.car.steeringAngle);
    for(const l of rearLights) {l.material.emissive.set(sim.braking?'#fc332b':'#000000');l.material.emissiveIntensity=sim.braking?1.5:0;}
    sim.people.forEach((p,i)=>{
      const v=people[i];v.root.position.set(p.x,p.height+.12,p.z);v.root.rotation.set(0,p.yaw,0);
      v.visual.group.rotation.x=p.phase==='AIRBORNE'?p.spin:p.phase==='DEAD'||p.phase==='RECOVERING'?Math.PI/2:0;
      if(p.phase==='DEAD'||p.phase==='RECOVERING')v.root.position.y=.4;
      v.visual.setPose(p.phase==='AIRBORNE'?'jump':p.phase==='WALKING'?'walk':'idle',p.walkTime*.45);
      v.root.updateMatrixWorld(true);
      v.ring.position.set(p.x,.055,p.z);v.ring.visible=!p.dead;v.ring.material.opacity=p.hits?.95:.5;
      v.shadow.position.set(p.x,.052,p.z);v.shadow.scale.setScalar(1+p.height*.12);
      v.root.visible=Math.hypot(p.x-sim.car.position.x,p.z-sim.car.position.z)<57;
      projected.set(p.x,p.height+3.5,p.z).project(camera);
      const x=(projected.x*.5+.5)*view.w,y=(-projected.y*.5+.5)*view.h;
      const distance=Math.hypot(p.x-sim.car.position.x,p.z-sim.car.position.z);
      v.tag.hidden=p.dead||distance>25||projected.z>1||x<15||x>view.w-15||y<110||y>view.h-75;
      v.tag.style.transform=`translate(${x}px,${y}px) translate(-50%,-100%)`;
      v.tag.classList.toggle('hurt',p.hits===1);v.tag.classList.toggle('airborne',p.phase==='AIRBORNE');
    });
    updateCrowd();
    updateEffects(camera,arguments.length>1?arguments[1]:0);
  }
  return {vehicle,people,update,spawnHit,spawnCrash,clearEffects,reset(){vehicle.setPose(0);people.forEach(p=>p.visual.reset());clearEffects();}};
}
