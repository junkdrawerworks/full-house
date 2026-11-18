// The rules of the dice game: boards, boxes, scoring and totals. Everything here is plain data and pure functions,
// so a game in progress saves as JSON and the opponents can score positions they're only thinking about.
//
// Dice are five numbers from 1 to 6. A board is
//   { id, name, blurb, rolls, wild, boxes: [{ id, kind, face?, mult }], bonus: { at, worth }, extra }
// where `rolls` is rolls per turn, `wild` makes ones wild in the bottom section, `bonus` is the top-section bonus,
// and `extra` is what each five of a kind after the first is worth (if the first one scored).
// A card is { boxId: score or null } plus `extras`, the count of extra five-of-a-kind bonuses.

export const FACE = ['', 'Ones', 'Twos', 'Threes', 'Fours', 'Fives', 'Sixes'];

// A box's hint says what it pays on this board: a fixed score with its multiplier in, ones wild where they are.
const TIMES = { 2: 'Twice', 3: 'Three times' }, OVER = { 2: ', doubled', 3: ', tripled' };
const over = b => OVER[b.mult] || '';
const pays = (n, b) => n * (b.mult || 1);
const totalHint = (b, board) => `Total of all dice${board?.wild ? ', 1s wild' : ''}${over(b)}`;
const KINDS = {
  face: { upper: true, label: b => FACE[b.face], hint: b => (TIMES[b.mult] ? `${TIMES[b.mult]} the ${FACE[b.face].toLowerCase()}` : '') }, // otherwise the name says it all
  evens: { upper: true, label: () => 'Evens', hint: b => `Add up the even dice${over(b)}` },
  odds: { upper: true, label: () => 'Odds', hint: b => `Add up the odd dice${over(b)}` },
  three: { label: () => 'Three of a kind', hint: totalHint },
  four: { label: () => 'Four of a kind', hint: totalHint },
  full: { label: () => 'Full house', hint: b => `Three and a pair: ${pays(25, b)}` },
  small: { label: () => 'Small straight', hint: b => `Four in a row: ${pays(30, b)}` },
  large: { label: () => 'Large straight', hint: b => `Five in a row: ${pays(40, b)}` },
  five: { label: () => 'Five of a kind', hint: b => `All five the same: ${pays(50, b)}` },
  chance: { label: () => 'Chance', hint: totalHint },
  pairs: { label: () => 'Two pairs', hint: b => `Total of the four paired dice${over(b)}` },
  low: { label: () => 'Low road', hint: b => `Total of 12 or less: ${pays(30, b)}` },
};

export const isUpper = box => !!KINDS[box.kind].upper;
export const boxLabel = box => KINDS[box.kind].label(box);
export const boxHint = (box, board) => KINDS[box.kind].hint(box, board);

const counts = dice => {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d]++;
  return c;
};
const sum = dice => dice.reduce((a, b) => a + b, 0);

// What a box scores for these dice, before its multiplier, with every die counting as itself.
function plain(kind, dice, face) {
  const c = counts(dice), total = sum(dice);
  switch (kind) {
    case 'face': return face * c[face];
    case 'evens': return 2 * c[2] + 4 * c[4] + 6 * c[6];
    case 'odds': return c[1] + 3 * c[3] + 5 * c[5];
    case 'three': return c.some(n => n >= 3) ? total : 0;
    case 'four': return c.some(n => n >= 4) ? total : 0;
    case 'full': return c.includes(3) && c.includes(2) ? 25 : 0;
    case 'small': return [[1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6]].some(run => run.every(f => c[f])) ? 30 : 0;
    case 'large': return [[1, 2, 3, 4, 5], [2, 3, 4, 5, 6]].some(run => run.every(f => c[f])) ? 40 : 0;
    case 'five': return c.includes(5) ? 50 : 0;
    case 'chance': return total;
    case 'pairs': {
      const faces = [6, 5, 4, 3, 2, 1].filter(f => c[f] >= 2);
      return faces.length >= 2 ? 2 * (faces[0] + faces[1]) : 0;
    }
    case 'low': return total <= 12 ? 30 : 0;
  }
  return 0;
}

// Every way the ones could be read when they're wild: each 1 stands for whatever number scores best.
function readings(dice) {
  const ones = dice.filter(d => d === 1).length, rest = dice.filter(d => d !== 1);
  if (!ones) return [dice];
  const out = [];
  const go = (k, acc) => {
    if (k === ones) { out.push([...rest, ...acc]); return; }
    for (let f = k ? acc[k - 1] : 1; f <= 6; f++) go(k + 1, [...acc, f]); // in order, so each reading comes up once
  };
  go(0, []);
  return out;
}

// A box's score for these dice on this board, multiplier included.
export function score(board, box, dice) {
  let raw;
  if (board.wild && !isUpper(box)) raw = Math.max(...readings(dice).map(d => plain(box.kind, d, box.face)));
  else raw = plain(box.kind, dice, box.face);
  return raw * (box.mult || 1);
}

// A true five of a kind, all five dice showing the same number. Returns the number, or 0.
// (With wild ones, a five of a kind made with ones still fills the five-of-a-kind box, but only a true one
// earns the extra bonus and the joker rules, or wild-ones games would be all bonuses.)
export function fiveOf(board, dice) {
  const c = counts(dice);
  for (let f = 1; f <= 6; f++) if (c[f] === 5) return f;
  return 0;
}

// A second five of a kind, rolled with the Five of a kind box filled: the joker rules. Returns null for any other roll,
// or { face, extra, forced, lower, topOnly }: the number rolled; what it earns extra (if the five-of-a-kind box holds a
// score, not a 0); the box it has to go in, its own number's if that's open; failing that, the open boxes in the bottom
// section it can go in, where the full house and straights count in full; and failing those, whether only top boxes
// are left, where it scores what it scores (0, unless one adds up even dice).
export function jokerState(board, card, dice) {
  const fiveBox = board.boxes.find(b => b.kind === 'five');
  const f = fiveOf(board, dice);
  if (!f || !fiveBox || card[fiveBox.id] === null || card[fiveBox.id] === undefined) return null;
  const open = openBoxes(board, card);
  const forced = open.find(b => b.kind === 'face' && b.face === f) || null;
  const lower = forced ? [] : open.filter(b => !isUpper(b));
  return { face: f, extra: card[fiveBox.id] > 0 ? board.extra : 0, forced, lower, topOnly: !forced && !lower.length };
}

const openBoxes = (board, card) => board.boxes.filter(b => card[b.id] === null || card[b.id] === undefined);

// The boxes you may score these dice in, and what each would give. With a second five of a kind, the joker rules
// above. (Two pairs counts in full too, as two pairs of the same number.)
export function options(board, card, dice) {
  const open = openBoxes(board, card);
  const joker = jokerState(board, card, dice);
  if (!joker) return open.map(b => ({ box: b, score: score(board, b, dice), extra: 0 }));
  const { forced, lower, extra, face: f } = joker;
  if (forced) return [{ box: forced, score: score(board, forced, dice), extra }];
  const full = { full: 25, small: 30, large: 40, pairs: 4 * f };
  if (lower.length) return lower.map(b => ({ box: b, score: b.kind in full ? full[b.kind] * (b.mult || 1) : score(board, b, dice), extra }));
  return open.map(b => ({ box: b, score: score(board, b, dice), extra }));
}

export function blankCard(board) {
  const card = { extras: 0 };
  for (const b of board.boxes) card[b.id] = null;
  return card;
}

export const filled = (board, card) => board.boxes.every(b => card[b.id] !== null);
export const turnsLeft = (board, card) => board.boxes.filter(b => card[b.id] === null).length;

export function totals(board, card) {
  let upper = 0, lower = 0;
  for (const b of board.boxes) {
    const v = card[b.id] ?? 0;
    if (isUpper(b)) upper += v; else lower += v;
  }
  const bonus = upper >= board.bonus.at ? board.bonus.worth : 0;
  const extras = (card.extras || 0) * board.extra;
  return { upper, bonus, lower, extras, total: upper + bonus + lower + extras };
}

// Put a score in a box. Returns the new card.
export function mark(card, option) {
  return { ...card, [option.box.id]: option.score, extras: (card.extras || 0) + (option.extra ? 1 : 0) };
}
