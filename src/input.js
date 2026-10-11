// Keyboard, gamepad and touch input merged into one analog state.
export class Input {
  constructor() {
    this.keys = new Set();
    this.steer = 0;
    this.steers = [0, 0, 0];
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

  // slot 0: one player, every key and the first gamepad drive.
  // Split screen: slot 1 = WASD/ZQSD + Space/Left Shift + pad 1, slot 2 = arrows + Right Shift / Slash / Numpad 0 + pad 2.
  read(dt, slot = 0) {
    const k = this;
    const keys = KEYS[slot];
    let throttle = k.has(...keys.gas) || (!slot && this.touch.gas) ? 1 : 0;
    let brake = k.has(...keys.brake) || (!slot && this.touch.brake) ? 1 : 0;
    let target = (k.has(...keys.right) || (!slot && this.touch.right) ? 1 : 0) - (k.has(...keys.left) || (!slot && this.touch.left) ? 1 : 0);
    let handbrake = k.has(...keys.drift) || (!slot && this.touch.hb);

    // Gamepad
    const pads = (navigator.getGamepads ? [...navigator.getGamepads()] : []).filter(Boolean);
    const p = pads[Math.max(0, slot - 1)];
    if (p) {
      const ax = p.axes[0] || 0;
      if (Math.abs(ax) > 0.12) target = ax;
      const rt = p.buttons[7]?.value || 0;
      const lt = p.buttons[6]?.value || 0;
      if (rt > 0.05 || p.buttons[0]?.pressed) throttle = Math.max(rt, p.buttons[0]?.pressed ? 1 : 0);
      if (lt > 0.05 || p.buttons[2]?.pressed) brake = Math.max(lt, p.buttons[2]?.pressed ? 1 : 0);
      if (p.buttons[1]?.pressed) handbrake = true;
      const map = slot === 2 ? { 3: 'Comma', 9: 'Escape', 8: 'Enter' } : { 3: 'KeyC', 9: 'Escape', 8: 'KeyR', 12: 'ArrowUp', 13: 'ArrowDown' };
      const prev = (this.padPrev[slot] ||= {});
      for (const [b, code] of Object.entries(map)) {
        const pressed = !!p.buttons[b]?.pressed;
        if (pressed && !prev[b]) this.emit(code, { pad: true });
        prev[b] = pressed;
      }
    }

    // Keyboard steering ramps for smoothness
    let steer = slot ? this.steers[slot] : this.steer;
    const rate = Math.abs(target) > Math.abs(steer) && Math.sign(target) === Math.sign(steer || target) ? 4.5 : 8;
    steer += Math.max(-rate * dt, Math.min(rate * dt, target - steer));
    if (slot) this.steers[slot] = steer;
    else this.steer = steer;
    return { throttle, brake, steer, handbrake };
  }

  resetSteer() {
    this.steer = 0;
    this.steers = [0, 0, 0];
  }
}

const KEYS = [
  { gas: ['ArrowUp', 'KeyW', 'KeyZ'], brake: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA', 'KeyQ'], right: ['ArrowRight', 'KeyD'], drift: ['Space', 'ShiftLeft', 'ShiftRight'] },
  { gas: ['KeyW', 'KeyZ'], brake: ['KeyS'], left: ['KeyA', 'KeyQ'], right: ['KeyD'], drift: ['Space', 'ShiftLeft'] },
  { gas: ['ArrowUp'], brake: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], drift: ['ShiftRight', 'Slash', 'Numpad0'] },
];
