// Drive into the first loop of a track at a given speed and report whether the car makes it through.
import { Vector3 } from 'three';
import { BUILTIN } from '../src/tracks.js';
import { buildTrack, T } from '../src/track.js';
import { initPhysics, Physics, Car, CARS, DT } from '../src/physics.js';
import { Autopilot } from '../src/autopilot.js';
import { Quaternion, Matrix4 } from 'three';
await initPhysics();
const built = buildTrack(BUILTIN[2]);
for (const v0 of [15, 20, 25, 35, 45, 58]) {
  for (const spec of CARS) {
    const phys = new Physics(built);
    const pts = built.path.points;
    const k = pts.findIndex((p) => p.type === 'loop');
    const p = pts[k - 8];
    const z = new Vector3().crossVectors(p.f, p.up);
    const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(p.f, p.up, z));
    const car = new Car(phys, spec, p.p.clone().add(new Vector3(0, 0.8, 0)), q);
    car.body.setLinvel({ x: p.f.x * v0, y: 0, z: p.f.z * v0 }, true);
    const ap = new Autopilot(built.path);
    ap.i = k - 8;
    let maxY = 0, out = 'stuck';
    for (let t = 0; t < 8; t += DT) {
      car.update({ ...ap.input(car), throttle: 1, brake: 0 });
      phys.step();
      const b = car.body.translation();
      maxY = Math.max(maxY, b.y);
      const cell = built.path.cells[built.path.points[k].cell];
      if (Math.floor(b.x / T) > cell.c) { out = car.up(new Vector3()).y > 0.8 ? 'through' : 'through-flipped'; break; }
      if (b.y < -5) { out = 'fell'; break; }
    }
    console.log(`v0=${v0} ${spec.name.padEnd(11)} ${out.padEnd(16)} maxY=${maxY.toFixed(1)}`);
    phys.free();
  }
}
