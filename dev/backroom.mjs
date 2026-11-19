// How hard is each table the back room can draw? For every two twists that can come up together (js/tour.js, PAIRS),
// plays the rule-of-thumb player (dev/thumb.mjs) against the Dealer, game g against game g on the same board, and prints
// how often it wins (a tie isn't a win), once for each run of games from its own seeds and on average.
//   node dev/backroom.mjs [games] [runs] [pair ...]       e.g.  node dev/backroom.mjs 2000 3 two-rolls+wild
// The back room is meant to sit where the Dealer's own table does: the rule-of-thumb player there wins about 37% of games
// (npm run sim), and every pair should keep it between 25% and 50%.
import { blankCard, mark, totals, filled } from '../js/rules.js';
import { TABLES, PAIRS, backBoard, BACK } from '../js/tour.js';
import { Opponent, playTurn } from '../js/ai.js';
import { mulberry32, mix } from '../js/rng.js';
import { ruleOfThumb } from './thumb.mjs';

const GAMES = +(process.argv[2] || 400), RUNS = +(process.argv[3] || 1), ONLY = process.argv.slice(4);
const dealer = new Opponent(TABLES[BACK - 1].play);

function game(player, board, rand) {
  let card = blankCard(board);
  while (!filled(board, card)) card = mark(card, playTurn(player, board, card, rand).option);
  return totals(board, card).total;
}

console.log(`${GAMES} games a run, ${RUNS} run${RUNS === 1 ? '' : 's'}: how often the rule-of-thumb player beats the Dealer.\n`);
for (const key of ONLY.length ? ONLY : PAIRS) {
  const runs = [];
  let me = 0, him = 0, bonus = 0;
  for (let r = 0; r < RUNS; r++) {
    let won = 0;
    for (let g = 0; g < GAMES; g++) {
      const board = backBoard(key, mulberry32(mix(r, g, 0xbac)));
      const a = game(ruleOfThumb, board, mulberry32(mix(r, g, 2))), b = game(dealer, board, mulberry32(mix(r, g, 1)));
      won += a > b;
      me += a; him += b;
      bonus += board.bonus.at;
    }
    runs.push(won / GAMES);
  }
  const n = GAMES * RUNS, mean = runs.reduce((a, b) => a + b, 0) / RUNS;
  const flag = mean < 0.25 ? '  too hard' : mean > 0.5 ? '  too easy' : '';
  console.log(`${key.padEnd(18)} ${runs.map(p => `${(100 * p).toFixed(1)}%`.padStart(6)).join(' ')}   mean ${(100 * mean).toFixed(1)}%   (scores ${(me / n).toFixed(0)} to the Dealer's ${(him / n).toFixed(0)}, bonus at ${(bonus / n).toFixed(0)})${flag}`);
}
