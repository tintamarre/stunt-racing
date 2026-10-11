// Built-in tracks, described as a drive-through path so the tiles always connect.
import { emptyTrack, GRID, TYPE_INDEX, DIRS, HEADING_ROT, rotEdge, localToGrid } from './track.js';

const RIGHT = { E: 'S', S: 'W', W: 'N', N: 'E' };
const LEFT = { E: 'N', N: 'W', W: 'S', S: 'E' };
const OPP = { E: 'W', W: 'E', N: 'S', S: 'N' };
// + / - climb / descend one elevation level over a tile
const TOKENS = { F: 'start', S: 'straight', B: 'boost', H: 'hump', K: 'ramp', J: 'jump', O: 'loop', X: 'bridge', U: 'tunnel' };

export function fromPath(name, c, r, heading, path, scenery = []) {
  const track = emptyTrack(name);
  let level = 0;
  for (const tok of path.trim().split(/\s+/)) {
    const cell = track.cells[r * GRID + c];
    if (tok === '+' || tok === '-') {
      // The slope piece rises towards its local +x: point it back when going down
      if (tok === '-') level--;
      Object.assign(cell, { t: TYPE_INDEX.slope, r: HEADING_ROT[tok === '+' ? heading : OPP[heading]], h: level });
      if (tok === '+') level++;
      c += DIRS[heading][0];
      r += DIRS[heading][1];
      continue;
    }
    cell.h = level;
    if (/^[WC][RL]$/.test(tok)) {
      // Wide (2x2, W) or sweeping (3x3, C) curve. A left turn is the right-hand piece driven backwards.
      const right = tok[1] === 'R';
      const n = tok[0] === 'W' ? 1 : 2;
      const d = right ? heading : LEFT[OPP[heading]];
      const rot = HEADING_ROT[d];
      const [dc, dr] = localToGrid(rot, n, n);
      const [ac, ar] = right ? [c, r] : [c - dc, r - dr];
      track.cells[ar * GRID + ac] = { t: TYPE_INDEX[n === 1 ? 'wide' : 'sweep'], r: rot, h: level };
      [c, r] = right ? [ac + dc, ar + dr] : [ac, ar];
      heading = right ? RIGHT[heading] : OPP[d];
      c += DIRS[heading][0];
      r += DIRS[heading][1];
      continue;
    }
    if (tok === 'L' || tok === 'R' || tok === 'BL' || tok === 'BR') {
      const out = (tok.endsWith('L') ? LEFT : RIGHT)[heading];
      const entry = OPP[heading];
      let rot = 0;
      for (; rot < 4; rot++) {
        const a = rotEdge('W', rot);
        const b = rotEdge('S', rot);
        if ((a === entry && b === out) || (a === out && b === entry)) break;
      }
      cell.t = TYPE_INDEX[tok.startsWith('B') ? 'bank' : 'curve'];
      cell.r = rot;
      heading = out;
    } else {
      cell.t = TYPE_INDEX[TOKENS[tok]];
      cell.r = HEADING_ROT[heading];
    }
    c += DIRS[heading][0];
    r += DIRS[heading][1];
  }
  for (const [sc, sr, type] of scenery) {
    const cell = track.cells[sr * GRID + sc];
    if (cell.t === 0) cell.t = TYPE_INDEX[type];
  }
  return track;
}

const forest = (cells) => cells.map(([c, r]) => [c, r, 'trees']);
const houses = (cells) => cells.map(([c, r]) => [c, r, 'house']);

export const BUILTIN = [
  // Beginner tracks: long straights, wide and sweeping curves, no loops or jumps
  fromPath(
    'Easy Oval',
    5, 3, 'E',
    `F S S B S S S WR
     S S WR
     S S S S S S S S WR
     S S WR
     S`,
    [...forest([[5, 5], [6, 6], [9, 5], [10, 7], [7, 7], [12, 12], [0, 0], [15, 1]]), ...houses([[4, 6], [11, 5], [6, 12]])],
  ),
  fromPath(
    'Green Valley',
    3, 2, 'E',
    `F S B S WR
     S WL S S WR
     S S WR
     H S S X S S WR
     S S S WL WR WR`,
    [...forest([[6, 4], [10, 10], [11, 9], [6, 9], [7, 8], [14, 2], [1, 13]]), ...houses([[9, 4], [7, 13], [13, 4]])],
  ),
  fromPath(
    'Speed Bowl',
    6, 1, 'E',
    `F S B S CR
     S S S CR
     S S S S CR
     S S S CR`,
    [...forest([[6, 4], [9, 5], [7, 6], [1, 10], [13, 11], [0, 1], [15, 4]]), ...houses([[8, 4], [12, 12]])],
  ),
  fromPath(
    'River Run',
    3, 13, 'E',
    `F S B S X S S S WL
     S U U S WL
     S J S S WR
     S WL WL
     S S S X S S S S S L`,
    [...forest([[5, 9], [6, 10], [8, 9], [9, 11], [13, 9], [14, 10], [14, 5], [7, 3], [8, 2]]), ...houses([[7, 11], [10, 3], [4, 9]])],
  ),
  fromPath(
    'Grand Prix',
    5, 1, 'E',
    `F S B S S S CR
     U S WR WL
     S X S CR
     S S S CR
     S S H S S U S S CR`,
    [...forest([[5, 5], [6, 6], [7, 10], [5, 11], [8, 4], [10, 4], [14, 13], [0, 0]]), ...houses([[6, 8], [4, 5], [13, 10]])],
  ),
  fromPath(
    'Sunday Drive',
    3, 3, 'E',
    `F S H S J S S S BR
     S S B S S BR
     S S K S S O S S R
     S S H S S R`,
    [...forest([[4, 5], [5, 5], [6, 6], [9, 6], [8, 5], [0, 0], [1, 1], [13, 2], [13, 10], [14, 9]]), ...houses([[5, 7], [7, 7], [1, 10], [12, 11]])],
  ),
  fromPath(
    'Stunt Park',
    2, 12, 'E',
    `F S B S S L
     S H S R
     S B S BL
     S S O S BL
     S J S S S K S S S BL
     S S H S S B S S L`,
    [...forest([[3, 5], [4, 6], [5, 5], [8, 5], [9, 6], [3, 9], [4, 10], [9, 11], [10, 12], [13, 5], [13, 12], [14, 14]]), ...houses([[5, 8], [9, 10], [13, 2], [3, 14]])],
  ),
  // Mountain tracks: climbs and descents between elevation levels (+ / -)
  fromPath(
    'Alpine Climb',
    4, 2, 'E',
    `F S B + + S S WR
     + S U S WR
     S - S - S K S WR
     - S S S WR`,
    [...forest([[5, 4], [6, 5], [9, 6], [10, 4], [7, 7], [14, 12], [1, 12], [8, 12]]), ...houses([[6, 6], [13, 1]])],
  ),
  fromPath(
    'Summit Rush',
    4, 13, 'E',
    `F S B + + + S WL
     + + S L
     S J S S - - S WL
     - - - L`,
    [...forest([[6, 10], [7, 11], [9, 10], [5, 6], [8, 5], [11, 6], [14, 9], [1, 9]]), ...houses([[8, 11], [12, 5]])],
  ),
  fromPath(
    'Mountain Pass',
    3, 2, 'E',
    `F S B S WR
     U U S WL
     S J S WR
     S O S WR
     S X S S K S S S S WR
     S S U S S H S S S S R`,
    [...forest([[5, 5], [6, 6], [5, 10], [6, 11], [10, 11], [11, 12], [12, 4], [13, 5], [0, 8], [10, 5]]), ...houses([[9, 11], [5, 8], [12, 2]])],
  ),
  fromPath(
    'Mad Loops',
    4, 1, 'E',
    `F S O S B S J S S S BR
     S S H S S O S S K S S S BR
     S J S S B S O O S S S S R
     S S S H S S B S S R
     S L S S R`,
    [...forest([[5, 3], [6, 4], [8, 6], [9, 7], [11, 5], [6, 9], [7, 10], [10, 11], [12, 9], [0, 0], [15, 15], [0, 15]]), ...houses([[4, 7], [8, 9], [11, 12], [6, 12]])],
  ),
];

const LEVELS = { 'Easy Oval': 'Easy', 'Green Valley': 'Easy', 'Speed Bowl': 'Easy', 'River Run': 'Medium', 'Grand Prix': 'Medium', 'Alpine Climb': 'Medium', 'Summit Rush': 'Hard', 'Sunday Drive': 'Medium', 'Stunt Park': 'Medium', 'Mountain Pass': 'Hard', 'Mad Loops': 'Hard' };
BUILTIN.forEach((t) => (t.level = LEVELS[t.name]));
