// Tunnels are solid: a car dropped on top lands on the hill, one driven at its side bounces off.
import { Vector3, Quaternion } from 'three';
import { BUILTIN } from '../src/tracks.js';
import { buildTrack, cellTransform } from '../src/track.js';
import { initPhysics, Physics, Car, CARS } from '../src/physics.js';

await initPhysics();
const track = BUILTIN.find((t) => t.name === 'River Run');
const built = buildTrack(track);
const tc = built.path.cells.find((c) => c.type === 'tunnel');
const xf = cellTransform(tc.c, tc.r, tc.rot);
let failed = 0;
const run = (name, pos, vel, check, steps = 240) => {
  const phys = new Physics(built);
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(-vel.z, vel.x));
  const car = new Car(phys, CARS[0], pos, q, { arcade: true });
  car.body.setLinvel(vel, true);
  for (let i = 0; i < steps; i++) {
    car.update({ throttle: 0, brake: 0, steer: 0, handbrake: false });
    phys.step();
  }
  const p = car.body.translation();
  const local = new Vector3(p.x, p.y, p.z).sub(xf.o).applyQuaternion(xf.q.clone().invert());
  const ok = check(local);
  if (!ok) failed++;
  console.log(`${name}: local=(${local.x.toFixed(1)}, ${local.y.toFixed(1)}, ${local.z.toFixed(1)}) ${ok ? 'ok' : 'FAIL'}`);
  phys.free();
};
// Dropped from 25 m onto the ridge right above the bore: lands on the hill instead of falling into the tunnel
run('drop on top', xf.point(new Vector3(0, 25, 0)), { x: 0, y: 0, z: 0 }, (l) => l.y > 10, 90);
// Driven sideways into the hill at 20 m/s from 30 m away: must not end up inside the bore
const side = xf.dir(new Vector3(0, 0, -1));
run('side hit', xf.point(new Vector3(0, 1, 30)), { x: side.x * 20, y: 0, z: side.z * 20 }, (l) => Math.abs(l.z) > 7 || l.y > 3);
process.exit(failed ? 1 : 0);
