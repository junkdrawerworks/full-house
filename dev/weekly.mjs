// How hard is each table of the tour with each week's twist on it? For every table and every twist the week can draw
// (js/tour.js, weekBoard()), plays the rule-of-thumb player (dev/thumb.mjs) against that table's own opponent, game g
// against game g on the same board, and prints how often it wins (a tie isn't a win), as a table of tables by twists.
// "as is" is the table with no twist, played the same way, to compare with; a cell in brackets is a week whose twist
// doesn't change that table, which plays as it is.
//   node dev/weekly.mjs [games] [runs] [table ...]       e.g.  node dev/weekly.mjs 2000 3       or  ... 500 1 1 8
// Tables are counted from 1. Each cell's runs come from their own seeds; the line under each table gives each run.
import { blankCard, mark, totals, filled } from '../js/rules.js';
import { TABLES, TWISTS, boardFor, weekBoard, changes } from '../js/tour.js';
import { Opponent, playTurn } from '../js/ai.js';
import { mulberry32, mix } from '../js/rng.js';
import { ruleOfThumb } from './thumb.mjs';

const GAMES = +(process.argv[2] || 400), RUNS = +(process.argv[3] || 1);
const ONLY = process.argv.slice(4).map(n => +n - 1);
const KEYS = Object.keys(TWISTS);

function game(player, board, rand) {
  let card = blankCard(board);
  while (!filled(board, card)) card = mark(card, playTurn(player, board, card, rand).option);
  return totals(board, card).total;
}

// How often the rule-of-thumb player wins at table t with the twist `key` (null: none), run by run.
function cell(t, key) {
  const opp = new Opponent(TABLES[t].play), runs = [];
  for (let r = 0; r < RUNS; r++) {
    let won = 0;
    for (let g = 0; g < GAMES; g++) {
      const seed = mix(r, g, t, 0x3eec) & 0x7fffffff, board = key ? weekBoard(t, seed, key) : boardFor(t, seed);
      won += game(ruleOfThumb, board, mulberry32(mix(r, g, 2))) > game(opp, board, mulberry32(mix(r, g, 1)));
    }
    runs.push(won / GAMES);
  }
  return runs;
}

const pc = p => `${(100 * p).toFixed(0)}%`;
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log(`${GAMES} games a run, ${RUNS} run${RUNS === 1 ? '' : 's'}: how often the rule-of-thumb player beats each table's opponent, with each week's twist.`);
console.log(`(95% margin of a cell about ±${(196 * Math.sqrt(0.25 / (GAMES * RUNS))).toFixed(0)} points at most.)\n`);
console.log(`${'table'.padEnd(26)}${'as is'.padStart(7)}${KEYS.map(k => k.padStart(10)).join('')}`);
for (let t = 0; t < TABLES.length; t++) {
  if (ONLY.length && !ONLY.includes(t)) continue;
  const plain = cell(t, null), row = [mean(plain)], each = [`as is ${plain.map(pc).join(' ')}`];
  for (const key of KEYS) {
    if (!changes(t, key)) { row.push(null); continue; }
    const runs = cell(t, key);
    row.push(mean(runs));
    each.push(`${key} ${runs.map(pc).join(' ')}`);
  }
  console.log(`${`${t + 1}. ${TABLES[t].board.name}`.padEnd(26)}${row.map((p, i) => (p === null ? `(${pc(row[0])})` : pc(p)).padStart(i ? 10 : 7)).join('')}`);
  if (RUNS > 1) console.log(`    runs: ${each.join(', ')}`);
}
