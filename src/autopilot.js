// Simple pure-pursuit driver used for the attract mode and physics tests.
import { Vector3 } from 'three';

const tmp = new Vector3();

export class Autopilot {
  constructor(path) {
    this.path = path;
    this.i = 0;
  }

  reset() {
    this.i = 0;
  }

  input(car) {
    const pts = this.path.points;
    const N = pts.length;
    const bp = car.body.translation();
    const pos = new Vector3(bp.x, bp.y, bp.z);
    // Track progress along the centre line
    let best = this.i;
    let bestD = Infinity;
    for (let k = 0; k < 40; k++) {
      const j = (this.i + k) % N;
      const d = pts[j].p.distanceToSquared(pos);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    this.i = best;
    const speed = car.speed();
    const look = 5 + speed * 0.28;
    let j = best;
    let acc = 0;
    while (acc < look) {
      const n = (j + 1) % N;
      if (!this.path.closed && n === 0) break;
      acc += pts[j].p.distanceTo(pts[n].p);
      j = n;
    }
    const target = pts[j].p;
    const fwd = car.forward(new Vector3());
    const right = car.right(new Vector3());
    tmp.copy(target).sub(pos);
    const ang = Math.atan2(tmp.dot(right), tmp.dot(fwd));

    // Target speed from what's coming up
    let vt = 60;
    let dist = 0;
    for (let k = best; dist < 70; k = (k + 1) % N) {
      const n = (k + 1) % N;
      dist += pts[k].p.distanceTo(pts[n].p);
      const ty = pts[k].type;
      if (ty === 'curve') vt = Math.min(vt, 17 + dist * 0.25);
      if (ty === 'bank') vt = Math.min(vt, 21 + dist * 0.25);
      if (ty === 'ramp' || ty === 'jump') vt = Math.min(vt, 30 + dist * 0.3);
      if (n === best) break;
    }
    if (pts[best].type === 'loop') vt = 60;
    const fspeed = tmp.set(car.body.linvel().x, car.body.linvel().y, car.body.linvel().z).dot(fwd);
    const err = vt - fspeed;
    return {
      steer: Math.max(-1, Math.min(1, ang * 2.8)),
      throttle: err > 0 ? Math.min(1, err / 4) : 0,
      brake: err < -3 ? Math.min(1, -err / 8) : 0,
      handbrake: false,
    };
  }
}
