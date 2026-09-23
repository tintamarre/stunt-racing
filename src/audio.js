// Synthesised audio: engine with gears, tyre screech, wind, impacts, beeps.
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try {
      this.muted = localStorage.getItem('stunt.muted') === '1';
    } catch {}
    this.gear = 1;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = new AC();
    this.ctx = c;
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp).connect(c.destination);

    // Engine: two detuned saws + square sub through a lowpass
    this.engGain = c.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = c.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 900;
    this.engFilter.Q.value = 4;
    this.oscs = [
      ['sawtooth', 1, 0.5],
      ['sawtooth', 1.007, 0.4],
      ['square', 0.5, 0.35],
    ].map(([type, mul, g]) => {
      const o = c.createOscillator();
      o.type = type;
      const gg = c.createGain();
      gg.gain.value = g;
      o.connect(gg).connect(this.engFilter);
      o.start();
      return { o, mul };
    });
    this.engFilter.connect(this.engGain).connect(this.master);

    // Noise source shared by screech/wind
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const mk = (type, freq, q) => {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = c.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return { f, g };
    };
    this.screech = mk('bandpass', 1400, 6);
    this.wind = mk('lowpass', 500, 0.5);
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem('stunt.muted', m ? '1' : '0');
    } catch {}
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  // speed m/s, throttle 0..1, slip 0..1, air bool
  update(speed, throttle, slip, air, active = true) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = Math.abs(speed) * 3.6;
    // Fake gearbox
    const shifts = [0, 40, 75, 110, 150, 195, 999];
    let g = 1;
    while (v > shifts[g]) g++;
    this.gear = g;
    const lo = shifts[g - 1];
    const hi = shifts[g];
    let rpm = 0.25 + 0.75 * Math.min(1, (v - lo) / Math.max(1, hi - lo));
    if (air) rpm = Math.min(1, rpm + throttle * 0.3);
    this.rpm = rpm;
    const f = 38 + rpm * 110 + g * 6;
    for (const { o, mul } of this.oscs) o.frequency.setTargetAtTime(f * mul, t, 0.03);
    this.engFilter.frequency.setTargetAtTime(500 + rpm * 1400 + throttle * 900, t, 0.05);
    this.engGain.gain.setTargetAtTime(active ? 0.1 + throttle * 0.14 : 0, t, 0.08);
    this.screech.g.gain.setTargetAtTime(active ? Math.min(0.35, slip * 0.45) : 0, t, 0.05);
    this.screech.f.frequency.setTargetAtTime(1100 + slip * 700, t, 0.1);
    this.wind.g.gain.setTargetAtTime(active ? Math.min(0.25, (v / 200) ** 2 * 0.3) : 0, t, 0.1);
  }

  impact(strength) {
    if (!this.ctx) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 300 + strength * 500;
    const g = c.createGain();
    g.gain.setValueAtTime(Math.min(1, strength) * 0.9, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.4);
    src.connect(f).connect(g).connect(this.master);
    src.start();
    src.stop(c.currentTime + 0.45);
  }

  beep(freq = 660, dur = 0.18) {
    if (!this.ctx) return;
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.18, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(c.currentTime + dur + 0.02);
  }

  whoosh() {
    if (!this.ctx) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(400, c.currentTime);
    f.frequency.exponentialRampToValueAtTime(2500, c.currentTime + 0.5);
    const g = c.createGain();
    g.gain.setValueAtTime(0.35, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.6);
    src.connect(f).connect(g).connect(this.master);
    src.start();
    src.stop(c.currentTime + 0.65);
  }
}
