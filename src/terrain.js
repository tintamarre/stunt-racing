// Shared terrain height function (used by both rendering and physics).
import { T, GRID } from './track.js';

export const FIELD = GRID * T; // playfield size
export const CENTER = FIELD / 2;
export const FLAT_MARGIN = 45;
export const TERRAIN_SIZE = 1500;
export const TERRAIN_SEGS = 150;

function hash(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) & 0xffff) / 0xffff;
}
function vnoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, oct = 4) {
  let s = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}

// Distance outside the flat playfield rectangle.
export function outside(x, z) {
  const dx = Math.max(-FLAT_MARGIN - x, 0, x - FIELD - FLAT_MARGIN);
  const dz = Math.max(-FLAT_MARGIN - z, 0, z - FIELD - FLAT_MARGIN);
  return Math.hypot(dx, dz);
}

export function terrainHeight(x, z) {
  const d = outside(x, z);
  if (d <= 0) return 0;
  const k = Math.min(1, d / 160);
  const ramp = k * k * (3 - 2 * k);
  return ramp * (8 + fbm(x * 0.008, z * 0.008) * 70) + Math.min(d, 40) * 0.05 * fbm(x * 0.05, z * 0.05);
}
