// The tour: eight tables, each with its own twist on the rules and a sharper opponent than the last. A table's `twist`
// names its own twist among the back room's TWISTS (below), Classic having none: the week's twist goes on top of it.
// Beat an opponent to move on to the next table. An opponent's `beaten` line, if it has one, replaces its `line` once
// you've beaten it at its table. What it `says` at the end of a game, in red pencil under the scores: when it wins, loses
// or ties.

import { mulberry32, mix } from './rng.js';

const STANDARD = [
  { id: 'f1', kind: 'face', face: 1 }, { id: 'f2', kind: 'face', face: 2 }, { id: 'f3', kind: 'face', face: 3 },
  { id: 'f4', kind: 'face', face: 4 }, { id: 'f5', kind: 'face', face: 5 }, { id: 'f6', kind: 'face', face: 6 },
  { id: 'three', kind: 'three' }, { id: 'four', kind: 'four' }, { id: 'full', kind: 'full' },
  { id: 'small', kind: 'small' }, { id: 'large', kind: 'large' }, { id: 'five', kind: 'five' }, { id: 'chance', kind: 'chance' },
];

const base = { rolls: 3, wild: false, bonus: { at: 63, worth: 35 }, extra: 100 };
const boxes = (changes = {}) => STANDARD.map(b => ({ mult: 1, ...b, ...(changes[b.id] || {}) }));

export const CLASSIC = {
  ...base, id: 'classic', name: 'Classic',
  blurb: 'The game as it comes in the box. Score 63 in the top section for a 35-point bonus.',
  boxes: boxes(),
};

// Two boxes chosen at random score three times over, different every time you sit down. Never Five of a kind, and
// never Ones, where three times over is still only a few points.
function hotBoxes(seed) {
  const rand = mulberry32(seed);
  const pool = STANDARD.filter(b => b.kind !== 'five' && b.id !== 'f1').map(b => b.id);
  const hot = [];
  while (hot.length < 2) {
    const id = pool[Math.floor(rand() * pool.length)];
    if (!hot.includes(id)) hot.push(id);
  }
  const changes = Object.fromEntries(hot.map(id => [id, { mult: 3 }]));
  const extra = STANDARD.filter(b => hot.includes(b.id) && b.kind === 'face').reduce((a, b) => a + 2 * 3 * b.face, 0);
  return { boxes: boxes(changes), bonus: { at: 63 + extra, worth: 35 } };
}

export const TABLES = [
  {
    board: CLASSIC, twist: null,
    who: { name: 'Pip', line: 'New to the game. Keeps whatever there’s most of.', colour: '#5b8c5a',
      says: { wins: 'Beginner’s luck. Mine, I mean.', loses: 'I kept all the fours. Was that wrong?', ties: 'Is that allowed? Let’s do it again.' } },
    play: { look: false, slip: 0.85, slipBy: 20 },
  },
  {
    twist: 'evens',
    board: {
      ...base, id: 'evens', name: 'Evens',
      blurb: 'There’s no Ones box. Evens takes its place: add up every even die. The top-section bonus needs 72.',
      boxes: boxes({ f1: { id: 'evens', kind: 'evens', face: undefined } }),
      bonus: { at: 72, worth: 35 },
    },
    who: { name: 'Maud', line: 'Plays it safe and takes the points in front of her.', colour: '#8a6d3b',
      says: { wins: 'Points in the hand. Never fails.', loses: 'You took chances. They came off. Hmph.', ties: 'All square. Evens, you might say.' } },
    play: { patience: 0.35, bonus: 0.3, slip: 0.63 },
  },
  {
    twist: 'sixes',
    board: {
      ...base, id: 'sixes', name: 'Triple Sixes',
      blurb: 'Sixes score three times over, so the top-section bonus needs 99: three of each number still earns it.',
      boxes: boxes({ f6: { mult: 3 } }),
      bonus: { at: 99, worth: 35 },
    },
    who: { name: 'Bea', line: 'Patient. Waits for the big numbers.', colour: '#b0503a',
      says: { wins: 'Sixes, every time.', loses: 'The sixes kept me waiting.', ties: 'Patience got us both here.' } },
    play: { patience: 0.6, bonus: 0.6, slip: 0.44, style: { boost: { face: 1.1 } } },
  },
  {
    twist: 'two-rolls',
    board: {
      ...base, id: 'two-rolls', name: 'Two Rolls',
      blurb: 'Only two rolls a turn instead of three. Every keep counts. The top-section bonus needs 52.',
      boxes: boxes(), rolls: 2,
      bonus: { at: 52, worth: 35 },
    },
    who: { name: 'Sol', line: 'Quick hands. Not many slips.', colour: '#3f6f9a',
      says: { wins: 'Two rolls is plenty.', loses: 'Too quick for my own good.', ties: 'Fast, and still level.' } },
    play: { patience: 0.8, bonus: 0.8, slip: 0.35, style: { boost: { chance: 0.7 } } },
  },
  {
    twist: 'wild',
    board: {
      ...base, id: 'wild', name: 'Wild Ones',
      blurb: 'In the bottom section, every 1 counts as whatever number scores best. In the top section a 1 is just a\u00a01. The extra 100 for another five of a kind needs five dice showing the same number.',
      boxes: boxes(), wild: true,
    },
    who: { name: 'Jules', line: 'Knows the odds and rarely forgets them.', colour: '#7a4f8f',
      says: { wins: 'The odds said so.', loses: 'Against the odds. Well played.', ties: 'Less likely than five of a kind. Again?' } },
    play: { patience: 0.9, bonus: 0.8, slip: 0.3, endgame: true, style: { boost: { five: 1.8 } } },
  },
  {
    twist: 'hot',
    board: {
      ...base, id: 'hot', name: 'Hot Boxes',
      blurb: 'Two boxes, picked at random each time you sit down, score three times over. When one is a number box, the top-section bonus rises so three of each number still earns it.',
      hot: true,
    },
    who: { name: 'Otto', line: 'Steady. Hardly puts a foot wrong.', colour: '#2f7d74',
      says: { wins: 'Steady does it.', loses: 'A foot wrong, somewhere.', ties: 'Neither of us put a foot wrong.' } },
    play: { patience: 1, bonus: 1.2, slip: 0.14, endgame: true },
  },
  {
    twist: 'pairs',
    board: {
      ...base, id: 'pairs', name: 'Pairs and the Low Road',
      blurb: 'Three of a kind becomes Two pairs: add up the four paired dice (four of one number count as two pairs). Chance becomes the Low road: 30 if the dice total 12 or less.',
      boxes: boxes({ three: { id: 'pairs', kind: 'pairs' }, chance: { id: 'low', kind: 'low' } }),
    },
    who: { name: 'Wren', line: 'Sharp, and getting sharper.', colour: '#9a7a2f',
      says: { wins: 'Sharper every game.', loses: 'Noted. I’ll be sharper.', ties: 'Sharp, both of us. Again.' } },
    play: { patience: 1, bonus: 1, slip: 0.05, endgame: true },
  },
  {
    twist: 'high',
    board: {
      ...base, id: 'high', name: 'High Stakes',
      blurb: 'Four rolls a turn, and every box in the bottom section scores double. The extra for another five of a kind stays at 100.',
      boxes: boxes(Object.fromEntries(['three', 'four', 'full', 'small', 'large', 'five', 'chance'].map(id => [id, { mult: 2 }]))),
      rolls: 4,
    },
    who: { name: 'The Dealer', line: 'Hasn’t lost a game in years.', beaten: 'Hadn’t lost a game in years.', colour: '#3a3a44',
      says: { wins: 'The house usually does.', loses: 'Years, that was. Well played.', ties: 'The house doesn’t do draws. Deal again.' } },
    play: { patience: 1, bonus: 1, slip: 0, endgame: true },
  },
];

// The board for a table, with anything random about it settled by the seed.
// Past the tour's eight, BACK is the back room (below).
export function boardFor(table, seed) {
  if (table === BACK) return backRoom(seed);
  const b = TABLES[table].board;
  return b.hot ? { ...b, ...hotBoxes(seed) } : b;
}

// ---- the back room ----

// Once the Dealer is beaten, a ninth table after the tour: the Dealer again, at a table made of two of the tour's twists
// at once, drawn each time you sit down. The draw comes from the game's seed, as Hot Boxes' boxes do, so a reload or a
// friend's link gives the same table. Odds, a box no table of the tour has, turns up only here. In a link the back room
// is table 9 (js/links.js).
export const BACK = TABLES.length;

// A twist as it reads on the back room's card, and what it does to a board. Each says what it changes in a sentence of
// its own, in the tour's own words; the bonus is said once, for the two together (see backBoard()).
const swap = (board, id, box) => ({ ...board, boxes: board.boxes.map(b => (b.id === id ? { mult: b.mult, ...box } : b)) });
const times = (board, ids, mult) => ({ ...board, boxes: board.boxes.map(b => (ids.includes(b.id) ? { ...b, mult } : b)) });
export const TWISTS = {
  evens: { name: 'Evens', says: 'There’s no Ones box: Evens takes its place and adds up every even die.', make: b => swap(b, 'f1', { id: 'evens', kind: 'evens' }) },
  odds: { name: 'Odds', says: 'There’s no Twos box: Odds takes its place and adds up every odd die.', make: b => swap(b, 'f2', { id: 'odds', kind: 'odds' }) },
  sixes: { name: 'Triple Sixes', says: 'Sixes score three times over.', make: b => times(b, ['f6'], 3) },
  'two-rolls': { name: 'Two Rolls', says: 'Only two rolls a turn instead of three.', make: b => ({ ...b, rolls: 2 }) },
  wild: {
    name: 'Wild Ones', make: b => ({ ...b, wild: true }),
    says: 'In the bottom section, every 1 counts as whatever number scores best; the extra 100 for another five of a kind needs five dice showing the same number.',
  },
  // Picked last, from the board the other twist has made, so Evens, Odds, Two pairs or the Low road can be hot too. Never
  // Ones or Five of a kind, as at Hot Boxes.
  hot: {
    name: 'Hot Boxes', says: 'Two boxes, picked at random, score three times over.',
    make: (b, rand) => {
      const pool = b.boxes.filter(x => x.kind !== 'five' && x.id !== 'f1').map(x => x.id), hot = [];
      while (hot.length < 2) { const id = pool[Math.floor(rand() * pool.length)]; if (!hot.includes(id)) hot.push(id); }
      return { ...times(b, hot, 3), hot: true };
    },
  },
  pairs: {
    name: 'Pairs and the Low Road', make: b => swap(swap(b, 'three', { id: 'pairs', kind: 'pairs' }), 'chance', { id: 'low', kind: 'low' }),
    says: 'Two pairs (four of one number count) takes the place of Three of a kind, and the Low road (30 if the dice total 12 or less) the place of Chance.',
  },
  high: {
    name: 'High Stakes', make: b => times({ ...b, rolls: 4 }, ['three', 'four', 'full', 'small', 'large', 'five', 'chance', 'pairs', 'low'], 2),
    says: 'Four rolls a turn, and every box in the bottom section scores double; the extra for another five of a kind stays at 100.',
  },
};
const ORDER = Object.keys(TWISTS);

// Every two twists that go together, in the tour's order. Not Two Rolls with High Stakes, which both set the rolls, nor
// Hot Boxes with Triple Sixes or High Stakes, which would triple a box that already scores more.
const CLASH = ['two-rolls+high', 'sixes+hot', 'hot+high'];
export const PAIRS = ORDER.flatMap((a, i) => ORDER.slice(i + 1).map(b => `${a}+${b}`)).filter(k => !CLASH.includes(k));

// The top-section bonus for a back-room table: three of each number, Evens' 12 and Odds' 9 in their boxes, each times its
// multiplier, as the tour's tables work it out; cut as Two Rolls cuts 63 to 52 when there are only two rolls a turn.
const PAR = { face: b => 3 * b.face, evens: () => 12, odds: () => 9 };
export function backBonus(board) {
  const at = board.boxes.filter(b => b.kind in PAR).reduce((a, b) => a + PAR[b.kind](b) * b.mult, 0);
  return Math.round(board.rolls === 2 ? (at * 52) / 63 : at);
}

// Classic with the twists `keys` on it, Hot Boxes' boxes drawn by `rand` from the board the others have made, and the
// bonus worked out for them together. Each says what it does in its own sentence, then the bonus once.
function twisted(keys, rand) {
  let board = { ...base, boxes: boxes() };
  for (const k of [...keys].sort((x, y) => (x === 'hot') - (y === 'hot'))) board = TWISTS[k].make(board, rand);
  const at = backBonus(board);
  return { ...board, blurb: `${keys.map(k => TWISTS[k].says).join(' ')} The top-section bonus needs ${at}.`, bonus: { at, worth: 35 } };
}

// The board for the two twists `key` ("two-rolls+wild"), with Hot Boxes' boxes drawn by `rand`.
export function backBoard(key, rand) {
  const keys = key.split('+');
  return { ...twisted(keys, rand), id: `back:${key}`, name: keys.map(k => TWISTS[k].name).join(' with '), twists: keys };
}

// The back room's table for a game's seed: which two twists, and at Hot Boxes which boxes.
export function backRoom(seed) {
  const rand = mulberry32(mix(seed, 0xbac));
  return backBoard(PAIRS[Math.floor(rand() * PAIRS.length)], rand);
}

// ---- the week's twist ----

// Each week one of the back room's twists goes on every table of the tour (js/week.js says which), on top of the table's
// own, as the back room puts two together. Not where it's the table's own twist, nor where the two clash (the pairs PAIRS
// leaves out): that table plays as it always does that week. On Classic it's that twist alone.
const fits = (a, b) => PAIRS.includes(ORDER.indexOf(a) < ORDER.indexOf(b) ? `${a}+${b}` : `${b}+${a}`);
export const changes = (table, key) => !!TWISTS[key] && (!TABLES[table].twist || (TABLES[table].twist !== key && fits(TABLES[table].twist, key)));

// Table `table`'s board for a game's seed in a week whose twist is `key`: the table's own twist and then the week's
// ("Evens with Wild Ones"), with Hot Boxes' boxes drawn from the seed. The board says which table and which week's twist
// (`of` and `week`), so a friend's link can open it again. Where the week's twist doesn't change the table, or there's
// none, the table's own board.
export function weekBoard(table, seed, key) {
  if (!changes(table, key)) return boardFor(table, seed);
  const own = TABLES[table].twist, keys = own ? [own, key] : [key];
  return {
    ...twisted(keys, mulberry32(mix(seed, 0x7ee))), id: `week:${table}:${key}`,
    name: `${TABLES[table].board.name} with ${TWISTS[key].name}`, of: table, week: key,
  };
}

// The same, as table `table`'s card shows it before you sit down, when no seed has drawn Hot Boxes' boxes yet: where Hot
// Boxes is one of the two twists, the bonus with no box hot, which rises when a number box is.
export function weekCard(table, key) {
  const board = weekBoard(table, 0, key);
  if (!board.week || !board.hot) return board;
  const keys = (TABLES[table].twist ? [TABLES[table].twist, key] : [key]), at = twisted(keys.filter(k => k !== 'hot')).bonus.at;
  return { ...board, blurb: `${keys.map(k => TWISTS[k].says).join(' ')} The top-section bonus needs ${at}, or more when a number box is hot.` };
}
