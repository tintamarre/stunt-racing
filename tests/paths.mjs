import { BUILTIN } from '../src/tracks.js';
import { tracePath, buildTrack, TYPES } from '../src/track.js';
for (const t of BUILTIN) {
  const p = tracePath(t);
  const roads = t.cells.filter((c) => TYPES[c.t].road).length;
  const b = buildTrack(t);
  console.log(t.name, 'cells', p.cells.length, '/', roads, 'closed', p.closed, 'points', p.points.length, 'tris', b.collision.idx.length / 3);
}
