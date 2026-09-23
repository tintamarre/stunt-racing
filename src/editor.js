// Track editor: paint tiles on the board, validate the circuit, save & share.
import { TYPES, TYPE_INDEX, GRID, encodeTrack, decodeTrack, tracePath } from './track.js';
import { drawBoard, drawPiece } from './tiledraw.js';
import { customTracks } from './storage.js';
import { BUILTIN } from './tracks.js';

const $ = (id) => document.getElementById(id);
const clone = (t) => ({ name: t.name, cells: t.cells.map((c) => ({ ...c })) });

export class Editor {
  constructor({ onTest, onExit, toast }) {
    this.onTest = onTest;
    this.onExit = onExit;
    this.toast = toast;
    this.root = $('editor');
    this.canvas = $('edCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.tool = TYPE_INDEX.straight;
    this.rot = 0;
    this.hover = null;
    this.buildPalette();
    this.bind();
  }

  buildPalette() {
    const pal = $('edPalette');
    pal.innerHTML = '';
    const items = TYPES.map((t, i) => ({ i, label: i === 0 ? 'Eraser' : t.label, id: t.id }));
    items.push(items.shift());
    this.palButtons = [];
    for (const it of items) {
      const b = document.createElement('button');
      const c = document.createElement('canvas');
      c.width = c.height = 72;
      const x = c.getContext('2d');
      x.fillStyle = '#1d3a1f';
      x.fillRect(0, 0, 72, 72);
      if (it.i === 0) {
        x.strokeStyle = '#ff4d1f';
        x.lineWidth = 7;
        x.beginPath();
        x.moveTo(18, 18);
        x.lineTo(54, 54);
        x.moveTo(54, 18);
        x.lineTo(18, 54);
        x.stroke();
      } else drawPiece(x, it.id, 0, 0, 0, 72);
      const span = document.createElement('span');
      span.textContent = it.label;
      b.append(c, span);
      b.title = it.label;
      b.onclick = () => this.setTool(it.i);
      pal.appendChild(b);
      this.palButtons.push({ b, i: it.i });
    }
    const rb = document.createElement('button');
    rb.innerHTML = '<canvas width="72" height="72"></canvas><span>Rotate (R)</span>';
    const rc = rb.querySelector('canvas').getContext('2d');
    rc.fillStyle = '#26324a';
    rc.fillRect(0, 0, 72, 72);
    rc.strokeStyle = '#fff';
    rc.lineWidth = 6;
    rc.beginPath();
    rc.arc(36, 36, 18, -0.3, 4.4);
    rc.stroke();
    rb.onclick = () => this.rotate();
    pal.appendChild(rb);
  }

  setTool(i) {
    this.tool = i;
    for (const p of this.palButtons) p.b.classList.toggle('on', p.i === i);
    this.draw();
  }

  rotate() {
    this.rot = (this.rot + 1) % 4;
    this.draw();
  }

  bind() {
    const cv = this.canvas;
    const cellOf = (e) => {
      const r = cv.getBoundingClientRect();
      const s = r.width / GRID;
      const c = Math.floor((e.clientX - r.left) / s);
      const w = Math.floor((e.clientY - r.top) / s);
      return c >= 0 && w >= 0 && c < GRID && w < GRID ? { c, r: w } : null;
    };
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      const cell = cellOf(e);
      if (!cell) return;
      cv.setPointerCapture(e.pointerId);
      const cur = this.track.cells[cell.r * GRID + cell.c];
      if (e.button === 2) {
        if (cur.t) cur.r = (cur.r + 1) % 4;
        else this.rotate();
        this.changed();
        return;
      }
      if (e.shiftKey) {
        if (cur.t) {
          this.setTool(cur.t);
          this.rot = cur.r;
        }
        return;
      }
      if (cur.t === this.tool && this.tool !== 0) {
        cur.r = (cur.r + 1) % 4;
        this.rot = cur.r;
        this.changed();
        return;
      }
      this.painting = true;
      this.place(cell);
    });
    cv.addEventListener('pointermove', (e) => {
      const cell = cellOf(e);
      const key = cell ? cell.c + ',' + cell.r : null;
      if (key !== this.hoverKey) {
        this.hoverKey = key;
        this.hover = cell;
        if (this.painting && cell) this.place(cell);
        this.draw();
      }
    });
    const stop = () => (this.painting = false);
    cv.addEventListener('pointerup', stop);
    cv.addEventListener('pointercancel', stop);
    cv.addEventListener('pointerleave', () => {
      this.hover = null;
      this.hoverKey = null;
      this.draw();
    });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.rotate();
    });
    window.addEventListener('keydown', (e) => {
      if (this.root.classList.contains('hidden') || e.target.tagName === 'INPUT') return;
      if (e.code === 'KeyR') this.rotate();
      if (e.code === 'KeyE') this.setTool(0);
      if (e.code === 'Escape') this.onExit();
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 9 && TYPES[n]) this.setTool(n);
    });
    window.addEventListener('resize', () => !this.root.classList.contains('hidden') && this.fit());

    $('edName').addEventListener('input', (e) => (this.track.name = e.target.value || 'Untitled'));
    $('edNew').onclick = () => {
      const t = { name: 'My track', cells: Array.from({ length: GRID * GRID }, () => ({ t: 0, r: 0 })) };
      this.load(t);
    };
    $('edSave').onclick = () => this.save();
    $('edShare').onclick = () => this.share();
    $('edDelete').onclick = () => {
      const list = customTracks.list().filter((t) => t.name !== this.track.name);
      customTracks.save(list);
      this.refreshLoad();
      this.toast('Deleted from your tracks');
    };
    $('edTest').onclick = () => {
      const p = tracePath(this.track);
      if (!p || p.cells.length < 3) return this.toast('Place a start tile and connect some road first');
      this.onTest(clone(this.track));
    };
    $('edExit').onclick = () => this.onExit();
    $('edLoad').onchange = (e) => {
      const v = e.target.value;
      if (!v) return;
      const [kind, idx] = v.split(':');
      const src = kind === 'b' ? BUILTIN[+idx] : customTracks.list()[+idx];
      if (src) this.load(kind === 'b' ? { ...clone(src), name: src.name + ' (copy)' } : this.fromCode(src));
      e.target.value = '';
    };
  }

  fromCode(entry) {
    return decodeTrack(entry.code, entry.name);
  }

  place(cell) {
    const i = cell.r * GRID + cell.c;
    if (this.tool === TYPE_INDEX.start) {
      this.track.cells.forEach((c) => {
        if (c.t === TYPE_INDEX.start) c.t = 0;
      });
    }
    this.track.cells[i] = { t: this.tool, r: this.tool ? this.rot : 0 };
    this.changed();
  }

  changed() {
    this.draw();
    this.validate();
  }

  validate() {
    const el = $('edStatus');
    const p = tracePath(this.track);
    const roads = this.track.cells.filter((c) => TYPES[c.t].road).length;
    if (!p) {
      this.path = null;
      el.innerHTML = '<b class="bad">No start tile</b> — place a Start / Finish piece.';
      return;
    }
    const orphan = roads - p.cells.length;
    el.innerHTML =
      `Circuit: <b>${p.cells.length}</b> tiles · ` +
      (p.closed ? '<b class="ok">closed loop ✓</b>' : '<b class="bad">open</b> (the race ends on the last tile)') +
      (orphan > 0 ? ` · <b class="bad">${orphan} unconnected road tile${orphan > 1 ? 's' : ''}</b>` : '');
    this.path = p;
  }

  save() {
    const list = customTracks.list();
    const entry = { name: this.track.name || 'Untitled', code: encodeTrack(this.track) };
    const i = list.findIndex((t) => t.name === entry.name);
    if (i >= 0) list[i] = entry;
    else list.push(entry);
    customTracks.save(list);
    this.refreshLoad();
    this.toast('Saved to your tracks');
    this.onSaved?.();
  }

  share() {
    const url = `${location.origin}${location.pathname}#t=${encodeTrack(this.track)}&n=${encodeURIComponent(this.track.name || 'Shared track')}`;
    const done = () => this.toast('Share link copied!');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, () => prompt('Copy this link:', url));
    else prompt('Copy this link:', url);
  }

  refreshLoad() {
    const sel = $('edLoad');
    sel.innerHTML = '<option value="">Load…</option>';
    BUILTIN.forEach((t, i) => sel.add(new Option(`★ ${t.name}`, `b:${i}`)));
    customTracks.list().forEach((t, i) => sel.add(new Option(t.name, `c:${i}`)));
  }

  load(track) {
    if (!track) return;
    this.track = clone(track);
    $('edName').value = this.track.name;
    this.changed();
  }

  open(track) {
    this.root.classList.remove('hidden');
    this.refreshLoad();
    this.load(track);
    this.setTool(this.tool);
    this.fit();
  }

  close() {
    this.root.classList.add('hidden');
  }

  fit() {
    const wrap = this.canvas.parentElement.getBoundingClientRect();
    const size = Math.floor(Math.min(wrap.width, wrap.height) - 24);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.style.width = this.canvas.style.height = `${size}px`;
    this.canvas.width = this.canvas.height = Math.floor(size * dpr);
    this.draw();
  }

  draw() {
    if (!this.track) return;
    const ctx = this.ctx;
    const size = this.canvas.width;
    drawBoard(ctx, this.track, size);
    const s = size / GRID;
    // Highlight the circuit
    if (this.path) {
      ctx.fillStyle = 'rgba(77,255,166,0.07)';
      for (const c of this.path.cells) ctx.fillRect(c.c * s, c.r * s, s, s);
    }
    if (this.hover) {
      const { c, r } = this.hover;
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(c * s, r * s, s, s);
      if (this.tool) drawPiece(ctx, TYPES[this.tool].id, this.rot, c * s, r * s, s);
      ctx.restore();
      ctx.strokeStyle = this.tool ? '#ffb21f' : '#ff4d1f';
      ctx.lineWidth = 2;
      ctx.strokeRect(c * s + 1, r * s + 1, s - 2, s - 2);
    }
  }
}
