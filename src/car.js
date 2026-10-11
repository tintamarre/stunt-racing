// Car visuals: procedurally modelled bodies (lofted hulls), wheels and lights.
import * as THREE from 'three';
import { WHEEL_R, wheelLayout } from './physics.js';

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
  monster: {
    body: [[2.15, 0.7, 0.12, 0.42], [2.02, 0.86, 0.06, 0.6], [1.2, 0.9, 0.04, 0.7], [0.4, 0.92, 0.04, 0.74], [-0.6, 0.92, 0.04, 0.76], [-1.9, 0.92, 0.06, 0.78], [-2.12, 0.84, 0.12, 0.74]],
    cabin: [[0.75, 0.74, 0.66, 0.7], [0.35, 0.72, 0.68, 1.28], [-0.3, 0.7, 0.7, 1.38], [-0.75, 0.7, 0.72, 1.36], [-0.85, 0.7, 0.74, 0.8]],
    roof: [0.25, -0.8],
    roofLights: true,
    barY: 1.46,
    decal: false,
    under: 0.02,
    lampY: 0.52,
    flameY: 0.3,
    tire: [0.62, 14],
    build: monster,
  },
  hotdog: { build: hotdog },
  bubble: { build: bubble, tire: [0.24, 0] },
};

// Rounded pod lofted along x (front x0 > rear x1); m shapes the end profile (2 = ellipse)
function pod(x0, x1, w, yb, yt, m = 2, n = 2.4, k = 16) {
  const st = [];
  const yc = (yb + yt) / 2;
  const hy = (yt - yb) / 2;
  for (let i = 0; i <= k; i++) {
    const u = Math.sin(((i / k) * 2 - 1) * (Math.PI / 2));
    const f = Math.max(0.03, (1 - Math.abs(u) ** m) ** (1 / m));
    st.push([x0 + ((x1 - x0) * (u + 1)) / 2, w * f, yc - hy * f, yc + hy * f]);
  }
  return loft(st, n);
}

function hotdog(b, M) {
  const bun = M.mat(0xdc9a52, 0.75);
  for (const z of [-0.43, 0.43]) {
    const half = new THREE.Mesh(pod(2.3, -2.3, 0.44, -0.44, 0.4, 3, 2.2), bun);
    half.position.z = z;
    b.add(half);
  }
  b.add(new THREE.Mesh(pod(2.2, -2.2, 0.6, -0.48, -0.1, 2.6), bun));
  b.add(new THREE.Mesh(pod(2.8, -2.8, 0.34, -0.1, 0.5, 5, 2, 24), M.paint));
  // Mustard zigzag on top of the sausage
  const pts = [];
  for (let i = 0; i <= 18; i++) {
    const z = (i % 2 ? 0.2 : -0.2) * (i === 0 || i === 18 ? 0 : 1);
    pts.push(new THREE.Vector3(2.25 - i * 0.25, 0.2 + 0.3 * Math.sqrt(1 - (z / 0.34) ** 2) + 0.03, z));
  }
  b.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 200, 0.055, 8), M.mat(0xffd21a, 0.35)));
  // Tiny chef riding the sausage
  const shirt = M.mat(0xffffff, 0.6);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.22, 4, 12), shirt);
  torso.position.set(-0.55, 0.72, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), M.mat(0xf2c29b, 0.7));
  head.position.set(-0.52, 1.08, 0);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.14, 0.2, 14), shirt);
  hat.position.set(-0.53, 1.32, 0);
  const puff = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), shirt);
  puff.scale.y = 0.7;
  puff.position.set(-0.53, 1.46, 0);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 6, 16), M.trim);
  wheel.rotation.y = Math.PI / 2;
  wheel.rotation.x = 0.4;
  wheel.position.set(-0.25, 0.78, 0);
  b.add(torso, head, hat, puff, wheel);
  for (const z of [-0.08, 0.08]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), M.trim);
    e.position.set(-0.34, 1.12, z);
    b.add(e);
  }
  const tache = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.14, 4, 8), M.trim);
  tache.rotation.x = Math.PI / 2;
  tache.position.set(-0.33, 1.02, 0);
  b.add(tache);
  return { front: 2.05, rear: -2.1, lampY: -0.12, lampZ: 0.55, flameY: -0.3 };
}

function bubble(b, M) {
  b.add(new THREE.Mesh(pod(1.7, -1.55, 0.93, -0.46, 0.6, 2.2, 2.6), M.paint));
  b.add(new THREE.Mesh(pod(1.25, -1.15, 0.8, -0.1, 1.28, 2.3, 2.2), M.glass));
  // Smiley chrome bumper
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * 2 - 1;
    pts.push(new THREE.Vector3(1.66 - 0.5 * a * a, -0.12 + 0.18 * a * a, a * 0.75));
  }
  b.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.06, 8), M.chrome));
  // Googly eyes on the windscreen; pupils wobble in apply()
  this.eyes = [-0.32, 0.32].map((z, i) => {
    const eye = new THREE.Group();
    eye.position.set(1.02, 0.86, z);
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 14), M.mat(0xffffff, 0.3));
    white.scale.x = 0.6;
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), M.mat(0x050505, 0.2));
    pupil.scale.x = 0.5;
    eye.add(white, pupil);
    b.add(eye);
    return { pupil, o: new THREE.Vector2(-0.08, 0), u: new THREE.Vector2(), k: 1 + i * 0.25 };
  });
  this.prevP = null;
  return { front: 1.52, rear: -1.5, lampY: 0.22, lampZ: 0.6, flameY: -0.25 };
}

function monster(b, M) {
  const frame = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.22, 1.1), M.trim);
  frame.position.y = -0.1;
  b.add(frame);
  // Shark mouth grille
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 1.36), M.mat(0x2a0306, 0.8));
  mouth.position.set(2.13, 0.28, 0);
  b.add(mouth);
  const tooth = new THREE.ConeGeometry(0.09, 0.2, 4);
  const ivory = M.mat(0xfffbe8, 0.4);
  for (let i = 0; i < 13; i++) {
    const t = new THREE.Mesh(tooth, ivory);
    const up = i % 2;
    t.rotation.z = up ? 0 : Math.PI;
    t.position.set(2.17, up ? 0.19 : 0.37, -0.6 + i * 0.1);
    b.add(t);
  }
  for (const z of [-0.45, 0.45]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.2, 10), M.chrome);
    pipe.position.set(-0.98, 1.05, z);
    b.add(pipe);
  }
  return {};
}

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

// How much the nose lifts on a burnout start, per body
const WHEELIE = { gt: 0.7, rally: 0.8, muscle: 1.3, hotdog: 0.9, bubble: 0.6, monster: 1.7 };

export class CarModel {
  constructor(spec, { ghost = false } = {}) {
    const P = BODIES[spec.body];
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.kind = spec.body;
    this.group.add(this.body);
    this.ghost = ghost;

    const paint = ghost
      ? new THREE.MeshStandardMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.35, depthWrite: false, emissive: 0x2aa8ff, emissiveIntensity: 0.4 })
      : new THREE.MeshPhysicalMaterial({ color: spec.color, metalness: P.build && !P.body ? 0.1 : 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 });
    const glass = ghost ? paint : new THREE.MeshPhysicalMaterial({ color: 0x0b0f14, metalness: 0.2, roughness: 0.05, clearcoat: 1 });
    const trim = ghost ? paint : new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6, metalness: 0.3 });
    const chrome = ghost ? paint : new THREE.MeshStandardMaterial({ color: 0xd8dde4, metalness: 0.95, roughness: 0.2 });
    const mat = (color, roughness) => (ghost ? paint : new THREE.MeshStandardMaterial({ color, roughness }));
    this.paint = paint;
    const width = P.body ? Math.max(...P.body.map((b) => b[1])) * 2 : 1.8;
    let L = { lampY: P.lampY ?? -0.12, lampZ: 0.62, flameY: P.flameY ?? -0.3 };
    if (P.body) {
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
      under.position.y = P.under ?? -0.44;
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
        bar.position.set(0.1, P.barY ?? 0.9, 0);
        this.body.add(bar);
        for (const z of [-0.42, -0.14, 0.14, 0.42]) {
          const l = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d0, emissiveIntensity: 0.6 }));
          l.rotation.z = Math.PI / 2;
          l.position.set(0.22, P.barY ?? 0.9, z);
          this.body.add(l);
        }
        if (P.decal !== false) {
          const decal = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.22, width + 0.02), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
          decal.position.set(-0.3, -0.12, 0);
          this.body.add(decal);
        }
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
      L.front = P.body[1][0];
      L.rear = P.body[P.body.length - 1][0];
    }
    if (P.build) L = { ...L, ...P.build.call(this, this.body, { paint, glass, trim, chrome, mat }) };

    // Lights
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: 1.2 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a1a, emissiveIntensity: 0.8 });
    const { front, rear } = L;
    for (const z of [-L.lampZ, L.lampZ]) {
      const hl = new THREE.Mesh(P.body ? new THREE.BoxGeometry(0.1, 0.12, 0.42) : new THREE.SphereGeometry(0.13, 12, 8), headMat);
      hl.position.set(front - 0.02, L.lampY, z);
      const tl = new THREE.Mesh(P.body ? new THREE.BoxGeometry(0.1, 0.12, 0.46) : new THREE.SphereGeometry(0.1, 12, 8), this.tailMat);
      tl.position.set(rear + 0.08, L.lampY + 0.14, z);
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
    const R = spec.wheelR ?? WHEEL_R;
    const [tw, treads] = P.tire ?? [0.3, 0];
    const tireG = new THREE.CylinderGeometry(R, R, tw, 24);
    tireG.rotateX(Math.PI / 2);
    const rimG = new THREE.CylinderGeometry(R * 0.66, R * 0.66, tw + 0.02, 16);
    rimG.rotateX(Math.PI / 2);
    const spokeG = new THREE.BoxGeometry(R * 1.2, 0.06, tw + 0.03);
    const treadG = new THREE.BoxGeometry(0.16, 0.1, tw + 0.04);
    this.wheels = wheelLayout(spec).map(({ x, z }) => {
      const steer = new THREE.Group();
      steer.position.set(x, -R, z);
      const spin = new THREE.Group();
      const tire = new THREE.Mesh(tireG, tireMat);
      const rim = new THREE.Mesh(rimG, rimMat);
      spin.add(tire, rim);
      for (let k = 0; k < 3; k++) {
        const sp = new THREE.Mesh(spokeG, trim);
        sp.rotation.z = (k * Math.PI) / 3;
        spin.add(sp);
      }
      for (let k = 0; k < treads; k++) {
        const a = (k / treads) * Math.PI * 2;
        const tr = new THREE.Mesh(treadG, tireMat);
        tr.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
        tr.rotation.z = a;
        spin.add(tr);
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
      f.position.set(rear - 0.05, L.flameY, z);
      f.visible = false;
      this.group.add(f);
      return f;
    });

    // Headlights for night driving
    if (!ghost) {
      this.headlight = new THREE.SpotLight(0xfff2d8, 0, 120, 0.55, 0.45, 1.2);
      this.headlight.position.set(front, L.lampY + 0.12, 0);
      this.headlight.target.position.set(front + 20, L.lampY - 2.38, 0);
      this.group.add(this.headlight, this.headlight.target);
    }
  }

  // ---------------------------------------------------------------- damage (visual only)
  // Body parts sorted once: big hull pieces get dented, small ones can fly off.
  damageParts() {
    if (this.parts) return this.parts;
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    this.group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
    const hull = [];
    const loose = [];
    for (const c of this.body.children) {
      box.setFromObject(c).applyMatrix4(inv);
      const r = box.getSize(size).length() / 2;
      if (r > 1.3) c.traverse((o) => o.isMesh && hull.push(o));
      else if (r < 1.0) loose.push({ obj: c, parent: c.parent, pos: c.position.clone(), q: c.quaternion.clone(), scale: c.scale.clone() });
    }
    this.parts = { hull, loose };
    return this.parts;
  }

  // Push the hull in around a body-space point, along dir (body space, pointing into the car)
  dent(point, dir, amount) {
    if (this.ghost) return;
    const { hull } = this.damageParts();
    this.group.updateMatrixWorld(true);
    const wp = this.body.localToWorld(point.clone());
    const wd = dir.clone().transformDirection(this.body.matrixWorld);
    const lp = new THREE.Vector3();
    const ld = new THREE.Vector3();
    const v = new THREE.Vector3();
    const inv = new THREE.Matrix4();
    const R = 0.75;
    for (const m of hull) {
      if (!m.userData.origGeo) {
        m.userData.origGeo = m.geometry;
        m.geometry = m.geometry.clone();
        m.userData.rest = Float32Array.from(m.geometry.attributes.position.array);
      }
      inv.copy(m.matrixWorld).invert();
      lp.copy(wp).applyMatrix4(inv);
      ld.copy(wd).transformDirection(inv);
      const pos = m.geometry.attributes.position;
      const rest = m.userData.rest;
      let touched = false;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        const d = v.distanceTo(lp);
        if (d > R) continue;
        const k = (1 - d / R) ** 2 * amount;
        v.addScaledVector(ld, k);
        // Cap the total displacement so the car stays recognisable
        const ox = v.x - rest[i * 3];
        const oy = v.y - rest[i * 3 + 1];
        const oz = v.z - rest[i * 3 + 2];
        const len = Math.hypot(ox, oy, oz);
        if (len > 0.32) v.set(rest[i * 3] + (ox * 0.32) / len, rest[i * 3 + 1] + (oy * 0.32) / len, rest[i * 3 + 2] + (oz * 0.32) / len);
        pos.setXYZ(i, v.x, v.y, v.z);
        touched = true;
      }
      if (touched) {
        pos.needsUpdate = true;
        m.geometry.computeVertexNormals();
      }
    }
  }

  // Fling a small random part off the car; returns false when none is left
  detachPart(vel, near) {
    if (this.ghost || !this.group.parent) return false;
    const left = this.damageParts().loose.filter((p) => p.obj.parent === p.parent);
    if (!left.length) return false;
    // Prefer parts close to the impact
    left.sort((a, b) => a.pos.distanceTo(near) - b.pos.distanceTo(near));
    const part = left[Math.floor(Math.random() * Math.min(3, left.length))];
    this.group.parent.attach(part.obj);
    this.debris ??= [];
    this.debris.push({
      part,
      vel: new THREE.Vector3(vel.x * 0.6 + (Math.random() - 0.5) * 6, 5 + Math.random() * 5, vel.z * 0.6 + (Math.random() - 0.5) * 6),
      spin: new THREE.Vector3((Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18),
      t: 0,
    });
    return true;
  }

  updateDebris(dt, ground) {
    if (!this.debris?.length) return;
    for (const d of this.debris) {
      const o = d.part.obj;
      if (!o.visible) continue;
      d.t += dt;
      d.vel.y -= 9.81 * dt;
      o.position.addScaledVector(d.vel, dt);
      o.rotation.x += d.spin.x * dt;
      o.rotation.y += d.spin.y * dt;
      o.rotation.z += d.spin.z * dt;
      const gy = ground(o.position.x, o.position.z) + 0.15;
      if (o.position.y < gy) {
        o.position.y = gy;
        d.vel.y = Math.abs(d.vel.y) * 0.35;
        d.vel.x *= 0.6;
        d.vel.z *= 0.6;
        d.spin.multiplyScalar(0.5);
      }
      // Shrink away after a few seconds
      if (d.t > 4) o.scale.copy(d.part.scale).multiplyScalar(Math.max(0, 5 - d.t));
      if (d.t > 5) o.visible = false;
    }
  }

  repair() {
    for (const d of this.debris || []) {
      const { obj, parent, pos, q, scale } = d.part;
      parent.add(obj);
      obj.position.copy(pos);
      obj.quaternion.copy(q);
      obj.scale.copy(scale);
      obj.visible = true;
    }
    this.debris = [];
    for (const m of this.parts?.hull || []) {
      if (!m.userData.origGeo) continue;
      m.geometry.dispose();
      m.geometry = m.userData.origGeo;
      delete m.userData.origGeo;
      delete m.userData.rest;
    }
  }

  setNight(on) {
    if (this.headlight) this.headlight.intensity = on ? 900 : 0;
  }

  // state: { steer, spin, susp[4], brake, boost }
  apply(state, t) {
    // Burnout: the driven rear wheels race ahead of the car, the nose lifts (more on the big ones)
    const burn = state.burn || 0;
    this.burnSpin = (this.burnSpin || 0) + burn * 0.9;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      w.steer.position.y = -(state.susp[i] ?? 0.36);
      w.steer.rotation.y = i < 2 ? state.steer : 0;
      w.spin.rotation.z = -state.spin - (i >= 2 ? this.burnSpin : this.burnSpin * 0.25);
    }
    const lift = burn * (WHEELIE[this.kind] ?? 0.8);
    this.body.rotation.z += (lift * 0.11 + Math.sin(t * 40) * 0.006 * burn - this.body.rotation.z) * 0.25;
    this.body.position.y += (lift * 0.06 - this.body.position.y) * 0.25;
    this.tailMat.emissiveIntensity = state.brake ? 4 : 0.8;
    for (const f of this.flames) {
      f.visible = !!state.boost;
      f.scale.set(0.8 + Math.random() * 0.5, 1, 1);
    }
    if (this.eyes) this.wobble(t);
  }

  // Googly eyes: pupils are loose masses on springs, pushed by gravity and the car's acceleration
  wobble(t) {
    const p = this.group.position;
    const dt = t - this.prevT;
    this.prevT = t;
    if (!this.prevP || !(dt > 0 && dt < 0.2)) {
      this.prevP = p.clone();
      this.vel = new THREE.Vector3();
      this.acc = new THREE.Vector3();
      return;
    }
    const v = tmpA.copy(p).sub(this.prevP).divideScalar(dt);
    this.prevP.copy(p);
    this.acc.lerp(tmpB.copy(v).sub(this.vel).divideScalar(dt), Math.min(1, dt * 20));
    this.vel.copy(v);
    const f = tmpB.set(0, -9.81, 0).sub(this.acc).applyQuaternion(tmpQ.copy(this.group.quaternion).invert());
    for (const e of this.eyes) {
      for (let k = 0; k < 2; k++) {
        const h = dt / 2;
        e.u.x += (f.y * 0.3 - 40 * e.k * e.o.x - 2.5 * e.u.x) * h;
        e.u.y += (f.z * 0.3 - 40 * e.k * e.o.y - 2.5 * e.u.y) * h;
        e.o.addScaledVector(e.u, h);
        const r = e.o.length();
        if (r > 0.15) {
          e.o.multiplyScalar(0.15 / r);
          const n = e.o.dot(e.u) / 0.15;
          if (n > 0) e.u.addScaledVector(e.o, (-1.6 * n) / 0.15);
        }
      }
      e.pupil.position.set(0.18 * Math.sqrt(Math.max(0, 1 - (e.o.length() / 0.3) ** 2)) + 0.005, e.o.x, e.o.y);
    }
  }
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
