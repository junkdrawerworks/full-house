// The rules, the tables and the opponents, checked in Node:  node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { score, options, jokerState, blankCard, mark, totals, filled, fiveOf, boxHint } from '../js/rules.js';
import { TABLES, CLASSIC, boardFor, BACK, PAIRS, TWISTS, backBoard, backRoom, backBonus, weekBoard, changes } from '../js/tour.js';
import { monday, weekTwist, weekFrom, turnOver, goAgain, credit, beatenNow } from '../js/week.js';
import { Opponent, playTurn, SLIP } from '../js/ai.js';
import { mulberry32, rollFor } from '../js/rng.js';
import { whyLine } from '../js/why.js';
import { bonusPace } from '../js/pad.js';
import { linkFor, readLink, today, dayName } from '../js/links.js';
import { pocketHere, earns, rollsNow, offered, pocketFrom } from '../js/pocket.js';
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

test('an opponent’s slips are ones a person might make: never rolling again on a made five of a kind, nor writing it anywhere else, nor 0 with 25 on offer', () => {
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
        // Five of a kind open and the best place for them: they go there. (Five 6s are 30 in Sixes, 20 behind, a
        // gap Pip's slips would otherwise cross.)
        if (card[five.id] === null && sharp.box(board, card, dice, slip).box.id === five.id) assert.equal(opp.box(board, card, dice, slip).box.id, five.id, `${where}: wrote them elsewhere`);
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

test('Pip may slip by up to 20 points in choosing a box; everyone else by up to 10', () => {
  // Made to slip at every chance, with only Sixes and Fours open: the second-best box when it's within 20 points of the
  // best, never further. With 10, as the others have, his slips cost so little the rule-of-thumb player beat him only
  // about 84% of the time; with 20, and his rate as it is, it's about 86% (3 seeds of 2,000 games), the 87% planned.
  const slip = () => 0, card = cardWith(CLASSIC, ['f6', 'f4'], {}), pip = new Opponent(TABLES[0].play);
  assert.equal(pip.box(CLASSIC, card, [6, 6, 6, 4, 1], slip).box.id, 'f4', 'Sixes 18, Fours 4: 14 apart');
  assert.equal(pip.box(CLASSIC, card, [6, 6, 6, 6, 4], slip).box.id, 'f4', 'Sixes 24, Fours 4: 20 apart');
  assert.equal(pip.box(CLASSIC, card, [6, 6, 6, 6, 1], slip).box.id, 'f6', 'Sixes 24, Fours 0: 24 apart');
  for (const t of TABLES.slice(1)) assert.equal(new Opponent(t.play).p.slipBy, SLIP, `${t.who.name} slips by up to ${new Opponent(t.play).p.slipBy}`);
  assert.equal(SLIP, 10);
});

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
  // And every board the back room can draw, with Odds, wild Two pairs and doubled Low roads among them.
  for (const key of PAIRS) for (let n = 0; n < (key.includes('hot') ? 6 : 1); n++) boards.push(backBoard(key, mulberry32(n)));
  // And every table with each week's twist on it.
  for (let t = 0; t < TABLES.length; t++) for (const key of Object.keys(TWISTS)) for (let n = 0; n < 4; n++) boards.push(weekBoard(t, n, key));
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
        assert.match(hint, /^(Total of all dice|Total of both pairs|Both pairs|Add up the even dice|Add up the odd dice|The even dice|The odd dice)/, where);
        // With ones wild, a box that adds up the dice leaves its doubled or tripled to the ×2 or ×3 by its name, to fit its line.
        const said = !(board.wild && !['evens', 'odds'].includes(b.kind));
        assert.equal(hint.endsWith(', tripled'), m === 3 && said, where);
        assert.equal(hint.endsWith(', doubled'), m === 2 && said, where);
        assert.equal(hint.includes('1s wild'), !!board.wild && !['evens', 'odds'].includes(b.kind), where); // wild only in the bottom section
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
  // The back room's boards too, a few cards each: Odds, two twists at once, and boxes multiplied by either.
  for (const key of PAIRS) {
    for (let n = 0; n < 6; n++) {
      const board = backBoard(key, rand), card = blankCard(board), p = rand();
      for (const b of board.boxes) if (rand() < p) card[b.id] = rand() < 0.3 ? 0 : Math.floor(rand() * (ORACLE.most(b) + 1));
      if (filled(board, card)) card[board.boxes[Math.floor(rand() * 13)].id] = null;
      if (n % 2 === 0) card.five = rand() < 0.5 ? 0 : board.boxes.find(b => b.id === 'five').mult * 50;
      for (const d of ROLLS) {
        assert.equal(options(board, card, d).map(o => `${o.box.id}:${o.score}:${o.extra}`).sort().join(), ORACLE.options(board, card, d), `${board.name}, ${d.join('')}, card ${JSON.stringify(card)}`);
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
    'f5 10, four 9, chance 24, f3 6, f2 2, f1 0, f6 6, three 25, full 0, small 0, large 0, f4 8, five 0',
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

test('the result says what decided a game that was not close, from your side of the table', () => {
  // A card from { box id: score }, with `extras` extra five of a kinds.
  const card = (board, scores, extras = 0) => ({ ...blankCard(board), ...scores, extras });
  const top = (n1, n2, n3, n4, n5, n6) => ({ f1: n1, f2: n2, f3: n3, f4: n4, f5: n5, f6: n6 });
  const bottom = { three: 20, four: 15, full: 25, small: 30, large: 0, five: 0, chance: 22 };
  const sixes = TABLES[2].board;
  // Close (20 or less) or a tie: nothing to say.
  const a = card(CLASSIC, { ...top(3, 6, 9, 12, 15, 18), ...bottom });
  assert.equal(whyLine(CLASSIC, a, card(CLASSIC, { ...top(3, 6, 9, 12, 15, 18), ...bottom, chance: 2 }), 'Pip'), '');
  assert.equal(whyLine(CLASSIC, a, a, 'Pip'), '');
  // The bonus, when it is the biggest gap: how far short the loser was, each way round.
  const short = card(CLASSIC, { ...top(3, 6, 9, 12, 15, 9), ...bottom });
  assert.equal(whyLine(CLASSIC, short, a, 'Maud'), 'Maud got the 35 bonus; you were 9 short.');
  assert.equal(whyLine(CLASSIC, a, short, 'Maud'), 'You got the 35 bonus; Maud was 9 short.');
  // The top section, when it outweighs the bonus.
  const low = card(CLASSIC, { ...top(1, 2, 3, 4, 10, 13), ...bottom });
  const high = card(CLASSIC, { ...top(4, 8, 12, 16, 20, 24), ...bottom });
  assert.equal(whyLine(CLASSIC, low, high, 'Maud'), 'Maud’s top section came to 84 and yours to 33.');
  assert.equal(whyLine(CLASSIC, high, low, 'The Dealer'), 'Your top section came to 84 and the Dealer’s to 33.');
  // Five of a kind that alone outweighs the margin was the difference; two, against one, are counted.
  const five = card(CLASSIC, { ...top(3, 6, 9, 12, 15, 18), ...bottom, five: 50 });
  assert.equal(whyLine(CLASSIC, a, five, 'Bea'), 'Bea’s five of a kind was the difference.');
  assert.equal(whyLine(CLASSIC, five, a, 'The Dealer'), 'Your five of a kind was the difference.');
  const twice = card(CLASSIC, { ...top(3, 6, 9, 12, 15, 18), ...bottom, five: 50 }, 1);
  assert.equal(whyLine(CLASSIC, five, twice, 'Sol'), 'Sol rolled five of a kind twice; you did once.');
  assert.equal(whyLine(CLASSIC, a, twice, 'Sol'), 'Sol rolled five of a kind twice; you never did.');
  // Five of a kind that isn't the whole story: the winner was ahead elsewhere too.
  const more = card(CLASSIC, { ...top(3, 6, 9, 12, 15, 30), ...bottom, five: 50 });
  assert.equal(whyLine(CLASSIC, a, more, 'Bea'), 'Bea rolled five of a kind; you didn’t.');
  // The bottom section, as the pad adds it up; without five of a kind when that went differently, saying so.
  const weak = card(CLASSIC, { ...top(3, 6, 9, 12, 15, 18), three: 0, four: 0, full: 0, small: 30, large: 0, five: 0, chance: 22 });
  assert.equal(whyLine(CLASSIC, weak, a, 'Wren'), 'Wren’s bottom section came to 112 and yours to 52.');
  const weakFive = card(CLASSIC, { ...top(3, 6, 9, 12, 15, 18), three: 0, four: 0, full: 0, small: 30, large: 0, five: 50, chance: 22 });
  const strong = card(CLASSIC, { ...top(3, 6, 9, 12, 15, 18), three: 25, four: 25, full: 25, small: 30, large: 40, five: 0, chance: 25 });
  assert.equal(whyLine(CLASSIC, weakFive, strong, 'The Dealer'), 'Leaving out five of a kind, the Dealer’s bottom section came to 170 and yours to 52.');
  // A table's own numbers: Triple Sixes' bonus needs 99, and its top section counts the sixes three times over.
  const t1 = card(sixes, { ...top(3, 6, 9, 12, 15, 54), ...bottom }), t2 = card(sixes, { ...top(3, 6, 9, 12, 15, 36), ...bottom });
  assert.equal(whyLine(sixes, t2, t1, 'Bea'), 'Bea got the 35 bonus; you were 18 short.');
});

test('the bonus row says whether the top section is on pace: three of each number, scaled to the table’s target', () => {
  const card = (board, scores) => ({ ...blankCard(board), ...scores });
  const pace = (board, scores) => bonusPace(board, card(board, scores));
  // Nothing before a number box is filled, once the bonus is made, or once it can't be.
  assert.equal(pace(CLASSIC, {}), '');
  assert.equal(pace(CLASSIC, { chance: 20 }), '');
  assert.equal(pace(CLASSIC, { f6: 30, f5: 25, f4: 8 }), '');
  assert.equal(pace(CLASSIC, { f6: 18, f5: 10, f4: 4 }), '', 'out of reach: 32, and at most 30 to come');
  assert.equal(pace(CLASSIC, { f6: 18, f5: 10, f4: 8 }), '9 behind', 'just within reach: 36, and at most 30 to come');
  // Classic: three of each.
  assert.equal(pace(CLASSIC, { f6: 18 }), 'on pace');
  assert.equal(pace(CLASSIC, { f6: 24, f1: 1 }), '4 ahead');
  assert.equal(pace(CLASSIC, { f4: 8, f5: 10 }), '9 behind');
  assert.equal(pace(CLASSIC, { f1: 0 }), '3 behind');
  // Triple Sixes counts three sixes as 54; Two Rolls scales three of each down to its 52.
  assert.equal(pace(TABLES[2].board, { f6: 54 }), 'on pace');
  assert.equal(pace(TABLES[2].board, { f6: 36 }), '18 behind');
  assert.equal(pace(TABLES[3].board, { f6: 18 }), '3 ahead');
  assert.equal(pace(TABLES[3].board, { f6: 12, f5: 10 }), '5 behind');
  // Evens: the number boxes take three of each, and Evens what's left of the 72 (12).
  assert.equal(pace(TABLES[1].board, { evens: 12 }), 'on pace');
  assert.equal(pace(TABLES[1].board, { evens: 20, f2: 6 }), '8 ahead');
  // Hot Boxes: a hot number box's three of each counts three times over, as its raised target does.
  const hot = { ...boardFor(5, 1), boxes: boardFor(5, 1).boxes.map(b => ({ ...b, mult: b.id === 'f5' ? 3 : 1 })), bonus: { at: 63 + 30, worth: 35 } };
  assert.equal(pace(hot, { f5: 45 }), 'on pace');
  // The back room: Odds counts its 9 and Evens its 12, and with Two Rolls all of them scale down to the cut target.
  const back = key => backBoard(key, mulberry32(1));
  assert.equal(pace(back('evens+odds'), { evens: 12 }), 'on pace');
  assert.equal(pace(back('evens+odds'), { odds: 9 }), 'on pace');
  assert.equal(pace(back('evens+odds'), { odds: 15, f6: 18 }), '6 ahead');
  assert.equal(pace(back('evens+two-rolls'), { evens: 10 }), 'on pace', '12 of the 72, scaled to 59');
  assert.equal(pace(back('evens+two-rolls'), { evens: 10, f6: 15 }), 'on pace');
  assert.equal(pace(back('odds+two-rolls'), { odds: 7, f6: 15 }), 'on pace', '9 and 18 of the 66, scaled to 54');
  for (const key of PAIRS) {
    const b = back(key), top = b.boxes.filter(x => ['face', 'evens', 'odds'].includes(x.kind));
    const three = top.map(x => (x.kind === 'face' ? 3 * x.face : x.kind === 'evens' ? 12 : 9) * x.mult), all = three.reduce((a, v) => a + v, 0);
    // Each top box at three of each, scaled to the table's target: on pace.
    top.forEach((x, i) => assert.equal(pace(b, { [x.id]: Math.round((three[i] * b.bonus.at) / all) }), 'on pace', `${key}, ${x.id}`));
  }
  // Every top box filled: the pad pencils the bonus in, but the line has nothing to measure toward.
  for (const b of TABLES.map((t, i) => boardFor(i, 1))) assert.equal(bonusPace(b, card(b, Object.fromEntries(b.boxes.filter(x => /^f\d|evens/.test(x.id)).map(x => [x.id, 0])))), '');
});

test('your dice come from the game’s seed, the turn and the roll: the same for anyone playing from that seed, and fair', () => {
  assert.deepEqual(rollFor(12345, 5, 2), rollFor(12345, 5, 2));
  const seen = new Set(), counts = [0, 0, 0, 0, 0, 0, 0];
  for (let seed = 0; seed < 400; seed++) {
    for (let turn = 1; turn <= 13; turn++) {
      for (let roll = 1; roll <= 4; roll++) {
        for (const side of [0, 1]) {
          const dice = rollFor(seed, turn, roll, side);
          assert.equal(dice.length, 5);
          for (const d of dice) { assert.ok(Number.isInteger(d) && d >= 1 && d <= 6); counts[d]++; }
          seen.add(`${seed}.${dice.join('')}`);
        }
      }
    }
  }
  // Every turn, roll and side of a game throws its own dice: hardly any two the same within one seed.
  assert.ok(seen.size > 400 * 13 * 4 * 2 * 0.99, `${seen.size} different throws`);
  const n = counts.reduce((a, b) => a + b, 0);
  for (let d = 1; d <= 6; d++) assert.ok(Math.abs(counts[d] / n - 1 / 6) < 0.005, `${d} came up ${counts[d]} times in ${n}`);
  // Not the opponent's dice: their first roll of a turn comes from a stream of its own.
  let same = 0;
  for (let seed = 0; seed < 2000; seed++) {
    const rand = mulberry32((seed ^ Math.imul(1, 0x9E3779B1)) >>> 0), theirs = Array.from({ length: 5 }, () => 1 + Math.floor(rand() * 6));
    if (theirs.join() === rollFor(seed, 1, 1).join()) same++;
  }
  assert.ok(same < 3, `${same} first rolls the same as the opponent's`);
});

test('a friend’s link carries the table, the opponent when not the table’s own, the dice and the score, and reads back the same', () => {
  assert.equal(linkFor({ table: 5, seed: 1234567, score: 288 }), 'https://full-house.junkdrawer.works/#table=6&dice=qglj&score=288');
  assert.equal(linkFor({ table: 0, opp: 7, seed: 1 }), 'https://full-house.junkdrawer.works/#table=1&dice=1&vs=8');
  for (const want of [{ table: 5, opp: 5, seed: 1234567, score: 288, twist: null }, { table: 0, opp: 7, seed: 2 ** 31 - 1, score: null, twist: null }, { table: 7, opp: 0, seed: 0, score: 0, twist: null }]) {
    assert.deepEqual(readLink(new URL(linkFor(want)).hash), want);
  }
  // As the README promises: these keep opening.
  assert.deepEqual(readLink('#table=6&dice=k3j2h1&score=288'), { table: 5, opp: 5, seed: parseInt('k3j2h1', 36), score: 288, twist: null });
  assert.deepEqual(readLink('table=3&dice=1&vs=1&other=x'), { table: 2, opp: 0, seed: 1, score: null, twist: null });
  // Table 9 is the back room, against the Dealer from table 8 unless it says otherwise.
  assert.equal(linkFor({ table: 8, opp: 7, seed: 35, score: 300 }, 8), 'https://full-house.junkdrawer.works/#table=9&dice=z&score=300');
  assert.deepEqual(readLink('#table=9&dice=z&score=300'), { table: 8, opp: 7, seed: 35, score: 300, twist: null });
  assert.deepEqual(readLink('#table=9&dice=z&vs=1'), { table: 8, opp: 0, seed: 35, score: null, twist: null });
  for (const bad of ['', '#', '#table=10&dice=1', '#table=9&dice=1&vs=9', '#table=0&dice=1', '#table=2', '#table=2&dice=Z', '#table=2&dice=zzzzzzzz', '#table=2&dice=1&vs=9', '#table=1.5&dice=1', '#table=-1&dice=1']) {
    assert.equal(readLink(bad), null, bad);
  }
  assert.equal(readLink('#table=2&dice=1&score=lots').score, null, 'a score that isn’t one is left out');
  // A game of the tour with the week's twist on it carries the twist, and reads back the same.
  assert.equal(linkFor({ table: 1, seed: 35, score: 250, twist: 'wild' }), 'https://full-house.junkdrawer.works/#table=2&dice=z&twist=wild&score=250');
  for (const want of [{ table: 1, opp: 1, seed: 35, score: 250, twist: 'wild' }, { table: 0, opp: 0, seed: 7, score: null, twist: 'odds' }, { table: 5, opp: 5, seed: 99, score: 1, twist: 'two-rolls' }]) {
    assert.deepEqual(readLink(new URL(linkFor(want)).hash), want);
  }
  assert.equal(linkFor({ table: 8, opp: 7, seed: 35, twist: 'wild' }), 'https://full-house.junkdrawer.works/#table=9&dice=z', 'not on the back room');
  for (const bad of ['#table=2&dice=1&twist=', '#table=2&dice=1&twist=Wild', '#table=2&dice=1&twist=toString', '#table=2&dice=1&twist=jokers', '#table=9&dice=1&twist=wild']) {
    assert.equal(readLink(bad), null, bad);
  }
});

test('the week’s twist on the tour: on top of each table’s own, as the back room puts two together, or no change where it’s the table’s own or clashes', () => {
  const same = { 1: ['evens'], 2: ['sixes', 'hot'], 3: ['two-rolls', 'high'], 4: ['wild'], 5: ['hot', 'sixes', 'high'], 6: ['pairs'], 7: ['high', 'two-rolls', 'hot'] };
  assert.deepEqual(TABLES.map(t => t.twist), [null, 'evens', 'sixes', 'two-rolls', 'wild', 'hot', 'pairs', 'high']);
  for (let t = 0; t < TABLES.length; t++) {
    for (const key of Object.keys(TWISTS)) {
      const unchanged = (same[t] || []).includes(key);
      assert.equal(changes(t, key), !unchanged, `table ${t + 1}, ${key}`);
      for (const seed of [1, 2, 3, 77]) {
        const board = weekBoard(t, seed, key);
        assert.deepEqual(board, weekBoard(t, seed, key), 'the same board from the same seed');
        if (unchanged) { assert.deepEqual(board, boardFor(t, seed), `table ${t + 1}, ${key}: plays as it always does`); continue; }
        const own = TABLES[t].twist, keys = own ? [own, key] : [key];
        assert.equal(board.name, `${TABLES[t].board.name} with ${TWISTS[key].name}`);
        assert.deepEqual([board.of, board.week, board.twists], [t, key, undefined], 'not taken for the back room');
        assert.equal(board.blurb, `${keys.map(k => TWISTS[k].says).join(' ')} The top-section bonus needs ${board.bonus.at}.`);
        assert.equal(board.bonus.at, backBonus(board), 'the bonus as the back room works it out');
        assert.equal(board.boxes.length, 13);
        // The same rules as the back room's board for the two (Hot Boxes' boxes apart, drawn from the seed).
        if (own && !keys.includes('hot')) {
          const back = backBoard(PAIRS.find(k => k.split('+').sort().join() === [...keys].sort().join()), mulberry32(1));
          assert.deepEqual([board.boxes, board.rolls, board.wild, board.bonus, board.extra], [back.boxes, back.rolls, back.wild, back.bonus, back.extra], `table ${t + 1}, ${key}`);
        }
        // Classic with a twist is that twist alone: the tour's own table for it, where there is one.
        const alone = TABLES.findIndex(x => x.twist === key);
        if (!own && alone > 0 && key !== 'hot') {
          const plain = x => JSON.parse(JSON.stringify([x.boxes, x.rolls, !!x.wild, x.bonus])); // the tour's Evens box has a face of undefined
          assert.deepEqual(plain(board), plain(boardFor(alone, seed)), key);
        }
        if (keys.includes('hot')) {
          const hot = board.boxes.filter(x => x.mult === 3);
          assert.equal(hot.length, 2, `table ${t + 1}, ${key}`);
          assert.ok(board.hot && hot.every(x => x.kind !== 'five' && x.id !== 'f1'));
        }
      }
    }
  }
  // Examples: Evens with Wild Ones; Two Rolls with Odds, the bonus cut as Two Rolls cuts it; Classic with Odds.
  const ev = weekBoard(1, 5, 'wild');
  assert.deepEqual([ev.name, ev.wild, ev.bonus.at, ev.rolls], ['Evens with Wild Ones', true, 72, 3]);
  const tr = weekBoard(3, 5, 'odds');
  assert.deepEqual([tr.name, tr.rolls, tr.bonus.at, !!tr.boxes.find(x => x.kind === 'odds')], ['Two Rolls with Odds', 2, Math.round((66 * 52) / 63), true]);
  assert.deepEqual([weekBoard(0, 5, 'odds').name, weekBoard(0, 5, 'odds').bonus.at], ['Classic with Odds', 66]);
  // Hot Boxes' boxes come from the seed, different from seed to seed.
  assert.ok(new Set(Array.from({ length: 20 }, (_, n) => weekBoard(5, n, 'evens').boxes.filter(x => x.mult === 3).map(x => x.id).join())).size > 5);
  // No twist: the table as it is.
  assert.deepEqual(weekBoard(2, 9, null), boardFor(2, 9));
  // Every combined board plays through to a full card with the table's own opponent.
  const rand = mulberry32(4);
  for (let t = 0; t < TABLES.length; t++) for (const key of Object.keys(TWISTS)) {
    const board = weekBoard(t, 3, key), opp = new Opponent(TABLES[t].play);
    let card = blankCard(board), turns = 0;
    while (!filled(board, card)) { card = mark(card, playTurn(opp, board, card, rand).option); turns++; }
    assert.equal(turns, 13, `table ${t + 1}, ${key}`);
  }
});

test('the week turns at local midnight starting Monday, and its twist is the same all week and new the next', () => {
  assert.equal(monday(new Date(2026, 10, 29, 23, 59)), '2026-11-23', 'Sunday 23:59 is still the week of Monday the 23rd');
  assert.equal(monday(new Date(2026, 10, 30, 0, 0)), '2026-11-30', 'Monday 00:00 starts the next');
  assert.equal(monday(new Date(2026, 10, 23, 0, 0)), '2026-11-23');
  assert.equal(monday(new Date(2027, 0, 2, 12)), '2026-12-28', 'across the new year');
  assert.equal(monday(new Date(2026, 2, 1, 9)), '2026-02-23', 'across the end of a month');
  // The same twist all week, from the Monday's date alone, and never the same two weeks running.
  for (let d = 23; d <= 29; d++) assert.equal(weekTwist(monday(new Date(2026, 10, d, 15))), weekTwist('2026-11-23'));
  let last = null;
  const all = Object.keys(TWISTS), seen = [];
  for (let w = 0; w < 600; w++) {
    const key = weekTwist(monday(new Date(2026, 0, 5 + 7 * w)));
    assert.ok(TWISTS[key], key);
    assert.notEqual(key, last, `week ${w}`);
    last = key;
    seen.push(key);
  }
  // Every twist comes round: each of them in every fifteen weeks running.
  for (let w = 0; w + 15 <= seen.length; w++) assert.deepEqual(new Set(seen.slice(w, w + 15)).size, all.length, `weeks ${w} to ${w + 14}`);
});

// Progress as js/app.js reads it from a save, with a week of the tour (js/week.js) read on `now`.
const progressAt = (p, now) => {
  const out = { beaten: [], best: [], played: [], won: [], ...p };
  return Object.assign(out, weekFrom(out, now));
};
const SUN = new Date(2026, 10, 29, 23, 59), MON = new Date(2026, 10, 30, 0, 0), all8 = Array(8).fill(true);
// A game of the tour at table `table` in lap `lap`.
const tourGame = (table, lap, extra = {}) => ({ table, opp: table, lap, over: false, ...extra });

test('the week’s lap: a save from before keeps its place till Monday, which starts a new lap; a week skipped, or the clock put back', () => {
  // A finished tour from before laps: this week's lap, finished, one lap done, its games not known. Nothing resets on opening.
  let p = progressAt({ beaten: all8, played: [3, 4, 2, 5, 6, 3, 4, 7], best: [231] }, SUN);
  assert.deepEqual(p.week, { start: '2026-11-23', twist: weekTwist('2026-11-23'), n: 1, beaten: all8, games: null, prev: null });
  assert.deepEqual(p.laps, { done: 1, best: null });
  assert.equal(beatenNow(p), 8);
  assert.equal(turnOver(p, SUN), false, 'no reset on the first open');
  assert.equal(p.week.beaten.length, 8);
  // Monday at midnight: a new lap, with the new week's twist. Everything else stays.
  assert.equal(turnOver(p, MON), true);
  assert.deepEqual(p.week, { start: '2026-11-30', twist: weekTwist('2026-11-30'), n: 2, beaten: [], games: 0, prev: null });
  assert.notEqual(p.week.twist, weekTwist('2026-11-23'));
  assert.deepEqual([p.beaten, p.best, p.played, p.laps], [all8, [231], [3, 4, 2, 5, 6, 3, 4, 7], { done: 1, best: null }]);
  assert.equal(turnOver(p, new Date(2026, 11, 6, 23, 59)), false, 'the rest of the week');
  // A fresh save starts its lap at nothing, with its games counted from the first.
  const fresh = progressAt({}, SUN);
  assert.deepEqual([fresh.week.beaten, fresh.week.games, fresh.laps], [[], 0, { done: 0, best: null }]);
  // Part way up, with games played before laps were counted: the lap carries on, its games unknown.
  assert.deepEqual(progressAt({ beaten: [true, true], played: [2, 3] }, SUN).week.games, null);
  // A week or more skipped: one new lap, for the week it is now.
  p.week.beaten = [true, true, true];
  assert.equal(turnOver(p, new Date(2026, 11, 23, 10)), true);
  assert.deepEqual([p.week.start, p.week.n, p.week.beaten, p.week.twist], ['2026-12-21', 3, [], weekTwist('2026-12-21')]);
  // The clock put back into the week before (a flight west across Monday's midnight): the lap stays as it is.
  p.week.beaten = [true];
  assert.equal(turnOver(p, new Date(2026, 11, 20, 23, 0)), false);
  assert.equal(turnOver(p, new Date(2026, 11, 14, 9, 0)), false, 'a week back');
  assert.deepEqual([p.week.start, p.week.beaten], ['2026-12-21', [true]]);
  // ...and forward again to where it was: still nothing.
  assert.equal(turnOver(p, new Date(2026, 11, 21, 0, 5)), false);
  // Put back further than a week, it's taken at its word, so a clock once set wrong ahead doesn't hold the tour up for weeks.
  assert.equal(turnOver(p, new Date(2026, 11, 2, 9, 0)), true);
  assert.deepEqual([p.week.start, p.week.beaten], ['2026-11-30', []]);
  // A damaged week is read afresh, keeping the tables beaten; damaged laps keep what they can.
  const damaged = progressAt({ beaten: [true], week: { start: 'monday', twist: 'wild' }, laps: { done: 'x', best: -2 } }, SUN);
  assert.deepEqual([damaged.week.beaten, damaged.week.start, damaged.laps], [[true], '2026-11-23', { done: 0, best: null }]);
  const kept = progressAt({ week: { start: '2026-11-23', twist: 'wild', n: 4, beaten: [true, 1, 0], games: 3, prev: { n: 3, beaten: [true], games: 'x' } }, laps: { done: 2, best: 17 } }, SUN);
  assert.deepEqual([kept.week, kept.laps], [{ start: '2026-11-23', twist: 'wild', n: 4, beaten: [true, true, false], games: 3, prev: { n: 3, beaten: [true], games: null } }, { done: 2, best: 17 }]);
});

test('the week’s lap: every game counts, a win ticks off its table, the Dealer finishes the lap, and Go round again only then', () => {
  const p = progressAt({}, SUN), n = p.week.n;
  // A loss at table 1, a win, then table 2 given up and won: four games, two tables.
  assert.deepEqual(credit(p, tourGame(0, n), false), { now: true, last: false, before: false, done: false, games: 1, best: null });
  assert.equal(credit(p, tourGame(0, n), true).before, false);
  assert.equal(credit(p, tourGame(0, n), true).before, true, 'beaten this lap already');
  credit(p, tourGame(1, n), false);
  credit(p, tourGame(1, n), true);
  assert.deepEqual([p.week.beaten, p.week.games], [[true, true], 5]);
  // A win at a table whose table before isn't beaten this lap ticks nothing off.
  credit(p, tourGame(4, n), true);
  assert.deepEqual([p.week.beaten[4], p.week.games], [undefined, 6]);
  // No going round again before the Dealer is beaten.
  assert.equal(goAgain(p), false);
  assert.equal(p.week.n, n);
  for (let t = 2; t < 7; t++) credit(p, tourGame(t, n), true);
  let r = credit(p, tourGame(7, n), true);
  assert.deepEqual(r, { now: true, last: false, before: false, done: true, games: 12, best: null });
  assert.deepEqual(p.laps, { done: 1, best: 12 });
  // Games after the lap is finished don't add to it.
  credit(p, tourGame(3, n), false);
  r = credit(p, tourGame(7, n), true);
  assert.deepEqual([r.done, r.games, p.week.games, p.laps], [false, 12, 12, { done: 1, best: 12 }]);
  // Go round again: the same week and twist, nothing beaten, a new lap number, the laps and everything else kept.
  const { start, twist } = p.week;
  assert.equal(goAgain(p), true);
  assert.deepEqual(p.week, { start, twist, n: n + 1, beaten: [], games: 0, prev: null });
  // A game left over from the lap before counts for none: the new lap's start is clean.
  assert.deepEqual(credit(p, tourGame(7, n), true), { now: false, last: false, before: false, done: false });
  assert.deepEqual([p.week.beaten, p.week.games], [[], 0]);
  // A slower lap isn't the best; a quicker one is.
  for (let t = 0; t < 8; t++) { credit(p, tourGame(t, n + 1), false); credit(p, tourGame(t, n + 1), true); }
  assert.deepEqual(p.laps, { done: 2, best: 12 });
  goAgain(p);
  for (let t = 0; t < 8; t++) credit(p, tourGame(t, n + 2), true);
  assert.deepEqual(p.laps, { done: 3, best: 8 });
  // A game saved before laps were counted belongs to this week's lap.
  goAgain(p);
  credit(p, { table: 0, opp: 0, over: false }, true);
  assert.deepEqual(p.week.beaten, [true]);
});

test('the week’s lap: a game of the tour still going when Monday comes counts for the week it was started in', () => {
  const p = progressAt({}, SUN), n = p.week.n;
  for (let t = 0; t < 7; t++) credit(p, tourGame(t, n), true);
  const dealer = tourGame(7, n);
  // Monday comes mid-game: a new lap starts, and the old one is kept beside the game.
  assert.equal(turnOver(p, MON, dealer), true);
  assert.deepEqual([p.week.n, p.week.beaten, p.week.prev], [n + 1, [], { n, beaten: Array(7).fill(true), games: 7 }]);
  // It ends in a win: the old lap is finished, with its games, and let go; this week's lap is untouched.
  const r = credit(p, dealer, true);
  assert.deepEqual(r, { now: false, last: true, before: false, done: true, games: 8, best: null });
  assert.deepEqual([p.laps, p.week.prev, p.week.beaten, p.week.games], [{ done: 1, best: 8 }, null, [], 0]);
  // Not kept for a game that isn't the tour's, nor for one whose lap was finished already.
  turnOver(p, new Date(2026, 11, 7), { table: null, opp: 2, over: false });
  assert.equal(p.week.prev, null);
  turnOver(p, new Date(2026, 11, 14), { table: 2, opp: 2, kind: 'day', over: false });
  assert.equal(p.week.prev, null);
  // Given up after the turn: a loss for the old lap.
  credit(p, tourGame(0, p.week.n), true);
  const g = tourGame(1, p.week.n);
  turnOver(p, new Date(2026, 11, 21), g);
  credit(p, g, false);
  assert.deepEqual([p.week.prev, p.week.games, p.week.beaten], [null, 0, []]);
});

test('today’s table comes from the date: the same all day for everyone, a different table and dice from day to day', () => {
  const a = today(new Date(2026, 10, 19, 0, 1)), b = today(new Date(2026, 10, 19, 23, 59));
  assert.deepEqual(a, b);
  assert.equal(a.day, '2026-11-19');
  assert.equal(dayName(a.day), '19 November');
  assert.equal(dayName('2027-01-02'), '2 January');
  const tables = [0, 0, 0, 0, 0, 0, 0, 0], seeds = new Set();
  let repeats = 0, last = -1;
  for (let i = 0; i < 400; i++) {
    const d = today(new Date(2026, 0, 1 + i));
    assert.ok(Number.isInteger(d.table) && d.table >= 0 && d.table < 8);
    assert.ok(Number.isInteger(d.seed) && d.seed >= 0 && d.seed < 2 ** 31);
    tables[d.table]++;
    seeds.add(d.seed);
    if (d.table === last) repeats++;
    last = d.table;
  }
  assert.equal(seeds.size, 400, 'a new seed every day');
  assert.ok(tables.every(n => n > 30), `every table comes round: ${tables}`);
  assert.ok(repeats < 80, `${repeats} days with the same table as the day before`);
});

test('at Two players the line on what decided a game names both players', () => {
  const card = scores => ({ ...blankCard(CLASSIC), ...scores, extras: 0 });
  const bottom = { three: 20, four: 15, full: 25, small: 30, large: 0, five: 0, chance: 22 };
  const made = card({ f1: 3, f2: 6, f3: 9, f4: 12, f5: 15, f6: 18, ...bottom }), short = card({ f1: 3, f2: 6, f3: 9, f4: 12, f5: 15, f6: 9, ...bottom });
  assert.equal(whyLine(CLASSIC, short, made, 'Red', 'Black'), 'Red got the 35 bonus; Black was 9 short.');
  assert.equal(whyLine(CLASSIC, made, short, 'Red', 'Black'), 'Black got the 35 bonus; Red was 9 short.');
  const low = card({ f1: 0, f2: 0, f3: 3, f4: 4, f5: 5, f6: 6, ...bottom });
  assert.equal(whyLine(CLASSIC, low, card({ f1: 3, f2: 6, f3: 9, f4: 12, f5: 15, f6: 6, ...bottom }), 'Red', 'Mum'), 'Red’s top section came to 51 and Mum’s to 18.');
  assert.equal(whyLine(CLASSIC, card({ ...bottom, five: 50 }), card({ ...bottom }), 'Red', 'Black'), 'Black’s five of a kind was the difference.');
});

test('the back room: two of the tour’s twists at once, drawn from the seed, with a bonus three of each number still earns', () => {
  assert.equal(BACK, 8);
  assert.equal(PAIRS.length, new Set(PAIRS).size);
  // Two twists that both set the rolls, or that would triple a box already multiplied, never come up together.
  for (const clash of ['two-rolls+high', 'sixes+hot', 'hot+high']) assert.ok(!PAIRS.includes(clash), clash);
  const seen = new Set();
  for (let seed = 0; seed < 3000; seed++) {
    const board = boardFor(BACK, seed), [a, b] = board.twists, key = `${a}+${b}`;
    seen.add(key);
    assert.ok(PAIRS.includes(key), key);
    assert.deepEqual(board, backRoom(seed), 'the same table for the same seed');
    assert.equal(board.name, `${TWISTS[a].name} with ${TWISTS[b].name}`);
    assert.ok(board.blurb.startsWith(`${TWISTS[a].says} ${TWISTS[b].says} The top-section bonus needs ${board.bonus.at}.`), board.blurb);
    assert.equal(board.boxes.length, 13);
    assert.equal(new Set(board.boxes.map(x => x.id)).size, 13);
    assert.equal(board.rolls, b === 'two-rolls' || a === 'two-rolls' ? 2 : board.twists.includes('high') ? 4 : 3, key);
    assert.equal(!!board.wild, board.twists.includes('wild'), key);
    assert.equal(board.extra, 100, 'the extra for another five of a kind is never multiplied');
    assert.equal(!!box(board, 'evens'), board.twists.includes('evens'), key);
    assert.equal(!!box(board, 'odds'), board.twists.includes('odds'), key);
    assert.equal(!!box(board, 'pairs') && !!box(board, 'low'), board.twists.includes('pairs'), key);
    const hot = board.boxes.filter(x => x.mult === 3 && !(x.id === 'f6' && board.twists.includes('sixes')));
    assert.equal(hot.length, board.twists.includes('hot') ? 2 : 0, `${key}, seed ${seed}`);
    assert.ok(hot.every(x => x.kind !== 'five' && x.id !== 'f1'), `${key}: ${hot.map(x => x.id)}`);
    for (const x of board.boxes) assert.equal(x.mult, board.twists.includes('high') && !['face', 'evens', 'odds'].includes(x.kind) ? 2 : x.mult === 3 ? 3 : 1, `${key}, ${x.id}`);
    // Three of each number, Evens' 12 and Odds' 9, each times its multiplier: the bonus, cut as Two Rolls cuts 63 to 52.
    const par = board.boxes.reduce((s, x) => s + (x.kind === 'face' ? 3 * x.face : x.kind === 'evens' ? 12 : x.kind === 'odds' ? 9 : 0) * x.mult, 0);
    assert.equal(board.bonus.at, Math.round(board.rolls === 2 ? (par * 52) / 63 : par), `${key}, seed ${seed}`);
  }
  assert.equal(seen.size, PAIRS.length, 'every pair comes up');
  // Odds turns up only in the back room.
  for (let t = 0; t < TABLES.length; t++) assert.ok(!boardFor(t, 1).boxes.some(x => x.kind === 'odds'));
  const odds = backBoard('evens+odds', mulberry32(1));
  assert.equal(score(odds, box(odds, 'odds'), [1, 3, 5, 2, 6]), 9);
  assert.equal(score(odds, box(odds, 'evens'), [1, 3, 5, 2, 6]), 8);
  assert.equal(odds.bonus.at, 75);
  // Wild ones count in Two pairs, and the Dealer plays every pair through to a full card, on the boxes the rules allow.
  const wild = backBoard('wild+pairs', mulberry32(1));
  assert.equal(score(wild, box(wild, 'pairs'), [1, 6, 5, 5, 2]), 22, 'a 1 reads as a 6');
  const dealer = new Opponent(TABLES[BACK - 1].play), rand = mulberry32(9);
  for (const key of PAIRS) {
    const board = backBoard(key, rand);
    let card = blankCard(board), turns = 0;
    while (!filled(board, card)) { card = mark(card, playTurn(dealer, board, card, rand).option); turns++; }
    assert.equal(turns, 13, key);
  }
});

// A game of yours on the tour, at turn 5 with its three rolls used, changed by `extra`.
const at = (extra = {}) => ({ table: 0, opp: 0, board: CLASSIC, turn: 'you', number: 5, rolls: 3, extraRoll: null, ...extra });

test('extra rolls: a win earns one wherever they play a part, today’s only on its counted game, and the pocket holds any number', () => {
  // Earned by a win on the tour, in a quick game, in the back room and in today's counted game; never by a loss or a tie
  // (won is false for both), at a friend's table, at Two players, or by another go at today's.
  for (const g of [at(), at({ table: null }), at({ table: null, kind: 'back' })]) {
    assert.equal(earns(g, true), true, JSON.stringify(g));
    assert.equal(earns(g, false), false);
  }
  assert.equal(earns(at({ table: null, kind: 'day' }), true, true), true);
  assert.equal(earns(at({ table: null, kind: 'day' }), true, false), false, 'another go at today’s table earned one');
  for (const kind of ['friend', 'two']) {
    assert.equal(pocketHere(at({ kind })), false);
    assert.equal(earns(at({ kind }), true, true), false, kind);
  }
  // The pocket from a save: any whole number, with no cap, and empty in a save from before extra rolls.
  for (const [saved, n] of [[undefined, 0], [null, 0], [0, 0], [7, 7], [250, 250], [-1, 0], [2.5, 0], ['3', 0]]) assert.equal(pocketFrom(saved), n, String(saved));
});

test('extra rolls: one is on offer once a game, on your turn after your last roll, with one in the pocket, and rolls from the seed as the next roll', () => {
  for (const kind of ['friend', 'two']) assert.equal(offered(at({ kind }), 9), false, kind);
  // On offer only on your own turn, with the table's rolls used up, one in the pocket, none spent this game, and the game going.
  assert.equal(offered(at(), 1), true);
  assert.equal(offered(at({ extraRoll: undefined }), 1), true, 'a game saved before extra rolls offers none');
  for (const rolls of [0, 1, 2]) assert.equal(offered(at({ rolls }), 1), false, `offered with ${3 - rolls} rolls left`);
  assert.equal(offered(at({ rolls: 2, board: TABLES[3].board }), 1), true, 'not after the last roll at Two Rolls');
  assert.equal(offered(at({ rolls: 3, board: TABLES[7].board }), 1), false, 'offered with a roll left at High Stakes');
  assert.equal(offered(at(), 0), false, 'offered from an empty pocket');
  assert.equal(offered(at({ turn: 'them' }), 5), false, 'offered on the opponent’s turn');
  assert.equal(offered(at({ over: true }), 5), false);
  assert.equal(offered(at({ extraRoll: 5 }), 5), false, 'offered again on the turn it was spent');
  assert.equal(offered(at({ extraRoll: 2 }), 5), false, 'offered again in a later turn of the same game');
  // The turn it's spent has one roll more, for you only; any other turn, and the opponent's, the table's own.
  assert.equal(rollsNow(at()), 3);
  assert.equal(rollsNow(at({ extraRoll: 5, rolls: 4 })), 4);
  assert.equal(rollsNow(at({ extraRoll: 5, turn: 'them' })), 3, 'the opponent gets the extra roll');
  assert.equal(rollsNow(at({ extraRoll: 4 })), 3);
  // Its dice come from the seed as the roll after the table's last, as any roll of yours does: the same for anyone.
  assert.deepEqual(rollFor(4242, 5, 4), rollFor(4242, 5, 4));
  assert.notDeepEqual(rollFor(4242, 5, 4), rollFor(4242, 5, 3));
});
