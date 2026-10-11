// Prints each built-in track as an ASCII board and checks it forms a closed circuit
// using every road tile. usage: node tests/paths.mjs [name-filter]
import { BUILTIN } from '../src/tracks.js';
import { tracePath, occupancy, encodeTrack, decodeTrack, GRID, TYPES } from '../src/track.js';

const SYM = { start: 'F', straight: '=', curve: 'c', bank: 'b', ramp: 'K', jump: 'J', hump: 'h', loop: 'O', boost: 'B', wide: 'W', sweep: 'C', slope: '/', bridge: 'X', tunnel: 'U', trees: '.', house: '^' };
let bad = 0;
for (const t of BUILTIN) {
  if (process.argv[2] && !t.name.includes(process.argv[2])) continue;
  const p = tracePath(t);
  const roads = t.cells.filter((c) => TYPES[c.t].road).length;
  // Share codes must round-trip (elevation included); flat tracks keep the short v1 code
  const code = encodeTrack(t);
  const back = decodeTrack(code);
  const same = back && back.cells.every((c, i) => c.t === t.cells[i].t && c.r === t.cells[i].r && (c.h || 0) === (t.cells[i].h || 0));
  const flat = t.cells.every((c) => !c.h);
  const ok = p && p.closed && p.cells.length === roads && same && code[0] === (flat ? '1' : '2');
  if (!ok) bad++;
  console.log(`${t.name}: ${p?.cells.length}/${roads} tiles, closed=${p?.closed} ${ok ? 'OK' : 'BROKEN'}`);
  const occ = occupancy(t);
  for (let r = 0; r < GRID; r++) {
    let line = '';
    for (let c = 0; c < GRID; c++) {
      const i = r * GRID + c;
      const o = occ.get(i);
      line += o ? (o.anchor === i ? SYM[o.type] : 'w') : SYM[TYPES[t.cells[i].t].id] || ' ';
    }
    console.log('  |' + line + '|');
  }
}
process.exit(bad ? 1 : 0);
