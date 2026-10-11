// Track model: a GRID x GRID board of tiles, each holding a piece type and a rotation.
// This module is pure data + geometry (no rendering), so it also runs in Node for tests.
import { Vector3, Quaternion, Shape, Path, ExtrudeGeometry } from 'three';

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
  { id: 'wide', label: 'Wide curve', road: true },
  { id: 'bridge', label: 'Bridge', road: true },
  { id: 'tunnel', label: 'Tunnel', road: true },
  { id: 'sweep', label: 'Sweeping curve', road: true },
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
const RIGHT_OF = { E: 'S', S: 'W', W: 'N', N: 'E' };

// Board offset (columns, rows) of a piece-local cell offset (dx along travel, dz to the right).
export function localToGrid(rot, dx, dz) {
  const hx = rotEdge('E', rot);
  const hz = RIGHT_OF[hx];
  return [dx * DIRS[hx][0] + dz * DIRS[hz][0], dx * DIRS[hx][1] + dz * DIRS[hz][1]];
}

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

// Wide curve: a quarter circle of radius 1.5 tiles spanning a 2x2 block (the inner cell stays free).
const WIDE_R = 1.5 * T;
const wideS = (u) => {
  const a = (u * Math.PI) / 2;
  return { p: v3(-H + WIDE_R * Math.sin(a), 0, H + T - WIDE_R * Math.cos(a)) };
};

// Sweeping curve: radius 2.5 tiles over a 3x3 block
const SWEEP_R = 2.5 * T;
const sweepS = (u) => {
  const a = (u * Math.PI) / 2;
  return { p: v3(-H + SWEEP_R * Math.sin(a), 0, H + 2 * T - SWEEP_R * Math.cos(a)) };
};

// Humpback bridge over a stream
export const BRIDGE_H = 2.2;
const bridgeS = (u) => ({ p: v3(-H + u * T, BRIDGE_H * Math.sin(Math.PI * u) ** 2, 0) });

export const TUNNEL_HW = 7.2; // half width of the tunnel bore (arch radius)
export const TUNNEL_WALL = 3.5; // height where the arch starts

// Tunnel tile in local space: a hill with a bore (mound) and the concrete lining (tube).
// Shared by the renderer and the collision mesh, so the hill is solid from every side.
let tunnelGeo = null;
export function tunnelGeometry() {
  if (tunnelGeo) return tunnelGeo;
  const arch = (r, shape) => {
    shape.moveTo(-r, -0.6);
    shape.lineTo(-r, TUNNEL_WALL);
    shape.absarc(0, TUNNEL_WALL, r, Math.PI, 0, true);
    shape.lineTo(r, -0.6);
    shape.lineTo(-r, -0.6);
    return shape;
  };
  const extrude = (shape) => {
    const geo = new ExtrudeGeometry(shape, { depth: T, bevelEnabled: false, curveSegments: 20 });
    // shape (x, y) + depth z  ->  local (depth - T/2, y, x)
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getZ(i) - T / 2, pos.getY(i), pos.getX(i));
    geo.computeVertexNormals();
    return geo;
  };
  const hill = new Shape();
  const HW = T / 2 + 0.5;
  hill.moveTo(-HW, -1);
  for (let i = 0; i <= 24; i++) {
    const z = -HW + (2 * HW * i) / 24;
    const k = 1 - (z / HW) ** 2;
    hill.lineTo(z, 0.2 + 13 * k ** 0.6 + Math.sin(i * 1.7) * 0.5 * k);
  }
  hill.lineTo(HW, -1);
  hill.lineTo(-HW, -1);
  hill.holes.push(arch(TUNNEL_HW + 0.7, new Path()));
  const ring = arch(TUNNEL_HW + 0.7, new Shape());
  ring.holes.push(arch(TUNNEL_HW, new Path()));
  tunnelGeo = { mound: extrude(hill), tube: extrude(ring) };
  return tunnelGeo;
}
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
  wide: {
    conn: ['W', 'S'],
    exit: [1, 1], // the S connector belongs to the cell diagonally ahead-right
    cover: [[0, 0], [1, 0], [1, 1]],
    ribbons: [{ s: wideS, len: (Math.PI * WIDE_R) / 2, curbs: true }],
    center: wideS,
  },
  sweep: {
    conn: ['W', 'S'],
    exit: [2, 2],
    cover: [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]],
    ribbons: [{ s: sweepS, len: (Math.PI * SWEEP_R) / 2, curbs: true }],
    center: sweepS,
  },
  bridge: { conn: ['W', 'E'], ribbons: [{ s: bridgeS, len: T + 1, rails: true, deck: true }], center: bridgeS },
  tunnel: { conn: ['W', 'E'], ribbons: [{ s: straightS, len: T }], center: straightS },
};

// Which board cells each road piece occupies: grid index -> { anchor, piece, rot, ends: [[c, r, edge] x2], covers }
export function occupancy(track) {
  const occ = new Map();
  const multi = [];
  track.cells.forEach((cell, i) => {
    const type = TYPES[cell.t].id;
    const piece = PIECES[type];
    if (!piece) return;
    const c = i % GRID;
    const r = Math.floor(i / GRID);
    const at = ([dx, dz]) => {
      const [dc, dr] = localToGrid(cell.r, dx, dz);
      return [c + dc, r + dr];
    };
    const [ec, er] = at(piece.exit || [0, 0]);
    const covers = (piece.cover || [[0, 0]]).map(at).filter(([cc, rr]) => cc >= 0 && rr >= 0 && cc < GRID && rr < GRID);
    const o = {
      anchor: i,
      c,
      r,
      type,
      piece,
      rot: cell.r,
      ends: [
        [c, r, rotEdge(piece.conn[0], cell.r)],
        [ec, er, rotEdge(piece.conn[1], cell.r)],
      ],
      covers: covers.map(([cc, rr]) => rr * GRID + cc),
    };
    if (piece.cover) multi.push(o);
    else occ.set(i, o);
  });
  // Multi-cell pieces win over whatever sits under them
  for (const o of multi) for (const k of o.covers) occ.set(k, o);
  return occ;
}

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
  const occ = occupancy(track);
  const cells = [];
  let c = start % GRID;
  let r = Math.floor(start / GRID);
  const sc = track.cells[start];
  let out = rotEdge('E', sc.r);
  cells.push({ c, r, idx: start, forward: true, type: TYPES[sc.t].id, rot: sc.r, covers: [start] });
  const seen = new Set([start]);
  let closed = false;
  for (;;) {
    const nc = c + DIRS[out][0];
    const nr = r + DIRS[out][1];
    if (nc < 0 || nr < 0 || nc >= GRID || nr >= GRID) break;
    const o = occ.get(nr * GRID + nc);
    if (!o) break;
    const entry = OPP[out];
    const [e0, e1] = o.ends;
    let forward;
    if (e0[0] === nc && e0[1] === nr && e0[2] === entry) forward = true;
    else if (e1[0] === nc && e1[1] === nr && e1[2] === entry) forward = false;
    else break;
    const idx = o.anchor;
    if (idx === start) {
      closed = forward;
      break;
    }
    if (seen.has(idx)) break;
    seen.add(idx);
    cells.push({ c: o.c, r: o.r, idx, forward, type: o.type, rot: o.rot, covers: o.covers });
    const ex = forward ? e1 : e0;
    out = ex[2];
    c = ex[0];
    r = ex[1];
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
  const blocks = []; // extra box colliders { pos, q, half }
  const water = []; // stream strips under bridges { pos, q, len }
  const rand = mulberry(1234567);
  const occ = occupancy(track);
  const wet = new Set();
  // Streams run under each bridge, across the road, through free neighbouring cells
  track.cells.forEach((cell, i) => {
    if (TYPES[cell.t].id !== 'bridge') return;
    const c = i % GRID;
    const r = Math.floor(i / GRID);
    let lo = 0;
    let hi = 0;
    const free = (k) => {
      const [dc, dr] = localToGrid(cell.r, 0, k);
      const cc = cellAt(track, c + dc, r + dr);
      return cc && !TYPES[cc.t].road && !occ.has((r + dr) * GRID + c + dc);
    };
    while (lo < 2 && free(-lo - 1)) lo++;
    while (hi < 2 && free(hi + 1)) hi++;
    for (let k = -lo; k <= hi; k++) {
      const [dc, dr] = localToGrid(cell.r, 0, k);
      wet.add((r + dr) * GRID + c + dc);
    }
    const xf = cellTransform(c, r, cell.r);
    water.push({ pos: xf.point(v3(0, 0, ((hi - lo) * T) / 2)), q: xf.q, len: (lo + hi + 1) * T - 4 });
  });

  const edge = (fr, off, lift = 0) => fr.p.clone().addScaledVector(fr.right, off).addScaledVector(fr.up, lift);
  const ground = (p) => v3(p.x, -0.4, p.z);

  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const cell = track.cells[r * GRID + c];
      const type = TYPES[cell.t].id;
      const xf = cellTransform(c, r, cell.r);
      const piece = PIECES[type];
      const under = occ.get(r * GRID + c);
      if (under && under.anchor !== r * GRID + c) continue; // covered by a multi-cell piece
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
            if (rb.deck) {
              // Bridge deck: underside and edges, 0.7 m thick
              const dA = (o) => edge(A, o, -0.7);
              const dB = (o) => edge(B, o, -0.7);
              const w = ROAD_W / 2;
              S.concrete.quad(dB(-w), dB(w), dA(w), dA(-w));
              S.concrete.quad(edge(A, w, 0), dA(w), dB(w), edge(B, w, 0));
              S.concrete.quad(edge(B, -w, 0), dB(-w), dA(-w), edge(A, -w, 0));
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
          S.checker.quad(edge(a, -ROAD_W / 2, 0.05), edge(a, ROAD_W / 2, 0.05), edge(b, ROAD_W / 2, 0.05), edge(b, -ROAD_W / 2, 0.05), [0, 0, 2, 0, 2, 1, 0, 1]);
          props.push({ kind: 'gantry', pos: a.p, q: xf.q });
        }
        if (type === 'boost') {
          const a = worldFrame(straightS, 0.25, xf);
          const b = worldFrame(straightS, 0.75, xf);
          S.boost.quad(edge(a, -3, 0.05), edge(a, 3, 0.05), edge(b, 3, 0.05), edge(b, -3, 0.05), [0, 0, 1, 0, 1, 5, 0, 5]);
          boostZones.push({ c, r, dir: xf.dir(v3(1, 0, 0)) });
        }
        if (type === 'tunnel') {
          props.push({ kind: 'tunnel', pos: xf.o.clone(), q: xf.q });
          // The hill and the bore lining collide too: the car can climb over it or bump its sides
          for (const geo of Object.values(tunnelGeometry())) {
            const pos = geo.attributes.position;
            const base = col.pos.length / 3;
            for (let i = 0; i < pos.count; i++) col.vert(xf.point(v3(pos.getX(i), pos.getY(i), pos.getZ(i))));
            if (geo.index) for (const k of geo.index.array) col.idx.push(base + k);
            else for (let i = 0; i < pos.count; i++) col.idx.push(base + i);
          }
          for (const sd of [-1, 1]) blocks.push({ pos: xf.point(v3(0, 4, sd * (TUNNEL_HW + 0.5))), q: xf.q, half: [H, 4, 0.5] });
        }
        if (type === 'bridge') props.push({ kind: 'bridge', pos: xf.o.clone(), q: xf.q });
        if (type === 'loop') loops.push({ c, r });
        if (type === 'loop') props.push({ kind: 'loopTowers', pos: xf.o.clone(), q: xf.q });
        if (type === 'bank' || type === 'jump' || type === 'ramp') props.push({ kind: 'flags', pos: xf.o.clone(), q: xf.q, type });
      } else {
        // Scenery
        const cx = c * T + H;
        const cz = r * T + H;
        if (wet.has(r * GRID + c)) continue;
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
  return { surfaces: S, collision: col, props, trees: treesFiltered, houses, boostZones, loops, blocks, water, path: tracePath(track) };
}
