// Links that open a table with the dice somebody else had. Nothing here needs a server: the dice come from a seed
// carried in the link.
//
// A link is the game's address with what it opens after a #, so it works offline too, and none of it reaches a server:
//   https://full-house.junkdrawer.works/#table=6&dice=k3j2h1&score=288
// table: the table whose rules it's played by, 1 to 8. dice: the game's seed, in base 36. score: what the person who
// sent it scored with those dice (left out, it's a table to try without a score to beat). vs: the opponent, by the
// number of their table, when it isn't that table's own (a quick game's). The README promises these keep opening.

export const HOME = 'https://full-house.junkdrawer.works/';

export function linkFor({ table, opp = table, seed, score = null }) {
  const p = new URLSearchParams({ table: String(table + 1), dice: (seed >>> 0).toString(36) });
  if (opp !== table) p.set('vs', String(opp + 1));
  if (Number.isInteger(score) && score >= 0) p.set('score', String(score));
  return `${HOME}#${p}`;
}

// What a link's # part asks for: { table, opp, seed, score }, counted from 0 as the game counts tables, with score null
// when there isn't one. Anything else in it is ignored; a link that doesn't make sense gives null.
export function readLink(hash, tables = 8) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const n = key => (/^\d{1,5}$/.test(p.get(key) || '') ? Number(p.get(key)) : NaN);
  const table = n('table') - 1, opp = p.has('vs') ? n('vs') - 1 : table, dice = p.get('dice') || '';
  if (!/^[0-9a-z]{1,7}$/.test(dice)) return null;
  const seed = parseInt(dice, 36);
  if (!(table >= 0 && table < tables) || !(opp >= 0 && opp < tables) || seed > 0xffffffff) return null;
  const score = p.has('score') ? n('score') : NaN;
  return { table, opp, seed, score: Number.isInteger(score) ? score : null };
}
