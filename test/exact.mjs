// The right answer at the end of a game, for checking the opponents' planner against it (test/rules.test.mjs).
//
// best(board, card): the expected final total from here with the best play there is, worked out over every roll,
// every handful kept and every box, to the end of the card. planned(board, card, opp): the expected final total if
// the opponent plays every turn from here as its planner chooses, without its slips. Both are exact, so they're for a
// card with a box or two left: each box open multiplies the work by the cards the next one can leave.
import { options, mark, totals, filled } from '../js/rules.js';
import { STATES, KEEPS, OUTCOMES, plan, ranked } from '../js/ai.js';

const key = (board, card) => board.boxes.map(b => card[b.id] ?? '_').join(',') + '|' + (card.extras || 0);
const expect = (out, v) => { let a = 0; for (const [s, q] of out) a += q * v[s]; return a; };
const ROLL_ALL = OUTCOMES[KEEPS.findIndex(k => k.size === 0)];
const UNIQUE = STATES.map((_, s) => ranked(KEEPS.map(() => 0), s)); // every handful each roll could keep

export function best(board, card, memo = new Map()) {
  if (filled(board, card)) return totals(board, card).total;
  const k = key(board, card);
  if (memo.has(k)) return memo.get(k);
  // With no rolls left: the best box. With r left: the best handful to keep, or stand on what's there.
  let v = STATES.map(s => Math.max(...options(board, card, s.dice).map(o => best(board, mark(card, o), memo))));
  for (let r = 1; r < board.rolls; r++) {
    const kept = OUTCOMES.map(out => expect(out, v));
    v = UNIQUE.map(subs => Math.max(...subs.map(i => kept[i])));
  }
  const res = expect(ROLL_ALL, v);
  memo.set(k, res);
  return res;
}

export function planned(board, card, opp, memo = new Map()) {
  if (filled(board, card)) return totals(board, card).total;
  const k = key(board, card);
  if (memo.has(k)) return memo.get(k);
  const noSlip = () => 1;
  // The box it would score in on each roll, and the keeps it plans, as Opponent.keep() picks them: keeping all five
  // means it stops and scores.
  const scored = STATES.map(s => planned(board, mark(card, opp.box(board, card, s.dice, noSlip)), opp, memo));
  const values = plan(board, card, board.rolls - 1, opp.p);
  let v = scored;
  for (let r = 1; r < board.rolls; r++) {
    const kept = OUTCOMES.map(out => expect(out, v));
    v = STATES.map((_, s) => { const pick = ranked(values[r], s)[0]; return KEEPS[pick].size === 5 ? scored[s] : kept[pick]; });
  }
  const res = expect(ROLL_ALL, v);
  memo.set(k, res);
  return res;
}
