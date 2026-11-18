// How strong is each opponent? Plays many games alone on each table and reports average totals.
//   node dev/strength.mjs [games] [table index, 'all', or 'classic']
// 'classic' plays every opponent on Classic rules instead of at its own table, so they can be compared with each other
// (and with the best possible play, which averages 254.59 on these rules).
// Each game rolls from its own seed (as dev/ladder.mjs does), and the opponent and the best settings play the same
// seeds, so a change to how the opponents play moves only the games it touches, not every roll after it. Beside each
// mean: the margin of its 95% interval (1.96 sd / √games), the spread of single games (sd, and the 5th and 95th
// centiles), how often it earned the bonus and how long a game took.
import { Opponent, playTurn } from '../js/ai.js';
import { TABLES, CLASSIC, boardFor } from '../js/tour.js';
import { blankCard, mark, totals, filled } from '../js/rules.js';
import { mulberry32 } from '../js/rng.js';

const GAMES = +(process.argv[2] || 1000), WHICH = process.argv[3] ?? 'all';
const classic = WHICH === 'classic';
const tables = WHICH === 'all' || classic ? TABLES.map((_, i) => i) : [+WHICH];

export function solo(opp, board, rand) {
  let card = blankCard(board);
  while (!filled(board, card)) card = mark(card, playTurn(opp, board, card, rand).option);
  return totals(board, card);
}

const centile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

console.log(`${GAMES} games ${classic ? 'an opponent, on Classic rules' : 'a table'}, each from its own seed: mean ±95% margin [sd, 5th–95th centile], bonus rate, time a game.\n`);
for (const t of tables) {
  const row = [];
  for (const [label, play] of [['own', TABLES[t].play], ['best', { patience: 1, bonus: 1, slip: 0 }]]) {
    const opp = new Opponent(play), got = [];
    let bonus = 0, t0 = performance.now();
    for (let g = 0; g < GAMES; g++) {
      const r = solo(opp, classic ? CLASSIC : boardFor(t, g), mulberry32(((1000 + t) * 104729 + g) >>> 0));
      got.push(r.total); bonus += r.bonus > 0;
    }
    const mean = got.reduce((a, b) => a + b, 0) / GAMES;
    const sd = Math.sqrt(got.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, GAMES - 1));
    const sorted = [...got].sort((a, b) => a - b);
    row.push(`${label} ${mean.toFixed(1)} ±${((1.96 * sd) / Math.sqrt(GAMES)).toFixed(1)} [sd ${sd.toFixed(0)}, ${centile(sorted, 0.05)}–${centile(sorted, 0.95)}] (bonus ${Math.round((100 * bonus) / GAMES)}%, ${((performance.now() - t0) / GAMES).toFixed(0)} ms)`);
  }
  console.log(`${t + 1}. ${classic ? '' : TABLES[t].board.name.padEnd(25)}${TABLES[t].who.name.padEnd(11)} ${row.join('   ')}`);
}
