// How much does one extra roll a game help? Plays the rule-of-thumb player (dev/thumb.mjs) and the opponents' planner at
// its best settings against each table's opponent, game g against game g on the same board, once without an extra roll
// and once with one to spend, from the same seeds, so a game differs only from the moment the extra roll is used. The
// opponents never get one. Prints how often each player wins (a tie isn't a win), for each run and on average, and how
// much the extra roll adds to a game's total.
//   node dev/extra.mjs [games] [runs] [table or pair ...]     e.g.  node dev/extra.mjs 2000 3 1 8 two-rolls+wild
// With no tables or pairs named, every table of the tour and a sample of the back room's pairs.
//
// When each spends it, only after its last normal roll, never having stood with rolls in hand:
//   rule of thumb: when the dice are a made hand one die short (four of a number with Five of a kind open or already
//     scored, four in a row with Large straight open, two pairs with Full house open), or on the last turn whenever it
//     would roll again.
//   planner: when one more roll adds at least THRESHOLD points by its own reckoning (the best keep for one roll against
//     standing on the dice), or on the last turn whenever it adds anything. THRESHOLD is 10 unless the environment says
//     otherwise (THRESHOLD=8 node dev/extra.mjs ...): on a trial of 300 games at Classic and Two Rolls, 8 to 12 added the
//     most, 4 spent it too soon on almost nothing and 20 kept it too long.
import { blankCard, mark, totals, filled, turnsLeft } from '../js/rules.js';
import { TABLES, boardFor, backBoard, BACK } from '../js/tour.js';
import { Opponent, playTurn, plan, ranked, stateOf, KEEPS } from '../js/ai.js';
import { mulberry32, mix } from '../js/rng.js';
import { ruleOfThumb } from './thumb.mjs';

const GAMES = +(process.argv[2] || 400), RUNS = +(process.argv[3] || 1), ONLY = process.argv.slice(4);
const THRESHOLD = +(process.env.THRESHOLD || 10);
const SAMPLE = ['two-rolls+wild', 'evens+hot', 'odds+wild', 'two-rolls+pairs', 'sixes+high', 'wild+high'];
const best = new Opponent({ patience: 1, bonus: 1, slip: 0 });

const kept = (dice, counts) => { const left = counts.slice(); return dice.map(d => (left[d] > 0 ? (left[d]--, true) : false)); };
const countsOf = dice => { const c = [0, 0, 0, 0, 0, 0, 0]; for (const d of dice) c[d]++; return c; };

// The rule of thumb's moment: a made hand one die short, or anything worth rolling for on the last turn.
function thumbWants(board, card, dice) {
  const keep = ruleOfThumb.keep(board, card, dice, 1);
  if (!keep) return null;
  if (turnsLeft(board, card) === 1) return keep;
  if (keep.filter(Boolean).length !== 4) return null;
  const four = dice.filter((d, i) => keep[i]), c = countsOf(four), open = kind => board.boxes.some(b => b.kind === kind && card[b.id] === null);
  const five = board.boxes.find(b => b.kind === 'five');
  if (c.includes(4) && (card[five.id] === null || card[five.id] > 0)) return keep;
  const run = [1, 2, 3].some(s => [0, 1, 2, 3].every(j => c[s + j] === 1));
  if (run && open('large')) return keep;
  if (c.filter(n => n === 2).length === 2 && open('full')) return keep;
  return null;
}

// The planner's moment: what one more roll adds by its own reckoning.
function plannerWants(board, card, dice) {
  const k = plan(board, card, 1, best.p)[1], order = ranked(k, stateOf(dice));
  const top = order[0], stand = order.find(i => KEEPS[i].size === 5);
  const gain = k[top] - k[stand];
  return KEEPS[top].size < 5 && (gain >= THRESHOLD || (turnsLeft(board, card) === 1 && gain > 1e-9)) ? kept(dice, KEEPS[top].counts) : null;
}

// A turn as playTurn() plays it, then, with an extra roll in the pocket and the rolls used up, perhaps one more.
function turn(player, wants, board, card, rand, pocket) {
  const die = () => 1 + Math.floor(rand() * 6);
  let dice = Array.from({ length: 5 }, die), stood = false;
  for (let r = board.rolls - 1; r > 0; r--) {
    const keep = player.keep(board, card, dice, r, rand);
    if (!keep) { stood = true; break; }
    dice = dice.map((d, i) => (keep[i] ? d : die()));
  }
  if (!stood && pocket.left > 0) {
    const keep = wants(board, card, dice);
    if (keep) { pocket.left--; pocket.at = 14 - turnsLeft(board, card); dice = dice.map((d, i) => (keep[i] ? d : die())); }
  }
  return player.box(board, card, dice, rand);
}

function game(player, wants, board, rand, extra) {
  const pocket = { left: extra ? 1 : 0, at: 0 };
  let card = blankCard(board);
  while (!filled(board, card)) card = mark(card, turn(player, wants, board, card, rand, pocket));
  return { total: totals(board, card).total, at: pocket.at };
}
const solo = (opp, board, rand) => {
  let card = blankCard(board);
  while (!filled(board, card)) card = mark(card, playTurn(opp, board, card, rand).option);
  return totals(board, card).total;
};

const players = [['rule of thumb', ruleOfThumb, thumbWants, 2], ['planner at its best', best, plannerWants, 3]];
const pct = p => `${(100 * p).toFixed(1)}`;

function measure(label, opp, boardOf) {
  const cells = players.map(() => ({ off: [], on: [], gain: 0, used: 0, at: 0 }));
  for (let r = 0; r < RUNS; r++) {
    const wins = players.map(() => [0, 0]);
    for (let g = 0; g < GAMES; g++) {
      const board = boardOf(r, g), theirs = solo(opp, board, mulberry32(mix(r, g, 1)));
      players.forEach(([, player, wants, seat], i) => {
        const off = game(player, wants, board, mulberry32(mix(r, g, seat)), false);
        const on = game(player, wants, board, mulberry32(mix(r, g, seat)), true);
        wins[i][0] += off.total > theirs;
        wins[i][1] += on.total > theirs;
        cells[i].gain += on.total - off.total;
        if (on.at) { cells[i].used++; cells[i].at += on.at; }
      });
    }
    wins.forEach(([off, on], i) => { cells[i].off.push(off / GAMES); cells[i].on.push(on / GAMES); });
  }
  const n = GAMES * RUNS, mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  const out = cells.map(c => `${pct(mean(c.off))}% → ${pct(mean(c.on))}% (+${pct(mean(c.on) - mean(c.off))}) [${c.off.map(pct).join(' ')} → ${c.on.map(pct).join(' ')}] +${(c.gain / n).toFixed(1)} pts, used ${Math.round((100 * c.used) / n)}% at turn ${(c.at / Math.max(1, c.used)).toFixed(1)}`);
  console.log(`${label.padEnd(30)} ${players.map(([name], i) => `${name}: ${out[i]}`).join('\n'.padEnd(32))}`);
}

console.log(`${GAMES} games a run, ${RUNS} run${RUNS === 1 ? '' : 's'}; planner spends at ${THRESHOLD} points. Win rate without → with one extra roll a game (difference) [each run], points it adds, how often it was spent and on which turn.\n`);
const tables = ONLY.length ? ONLY.filter(x => /^\d+$/.test(x)).map(x => +x - 1) : TABLES.map((_, i) => i);
const pairs = ONLY.length ? ONLY.filter(x => x.includes('+')) : SAMPLE;
for (const t of tables) measure(`${t + 1}. ${TABLES[t].board.name} (${TABLES[t].who.name})`, new Opponent(TABLES[t].play), (r, g) => boardFor(t, mix(r, g, t)));
const dealer = new Opponent(TABLES[BACK - 1].play);
for (const key of pairs) measure(`back room ${key}`, dealer, (r, g) => backBoard(key, mulberry32(mix(r, g, 0xbac))));
