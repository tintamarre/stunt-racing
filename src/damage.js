// Funny, purely visual car damage for one racer: dents, parts flying off, sparks,
// engine smoke and backfires. It never changes how the car drives.
import * as THREE from 'three';
import { DT } from './physics.js';
import { terrainHeight } from './terrain.js';

const sparkColor = new THREE.Color(1.8, 0.75, 0.2);
const greySmoke = new THREE.Color(0.55, 0.55, 0.57);
const blackSmoke = new THREE.Color(0.07, 0.07, 0.08);
const flameColor = new THREE.Color(2, 0.6, 0.1);
const SHOUTS = ['OUCH!', 'BONK!', 'CRUNCH!', 'KABOOM!', 'OOPS!'];

const tmpV = new THREE.Vector3();
const tmpW = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

export class Damage {
  // racer: { car, model, hud?, rig? } — hud and rig are optional (AI opponents)
  constructor(racer, { particles, audio }) {
    this.racer = racer;
    this.particles = particles;
    this.audio = audio;
    this.reset();
  }

  reset() {
    this.level = 0;
    this.prevVel = null;
    this.prevPos = null;
    this.smokeT = 0;
    this.bangT = 2 + Math.random() * 3;
    this.cool = 0;
    this.airVy = 0;
    this.racer.model.repair();
  }

  // After each physics step: look for a sudden speed loss (walls, other cars, trees) or a hard landing
  step() {
    const car = this.racer.car;
    const lv = car.body.linvel();
    const p = car.body.translation();
    const vel = new THREE.Vector3(lv.x, lv.y, lv.z);
    const pos = new THREE.Vector3(p.x, p.y, p.z);
    const prev = this.prevVel;
    const jumped = this.prevPos && this.prevPos.distanceTo(pos) > 6; // respawn / teleport
    this.prevVel = vel;
    this.prevPos = pos;
    this.cool = Math.max(0, this.cool - DT);
    if (!prev || jumped) return;
    // Gravity alone accounts for g * DT
    const dv = vel.clone().sub(prev);
    dv.y += 9.81 * DT;
    const drop = prev.length() - vel.length();
    let strength = 0;
    if (drop > 5 && dv.length() > 5) strength = Math.min(1, (drop - 5) / 18 + 0.15);
    // Hard landing: judged on the vertical speed the car had just before touching down
    if (car.contacts === 0) this.airVy = vel.y;
    else if (car.landing > 0 && this.airVy < -11) {
      strength = Math.max(strength, Math.min(1, (-this.airVy - 11) / 10));
      dv.set(0, 1, 0);
      this.airVy = 0;
    }
    if (strength > 0 && this.cool === 0) this.hit(dv, strength);
  }

  hit(dv, strength) {
    const { car, model, hud, rig } = this.racer;
    this.cool = 0.25;
    this.level = Math.min(1, this.level + strength * 0.3);
    // Impact direction in the car frame: dv points away from what was hit
    const r = car.body.rotation();
    tmpQ.set(r.x, r.y, r.z, r.w);
    const d = tmpV.copy(dv).normalize().applyQuaternion(tmpQ.clone().invert());
    const point = new THREE.Vector3(
      THREE.MathUtils.clamp(-d.x * 2.6, -2.3, 2.3),
      THREE.MathUtils.clamp(0.15 - d.y * 0.5, -0.3, 0.6),
      THREE.MathUtils.clamp(-d.z * 1.2, -0.95, 0.95),
    );
    model.dent(point, d.clone(), 0.12 + 0.3 * strength);
    // Sparks at the impact point
    const wp = tmpW.copy(point).applyQuaternion(tmpQ).add(car.body.translation());
    const lv = car.body.linvel();
    const n = 8 + Math.round(strength * 22);
    for (let i = 0; i < n; i++) {
      this.particles.emit(wp, { x: lv.x * 0.3 + (Math.random() - 0.5) * 10, y: 2 + Math.random() * 5, z: lv.z * 0.3 + (Math.random() - 0.5) * 10 }, sparkColor, 1, 0.18, 0.35 + Math.random() * 0.3);
    }
    this.audio.crunch?.(this.racer.bot ? strength * 0.4 : strength); // opponents sound further away
    if (strength > 0.35 || Math.random() < strength) model.detachPart(lv, point);
    if (strength > 0.45) {
      hud?.message(SHOUTS[Math.floor(Math.random() * SHOUTS.length)], 'crash', 0.9);
      if (rig) rig.shake = Math.max(rig.shake, strength * 0.6);
    }
  }

  // Every frame: debris, engine smoke and backfires once the car is battered
  update(dt) {
    const { car, model } = this.racer;
    model.updateDebris(dt, terrainHeight);
    if (this.level < 0.5 || dt <= 0) return;
    const r = car.body.rotation();
    tmpQ.set(r.x, r.y, r.z, r.w);
    const p = car.body.translation();
    const lv = car.body.linvel();
    this.smokeT += dt * (this.level > 0.8 ? 22 : 12);
    while (this.smokeT > 1) {
      this.smokeT--;
      const pos = tmpW.set(1.5, 0.45, (Math.random() - 0.5) * 0.6).applyQuaternion(tmpQ).add(p);
      const black = this.level > 0.8 && Math.random() < 0.6;
      this.particles.emit(pos, { x: lv.x * 0.2, y: 1.5 + Math.random(), z: lv.z * 0.2 }, black ? blackSmoke : greySmoke, black ? 0.75 : 0.5, 0.5 + Math.random() * 0.4, 1.6);
    }
    if (this.level > 0.8) {
      this.bangT -= dt;
      if (this.bangT < 0) {
        this.bangT = 1.5 + Math.random() * 4;
        if (!this.racer.bot) this.audio.backfire?.();
        const rear = tmpW.set(-2.4, -0.25, 0).applyQuaternion(tmpQ).add(p);
        const back = tmpV.set(-1, 0, 0).applyQuaternion(tmpQ);
        for (let i = 0; i < 10; i++) {
          this.particles.emit(rear, { x: back.x * 6 + lv.x * 0.5, y: Math.random(), z: back.z * 6 + lv.z * 0.5 }, i < 6 ? flameColor : blackSmoke, 0.95, 0.35 + Math.random() * 0.3, 0.25 + Math.random() * 0.4);
        }
      }
    }
  }
}
