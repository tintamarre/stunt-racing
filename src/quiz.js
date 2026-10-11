// Math quiz mode ("serious gaming"): every so often the race pauses on a multiple-choice
// question. Split screen: the first right answer drives off, the other player is frozen for
// a few seconds. Alone: a right answer gives a turbo, a wrong one freezes you.

export const QUIZ_LEVELS = ['off', 'easy', 'medium', 'hard'];
const EVERY = [25, 40]; // seconds of racing between two questions
const TIME = 12; // seconds to answer
const FREEZE = 3; // seconds frozen for the slower (or wrong) player
export const KEYS = [
  ['Digit1', 'Digit2', 'Digit3', 'Digit4'],
  ['Digit7', 'Digit8', 'Digit9', 'Digit0'],
];
const NUMPAD = ['Numpad1', 'Numpad2', 'Numpad3', 'Numpad4'];

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

// { text, answer } for a level
export function makeQuestion(level) {
  const kind = Math.random();
  if (level === 'easy') {
    if (kind < 0.55) {
      const a = rnd(1, 12);
      const b = rnd(1, 20 - a);
      return { text: `${a} + ${b}`, answer: a + b };
    }
    const a = rnd(5, 20);
    const b = rnd(1, a);
    return { text: `${a} − ${b}`, answer: a - b };
  }
  if (level === 'medium') {
    if (kind < 0.5) {
      const a = rnd(2, 10);
      const b = rnd(2, 10);
      return { text: `${a} × ${b}`, answer: a * b };
    }
    if (kind < 0.75) {
      const a = rnd(11, 70);
      const b = rnd(5, 99 - a);
      return { text: `${a} + ${b}`, answer: a + b };
    }
    const a = rnd(30, 99);
    const b = rnd(6, a - 5);
    return { text: `${a} − ${b}`, answer: a - b };
  }
  // hard
  if (kind < 0.35) {
    const a = rnd(11, 25);
    const b = rnd(3, 9);
    return { text: `${a} × ${b}`, answer: a * b };
  }
  if (kind < 0.6) {
    const b = rnd(3, 12);
    const q = rnd(4, 15);
    return { text: `${b * q} ÷ ${b}`, answer: q };
  }
  if (kind < 0.85) {
    const a = rnd(2, 9);
    const b = rnd(2, 9);
    const c = rnd(2, 20);
    return { text: `${c} + ${a} × ${b}`, answer: c + a * b };
  }
  const a = rnd(2, 9) * 10;
  const p = [10, 20, 25, 50][rnd(0, 3)];
  return { text: `${p}% of ${a * (p === 25 ? 4 : 1)}`, answer: (a * (p === 25 ? 4 : 1) * p) / 100 };
}

// Four distinct choices around the answer, shuffled
export function makeChoices(answer) {
  const set = new Set([answer]);
  const near = [1, -1, 2, -2, 10, -10, 5, -5, 3, -3];
  while (set.size < 4) {
    const d = near[rnd(0, near.length - 1)] * (Math.random() < 0.2 ? 2 : 1);
    if (answer + d >= 0) set.add(answer + d);
  }
  return [...set].sort(() => Math.random() - 0.5);
}

export class Quiz {
  constructor(game) {
    this.game = game;
    this.level = 'off';
    this.active = null;
    this.el = typeof document !== 'undefined' ? document.getElementById('quiz') : null;
    this.el?.querySelectorAll('[data-choice]').forEach((b) => b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.answer(1, +b.dataset.choice);
    }));
  }

  reset() {
    this.active = null;
    this.nextAt = rnd(EVERY[0], EVERY[1]);
    this.hide();
  }

  // Every physics step while racing
  step() {
    const g = this.game;
    if (this.level === 'off' || this.active || g.mode !== 'race' || g.done) return;
    if (g.raceTime >= this.nextAt) this.start();
  }

  start() {
    const g = this.game;
    const q = makeQuestion(this.level);
    this.active = { ...q, choices: makeChoices(q.answer), t: TIME, answered: {}, winner: 0 };
    this.prevMode = g.mode;
    g.mode = 'quiz';
    g.audio.beep(740, 0.15);
    setTimeout(() => g.audio.beep(988, 0.2), 140);
    this.render();
  }

  // Key press: returns true when it was a quiz answer
  key(code) {
    if (!this.active) return false;
    const two = !!this.game.p2;
    let i = KEYS[0].indexOf(code);
    if (i >= 0) return this.answer(1, i), true;
    i = KEYS[1].indexOf(code);
    if (i < 0) i = NUMPAD.indexOf(code);
    if (i >= 0) return this.answer(two ? 2 : 1, i), true;
    return false;
  }

  answer(slot, i) {
    const a = this.active;
    if (!a || a.answered[slot] !== undefined || (slot === 2 && !this.game.p2)) return;
    const right = a.choices[i] === a.answer;
    a.answered[slot] = { i, right };
    this.game.audio.beep(right ? 1320 : 220, right ? 0.15 : 0.3);
    const players = this.game.p2 ? [1, 2] : [1];
    if (right) {
      a.winner = slot;
      this.end();
    } else if (players.every((p) => a.answered[p] !== undefined)) this.end();
    else this.render();
  }

  // Time up or decided: back to the race, with the penalties and rewards
  end() {
    const g = this.game;
    const a = this.active;
    const players = g.p2 ? [g, g.p2] : [g];
    players.forEach((pl, k) => {
      const slot = k + 1;
      if (a.winner === slot) {
        pl.hud.message(players.length > 1 ? 'FIRST! GO!' : 'RIGHT! TURBO!', 'go', 1.2);
        pl.boostT = 1.2;
        g.stunts.add(pl, 'QUIZ', 500);
      } else {
        pl.freezeT = FREEZE;
        pl.freezeShown = null;
      }
    });
    this.show(a, true);
    g.mode = 'race';
    this.active = null;
    this.nextAt = g.raceTime + rnd(EVERY[0], EVERY[1]);
    setTimeout(() => !this.active && this.hide(), 1100);
  }

  // Per frame (real time, the race is paused)
  update(dt) {
    const a = this.active;
    if (!a) return;
    a.t -= dt;
    if (a.t <= 0) return this.end();
    const bar = this.el?.querySelector('.quiz-time i');
    if (bar) bar.style.width = `${(100 * a.t) / TIME}%`;
  }

  render() {
    this.show(this.active, false);
  }

  show(a, reveal) {
    if (!this.el || !a) return;
    const two = !!this.game.p2;
    this.el.classList.remove('hidden');
    this.el.querySelector('.quiz-q').textContent = `${a.text} = ?`;
    this.el.querySelectorAll('[data-choice]').forEach((b, i) => {
      const keys = two ? `${i + 1} · ${(i + 7) % 10}` : `${i + 1}`;
      const marks = [1, 2]
        .filter((s) => a.answered[s]?.i === i)
        .map((s) => `<em class="p${s}">${two ? `P${s} ` : ''}${a.answered[s].right ? '✓' : '✗'}</em>`)
        .join('');
      b.innerHTML = `<kbd>${keys}</kbd><span>${a.choices[i]}</span>${marks}`;
      b.classList.toggle('right', reveal && a.choices[i] === a.answer);
    });
    this.el.querySelector('.quiz-who').textContent = reveal
      ? a.winner
        ? two ? `PLAYER ${a.winner} FIRST!` : 'RIGHT!'
        : `It was ${a.answer}`
      : two ? 'Player 1: keys 1-4 · Player 2: keys 7 8 9 0' : 'Keys 1-4 or tap an answer';
  }

  hide() {
    this.el?.classList.add('hidden');
  }
}
