// Built-in tracks, described as a drive-through path so the tiles always connect.
import { emptyTrack, GRID, TYPE_INDEX, DIRS, HEADING_ROT, rotEdge } from './track.js';

const RIGHT = { E: 'S', S: 'W', W: 'N', N: 'E' };
const LEFT = { E: 'N', N: 'W', W: 'S', S: 'E' };
const OPP = { E: 'W', W: 'E', N: 'S', S: 'N' };
const TOKENS = { F: 'start', S: 'straight', B: 'boost', H: 'hump', K: 'ramp', J: 'jump', O: 'loop' };

export function fromPath(name, c, r, heading, path, scenery = []) {
  const track = emptyTrack(name);
  for (const tok of path.trim().split(/\s+/)) {
    const cell = track.cells[r * GRID + c];
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
