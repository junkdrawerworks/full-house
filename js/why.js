// Why a game went the way it did: one plain line for the result, worked out from the two finished cards. It names the
// biggest gap between the winner's card and the loser's, in one of four parts of the pad: the top section, the bonus,
// five of a kind (its box and any extra fives) and the rest of the bottom section. A close game (20 points or less) or a
// tie has no line: the dice decided it.

import { totals } from './rules.js';

export const CLOSE = 20; // a game won by this much or less has no line
const TIMES = ['', 'once', 'twice', 'three times', 'four times', 'five times', 'six times'];

// `name` is the opponent's ("Maud", "The Dealer"). From your side of the table: "Maud's top section came to 64 and
// yours to 33." on a loss, "Your top section came to 64 and Maud's to 33." on a win.
export function whyLine(board, you, them, name) {
  const ty = totals(board, you), tt = totals(board, them);
  const margin = Math.abs(ty.total - tt.total);
  if (margin <= CLOSE) return '';
  const won = ty.total > tt.total;
  const [w, l] = won ? [you, them] : [them, you], [tw, tl] = won ? [ty, tt] : [tt, ty];
  const opp = name, mid = name.replace(/^The /, 'the ');
  // Who is who in the sentence: the winner and the loser, as a subject and a possessive, at its start or inside it.
  const W = won ? { who: 'You', whose: 'Your', inWhose: 'your' } : { who: opp, whose: `${opp}’s`, inWhose: `${mid}’s` };
  const L = won ? { who: mid, whose: `${mid}’s`, was: 'was', did: 'did' } : { who: 'you', whose: 'yours', was: 'were', did: 'did' };

  const fiveBox = board.boxes.find(b => b.kind === 'five');
  const fives = card => (fiveBox && card[fiveBox.id] ? 1 : 0) + (card.extras || 0); // how many five of a kinds went down
  const fivePts = (card, t) => (fiveBox ? card[fiveBox.id] || 0 : 0) + t.extras;
  const rest = (card, t) => t.lower - (fiveBox ? card[fiveBox.id] || 0 : 0);

  const parts = [
    { gap: tw.bonus - tl.bonus, line: () => `${W.who} got the ${board.bonus.worth} bonus; ${L.who} ${L.was} ${board.bonus.at - tl.upper} short.` },
    {
      gap: fivePts(w, tw) - fivePts(l, tl),
      line: gap => {
        const n = fives(w), m = fives(l);
        if (n === 1 && !m) return gap >= margin ? `${W.whose} five of a kind was the difference.` : `${W.who} rolled five of a kind; ${L.who} didn’t.`;
        return `${W.who} rolled five of a kind ${TIMES[n] || `${n} times`}; ${L.who} ${m ? `${L.did} ${TIMES[m]}` : 'never did'}.`;
      },
    },
    { gap: tw.upper - tl.upper, line: () => `${W.whose} top section came to ${tw.upper} and ${L.whose} to ${tl.upper}.` },
    {
      gap: rest(w, tw) - rest(l, tl),
      // The bottom section as the pad adds it up, unless five of a kind went differently: then without it, and it says so.
      line: () => (fivePts(w, tw) === fivePts(l, tl) && fives(w) === fives(l)
        ? `${W.whose} bottom section came to ${tw.lower} and ${L.whose} to ${tl.lower}.`
        : `Leaving out five of a kind, ${W.inWhose} bottom section came to ${rest(w, tw)} and ${L.whose} to ${rest(l, tl)}.`),
    },
  ];
  // The biggest gap wins; on a draw, the first in that list (the bonus, then five of a kind, the top, the bottom).
  const top = parts.reduce((a, b) => (b.gap > a.gap ? b : a));
  return top.line(top.gap);
}
