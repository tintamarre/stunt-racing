// Stunt score: every trick scores points, tricks chained within COMBO_TIME multiply
// (up to ×5) and are banked when the chain ends; crashing loses the chain.
import { DT } from './physics.js';

const COMBO_TIME = 2.5;
const MAX_MULT = 5;

export class Stunts {
  reset(pl) {
    pl.score = 0;
    pl.combo = { pts: 0, mult: 1, t: 0 };
    pl.driftT = 0;
  }

  // A trick done by a human racer: "+500 FLIP ×2"
  add(pl, name, pts) {
    if (pl.bot || !pl.combo) return;
    const c = pl.combo;
    pts = Math.round(pts / 10) * 10;
    c.pts += pts * c.mult;
    pl.hud.trick?.(`${name} +${pts}${c.mult > 1 ? ` ×${c.mult}` : ''}`);
    c.mult = Math.min(MAX_MULT, c.mult + 1);
    c.t = COMBO_TIME;
  }

  // Every physics step: drift scoring and the combo timer
  step(pl, racing) {
    if (pl.bot || !pl.combo) return;
    const car = pl.car;
    if (car.drift && car.contacts > 0) pl.driftT += DT;
    else if (pl.driftT > 0) {
      if (racing && pl.driftT > 0.6) this.add(pl, 'DRIFT', pl.driftT * 150);
      pl.driftT = 0;
    }
    const c = pl.combo;
    if (c.t > 0 && (c.t -= DT) <= 0) {
      pl.score += c.pts;
      if (c.mult > 2) pl.hud.trick?.(`COMBO +${c.pts}`, 'big');
      c.pts = 0;
      c.mult = 1;
    }
  }

  // Crash: the chain in progress is lost
  bail(pl) {
    if (!pl.combo || !pl.combo.pts) return;
    pl.hud.trick?.('COMBO LOST', 'lost');
    pl.combo = { pts: 0, mult: 1, t: 0 };
  }

  // Final score, banking a chain still running
  total(pl) {
    return (pl.score || 0) + (pl.combo?.pts || 0);
  }
}
