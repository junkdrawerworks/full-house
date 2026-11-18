// The rules, the tables and the opponents, checked in Node:  node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { score, options, jokerState, blankCard, mark, totals, filled, fiveOf, boxHint } from '../js/rules.js';
import { TABLES, CLASSIC, boardFor } from '../js/tour.js';
import { Opponent, playTurn } from '../js/ai.js';
import { mulberry32 } from '../js/rng.js';
import { best, planned } from './exact.mjs';

const box = (board, id) => board.boxes.find(b => b.id === id);
const s = (id, dice, board = CLASSIC) => score(board, box(board, id), dice);

test('the classic boxes score as on the pad', () => {
  assert.equal(s('f3', [3, 3, 1, 3, 6]), 9);
  assert.equal(s('three', [5, 5, 5, 1, 2]), 18);
  assert.equal(s('three', [5, 5, 4, 1, 2]), 0);
  assert.equal(s('four', [2, 2, 2, 2, 6]), 14);
  assert.equal(s('full', [2, 2, 3, 3, 3]), 25);
  assert.equal(s('full', [3, 3, 3, 3, 3]), 0, 'five of a kind is not a full house by itself');
  assert.equal(s('small', [1, 2, 3, 4, 6]), 30);
  assert.equal(s('small', [3, 4, 5, 6, 6]), 30);
  assert.equal(s('small', [1, 2, 3, 5, 6]), 0);
  assert.equal(s('large', [2, 3, 4, 5, 6]), 40);
  assert.equal(s('large', [1, 2, 3, 4, 6]), 0);
  assert.equal(s('five', [4, 4, 4, 4, 4]), 50);
  assert.equal(s('chance', [6, 5, 4, 3, 1]), 19);
});

test('the top-section bonus comes at 63, and the totals add up', () => {
  let card = blankCard(CLASSIC);
  for (const [id, v] of [['f1', 3], ['f2', 6], ['f3', 9], ['f4', 12], ['f5', 15], ['f6', 18]]) card = mark(card, { box: box(CLASSIC, id), score: v, extra: 0 });
  card = mark(card, { box: box(CLASSIC, 'chance'), score: 22, extra: 0 });
  assert.deepEqual(totals(CLASSIC, card), { upper: 63, bonus: 35, lower: 22, extras: 0, total: 120 });
});

test('a second five of a kind: the extra bonus, then the joker rules', () => {
  let card = blankCard(CLASSIC);
  card = mark(card, { box: box(CLASSIC, 'five'), score: 50, extra: 0 });
  // Its own number's box is open, so it must go there.
  let opts = options(CLASSIC, card, [4, 4, 4, 4, 4]);
  assert.deepEqual(opts.map(o => [o.box.id, o.score, o.extra]), [['f4', 20, 100]]);
  // With that box filled, any bottom box, and a full house or straight counts in full.
  card = mark(card, { box: box(CLASSIC, 'f4'), score: 8, extra: 0 });
  opts = options(CLASSIC, card, [4, 4, 4, 4, 4]);
  const by = Object.fromEntries(opts.map(o => [o.box.id, o.score]));
  assert.deepEqual(by, { three: 20, four: 20, full: 25, small: 30, large: 40, chance: 20 });
  assert.ok(opts.every(o => o.extra === 100));
  // No bonus if the five-of-a-kind box was crossed out with a zero.
  const zeroed = mark(blankCard(CLASSIC), { box: box(CLASSIC, 'five'), score: 0, extra: 0 });
  assert.ok(options(CLASSIC, zeroed, [2, 2, 2, 2, 2]).every(o => o.extra === 0));
  card = mark(card, opts.find(o => o.box.id === 'large'));
  assert.equal(totals(CLASSIC, card).extras, 100);
});

test('wild ones count as whatever scores best, but only in the bottom section', () => {
  const wild = TABLES[4].board;
  assert.equal(wild.wild, true);
  assert.equal(s('f1', [1, 1, 3, 4, 5], wild), 2, 'a 1 is a 1 on top');
  assert.equal(s('large', [1, 2, 3, 5, 6], wild), 40, 'the 1 fills the 4');
  assert.equal(s('full', [1, 1, 3, 3, 6], wild), 25);
  assert.equal(s('five', [1, 6, 6, 1, 6], wild), 50);
  assert.equal(s('four', [1, 6, 6, 2, 6], wild), 26, 'the 1 counts as a 6');
  assert.equal(fiveOf(wild, [1, 6, 6, 1, 6]), 0, 'only a true five of a kind earns the extra bonus');
  // With Five of a kind scored, a five of a kind made with a 1 earns no extra 100, and the table says so.
  const card = mark(blankCard(wild), { box: box(wild, 'five'), score: 50, extra: 0 });
  assert.ok(options(wild, card, [1, 6, 6, 6, 6]).every(o => o.extra === 0));
  assert.deepEqual(options(wild, card, [6, 6, 6, 6, 6]).map(o => o.extra), [100]);
  assert.match(wild.blurb, /extra 100 for another five of a kind needs five dice showing the same number/);
});

test('every table is a complete board; the twists are what they say', () => {
  for (const t of TABLES) {
    const b = boardFor(TABLES.indexOf(t), 7);
    assert.equal(b.boxes.length, 13, t.board.name);
    assert.equal(new Set(b.boxes.map(x => x.id)).size, 13, t.board.name);
    assert.ok(b.boxes.some(x => x.kind === 'five'), t.board.name);
  }
  const evens = TABLES[1].board;
  assert.equal(s('evens', [2, 4, 4, 5, 1], evens), 10);
  assert.equal(s('f6', [6, 6, 1, 2, 3], TABLES[2].board), 36, 'triple sixes');
  assert.match(TABLES[2].board.blurb, /bonus needs 99: three of each number still earns it/, 'the table says what 99 is');
  assert.equal(TABLES[3].board.rolls, 2);
  assert.equal(TABLES[3].board.bonus.at, 52, 'two rolls: the bonus needs 52, a real target in two-roll turns');
  assert.match(TABLES[3].board.blurb, /The top-section bonus needs 52\./, 'the table says so when you sit down');
  assert.equal(TABLES[7].board.extra, 100, 'high stakes: the extra for another five of a kind is not doubled');
  assert.match(TABLES[7].board.blurb, /The extra for another five of a kind stays at 100\./, 'and the table says so');
  const pairs = TABLES[6].board;
  assert.equal(s('pairs', [5, 5, 3, 3, 1], pairs), 16);
  assert.equal(s('pairs', [5, 5, 5, 3, 1], pairs), 0);
  assert.equal(s('pairs', [5, 5, 5, 3, 3], pairs), 16, 'a full house holds two pairs');
  assert.equal(s('pairs', [6, 6, 6, 6, 2], pairs), 24, 'four of one number are two pairs of it');
  assert.equal(s('pairs', [2, 2, 2, 2, 6], pairs), 8);
  assert.equal(s('pairs', [4, 4, 4, 4, 4], pairs), 16, 'and so is a first five of a kind');
  assert.equal(s('low', [1, 2, 3, 2, 4], pairs), 30);
  assert.equal(s('low', [6, 2, 3, 2, 4], pairs), 0);
  // Hot boxes: two boxes at three times, the same two for the same seed.
  const hot = boardFor(5, 42), again = boardFor(5, 42);
  assert.equal(hot.boxes.filter(x => x.mult === 3).length, 2);
  assert.deepEqual(hot.boxes, again.boxes);
  const hotTop = hot.boxes.filter(x => x.mult === 3 && x.kind === 'face');
  assert.equal(hot.bonus.at, 63 + hotTop.reduce((a, x) => a + 6 * x.face, 0));
  assert.match(TABLES[5].board.blurb, /bonus rises so three of each number still earns it/, 'the table says the bonus moves, and by how much');
});

test('opponents only ever score where the rules allow, and fill the card in thirteen turns', () => {
  const rand = mulberry32(3);
  for (const t of [0, 4, 7]) {
    const board = boardFor(t, 1), opp = new Opponent(TABLES[t].play);
    let card = blankCard(board), turns = 0;
    while (!filled(board, card)) {
      const { dice, option } = playTurn(opp, board, card, rand);
      assert.ok(options(board, card, dice).some(o => o.box.id === option.box.id && o.score === option.score));
      card = mark(card, option);
      turns++;
    }
    assert.equal(turns, 13);
  }
});

test('a first-turn five of a kind goes in Five of a kind for 50, not in its number box', () => {
  const noSlip = () => 0.99;
  for (const t of TABLES) {
    const opp = new Opponent(t.play);
    for (let f = 1; f <= 6; f++) {
      const o = opp.box(CLASSIC, blankCard(CLASSIC), [f, f, f, f, f], noSlip);
      assert.equal(o.box.kind, 'five', `${t.who.name} wrote five ${f}s in ${o.box.id}`);
    }
  }
});

test('an opponent’s slips are ones a person might make: never rolling again on a made five of a kind, nor writing 0 with 25 on offer', () => {
  // Made to slip at every chance (rand() is always 0), on part-filled cards at each opponent's own table.
  const slip = () => 0, rand = mulberry32(77), MADE = ['full', 'small', 'large', 'five'];
  let made = 0;
  for (let t = 0; t < TABLES.length; t++) {
    const opp = new Opponent({ ...TABLES[t].play, endgame: false }), sharp = new Opponent({ ...TABLES[t].play, endgame: false, slip: 0 });
    for (let n = 0; n < 12; n++) {
      // A card from a few turns of the opponent's own play, so the scores in it are ones a game leaves.
      const board = boardFor(t, n);
      let card = blankCard(board);
      for (let k = Math.floor(rand() * 9); k > 0; k--) card = mark(card, playTurn(sharp, board, card, rand).option);
      const five = board.boxes.find(b => b.kind === 'five');
      for (let f = 1; f <= 6; f++) {
        const dice = [f, f, f, f, f], where = `${TABLES[t].who.name} at ${board.name}, five ${f}s, card ${JSON.stringify(card)}`;
        // Five of a kind open, or holding a score so another one earns the extra: there's no reason to roll again.
        if (card[five.id] !== 0) for (let r = 1; r < board.rolls; r++) assert.equal(opp.keep(board, card, dice, r, slip), null, `${where}: rolled again with ${r} to go`);
      }
      for (let d = 0; d < 60; d++) {
        const dice = Array.from({ length: 5 }, () => 1 + Math.floor(rand() * 6)), opts = options(board, card, dice);
        // A made hand on offer: a full house, a straight or five of a kind. (Not any 25: two 6s in Sixes at Triple
        // Sixes are 36 but short of par there, and 0 in Four of a kind is a fair place for that roll.)
        if (!opts.some(o => MADE.includes(o.box.kind) && o.score >= 25)) continue;
        const best = sharp.box(board, card, dice, slip), got = opp.box(board, card, dice, slip);
        if (best.score > 0) assert.ok(got.score > 0, `${TABLES[t].who.name} at ${board.name} wrote 0 in ${got.box.id} with ${opts.map(o => `${o.box.id} ${o.score}`).join(', ')} on offer (${dice.join('-')})`);
        made++;
      }
    }
  }
  assert.ok(made > 300, `only ${made} made hands tried`);
});

// A card with every box filled but those in `open`: the top boxes as given, the bottom ones with scores a game might
// have left there (times the table's multiplier).
const BOTTOM = { three: 20, four: 15, full: 25, small: 30, large: 40, five: 50, chance: 22, pairs: 20, low: 30 };
function cardWith(board, open, top) {
  const card = blankCard(board);
  for (const b of board.boxes) if (!open.includes(b.id)) card[b.id] = top[b.id] ?? BOTTOM[b.kind] * (b.mult || 1);
  return card;
}

test('on the last turn the planner keeps dice within half a point of the best play there is', () => {
  // test/exact.mjs works out the best expected final total over every roll and keep, and what the planner's own
  // choices come to, without its slips. Some cards have the top-section bonus at stake on the last box, some don't.
  // The sharpest opponents work the last two turns out exactly; the judgement every opponent uses before that, and
  // the others to the end, is checked here too.
  const top = { f1: 3, f2: 6, f3: 9, f4: 12, f5: 15, f6: 18 };
  const cases = [
    [0, 'f6', { ...top, f6: null }], // Classic, 45 on top: Sixes needs three sixes for the bonus
    [0, 'f4', { ...top, f4: null }], // 51 on top: Fours needs three
    [0, 'f2', { ...top, f2: null }], // 57 on top: Twos needs three
    [0, 'large', { ...top, f6: 12 }], // no bonus to play for
    [0, 'five', { ...top, f6: 12 }],
    [4, 'f1', { ...top, f1: null }], // Wild Ones, 60 on top: Ones needs three, and on top a 1 is just a 1
    [4, 'small', { ...top, f5: 10 }],
    [3, 'f5', { ...top, f5: null }], // Two Rolls, 48 on top: Fives needs three in two rolls
    [3, 'five', { ...top, f5: 10 }],
    [7, 'f4', { ...top, f4: null }], // High Stakes, 51 on top: Fours needs three in four rolls
    [7, 'f6', { ...top, f6: null }], // 45 on top: Sixes needs three
    [7, 'large', { ...top, f2: 4 }],
    [7, 'chance', { ...top, f2: 4 }],
  ];
  for (const [t, open, scores] of cases) {
    const board = boardFor(t, 0), card = cardWith(board, [open], scores), right = best(board, card);
    for (const [who, play] of [['the planner’s judgement at its best', { patience: 1, bonus: 1, endgame: false }], [TABLES[t].who.name, TABLES[t].play]]) {
      if (play.look === false) continue;
      const got = planned(board, card, new Opponent(play));
      assert.ok(got <= right + 1e-9, `the exact check is wrong: ${got} beats the best play, ${right}`);
      assert.ok(right - got < 0.5, `${who} at ${board.name} with ${open} left expects ${got.toFixed(2)}, the best play ${right.toFixed(2)}`);
    }
  }
});

test('an opponent doesn’t spend a box that has more to give on a bonus it would get anyway', () => {
  // Reaching the top-section bonus with a box counted the whole 35, even when the bonus was in easy reach later. This
  // is the judgement an opponent uses with three boxes or more left (and Maud, Bea and Sol to the end), checked on
  // cards with two left, where the best play there is can be worked out.
  // Wren, two boxes left, 62 of 63 on top: 2 in Twos takes the bonus, but the straight is 40, and one 2 or better in
  // Twos next turn still takes it. The best play there is says the straight, by about 29 points.
  const pairs = TABLES[6].board, noSlip = () => 1;
  const wren = cardWith(pairs, ['f2', 'large'], { f1: 2, f3: 9, f4: 12, f5: 15, f6: 24, four: 0, five: 0 });
  // Classic, two boxes left, 53 on top: five 5s are 25 in Fives and the bonus, or 50 in Five of a kind, with two 5s
  // next turn enough for the bonus.
  const classic = cardWith(CLASSIC, ['f5', 'five'], { f1: 3, f2: 6, f3: 9, f4: 12, f6: 23 });
  for (const [who, play, board, card, dice, want] of [
    ['Wren', { ...TABLES[6].play, endgame: false }, pairs, wren, [3, 4, 6, 5, 2], 'large'],
    ['the planner at its best', { patience: 1, bonus: 1, endgame: false }, CLASSIC, classic, [5, 5, 5, 5, 5], 'five'],
  ]) {
    const opts = options(board, card, dice).map(o => ({ id: o.box.id, worth: best(board, mark(card, o)) })).sort((a, b) => b.worth - a.worth);
    assert.equal(opts[0].id, want, `the best play there is takes ${opts[0].id}`);
    const opp = new Opponent(play), got = opp.box(board, card, dice, noSlip).box.id;
    assert.equal(got, want, `${who} wrote ${dice.join('-')} in ${got}: ${opts.map(o => `${o.id} leads to ${o.worth.toFixed(1)}`).join(', ')}`);
    // And over the two turns, the planner's own play comes within half a point of the best there is.
    const right = best(board, card), mine = planned(board, card, opp);
    assert.ok(right - mine < 0.5, `${who} expects ${mine.toFixed(2)} from here, the best play ${right.toFixed(2)}`);
  }
});

test('with two boxes left the sharpest opponents play it out exactly, and don’t hold on to a bonus out of reach', () => {
  // The Dealer at High Stakes, Fives and Large straight open, 17 needed on top, rolls 2-3-4-4-5. Judging by how near
  // the bonus is, he crossed out the doubled straight to keep Fives for four 5s; 5 in Fives leaves him the straight
  // with four rolls, and about 16 points more to expect.
  const high = TABLES[7].board, noSlip = () => 1, dice = [2, 3, 4, 4, 5];
  const card = cardWith(high, ['f5', 'large'], { f1: 3, f2: 4, f3: 9, f4: 12, f6: 18, five: 0 });
  const after = Object.fromEntries(options(high, card, dice).map(o => [o.box.id, best(high, mark(card, o))]));
  assert.ok(after.f5 > after.large + 10, `the best play there is: ${JSON.stringify(after)}`);
  const dealer = new Opponent(TABLES[7].play);
  assert.equal(dealer.box(high, card, dice, noSlip).box.id, 'f5', 'the Dealer crossed out Large straight');
  // From any card with a box or two left, his play is the best there is, and so is Wren's, Otto's and Jules's.
  for (const t of [4, 5, 6, 7]) {
    const opp = new Opponent(TABLES[t].play), board = boardFor(t, 3);
    assert.ok(opp.p.endgame, `${TABLES[t].who.name} doesn’t work the end out`);
    const cards = [cardWith(board, ['f6', 'chance'], { f1: 2, f2: 6, f3: 9, f4: 12, f5: 10 }), cardWith(board, ['four'], { f1: 3, f2: 6, f3: 9, f4: 12, f5: 15, f6: 18 })];
    if (t === 7) cards.push(card);
    for (const c of cards) {
      const right = best(board, c), got = planned(board, c, opp);
      assert.ok(Math.abs(right - got) < 1e-6, `${TABLES[t].who.name} expects ${got.toFixed(3)} from here, the best play ${right.toFixed(3)}`);
    }
  }
  assert.ok(!new Opponent(TABLES[3].play).p.endgame, 'Sol judges to the end');
});

test('when rolling again can’t do better than the dice already there, an opponent stands', () => {
  // At Wild Ones 1-1-1-1-2 is already 50 in Five of a kind, and so is anything the 2 could become; Jules held four
  // and rolled the fifth die for the same 50.
  const wild = TABLES[4].board;
  for (const [who, play] of [['Jules', TABLES[4].play], ['the planner at its best', {}]]) {
    const opp = new Opponent(play);
    for (const rolls of [1, 2]) assert.equal(opp.keep(wild, blankCard(wild), [1, 1, 1, 1, 2], rolls, () => 1), null, `${who} rolls again with ${rolls} to go`);
  }
});

test('the opponents get better as the tour goes on, each one on classic rules', () => {
  // Each opponent's average over the same 600 games' worth of dice (game g rolls from its own seed). Over 3,000 other
  // games on the same dice the steps from Pip up are about 37, 16, 5, 3, 18, 5 and 4 points: the closest neighbours
  // are Sol and Jules (Jules's slips are as many as that allows), then the Dealer, Wren and Otto, and Bea and Sol.
  // From these seeds the closest step is 4.9, enough to stay in order without the test taking long (about 50 seconds).
  const avg = play => {
    const opp = new Opponent(play);
    let sum = 0;
    for (let g = 0; g < 600; g++) {
      const rand = mulberry32(2 * 100003 + g);
      let card = blankCard(CLASSIC);
      while (!filled(CLASSIC, card)) card = mark(card, playTurn(opp, CLASSIC, card, rand).option);
      sum += totals(CLASSIC, card).total;
    }
    return sum / 600;
  };
  const means = TABLES.map(t => avg(t.play)), line = TABLES.map((t, i) => `${t.who.name} ${means[i].toFixed(1)}`).join(', ');
  for (let i = 1; i < means.length; i++) assert.ok(means[i] > means[i - 1], `the ladder doesn't climb: ${line}`);
  assert.ok(means[7] > 220, `the Dealer averages ${means[7]}`);
  assert.ok(means[0] < 170, `Pip averages ${means[0]}`);
});

test('a box’s hint on the pad says what it pays at that table', () => {
  // A roll that makes each fixed-score box, and one for the boxes that add up the dice.
  const makes = { full: [2, 2, 3, 3, 3], small: [1, 2, 3, 4, 6], large: [1, 2, 3, 4, 5], five: [4, 4, 4, 4, 4], low: [1, 1, 2, 2, 3] };
  // Every table, and Hot Boxes with every box it can make hot.
  const boards = TABLES.map((_, i) => boardFor(i, 7));
  for (let seed = 0, seen = new Set(); seen.size < 11; seed++) {
    const b = boardFor(5, seed), hot = b.boxes.filter(x => x.mult > 1).map(x => x.id);
    if (hot.some(id => !seen.has(id))) { hot.forEach(id => seen.add(id)); boards.push(b); }
  }
  for (const board of boards) {
    for (const b of board.boxes) {
      const hint = boxHint(b, board), m = b.mult || 1, where = `${board.name}, ${b.id} ×${m}: “${hint}”`;
      if (b.kind in makes) {
        assert.equal(+hint.match(/(\d+)$/)[1], score(board, b, makes[b.kind]), where);
      } else if (b.kind === 'face') {
        assert.equal(hint, m === 3 ? `Three times the ${['', 'ones', 'twos', 'threes', 'fours', 'fives', 'sixes'][b.face]}` : '', where);
        const other = b.face === 6 ? 5 : 6;
        assert.equal(score(board, b, [b.face, b.face, b.face, other, other]), 3 * b.face * m, where);
      } else {
        assert.match(hint, /^(Total of all dice|Total of the four paired dice|Add up the even dice)/, where);
        assert.equal(hint.endsWith(', tripled'), m === 3, where);
        assert.equal(hint.endsWith(', doubled'), m === 2, where);
        assert.equal(hint.includes('1s wild'), !!board.wild, where);
      }
    }
  }
  // High Stakes: the bottom section pays double, and the hints say so.
  const high = TABLES[7].board;
  assert.equal(boxHint(box(high, 'full'), high), 'Three and a pair: 50');
  assert.equal(boxHint(box(high, 'five'), high), 'All five the same: 100');
  assert.equal(boxHint(box(high, 'chance'), high), 'Total of all dice, doubled');
  assert.equal(boxHint(box(TABLES[2].board, 'f6'), TABLES[2].board), 'Three times the sixes');
  assert.equal(boxHint(box(TABLES[4].board, 'three'), TABLES[4].board), 'Total of all dice, 1s wild');
});

// ---- the rules against a second reading of them ----

// An independent scorer, written from the README and How to play rather than from js/rules.js: each box's score by
// brute force (a wild 1 tried as every number), and where a second five of a kind may go.
const ORACLE = (() => {
  const upper = b => ['face', 'evens', 'odds'].includes(b.kind);
  const raw = (b, d) => {
    const c = [0, 0, 0, 0, 0, 0, 0];
    d.forEach(x => c[x]++);
    const tot = d.reduce((a, x) => a + x, 0), most = Math.max(...c), has = (...fs) => fs.every(f => c[f]);
    const pairs = [6, 5, 4, 3, 2, 1].flatMap(f => (c[f] >= 4 ? [f, f] : c[f] >= 2 ? [f] : [])); // four of one number: two pairs of it
    return {
      face: () => c[b.face] * b.face, evens: () => d.filter(x => x % 2 === 0).reduce((a, x) => a + x, 0), odds: () => d.filter(x => x % 2).reduce((a, x) => a + x, 0),
      three: () => (most >= 3 ? tot : 0), four: () => (most >= 4 ? tot : 0),
      full: () => ([...c].filter(n => n).sort().join() === '2,3' ? 25 : 0),
      small: () => (has(1, 2, 3, 4) || has(2, 3, 4, 5) || has(3, 4, 5, 6) ? 30 : 0), large: () => (has(1, 2, 3, 4, 5) || has(2, 3, 4, 5, 6) ? 40 : 0),
      five: () => (most === 5 ? 50 : 0), chance: () => tot, pairs: () => (pairs.length >= 2 ? 2 * (pairs[0] + pairs[1]) : 0), low: () => (tot <= 12 ? 30 : 0),
    }[b.kind]();
  };
  const score = (board, b, d) => {
    let best = raw(b, d);
    if (board.wild && !upper(b)) {
      const ones = d.map((x, i) => (x === 1 ? i : -1)).filter(i => i >= 0);
      for (let m = 0; m < 6 ** ones.length; m++) {
        const e = d.slice();
        ones.forEach((i, k) => { e[i] = 1 + (Math.floor(m / 6 ** k) % 6); });
        best = Math.max(best, raw(b, e));
      }
    }
    return best * (b.mult || 1);
  };
  const options = (board, card, d) => {
    const open = board.boxes.filter(b => card[b.id] === null), fiveBox = board.boxes.find(b => b.kind === 'five');
    const all = (bs, extra, s = b => score(board, b, d)) => bs.map(b => `${b.id}:${s(b)}:${extra}`).sort().join();
    if (!(d.every(x => x === d[0]) && card[fiveBox.id] !== null)) return all(open, 0);
    const extra = card[fiveBox.id] > 0 ? board.extra : 0, own = open.find(b => b.kind === 'face' && b.face === d[0]);
    if (own) return all([own], extra);
    const low = open.filter(b => !upper(b)), whole = { full: 25, small: 30, large: 40, pairs: 4 * d[0] };
    if (low.length) return all(low, extra, b => (b.kind in whole ? whole[b.kind] * (b.mult || 1) : score(board, b, d)));
    return all(open, extra);
  };
  const most = b => ({ face: 5 * b.face, evens: 30, odds: 25, three: 30, four: 30, full: 25, small: 30, large: 40, five: 50, chance: 30, pairs: 24, low: 30 })[b.kind] * (b.mult || 1);
  return { score, options, most };
})();
const ROLLS = [];
for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) for (let c = b; c <= 6; c++) for (let d = c; d <= 6; d++) for (let e = d; e <= 6; e++) ROLLS.push([a, b, c, d, e]);

test('the boxes on offer and their scores agree with a second reading of the rules, on part-filled cards at every table', () => {
  assert.equal(ROLLS.length, 252);
  const rand = mulberry32(42);
  let jokers = 0;
  for (let t = 0; t < TABLES.length; t++) {
    for (let n = 0; n < 40; n++) {
      const board = boardFor(t, (rand() * 2 ** 31) | 0), card = blankCard(board), p = rand();
      for (const b of board.boxes) if (rand() < p) card[b.id] = rand() < 0.3 ? 0 : Math.floor(rand() * (ORACLE.most(b) + 1));
      if (filled(board, card)) card[board.boxes[Math.floor(rand() * 13)].id] = null;
      if (n % 4 === 0) card.five = rand() < 0.5 ? 0 : board.boxes.find(b => b.id === 'five').mult * 50; // plenty of second fives
      for (const d of ROLLS) {
        const got = options(board, card, d);
        assert.equal(got.map(o => `${o.box.id}:${o.score}:${o.extra}`).sort().join(), ORACLE.options(board, card, d), `${board.name}, ${d.join('')}, card ${JSON.stringify(card)}`);
        if (d[0] === d[4] && card.five !== null) jokers++;
      }
    }
  }
  assert.ok(jokers > 300, `only ${jokers} second fives tried`);
  // And every box's score for every roll the dice can make, in any order, at every table.
  for (let t = 0; t < TABLES.length; t++) {
    const board = boardFor(t, 5);
    for (let m = 0; m < 7776; m++) {
      const d = [0, 1, 2, 3, 4].map(i => 1 + (Math.floor(m / 6 ** i) % 6));
      for (const b of board.boxes) if (score(board, b, d) !== ORACLE.score(board, b, d)) assert.fail(`${board.name}, ${b.id}, ${d.join('')}: ${score(board, b, d)}, not ${ORACLE.score(board, b, d)}`);
    }
  }
});

test('an opponent’s turn comes out the same from the same seed and turn number', () => {
  // A game in progress saves only its seed and turn number for the opponent's dice and slips (js/app.js), so a turn
  // cut short by a reload plays out again the same way. These are each opponent's turns in a game with this seed,
  // played on its own card. If this fails, a change to js/ai.js, js/rng.js or the rules has changed what a seed
  // produces: an opponent's turn in a game someone has in progress would now play out differently. If that's meant,
  // say so in the commit and write the new turns in here.
  const seed = 20261118;
  const want = [
    'chance 21, four 9, three 24, f4 8, f6 12, f3 3, f1 1, f5 15, full 0, small 0, f2 0, large 0, five 0',
    'small 30, evens 10, three 27, chance 20, full 25, f2 4, f5 10, four 0, f6 6, f4 8, f3 3, large 40, five 0',
    'small 30, chance 20, f6 54, f1 1, f2 2, four 0, three 19, full 25, f5 20, five 0, f4 8, large 40, f3 6',
    'small 30, chance 17, four 0, f2 4, f1 1, three 13, f3 9, full 25, f5 20, f6 18, five 0, f4 4, large 0',
    'three 23, five 50, large 40, chance 22, small 30, full 25, four 28, f5 15, f1 0, f6 18, f4 8, f3 6, f2 6',
    'small 30, f2 24, chance 27, f4 48, f1 0, f5 10, full 25, three 20, four 23, f6 18, f3 3, large 40, five 0',
    'small 30, low 30, f6 18, pairs 12, f2 8, large 40, full 25, f5 15, four 23, f4 12, f1 2, f3 9, five 0',
    'large 80, four 26, three 54, small 60, f1 2, chance 48, full 50, f5 15, f2 2, f6 18, f4 8, f3 9, five 0',
  ];
  TABLES.forEach((t, i) => {
    const board = boardFor(i, seed), opp = new Opponent(t.play), got = [];
    let card = blankCard(board);
    for (let n = 1; n <= 13; n++) {
      const { option } = playTurn(opp, board, card, mulberry32((seed ^ Math.imul(n, 0x9E3779B1)) >>> 0)); // as js/app.js seeds a turn
      card = mark(card, option);
      got.push(`${option.box.id} ${option.score}${option.extra ? `+${option.extra}` : ''}`);
    }
    assert.equal(got.join(', '), want[i], `${t.who.name}'s turns from seed ${seed} have changed: a game in progress would replay them differently (see the comment above)`);
  });
});

test('Hot Boxes: two boxes three times over, never Five of a kind or Ones, and a bonus three of each number still earns', () => {
  const pairs = new Set();
  for (let seed = 0; seed < 2000; seed++) {
    const board = boardFor(5, seed), hot = board.boxes.filter(b => b.mult > 1);
    assert.equal(board.boxes.length, 13);
    assert.equal(hot.length, 2, `seed ${seed}`);
    assert.ok(hot.every(b => b.mult === 3 && b.kind !== 'five' && b.id !== 'f1'), `seed ${seed}: ${hot.map(b => b.id)}`);
    assert.equal(board.bonus.at, 63 + hot.filter(b => b.kind === 'face').reduce((a, b) => a + 6 * b.face, 0), `seed ${seed}`);
    const top = board.boxes.filter(b => b.kind === 'face');
    assert.equal(3 * top.reduce((a, b) => a + b.face * b.mult, 0), board.bonus.at, `seed ${seed}: three of each doesn't earn the bonus`);
    pairs.add(hot.map(b => b.id).join('+'));
  }
  assert.equal(pairs.size, 55, 'every pair of the eleven boxes comes up');
});

test('the joker rules in the corners: a full bottom section, multiplied boxes, Two pairs, Evens and wild ones', () => {
  const opts = (board, card, dice) => options(board, card, dice).map(o => `${o.box.id} ${o.score}${o.extra ? `+${o.extra}` : ''}`).join(', ');
  const card = (board, filledIn) => Object.assign(blankCard(board), filledIn);
  const bottom = { three: 10, four: 0, full: 25, small: 30, large: 0, chance: 20 };
  // Its own box and the whole bottom filled: a 0 in any open top box, with the extra all the same.
  assert.equal(opts(CLASSIC, card(CLASSIC, { five: 50, f4: 8, ...bottom }), [4, 4, 4, 4, 4]), 'f1 0+100, f2 0+100, f3 0+100, f5 0+100, f6 0+100');
  // On boxes that score double (High Stakes) the full house and straights count in full at double; the extra stays 100.
  const high = TABLES[7].board;
  assert.equal(opts(high, card(high, { five: 100, f4: 8 }), [4, 4, 4, 4, 4]), 'three 40+100, four 40+100, full 50+100, small 60+100, large 80+100, chance 40+100');
  // A hot full house at Hot Boxes: 75.
  let seed = 0;
  while (!boardFor(5, seed).boxes.some(b => b.id === 'full' && b.mult === 3)) seed++;
  const hot = boardFor(5, seed);
  assert.match(opts(hot, card(hot, { five: 50, f2: 4 }), [2, 2, 2, 2, 2]), /full 75\+100/);
  // Two pairs: four 6s count as two pairs of 6s, 24, and so do a first five 6s and a second.
  const pairs = TABLES[6].board;
  assert.equal(s('pairs', [6, 6, 6, 6, 2], pairs), 24);
  assert.equal(s('pairs', [6, 6, 6, 6, 6], pairs), 24);
  assert.equal(opts(pairs, card(pairs, { five: 50, f6: 18 }), [6, 6, 6, 6, 6]), 'pairs 24+100, four 30+100, full 25+100, small 30+100, large 40+100, low 0+100');
  // Evens has no Ones box, so five 1s open the bottom section straight away; five 4s go in Fours, not Evens.
  const evens = TABLES[1].board;
  assert.equal(opts(evens, card(evens, { five: 50 }), [1, 1, 1, 1, 1]), 'three 5+100, four 5+100, full 25+100, small 30+100, large 40+100, chance 5+100');
  assert.equal(opts(evens, card(evens, { five: 50 }), [4, 4, 4, 4, 4]), 'f4 20+100');
  assert.equal(opts(evens, card(evens, { five: 50, f4: 8, ...bottom }), [4, 4, 4, 4, 4]), 'evens 20+100, f2 0+100, f3 0+100, f5 0+100, f6 0+100');
  // Wild ones: five 1s read as whatever scores best, each 1 on its own.
  const wild = TABLES[4].board;
  assert.equal(opts(wild, blankCard(wild), [1, 1, 1, 1, 1]), 'f1 5, f2 0, f3 0, f4 0, f5 0, f6 0, three 30, four 30, full 25, small 30, large 40, five 50, chance 30');
  assert.equal(s('full', [1, 6, 6, 6, 6], wild), 0, 'no reading of 1-6-6-6-6 is a full house');
  assert.equal(s('five', [1, 6, 6, 6, 6], wild), 50);
  // A natural five 1s with Five of a kind filled goes in Ones; with Ones filled too, the bottom opens.
  assert.equal(opts(wild, card(wild, { five: 50 }), [1, 1, 1, 1, 1]), 'f1 5+100');
  assert.equal(opts(wild, card(wild, { five: 50, f1: 3 }), [1, 1, 1, 1, 1]), 'three 30+100, four 30+100, full 25+100, small 30+100, large 40+100, chance 30+100');
  // jokerState says the same as the boxes on offer.
  assert.deepEqual(jokerState(CLASSIC, card(CLASSIC, { five: 0 }), [3, 3, 3, 3, 3]), { face: 3, extra: 0, forced: box(CLASSIC, 'f3'), lower: [], topOnly: false });
  assert.equal(jokerState(CLASSIC, blankCard(CLASSIC), [3, 3, 3, 3, 3]), null, 'a first five of a kind is no joker');
  assert.equal(jokerState(wild, card(wild, { five: 50 }), [1, 6, 6, 6, 6]), null, 'nor a wild one');
  assert.equal(jokerState(CLASSIC, card(CLASSIC, { five: 50, f4: 8, ...bottom }), [4, 4, 4, 4, 4]).topOnly, true);
});
