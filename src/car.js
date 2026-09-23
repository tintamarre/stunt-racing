// Car visuals: procedurally modelled bodies (lofted hulls), wheels and lights.
import * as THREE from 'three';
import { WHEEL_R } from './physics.js';

// Bodies are lofted from cross-section stations: [x, halfWidth, bottomY, topY].
const BODIES = {
  gt: {
    body: [[2.32, 0.6, -0.28, -0.1], [2.18, 0.84, -0.38, 0.0], [1.7, 0.92, -0.42, 0.08], [0.9, 0.94, -0.42, 0.14], [0.2, 0.95, -0.42, 0.2], [-0.8, 0.96, -0.42, 0.24], [-1.7, 0.95, -0.4, 0.27], [-2.15, 0.9, -0.36, 0.25], [-2.3, 0.72, -0.24, 0.18]],
    cabin: [[0.95, 0.72, 0.1, 0.14], [0.45, 0.69, 0.12, 0.42], [-0.1, 0.65, 0.14, 0.56], [-0.8, 0.62, 0.16, 0.56], [-1.4, 0.61, 0.2, 0.4], [-1.85, 0.62, 0.23, 0.28]],
    roof: [0.0, -1.05],
    spoiler: true,
  },
  rally: {
    body: [[2.12, 0.62, -0.26, -0.06], [1.98, 0.84, -0.36, 0.06], [1.4, 0.9, -0.4, 0.2], [0.8, 0.91, -0.4, 0.25], [-0.4, 0.92, -0.4, 0.3], [-1.6, 0.92, -0.38, 0.32], [-1.98, 0.88, -0.34, 0.3], [-2.08, 0.72, -0.22, 0.22]],
    cabin: [[0.9, 0.74, 0.18, 0.22], [0.35, 0.7, 0.2, 0.7], [-0.3, 0.68, 0.22, 0.82], [-1.3, 0.68, 0.24, 0.82], [-1.75, 0.68, 0.26, 0.74], [-2.0, 0.68, 0.28, 0.34]],
    roof: [-0.2, -1.6],
    roofLights: true,
  },
  muscle: {
    body: [[2.4, 0.72, -0.3, 0.02], [2.3, 0.92, -0.38, 0.12], [1.5, 0.96, -0.4, 0.18], [0.5, 0.97, -0.4, 0.2], [-0.6, 0.98, -0.4, 0.22], [-1.8, 0.98, -0.38, 0.24], [-2.3, 0.94, -0.34, 0.24], [-2.42, 0.8, -0.24, 0.18]],
    cabin: [[0.55, 0.72, 0.14, 0.2], [0.05, 0.68, 0.16, 0.52], [-0.5, 0.64, 0.18, 0.6], [-1.1, 0.62, 0.2, 0.58], [-1.65, 0.64, 0.22, 0.36], [-2.0, 0.66, 0.23, 0.24]],
    roof: [-0.35, -1.0],
    stripes: true,
    scoop: true,
  },
};

// Superellipse cross-sections joined into a smooth closed hull.
function loft(stations, n = 4, seg = 24) {
  const pos = [];
  const idx = [];
  const ring = ([x, w, yb, yt]) => {
    const yc = (yb + yt) / 2;
    const hy = (yt - yb) / 2;
    const pts = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      pts.push([x, yc + hy * Math.sign(s) * Math.abs(s) ** (2 / n), w * Math.sign(c) * Math.abs(c) ** (2 / n)]);
    }
    return pts;
  };
  stations.forEach((st) => ring(st).forEach((p) => pos.push(...p)));
  for (let k = 0; k < stations.length - 1; k++) {
    for (let i = 0; i < seg; i++) {
      const a = k * seg + i;
      const b = k * seg + ((i + 1) % seg);
      idx.push(a, b, a + seg, b, b + seg, a + seg);
    }
  }
  for (const [k, flip] of [[0, false], [stations.length - 1, true]]) {
    const [x, , yb, yt] = stations[k];
    const c = pos.length / 3;
    pos.push(x, (yb + yt) / 2, 0);
    for (let i = 0; i < seg; i++) {
      const a = k * seg + i;
      const b = k * seg + ((i + 1) % seg);
      if (flip) idx.push(c, a, b);
      else idx.push(c, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export const WHEEL_POS = [
  [1.32, -0.84],
  [1.32, 0.84],
  [-1.3, -0.86],
  [-1.3, 0.86],
];

export class CarModel {
  constructor(spec, { ghost = false } = {}) {
    const P = BODIES[spec.body];
    const width = Math.max(...P.body.map((b) => b[1])) * 2;
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    this.ghost = ghost;

    const paint = ghost
      ? new THREE.MeshStandardMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.35, depthWrite: false, emissive: 0x2aa8ff, emissiveIntensity: 0.4 })
      : new THREE.MeshPhysicalMaterial({ color: spec.color, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 });
    const glass = ghost ? paint : new THREE.MeshPhysicalMaterial({ color: 0x0b0f14, metalness: 0.2, roughness: 0.05, clearcoat: 1 });
    const trim = ghost ? paint : new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6, metalness: 0.3 });
    this.paint = paint;

    const bodyMesh = new THREE.Mesh(loft(P.body, 5), paint);
    // Tinted glass cabin with a painted roof panel on top
    const cabin = new THREE.Mesh(loft(P.cabin, 3.2), glass);
    this.body.add(bodyMesh, cabin);
    const at = (x) => {
      const c = P.cabin;
      for (let i = 0; i < c.length - 1; i++) {
        if (x <= c[i][0] && x >= c[i + 1][0]) {
          const t = (c[i][0] - x) / (c[i][0] - c[i + 1][0]);
          return c[i].map((v, k) => v + (c[i + 1][k] - v) * t);
        }
      }
      return c[c.length - 1];
    };
    const [r0, r1] = P.roof;
    const roofSt = [];
    for (let k = 0; k <= 6; k++) {
      const [x, w, , yt] = at(r0 + ((r1 - r0) * k) / 6);
      const taper = Math.sin((Math.PI * (k + 0.6)) / 7.2);
      roofSt.push([x, w * 0.86 * (0.9 + 0.1 * taper), yt - 0.035, yt + 0.018]);
    }
    this.body.add(new THREE.Mesh(loft(roofSt, 6), paint));

    // Underbody / bumpers
    const under = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.1, width - 0.3), trim);
    under.position.y = -0.44;
    this.body.add(under);

    if (P.spoiler) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, width), trim);
      wing.position.set(-2.05, 0.62, 0);
      const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.4, 0.06), trim);
      s1.position.set(-2.0, 0.42, 0.6);
      const s2 = s1.clone();
      s2.position.z = -0.6;
      this.body.add(wing, s1, s2);
    }
    if (P.roofLights) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 1.2), trim);
      bar.position.set(0.1, 0.9, 0);
      this.body.add(bar);
      for (const z of [-0.42, -0.14, 0.14, 0.42]) {
        const l = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d0, emissiveIntensity: 0.6 }));
        l.rotation.z = Math.PI / 2;
        l.position.set(0.22, 0.9, z);
        this.body.add(l);
      }
      const decal = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.22, width + 0.02), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
      decal.position.set(-0.3, -0.12, 0);
      this.body.add(decal);
    }
    if (P.stripes && !ghost) {
      const stripeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 });
      for (const z of [-0.22, 0.22]) {
        const st = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.02, 0.22), stripeMat);
        st.position.set(0.05, 0.27, z);
        this.body.add(st);
      }
    }
    if (P.scoop) {
      const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.14, 0.6), trim);
      scoop.position.set(1.3, 0.26, 0);
      this.body.add(scoop);
    }

    // Lights
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: 1.2 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a1a, emissiveIntensity: 0.8 });
    const front = P.body[1][0];
    const rear = P.body[P.body.length - 1][0];
    for (const z of [-0.62, 0.62]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.42), headMat);
      hl.position.set(front - 0.02, -0.12, z);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.46), this.tailMat);
      tl.position.set(rear + 0.08, 0.02, z);
      if (!ghost) this.body.add(hl, tl);
    }

    this.body.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = !ghost;
        o.receiveShadow = !ghost;
      }
    });

    // Wheels
    const tireMat = ghost ? paint : new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
    const rimMat = ghost ? paint : new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.9, roughness: 0.25 });
    const tireG = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.3, 24);
    tireG.rotateX(Math.PI / 2);
    const rimG = new THREE.CylinderGeometry(WHEEL_R * 0.66, WHEEL_R * 0.66, 0.32, 16);
    rimG.rotateX(Math.PI / 2);
    const spokeG = new THREE.BoxGeometry(WHEEL_R * 1.2, 0.06, 0.33);
    this.wheels = WHEEL_POS.map(([x, z]) => {
      const steer = new THREE.Group();
      steer.position.set(x, -0.36, z);
      const spin = new THREE.Group();
      const tire = new THREE.Mesh(tireG, tireMat);
      const rim = new THREE.Mesh(rimG, rimMat);
      spin.add(tire, rim);
      for (let k = 0; k < 3; k++) {
        const sp = new THREE.Mesh(spokeG, trim);
        sp.rotation.z = (k * Math.PI) / 3;
        spin.add(sp);
      }
      tire.castShadow = !ghost;
      steer.add(spin);
      this.group.add(steer);
      return { steer, spin, x, z };
    });

    // Exhaust flame (boost)
    const flameMat = new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const flameG = new THREE.ConeGeometry(0.14, 1.1, 10, 1, true);
    flameG.rotateZ(Math.PI / 2);
    flameG.translate(-0.55, 0, 0);
    this.flames = [-0.4, 0.4].map((z) => {
      const f = new THREE.Mesh(flameG, flameMat);
      f.position.set(rear - 0.05, -0.3, z);
      f.visible = false;
      this.group.add(f);
      return f;
    });

    // Headlights for night driving
    if (!ghost) {
      this.headlight = new THREE.SpotLight(0xfff2d8, 0, 120, 0.55, 0.45, 1.2);
      this.headlight.position.set(front, 0, 0);
      this.headlight.target.position.set(front + 20, -2.5, 0);
      this.group.add(this.headlight, this.headlight.target);
    }
  }

  setNight(on) {
    if (this.headlight) this.headlight.intensity = on ? 900 : 0;
  }

  // state: { steer, spin, susp[4], brake, boost }
  apply(state, t) {
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      w.steer.position.y = -(state.susp[i] ?? 0.36);
      w.steer.rotation.y = i < 2 ? state.steer : 0;
      w.spin.rotation.z = -state.spin;
    }
    this.tailMat.emissiveIntensity = state.brake ? 4 : 0.8;
    for (const f of this.flames) {
      f.visible = !!state.boost;
      f.scale.set(0.8 + Math.random() * 0.5, 1, 1);
    }
  }
}
