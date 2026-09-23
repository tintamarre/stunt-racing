// HUD: timer, speedometer, progress, minimap, messages.
import { FIELD } from './terrain.js';

const $ = (id) => document.getElementById(id);

export function fmtTime(t) {
  if (t == null || !isFinite(t)) return '—';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export class Hud {
  constructor() {
    this.el = {
      time: $('hudTime'),
      best: $('hudBest'),
      prog: $('hudProg'),
      progTxt: $('hudProgTxt'),
      speed: $('hudSpeed'),
      gear: $('hudGear'),
      arc: $('gaugeArc'),
      cam: $('hudCam'),
      msg: $('msg'),
      air: $('airtime'),
      mini: $('minimap'),
      rpScrub: $('rpScrub'),
      rpTime: $('rpTime'),
    };
    this.miniCtx = this.el.mini.getContext('2d');
    this.miniBase = document.createElement('canvas');
    this.miniBase.width = this.miniBase.height = 200;
    this.last = {};
    this.msgTimer = null;
    this.onFinish = null;
    this.bestAir = 0;
  }

  setTrack(built, record) {
    this.el.best.textContent = fmtTime(record?.time);
    const ctx = this.miniBase.getContext('2d');
    ctx.clearRect(0, 0, 200, 200);
    const pts = built.path.points;
    const k = 200 / FIELD;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const [w, c] of [[9, 'rgba(0,0,0,0.5)'], [5, '#dfe6ef']]) {
      ctx.strokeStyle = c;
      ctx.lineWidth = w;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.p.x * k, p.p.z * k) : ctx.moveTo(p.p.x * k, p.p.z * k)));
      if (built.path.closed) ctx.closePath();
      ctx.stroke();
    }
    const s = pts[0];
    ctx.fillStyle = '#4dffa6';
    ctx.fillRect(s.p.x * k - 4, s.p.z * k - 4, 8, 8);
    // Crop to the track bounds
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.p.x * k);
      y0 = Math.min(y0, p.p.z * k);
      x1 = Math.max(x1, p.p.x * k);
      y1 = Math.max(y1, p.p.z * k);
    }
    const pad = 12;
    const size = Math.max(x1 - x0, y1 - y0) + pad * 2;
    this.crop = { x: (x0 + x1) / 2 - size / 2, y: (y0 + y1) / 2 - size / 2, size, k };
  }

  update(s) {
    const e = this.el;
    const set = (key, el, val) => {
      if (this.last[key] !== val) {
        this.last[key] = val;
        el.textContent = val;
      }
    };
    set('time', e.time, fmtTime(s.time));
    const kmh = Math.round(s.speed * 3.6);
    set('speed', e.speed, String(kmh));
    set('gear', e.gear, s.speed < 0.5 ? 'N' : String(s.gear));
    set('cam', e.cam, s.cam);
    set('prog', e.progTxt, `${s.visited}/${s.total}`);
    const pw = `${(100 * s.visited) / Math.max(1, s.total)}%`;
    if (this.last.pw !== pw) {
      this.last.pw = pw;
      e.prog.style.width = pw;
    }
    const arc = Math.round(Math.min(1, kmh / 240) * 396);
    if (this.last.arc !== arc) {
      this.last.arc = arc;
      e.arc.style.strokeDasharray = `${arc} 528`;
    }
    // Air time
    const air = s.mode === 'race' && s.air > 0.6;
    e.air.classList.toggle('on', air);
    if (air) set('air', e.air, `AIR ${s.air.toFixed(1)}s`);

    // Minimap
    if (this.crop) {
      const c = this.miniCtx;
      const { x, y, size, k } = this.crop;
      c.clearRect(0, 0, 200, 200);
      c.drawImage(this.miniBase, x, y, size, size, 0, 0, 200, 200);
      const dot = (p, col, r) => {
        c.fillStyle = col;
        c.beginPath();
        c.arc(((p.x * k - x) / size) * 200, ((p.z * k - y) / size) * 200, r, 0, 7);
        c.fill();
      };
      if (s.ghost) dot(s.ghost, 'rgba(120,220,255,0.8)', 5);
      c.strokeStyle = '#fff';
      c.lineWidth = 2;
      dot(s.car, '#ff4d1f', 6.5);
    }
  }

  message(text, cls, dur = 1) {
    const m = this.el.msg;
    m.className = 'msg';
    if (!text) return;
    void m.offsetWidth;
    m.textContent = text;
    m.className = `msg show ${cls}`;
    m.style.animationDuration = `${dur}s`;
  }

  finish(result) {
    this.onFinish?.(result);
  }

  replayProgress(t, dur) {
    if (!this.scrubbing) this.el.rpScrub.value = String(Math.round((t / Math.max(dur, 0.001)) * 1000));
    const txt = fmtTime(t).slice(0, -3);
    if (this.last.rp !== txt) {
      this.last.rp = txt;
      this.el.rpTime.textContent = txt;
    }
  }
}
