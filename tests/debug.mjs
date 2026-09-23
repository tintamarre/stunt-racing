import { Vector3 } from 'three';
import { BUILTIN } from '../src/tracks.js';
import { buildTrack, cellTransform, T } from '../src/track.js';
import { initPhysics, Physics, Car, CARS, DT } from '../src/physics.js';
import { Autopilot } from '../src/autopilot.js';
await initPhysics();
const [ti, ci, types] = [+process.argv[2], +process.argv[3], process.argv[4].split(',')];
const built = buildTrack(BUILTIN[ti]);
const phys = new Physics(built);
const s = built.path.cells[0];
const xf = cellTransform(s.c, s.r, s.rot);
const car = new Car(phys, CARS[ci], xf.point(new Vector3(-8, 1.2, 0)), xf.q);
const ap = new Autopilot(built.path);
const cellIdx = new Map(built.path.cells.map((c, i) => [c.r * 16 + c.c, i]));
let n = 0;
for (let t = 0; t < 40; t += DT) {
  const inp = ap.input(car);
  car.update(inp);
  phys.step();
  const p = car.body.translation();
  const k = cellIdx.get(Math.floor(p.z / T) * 16 + Math.floor(p.x / T));
  const ty = k === undefined ? 'grass' : built.path.cells[k].type;
  if (types.includes(ty) && n++ % 3 === 0) {
    const up = car.up(new Vector3());
    console.log(t.toFixed(2), ty, 'p', p.x.toFixed(1), p.y.toFixed(1), p.z.toFixed(1), 'v', car.speed().toFixed(1), 'up', up.x.toFixed(2), up.y.toFixed(2), up.z.toFixed(2), 'c', car.contacts, 'in', inp.steer.toFixed(2), inp.throttle.toFixed(1), inp.brake.toFixed(1));
  }
}
