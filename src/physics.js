import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3, Quaternion } from 'three';
import { T, GRID } from './track.js';
import { terrainHeight, setRelief, CENTER, TERRAIN_SIZE, TERRAIN_SEGS } from './terrain.js';

export { RAPIER };
export const initPhysics = () => RAPIER.init();

export const CARS = [
  { id: 'gt', name: 'Vortex GT', color: 0xd01c24, engine: 8200, vmax: 58, grip: 2.35, mass: 1250, steer: 0.5, body: 'gt', horn: 'car', stats: [5, 3, 4] },
  { id: 'rally', name: 'Dust Rally', color: 0x1f64d6, engine: 7200, vmax: 52, grip: 2.9, mass: 1150, steer: 0.56, body: 'rally', horn: 'car', stats: [3, 5, 5] },
  { id: 'muscle', name: 'Thunder 69', color: 0xf0a800, engine: 9800, vmax: 55, grip: 2.05, mass: 1450, steer: 0.48, body: 'muscle', horn: 'car', stats: [4, 5, 2] },
  { id: 'hotdog', name: 'Hot Dog', color: 0xc8482a, engine: 8000, vmax: 54, grip: 2.55, mass: 1200, steer: 0.5, body: 'hotdog', horn: 'cucaracha', stats: [3, 4, 4] },
  { id: 'bubble', name: 'Bubble', color: 0xff6fb5, engine: 5400, vmax: 50, grip: 2.75, mass: 780, steer: 0.6, body: 'bubble', horn: 'squeak', stats: [2, 4, 5], wheelR: 0.3, wheels: [[1.15, 0.8], [-1.1, 0.8]] },
  { id: 'monster', name: 'Mad Monster', color: 0x63c22a, engine: 12500, vmax: 54, grip: 2.8, mass: 1900, steer: 0.46, body: 'monster', horn: 'air', stats: [3, 4, 3], wheelR: 0.62, rest: 0.55, travel: 0.6, wheels: [[1.45, 1.25], [-1.4, 1.25]] },
];

export const DT = 1 / 60;
export const TREE_SNAP_SPEED = 6; // m/s (~20 km/h): slower than this, trees are solid
export const DRIFT_LV = [0.4, 1.0]; // drift seconds for blue / orange mini-turbo
const WHEELS = [
  { x: 1.32, z: -0.84, front: true },
  { x: 1.32, z: 0.84, front: true },
  { x: -1.3, z: -0.86, front: false },
  { x: -1.3, z: 0.86, front: false },
];
export const WHEEL_R = 0.36;
const REST = 0.38;
// Optional per-car wheel layout: spec.wheels [[frontX, halfTrack], [rearX, halfTrack]], wheelR, rest, travel
export const wheelLayout = (spec) =>
  spec.wheels ? spec.wheels.flatMap(([x, z], i) => [-z, z].map((zz) => ({ x, z: zz, front: i === 0 }))) : WHEELS;

export class Physics {
  constructor(built) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = DT;
    const w = this.world;

    // Terrain trimesh: the whole landscape at 10 m, plus the track's relief (mountain tracks)
    // at 2.5 m over the playfield, where the coarse quads are left out.
    setRelief(built.relief);
    const rel = built.relief;
    const n = TERRAIN_SEGS;
    const rn = rel ? rel.n : 0;
    const verts = new Float32Array(((n + 1) * (n + 1) + rn * rn) * 3);
    let k = 0;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const x = CENTER - TERRAIN_SIZE / 2 + (i / n) * TERRAIN_SIZE;
        const z = CENTER - TERRAIN_SIZE / 2 + (j / n) * TERRAIN_SIZE;
        verts[k++] = x;
        verts[k++] = terrainHeight(x, z);
        verts[k++] = z;
      }
    }
    const inRelief = (x, z) => rel && x >= rel.x0 && z >= rel.x0 && x <= rel.x0 + (rel.n - 1) * rel.step && z <= rel.x0 + (rel.n - 1) * rel.step;
    const idx = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        if (inRelief(verts[a * 3], verts[a * 3 + 2]) && inRelief(verts[(a + n + 2) * 3], verts[(a + n + 2) * 3 + 2])) continue;
        idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
      }
    }
    if (rel) {
      const o = (n + 1) * (n + 1);
      for (let j = 0; j < rn; j++) {
        for (let i = 0; i < rn; i++) {
          verts[k++] = rel.x0 + i * rel.step;
          verts[k++] = rel.h[j * rn + i];
          verts[k++] = rel.x0 + j * rel.step;
        }
      }
      for (let j = 0; j < rn - 1; j++) {
        for (let i = 0; i < rn - 1; i++) {
          const a = o + j * rn + i;
          idx.push(a, a + rn, a + 1, a + 1, a + rn, a + rn + 1);
        }
      }
    }
    this.ground = w.createCollider(RAPIER.ColliderDesc.trimesh(verts, new Uint32Array(idx)).setFriction(0.8));
    // Boundary walls
    const half = TERRAIN_SIZE / 2 - 20;
    for (const [x, z, hx, hz] of [
      [CENTER + half, CENTER, 2, half],
      [CENTER - half, CENTER, 2, half],
      [CENTER, CENTER + half, half, 2],
      [CENTER, CENTER - half, half, 2],
    ]) {
      w.createCollider(RAPIER.ColliderDesc.cuboid(hx, 200, hz).setTranslation(x, 0, z));
    }

    // Track
    const col = built.collision;
    if (col.idx.length) {
      this.road = w.createCollider(
        RAPIER.ColliderDesc.trimesh(new Float32Array(col.pos), new Uint32Array(col.idx)).setFriction(0.9),
      );
    }
    this.trees = built.trees.map((t) => {
      const r = 0.35 * t.s + 0.15;
      const y = terrainHeight(t.x, t.z) + 2.5;
      return { x: t.x, z: t.z, r, broken: false, col: w.createCollider(RAPIER.ColliderDesc.cylinder(2.5, r).setTranslation(t.x, y, t.z)) };
    });
    for (const h of built.houses) {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), h.rot);
      w.createCollider(
        RAPIER.ColliderDesc.cuboid(5, 3.2, 4).setTranslation(h.x, terrainHeight(h.x, h.z) + 3.2, h.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
      );
    }
    for (const b of built.blocks) {
      w.createCollider(
        RAPIER.ColliderDesc.cuboid(...b.half).setTranslation(b.pos.x, b.pos.y, b.pos.z).setRotation({ x: b.q.x, y: b.q.y, z: b.q.z, w: b.q.w }),
      );
    }
    this.boostZones = built.boostZones;
    this.loopCells = new Set(built.loops.map((l) => l.r * GRID + l.c));
    this.turnCells = new Set(built.path.cells.filter((c) => c.type === 'curve' || c.type === 'bank').map((c) => c.idx));
  }

  step() {
    this.world.step();
  }

  // Trees hit fast enough snap and let the car through, at the cost of some speed.
  // Returns the indices of the trees broken this step.
  smashTrees(car) {
    const lv = car.body.linvel();
    const speed = Math.hypot(lv.x, lv.z);
    if (speed < TREE_SNAP_SPEED) return [];
    const p = car.body.translation();
    const reach = 2.4 + speed * DT * 3;
    const hit = [];
    this.trees.forEach((t, i) => {
      if (t.broken) return;
      const dx = t.x - p.x;
      const dz = t.z - p.z;
      if (Math.abs(dx) > 9 || Math.abs(dz) > 9 || Math.hypot(dx, dz) > reach + t.r || dx * lv.x + dz * lv.z <= 0) return;
      t.broken = true;
      t.col.setEnabled(false);
      hit.push(i);
    });
    if (hit.length) {
      const k = 0.82 ** hit.length;
      car.body.setLinvel({ x: lv.x * k, y: lv.y, z: lv.z * k }, true);
    }
    return hit;
  }

  restoreTrees() {
    for (const t of this.trees) {
      if (!t.broken) continue;
      t.broken = false;
      t.col.setEnabled(true);
    }
  }

  free() {
    this.world.free();
  }
}

const tmpQ = new Quaternion();
const tmpV = new Vector3();
const tmpV2 = new Vector3();
const tmpV3 = new Vector3();

export class Car {
  constructor(physics, spec, pos, quat, opts = {}) {
    this.physics = physics;
    this.spec = spec;
    // Arcade handling: kart-style yaw control, strong grip and drift with mini-turbo.
    this.arcade = opts.arcade ?? false;
    const w = physics.world;
    const bd = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
      .setAngularDamping(0.6)
      .setLinearDamping(0.02)
      .setCcdEnabled(true);
    this.body = w.createRigidBody(bd);
    const m = spec.mass;
    this.collider = w.createCollider(
      RAPIER.ColliderDesc.roundCuboid(1.8, 0.2, 0.7, 0.22)
        .setMassProperties(m, { x: 0, y: -0.55, z: 0 }, { x: m * 0.35, y: m * 1.75, z: m * 1.5 }, { x: 0, y: 0, z: 0, w: 1 })
        // Nearly frictionless body that bounces a little: the car glances off rails, curbs and
        // obstacle edges instead of sticking to them; only a big wall hit head-on stops it.
        .setFriction(0.05)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitution(0.3)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setTranslation(0, 0.2, 0),
      this.body,
    );
    const v = w.createVehicleController(this.body);
    this.vehicle = v;
    wheelLayout(spec).forEach((wh, i) => {
      v.addWheel({ x: wh.x, y: 0, z: wh.z }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: -1 }, spec.rest ?? REST, spec.wheelR ?? WHEEL_R);
      v.setWheelSuspensionStiffness(i, 58);
      v.setWheelSuspensionCompression(i, 3.2);
      v.setWheelSuspensionRelaxation(i, 3.8);
      v.setWheelMaxSuspensionTravel(i, spec.travel ?? 0.4);
      v.setWheelMaxSuspensionForce(i, 1e6);
      v.setWheelFrictionSlip(i, spec.grip);
      v.setWheelSideFrictionStiffness(i, 1);
    });
    this.steer = 0;
    this.onGrass = 0;
    this.airTime = 0;
    this.airSpin = 0;
    this.grounded = 0;
    this.boosting = 0;
    this.slip = [0, 0, 0, 0];
    this.slideAngle = 0;
    this.landing = 0;
    this.braking = false;
    this.drift = 0; // -1 / 1 while drifting left / right
    this.driftCharge = 0; // seconds of drift, mini-turbo levels at DRIFT_LV
    this.turboT = 0;
    this.turboEvent = 0; // level of the mini-turbo just released, read by the game
  }

  reset(pos, quat) {
    this.body.setTranslation(pos, true);
    this.body.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steer = 0;
    this.drift = 0;
    this.driftCharge = 0;
    this.turboT = 0;
  }

  driftLevel() {
    return this.driftCharge >= DRIFT_LV[1] ? 2 : this.driftCharge >= DRIFT_LV[0] ? 1 : 0;
  }

  forward(target = new Vector3()) {
    const r = this.body.rotation();
    return target.set(1, 0, 0).applyQuaternion(tmpQ.set(r.x, r.y, r.z, r.w));
  }
  up(target = new Vector3()) {
    const r = this.body.rotation();
    return target.set(0, 1, 0).applyQuaternion(tmpQ.set(r.x, r.y, r.z, r.w));
  }
  right(target = new Vector3()) {
    const r = this.body.rotation();
    return target.set(0, 0, 1).applyQuaternion(tmpQ.set(r.x, r.y, r.z, r.w));
  }

  speed() {
    const l = this.body.linvel();
    return Math.hypot(l.x, l.y, l.z);
  }

  // input: { throttle, brake, steer, handbrake }
  update(input) {
    const v = this.vehicle;
    const spec = this.spec;
    const body = this.body;
    const lv = body.linvel();
    const vel = tmpV.set(lv.x, lv.y, lv.z);
    const fwd = this.forward(new Vector3());
    const fspeed = vel.dot(fwd);
    const speed = vel.length();
    this.glance(fwd, speed);
    this.prevSpeed = speed;

    // Surface
    let contacts = 0;
    let grass = 0;
    for (let i = 0; i < 4; i++) {
      if (v.wheelIsInContact(i)) {
        contacts++;
        const g = v.wheelGroundObject(i);
        if (g && g.handle === this.physics.ground.handle) grass++;
      }
    }
    this.contacts = contacts;
    this.onGrass = contacts ? grass / contacts : 0;
    const wasAir = this.airTime;
    if (contacts === 0) {
      this.airTime += DT;
      const w = body.angvel();
      this.airSpin += Math.hypot(w.x, w.y, w.z) * DT;
    } else {
      if (wasAir > 0.35) {
        this.landing = Math.min(1, wasAir / 1.5);
        this.lastAir = wasAir;
        this.lastSpin = this.airSpin;
      }
      this.airTime = 0;
      this.airSpin = 0;
    }

    // Steering (speed sensitive, smoothed)
    const maxSteer = spec.steer / (1 + Math.abs(fspeed) / 22);
    const target = -input.steer * maxSteer;
    this.steer += (target - this.steer) * Math.min(1, DT * 10);
    v.setWheelSteering(0, this.steer);
    v.setWheelSteering(1, this.steer);

    // Engine / brakes
    const grassK = 1 - this.onGrass * 0.45;
    let engine = 0;
    let brake = 0;
    const reversing = fspeed < 1.5 && input.brake > 0 && input.throttle === 0;
    if (input.throttle > 0) {
      if (fspeed < -1) brake = 60 * input.throttle;
      else engine = spec.engine * input.throttle * Math.max(0, 1 - (fspeed / spec.vmax) ** 2) * grassK;
    }
    if (input.brake > 0) {
      if (reversing) engine = -spec.engine * 0.45 * input.brake * Math.max(0, 1 + fspeed / 14);
      else brake = 80 * input.brake;
    }
    if (input.hold) {
      engine = 0;
      brake = 200;
    }
    this.braking = brake > 0;
    this.reversing = reversing;
    // In arcade mode the handbrake button is the drift button
    const hb = input.handbrake && !this.arcade;
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      v.setWheelEngineForce(i, -(front ? engine * 0.2 : engine * 0.8)); // Rapier: negative = forward
      v.setWheelBrake(i, front ? brake * 0.6 : brake * 0.4 + (hb ? 90 : 0));
      const slipK = !front && hb ? 0.45 : 1;
      v.setWheelFrictionSlip(i, spec.grip * slipK * (1 - this.onGrass * 0.3));
      v.setWheelSideFrictionStiffness(i, this.drift ? 0.3 : 1);
    }

    // Aero: drag + downforce
    const drag = 0.35 + this.onGrass * 2.5;
    const dt = DT;
    const upv = this.up(new Vector3());
    body.applyImpulse(
      {
        x: (-vel.x * speed * drag - upv.x * speed * speed * 3) * dt,
        y: (-vel.y * speed * drag - upv.y * speed * speed * 3) * dt,
        z: (-vel.z * speed * drag - upv.z * speed * speed * 3) * dt,
      },
      true,
    );

    // Air control: pitch with throttle/brake, roll/yaw with steering
    if (contacts === 0) {
      const right = this.right(new Vector3());
      const m = spec.mass;
      const pitch = (input.brake - input.throttle * 0.5) * m * 0.9 * dt;
      const yaw = -input.steer * m * 1.2 * dt;
      // Stabiliser: nose follows the flight path and the car levels its roll,
      // so jumps land cleanly unless the player fights it.
      const tq = new Vector3();
      if (speed > 6) tq.crossVectors(fwd, tmpV2.copy(vel).divideScalar(speed)).multiplyScalar(m * 2.2 * dt);
      tq.addScaledVector(fwd, right.y * m * 2.5 * dt);
      tq.addScaledVector(right, pitch).addScaledVector(upv, yaw);
      body.applyTorqueImpulse({ x: tq.x, y: tq.y, z: tq.z }, true);
    }

    // Loop assist: extra grip to the surface and a little push, so loops are fun rather than punishing.
    const bp = body.translation();
    this.inLoop = this.physics.loopCells.has(Math.floor(bp.z / T) * GRID + Math.floor(bp.x / T));
    if (this.inLoop && contacts > 0) {
      const m = spec.mass;
      const push = fspeed > 3 && fspeed < 27 ? m * 4 * dt : 0;
      body.applyImpulse(
        { x: -upv.x * m * 9 * dt + fwd.x * push, y: -upv.y * m * 9 * dt + fwd.y * push, z: -upv.z * m * 9 * dt + fwd.z * push },
        true,
      );
    }

    // Boost pads
    this.boosting = Math.max(0, this.boosting - dt);
    if (contacts > 0) {
      const p = body.translation();
      const c = Math.floor(p.x / T);
      const r = Math.floor(p.z / T);
      for (const bz of this.physics.boostZones) {
        if (bz.c === c && bz.r === r) {
          const lx = (p.x - (c + 0.5) * T) * bz.dir.x + (p.z - (r + 0.5) * T) * bz.dir.z;
          const lat = Math.abs((p.x - (c + 0.5) * T) * bz.dir.z - (p.z - (r + 0.5) * T) * bz.dir.x);
          if (Math.abs(lx) < 7.5 && lat < 3.5) {
            const sgn = Math.sign(vel.x * bz.dir.x + vel.z * bz.dir.z) || 1;
            const k = spec.mass * 22 * dt;
            body.applyImpulse({ x: bz.dir.x * k * sgn, y: 0, z: bz.dir.z * k * sgn }, true);
            this.boosting = 0.8;
          }
        }
      }
    }

    if (this.arcade) this.arcadeAssist(input, contacts, fwd, upv);

    v.updateVehicle(dt);

    // Slip estimate per wheel for smoke / skids / audio
    const right = this.right(new Vector3());
    const lat = Math.abs(vel.dot(right));
    for (let i = 0; i < 4; i++) {
      if (!v.wheelIsInContact(i)) {
        this.slip[i] = 0;
        continue;
      }
      const rear = i >= 2;
      let s = Math.max(0, lat - 3.5) / 8;
      if (this.braking && Math.abs(fspeed) > 4) s += 0.5 * input.brake;
      if (rear && hb && speed > 3) s += 0.7;
      if (rear && this.drift) s += 0.4;
      if (rear && input.throttle > 0.5 && fspeed < 12 && fspeed > -1) s += 0.35 * (1 - fspeed / 12);
      this.slip[i] = Math.min(1, s);
    }
  }

  // Scraping a wall at a shallow angle turns the car along it and keeps most of its speed,
  // instead of stopping dead. Head-on hits (steeper than ~48°) are left to the bounce.
  glance(fwd, speed) {
    if (this.inLoop || !this.prevSpeed || this.prevSpeed < 6) return;
    const w = this.physics.world;
    let n = null;
    w.contactPairsWith(this.collider, (other) => {
      w.contactPair(this.collider, other, (m, flipped) => {
        if (n || m.numContacts() === 0) return;
        const nm = m.normal();
        const k = flipped ? 1 : -1; // wall -> car
        if (Math.abs(nm.y) > 0.6) return; // ground, not a wall
        n = tmpV2.set(nm.x * k, 0, nm.z * k).normalize();
      });
    });
    if (!n) return;
    const into = -fwd.dot(n); // sin of the hit angle
    if (into < 0.12 || into > 0.75) return;
    const t = tmpV3.copy(fwd).addScaledVector(n, into).setY(0).normalize();
    const keep = this.prevSpeed * (1 - 0.45 * into);
    if (speed >= keep) return;
    const lv = this.body.linvel();
    this.body.setLinvel({ x: t.x * keep + n.x * 1.5, y: lv.y, z: t.z * keep + n.z * 1.5 }, true);
    // Yaw towards the wall tangent
    const yaw = Math.atan2(-(fwd.x * t.z - fwd.z * t.x), fwd.x * t.x + fwd.z * t.z);
    const av = this.body.angvel();
    this.body.setAngvel({ x: av.x, y: yaw / 0.12, z: av.z }, true);
    this.scrape = 0.3;
  }

  // Kart-style handling: steering sets the yaw rate directly, sideways speed is
  // turned into forward speed, and holding the drift button while steering slides
  // the car into the turn and charges a mini-turbo released with the button.
  arcadeAssist(input, contacts, fwd, upv) {
    const body = this.body;
    const dt = DT;
    const m = this.spec.mass;
    const lv = body.linvel();
    const vel = tmpV.set(lv.x, lv.y, lv.z);
    const speed = vel.length();
    const vf = vel.dot(fwd);
    const grounded = contacts >= 3 && !this.inLoop;

    // Turns stick to the road: a banked curve taken flat out must not act as a ramp
    const bp = body.translation();
    if (this.airTime < 0.3 && this.physics.turnCells.has(Math.floor(bp.z / T) * GRID + Math.floor(bp.x / T))) {
      const k = m * 14 * dt;
      body.applyImpulse({ x: -upv.x * k, y: -upv.y * k, z: -upv.z * k }, true);
    }

    // Drift state
    if (!input.handbrake || vf < 7 || this.airTime > 0.4) {
      const lv = this.driftLevel();
      if (this.drift && lv && !input.handbrake) {
        this.turboT = lv === 2 ? 1.1 : 0.6;
        this.turboEvent = lv;
      }
      this.drift = 0;
      this.driftCharge = 0;
    } else if (!this.drift && grounded && Math.abs(input.steer) > 0.3 && vf > 9) {
      this.drift = Math.sign(input.steer);
      body.applyImpulse({ x: upv.x * m * 2.2, y: upv.y * m * 2.2, z: upv.z * m * 2.2 }, true); // hop
    }
    if (this.drift && grounded) this.driftCharge += dt * (0.8 + 0.4 * Math.max(0, input.steer * this.drift));

    if (this.turboT > 0) {
      this.turboT -= dt;
      this.boosting = Math.max(this.boosting, 0.3);
      if (contacts > 0) body.applyImpulse({ x: fwd.x * m * 15 * dt, y: fwd.y * m * 15 * dt, z: fwd.z * m * 15 * dt }, true);
    }
    if (!grounded) return;

    // Yaw rate from steering (reversed when backing up). Into the drift tightens, counter-steer widens.
    const k = this.drift ? -this.drift * (0.7 + 0.5 * input.steer * this.drift) : -input.steer;
    // Max yaw rate grows with speed so a 90° tile curve is takeable flat out (radius ~13 m at top speed)
    const yawMax = Math.min(3.4, 0.9 + speed / 18) * (this.drift ? 1.15 : 1) * Math.min(1, speed / 4) * (1 - this.onGrass * 0.25);
    const target = k * yawMax * (vf < -0.5 ? -1 : 1);
    const av = body.angvel();
    const w = tmpV2.set(av.x, av.y, av.z);
    w.addScaledVector(upv, (target - w.dot(upv)) * Math.min(1, dt * 10));
    w.addScaledVector(fwd, -w.dot(fwd) * Math.min(1, dt * 4)); // roll damping
    body.setAngvel({ x: w.x, y: w.y, z: w.z }, true);

    // Grip: bleed sideways speed and hand most of it to forward speed
    const right = tmpV2.set(0, 0, 1).applyQuaternion(tmpQ.set(body.rotation().x, body.rotation().y, body.rotation().z, body.rotation().w));
    const vr = vel.dot(right);
    // Hard steering at speed lets the tail step out a little, even without drifting
    const slide = Math.abs(input.steer) * Math.min(1, speed / 35);
    const vr2 = vr * Math.exp(-(this.drift ? 2.2 : 9 - 5 * slide) * dt);
    const gain = Math.abs(vf) > 3 ? 0.9 : 0;
    const vf2 = Math.sign(vf) * Math.sqrt(vf * vf + (vr * vr - vr2 * vr2) * gain);
    vel.addScaledVector(right, vr2 - vr).addScaledVector(fwd, vf2 - vf);
    body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
  }
}
