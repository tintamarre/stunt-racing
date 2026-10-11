// Math quiz: questions have a whole, non-negative answer and four distinct choices including it.
import { makeQuestion, makeChoices } from '../src/quiz.js';

let failed = 0;
for (const level of ['easy', 'medium', 'hard']) {
  const samples = [];
  for (let i = 0; i < 2000; i++) {
    const q = makeQuestion(level);
    const c = makeChoices(q.answer);
    const ok = Number.isInteger(q.answer) && q.answer >= 0 && c.length === 4 && new Set(c).size === 4 && c.includes(q.answer) && c.every((x) => x >= 0);
    if (!ok) {
      failed++;
      if (failed < 5) console.log('BAD', level, q, c);
    }
    if (i < 4) samples.push(`${q.text} = ${q.answer} [${c.join(', ')}]`);
  }
  console.log(level.padEnd(7), samples.join(' · '));
}
console.log(`${failed} bad question(s)`);
process.exit(failed ? 1 : 0);
