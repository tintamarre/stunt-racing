// Camera rig: chase, bumper, TV cameras, helicopter and cinematic orbit.
import * as THREE from 'three';

export const CAM_MODES = ['Chase', 'Bumper', 'TV', 'Heli', 'Cinematic'];

const Y = new THREE.Vector3(0, 1, 0);

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 0;
    this.pos = new THREE.Vector3(0, 20, 0);
    this.look = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
    this.shake = 0;
    this.tvCams = [];
    this.tvIdx = -1;
    this.orbit = 0;
    this.fov = 62;
    this.snap = true;
  }

  setTrack(path) {
    // TV cameras placed beside the track every few tiles
    this.tvCams = [];
    if (!path) return;
    const pts = path.points;
    for (let i = 0; i < pts.length; i += 26) {
      const p = pts[i];
      const side = new THREE.Vector3().crossVectors(p.f, Y).normalize();
      const s = (i / 26) % 2 ? 1 : -1;
      this.tvCams.push(p.p.clone().setY(0).addScaledVector(side, 16 * s).add(new THREE.Vector3(0, 4 + (i % 3) * 3, 0)));
    }
  }

  cycle(dir = 1) {
    this.mode = (this.mode + dir + CAM_MODES.length) % CAM_MODES.length;
    this.snap = true;
    return CAM_MODES[this.mode];
  }

  // target: { pos, quat, vel, speed, inLoop }
  update(dt, target) {
    const cam = this.camera;
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(target.quat);
    const carUp = new THREE.Vector3(0, 1, 0).applyQuaternion(target.quat);
    const mode = CAM_MODES[this.mode];
    let desired;
    let look;
    let upWanted = Y;
    let fov = 62;
    let k = 1 - Math.exp(-dt * 6);

    if (mode === 'Chase' || mode === 'Heli') {
      const heli = mode === 'Heli';
      // Follow the velocity direction when moving, so the camera swings smoothly in drifts
      const dir = fwd.clone();
      if (target.speed > 4 && !target.inLoop) {
        const v = target.vel.clone().normalize();
        dir.lerp(v, 0.35).normalize();
      }
      const flat = target.inLoop ? dir : dir.clone().setY(dir.y * 0.3).normalize();
      upWanted = target.inLoop ? carUp : Y;
      const dist = heli ? 16 : 6.8 + Math.min(target.speed, 50) * 0.03;
      const height = heli ? 9 : 2.3;
      desired = target.pos.clone().addScaledVector(flat, -dist).addScaledVector(upWanted, height);
      if (this.ground && !target.inLoop) desired.y = Math.max(desired.y, this.ground(desired.x, desired.z) + 0.8);
      look = target.pos.clone().addScaledVector(fwd, heli ? 4 : 3).addScaledVector(upWanted, heli ? 0 : 0.9);
      fov = 60 + Math.min(target.speed, 60) * 0.3;
      k = 1 - Math.exp(-dt * (target.inLoop ? 10 : 7));
    } else if (mode === 'Bumper') {
      desired = target.pos.clone().addScaledVector(carUp, 0.72).addScaledVector(fwd, 0.4);
      look = desired.clone().addScaledVector(fwd, 10);
      upWanted = carUp;
      fov = 72 + Math.min(target.speed, 60) * 0.2;
      k = 1;
    } else if (mode === 'TV') {
      let best = -1;
      let bd = Infinity;
      this.tvCams.forEach((c, i) => {
        const d = c.distanceToSquared(target.pos);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      if (best !== this.tvIdx) {
        this.tvIdx = best;
        this.snap = true;
      }
      desired = best >= 0 ? this.tvCams[best].clone() : target.pos.clone().add(new THREE.Vector3(20, 10, 20));
      look = target.pos.clone();
      const d = Math.sqrt(bd);
      fov = THREE.MathUtils.clamp(2 * Math.atan(9 / Math.max(d, 1)) * THREE.MathUtils.RAD2DEG, 12, 70);
      k = 1;
    } else {
      this.orbit += dt * 0.25;
      const r = 11;
      desired = target.pos.clone().add(new THREE.Vector3(Math.cos(this.orbit) * r, 3.5 + Math.sin(this.orbit * 0.7) * 1.5, Math.sin(this.orbit) * r));
      look = target.pos.clone().add(new THREE.Vector3(0, 0.6, 0));
      fov = 50;
      k = 1 - Math.exp(-dt * 4);
    }

    if (this.snap) {
      k = 1;
      this.snap = false;
    }
    this.pos.lerp(desired, k);
    this.look.lerp(look, mode === 'TV' || mode === 'Bumper' ? 1 : Math.min(1, k * 1.8));
    this.up.lerp(upWanted, 1 - Math.exp(-dt * 5)).normalize();
    this.fov += (fov - this.fov) * (1 - Math.exp(-dt * 4));

    cam.position.copy(this.pos);
    if (this.shake > 0.001) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      cam.position.z += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * 7);
    }
    cam.up.copy(this.up);
    cam.lookAt(this.look);
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
  }
}
