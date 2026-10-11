// Obstacles: a glancing hit on a big wall keeps most of the speed, a head-on hit stops the car.
import { Vector3, Quaternion } from 'three';
import { BUILTIN } from '../src/tracks.js';
import { buildTrack } from '../src/track.js';
import { initPhysics, Physics, Car, CARS } from '../src/physics.js';

await initPhysics();
const built = buildTrack(BUILTIN.find((t) => t.name === 'Sunday Drive'));
const house = built.houses[0];
let failed = 0;
// Houses are axis-aligned boxes; aim at the face looking towards -x (normal -x).
// angle is the travel direction from +x, so 0 = head-on and 70° = 20° to the wall.
const run = (name, angle, check) => {
  const phys = new Physics(built);
  phys.trees.forEach((t) => t.col.setEnabled(false));
  const dir = new Vector3(Math.cos(angle), 0, Math.sin(angle));
  const half = Math.abs(Math.sin(house.rot)) > 0.5 ? 4 : 5;
  const hitPoint = new Vector3(house.x - half - 1.5, 0.9, house.z);
  const start = hitPoint.clone().addScaledVector(dir, -20);
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -angle);
  const car = new Car(phys, CARS[0], start, q, { arcade: true });
  car.body.setLinvel({ x: dir.x * 25, y: 0, z: dir.z * 25 }, true);
  for (let i = 0; i < 90; i++) {
    car.update({ throttle: 0, brake: 0, steer: 0, handbrake: false });
    phys.step();
  }
  const v = car.speed();
  const ok = check(v);
  if (!ok) failed++;
  console.log(`${name}: speed after 1.5 s = ${v.toFixed(1)} m/s ${ok ? 'ok' : 'FAIL'}`);
  phys.free();
};
run('glancing 20° to the wall', (70 * Math.PI) / 180, (v) => v > 12);
run('head-on', 0, (v) => v < 8);
process.exit(failed ? 1 : 0);
