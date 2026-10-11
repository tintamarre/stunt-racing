// Game loop: fixed-step physics with interpolated rendering, race rules,
// recording for replays and ghosts, attract mode, two-player split screen.
// Player 1 state lives on the Game itself; player 2 (split screen) is a plain object with the same fields.
import * as THREE from 'three';
import { buildTrack, encodeTrack, cellTransform, T, GRID } from './track.js';
import { Physics, Car, CARS, DT } from './physics.js';
import { CarModel } from './car.js';
import { CameraRig, CAM_MODES } from './camera.js';
import { Particles, Skids } from './effects.js';
import { Autopilot } from './autopilot.js';
import { records } from './storage.js';
import { terrainHeight } from './terrain.js';
import { WEATHER_GRIP } from './weather.js';

const FR = 16; // floats per recorded frame
const MAX_FRAMES = 60 * 60 * 12;
const GHOST_STRIDE = 2;

const smokeColor = new THREE.Color(0.85, 0.85, 0.86);
const dustColor = new THREE.Color(0.55, 0.45, 0.3);
const grassColor = new THREE.Color(0.35, 0.5, 0.2);
const sparkBlue = new THREE.Color(0.35, 0.75, 1.6);
const leafColor = new THREE.Color(0.3, 0.6, 0.18);
const woodColor = new THREE.Color(0.45, 0.3, 0.17);
const sparkOrange = new THREE.Color(1.6, 0.7, 0.15);

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
    this.name = 'Player 1';
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
    this.arcade = true; // kart-style handling with drift
    this.autoReturn = false; // put the car back on the road after a while off it
    this.laps = 3; // laps per race on closed circuits
    this.players = 1;
    this.car2Idx = 1;
    this.p2 = null;
    this.slot = 1;
    this.skids2 = new Skids(world.scene);
  }

  racers() {
    return this.p2 ? [this, this.p2] : [this];
  }

  // ------------------------------------------------------------------ setup
  loadTrack(track) {
    this.removeP2();
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
    this.cellIndex = new Map(this.path.cells.flatMap((c, i) => c.covers.map((k) => [k, i])));
    // First path point of each cell, for race positions
    this.cellStart = [];
    this.path.points.forEach((pt, i) => this.cellStart[pt.cell] ??= i);
    const s = this.path.cells[0];
    const xf = cellTransform(s.c, s.r, s.rot);
    this.startCenter = xf.o.clone();
    this.startDir = xf.dir(new THREE.Vector3(1, 0, 0));
    this.record = records.get(this.recordKey());
    this.skids.clear();
    this.particles.clear();
    this.spawnCar();
    this.hud.setTrack(built, this.record);
  }

  setCar(idx) {
    this.carIdx = idx;
    if (this.physics) this.spawnCar();
  }

  spawnPose(ci, lat = 0) {
    const pts = this.path.points;
    let k = pts.findIndex((p) => p.cell === ci);
    if (ci === 0) k += 3;
    const p = pts[Math.max(0, k)];
    const z = new THREE.Vector3().crossVectors(p.f, p.up).normalize();
    const up = new THREE.Vector3().crossVectors(z, p.f).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(p.f, up, z));
    return { pos: p.p.clone().addScaledVector(up, 1.0).addScaledVector(z, lat), q };
  }

  // ------------------------------------------------------------------ split screen
  setPlayers(n, car2Idx = this.car2Idx) {
    this.players = n;
    this.car2Idx = car2Idx;
  }

  spawnP2() {
    this.removeP2();
    const spec = CARS[this.car2Idx];
    const pose = this.spawnPose(0, 2.5);
    const rig = new CameraRig(this.world.camera2);
    rig.ground = terrainHeight;
    rig.setTrack(this.path);
    const p2 = {
      slot: 2,
      name: 'Player 2',
      carIdx: this.car2Idx,
      car: new Car(this.physics, spec, pose.pos, pose.q, { arcade: this.arcade, grip: this.weatherGrip }),
      model: new CarModel(spec),
      rig,
      hud: this.hud2,
      skids: this.skids2,
      prev: { p: new THREE.Vector3(), q: new THREE.Quaternion() },
      curr: { p: new THREE.Vector3(), q: new THREE.Quaternion() },
      spin: 0,
    };
    p2.model.setNight(this.world.preset.night);
    this.world.scene.add(p2.model.group);
    p2.autopilot = new Autopilot(this.path);
    this.p2 = p2;
    this.syncTransforms(true, p2);
    this.world.setSplit(true);
    this.hud2?.setTrack(this.built, null);
  }

  removeP2() {
    const p2 = this.p2;
    if (!p2) return;
    this.world.scene.remove(p2.model.group);
    if (p2.car.physics === this.physics) {
      this.physics.world.removeVehicleController?.(p2.car.vehicle);
      this.physics.world.removeRigidBody(p2.car.body);
    }
    this.skids2.clear();
    this.p2 = null;
    this.world.setSplit(false);
  }

  spawnCar() {
    const spec = CARS[this.carIdx];
    if (this.model) this.world.scene.remove(this.model.group);
    if (this.car && this.car.physics === this.physics) {
      this.physics.world.removeVehicleController?.(this.car.vehicle);
      this.physics.world.removeRigidBody(this.car.body);
    }
    const pose = this.spawnPose(0);
    this.car = new Car(this.physics, spec, pose.pos, pose.q, { arcade: this.arcade, grip: this.weatherGrip });
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

  lapCount() {
    return this.path?.closed ? this.laps : 1;
  }

  recordKey() {
    return records.key(this.code, this.lapCount());
  }

  setLaps(n) {
    this.laps = n;
    if (!this.path) return;
    this.record = records.get(this.recordKey());
    this.setupGhost();
    this.hud.setTrack(this.built, this.record);
  }

  setHandling(arcade) {
    this.arcade = arcade;
    for (const pl of this.racers()) if (pl.car) pl.car.arcade = arcade;
  }

  setWeather(kind) {
    this.weatherGrip = WEATHER_GRIP[kind] ?? 1;
    this.world.setWeather(kind);
    this.audio.setWeather(kind);
    for (const pl of this.racers()) if (pl.car) pl.car.surfaceGrip = this.weatherGrip;
  }

  setPreset(name) {
    this.world.setPreset(name);
    for (const pl of this.racers()) pl.model?.setNight(this.world.preset.night);
  }

  syncTransforms(both, pl = this) {
    const t = pl.car.body.translation();
    const r = pl.car.body.rotation();
    if (both) {
      pl.prev.p.set(t.x, t.y, t.z);
      pl.prev.q.set(r.x, r.y, r.z, r.w);
    } else {
      pl.prev.p.copy(pl.curr.p);
      pl.prev.q.copy(pl.curr.q);
    }
    pl.curr.p.set(t.x, t.y, t.z);
    pl.curr.q.set(r.x, r.y, r.z, r.w);
  }

  // ------------------------------------------------------------------ flow
  resetRun() {
    this.physics.restoreTrees();
    this.world.restoreTrees();
    this.recN = 0;
    this.particles.clear();
    this.finishedAt = null;
    for (const pl of this.racers()) {
      const pose = this.spawnPose(0, this.p2 ? (pl === this ? -2.5 : 2.5) : 0);
      pl.car.reset(pose.pos, pose.q);
      this.syncTransforms(true, pl);
      pl.autopilot.reset();
      pl.visited = new Set([0]);
      pl.lastCi = 0;
      pl.raceTime = 0;
      pl.lap = 1;
      pl.lapStart = 0;
      pl.lapTimes = [];
      pl.crashes = 0;
      pl.flipT = 0;
      pl.offT = 0;
      pl.skids.clear();
      pl.rig.snap = true;
      pl.prevLocalX = -99;
      pl.loopFlag = false;
      pl.done = false;
      pl.finishTime = null;
      pl.progress = 0;
    }
  }

  startAttract() {
    this.removeP2();
    this.mode = 'attract';
    this.resetRun();
    this.rig.mode = CAM_MODES.indexOf('Cinematic');
    this.attractT = 0;
  }

  startRace() {
    if (this.players === 2) this.spawnP2();
    else this.removeP2();
    this.resetRun();
    this.mode = 'countdown';
    this.countdown = 3.2;
    this.lastBeep = 4;
    if (this.rig.mode === CAM_MODES.indexOf('Cinematic') || this.rig.mode === CAM_MODES.indexOf('TV')) this.rig.mode = 0;
    for (const pl of this.racers()) {
      pl.rig.snap = true;
      pl.hud.message('', '');
    }
  }

  // Show a message to every player
  say(text, cls, dur) {
    for (const pl of this.racers()) pl.hud.message(text, cls, dur);
  }

  respawn(reason, pl = this) {
    const pose = this.spawnPose(pl.lastCi);
    pl.car.reset(pose.pos, pose.q);
    this.syncTransforms(true, pl);
    pl.skids.lift(0);
    pl.skids.lift(1);
    pl.skids.lift(2);
    pl.skids.lift(3);
    pl.flipT = 0;
    pl.offT = 0;
    pl.rig.snap = true;
    if (reason) {
      pl.crashes++;
      pl.hud.message(reason, 'crash', 1.4);
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
    if (this.recN < 2 || this.p2) return false;
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
    const pls = this.racers();
    for (const pl of pls) {
      const car = pl.car;
      const slot = this.p2 ? pl.slot : 0;
      let inp;
      if (this.mode === 'race' && !pl.done) inp = this.input.read(DT, slot);
      else if (this.mode === 'attract' || this.mode === 'finished' || pl.done) inp = pl.autopilot.input(car);
      else {
        const raw = this.input.read(DT, slot);
        inp = { throttle: 0, brake: 0, steer: raw.steer, handbrake: true, hold: true };
        pl.revThrottle = raw.throttle;
      }
      if (this.mode === 'finished' || pl.done) inp.throttle *= 0.6;
      pl.lastInput = inp;
      car.update(inp);
      if (this.mode === 'race' || this.mode === 'finished') {
        for (const i of this.physics.smashTrees(car)) this.fellTree(i, pl);
      }
    }
    this.physics.step();
    for (const pl of pls) this.afterStep(pl);
    if (this.p2 && this.mode === 'race') this.checkSplitEnd();
  }

  afterStep(pl) {
    const car = pl.car;
    this.syncTransforms(false, pl);
    const p = pl.curr.p;
    const v = car.vehicle;
    pl.spin += (v.currentVehicleSpeed() * DT) / (car.spec.wheelR ?? 0.36);

    // Race rules
    const ci = this.cellIndex.get(Math.floor(p.z / T) * GRID + Math.floor(p.x / T));
    if (this.mode === 'race' || this.mode === 'attract') {
      if (ci !== undefined) {
        pl.visited.add(ci);
        pl.lastCi = ci;
      }
      if (this.mode === 'race') {
        if (!pl.done) pl.raceTime += DT;
        const lx = tmp.copy(p).sub(this.startCenter).dot(this.startDir);
        const done = this.path.closed
          ? pl.visited.size === this.path.cells.length && ci === 0 && lx > 0 && pl.prevLocalX <= 0
          : pl.visited.size === this.path.cells.length && ci === this.path.cells.length - 1;
        if (ci === 0) pl.prevLocalX = lx;
        else pl.prevLocalX = -99;
        if (done && pl.lap < this.lapCount()) {
          pl.lapTimes.push(pl.raceTime - pl.lapStart);
          pl.lapStart = pl.raceTime;
          pl.lap++;
          pl.visited = new Set([0]);
          const last = pl.lap === this.lapCount();
          pl.hud.message(last ? 'FINAL LAP!' : `LAP ${pl.lap}/${this.lapCount()}`, last ? 'crash' : 'go', 1.2);
          this.audio.beep(last ? 880 : 660, 0.25);
        } else if (done) {
          if (this.p2) this.finishPlayer(pl);
          else this.finish();
        }
      } else if (pl.visited.size === this.path.cells.length && ci === 0) {
        pl.visited = new Set([0]);
      }
      // Crash / stuck detection
      const up = car.up(tmp);
      if (up.y < 0.25 && car.speed() < 3) pl.flipT += DT;
      else if (car.contacts === 0 && car.speed() < 1) pl.flipT += DT * 0.5;
      else pl.flipT = 0;
      if (pl.flipT > 1.3) this.respawn('CRASH!', pl);
      // The attract-mode driver cannot reverse out of a wall
      pl.stuckT = this.mode === 'attract' && car.speed() < 1 ? (pl.stuckT || 0) + DT : 0;
      if (pl.stuckT > 3) this.respawn(null, pl);
      if (p.y < -15) this.respawn('SPLASH!', pl);
      // Optional assist: back on the road after a moment on the grass
      const off = ci === undefined || (car.contacts > 0 && car.onGrass > 0.7);
      pl.offT = this.mode === 'race' && this.autoReturn && off ? pl.offT + DT : 0;
      if (pl.offT > 1.2) {
        this.respawn(null, pl);
        pl.hud.message('BACK ON TRACK', 'boost', 1);
      }
    }

    // Record
    if (this.p2) pl.progress = pl.done ? 1e9 - pl.finishTime : (pl.lap - 1) * 1e5 + pl.visited.size * 1e3 + this.cellProgress(pl, p);
    if (pl === this && !this.p2 && (this.mode === 'race' || this.mode === 'finished') && this.recN < MAX_FRAMES) {
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
    this.emitEffects(car, v, pl.skids);
    if (car.landing > 0) {
      pl.rig.shake = Math.max(pl.rig.shake, car.landing * 0.5);
      this.audio.impact(car.landing);
      car.landing = 0;
      if (this.mode === 'race') {
        const upright = car.up(tmp).y > 0.6;
        if (upright && car.lastSpin > 5.2) pl.hud.message(car.lastSpin > 11 ? 'DOUBLE FLIP!' : 'FLIP!', 'air', 1.2);
        else if (upright && car.lastAir > 1.1) pl.hud.message(`BIG AIR ${car.lastAir.toFixed(1)}s`, 'air', 1.1);
      }
    }
    // Loop callout once the car has been upside down inside a loop
    if (car.inLoop && car.up(tmp).y < -0.7) pl.loopFlag = true;
    if (!car.inLoop && pl.loopFlag) {
      pl.loopFlag = false;
      if (this.mode === 'race' && car.up(tmp).y > 0.6) {
        pl.hud.message('LOOP!', 'air', 1);
        this.audio.whoosh();
      }
    }
    if (car.boosting > 0.75 && !pl.wasBoosting) {
      this.audio.whoosh();
      pl.hud.message('BOOST!', 'boost', 0.7);
    }
    pl.wasBoosting = car.boosting > 0.75;
    if (car.turboEvent) {
      if (this.mode === 'race') {
        this.audio.whoosh();
        pl.hud.message(car.turboEvent === 2 ? 'SUPER TURBO!' : 'MINI-TURBO!', 'boost', 0.7);
      }
      car.turboEvent = 0;
    }
  }

  // Position inside the current cell (0..999), from the nearest centre-line point
  cellProgress(pl, p) {
    const pts = this.path.points;
    const a = this.cellStart[pl.lastCi] ?? 0;
    const b = this.cellStart[pl.lastCi + 1] ?? pts.length;
    let best = a;
    let bd = Infinity;
    for (let i = a; i < b; i++) {
      const d = pts[i].p.distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return (999 * (best - a)) / Math.max(1, b - a);
  }

  finishPlayer(pl) {
    pl.done = true;
    pl.finishTime = pl.raceTime;
    pl.lapTimes.push(pl.raceTime - pl.lapStart);
    const first = this.racers().filter((o) => o.done).length === 1;
    pl.hud.message(first ? 'WINNER!' : 'FINISH', first ? 'go' : 'count', 1.6);
    this.audio.beep(first ? 988 : 660, 0.5);
  }

  // Two-player race ends when both are home, or 30 s after the winner
  checkSplitEnd() {
    const pls = this.racers();
    const done = pls.filter((pl) => pl.done);
    if (!done.length) return;
    const lead = Math.min(...done.map((pl) => pl.finishTime));
    if (done.length < pls.length && Math.max(...pls.map((pl) => pl.raceTime)) - lead < 30) return;
    this.mode = 'finished';
    const results = pls.map((pl) => ({ name: pl.name, car: pl.carIdx, time: pl.done ? pl.finishTime : null, lapTimes: pl.lapTimes, crashes: pl.crashes }));
    const ranked = [...results].sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
    this.hud.finish({ split: true, track: this.track.name, results, winner: results.indexOf(ranked[0]) });
  }

  fellTree(i, pl = this) {
    const t = this.physics.trees[i];
    const lv = pl.car.body.linvel();
    this.world.fellTree(i, lv.x, lv.z);
    for (let k = 0; k < 26; k++) {
      const leaf = k % 3 > 0;
      tmp6.set(t.x + (Math.random() - 0.5) * 2, (leaf ? 3 : 0.8) + Math.random() * 2.5, t.z + (Math.random() - 0.5) * 2);
      tmp7.set(lv.x * 0.25 + (Math.random() - 0.5) * 6, 2 + Math.random() * 4, lv.z * 0.25 + (Math.random() - 0.5) * 6);
      this.particles.emit(tmp6, tmp7, leaf ? leafColor : woodColor, 0.95, leaf ? 0.35 : 0.25, 1.2 + Math.random());
    }
    this.audio.impact(0.6);
    pl.rig.shake = Math.max(pl.rig.shake, 0.35);
    pl.hud.message('TIMBER!', 'air', 0.8);
  }

  emitEffects(car, v, skids) {
    const lv = car.body.linvel();
    const vel = tmp2.set(lv.x, lv.y, lv.z);
    const right = car.right(tmp3);
    for (let i = 0; i < 4; i++) {
      if (!v.wheelIsInContact(i)) {
        skids.lift(i);
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
        skids.lift(i);
        const sp = car.speed();
        if (sp > 6 && Math.random() < Math.min(0.5, sp / 60)) {
          this.particles.emit(pt, vel.clone().multiplyScalar(0.2), Math.random() < 0.75 ? dustColor : grassColor, 0.22, 0.5, 0.9);
        }
      } else {
        // Drift sparks behind the rear wheels: blue, then orange when the mini-turbo is charged
        const lvl = car.drift ? car.driftLevel() : 0;
        if (lvl && i >= 2 && Math.random() < 0.8) {
          this.particles.emit(tmp6.copy(pt).addScaledVector(nrm, 0.15), tmp7.copy(vel).multiplyScalar(0.3), lvl === 2 ? sparkOrange : sparkBlue, 0.95, 0.35, 0.3);
        }
        skids.add(i, pt, nrm, right, s > 0.3 ? s : 0);
        if (s > 0.3 && Math.random() < s * 0.8) {
          this.particles.emit(pt.addScaledVector(nrm, 0.2), vel.clone().multiplyScalar(0.15), smokeColor, 0.35 * s + 0.1, 0.8, 1.6);
        }
      }
    }
  }

  finish() {
    this.mode = 'finished';
    const time = this.raceTime;
    this.lapTimes.push(time - this.lapStart);
    const prevBest = this.record?.time;
    const isBest = !prevBest || time < prevBest;
    if (isBest) {
      const n = Math.floor(this.recN / GHOST_STRIDE);
      const frames = new Float32Array(n * FR);
      for (let i = 0; i < n; i++) frames.set(this.rec.subarray(i * GHOST_STRIDE * FR, i * GHOST_STRIDE * FR + FR), i * FR);
      this.record = { time, car: this.carIdx, stride: GHOST_STRIDE, frames, crashes: this.crashes };
      records.put(this.recordKey(), this.record);
    }
    this.audio.beep(988, 0.5);
    this.hud.finish({ time, prevBest, isBest, crashes: this.crashes, track: this.track.name, lapTimes: this.lapTimes });
  }

  // ------------------------------------------------------------------ per frame
  frame(dt) {
    dt = Math.min(dt, 0.1);
    this.clock += dt;
    const sim = this.mode === 'attract' || this.mode === 'countdown' || this.mode === 'race' || this.mode === 'finished';
    const pls = this.racers();
    const states = [];
    if (sim) {
      if (this.mode === 'countdown') {
        this.countdown -= dt;
        const n = Math.ceil(this.countdown);
        if (n < this.lastBeep && n >= 1 && n <= 3) {
          this.lastBeep = n;
          this.audio.beep(520, 0.2);
          this.say(String(n), 'count', 0.9);
        }
        if (this.countdown <= 0) {
          this.mode = 'race';
          this.audio.beep(1040, 0.4);
          this.say('GO!', 'go', 0.9);
          this.input.resetSteer();
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
      for (const pl of pls) {
        const v = pl.car.vehicle;
        states.push({
          p: new THREE.Vector3().copy(pl.prev.p).lerp(pl.curr.p, a),
          q: new THREE.Quaternion().copy(pl.prev.q).slerp(pl.curr.q, a),
          steer: v.wheelSteering(0),
          spin: pl.spin,
          susp: [0, 1, 2, 3].map((i) => v.wheelSuspensionLength(i)),
          brake: pl.car.braking,
          boost: pl.car.boosting > 0,
        });
      }
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
      const state = this.sampleFrames(this.rec, this.recN, this.replayT / DT);
      if (!this.replayPaused && state.slip > 0.3 && Math.random() < state.slip) {
        this.particles.emit(state.p.clone().add(new THREE.Vector3(0, -0.5, 0)), new THREE.Vector3(), smokeColor, 0.3, 0.8, 1.4);
      }
      this.hud.replayProgress(this.replayT, dur);
      states.push(state);
    } else {
      // paused: keep last pose
      for (const pl of pls) {
        states.push({
          p: pl.curr.p,
          q: pl.curr.q,
          steer: pl.car.vehicle.wheelSteering(0),
          spin: pl.spin,
          susp: [0, 1, 2, 3].map((i) => pl.car.vehicle.wheelSuspensionLength(i)),
        });
      }
    }

    pls.forEach((pl, i) => {
      pl.model.group.position.copy(states[i].p);
      pl.model.group.quaternion.copy(states[i].q);
      pl.model.apply(states[i], this.clock);
    });
    const state = states[0];

    // Ghost
    if (this.ghost) {
      const show = !this.p2 && this.ghostOn && (this.mode === 'race' || this.mode === 'finished' || this.mode === 'paused');
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

    // Cameras
    const speeds = pls.map((pl, i) => {
      const vel = this.mode === 'replay' ? this.replayVel(state) : tmpV.copy(pl.car.body.linvel());
      const speed = vel.length();
      const inLoop = this.mode === 'replay' ? state.p.y > 3 && this.isLoopAt(state.p) : pl.car.inLoop;
      pl.rig.update(dt, { pos: states[i].p, quat: states[i].q, vel, speed, inLoop });
      return speed;
    });
    const speed = speeds[0];
    this.world.update(this.clock, state.p);

    // Audio (player 1's engine)
    const active = this.mode !== 'paused' && !(this.mode === 'replay' && this.replayPaused);
    const inp = this.lastInput || { throttle: 0 };
    const thr = this.mode === 'countdown' ? this.revThrottle || 0 : this.mode === 'replay' ? 0.6 : inp.throttle;
    const slip = this.mode === 'replay' ? state.slip || 0 : Math.max(...this.car.slip);
    this.audio.update(speed, thr, slip, this.car.contacts === 0, active);

    const rank = this.p2 ? [...pls].sort((x, y) => y.progress - x.progress) : null;
    pls.forEach((pl, i) => {
      pl.hud.update({
        mode: this.mode,
        speed: speeds[i],
        gear: this.audio.gear,
        rpm: this.audio.rpm ?? 0.3,
        time: pl.raceTime ?? 0,
        visited: pl.visited?.size ?? 0,
        total: this.path.cells.length,
        car: states[i].p,
        ghost: this.ghost?.group.visible ? this.ghostPos : null,
        other: this.p2 && i === 0 ? states[1].p : null,
        cam: CAM_MODES[pl.rig.mode],
        air: pl.car.airTime,
        lap: pl.lap ?? 1,
        laps: this.lapCount(),
        pos: rank && this.mode !== 'countdown' ? rank.indexOf(pl) + 1 : 0,
      });
    });

    this.world.render(this.p2 ? pls.map((pl, i) => ({ camera: pl.rig.camera, focus: states[i].p })) : null);
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
const tmp6 = new THREE.Vector3();
const tmp7 = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Quaternion();
