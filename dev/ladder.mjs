// How hard is each table of the tour? Plays each table's opponent, a rule-of-thumb player and the opponents' own
// planner at its best settings, and prints how often each player beats the opponent at that table.
//   node dev/ladder.mjs [games]        or  npm run sim
// The rule-of-thumb player (dev/thumb.mjs) stands in for a person who knows the game.
import { blankCard, mark, totals, filled } from '../js/rules.js';
import { TABLES, boardFor } from '../js/tour.js';
import { Opponent, playTurn } from '../js/ai.js';
import { mulberry32 } from '../js/rng.js';
import { ruleOfThumb } from './thumb.mjs';

const GAMES = +(process.argv[2] || 400);

// Game g at a table is played on boardFor(table, g), so at Hot Boxes everyone's game g has the same hot boxes.
function play(player, table, games, who) {
  const out = [];
  for (let g = 0; g < games; g++) {
    const board = boardFor(table, g), rand = mulberry32((who * 7919 + table * 104729 + g) >>> 0);
    let card = blankCard(board);
    while (!filled(board, card)) card = mark(card, playTurn(player, board, card, rand).option);
    out.push(totals(board, card).total);
  }
  return out;
}

// How often a total from `mine` beats one from `theirs` (a tie is a replay, so it isn't a win), and the margin of a
// 95% interval: every game against every game on a fixed table (Hanley and McNeil's interval), game g against game g
// at Hot Boxes.
function wins(mine, theirs, sameBoards) {
  const m = mine.length, n = theirs.length;
  if (sameBoards) { const p = mine.filter((x, g) => x > theirs[g]).length / m; return { p, margin: 1.96 * Math.sqrt((p * (1 - p)) / m) }; }
  const sorted = [...theirs].sort((a, b) => a - b);
  let won = 0;
  for (const x of mine) {
    let lo = 0, hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < x) lo = mid + 1; else hi = mid; }
    won += lo;
  }
  const p = won / (m * n), q1 = p / (2 - p), q2 = (2 * p * p) / (1 + p);
  return { p, margin: 1.96 * Math.sqrt((p * (1 - p) + (m - 1) * (q1 - p * p) + (n - 1) * (q2 - p * p)) / (m * n)) };
}

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const players = [['rule of thumb', ruleOfThumb, GAMES], ['planner at its best', new Opponent({ patience: 1, bonus: 1, slip: 0 }), Math.ceil(GAMES / 4)]];
console.log(`${GAMES} games of each opponent and the rule-of-thumb player, ${players[1][2]} of the planner, at each table.\n`);
console.log(`${'table'.padEnd(26)} ${'opponent'.padEnd(11)} ${'mean'.padStart(5)}   ${players.map(([name]) => name.padEnd(24)).join('')}`);
const clear = players.map(() => 0);
for (let t = 0; t < TABLES.length; t++) {
  const { board, who, play: settings } = TABLES[t];
  const theirs = play(new Opponent(settings), t, GAMES, 1);
  const cells = players.map(([, player, games], i) => {
    const mine = play(player, t, games, 2 + i);
    const { p, margin } = board.hot ? wins(mine, theirs.slice(0, games), true) : wins(mine, theirs, false);
    clear[i] += 1 / p;
    return `${(100 * p).toFixed(0)}% ±${(100 * margin).toFixed(0)} (mean ${mean(mine).toFixed(0)})`.padEnd(24);
  });
  console.log(`${`${t + 1}. ${board.name}`.padEnd(26)} ${who.name.padEnd(11)} ${mean(theirs).toFixed(0).padStart(5)}   ${cells.join('')}`);
}
console.log(`\nGames to clear the whole tour, on average: ${players.map(([name], i) => `${name} ${clear[i].toFixed(1)}`).join(', ')}.`);
