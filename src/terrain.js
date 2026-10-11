// Shared terrain height function (used by both rendering and physics).
import { T, GRID } from './track.js';
import { fbm } from './noise.js';

export { fbm };

export const FIELD = GRID * T; // playfield size
export const CENTER = FIELD / 2;
export const FLAT_MARGIN = 45;
export const TERRAIN_SIZE = 1500;
export const TERRAIN_SEGS = 150;

// Distance outside the flat playfield rectangle.
export function outside(x, z) {
  const dx = Math.max(-FLAT_MARGIN - x, 0, x - FIELD - FLAT_MARGIN);
  const dz = Math.max(-FLAT_MARGIN - z, 0, z - FIELD - FLAT_MARGIN);
  return Math.hypot(dx, dz);
}

// Relief of the current track inside the playfield (mountain tracks), or null when flat.
// It is a height grid computed by buildTrack (see track.js) and installed by whoever builds
// the world or the physics for that track.
let relief = null;
export function setRelief(r) {
  relief = r;
}
export const getRelief = () => relief;

function reliefAt(x, z) {
  const { x0, step, n, h } = relief;
  const fx = Math.min(n - 1.001, Math.max(0, (x - x0) / step));
  const fz = Math.min(n - 1.001, Math.max(0, (z - x0) / step));
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const a = h[j * n + i];
  const b = h[j * n + i + 1];
  const c = h[(j + 1) * n + i];
  const d = h[(j + 1) * n + i + 1];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function terrainHeight(x, z) {
  const d = outside(x, z);
  if (d <= 0) return relief ? reliefAt(x, z) : 0;
  const k = Math.min(1, d / 160);
  const ramp = k * k * (3 - 2 * k);
  return ramp * (8 + fbm(x * 0.008, z * 0.008) * 70) + Math.min(d, 40) * 0.05 * fbm(x * 0.05, z * 0.05);
}
