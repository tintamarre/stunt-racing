// Coins along the track and the three stars of each circuit:
// ★ finish · ★ beat the par time · ★ collect every coin in one race.
import * as THREE from 'three';

const PICK = 2.3; // pickup radius (m)
const PAR_SPEED = 36; // m/s average for the par time
const PAR_STUNT = 1.5; // extra seconds per loop, jump or ramp
const tmp = new THREE.Vector3();
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const scale = new THREE.Vector3();
const gold = new THREE.Color(1.6, 1.25, 0.3);

export class Coins {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    game.world.scene.add(this.group);
    this.geo = new THREE.CylinderGeometry(0.55, 0.55, 0.14, 20);
    this.geo.rotateX(Math.PI / 2);
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffc928, metalness: 0.85, roughness: 0.25, emissive: 0x6a4600, emissiveIntensity: 0.5 });
    this.coins = [];
    this.mesh = null;
  }

  // Lines of five coins on every third tile, alternating lanes (no loops, jumps or ramps)
  build(path) {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.dispose();
    }
    this.coins = [];
    this.par = 0;
    if (!path) return;
    let len = 0;
    for (let i = 1; i < path.points.length; i++) len += path.points[i].p.distanceTo(path.points[i - 1].p);
    this.lapLength = len;
    this.stunts = path.cells.filter((c) => c.type === 'loop' || c.type === 'jump' || c.type === 'ramp').length;
    const skip = new Set(['loop', 'jump', 'ramp', 'start']);
    path.cells.forEach((cell, ci) => {
      if (ci < 2 || ci % 3 || skip.has(cell.type)) return;
      const pts = path.points.filter((p) => p.cell === ci);
      const lane = [-3, 0, 3][(ci / 3) % 3];
      for (let k = 0; k < 5; k++) {
        const p = pts[Math.min(pts.length - 1, Math.floor(((k + 1) / 6) * pts.length))];
        const side = tmp.crossVectors(p.f, p.up).normalize();
        this.coins.push({ pos: p.p.clone().addScaledVector(p.up, 0.9).addScaledVector(side, lane), taken: false });
      }
    });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, Math.max(1, this.coins.length));
    this.mesh.count = this.coins.length;
    this.mesh.castShadow = true;
    this.group.add(this.mesh);
  }

  // Par time for a whole race
  parTime(laps) {
    return (this.lapLength / PAR_SPEED + this.stunts * PAR_STUNT) * laps;
  }

  reset(racers) {
    for (const c of this.coins) c.taken = false;
    for (const pl of racers) pl.coins = 0;
  }

  // Every physics step: pick up the coins under the cars
  step(racers) {
    for (const pl of racers) {
      const p = pl.car.body.translation();
      for (const c of this.coins) {
        if (c.taken) continue;
        if ((c.pos.x - p.x) ** 2 + (c.pos.y - p.y) ** 2 + (c.pos.z - p.z) ** 2 > PICK * PICK) continue;
        c.taken = true;
        pl.coins = (pl.coins || 0) + 1;
        if (!pl.bot) {
          this.game.audio.beep(1568 + Math.random() * 60, 0.06);
          if (pl.coins === this.coins.length) pl.hud.message('ALL COINS!', 'boost', 1.2);
        }
        for (let k = 0; k < 6; k++) {
          this.game.particles.emit(c.pos, tmp.set((Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4), gold, 0.9, 0.22, 0.5);
        }
      }
    }
  }

  // Every frame: spin and bob, taken coins shrink away
  update(clock) {
    if (!this.mesh) return;
    this.coins.forEach((c, i) => {
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, clock * 3 + i * 0.4);
      scale.setScalar(c.taken ? 0 : 1);
      tmp.copy(c.pos).setY(c.pos.y + Math.sin(clock * 3 + i) * 0.12);
      this.mesh.setMatrixAt(i, m4.compose(tmp, q, scale));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ★★☆ text for a star record
export const starText = (s) => ['finish', 'par', 'coins'].map((k) => (s?.[k] ? '★' : '☆')).join('');
