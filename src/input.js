// Keyboard, gamepad and touch input merged into one analog state.
export class Input {
  constructor() {
    this.keys = new Set();
    this.steer = 0;
    this.handlers = {};
    this.touch = { left: false, right: false, gas: false, brake: false, hb: false };
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      if (!e.repeat) this.emit(e.code, e);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.padPrev = {};
  }

  on(code, fn) {
    (this.handlers[code] ||= []).push(fn);
  }

  emit(code, e) {
    for (const fn of this.handlers[code] || []) fn(e);
    for (const fn of this.handlers['*'] || []) fn(code, e);
  }

  bindTouch(root) {
    root.querySelectorAll('[data-touch]').forEach((el) => {
      const k = el.dataset.touch;
      const set = (v) => (e) => {
        e.preventDefault();
        this.touch[k] = v;
        el.classList.toggle('on', v);
      };
      el.addEventListener('pointerdown', set(true));
      el.addEventListener('pointerup', set(false));
      el.addEventListener('pointerleave', set(false));
      el.addEventListener('pointercancel', set(false));
    });
  }

  has(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  read(dt) {
    const k = this;
    let throttle = k.has('ArrowUp', 'KeyW', 'KeyZ') || this.touch.gas ? 1 : 0;
    let brake = k.has('ArrowDown', 'KeyS') || this.touch.brake ? 1 : 0;
    let target = (k.has('ArrowRight', 'KeyD') || this.touch.right ? 1 : 0) - (k.has('ArrowLeft', 'KeyA', 'KeyQ') || this.touch.left ? 1 : 0);
    let handbrake = k.has('Space') || this.touch.hb;

    // Gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.12) target = ax;
      const rt = p.buttons[7]?.value || 0;
      const lt = p.buttons[6]?.value || 0;
      if (rt > 0.05 || p.buttons[0]?.pressed) throttle = Math.max(rt, p.buttons[0]?.pressed ? 1 : 0);
      if (lt > 0.05 || p.buttons[2]?.pressed) brake = Math.max(lt, p.buttons[2]?.pressed ? 1 : 0);
      if (p.buttons[1]?.pressed) handbrake = true;
      const map = { 3: 'KeyC', 9: 'Escape', 8: 'KeyR', 12: 'ArrowUp', 13: 'ArrowDown' };
      for (const [b, code] of Object.entries(map)) {
        const pressed = !!p.buttons[b]?.pressed;
        if (pressed && !this.padPrev[b]) this.emit(code, { pad: true });
        this.padPrev[b] = pressed;
      }
      break;
    }

    // Keyboard steering ramps for smoothness
    const rate = Math.abs(target) > Math.abs(this.steer) && Math.sign(target) === Math.sign(this.steer || target) ? 4.5 : 8;
    this.steer += Math.max(-rate * dt, Math.min(rate * dt, target - this.steer));
    return { throttle, brake, steer: this.steer, handbrake };
  }
}
