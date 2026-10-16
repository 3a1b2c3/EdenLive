// SPDX-License-Identifier: Apache-2.0
// First-person stage: scene + camera rig + weapon hand + effects clock.
// Camera shake, head bob, FOV kick, weapon recoil and event draining live here so every
// first-person game gets the same juice and each scene only models its own world.
import * as T from 'three';
import { FirstPersonCameraRig } from '/assets/camera/FirstPersonCameraRig.js';
import { Fx } from './fx.mjs';

export function createFpsStage({ background = 0x101820, fog = [22, 80], fov = 72, hemi = [0xbcd4ff, 0x3a3328, 1.7], eye = 1.65 } = {}) {
  const scene = new T.Scene();
  scene.background = new T.Color(background);
  if (fog) scene.fog = new T.Fog(background, fog[0], fog[1]);
  const camera = new T.PerspectiveCamera(fov, 16 / 9, .05, 180);
  scene.add(camera);
  scene.add(new T.HemisphereLight(hemi[0], hemi[1], hemi[2]));
  const fx = new Fx(scene);
  const hand = new T.Group();
  camera.add(hand);
  const rig = new FirstPersonCameraRig({ eyeHeight: eye });
  const stage = {
    scene, camera, fx, hand, rig, vt: 0, handBase: new T.Vector3(.38, -.4, -.75), handRot: new T.Euler(),
    shakeA: 0, shakeT: 0, shakeDur: .3, recoil: 0, fovKick: 0, bob: 0, baseFov: fov, roll: 0,
    lastEvent: -1, round: -1, flares: [],
    shake(a = 1, dur = .3) { this.shakeA = Math.max(this.shakeA * (this.shakeT / this.shakeDur), a); this.shakeT = this.shakeDur = dur; },
    kick(r = 1) { this.recoil = Math.min(1.4, this.recoil + r); },
    /** A camera-facing flare parented to a weapon anchor that pops for a few frames. */
    flare(anchor, { color = 0xffd78a, size = .5, light = null } = {}) {
      const sprite = new T.Sprite(new T.SpriteMaterial({ map: fx.star, color, transparent: true, blending: T.AdditiveBlending, depthWrite: false, opacity: 0 }));
      sprite.renderOrder = 20;
      sprite.material.depthTest = false;
      anchor.add(sprite);
      let l = null;
      
      const f = { sprite, light: l, size, t: 0, dur: .07, peak: light ?? 0,
        fire(dur = .07, scale = 1) { this.t = this.dur = dur; this.scale = scale; this.sprite.material.rotation = Math.random() * 6.28; } };
      stage.flares.push(f);
      return f;
    },
    update(dt) {
      this.vt += dt;
      this.fx.update(dt);
      this.recoil = Math.max(0, this.recoil - dt * 7);
      this.fovKick *= Math.max(0, 1 - dt * 9);
      if (this.shakeT > 0) this.shakeT = Math.max(0, this.shakeT - dt);
      for (const f of this.flares) {
        f.t = Math.max(0, f.t - dt);
        const k = f.t / f.dur;
        f.sprite.material.opacity = f.t > 0 ? Math.min(1, k * 1.6) : 0;
        f.sprite.scale.setScalar(f.size * (f.scale ?? 1) * (.65 + .5 * (1 - k)));
        if (f.light) f.light.intensity = f.t > 0 ? f.peak * k : 0;
      }
    },
    /** Position the camera and hand from sim state, then add shake/bob/kick. */
    place(s, dt) {
      const p = s.player;
      const cp = Math.cos(p.pitch), forward = new T.Vector3(Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp);
      rig.step({
        targetPosition: new T.Vector3(p.x, p.y, p.z),
        targetFrame: { forward, up: new T.Vector3(0, 1, 0), right: new T.Vector3(Math.cos(p.yaw), 0, Math.sin(p.yaw)) },
        camera,
      });
      const moving = p.moving && p.y === 0 && s.state === 'RUNNING' && !s.paused;
      if (moving) this.bob += dt * 9.5;
      const bobY = moving ? Math.sin(this.bob) * .035 : 0, bobX = moving ? Math.cos(this.bob * .5) * .02 : 0;
      camera.position.y += bobY;
      if (this.shakeT > 0) {
        const a = this.shakeA * (this.shakeT / this.shakeDur);
        camera.position.x += Math.sin(this.vt * 93) * a * .05;
        camera.position.y += Math.cos(this.vt * 71) * a * .05;
        camera.rotateZ(Math.sin(this.vt * 57) * a * .018);
        camera.rotateX(Math.cos(this.vt * 83) * a * .012);
      }
      camera.rotateZ(this.roll);
      const fv = this.baseFov + this.fovKick;
      if (Math.abs(camera.fov - fv) > .01) { camera.fov = fv; camera.updateProjectionMatrix(); }
      hand.position.copy(this.handBase);
      hand.position.x += bobX * .6; hand.position.y += Math.abs(bobY) * .5 - this.recoil * .01;
      hand.position.z += this.recoil * .09;
      hand.rotation.set(this.handRot.x + this.recoil * .16, this.handRot.y, this.handRot.z);
    },
    /** New events since the last call; flags a round restart through `onRound`. */
    drain(s, onRound) {
      if (s.roundId !== this.round) {
        const first = this.round === -1;
        this.round = s.roundId;
        this.lastEvent = s.events.length ? s.events[s.events.length - 1].id : this.lastEvent;
        if (!first) onRound?.();
        return [];
      }
      const out = s.events.filter((e) => e.id > this.lastEvent);
      if (out.length) this.lastEvent = out[out.length - 1].id;
      return out;
    },
  };
  return stage;
}
export const v3 = (x, y, z) => new T.Vector3(x, y, z);
