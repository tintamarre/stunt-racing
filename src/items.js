// Item boxes and power-ups: drive through a "?" box, the roulette picks an item, use it.
// turbo: a burst of speed · banana: dropped behind, spins out whoever drives over it
// spring: a big jump · star: 6 s invincible and faster, bumps away every car it touches
import * as THREE from 'three';
import { DT } from './physics.js';

export const ITEMS = {
  turbo: { icon: '🚀', name: 'TURBO' },
  banana: { icon: '🍌', name: 'BANANA' },
  spring: { icon: '🦘', name: 'BOING' },
  star: { icon: '⭐', name: 'STAR' },
};
const KINDS = Object.keys(ITEMS);
// Odds by race position: leaders get bananas, the back of the pack gets stars
const ODDS = {
  front: { turbo: 3, banana: 5, spring: 2, star: 0 },
  middle: { turbo: 4, banana: 3, spring: 2, star: 1 },
  back: { turbo: 4, banana: 1, spring: 2, star: 3 },
};
const ROLL = 1.1; // roulette duration (s)
const BOX_RESPAWN = 3;
const STAR_TIME = 6;
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const yellow = new THREE.Color(1.4, 1.2, 0.2);
const rainbow = new THREE.Color();

function pick(odds) {
  const total = KINDS.reduce((a, k) => a + odds[k], 0);
  let r = Math.random() * total;
  for (const k of KINDS) if ((r -= odds[k]) < 0) return k;
  return 'turbo';
}

function boxTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 128, 128);
  g.addColorStop(0, '#ffe14d');
  g.addColorStop(1, '#ff7a1f');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  x.strokeStyle = 'rgba(255,255,255,0.9)';
  x.lineWidth = 8;
  x.strokeRect(6, 6, 116, 116);
  x.fillStyle = '#fff';
  x.font = 'bold 92px sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('?', 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Items {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    game.world.scene.add(this.group);
    this.enabled = true;
    this.boxes = [];
    this.bananas = [];
    const hasDom = typeof document !== 'undefined';
    this.boxMat = new THREE.MeshStandardMaterial({ map: hasDom ? boxTexture() : null, emissive: 0xffffff, emissiveIntensity: 0.35, transparent: true, opacity: 0.92, roughness: 0.3 });
    this.boxGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    this.bananaGeo = new THREE.TorusGeometry(0.42, 0.15, 8, 14, Math.PI * 0.9);
    this.bananaMat = new THREE.MeshStandardMaterial({ color: 0xffd52a, roughness: 0.5, emissive: 0x3a2a00 });
    this.auraGeo = new THREE.SphereGeometry(2.9, 20, 14);
  }

  // Rows of three boxes across the road, spread around the circuit on plain tiles
  build(path) {
    this.clear();
    for (const b of this.boxes) this.group.remove(b.mesh);
    this.boxes = [];
    if (!path) return;
    const cells = path.cells;
    const plain = new Set(['straight', 'boost', 'wide', 'sweep', 'slope', 'tunnel']);
    const every = Math.max(4, Math.round(cells.length / 4));
    for (let ci = 2; ci < cells.length - 1; ci += every) {
      let c = ci;
      while (c < cells.length - 1 && !plain.has(cells[c].type)) c++;
      const pts = path.points.filter((p) => p.cell === c);
      if (!pts.length) continue;
      const p = pts[Math.floor(pts.length / 2)];
      const side = tmp.crossVectors(p.f, p.up).normalize();
      for (const lat of [-3.6, 0, 3.6]) {
        const mesh = new THREE.Mesh(this.boxGeo, this.boxMat);
        mesh.position.copy(p.p).addScaledVector(p.up, 1.3).addScaledVector(side, lat);
        mesh.castShadow = true;
        this.group.add(mesh);
        this.boxes.push({ mesh, pos: mesh.position.clone(), off: 0, spin: Math.random() * 6 });
      }
    }
    this.setVisible(this.enabled);
  }

  setVisible(on) {
    this.group.visible = on;
  }

  clear() {
    for (const b of this.bananas) this.group.remove(b.mesh);
    this.bananas = [];
  }

  reset(racers) {
    this.clear();
    for (const b of this.boxes) {
      b.off = 0;
      b.mesh.visible = true;
    }
    for (const pl of racers) this.resetRacer(pl);
  }

  resetRacer(pl) {
    pl.item = null;
    pl.itemRoll = 0;
    pl.botItemT = 0;
    pl.boostT = 0;
    pl.starT = 0;
    if (pl.aura) pl.aura.visible = false;
  }

  // Called every physics step, after the cars took their inputs
  step(racers, racing) {
    if (!this.enabled) return;
    for (const b of this.boxes) if (b.off > 0 && (b.off -= DT) <= 0) b.mesh.visible = true;
    const ranked = [...racers].sort((a, b) => (b.progress || 0) - (a.progress || 0));
    for (const pl of racers) {
      const car = pl.car;
      const p = car.body.translation();
      // Pick up
      if (racing && !pl.item && !pl.itemRoll && !pl.done) {
        for (const b of this.boxes) {
          if (b.off > 0) continue;
          if ((b.pos.x - p.x) ** 2 + (b.pos.y - p.y) ** 2 + (b.pos.z - p.z) ** 2 < 2.6 ** 2) {
            b.off = BOX_RESPAWN;
            b.mesh.visible = false;
            pl.itemRoll = ROLL;
            const rank = ranked.indexOf(pl) / Math.max(1, ranked.length - 1);
            pl.nextItem = pick(racers.length < 2 ? ODDS.middle : rank < 0.34 ? ODDS.front : rank < 0.67 ? ODDS.middle : ODDS.back);
            if (!pl.bot) this.game.audio.beep(1320, 0.08);
            this.burst(b.pos, new THREE.Color(1.5, 1.1, 0.3), 14);
            break;
          }
        }
      }
      if (pl.itemRoll > 0 && (pl.itemRoll -= DT) <= 0) {
        pl.itemRoll = 0;
        pl.item = pl.nextItem;
        pl.botItemT = 0.8 + Math.random() * 3;
        if (!pl.bot) this.game.audio.beep(880, 0.12);
      }
      // Opponents use their item after a little while
      if (pl.bot && pl.item && racing && (pl.botItemT -= DT) <= 0) this.use(pl);
      // Ongoing effects
      if (pl.boostT > 0) {
        pl.boostT -= DT;
        this.push(car, 16);
        car.boosting = Math.max(car.boosting, 0.3);
      }
      if (pl.starT > 0) {
        pl.starT -= DT;
        this.push(car, 5);
        car.boosting = Math.max(car.boosting, 0.3);
        if (pl.starT <= 0 && pl.aura) pl.aura.visible = false;
        // Bump away everyone we touch
        for (const o of racers) {
          if (o === pl || o.starT > 0) continue;
          const q = o.car.body.translation();
          if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (q.z - p.z) ** 2 < 3.4 ** 2) this.spin(o, 'BAM!', pl);
        }
      }
    }
    // Bananas on the road
    for (let i = this.bananas.length - 1; i >= 0; i--) {
      const bn = this.bananas[i];
      bn.age += DT;
      let hit = null;
      for (const pl of racers) {
        if (pl === bn.owner && bn.age < 0.8) continue;
        const p = pl.car.body.translation();
        if ((bn.pos.x - p.x) ** 2 + (bn.pos.y - p.y) ** 2 + (bn.pos.z - p.z) ** 2 < 2 ** 2) hit = pl;
      }
      if (hit || bn.age > 45) {
        if (hit && !(hit.starT > 0)) this.spin(hit, 'SPLAT!');
        if (hit) this.burst(bn.pos, yellow, 16);
        this.group.remove(bn.mesh);
        this.bananas.splice(i, 1);
      }
    }
  }

  push(car, accel) {
    const f = car.forward(tmp2);
    const k = car.spec.mass * accel * DT;
    if (car.contacts > 0) car.body.applyImpulse({ x: f.x * k, y: f.y * k, z: f.z * k }, true);
  }

  spin(pl, shout, by) {
    if (pl.car.stunT > 0) return;
    pl.car.stun(1.1);
    pl.hud.message(shout, 'crash', 0.9);
    if (by) {
      // Knocked sideways, away from the star
      const a = by.car.body.translation();
      const b = pl.car.body.translation();
      tmp.set(b.x - a.x, 0, b.z - a.z).normalize();
      const k = pl.car.spec.mass * 6;
      pl.car.body.applyImpulse({ x: tmp.x * k, y: k * 0.4, z: tmp.z * k }, true);
    }
    if (!pl.bot || !by?.bot) this.game.audio.impact(0.5);
  }

  // Use the held item
  use(pl) {
    if (!this.enabled || !pl.item || pl.itemRoll > 0) return false;
    const car = pl.car;
    const kind = pl.item;
    pl.item = null;
    const loud = !pl.bot;
    if (kind === 'turbo') {
      pl.boostT = 1.3;
      if (loud) this.game.audio.whoosh();
    } else if (kind === 'banana') {
      const p = car.body.translation();
      const f = car.forward(tmp2);
      const up = car.up(new THREE.Vector3());
      const mesh = new THREE.Mesh(this.bananaGeo, this.bananaMat);
      const pos = new THREE.Vector3(p.x, p.y, p.z).addScaledVector(f, -3.4).addScaledVector(up, -0.35);
      mesh.position.copy(pos);
      mesh.rotation.set(Math.PI / 2, 0, Math.random() * 6);
      mesh.castShadow = true;
      this.group.add(mesh);
      this.bananas.push({ mesh, pos, owner: pl, age: 0 });
    } else if (kind === 'spring') {
      if (car.contacts > 0) {
        const m = car.spec.mass;
        const f = car.forward(tmp2);
        car.body.applyImpulse({ x: f.x * m * 3, y: m * 11, z: f.z * m * 3 }, true);
      }
      if (loud) this.game.audio.beep(330, 0.25);
    } else if (kind === 'star') {
      pl.starT = STAR_TIME;
      if (!pl.aura) {
        pl.aura = new THREE.Mesh(this.auraGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
        pl.model.group.add(pl.aura);
      }
      pl.aura.visible = true;
      if (loud) [660, 880, 1100, 1320].forEach((f, i) => setTimeout(() => this.game.audio.beep(f, 0.1), i * 90));
    }
    pl.hud.message(ITEMS[kind].name + '!', 'boost', 0.7);
    return true;
  }

  burst(pos, color, n) {
    for (let k = 0; k < n; k++) {
      tmp.set(pos.x, pos.y, pos.z);
      tmp2.set((Math.random() - 0.5) * 8, 2 + Math.random() * 5, (Math.random() - 0.5) * 8);
      this.game.particles.emit(tmp, tmp2, color, 0.9, 0.3, 0.8);
    }
  }

  // Per frame: spinning boxes, rainbow star aura
  update(dt, clock, racers) {
    for (const b of this.boxes) {
      b.spin += dt * 1.6;
      b.mesh.rotation.set(0.5, b.spin, 0.3);
      b.mesh.position.y = b.pos.y + Math.sin(clock * 2 + b.spin) * 0.15;
    }
    this.boxMat.emissive.setHSL((clock * 0.15) % 1, 0.8, 0.5);
    for (const pl of racers) {
      if (pl.aura?.visible) {
        pl.aura.material.color.copy(rainbow.setHSL((clock * 1.5) % 1, 1, 0.55));
        pl.aura.scale.setScalar(1 + Math.sin(clock * 12) * 0.05);
      }
    }
  }

  // HUD view of a racer's item: the roulette while it spins
  view(pl) {
    if (!this.enabled) return '';
    if (pl.itemRoll > 0) return ITEMS[KINDS[Math.floor(this.game.clock * 14) % KINDS.length]].icon;
    return pl.item ? ITEMS[pl.item].icon : '';
  }
}
