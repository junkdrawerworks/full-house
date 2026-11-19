// The rule-of-thumb player, for dev/ladder.mjs and dev/backroom.mjs. It stands in for a person who knows the game: it
// stops on a made hand, goes for a straight with four in a row, for more of a number with three or more, for a full house
// with two pairs, keeps a pair or a high die, and scores where the dice beat what that box usually scores by the most,
// minding the top-section bonus. It reads the table too: multipliers, wild ones, Evens, Two pairs and the Low road.
import { options, isUpper, totals, turnsLeft } from '../js/rules.js';

const countsOf = dice => { const c = [0, 0, 0, 0, 0, 0, 0]; for (const d of dice) c[d]++; return c; };
const keepCounts = (dice, counts) => { const left = counts.slice(); return dice.map(d => (left[d] > 0 ? (left[d]--, true) : false)); };
// What a box usually scores for someone playing this way, before its multiplier; the top boxes go by par.
const USUAL = { evens: 15, odds: 9, three: 17, four: 10, full: 21, small: 25, large: 28, five: 14, chance: 21, pairs: 14, low: 14 };
const par = b => (b.kind === 'face' ? 3 * b.face : b.kind === 'evens' ? 12 : b.kind === 'odds' ? 9 : 0) * (b.mult || 1);

export const ruleOfThumb = {
  keep(board, card, dice, rollsLeft) {
    if (rollsLeft <= 0) return null;
    const open = board.boxes.filter(b => card[b.id] === null), has = kind => open.some(b => b.kind === kind);
    const openFace = f => open.some(b => b.kind === 'face' && b.face === f);
    const opts = options(board, card, dice), got = kind => opts.some(o => o.box.kind === kind && o.score > 0);
    const c = countsOf(dice), wild = board.wild;
    // A made hand: stop. With wild ones a full house comes too easily to stop for.
    if (opts.some(o => o.extra > 0) || got('five') || got('large') || (got('small') && !has('large'))) return null;
    if ((!wild && got('full')) || (got('low') && !has('small') && !has('large'))) return null;

    // Straights: the best run of four (or five) numbers, with wild ones filling gaps.
    const run = len => {
      let best = null;
      for (let s = 1; s + len - 1 <= 6; s++) {
        const faces = [], gaps = [];
        for (let f = s; f < s + len; f++) ((wild ? f !== 1 && c[f] : c[f]) ? faces : gaps).push(f);
        const fill = wild ? Math.min(c[1], gaps.length) : 0, n = faces.length + fill;
        if (!best || n > best.n || (n === best.n && s > best.s)) best = { n, s, faces, fill };
      }
      return best;
    };
    const keepRun = r => keepCounts(dice, countsOf([...r.faces, ...Array(r.fill).fill(1)]));
    const r4 = run(4);
    if (has('large') && r4.n >= 4) { const r5 = run(5); return keepRun(r5.n >= 4 ? r5 : r4); }

    // Of a kind: the number there's most of, with wild ones counted in while the bottom section can use them.
    const ofAKind = ['three', 'four', 'five', 'full', 'pairs'].some(has);
    const wildFor = f => wild && ofAKind && f !== 1;
    let face = 0, best = -1;
    for (let f = 6; f >= 1; f--) {
      if (wild && ofAKind && f === 1) continue;
      const n = c[f] + (wildFor(f) ? c[1] : 0), useful = openFace(f) || ofAKind;
      const score = n * 10 + (openFace(f) ? 2 : 0) + f / 10 - (useful ? 0 : 100);
      if (score > best) { best = score; face = f; }
    }
    const n = openFace(face) || ofAKind ? c[face] + (wildFor(face) ? c[1] : 0) : 0;
    // Only five dice showing the same number earn the extra 100, so once Five of a kind has scored, three or more of
    // a number go for five real ones and let the wild ones go.
    const fiveBox = board.boxes.find(b => b.kind === 'five');
    const realFive = wild && card[fiveBox.id] > 0 && c[face] >= 3;
    const keepFace = () => dice.map(d => d === face || (wildFor(face) && !realFive && d === 1));
    if (n >= 3) return n === 5 && !realFive ? null : keepFace();

    // Two pairs go for a full house (or Two pairs), three in a row for a straight, and on the tables with them,
    // three even dice for Evens and three ones and twos for the Low road.
    const pairs = [1, 2, 3, 4, 5, 6].filter(f => c[f] >= 2);
    if (pairs.length >= 2 && (has('full') || has('pairs'))) return dice.map(d => pairs.includes(d));
    const r3 = run(3);
    if ((has('small') || has('large')) && r3.n >= 3 && n <= 2 && r4.n >= 3) return keepRun(r4.n >= 4 ? r4 : r3);
    if (has('evens') && c[2] + c[4] + c[6] >= 3) return dice.map(d => d % 2 === 0);
    if (has('low') && c[1] + c[2] >= 3) return dice.map(d => d <= 2);
    // A pair, or else a high die for the boxes that add up the dice, or roll them all.
    if (n === 2) return keepFace();
    const hi = Math.max(...dice);
    if (hi >= 5) { let kept = false; return dice.map(d => (d === hi && !kept ? (kept = true) : false)); }
    return dice.map(() => false);
  },

  box(board, card, dice) {
    const later = (turnsLeft(board, card) - 1) / 12, need = board.bonus.at - totals(board, card).upper;
    let best = null, most = -Infinity;
    for (const o of options(board, card, dice)) {
      const b = o.box;
      let v = o.score + o.extra - later * (isUpper(b) ? par(b) : USUAL[b.kind] * (b.mult || 1));
      if (isUpper(b) && need > 0) v += o.score >= need ? 0.8 * board.bonus.worth : 1.5 * (o.score - par(b));
      if (v > most) { most = v; best = o; }
    }
    return best;
  },
};
