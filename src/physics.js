import RAPIER from '@dimforge/rapier3d-compat';
import { Vector3, Quaternion } from 'three';
import { T, GRID } from './track.js';
import { terrainHeight, CENTER, TERRAIN_SIZE, TERRAIN_SEGS } from './terrain.js';

export { RAPIER };
export const initPhysics = () => RAPIER.init();

export const CARS = [
  { id: 'gt', name: 'Vortex GT', color: 0xd01c24, engine: 8200, vmax: 58, grip: 2.35, mass: 1250, steer: 0.5, body: 'gt', stats: [5, 3, 4] },
  { id: 'rally', name: 'Dust Rally', color: 0x1f64d6, engine: 7200, vmax: 52, grip: 2.9, mass: 1150, steer: 0.56, body: 'rally', stats: [3, 5, 5] },
  { id: 'muscle', name: 'Thunder 69', color: 0xf0a800, engine: 9800, vmax: 55, grip: 2.05, mass: 1450, steer: 0.48, body: 'muscle', stats: [4, 5, 2] },
];

export const DT = 1 / 60;
const WHEELS = [
  { x: 1.32, z: -0.84, front: true },
  { x: 1.32, z: 0.84, front: true },
  { x: -1.3, z: -0.86, front: false },
  { x: -1.3, z: 0.86, front: false },
];
export const WHEEL_R = 0.36;
const REST = 0.38;

export class Physics {
  constructor(built) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = DT;
    const w = this.world;

    // Terrain trimesh
    const n = TERRAIN_SEGS;
    const verts = new Float32Array((n + 1) * (n + 1) * 3);
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
    const tidx = new Uint32Array(n * n * 6);
    k = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        tidx.set([a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2], k);
        k += 6;
      }
    }
    this.ground = w.createCollider(RAPIER.ColliderDesc.trimesh(verts, tidx).setFriction(0.8));
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
    for (const t of built.trees) {
      w.createCollider(RAPIER.ColliderDesc.cylinder(2.5, 0.35 * t.s + 0.15).setTranslation(t.x, 2.5, t.z));
    }
    for (const h of built.houses) {
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), h.rot);
      w.createCollider(
        RAPIER.ColliderDesc.cuboid(5, 3.2, 4).setTranslation(h.x, 3.2, h.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
      );
    }
    this.boostZones = built.boostZones;
    this.loopCells = new Set(built.loops.map((l) => l.r * GRID + l.c));
  }

  step() {
    this.world.step();
  }

  free() {
    this.world.free();
  }
}

const tmpQ = new Quaternion();
const tmpV = new Vector3();
const tmpV2 = new Vector3();

export class Car {
  constructor(physics, spec, pos, quat) {
    this.physics = physics;
    this.spec = spec;
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
        .setFriction(0.4)
        .setRestitution(0.1)
        .setTranslation(0, 0.2, 0),
      this.body,
    );
    const v = w.createVehicleController(this.body);
    this.vehicle = v;
    WHEELS.forEach((wh, i) => {
      v.addWheel({ x: wh.x, y: 0, z: wh.z }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: -1 }, REST, WHEEL_R);
      v.setWheelSuspensionStiffness(i, 58);
      v.setWheelSuspensionCompression(i, 3.2);
      v.setWheelSuspensionRelaxation(i, 3.8);
      v.setWheelMaxSuspensionTravel(i, 0.4);
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
    this.landing = 0;
    this.braking = false;
  }

  reset(pos, quat) {
    this.body.setTranslation(pos, true);
    this.body.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steer = 0;
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
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      v.setWheelEngineForce(i, -(front ? engine * 0.2 : engine * 0.8)); // Rapier: negative = forward
      v.setWheelBrake(i, front ? brake * 0.6 : brake * 0.4 + (input.handbrake ? 90 : 0));
      const slipK = !front && input.handbrake ? 0.45 : 1;
      v.setWheelFrictionSlip(i, spec.grip * slipK * (1 - this.onGrass * 0.3));
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
      if (rear && input.handbrake && speed > 3) s += 0.7;
      if (rear && input.throttle > 0.5 && fspeed < 12 && fspeed > -1) s += 0.35 * (1 - fspeed / 12);
      this.slip[i] = Math.min(1, s);
    }
  }
}
