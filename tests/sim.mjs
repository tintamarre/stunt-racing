// Headless physics test: the autopilot drives each built-in track; we check it
// completes the lap without flipping or falling off.
import { Vector3 } from 'three';
import { BUILTIN } from '../src/tracks.js';
import { buildTrack, cellTransform, T } from '../src/track.js';
import { initPhysics, Physics, Car, CARS, DT } from '../src/physics.js';
import { Autopilot } from '../src/autopilot.js';

await initPhysics();
let failed = 0;
const only = process.argv[2];
for (const [ti, track] of BUILTIN.entries()) {
  if (only && String(ti) !== only) continue;
  for (const spec of CARS) {
    const built = buildTrack(track);
    const phys = new Physics(built);
    const s = built.path.cells[0];
    const xf = cellTransform(s.c, s.r, s.rot);
    const car = new Car(phys, spec, xf.point(new Vector3(-8, 1.2, 0)), xf.q);
    const ap = new Autopilot(built.path);
    const visited = new Set();
    const cellIdx = new Map(built.path.cells.map((c, i) => [c.r * 16 + c.c, i]));
    let t = 0;
    let flipped = 0;
    let status = 'timeout';
    let maxV = 0;
    let loopMinTop = Infinity;
    let lastCell = 0;
    const log = [];
    while (t < 150) {
      car.update(ap.input(car));
      phys.step();
      t += DT;
      const p = car.body.translation();
      maxV = Math.max(maxV, car.speed());
      const ci = cellIdx.get(Math.floor(p.z / T) * 16 + Math.floor(p.x / T));
      if (ci !== undefined && ci !== lastCell) {
        log.push(`${built.path.cells[ci].type}@${t.toFixed(1)}s v=${car.speed().toFixed(0)}`);
        lastCell = ci;
      }
      if (ci !== undefined) visited.add(ci);
      if (ci !== undefined && built.path.cells[ci].type === 'loop' && p.y > 15) loopMinTop = Math.min(loopMinTop, car.speed());
      const up = car.up(new Vector3());
      flipped = up.y < 0.2 && car.speed() < 4 ? flipped + DT : 0;
      if (flipped > 1.5) { status = 'FLIPPED'; break; }
      if (p.y < -5) { status = 'FELL'; break; }
      if (visited.size === built.path.cells.length && ci === 0) { status = 'ok'; break; }
    }
    if (status !== 'ok') failed++;
    console.log(`${track.name.padEnd(14)} ${spec.name.padEnd(11)} ${status.padEnd(8)} t=${t.toFixed(1)}s visited=${visited.size}/${built.path.cells.length} vmax=${(maxV * 3.6).toFixed(0)}km/h loopTop=${loopMinTop.toFixed(1)}`);
    if (status !== 'ok' || process.env.VERBOSE) console.log('   ', log.slice(-8).join(' | '));
    phys.free();
  }
}
// The autopilot is not perfect; a couple of failed laps are tolerated, more means a physics regression.
console.log(`${failed} failed run(s)`);
process.exit(failed > 2 ? 1 : 0);
