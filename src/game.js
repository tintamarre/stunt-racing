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
import { records, stars } from './storage.js';
import { terrainHeight } from './terrain.js';
import { WEATHER_GRIP } from './weather.js';
import { Damage } from './damage.js';
import { Items } from './items.js';
import { Coins } from './coins.js';
import { Stunts } from './stunts.js';
import { Quiz } from './quiz.js';

const FR = 16; // floats per recorded frame
const MAX_FRAMES = 60 * 60 * 12;
const GHOST_STRIDE = 2;

const smokeColor = new THREE.Color(0.85, 0.85, 0.86);
const dustColor = new THREE.Color(0.55, 0.45, 0.3);
const grassColor = new THREE.Color(0.35, 0.5, 0.2);
const mudColor = new THREE.Color(0.28, 0.19, 0.1);
const sparkBlue = new THREE.Color(0.35, 0.75, 1.6);
const leafColor = new THREE.Color(0.3, 0.6, 0.18);
const woodColor = new THREE.Color(0.45, 0.3, 0.17);
const sparkOrange = new THREE.Color(1.6, 0.7, 0.15);

// AI opponents
const BOT_NAMES = ['Turbo Tom', 'Lucky Lou', 'Dizzy Dee', 'Max Power', 'Speedy Sue', 'Rusty Rex'];
const BOT_COLORS = [0x8e44ff, 0x18b8a0, 0xff7a1f, 0xe0e0e0, 0x2c2c34, 0xff4fa0];
export const AI_LEVELS = {
  easy: { speedK: 0.88, wobble: 0.15, band: 0.6 },
  normal: { speedK: 1.0, wobble: 0.08, band: 1 },
  hard: { speedK: 1.1, wobble: 0.03, band: 1.3 },
};
const NO_HUD = { message() {} };

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
    this.opponents = 3;
    this.aiLevel = 'normal';
    this.bots = [];
    this.items = new Items(this);
    this.coinField = new Coins(this);
    this.stunts = new Stunts();
    this.quiz = new Quiz(this);
  }

  setItems(on) {
    this.items.enabled = on;
    this.items.setVisible(on);
  }

  // Item button of a human player (slot 1 or 2)
  useItem(slot = 1) {
    if (this.mode !== 'race') return;
    const pl = slot === 2 ? this.p2 : this;
    if (pl && !pl.done) this.items.use(pl);
  }

  // Human players (they own a camera and a HUD)
  racers() {
    return this.p2 ? [this, this.p2] : [this];
  }

  // Everybody on track: humans first, then the AI opponents
  everyone() {
    return this.bots.length ? [...this.racers(), ...this.bots] : this.racers();
  }

  setOpponents(n, level = this.aiLevel) {
    this.opponents = n;
    this.aiLevel = level;
  }

  spawnBots() {
    this.removeBots();
    const taken = new Set([this.carIdx, ...(this.players === 2 ? [this.car2Idx] : [])]);
    const pool = CARS.map((_, i) => i).filter((i) => !taken.has(i));
    const lvl = AI_LEVELS[this.aiLevel] || AI_LEVELS.normal;
    for (let i = 0; i < this.opponents; i++) {
      const carIdx = pool[i % pool.length];
      // Same car twice: repaint the second one
      const spec = i < pool.length ? CARS[carIdx] : { ...CARS[carIdx], color: BOT_COLORS[i % BOT_COLORS.length] };
      const pose = this.spawnPose(0);
      const bot = {
        bot: true,
        slot: 0,
        name: BOT_NAMES[i % BOT_NAMES.length],
        carIdx,
        car: new Car(this.physics, spec, pose.pos, pose.q, { arcade: this.arcade, grip: this.weatherGrip }),
        model: new CarModel(spec),
        autopilot: new Autopilot(this.path, { speedK: lvl.speedK * (0.97 + 0.06 * Math.random()), wobble: lvl.wobble, lane: ((i % 3) - 1) * 2.2, arcade: this.arcade }),
        rig: { shake: 0, snap: false },
        hud: NO_HUD,
        skids: null,
        prev: { p: new THREE.Vector3(), q: new THREE.Quaternion() },
        curr: { p: new THREE.Vector3(), q: new THREE.Quaternion() },
        spin: 0,
      };
      bot.damage = new Damage(bot, this);
      bot.model.setNight(this.world.preset.night);
      this.world.scene.add(bot.model.group);
      this.bots.push(bot);
    }
  }

  removeBots() {
    for (const b of this.bots) {
      this.world.scene.remove(b.model.group);
      if (b.car.physics === this.physics) {
        this.physics.world.removeVehicleController?.(b.car.vehicle);
        this.physics.world.removeRigidBody(b.car.body);
      }
    }
    this.bots = [];
  }

  // ------------------------------------------------------------------ setup
  loadTrack(track) {
    this.removeP2();
    this.removeBots();
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
    this.items.build(this.path);
    this.coinField.build(this.path);
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
    let k = this.path.points.findIndex((p) => p.cell === ci);
    if (ci === 0) k += 3;
    return this.poseAt(Math.max(0, k), lat);
  }

  poseAt(k, lat = 0) {
    const p = this.path.points[k];
    const z = new THREE.Vector3().crossVectors(p.f, p.up).normalize();
    const up = new THREE.Vector3().crossVectors(z, p.f).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(p.f, up, z));
    return { pos: p.p.clone().addScaledVector(up, 1.0).addScaledVector(z, lat), q, k };
  }

  // Starting grid: two abreast, 8 m between rows, extending back behind the start line
  gridPose(slot, alone) {
    const pts = this.path.points;
    const N = pts.length;
    let k = pts.findIndex((p) => p.cell === 0) + 3 - Math.floor(slot / 2) * 4;
    k = this.path.closed ? (k + N) % N : Math.max(0, k);
    return this.poseAt(k, alone ? 0 : slot % 2 ? 2.6 : -2.6);
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
    p2.damage = new Damage(p2, this);
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
    this.damage = new Damage(this, this);
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
    for (const pl of this.everyone()) if (pl.car) pl.car.surfaceGrip = this.weatherGrip;
  }

  setPreset(name) {
    this.world.setPreset(name);
    for (const pl of this.everyone()) pl.model?.setNight(this.world.preset.night);
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
    this.items.reset(this.everyone());
    this.coinField.reset(this.everyone());
    this.quiz.reset();
    // Opponents in front, humans at the back of the grid
    const grid = [...this.bots, ...this.racers()];
    for (const pl of grid) {
      const pose = this.gridPose(grid.indexOf(pl), grid.length === 1);
      pl.car.reset(pose.pos, pose.q);
      this.syncTransforms(true, pl);
      pl.autopilot.reset(pose.k);
      this.stunts.reset(pl);
      pl.trackIdx = pose.k;
      pl.missedT = 0;
      pl.freezeT = 0;
      pl.boostT = 0;
      pl.lastCi = this.path.points[pose.k].cell;
      pl.visited = new Set([0]);
      // Back rows of the grid start behind the line: their first crossing is the start, not a lap
      pl.behindLine = this.path.closed && tmp.copy(pose.pos).sub(this.startCenter).dot(this.startDir) < 0;
      pl.raceTime = 0;
      pl.lap = 1;
      pl.lapStart = 0;
      pl.lapTimes = [];
      pl.crashes = 0;
      pl.flipT = 0;
      pl.offT = 0;
      pl.skids?.clear();
      pl.damage?.reset();
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
    this.removeBots();
    this.mode = 'attract';
    this.resetRun();
    this.rig.mode = CAM_MODES.indexOf('Cinematic');
    this.attractT = 0;
  }

  startRace() {
    if (this.players === 2) this.spawnP2();
    else this.removeP2();
    if (this.opponents > 0 && this.path.closed) this.spawnBots();
    else this.removeBots();
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
    pl.trackIdx = pose.k;
    pl.autopilot?.reset(pose.k);
    for (let i = 0; i < 4; i++) pl.skids?.lift(i);
    pl.flipT = 0;
    pl.offT = 0;
    pl.rig.snap = true;
    if (reason) {
      this.stunts.bail(pl);
      pl.crashes++;
      pl.hud.message(reason, 'crash', 1.4);
      if (!pl.bot) this.audio.impact(1);
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
    const pls = this.everyone();
    if (this.bots.length && this.mode === 'race') this.rubberBand();
    for (const pl of pls) {
      const car = pl.car;
      const slot = this.p2 ? pl.slot : 0;
      let inp;
      if (pl.bot) {
        inp = this.mode === 'race' || this.mode === 'finished' ? pl.autopilot.input(car) : { throttle: 0, brake: 0, steer: 0, handbrake: true, hold: true };
      } else if (this.mode === 'race' && pl.freezeT > 0) {
        // Frozen by the quiz: held on the brakes until the time runs out
        pl.freezeT -= DT;
        const left = Math.ceil(pl.freezeT);
        if (left !== pl.freezeShown) pl.hud.message(left > 0 ? `FROZEN ${left}` : 'GO!', left > 0 ? 'crash' : 'go', 0.9);
        pl.freezeShown = left;
        inp = { throttle: 0, brake: 0, steer: 0, handbrake: true, hold: true };
      } else if (this.mode === 'race' && !pl.done) inp = this.input.read(DT, slot);
      else if (this.mode === 'attract' || this.mode === 'finished' || pl.done) inp = pl.autopilot.input(car);
      else {
        const raw = this.input.read(DT, slot);
        inp = { throttle: 0, brake: 0, steer: raw.steer, handbrake: true, hold: true };
        pl.revThrottle = raw.throttle;
      }
      if ((this.mode === 'finished' && !pl.bot) || pl.done) inp.throttle *= 0.6;
      pl.lastInput = inp;
      car.update(inp);
      // Turbo from an item or a right quiz answer
      if (pl.boostT > 0) {
        pl.boostT -= DT;
        this.items.push(car, 16);
        car.boosting = Math.max(car.boosting, 0.3);
      }
      if (this.mode === 'race' || this.mode === 'finished') {
        for (const i of this.physics.smashTrees(car)) this.fellTree(i, pl);
      }
    }
    if (this.mode === 'race' || this.mode === 'finished') this.items.step(pls, this.mode === 'race' || this.bots.length > 0);
    if (this.mode === 'race') this.coinField.step(pls);
    this.physics.step();
    for (const pl of pls) this.afterStep(pl);
    if (this.p2 && this.mode === 'race') this.checkSplitEnd();
    this.quiz.step();
  }

  // Opponents speed up a little when behind the best human and ease off when ahead
  rubberBand() {
    const lead = Math.max(...this.racers().map((pl) => pl.progress || 0));
    const k = (AI_LEVELS[this.aiLevel] || AI_LEVELS.normal).band;
    for (const b of this.bots) {
      const gap = (lead - (b.progress || 0)) / 1000; // in tiles
      b.autopilot.band = 1 + Math.max(-0.1, Math.min(0.14, gap * 0.02)) * k;
    }
  }

  afterStep(pl) {
    const car = pl.car;
    this.syncTransforms(false, pl);
    pl.damage?.step();
    const p = pl.curr.p;
    const v = car.vehicle;
    pl.spin += (v.currentVehicleSpeed() * DT) / (car.spec.wheelR ?? 0.36);

    // Race rules
    const ci = this.cellIndex.get(Math.floor(p.z / T) * GRID + Math.floor(p.x / T));
    // Opponents keep racing after the player has finished
    const racing = this.mode === 'race' || (this.mode === 'finished' && pl.bot);
    if (racing || this.mode === 'attract') {
      if (ci !== undefined) {
        pl.visited.add(ci);
        pl.lastCi = ci;
      }
      // A tile also counts when the car passes near its centre line (cutting a corner over the grass)
      const near = this.trackPoint(pl, p);
      if (near) pl.visited.add(near.cell);
      if (racing) {
        if (!pl.done) pl.raceTime += DT;
        const lx = tmp.copy(p).sub(this.startCenter).dot(this.startDir);
        const n = this.path.cells.length;
        const enough = pl.visited.size >= n - Math.floor(n * 0.08);
        const crossed = this.path.closed && ci === 0 && lx > 0 && pl.prevLocalX <= 0;
        const done = this.path.closed ? enough && crossed && !pl.behindLine : enough && ci === n - 1;
        if (crossed && pl.behindLine) {
          pl.behindLine = false;
          pl.visited = new Set([0]);
        } else if (crossed && !enough && !pl.bot) {
          pl.hud.message('MISSED TILES!', 'crash', 1.6);
          pl.missedT = 5;
        }
        if (ci === 0) pl.prevLocalX = lx;
        else pl.prevLocalX = -99;
        if (done && pl.lap < this.lapCount()) {
          pl.lapTimes.push(pl.raceTime - pl.lapStart);
          pl.lapStart = pl.raceTime;
          pl.lap++;
          pl.visited = new Set([0]);
          const last = pl.lap === this.lapCount();
          pl.hud.message(last ? 'FINAL LAP!' : `LAP ${pl.lap}/${this.lapCount()}`, last ? 'crash' : 'go', 1.2);
          if (!pl.bot) this.audio.beep(last ? 880 : 660, 0.25);
        } else if (done && !pl.done) {
          if (pl.bot || this.p2) this.finishPlayer(pl);
          else this.finish();
        }
      } else if (pl.visited.size >= this.path.cells.length - 2 && ci === 0) {
        pl.visited = new Set([0]);
      }
      if (pl.missedT > 0) pl.missedT -= DT;
      this.stunts.step(pl, racing);
      // Crash / stuck detection
      const up = car.up(tmp);
      if (up.y < 0.25 && car.speed() < 3) pl.flipT += DT;
      else if (car.contacts === 0 && car.speed() < 1) pl.flipT += DT * 0.5;
      else pl.flipT = 0;
      if (pl.flipT > 1.3) this.respawn('CRASH!', pl);
      // The attract-mode driver cannot reverse out of a wall
      pl.stuckT = (this.mode === 'attract' || pl.bot) && car.speed() < 1 ? (pl.stuckT || 0) + DT : 0;
      if (pl.stuckT > 3) this.respawn(null, pl);
      if (p.y < -15) this.respawn('SPLASH!', pl);
      // Optional assist: back on the road after a moment on the grass
      const off = ci === undefined || (car.contacts > 0 && car.onGrass > 0.7);
      pl.offT = racing && (this.autoReturn || pl.bot) && off ? pl.offT + DT : 0;
      if (pl.offT > (pl.bot ? 2.5 : 1.2)) {
        this.respawn(null, pl);
        pl.hud.message('BACK ON TRACK', 'boost', 1);
      }
    }

    // Record
    if (this.p2 || this.bots.length) pl.progress = pl.done ? 1e9 - pl.finishTime : (pl.lap - 1) * 1e5 + pl.visited.size * 1e3 + this.cellProgress(pl, p);
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
    this.burnout(pl);
    if (car.landing > 0) {
      pl.rig.shake = Math.max(pl.rig.shake, car.landing * 0.5);
      if (!pl.bot) this.audio.impact(car.landing);
      car.landing = 0;
      if (this.mode === 'race') {
        const upright = car.up(tmp).y > 0.6;
        if (upright && car.lastSpin > 5.2) pl.hud.message(car.lastSpin > 11 ? 'DOUBLE FLIP!' : 'FLIP!', 'air', 1.2);
        else if (upright && car.lastAir > 1.1) pl.hud.message(`BIG AIR ${car.lastAir.toFixed(1)}s`, 'air', 1.1);
        if (upright && car.lastSpin > 11) this.stunts.add(pl, 'DOUBLE FLIP', 1500);
        else if (upright && car.lastSpin > 5.2) this.stunts.add(pl, 'FLIP', 600);
        if (upright && car.lastAir > 0.8) this.stunts.add(pl, 'AIR', car.lastAir * 200);
      }
    }
    // Loop callout once the car has been upside down inside a loop
    if (car.inLoop && car.up(tmp).y < -0.7) pl.loopFlag = true;
    if (!car.inLoop && pl.loopFlag) {
      pl.loopFlag = false;
      if (this.mode === 'race' && car.up(tmp).y > 0.6 && !pl.bot) {
        pl.hud.message('LOOP!', 'air', 1);
        this.stunts.add(pl, 'LOOP', 400);
        this.audio.whoosh();
      }
    }
    if (car.boosting > 0.75 && !pl.wasBoosting && !pl.bot) {
      this.audio.whoosh();
      pl.hud.message('BOOST!', 'boost', 0.7);
    }
    pl.wasBoosting = car.boosting > 0.75;
    if (car.turboEvent) {
      if (this.mode === 'race' && !pl.bot) {
        this.audio.whoosh();
        pl.hud.message(car.turboEvent === 2 ? 'SUPER TURBO!' : 'MINI-TURBO!', 'boost', 0.7);
        this.stunts.add(pl, car.turboEvent === 2 ? 'SUPER TURBO' : 'MINI-TURBO', car.turboEvent === 2 ? 300 : 150);
      }
      car.turboEvent = 0;
    }
  }

  // Nearest centre-line point, searched a little ahead of the last one; null when far off the road
  trackPoint(pl, p) {
    const pts = this.path.points;
    const N = pts.length;
    let best = pl.trackIdx ?? 0;
    let bd = Infinity;
    for (let k = -10; k < 60; k++) {
      const j = (((pl.trackIdx ?? 0) + k) % N + N) % N;
      const d = pts[j].p.distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    if (bd > 22 * 22) return null;
    pl.trackIdx = best;
    return pts[best];
  }

  // Tiles still to drive over this lap (shown on the minimap after a missed lap)
  missingTiles(pl) {
    if (!(pl.missedT > 0)) return null;
    return this.path.cells.map((_, i) => i).filter((i) => !pl.visited.has(i)).map((i) => this.path.points[this.cellStart[i]].p);
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
    if (pl.bot) return;
    const place = this.everyone().filter((o) => o.done).length;
    pl.hud.message(place === 1 ? 'WINNER!' : `${ordinal(place)} PLACE`, place === 1 ? 'go' : 'count', 1.6);
    this.audio.beep(place === 1 ? 988 : 660, 0.5);
  }

  // Everybody ranked: finishers by time, then the others by progress
  standings() {
    return [...this.everyone()]
      .sort((a, b) => (a.done && b.done ? a.finishTime - b.finishTime : a.done ? -1 : b.done ? 1 : (b.progress || 0) - (a.progress || 0)))
      .map((pl) => ({ name: pl.name, car: pl.carIdx, time: pl.done ? pl.finishTime : null, human: !pl.bot, lapTimes: pl.lapTimes, crashes: pl.crashes }));
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
    this.hud.finish({ split: true, track: this.track.name, results, winner: results.indexOf(ranked[0]), standings: this.bots.length ? this.standings() : null });
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
    this.stunts.add(pl, 'TIMBER', 80);
  }

  // Full throttle from a standstill (or out of reverse): the rear wheels spin, smoke on the
  // asphalt, mud flying off the grass, and the model lifts its nose (see CarModel.apply)
  burnout(pl) {
    const car = pl.car;
    const v = car.vehicle;
    const lv = car.body.linvel();
    const fsp = car.forward(tmp).dot(tmp2.set(lv.x, lv.y, lv.z));
    const thr = this.mode === 'countdown' ? pl.revThrottle || 0 : pl.lastInput?.throttle || 0;
    const want = car.contacts >= 3 && thr > 0.5 && fsp < 14 && fsp > -8 && !(car.stunT > 0) ? thr * (1 - Math.max(0, fsp) / 14) : 0;
    pl.burn = (pl.burn || 0) + (want - (pl.burn || 0)) * (want > (pl.burn || 0) ? 0.25 : 0.08);
    if (pl.burn < 0.15) return;
    const back = car.forward(tmp3).multiplyScalar(-1);
    for (let i = 2; i < 4; i++) {
      if (!v.wheelIsInContact(i)) continue;
      const cp = v.wheelContactPoint(i);
      if (!cp) continue;
      const g = v.wheelGroundObject(i);
      const grass = g && g.handle === this.physics.ground.handle;
      car.slip[i] = Math.max(car.slip[i], pl.burn);
      if (grass) {
        // Clods of mud thrown back and up, falling again
        for (let k = 0; k < 2; k++) {
          if (Math.random() > pl.burn) continue;
          tmp6.set(cp.x, cp.y + 0.15, cp.z);
          tmp7.copy(back).multiplyScalar(5 + Math.random() * 6).add(tmp5.set((Math.random() - 0.5) * 2.5, 3 + Math.random() * 4, (Math.random() - 0.5) * 2.5));
          this.particles.emit(tmp6, tmp7, Math.random() < 0.7 ? mudColor : dustColor, 0.95, 0.16 + Math.random() * 0.12, 0.9, 11);
        }
      } else if (Math.random() < pl.burn) {
        tmp6.set(cp.x, cp.y + 0.25, cp.z);
        tmp7.copy(back).multiplyScalar(2.5).add(tmp5.set((Math.random() - 0.5) * 1.5, 0.8, (Math.random() - 0.5) * 1.5));
        this.particles.emit(tmp6, tmp7, smokeColor, 0.45 * pl.burn + 0.15, 0.9, 1.8);
      }
    }
  }

  emitEffects(car, v, skids) {
    const lv = car.body.linvel();
    const vel = tmp2.set(lv.x, lv.y, lv.z);
    const right = car.right(tmp3);
    for (let i = 0; i < 4; i++) {
      if (!v.wheelIsInContact(i)) {
        skids?.lift(i);
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
        skids?.lift(i);
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
        skids?.add(i, pt, nrm, right, s > 0.3 ? s : 0);
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
    this.done = true;
    this.finishTime = time;
    const place = this.bots.length ? this.everyone().filter((o) => o.done).length : 0;
    if (place) this.hud.message(place === 1 ? 'WINNER!' : `${ordinal(place)} PLACE`, place === 1 ? 'go' : 'count', 1.6);
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
    // Stars: finish, par time, every coin
    const par = this.coinField.parTime(this.lapCount());
    const won = { finish: true, par: time <= par, coins: this.coinField.coins.length > 0 && this.coins === this.coinField.coins.length };
    const had = stars.get(this.code) || {};
    const fresh = Object.keys(won).filter((k) => won[k] && !had[k]);
    const score = this.stunts.total(this);
    stars.put(this.code, { finish: true, par: had.par || won.par, coins: had.coins || won.coins, bestScore: Math.max(had.bestScore || 0, score) });
    this.hud.finish({
      time, prevBest, isBest, crashes: this.crashes, track: this.track.name, lapTimes: this.lapTimes, place,
      standings: place ? this.standings() : null,
      score, prevScore: had.bestScore || 0,
      stars: won, freshStars: fresh, allStars: stars.get(this.code), par, coins: this.coins, coinTotal: this.coinField.coins.length,
    });
  }

  // ------------------------------------------------------------------ per frame
  frame(dt) {
    dt = Math.min(dt, 0.1);
    this.clock += dt;
    const sim = this.mode === 'attract' || this.mode === 'countdown' || this.mode === 'race' || this.mode === 'finished';
    if (this.mode === 'quiz') this.quiz.update(dt);
    const pls = this.racers();
    const all = this.everyone();
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
      for (const pl of all) {
        const v = pl.car.vehicle;
        states.push({
          p: new THREE.Vector3().copy(pl.prev.p).lerp(pl.curr.p, a),
          q: new THREE.Quaternion().copy(pl.prev.q).slerp(pl.curr.q, a),
          steer: v.wheelSteering(0),
          spin: pl.spin,
          susp: [0, 1, 2, 3].map((i) => v.wheelSuspensionLength(i)),
          brake: pl.car.braking,
          boost: pl.car.boosting > 0,
          burn: pl.burn || 0,
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
      for (const pl of all) {
        states.push({
          p: pl.curr.p,
          q: pl.curr.q,
          steer: pl.car.vehicle.wheelSteering(0),
          spin: pl.spin,
          susp: [0, 1, 2, 3].map((i) => pl.car.vehicle.wheelSuspensionLength(i)),
        });
      }
    }

    all.forEach((pl, i) => {
      // Opponents aren't recorded, so they sit out the replay
      pl.model.group.visible = !!states[i];
      if (!states[i]) return;
      pl.model.group.position.copy(states[i].p);
      pl.model.group.quaternion.copy(states[i].q);
      pl.model.apply(states[i], this.clock);
    });
    const state = states[0];

    // Ghost
    if (this.ghost) {
      const show = !this.p2 && !this.bots.length && this.ghostOn && (this.mode === 'race' || this.mode === 'finished' || this.mode === 'paused');
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
    for (const pl of all) pl.damage?.update(sim ? dt : 0);
    this.items.update(dt, this.clock, all);
    this.coinField.update(this.clock);

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
    const active = this.mode !== 'paused' && this.mode !== 'quiz' && !(this.mode === 'replay' && this.replayPaused);
    const inp = this.lastInput || { throttle: 0 };
    const thr = this.mode === 'countdown' ? this.revThrottle || 0 : this.mode === 'replay' ? 0.6 : inp.throttle;
    const slip = this.mode === 'replay' ? state.slip || 0 : Math.max(...this.car.slip);
    this.audio.update(speed, thr, slip, this.car.contacts === 0, active);

    const rank = this.p2 || this.bots.length ? [...all].sort((x, y) => (x.done && y.done ? x.finishTime - y.finishTime : (y.progress || 0) - (x.progress || 0))) : null;
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
        others: states.length > 1 ? all.map((o, j) => (o === pl || !states[j] ? null : { p: states[j].p, human: !o.bot })).filter(Boolean) : null,
        cam: CAM_MODES[pl.rig.mode],
        air: pl.car.airTime,
        lap: pl.lap ?? 1,
        laps: this.lapCount(),
        pos: rank && this.mode !== 'countdown' ? rank.indexOf(pl) + 1 : 0,
        field: all.length,
        item: this.mode === 'race' ? this.items.view(pl) : '',
        missing: this.missingTiles(pl),
        score: pl.combo ? this.stunts.total(pl) : 0,
        combo: pl.combo?.pts ? `+${pl.combo.pts} ×${Math.max(1, pl.combo.mult - 1)}` : '',
        coins: this.coinField.coins.length ? `${pl.coins || 0}/${this.coinField.coins.length}` : '',
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

export const ordinal = (n) => `${n}${['TH', 'ST', 'ND', 'RD'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;
