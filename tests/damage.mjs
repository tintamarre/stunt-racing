// Visual damage: a car driven head-on into a house gets dented and loses a part;
// a car cruising on the road takes no damage. Damage never touches the physics.
import { Vector3, Quaternion, Group } from 'three';
import { BUILTIN } from '../src/tracks.js';
import { buildTrack } from '../src/track.js';
import { initPhysics, Physics, Car, CARS } from '../src/physics.js';
import { CarModel } from '../src/car.js';
import { Damage } from '../src/damage.js';

await initPhysics();
const built = buildTrack(BUILTIN.find((t) => t.name === 'Sunday Drive'));
const house = built.houses[0];
const fx = { particles: { emit() {} }, audio: {} };
let failed = 0;
for (const [name, speed, expectHit] of [['head-on into a house', 30, true], ['gentle roll', 4, false]]) {
  const phys = new Physics(built);
  phys.trees.forEach((t) => t.col.setEnabled(false));
  const half = Math.abs(Math.sin(house.rot)) > 0.5 ? 4 : 5;
  const car = new Car(phys, CARS[0], new Vector3(house.x - half - 25, 0.9, house.z), new Quaternion(), { arcade: true });
  car.body.setLinvel({ x: speed, y: 0, z: 0 }, true);
  const scene = new Group();
  const model = new CarModel(CARS[0]);
  scene.add(model.group);
  const racer = { car, model };
  const dmg = new Damage(racer, fx);
  const hull = model.damageParts().hull[0];
  const before = Float32Array.from(hull.geometry.attributes.position.array);
  for (let i = 0; i < 120; i++) {
    car.update({ throttle: 0, brake: 0, steer: 0, handbrake: false });
    phys.step();
    const p = car.body.translation();
    const r = car.body.rotation();
    model.group.position.set(p.x, p.y, p.z);
    model.group.quaternion.set(r.x, r.y, r.z, r.w);
    dmg.step();
    dmg.update(1 / 60);
  }
  const after = hull.geometry.attributes.position.array;
  const dented = after.some((v, i) => Math.abs(v - before[i]) > 1e-4);
  const flew = (model.debris || []).length > 0;
  const ok = expectHit ? dmg.level > 0 && dented && flew : dmg.level === 0 && !dented;
  if (!ok) failed++;
  console.log(`${name}: level=${dmg.level.toFixed(2)} dented=${dented} parts=${(model.debris || []).length} ${ok ? 'ok' : 'FAIL'}`);
  dmg.reset();
  const restored = model.damageParts().loose.every((p) => p.obj.parent === p.parent) && hull.geometry.attributes.position.array.every((v, i) => v === before[i]);
  if (!restored) failed++;
  console.log(`  repaired: ${restored ? 'ok' : 'FAIL'}`);
  phys.free();
}
process.exit(failed ? 1 : 0);
