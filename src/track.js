// Track model: a GRID x GRID board of tiles, each holding a piece type and a rotation.
// This module is pure data + geometry (no rendering), so it also runs in Node for tests.
import { Vector3, Quaternion } from 'three';

export const T = 30; // tile size (m)
export const GRID = 16;
export const ROAD_W = 11;
const H = T / 2;

export const TYPES = [
  { id: 'empty', label: 'Grass', road: false },
  { id: 'straight', label: 'Straight', road: true },
  { id: 'start', label: 'Start / Finish', road: true },
  { id: 'curve', label: 'Curve', road: true },
  { id: 'bank', label: 'Banked curve', road: true },
  { id: 'ramp', label: 'Kicker ramp', road: true },
  { id: 'jump', label: 'Gap jump', road: true },
  { id: 'hump', label: 'Hump', road: true },
  { id: 'loop', label: 'Loop', road: true },
  { id: 'trees', label: 'Forest', road: false },
  { id: 'house', label: 'House', road: false },
  { id: 'boost', label: 'Boost pad', road: true },
];
export const TYPE_INDEX = Object.fromEntries(TYPES.map((t, i) => [t.id, i]));

const ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function emptyTrack(name = 'Untitled') {
  return { name, cells: Array.from({ length: GRID * GRID }, () => ({ t: 0, r: 0 })) };
}

export function encodeTrack(track) {
  return '1' + track.cells.map((c) => ALPH[c.t * 4 + c.r]).join('');
}

export function decodeTrack(code, name = 'Shared track') {
  if (!code || code[0] !== '1' || code.length !== GRID * GRID + 1) return null;
  const track = emptyTrack(name);
  for (let i = 0; i < GRID * GRID; i++) {
    const v = ALPH.indexOf(code[i + 1]);
    if (v < 0 || v >> 2 >= TYPES.length) return null;
    track.cells[i] = { t: v >> 2, r: v & 3 };
  }
  return track;
}

export const cellAt = (track, c, r) =>
  c < 0 || r < 0 || c >= GRID || r >= GRID ? null : track.cells[r * GRID + c];

// ---------------------------------------------------------------------------
// Edges & rotation. Local piece space: travel along +x, y up, z = right.
// On the board, x = column, z = row. Rotating by +90° about y maps W→S→E→N→W.
export const DIRS = { E: [1, 0], W: [-1, 0], N: [0, -1], S: [0, 1] };
const ROT_NEXT = { W: 'S', S: 'E', E: 'N', N: 'W' };
const OPP = { E: 'W', W: 'E', N: 'S', S: 'N' };
export function rotEdge(e, r) {
  for (let i = 0; i < r; i++) e = ROT_NEXT[e];
  return e;
}
export const HEADING_ROT = { E: 0, N: 1, W: 2, S: 3 };

// ---------------------------------------------------------------------------
// Piece definitions: each piece has two connectors (u=0 side, u=1 side),
// a list of ribbons (surfaces) and a centre line used for AI/respawn.
const v3 = (x, y, z) => new Vector3(x, y, z);
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.min(1, Math.max(0, t));

const straightS = (u) => ({ p: v3(-H + u * T, 0, 0) });
const curveS = (u) => {
  const a = (u * Math.PI) / 2;
  return { p: v3(-H + H * Math.sin(a), 0, H - H * Math.cos(a)) };
};

const BANK = (26 * Math.PI) / 180;
const bankS = (u) => {
  const s = curveS(u);
  const b = BANK * Math.sin(Math.PI * u) ** 2;
  const toC = v3(-H, 0, H).sub(s.p).setY(0).normalize();
  s.p.y = (ROAD_W / 2 + 1) * Math.sin(b) + 0.02;
  s.up = v3(0, Math.cos(b), 0).addScaledVector(toC, Math.sin(b));
  return s;
};

const RAMP_H = 3.2;
const RAMP_END = 6;
const rampS = (u) => {
  const x = -H + u * (RAMP_END + H);
  const t = u;
  return { p: v3(x, RAMP_H * (0.35 * t + 0.65 * t * t), 0) };
};
const rampCenter = (u) => {
  const x = -H + u * T;
  if (x > RAMP_END) return { p: v3(x, 0, 0) };
  return rampS((x + H) / (RAMP_END + H));
};

const JUMP_H = 2.6;
const JUMP_GAP = 4.5;
const jumpUp = (u) => ({ p: v3(-H + u * (H - JUMP_GAP), JUMP_H * (0.8 * u + 0.2 * u * u), 0) });
const jumpDown = (u) => ({ p: v3(JUMP_GAP + u * (H - JUMP_GAP), JUMP_H * (1 - smooth(u) * 0.5 - u * 0.5), 0) });
const jumpCenter = (u) => {
  const x = -H + u * T;
  if (x < -JUMP_GAP) return jumpUp((x + H) / (H - JUMP_GAP));
  if (x > JUMP_GAP) return jumpDown((x - JUMP_GAP) / (H - JUMP_GAP));
  return { p: v3(x, JUMP_H, 0) };
};

const HUMP_H = 2.4;
const humpS = (u) => ({ p: v3(-H + u * T, HUMP_H * Math.sin(Math.PI * u) ** 2, 0) });

// Loop: lead-in (shifts sideways), a full circle drifting laterally, lead-out.
export const LOOP_R = 12;
const LOOP_C = 7;
const LOOP_LEN = [H, 2 * Math.PI * LOOP_R, H];
const LOOP_TOTAL = LOOP_LEN[0] + LOOP_LEN[1] + LOOP_LEN[2];
const loopS = (u) => {
  let d = u * LOOP_TOTAL;
  if (d <= LOOP_LEN[0]) {
    const t = d / H;
    return { p: v3(-H + d, 0, -LOOP_C * smooth(t)) };
  }
  d -= LOOP_LEN[0];
  if (d <= LOOP_LEN[1]) {
    const th = d / LOOP_R;
    return {
      p: v3(LOOP_R * Math.sin(th), LOOP_R * (1 - Math.cos(th)), -LOOP_C * Math.cos(th / 2)),
      up: v3(-Math.sin(th), Math.cos(th), 0),
    };
  }
  d -= LOOP_LEN[1];
  const t = d / H;
  return { p: v3(d, 0, LOOP_C * (1 - smooth(t))) };
};

export const PIECES = {
  straight: { conn: ['W', 'E'], ribbons: [{ s: straightS, len: T }], center: straightS },
  start: { conn: ['W', 'E'], ribbons: [{ s: straightS, len: T }], center: straightS },
  boost: { conn: ['W', 'E'], ribbons: [{ s: straightS, len: T }], center: straightS },
  curve: { conn: ['W', 'S'], ribbons: [{ s: curveS, len: (Math.PI * H) / 2, curbs: true }], center: curveS },
  bank: { conn: ['W', 'S'], ribbons: [{ s: bankS, len: (Math.PI * H) / 2, curbs: true, solid: true, rails: 'outer' }], center: bankS },
  ramp: { conn: ['W', 'E'], ribbons: [{ s: rampS, len: RAMP_END + H, solid: true, stripes: true }], center: rampCenter },
  jump: {
    conn: ['W', 'E'],
    ribbons: [
      { s: jumpUp, len: H - JUMP_GAP, solid: true, stripes: true },
      { s: jumpDown, len: H - JUMP_GAP, solid: true, stripes: true },
    ],
    center: jumpCenter,
  },
  hump: { conn: ['W', 'E'], ribbons: [{ s: humpS, len: T, solid: true }], center: humpS },
  loop: { conn: ['W', 'E'], ribbons: [{ s: loopS, len: LOOP_TOTAL, rails: true, step: 0.8 }], center: loopS },
};

function frameOf(sampler, u) {
  const a = sampler(u);
  const e = 1e-3;
  const f = sampler(Math.min(1, u + e)).p.sub(sampler(Math.max(0, u - e)).p).normalize();
  const up = a.up ? a.up.clone() : v3(0, 1, 0);
  const right = new Vector3().crossVectors(f, up).normalize();
  up.crossVectors(right, f).normalize();
  return { p: a.p, f, up, right };
}

export function cellTransform(c, r, rot) {
  const q = new Quaternion().setFromAxisAngle(v3(0, 1, 0), (rot * Math.PI) / 2);
  const o = v3(c * T + H, 0, r * T + H);
  return {
    q,
    o,
    point: (p) => p.clone().applyQuaternion(q).add(o),
    dir: (d) => d.clone().applyQuaternion(q),
  };
}

export function worldFrame(sampler, u, xf) {
  const fr = frameOf(sampler, u);
  return { p: xf.point(fr.p), f: xf.dir(fr.f), up: xf.dir(fr.up), right: xf.dir(fr.right) };
}

// ---------------------------------------------------------------------------
// Ordered driving path from the start tile.
export function tracePath(track) {
  let start = -1;
  track.cells.forEach((c, i) => {
    if (c.t === TYPE_INDEX.start && start < 0) start = i;
  });
  if (start < 0) return null;
  const cells = [];
  let c = start % GRID;
  let r = Math.floor(start / GRID);
  const sc = track.cells[start];
  let out = rotEdge('E', sc.r);
  cells.push({ c, r, idx: start, forward: true, type: TYPES[sc.t].id, rot: sc.r });
  const seen = new Set([start]);
  let closed = false;
  for (;;) {
    const nc = c + DIRS[out][0];
    const nr = r + DIRS[out][1];
    const cell = cellAt(track, nc, nr);
    if (!cell || !TYPES[cell.t].road) break;
    const piece = PIECES[TYPES[cell.t].id];
    const entry = OPP[out];
    const c0 = rotEdge(piece.conn[0], cell.r);
    const c1 = rotEdge(piece.conn[1], cell.r);
    let forward;
    if (entry === c0) forward = true;
    else if (entry === c1) forward = false;
    else break;
    const idx = nr * GRID + nc;
    if (idx === start) {
      closed = forward;
      break;
    }
    if (seen.has(idx)) break;
    seen.add(idx);
    cells.push({ c: nc, r: nr, idx, forward, type: TYPES[cell.t].id, rot: cell.r });
    out = forward ? c1 : c0;
    c = nc;
    r = nr;
  }
  // Dense centre line for AI / respawn.
  const points = [];
  cells.forEach((pc, ci) => {
    const piece = PIECES[pc.type];
    const xf = cellTransform(pc.c, pc.r, pc.rot);
    const len = piece.ribbons.reduce((a, rb) => a + rb.len, 0) + (pc.type === 'jump' ? JUMP_GAP * 2 : 0);
    const n = Math.max(6, Math.ceil(len / 2));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const u = pc.forward ? t : 1 - t;
      const fr = worldFrame(piece.center, u, xf);
      if (!pc.forward) fr.f.negate();
      points.push({ p: fr.p, f: fr.f, up: fr.up, cell: ci, type: pc.type, u: t });
    }
  });
  return { cells, points, closed };
}

// ---------------------------------------------------------------------------
// Geometry. Surfaces are grouped by material; everything solid also goes into
// the collision soup.
class Soup {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.idx = [];
  }
  vert(p, u = 0, v = 0) {
    this.pos.push(p.x, p.y, p.z);
    this.uv.push(u, v);
    return this.pos.length / 3 - 1;
  }
  quad(a, b, c, d, uvs = [0, 0, 1, 0, 1, 1, 0, 1]) {
    const i = this.vert(a, uvs[0], uvs[1]);
    this.vert(b, uvs[2], uvs[3]);
    this.vert(c, uvs[4], uvs[5]);
    this.vert(d, uvs[6], uvs[7]);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
}

function mulberry(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildTrack(track) {
  const S = {
    road: new Soup(),
    curb: new Soup(),
    concrete: new Soup(),
    stripes: new Soup(),
    rail: new Soup(),
    checker: new Soup(),
    boost: new Soup(),
  };
  const col = new Soup();
  const props = []; // { kind, pos, rot, ... }
  const trees = [];
  const houses = [];
  const boostZones = [];
  const loops = [];
  const rand = mulberry(1234567);

  const edge = (fr, off, lift = 0) => fr.p.clone().addScaledVector(fr.right, off).addScaledVector(fr.up, lift);
  const ground = (p) => v3(p.x, -0.4, p.z);

  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const cell = track.cells[r * GRID + c];
      const type = TYPES[cell.t].id;
      const xf = cellTransform(c, r, cell.r);
      const piece = PIECES[type];
      if (piece) {
        for (const rb of piece.ribbons) {
          const n = Math.max(4, Math.ceil(rb.len / (rb.step || 1.5)));
          const frames = [];
          for (let i = 0; i <= n; i++) frames.push(worldFrame(rb.s, i / n, xf));
          const ext = ROAD_W / 2 + (rb.curbs ? 1.2 : 0);
          let dist = 0;
          for (let i = 0; i < n; i++) {
            const A = frames[i];
            const B = frames[i + 1];
            const d0 = dist;
            dist += A.p.distanceTo(B.p);
            const v0 = d0 / ROAD_W;
            const v1 = dist / ROAD_W;
            const lift = 0.03;
            const q = [edge(A, -ROAD_W / 2, lift), edge(A, ROAD_W / 2, lift), edge(B, ROAD_W / 2, lift), edge(B, -ROAD_W / 2, lift)];
            S.road.quad(...q, [0, v0, 1, v0, 1, v1, 0, v1]);
            col.quad(...q);
            if (rb.curbs) {
              for (const s of [-1, 1]) {
                const a0 = (s * ROAD_W) / 2;
                const a1 = s * ext;
                const cq = [edge(A, a0, lift + 0.02), edge(A, a1, lift + 0.08), edge(B, a1, lift + 0.08), edge(B, a0, lift + 0.02)];
                S.curb.quad(...cq, [0, d0 / 4, 1, d0 / 4, 1, dist / 4, 0, dist / 4]);
                col.quad(...cq);
              }
            }
            if (rb.rails) {
              // On a curve the -right side is the outside
              for (const s of rb.rails === 'outer' ? [-1] : [-1, 1]) {
                const e0 = edge(A, (s * ROAD_W) / 2, 0);
                const e1 = edge(B, (s * ROAD_W) / 2, 0);
                const rq = [e0, e1, edge(B, (s * ROAD_W) / 2, 0.9), edge(A, (s * ROAD_W) / 2, 0.9)];
                S.rail.quad(...rq, [d0 / 3, 0, dist / 3, 0, dist / 3, 1, d0 / 3, 1]);
                col.quad(...rq);
              }
            }
            if (rb.solid) {
              const mat = rb.stripes ? S.stripes : S.concrete;
              for (const s of [-1, 1]) {
                const ea = edge(A, s * ext, 0);
                const eb = edge(B, s * ext, 0);
                if (ea.y < 0.08 && eb.y < 0.08) continue;
                const sq = s > 0 ? [ea, ground(ea), ground(eb), eb] : [eb, ground(eb), ground(ea), ea];
                mat.quad(...sq, [d0 / 4, ea.y / 4, d0 / 4, 0, dist / 4, 0, dist / 4, eb.y / 4]);
                col.quad(...sq);
              }
            }
          }
          if (rb.solid) {
            for (const [fr, s] of [[frames[0], -1], [frames[n], 1]]) {
              const l = edge(fr, -ext, 0);
              const rr = edge(fr, ext, 0);
              if (l.y < 0.08 && rr.y < 0.08) continue;
              const cq = s > 0 ? [l, rr, ground(rr), ground(l)] : [rr, l, ground(l), ground(rr)];
              S.concrete.quad(...cq, [0, l.y / 4, 1, rr.y / 4, 1, 0, 0, 0]);
              col.quad(...cq);
            }
          }
        }
        // Piece extras
        if (type === 'start') {
          const a = worldFrame(straightS, 0.5, xf);
          const b = worldFrame(straightS, 0.5 + 2 / T, xf);
          S.checker.quad(edge(a, -ROAD_W / 2, 0.05), edge(a, ROAD_W / 2, 0.05), edge(b, ROAD_W / 2, 0.05), edge(b, -ROAD_W / 2, 0.05), [0, 0, 8, 0, 8, 1, 0, 1]);
          props.push({ kind: 'gantry', pos: a.p, q: xf.q });
        }
        if (type === 'boost') {
          const a = worldFrame(straightS, 0.25, xf);
          const b = worldFrame(straightS, 0.75, xf);
          S.boost.quad(edge(a, -3, 0.05), edge(a, 3, 0.05), edge(b, 3, 0.05), edge(b, -3, 0.05), [0, 0, 1, 0, 1, 5, 0, 5]);
          boostZones.push({ c, r, dir: xf.dir(v3(1, 0, 0)) });
        }
        if (type === 'loop') loops.push({ c, r });
        if (type === 'loop') props.push({ kind: 'loopTowers', pos: xf.o.clone(), q: xf.q });
        if (type === 'bank' || type === 'jump' || type === 'ramp') props.push({ kind: 'flags', pos: xf.o.clone(), q: xf.q, type });
      } else {
        // Scenery
        const cx = c * T + H;
        const cz = r * T + H;
        const nTrees = type === 'trees' ? 7 + Math.floor(rand() * 6) : type === 'house' ? 2 : rand() < 0.35 ? 1 + Math.floor(rand() * 3) : 0;
        for (let i = 0; i < nTrees; i++) {
          trees.push({ x: cx + (rand() - 0.5) * (T - 6), z: cz + (rand() - 0.5) * (T - 6), s: 0.7 + rand() * 0.7, k: rand() });
        }
        if (type === 'house') {
          houses.push({ x: cx + (rand() - 0.5) * 4, z: cz + (rand() - 0.5) * 4, rot: Math.floor(rand() * 4) * (Math.PI / 2), k: rand() });
        }
      }
    }
  }
  // Keep trees off houses
  const treesFiltered = trees.filter((t) => !houses.some((h) => Math.hypot(t.x - h.x, t.z - h.z) < 8));
  return { surfaces: S, collision: col, props, trees: treesFiltered, houses, boostZones, loops, path: tracePath(track) };
}
