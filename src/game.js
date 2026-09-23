// Game loop: fixed-step physics with interpolated rendering, race rules,
// recording for replays and ghosts, attract mode.
import * as THREE from 'three';
import { buildTrack, encodeTrack, cellTransform, T, GRID } from './track.js';
import { Physics, Car, CARS, DT } from './physics.js';
import { CarModel } from './car.js';
import { CameraRig, CAM_MODES } from './camera.js';
import { Particles, Skids } from './effects.js';
import { Autopilot } from './autopilot.js';
import { records } from './storage.js';
import { terrainHeight } from './terrain.js';

const FR = 16; // floats per recorded frame
const MAX_FRAMES = 60 * 60 * 12;
const GHOST_STRIDE = 2;

const smokeColor = new THREE.Color(0.85, 0.85, 0.86);
const dustColor = new THREE.Color(0.55, 0.45, 0.3);
const grassColor = new THREE.Color(0.35, 0.5, 0.2);

export class Game {
  constructor(world, audio, input, hud) {
    this.world = world;
    this.audio = audio;
    this.input = input;
    this.hud = hud;
    this.rig = new CameraRig(world.camera);
    this.rig.ground = terrainHeight;
    this.particles = new Particles(world.scene);
    this.skids = new Skids(world.scene);
    this.mode = 'attract';
    this.carIdx = 0;
    this.clock = 0;
    this.acc = 0;
    this.prev = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
    this.curr = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
    this.rec = new Float32Array(FR * MAX_FRAMES);
    this.recN = 0;
    this.replayT = 0;
    this.replaySpeed = 1;
    this.replayPaused = false;
    this.spin = 0;
    this.attractCam = 0;
    this.ghostOn = true;
  }

  // ------------------------------------------------------------------ setup
  loadTrack(track) {
    this.track = track;
    this.code = encodeTrack(track);
    const built = buildTrack(track);
    this.built = built;
    this.path = built.path;
    this.world.buildTrack(built);
    if (this.car) this.world.scene.remove(this.model.group);
    if (this.physics) this.physics.free();
    this.physics = new Physics(built);
    this.rig.setTrack(this.path);
    this.cellIndex = new Map(this.path.cells.map((c, i) => [c.r * GRID + c.c, i]));
    const s = this.path.cells[0];
    const xf = cellTransform(s.c, s.r, s.rot);
    this.startCenter = xf.o.clone();
    this.startDir = xf.dir(new THREE.Vector3(1, 0, 0));
    this.record = records.get(this.code);
    this.skids.clear();
    this.particles.clear();
    this.spawnCar();
    this.hud.setTrack(built, this.record);
  }

  setCar(idx) {
    this.carIdx = idx;
    if (this.physics) this.spawnCar();
  }

  spawnPose(ci) {
    const pts = this.path.points;
    let k = pts.findIndex((p) => p.cell === ci);
    if (ci === 0) k += 3;
    const p = pts[Math.max(0, k)];
    const z = new THREE.Vector3().crossVectors(p.f, p.up).normalize();
    const up = new THREE.Vector3().crossVectors(z, p.f).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(p.f, up, z));
    return { pos: p.p.clone().addScaledVector(up, 1.0), q };
  }

  spawnCar() {
    const spec = CARS[this.carIdx];
    if (this.model) this.world.scene.remove(this.model.group);
    if (this.car && this.car.physics === this.physics) {
      this.physics.world.removeVehicleController?.(this.car.vehicle);
      this.physics.world.removeRigidBody(this.car.body);
    }
    const pose = this.spawnPose(0);
    this.car = new Car(this.physics, spec, pose.pos, pose.q);
    this.model = new CarModel(spec);
    this.model.setNight(this.world.preset.night);
    this.world.scene.add(this.model.group);
    this.autopilot = new Autopilot(this.path);
    this.syncTransforms(true);
    this.rig.snap = true;
    this.setupGhost();
  }

  setupGhost() {
    if (this.ghost) this.world.scene.remove(this.ghost.group);
    this.ghost = null;
    const r = this.record;
    if (r && r.frames && r.frames.length >= FR) {
      this.ghost = new CarModel(CARS[r.car ?? 0], { ghost: true });
      this.ghost.group.visible = false;
      this.world.scene.add(this.ghost.group);
    }
  }

  setPreset(name) {
    this.world.setPreset(name);
    this.model?.setNight(this.world.preset.night);
  }

  syncTransforms(both) {
    const t = this.car.body.translation();
    const r = this.car.body.rotation();
    if (both) {
      this.prev.p.set(t.x, t.y, t.z);
      this.prev.q.set(r.x, r.y, r.z, r.w);
    } else {
      this.prev.p.copy(this.curr.p);
      this.prev.q.copy(this.curr.q);
    }
    this.curr.p.set(t.x, t.y, t.z);
    this.curr.q.set(r.x, r.y, r.z, r.w);
  }

  // ------------------------------------------------------------------ flow
  resetRun() {
    const pose = this.spawnPose(0);
    this.car.reset(pose.pos, pose.q);
    this.syncTransforms(true);
    this.autopilot.reset();
    this.visited = new Set([0]);
    this.lastCi = 0;
    this.raceTime = 0;
    this.recN = 0;
    this.crashes = 0;
    this.flipT = 0;
    this.skids.clear();
    this.particles.clear();
    this.rig.snap = true;
    this.finishedAt = null;
    this.prevLocalX = -99;
  }

  startAttract() {
    this.mode = 'attract';
    this.resetRun();
    this.rig.mode = CAM_MODES.indexOf('Cinematic');
    this.attractT = 0;
  }

  startRace() {
    this.resetRun();
    this.mode = 'countdown';
    this.countdown = 3.2;
    this.lastBeep = 4;
    if (this.rig.mode === CAM_MODES.indexOf('Cinematic') || this.rig.mode === CAM_MODES.indexOf('TV')) this.rig.mode = 0;
    this.rig.snap = true;
    this.hud.message('', '');
  }

  respawn(reason) {
    const pose = this.spawnPose(this.lastCi);
    this.car.reset(pose.pos, pose.q);
    this.syncTransforms(true);
    this.skids.lift(0);
    this.skids.lift(1);
    this.skids.lift(2);
    this.skids.lift(3);
    this.flipT = 0;
    this.rig.snap = true;
    if (reason) {
      this.crashes++;
      this.hud.message(reason, 'crash', 1.4);
      this.audio.impact(1);
    }
  }

  pause(on) {
    if (on && this.mode === 'race') {
      this.mode = 'paused';
      return true;
    }
    if (!on && this.mode === 'paused') {
      this.mode = 'race';
      return true;
    }
    return false;
  }

  startReplay() {
    if (this.recN < 2) return false;
    this.mode = 'replay';
    this.replayT = 0;
    this.replayPaused = false;
    this.replaySpeed = 1;
    this.rig.mode = CAM_MODES.indexOf('TV');
    this.rig.snap = true;
    this.skids.clear();
    this.particles.clear();
    return true;
  }

  // ------------------------------------------------------------------ simulation
  physicsStep() {
    const car = this.car;
    let inp;
    if (this.mode === 'race') inp = this.input.read(DT);
    else if (this.mode === 'attract' || this.mode === 'finished') inp = this.autopilot.input(car);
    else {
      const raw = this.input.read(DT);
      inp = { throttle: 0, brake: 0, steer: raw.steer, handbrake: true, hold: true };
      this.revThrottle = raw.throttle;
    }
    if (this.mode === 'finished') inp.throttle *= 0.6;
    this.lastInput = inp;
    car.update(inp);
    this.physics.step();
    this.syncTransforms(false);

    const p = this.curr.p;
    const v = car.vehicle;
    this.spin += (v.currentVehicleSpeed() * DT) / 0.36;

    // Race rules
    const ci = this.cellIndex.get(Math.floor(p.z / T) * GRID + Math.floor(p.x / T));
    if (this.mode === 'race' || this.mode === 'attract') {
      if (ci !== undefined) {
        this.visited.add(ci);
        this.lastCi = ci;
      }
      if (this.mode === 'race') {
        this.raceTime += DT;
        const lx = tmp.copy(p).sub(this.startCenter).dot(this.startDir);
        const done = this.path.closed
          ? this.visited.size === this.path.cells.length && ci === 0 && lx > 0 && this.prevLocalX <= 0
          : this.visited.size === this.path.cells.length && ci === this.path.cells.length - 1;
        if (ci === 0) this.prevLocalX = lx;
        else this.prevLocalX = -99;
        if (done) this.finish();
      } else if (this.visited.size === this.path.cells.length && ci === 0) {
        this.visited = new Set([0]);
      }
      // Crash / stuck detection
      const up = car.up(tmp);
      if (up.y < 0.25 && car.speed() < 3) this.flipT += DT;
      else if (car.contacts === 0 && car.speed() < 1) this.flipT += DT * 0.5;
      else this.flipT = 0;
      if (this.flipT > 1.3) this.respawn('CRASH!');
      // The attract-mode driver cannot reverse out of a wall
      this.stuckT = this.mode === 'attract' && car.speed() < 1 ? (this.stuckT || 0) + DT : 0;
      if (this.stuckT > 3) this.respawn(null);
      if (p.y < -15) this.respawn('SPLASH!');
    }

    // Record
    if ((this.mode === 'race' || this.mode === 'finished') && this.recN < MAX_FRAMES) {
      const o = this.recN * FR;
      const f = this.rec;
      f[o] = p.x;
      f[o + 1] = p.y;
      f[o + 2] = p.z;
      f[o + 3] = this.curr.q.x;
      f[o + 4] = this.curr.q.y;
      f[o + 5] = this.curr.q.z;
      f[o + 6] = this.curr.q.w;
      f[o + 7] = v.wheelSteering(0);
      f[o + 8] = this.spin;
      for (let i = 0; i < 4; i++) f[o + 9 + i] = v.wheelSuspensionLength(i);
      f[o + 13] = car.braking ? 1 : 0;
      f[o + 14] = car.boosting > 0 ? 1 : 0;
      f[o + 15] = Math.max(...car.slip);
      this.recN++;
    }

    // Effects
    this.emitEffects(car, v);
    if (car.landing > 0) {
      this.rig.shake = Math.max(this.rig.shake, car.landing * 0.5);
      this.audio.impact(car.landing);
      car.landing = 0;
    }
    if (car.boosting > 0.75 && !this.wasBoosting) {
      this.audio.whoosh();
      this.hud.message('BOOST!', 'boost', 0.7);
    }
    this.wasBoosting = car.boosting > 0.75;
  }

  emitEffects(car, v) {
    const lv = car.body.linvel();
    const vel = tmp2.set(lv.x, lv.y, lv.z);
    const right = car.right(tmp3);
    for (let i = 0; i < 4; i++) {
      if (!v.wheelIsInContact(i)) {
        this.skids.lift(i);
        continue;
      }
      const cp = v.wheelContactPoint(i);
      const cn = v.wheelContactNormal(i);
      if (!cp) continue;
      const pt = tmp4.set(cp.x, cp.y, cp.z);
      const nrm = tmp5.set(cn.x, cn.y, cn.z);
      const g = v.wheelGroundObject(i);
      const grass = g && g.handle === this.physics.ground.handle;
      const s = car.slip[i];
      if (grass) {
        this.skids.lift(i);
        const sp = car.speed();
        if (sp > 6 && Math.random() < Math.min(0.5, sp / 60)) {
          this.particles.emit(pt, vel.clone().multiplyScalar(0.2), Math.random() < 0.75 ? dustColor : grassColor, 0.22, 0.5, 0.9);
        }
      } else {
        this.skids.add(i, pt, nrm, right, s > 0.3 ? s : 0);
        if (s > 0.3 && Math.random() < s * 0.8) {
          this.particles.emit(pt.addScaledVector(nrm, 0.2), vel.clone().multiplyScalar(0.15), smokeColor, 0.35 * s + 0.1, 0.8, 1.6);
        }
      }
    }
  }

  finish() {
    this.mode = 'finished';
    const time = this.raceTime;
    const prevBest = this.record?.time;
    const isBest = !prevBest || time < prevBest;
    if (isBest) {
      const n = Math.floor(this.recN / GHOST_STRIDE);
      const frames = new Float32Array(n * FR);
      for (let i = 0; i < n; i++) frames.set(this.rec.subarray(i * GHOST_STRIDE * FR, i * GHOST_STRIDE * FR + FR), i * FR);
      this.record = { time, car: this.carIdx, stride: GHOST_STRIDE, frames, crashes: this.crashes };
      records.put(this.code, this.record);
    }
    this.audio.beep(988, 0.5);
    this.hud.finish({ time, prevBest, isBest, crashes: this.crashes, track: this.track.name });
  }

  // ------------------------------------------------------------------ per frame
  frame(dt) {
    dt = Math.min(dt, 0.1);
    this.clock += dt;
    const sim = this.mode === 'attract' || this.mode === 'countdown' || this.mode === 'race' || this.mode === 'finished';
    let state;
    if (sim) {
      if (this.mode === 'countdown') {
        this.countdown -= dt;
        const n = Math.ceil(this.countdown);
        if (n < this.lastBeep && n >= 1 && n <= 3) {
          this.lastBeep = n;
          this.audio.beep(520, 0.2);
          this.hud.message(String(n), 'count', 0.9);
        }
        if (this.countdown <= 0) {
          this.mode = 'race';
          this.audio.beep(1040, 0.4);
          this.hud.message('GO!', 'go', 0.9);
          this.input.steer = 0;
        }
      }
      this.acc += dt;
      let steps = 0;
      while (this.acc >= DT && steps < 6) {
        this.physicsStep();
        this.acc -= DT;
        steps++;
      }
      if (steps === 6) this.acc = 0;
      const a = this.acc / DT;
      const v = this.car.vehicle;
      state = {
        p: tmpP.copy(this.prev.p).lerp(this.curr.p, a),
        q: tmpQ.copy(this.prev.q).slerp(this.curr.q, a),
        steer: v.wheelSteering(0),
        spin: this.spin,
        susp: [0, 1, 2, 3].map((i) => v.wheelSuspensionLength(i)),
        brake: this.car.braking,
        boost: this.car.boosting > 0,
      };
      if (this.mode === 'attract') {
        this.attractT += dt;
        if (this.attractT > 8) {
          this.attractT = 0;
          this.attractCam = (this.attractCam + 1) % 3;
          this.rig.mode = CAM_MODES.indexOf(['Cinematic', 'TV', 'Chase'][this.attractCam]);
          this.rig.snap = true;
        }
      }
    } else if (this.mode === 'replay') {
      if (!this.replayPaused) this.replayT += dt * this.replaySpeed;
      const dur = (this.recN - 1) * DT;
      if (this.replayT >= dur) this.replayT = dur;
      state = this.sampleFrames(this.rec, this.recN, this.replayT / DT);
      if (!this.replayPaused && state.slip > 0.3 && Math.random() < state.slip) {
        this.particles.emit(state.p.clone().add(new THREE.Vector3(0, -0.5, 0)), new THREE.Vector3(), smokeColor, 0.3, 0.8, 1.4);
      }
      this.hud.replayProgress(this.replayT, dur);
    } else {
      // paused: keep last pose
      state = {
        p: this.curr.p,
        q: this.curr.q,
        steer: this.car.vehicle.wheelSteering(0),
        spin: this.spin,
        susp: [0, 1, 2, 3].map((i) => this.car.vehicle.wheelSuspensionLength(i)),
      };
    }

    this.model.group.position.copy(state.p);
    this.model.group.quaternion.copy(state.q);
    this.model.apply(state, this.clock);

    // Ghost
    if (this.ghost) {
      const show = this.ghostOn && (this.mode === 'race' || this.mode === 'finished' || this.mode === 'paused');
      this.ghost.group.visible = show;
      if (show) {
        const r = this.record;
        const n = r.frames.length / FR;
        const gs = this.sampleFrames(r.frames, n, this.raceTime / (DT * r.stride));
        this.ghost.group.position.copy(gs.p);
        this.ghost.group.quaternion.copy(gs.q);
        this.ghost.apply(gs, this.clock);
        this.ghostPos = gs.p;
      }
    }

    this.particles.update(this.mode === 'paused' || (this.mode === 'replay' && this.replayPaused) ? 0 : dt);

    // Camera
    const vel = this.mode === 'replay' ? this.replayVel(state) : tmpV.copy(this.car.body.linvel());
    const speed = vel.length();
    this.rig.update(dt, { pos: state.p, quat: state.q, vel, speed, inLoop: this.mode === 'replay' ? state.p.y > 3 && this.isLoopAt(state.p) : this.car.inLoop });
    this.world.update(this.clock, state.p);

    // Audio
    const active = this.mode !== 'paused' && !(this.mode === 'replay' && this.replayPaused);
    const inp = this.lastInput || { throttle: 0 };
    const thr = this.mode === 'countdown' ? this.revThrottle || 0 : this.mode === 'replay' ? 0.6 : inp.throttle;
    const slip = this.mode === 'replay' ? state.slip || 0 : Math.max(...this.car.slip);
    this.audio.update(speed, thr, slip, this.car.contacts === 0, active);

    this.hud.update({
      mode: this.mode,
      speed,
      gear: this.audio.gear,
      rpm: this.audio.rpm ?? 0.3,
      time: this.raceTime ?? 0,
      visited: this.visited?.size ?? 0,
      total: this.path.cells.length,
      car: state.p,
      ghost: this.ghost?.group.visible ? this.ghostPos : null,
      cam: CAM_MODES[this.rig.mode],
      air: this.car.airTime,
    });

    this.world.render();
  }

  isLoopAt(p) {
    return this.physics.loopCells.has(Math.floor(p.z / T) * GRID + Math.floor(p.x / T));
  }

  replayVel(state) {
    const i = Math.max(0, Math.min(this.recN - 2, Math.floor(this.replayT / DT)));
    const f = this.rec;
    return tmpV.set(f[(i + 1) * FR] - f[i * FR], f[(i + 1) * FR + 1] - f[i * FR + 1], f[(i + 1) * FR + 2] - f[i * FR + 2]).divideScalar(DT);
  }

  sampleFrames(f, n, t) {
    const i = Math.max(0, Math.min(n - 1, Math.floor(t)));
    const j = Math.min(n - 1, i + 1);
    const a = Math.max(0, Math.min(1, t - i));
    const o = i * FR;
    const o2 = j * FR;
    const p = new THREE.Vector3(f[o], f[o + 1], f[o + 2]).lerp(tmpA.set(f[o2], f[o2 + 1], f[o2 + 2]), a);
    const q = new THREE.Quaternion(f[o + 3], f[o + 4], f[o + 5], f[o + 6]).slerp(tmpB.set(f[o2 + 3], f[o2 + 4], f[o2 + 5], f[o2 + 6]), a);
    return {
      p,
      q,
      steer: f[o + 7],
      spin: f[o + 8] + (f[o2 + 8] - f[o + 8]) * a,
      susp: [f[o + 9], f[o + 10], f[o + 11], f[o + 12]],
      brake: f[o + 13] > 0.5,
      boost: f[o + 14] > 0.5,
      slip: f[o + 15],
    };
  }
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const tmp3 = new THREE.Vector3();
const tmp4 = new THREE.Vector3();
const tmp5 = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Quaternion();
