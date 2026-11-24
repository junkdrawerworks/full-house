// The week's climb. Every Monday, from local midnight by your own clock (as today's table goes by your own date), the
// tour starts again: Pip is next up, and the tables open one by one as you beat them. Once the week's climb is finished,
// Go round again starts it over early, in the same week and with the same twist. Each week also has a twist of its own,
// one of the back room's, which goes on every table of the tour (js/tour.js, weekBoard()).
//
// What resets is only the week's lap: progress.week, { start, twist, n, beaten, games, prev }, where `start` is the
// week's Monday ("2026-11-23"), `twist` its twist, `n` counts laps (it goes up with each new one, so a game knows which
// it belongs to), `beaten` the tables beaten in this lap, `games` the games of the tour played in it, wins and losses
// (null where that isn't known), and `prev` the lap before, kept only while a game from it is still being played, so
// that game counts for the week it was started in. progress.laps, { done, best }, is the laps finished and the fewest
// games one took. Everything else in the progress (bests, records, the back room, quick games, today's table, the
// pocket, and `beaten`, every table ever beaten) carries on from week to week.

import { mulberry32, mix } from './rng.js';
import { TABLES, TWISTS } from './tour.js';

const LAST = TABLES.length - 1;
const KEYS = Object.keys(TWISTS);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// A date on the calendar, "2026-11-23", as a count of days, the same in any time zone.
const dayNo = day => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// The Monday that starts the week `date` is in, where you are.
export const monday = (date = new Date()) => ymd(new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7)));

// The week's twist, from its Monday's date: the same all week, and the same for everyone. The twists come round in a
// shuffled order, each once in every eight weeks, so each week has a new one, and never the same two weeks running.
const EPOCH = dayNo('1970-01-05'); // a Monday
const order = cycle => {
  const rand = mulberry32(mix(cycle, 0x3eec)), o = [...KEYS];
  for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
  return o;
};
export function weekTwist(start) {
  const w = Math.floor((dayNo(start) - EPOCH) / 7), cycle = Math.floor(w / KEYS.length), o = order(cycle);
  if (o[0] === order(cycle - 1)[KEYS.length - 1]) [o[0], o[1]] = [o[1], o[0]];
  return o[w - cycle * KEYS.length];
}

// A new lap, for the week starting `start`.
const lap = (start, n, prev = null) => ({ start, twist: weekTwist(start), n, beaten: [], games: 0, prev });

const count = n => (Number.isInteger(n) && n >= 0 ? n : null);
const bools = a => (Array.isArray(a) ? a.slice(0, TABLES.length).map(Boolean) : []);
const lapFrom = w => ({ n: Number.isInteger(w.n) ? w.n : 1, beaten: bools(w.beaten), games: count(w.games) });

// The week and the laps from a save, with `p` the rest of the progress, already read. A save from before the weekly climb
// keeps where it had got to on the tour as this week's lap, so the update itself resets nothing until next Monday. A
// finished tour there is one lap done; the games it took aren't known, so it can't be the best lap (nor can a lap
// carried over part way, once it's finished).
export function weekFrom(p, now = new Date()) {
  const w = p.week;
  let week;
  if (w && typeof w === 'object' && DAY.test(w.start) && TWISTS[w.twist]) {
    const prev = w.prev && typeof w.prev === 'object' ? lapFrom(w.prev) : null;
    week = { start: w.start, twist: w.twist, ...lapFrom(w), prev };
  } else {
    week = { ...lap(monday(now), 1), beaten: bools(p.beaten), games: p.played.some(n => n > 0) ? null : 0 };
  }
  const l = p.laps && typeof p.laps === 'object' ? p.laps : null;
  const laps = l ? { done: count(l.done) ?? 0, best: count(l.best) || null } : { done: week.beaten[LAST] ? 1 : 0, best: null };
  return { week, laps };
}

// Whether the week has turned since the lap began: a Monday has come round, by the clock where you are. Then a new lap
// starts, with the new week's twist. If a game of the tour from the old lap is still being played, the old lap is kept
// beside it until that game ends, so it counts there. A clock put back a week or less (a flight west across Monday's
// midnight, say) leaves the lap as it is; one put back further is taken at its word, so a clock once set wrong ahead
// doesn't leave the tour waiting weeks for its next Monday.
export function turnOver(progress, now = new Date(), game = null) {
  const w = progress.week, start = monday(now);
  if (start === w.start || (start < w.start && dayNo(w.start) - dayNo(start) <= 7)) return false;
  const open = !!game && !game.over && isTour(game) && lapOf(progress, game) === w && !w.beaten[LAST];
  progress.week = lap(start, w.n + 1, open ? { n: w.n, beaten: w.beaten, games: w.games } : null);
  return true;
}

// Go round again: once the week's climb is finished, the same week's climb from the start, with the same twist.
export function goAgain(progress) {
  const w = progress.week;
  if (!w.beaten[LAST]) return false;
  progress.week = { ...w, n: w.n + 1, beaten: [], games: 0, prev: null };
  return true;
}

// A game at a table of the tour, as against a quick game, today's table, a friend's, the back room or Two players.
export const isTour = g => !g.kind && Number.isInteger(g.table);

// The lap game `g` belongs to: this week's, the one before it while a game from it is still going, or none (a lap since
// gone round again). A game saved before laps were counted belongs to this week's.
const lapOf = (progress, g) => {
  const w = progress.week, n = g.lap ?? w.n;
  return n === w.n ? w : w.prev && w.prev.n === n ? w.prev : null;
};

// A game of the tour has ended, `won` or not (given up, it's a loss): it counts for its lap. One more game played there,
// till the lap is finished, and a win ticks off its table, as long as the table before it is (so a game started at a
// table the week has since closed again opens nothing). Beating the Dealer finishes the lap: one more lap done, and the
// best lap if it took fewer games than any before. Returns what the result needs to say about it: whether the game
// counted for this week's lap (`now`) or the last (`last`), whether the table was beaten in that lap before, and on
// finishing a lap (`done`), the games it took and the best lap before it.
export function credit(progress, g, won) {
  const w = progress.week, l = lapOf(progress, g), i = g.table;
  if (!l) return { now: false, last: false, before: false, done: false };
  const was = !!l.beaten[LAST], before = !!l.beaten[i], best = progress.laps.best;
  if (!was && l.games !== null) l.games++;
  if (won && (i === 0 || l.beaten[i - 1])) l.beaten[i] = true;
  const done = !was && !!l.beaten[LAST];
  if (done) {
    progress.laps.done++;
    if (l.games !== null && (best === null || l.games < best)) progress.laps.best = l.games;
  }
  const last = l !== w;
  if (last) w.prev = null; // its last game is over
  return { now: !last, last, before, done, games: l.games, best };
}

// How many tables the week's lap has beaten.
export const beatenNow = progress => progress.week.beaten.filter(Boolean).length;
