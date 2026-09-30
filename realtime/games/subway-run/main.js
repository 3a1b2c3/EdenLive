import * as THREE from 'three';
import { createRenderer } from '/assets/user-interface/PrototypeShell.js';
import {createCharacterVisual} from '/assets/world/object/factory/CharacterVisualFactory.js';
import {createTrainVisual} from '/assets/world/object/factory/TrainVisualFactory.js';
import {SubwayRound, RULES, TRACK, COINS, laneX} from './rules.mjs';

const palette = {ink:0x101d30, teal:0x35d6ca, gold:0xffca59, red:0xee6972};
const materials = new Map();
function box(w,h,d,color) {
  const id = `${color}`;
  if (!materials.has(id)) materials.set(id, new THREE.MeshLambertMaterial({color}));
  return new THREE.Mesh(new THREE.BoxGeometry(w,h,d), materials.get(id));
}
function place(parent, mesh, x,y,z) { mesh.position.set(x,y,z); parent.add(mesh); return mesh; }
function sign(text, width, height, color='#a7f7ee') {
  const c=document.createElement('canvas'); c.width=640; c.height=144;
  const ctx=c.getContext('2d'); ctx.fillStyle='#102a3e'; ctx.fillRect(0,0,c.width,c.height);
  ctx.fillStyle=color; ctx.fillRect(0,132,640,12); ctx.textAlign='center';
  ctx.font='bold 64px system-ui, sans-serif'; ctx.fillText(text,320,94);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(width,height),new THREE.MeshBasicMaterial({map:t}));
}
function buildStation(scene) {
  place(scene,box(13,0.22,234,0x9558d9),0,-0.19,-102);
  for (let lane=0; lane<3; lane++) {
    place(scene,box(2.72,0.02,234,0x6550b9),laneX(lane),-0.067,-102);
    for (const side of [-1,1]) place(scene,box(0.09,0.06,234,0x40d7e7),laneX(lane)+side*0.86,0,-102);
  }
  const sleepers=new THREE.InstancedMesh(new THREE.BoxGeometry(2.4,0.07,0.24),
    new THREE.MeshLambertMaterial({color:0xb63795}),3*78);
  const matrix=new THREE.Matrix4(); let index=0;
  for(let z=6; z>-228; z-=3) for(let lane=0;lane<3;lane++) {
    matrix.makeTranslation(laneX(lane),-0.022,z); sleepers.setMatrixAt(index++,matrix);
  }
  scene.add(sleepers);
  for(const side of [-1,1]) {
    place(scene,box(2.3,0.48,234,0xf28a42),side*5.8,0.09,-102);
    place(scene,box(0.16,0.035,234,palette.gold),side*4.68,0.345,-102);
    place(scene,box(0.3,7.2,234,0x259baa),side*7.1,3.3,-102);
    place(scene,box(0.05,0.1,234,palette.teal),side*6.93,3.9,-102);
  }
  place(scene,sign('FINISH  /  终点',6,1.3,'#ffdd8b'),0,5.2,-RULES.finish);
  for(let lane=0;lane<3;lane++) place(scene,box(2.65,0.015,1.8,palette.teal),laneX(lane),0.06,-RULES.finish);
}
function buildHazard(h) {
  if(h.type==='train') {
    const visual=createTrainVisual({preset:'subway',cars:1,length:RULES.trainLength,
      width:RULES.trainWidth,height:RULES.roofHeight,
      colors:{body:h.lane===2?'#ed3d9f':'#ed5431',chassis:'#702bd1',wheel:'#26ad79'}});
    visual.group.rotation.y=Math.PI;
    // Roof strips show the playable top surface and share its exact height.
    for(const side of [-1,1]) place(visual.group,box(0.09,0.018,12.3,palette.teal),side*0.97,RULES.roofHeight+0.01,0);
    visual.group.userData.visual=visual;
    return visual.group;
  }
  const group=new THREE.Group();
  for(const side of [-1,1]) place(group,box(0.17,RULES.barrierTop,0.34,0xedc91e),side*1.16,RULES.barrierTop/2,0);
  place(group,box(2.5,RULES.barrierTop-RULES.barrierBottom,0.4,palette.gold),0,(RULES.barrierTop+RULES.barrierBottom)/2,0);
  for(let i=-2;i<=2;i++) {
    const slash=box(0.12,0.55,0.015,0x643baa);
    slash.rotation.z=-0.4; place(group,slash,i*0.46,2.14,0.21);
  }
  place(group,sign('↓  SLIDE',1.9,0.43,'#ffe594'),0,1.58,0.222);
  return group;
}
function coinVisual() {
  const face=new THREE.Mesh(new THREE.CylinderGeometry(0.37,0.37,0.12,12),
    new THREE.MeshBasicMaterial({color:palette.gold}));
  face.rotation.x=Math.PI/2; return face;
}
const cueWords = {
  ready: ['SPACE · START RUNNING', 'Take your time. The runner waits until you are ready.'],
  run: ['KEEP YOUR RHYTHM', 'Follow the coin trail and collect 10 coins.'],
  'lane-left': ['← CHANGE LANES', 'The next coins are in the left lane.'],
  'lane-right': ['CHANGE LANES →', 'Return to the center lane for the final coins.'],
  'train-ahead': ['TRAIN AHEAD', 'Get ready to jump. There are coins on the roof.'],
  'train-jump': ['SPACE · JUMP ONTO THE ROOF', 'Jump now to reach the top of the train.'],
  'on-roof': ['ON THE ROOFTOP', 'Hold your lane. You will drop down at the end.'],
  'barrier-slide': ['↓ SLIDE', 'Stay low and pass beneath the yellow barrier.'],
};
const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
const setHidden = (node, value) => { if (node.hidden !== value) node.hidden = value; };

export function createRuntime(host) {
  const renderer = createRenderer(document.querySelector('#app'));
  renderer.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#4aa8ff');
  const camera = new THREE.PerspectiveCamera(61, 1, .1, 160);
  scene.add(new THREE.HemisphereLight('#ffffff', '#888888', 2));
  const sun = new THREE.DirectionalLight('#ffffff', 1.8); sun.position.set(-5, 14, 8); scene.add(sun);
  buildStation(scene);
  const game = new SubwayRound();
  const runner = createCharacterVisual({ preset: 'sprinter', height: 2.05,
    colors: { top: '#29db63', accent: '#ffd124', pants: '#304be0' } });
  // Cap and pack stay as two boxes so the runner still reads against the prompt.
  place(runner.attachments.head, box(0.44, 0.16, 0.42, 0xffd124), 0, 0.22, 0);
  place(runner.attachments.head, box(0.46, 0.06, 0.28, 0xe83586), 0, 0.12, -0.18);
  place(runner.rig.chest, box(0.38, 0.5, 0.22, 0xe83586), 0, 0.32, 0.22);
  const player = new THREE.Group(); player.add(runner.group); scene.add(player);
  const hazards = TRACK.map(data => ({ data, mesh: place(scene, buildHazard(data), laneX(data.lane), 0, -data.distance) }));
  const coins = COINS.map(data => ({ data, mesh: place(scene, coinVisual(), laneX(data.lane), data.height, -data.distance) }));
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(.54, 24), new THREE.MeshBasicMaterial({ color: '#081723', transparent: true, opacity: .4, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; scene.add(shadow);
  // Flatten live factory materials without changing the vendored assets.
  scene.traverse(object => {
    if (!object.isMesh) return;
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
      if ('metalness' in material) material.metalness = 0;
      if ('roughness' in material) material.roughness = 1;
      if (material.emissive) material.emissive.set(0);
    }
  });

  host.input.bind({ ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    Space: 'jump', ArrowUp: 'jump', KeyW: 'jump', ArrowDown: 'duck', KeyS: 'duck' });
  const listeners = new AbortController(), options = { signal: listeners.signal };
  const pad = { pressed: new Set() };
  const clearInput = () => { host.input.clear(); pad.pressed.clear(); };
  const view = Object.fromEntries([...document.querySelectorAll('#small-stage [id]')].map(node => [node.id, node]));
  const big = {
    overlay: document.getElementById('overlay-big'),
    'result-title': document.getElementById('big-result-title'),
    'result-reason': document.getElementById('big-result-reason'),
    restart: document.getElementById('big-restart'),
  };
  const touch = document.querySelector('.touch');
  let lastEvent = 0, toastUntil = 0, toastText = '', pose = 'run';
  for (const button of touch.querySelectorAll('[data-action]')) {
    button.addEventListener('click', () => {
      button.blur();
      if (game.state === 'RUNNING' || game.state === 'READY') pad.pressed.add(button.dataset.action);
    }, options);
  }
  for (const restart of [view.restart, big.restart]) {
    restart.addEventListener('click', () => { restart.blur(); clearInput(); host.restart(); }, options);
  }
  window.addEventListener('blur', clearInput, options);
  document.addEventListener('visibilitychange', clearInput, options);
  const cameraGoal = new THREE.Vector3(), lookAt = new THREE.Vector3();
  function poseScene(dt = 0, resetCamera = false) {
    const m = game.motion;
    pose = game.state === 'RUNNING' ? (m.ducking ? 'slide' : m.grounded ? 'run' : 'jump') : 'idle';
    runner.setPose(pose === 'idle' ? 'idle' : 'run', game.elapsed * 0.4);
    player.position.copy(m.position);
    runner.group.scale.set(1, pose === 'slide' ? .66 : 1, 1);
    player.rotation.z = THREE.MathUtils.clamp((m.laneOffset(m.targetLaneIndex) - m.lateralOffset) * .035, -.12, .12);
    for (const hazard of hazards) {
      hazard.mesh.visible = hazard.data.distance + RULES.trainLength / 2 > m.distance - 15;
    }
    for (const coin of coins) {
      coin.mesh.visible = !game.collected.has(coin.data.id) && coin.data.distance > m.distance - 10;
      coin.mesh.rotation.y = game.elapsed * 3.5;
    }
    shadow.position.set(m.lateralOffset, game.roofId ? RULES.roofHeight + .025 : .07, -m.distance);
    shadow.material.opacity = m.grounded ? .42 : .18;
    cameraGoal.set(m.lateralOffset * .28, 3.9 + m.upOffset * .55, -m.distance + 5.8);
    if (resetCamera) camera.position.copy(cameraGoal);
    else camera.position.lerp(cameraGoal, 1 - Math.exp(-dt * 10));
    lookAt.set(m.lateralOffset * .18, 1.35 + m.upOffset * .55, -m.distance - 7.5);
    camera.lookAt(lookAt);
  }
  function drainEffects() {
    for (const event of game.events) {
      if (event.id <= lastEvent) continue;
      lastEvent = event.id;
      if (event.type === 'coin.collected') { toastUntil = game.elapsed + .48; toastText = '+1 COIN'; }
      if (event.type === 'roof.landed') { toastUntil = game.elapsed + .9; toastText = 'NICE ROOFTOP LANDING'; }
    }
  }
  function present() {
    const m = game.motion, showingToast = game.elapsed < toastUntil;
    if (view.toast.classList.contains('show') !== showingToast) view.toast.classList.toggle('show', showingToast);
    if (showingToast) setText(view.toast, toastText);
    setText(view.score, String(game.score).padStart(2, '0'));
    setText(view.distance, `${Math.floor(m.distance)} m`);
    setText(view.lane, ['LEFT LANE', 'CENTER LANE', 'RIGHT LANE'][m.targetLaneIndex]);
    const width = `${Math.min(1, game.score / RULES.targetScore) * 100}%`;
    if (view.progress.style.width !== width) view.progress.style.width = width;
    const message = cueWords[game.cue] || ['RUN COMPLETE', 'Press R to run again.'];
    setText(view.cue, message[0]); setText(view.hint, message[1]);
    if (view.hud.dataset.cue !== game.cue) view.hud.dataset.cue = game.cue;
    // READY is not an outcome, so it shows no result card and keeps the touch
    // controls up: jump is what starts the run.
    const terminal = game.state !== 'RUNNING' && game.state !== 'READY';
    setHidden(view.result, !terminal); setHidden(big.overlay, !terminal); setHidden(touch, terminal);
    if (!terminal) return;
    const title = game.state === 'WON' ? 'RUN COMPLETE!' : 'TRY AGAIN';
    const reason = `${game.outcomeReason} Coins ${game.score}/${RULES.targetScore} · Distance ${Math.floor(m.distance)} m`;
    if (view.result.dataset.outcome !== game.state) view.result.dataset.outcome = game.state;
    if (big.overlay.dataset.outcome !== game.state) big.overlay.dataset.outcome = game.state;
    setText(view['result-title'], title); setText(big['result-title'], title);
    setText(view['result-reason'], reason); setText(big['result-reason'], reason);
  }
  function describeEvent(event) {
    switch (event.type) {
      case 'round.started': return 'The runner sets off along the railway tracks.';
      case 'lane.changed': return `The runner shifts into the ${['left', 'center', 'right'][event.lane]} lane.`;
      case 'player.jumped': return event.fromRoof ? 'The runner leaps from the roof of the train.' : 'The runner jumps above the railway tracks.';
      case 'player.ducked': return 'The runner crouches into a slide beneath the barrier.';
      case 'roof.landed': return 'The runner lands on top of a parked train.';
      case 'roof.left': return 'The runner drops from the train roof toward the tracks.';
      case 'coin.collected': return 'The runner collects a gold coin along the railway.';
      case 'barrier.cleared': return 'The runner emerges safely beyond the low barrier.';
      case 'round.won': return 'The runner secures the final coin and completes the route.';
      case 'round.lost': return game.motion.distance >= RULES.finish ? 'The runner reaches the end of the station without enough coins.' : 'The runner collides with an obstacle and the run ends.';
      default: return null;
    }
  }
  poseScene(0, true);
  return {
    canvas: renderer.domElement,
    update(dt, input) {
      for (const action of ['left', 'right', 'jump', 'duck']) {
        const key = input.consumePress(action), pointer = pad.pressed.delete(action);
        if (key || pointer) game.action(action);
      }
      game.step(dt); poseScene(dt); drainEffects();
      // READY keeps listening: the next jump is the start signal.
      if (game.state !== 'RUNNING' && game.state !== 'READY') clearInput();
    },
    layout(width, height) {
      renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    },
    read() {
      const snap = game.read();
      const message = cueWords[game.cue] || ['RUN COMPLETE', 'Press R to run again.'];
      snap.toast = game.elapsed < toastUntil ? toastText : '';
      snap.cueTitle = message[0];
      snap.cueHint = message[1];
      // The runtime stitches these sentences into the chunk's dynamic prompt.
      // Null means the event has no prompt line and is dropped.
      snap.events = snap.events.map(event => ({...event, prompt: describeEvent(event)}));
      return snap;
    },
    handleUiAction(action) {
      if (action === 'reset' || action === 'restart') {
        clearInput();
        host.restart();
        return true;
      }
      return false;
    },
    describeEvent,
    // Motion and camera lerp live in update() at 60 Hz. Capture still passes
    // the model-frame dt so the host contract matches boxed-in.
    render(_dt) { present(); renderer.render(scene, camera); },
    reset() {
      clearInput(); game.reset(); runner.reset();
      for (const hazard of hazards) hazard.mesh.userData.visual?.reset();
      lastEvent = 0; toastUntil = 0; toastText = ''; poseScene(0, true);
    },
    automation: () => ({ pose, playerVisual: { x: player.position.x, y: player.position.y, z: player.position.z },
      visual: { camera: camera.position.toArray(), drawCalls: renderer.info.render.calls } }),
    destroy() {
      listeners.abort(); clearInput();
      const geometries = new Set(), materials = new Set(), textures = new Set();
      scene.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (!material) continue; materials.add(material);
          for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        }
      });
      for (const resource of [...geometries, ...materials, ...textures]) resource.dispose();
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}
