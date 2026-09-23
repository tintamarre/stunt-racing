// 2D drawing of tiles for the editor, menu preview and minimap.
import { PIECES, TYPES, T, GRID } from './track.js';

export const TYPE_COLORS = {
  straight: '#c9d1dc',
  start: '#ffffff',
  curve: '#c9d1dc',
  bank: '#ffb21f',
  ramp: '#f7c21a',
  jump: '#ff7a1f',
  hump: '#ffd27a',
  loop: '#ff4d1f',
  boost: '#39e0ff',
  trees: '#3f8a3a',
  house: '#c8574a',
};

function rot(x, z, r) {
  const a = (r * Math.PI) / 2;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c + z * s, -x * s + z * c];
}

export function drawPiece(ctx, type, r, x0, y0, s, { detail = true } = {}) {
  const map = (lx, lz) => {
    const [x, z] = rot(lx, lz, r);
    return [x0 + (x / T + 0.5) * s, y0 + (z / T + 0.5) * s];
  };
  if (type === 'trees') {
    ctx.fillStyle = '#2f6e2c';
    for (const [a, b, rr] of [[0.3, 0.3, 0.17], [0.68, 0.36, 0.14], [0.45, 0.7, 0.2], [0.78, 0.74, 0.12]]) {
      ctx.beginPath();
      ctx.arc(x0 + a * s, y0 + b * s, rr * s, 0, 7);
      ctx.fill();
    }
    return;
  }
  if (type === 'house') {
    ctx.fillStyle = '#e8dcc6';
    ctx.fillRect(x0 + 0.25 * s, y0 + 0.3 * s, 0.5 * s, 0.4 * s);
    ctx.fillStyle = '#b8453a';
    ctx.fillRect(x0 + 0.25 * s, y0 + 0.3 * s, 0.5 * s, 0.16 * s);
    return;
  }
  const piece = PIECES[type];
  if (!piece) return;
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const p = piece.center(i / 24).p;
    pts.push(map(p.x, p.z));
  }
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#3b4250';
  ctx.lineWidth = (11 / T) * s;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  if (!detail) return;
  ctx.strokeStyle = TYPE_COLORS[type] || '#ccc';
  ctx.lineWidth = Math.max(1.5, s * 0.07);
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();

  const c = map(0, 0);
  const arrow = (col) => {
    const [ax, ay] = map(6, 0);
    const [bx, by] = map(-3, -4);
    const [cx, cy] = map(-3, 4);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(cx, cy);
    ctx.fill();
  };
  if (type === 'loop') {
    ctx.strokeStyle = '#ff4d1f';
    ctx.lineWidth = Math.max(2, s * 0.08);
    ctx.beginPath();
    ctx.arc(c[0], c[1], s * 0.24, 0, 7);
    ctx.stroke();
  } else if (type === 'ramp' || type === 'jump') {
    arrow(TYPE_COLORS[type]);
    if (type === 'jump') {
      ctx.fillStyle = '#0b0f17';
      const [a1, b1] = map(-4.5, -6);
      const [a2, b2] = map(4.5, 6);
      ctx.fillRect(Math.min(a1, a2), Math.min(b1, b2), Math.abs(a2 - a1) || 2, Math.abs(b2 - b1) || 2);
    }
  } else if (type === 'boost') {
    arrow('#39e0ff');
  } else if (type === 'hump') {
    ctx.fillStyle = '#ffd27a';
    ctx.beginPath();
    ctx.arc(c[0], c[1], s * 0.12, 0, 7);
    ctx.fill();
  } else if (type === 'start') {
    const [a1, b1] = map(0, -5.5);
    const [a2, b2] = map(0, 5.5);
    ctx.strokeStyle = '#fff';
    ctx.setLineDash([s * 0.06, s * 0.06]);
    ctx.lineWidth = s * 0.1;
    ctx.beginPath();
    ctx.moveTo(a1, b1);
    ctx.lineTo(a2, b2);
    ctx.stroke();
    ctx.setLineDash([]);
    arrow('#4dffa6');
  }
}

export function drawBoard(ctx, track, size, { grid = true, detail = true, bg = '#1d3a1f' } = {}) {
  const s = size / GRID;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  if (grid) {
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= GRID; i++) {
      ctx.beginPath();
      ctx.moveTo(i * s + 0.5, 0);
      ctx.lineTo(i * s + 0.5, size);
      ctx.moveTo(0, i * s + 0.5);
      ctx.lineTo(size, i * s + 0.5);
      ctx.stroke();
    }
  }
  track.cells.forEach((cell, i) => {
    if (!cell.t) return;
    drawPiece(ctx, TYPES[cell.t].id, cell.r, (i % GRID) * s, Math.floor(i / GRID) * s, s, { detail });
  });
}

// Draw only the used part of the board (plus a margin), scaled to fill the canvas.
export function drawBoardCropped(ctx, track, size, opts = {}) {
  let c0 = GRID, r0 = GRID, c1 = -1, r1 = -1;
  track.cells.forEach((cell, i) => {
    if (!TYPES[cell.t].road) return;
    const c = i % GRID;
    const r = Math.floor(i / GRID);
    c0 = Math.min(c0, c);
    r0 = Math.min(r0, r);
    c1 = Math.max(c1, c);
    r1 = Math.max(r1, r);
  });
  if (c1 < 0) return drawBoard(ctx, track, size, opts);
  const span = Math.max(c1 - c0, r1 - r0) + 1.6;
  const cx = (c0 + c1 + 1) / 2;
  const cy = (r0 + r1 + 1) / 2;
  const full = document.createElement('canvas');
  const cell = Math.ceil((size / span) * 1);
  full.width = full.height = cell * GRID;
  drawBoard(full.getContext('2d'), track, cell * GRID, opts);
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(full, (cx - span / 2) * cell, (cy - span / 2) * cell, span * cell, span * cell, 0, 0, size, size);
}
