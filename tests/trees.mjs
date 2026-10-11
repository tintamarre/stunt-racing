// Breakable trees: a fast car snaps a tree and keeps going (a bit slower); a slow car is stopped.
import { Vector3, Quaternion } from 'three';
import { BUILTIN } from '../src/tracks.js';
import { buildTrack } from '../src/track.js';
import { initPhysics, Physics, Car, CARS, DT, TREE_SNAP_SPEED } from '../src/physics.js';

await initPhysics();
const built = buildTrack(BUILTIN[0]);
let failed = 0;
for (const v0 of [TREE_SNAP_SPEED + 20, TREE_SNAP_SPEED - 3]) {
  const phys = new Physics(built);
  const ti = phys.trees.findIndex((t) => phys.trees.every((o) => o === t || Math.hypot(o.x - t.x, o.z - t.z) > 6 || Math.abs(o.z - t.z) > 3));
  const tree = phys.trees[ti];
  const car = new Car(phys, CARS[0], new Vector3(tree.x - 14, 0.9, tree.z), new Quaternion(), { arcade: true });
  car.body.setLinvel({ x: v0, y: 0, z: 0 }, true);
  let broke = 0;
  let passed = false;
  for (let i = 0; i < 120; i++) {
    car.update({ throttle: 0, brake: 0, steer: 0, handbrake: false });
    broke += phys.smashTrees(car).length;
    phys.step();
    if (car.body.translation().x > tree.x + 4) passed = true;
  }
  const fast = v0 > TREE_SNAP_SPEED;
  const ok = fast ? broke > 0 && passed : broke === 0 && !passed;
  if (!ok) failed++;
  console.log(`v0=${v0} m/s broke=${broke} passed=${passed} speed=${car.speed().toFixed(1)} ${ok ? 'ok' : 'FAIL'}`);
  phys.free();
}
process.exit(failed ? 1 : 0);
