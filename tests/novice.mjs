// Novice driver test: full throttle, never brakes, steers toward the centre line
// (optionally drifting in curves). Arcade handling should let it finish laps.
import { Vector3 } from 'three';
import { BUILTIN } from '../src/tracks.js';
import { buildTrack, cellTransform, T } from '../src/track.js';
import { initPhysics, Physics, Car, CARS, DT } from '../src/physics.js';
import { Autopilot } from '../src/autopilot.js';

await initPhysics();
const drift = process.argv.includes('--drift');
let failed = 0;
for (const track of BUILTIN) {
  for (const arcade of [true, false]) {
    const spec = CARS[0];
    const built = buildTrack(track);
    const phys = new Physics(built);
    const s = built.path.cells[0];
    const xf = cellTransform(s.c, s.r, s.rot);
    const car = new Car(phys, spec, xf.point(new Vector3(-8, 1.2, 0)), xf.q, { arcade });
    const ap = new Autopilot(built.path);
    const cellIdx = new Map(built.path.cells.map((c, i) => [c.r * 16 + c.c, i]));
    const visited = new Set();
    let wasOff = false; const events = [];
    let t = 0, off = 0, turbos = 0, status = 'timeout';
    while (t < 120) {
      const a = ap.input(car);
      const cur = built.path.points[ap.i].type;
      const curvy = cur === 'curve' || cur === 'bank';
      car.update({ throttle: 1, brake: 0, steer: a.steer, handbrake: drift && curvy });
      if (car.turboEvent) { turbos++; car.turboEvent = 0; }
      phys.step();
      t += DT;
      const p = car.body.translation();
      const ci = cellIdx.get(Math.floor(p.z / T) * 16 + Math.floor(p.x / T));
      if (ci !== undefined) visited.add(ci);
      const isOff = ci === undefined || car.onGrass > 0.7;
      if (isOff) off += DT;
      if (isOff && !wasOff && events.length < 4) events.push(`${built.path.points[ap.i].type}#${ap.i}@${t.toFixed(1)}s v=${car.speed().toFixed(0)} up=${car.up(new Vector3()).y.toFixed(2)}`);
      wasOff = isOff;
      if (p.y < -5) { status = 'FELL'; break; }
      if (visited.size === built.path.cells.length && ci === 0) { status = 'ok'; break; }
    }
    // Easy tracks in arcade mode must be drivable flat out without ever braking
    if (arcade && track.level === 'Easy' && (status !== 'ok' || off > 3)) failed++;
    console.log(`${track.name.padEnd(14)} ${arcade ? 'arcade ' : 'classic'} ${status.padEnd(8)} t=${t.toFixed(1)}s visited=${visited.size}/${built.path.cells.length} offroad=${off.toFixed(1)}s turbos=${turbos}`);
    if (process.env.VERBOSE) console.log('   ', events.join(' | '));
    phys.free();
  }
}
console.log(`${failed} easy-track failure(s)`);
process.exit(failed ? 1 : 0);
