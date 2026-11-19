// Full House: the tour, a game in progress, and the opponent's turns played out on the table.

import { blankCard, options, jokerState, mark, totals, filled, turnsLeft, boxLabel, isUpper } from './rules.js';
import { TABLES, boardFor, CLASSIC, BACK } from './tour.js';
import { Opponent } from './ai.js';
import { Tray } from './dice.js';
import { Pad, ring } from './pad.js';
import { mulberry32, rollFor } from './rng.js';
import { whyLine } from './why.js';
import { readLink, linkFor, today, dayName } from './links.js';
import * as sound from './sound.js';

const KEY = 'full-house.v1';
const $ = id => document.getElementById(id);
const saved = read();
const settings = settingsFrom(saved.settings);
const progress = progressFrom(saved.progress);

let game = whole(saved.game) ? saved.game : null;
let busy = false;      // dice in the air, or the opponent playing (or about to)
let hurry = false;     // the player tapped to hurry the opponent along
let picked = null;     // the box you've tapped once and not yet scored
let fresh = {};        // boxes just written in, pencilled in as you watch
let theirPick = null;  // the box the opponent is about to write in
let token = 0;         // changes whenever a game starts or ends, so a turn being played out knows to stop
let theirDice = false;  // the dice in the tray are the opponent's: they've rolled this turn (or the last of the game)
let resultSeen = false; // the finished game's result has been shown
let givingUp = false;  // Give up tapped once in the menu, and not yet again
let playing = -1;      // the token of the game whose opponent is playing a turn right now, so only one copy runs

const tray = new Tray($('tray'), { onToggle: toggle, onTap: () => { if (busy && game?.turn === 'them') hurry = true; } });
const pad = new Pad($('pad'), { onPick: pick });
// At Two players (kind 'two'), the second player, Red, sits where the opponent would: their column, their red dice.
const two = g => g?.kind === 'two';
// Whose turn starts each round: yours, or at Two players whoever started this game ('them' when Red did, from Play again).
const starter = g => (two(g) && g.first === 'them' ? 'them' : 'you');
const RED = '#b0392d';
const who = g => (two(g) ? { name: g.names[1], colour: RED } : TABLES[g.opp].who);
// Whose column is "you": yours, or at Two players the first player's, Black.
const me = g => (two(g) ? g.names[0] : 'You');
// The player whose turn it is, when it's played at this phone: yours, or either at Two players. `side` is their card.
const hands = g => g.turn === 'you' || two(g);
const turnName = g => (g.turn === 'you' ? me(g) : who(g).name);
// Whether leaving game `g` part way counts against you: not at a friend's table, at Two players, or at a day's table once
// that day's game is in (see countDay()).
const counts = g => !(g.kind === 'friend' || two(g) || (g.kind === 'day' && !!progress.today && progress.today.day >= g.day));
// What leaving game `g` part way costs, said after it: a loss, which in the back room ends a run of wins as well.
// (`nb` keeps the last two words together where a line would otherwise leave one on its own.)
const costs = (g, nb = '\u00a0') => (!counts(g) ? '' : g.kind === 'back' && progress.back.run ? ` It ends your run of${nb}${progress.back.run}.` : ` It counts as a${nb}loss.`);
// What a card says when sitting down would end the game you're in, if you're in one.
const ends = () => (game && !game.over ? `Sitting down here ends the game you’re in.${costs(game)}` : '');
// What's said of the opponent from table i: the Dealer's line changes once you've beaten him.
const lineOf = i => (progress.beaten[i] && TABLES[i].who.beaten) || TABLES[i].who.line;
// "Two players"; "Table 3: Triple Sixes"; a quick game, "Quick game", or at a table other than Classic, "Quick game: Wild Ones"; a
// game from a friend's link, "A friend’s table: Hot Boxes"; today's table, "Today’s table: Hot Boxes"; the back room, "The
// back room: Two Rolls with Wild Ones".
const where = g => (two(g) ? 'Two players' : g.kind === 'friend' ? `A friend’s table: ${g.board.name}` : g.kind === 'day' ? `Today’s table: ${g.board.name}`
  : g.kind === 'back' ? `The back room: ${g.board.name}`
  : g.table !== null ? `Table ${g.table + 1}: ${g.board.name}` : g.board.id === CLASSIC.id ? 'Quick game' : `Quick game: ${g.board.name}`);
// The table whose rules a game is played by: its own on the tour, the one chosen for a quick game (Classic unless another),
// or the back room, whose boards come from the seed.
const rulesOf = g => (g.board.twists ? BACK : Math.max(0, TABLES.findIndex(t => t.board.id === g.board.id)));
// The table chosen for quick games: one you've beaten, once you've beaten two, and otherwise Classic.
const quickAt = () => (quickTables().includes(settings.quickAt) ? settings.quickAt : 0);
const quickTables = () => (progress.beaten.filter(Boolean).length >= 2 ? TABLES.map((t, i) => i).filter(i => progress.beaten[i]) : []);
// A name inside a sentence: "against the Dealer". At the start of one, and on the pad and the tour, it keeps its capital.
const mid = name => name.replace(/^The /, 'the ');
const die = () => 1 + Math.floor(Math.random() * 6); // a new game's dice, before anything is rolled
// Quick or Just their score: the opponent plays faster, and your own dice land sooner too.
const quick = () => settings.pace !== 'normal';

// ---- your turn ----

const allHeld = g => g.rolls > 0 && g.held.every(Boolean); // nothing left to roll

function roll() {
  const g = game;
  if (!g || g.over || busy || !hands(g) || g.rolls >= g.board.rolls || allHeld(g)) return;
  if (settings.sound) sound.wake(); // from the tap, which a phone needs before it lets the page make a sound
  picked = null;
  // From the game's seed: anyone playing from it gets the same number in each place on this roll of this turn.
  // (At Two players, Red's from a stream of their own.)
  const thrown = rollFor(g.seed, g.number, g.rolls + 1, g.turn === 'them' ? 1 : 0), rolled = [];
  g.dice = g.dice.map((d, i) => (g.held[i] && g.rolls > 0 ? d : (rolled.push(i), thrown[i])));
  if (g.rolls === 0) g.held = [false, false, false, false, false];
  g.rolls++;
  busy = true;
  status(''); // nothing under dice in the air (the line keeps its height): render() says what they came to when they land
  showDice(rolled);
  render();
  save();
  setTimeout(() => {
    busy = false;
    showDice();
    render();
    if (game !== g) return;
    pad.revealOpen(); // the only time your own turn moves the pad: when nothing you can score is in view
    const left = g.board.rolls - g.rolls;
    const five = /^Five of a kind/.test($('status').textContent) ? ` ${$('status').textContent}` : ''; // the first or another
    say(`${turnName(g)} rolled ${g.dice.join(', ')}. ${left ? `${left} roll${left === 1 ? '' : 's'} left.` : 'No rolls left.'}${five}`);
  }, quick() ? 450 : 750);
}

function toggle(i) {
  const g = game;
  if (!g || busy || !hands(g) || g.rolls === 0 || g.rolls >= g.board.rolls) return;
  g.held[i] = !g.held[i];
  if (settings.sound) buzz();
  picked = null;
  showDice();
  render();
  save();
  const kept = g.dice.filter((d, k) => g.held[k]);
  say(kept.length ? `Holding ${kept.join(', ')}.` : 'Holding none.');
}

// Tap a box once to pick it, again to score it.
function pick(id) {
  const g = game;
  if (!g || busy || !hands(g) || g.rolls === 0) return;
  if (picked !== id) { picked = id; render(); say($('status').textContent); return; }
  const side = g.turn;
  const option = options(g.board, g[side], g.dice).find(o => o.box.id === id);
  if (!option) return;
  const made = makesBonus(g.board, g[side], option);
  if (settings.sound) sound.wake();
  g[side] = mark(g[side], option);
  fresh = { [side]: id, bonus: made ? side : null };
  picked = null;
  if (option.extra) toast(`Another five of a kind: ${g.board.extra} extra points.`);
  else if (option.box.kind === 'five' && option.score) toast('Five of a kind.');
  if (two(g)) { passOn(g, option, made); return; }
  g.turn = 'them';
  g.held = [false, false, false, false, false];
  hurry = false; // a tap from here on hurries the turn that's coming, even before they roll
  busy = true; // the opponent is about to play, so going back and carrying on mustn't start their turn as well
  save();
  render();
  showDice(); // still yours, until the opponent rolls
  $('b-roll').focus({ preventScroll: true }); // the box picked from the keyboard has gone: Roll says whose turn it is, then yours
  const line = `You score ${option.score} in ${boxLabel(option.box)}${option.extra ? `, plus ${g.board.extra} extra` : ''}${made ? `, and the ${g.board.bonus.worth}\u00a0bonus` : ''}.`;
  status(line);
  say(line);
  setTimeout(theirTurn, quick() ? 300 : 650);
}

// At Two players, the phone goes to the other player: from whoever started the round to the other, and back for the next
// round, till the pad is full. What was just scored is pencilled in as the turn changes, and heard.
function passOn(g, option, made) {
  const name = turnName(g), b = g.board;
  const line = `${name} scores ${option.score} in ${boxLabel(option.box)}${option.extra ? `, plus ${b.extra} extra` : ''}${made ? `, and the ${b.bonus.worth}\u00a0bonus` : ''}.`;
  g.last = { id: option.box.id, score: option.score, extra: option.extra ? b.extra : 0, bonus: made };
  g.held = [false, false, false, false, false];
  if (filled(b, g.you) && filled(b, g.them)) { finish(line); return; }
  if (g.turn !== starter(g)) g.number++; // a round is over once whoever went second has had their turn
  g.turn = g.turn === 'you' ? 'them' : 'you';
  g.rolls = 0;
  save();
  render();
  showDice();
  $('b-roll').focus({ preventScroll: true });
  say(`${line} ${$('status').textContent}`);
}

// Whether writing in this score brings the top section up to the bonus. ("The\u00a0bonus" keeps together at the end of a line.)
const makesBonus = (board, card, option) => !totals(board, card).bonus && !!totals(board, mark(card, option)).bonus;

// ---- the opponent's turn ----

// `tumble` is how long thrown dice take to land (--tumble in css/app.css). At Just their score only `choose` is waited
// for: the score shows, with their dice where they ended up, for about a second before it's written in.
const PACE = {
  normal: { roll: 800, think: 650, choose: 850, tumble: 700 },
  quick: { roll: 420, think: 280, choose: 420, tumble: 380 },
  score: { roll: 0, think: 0, choose: 1000, tumble: 380 },
};

// Until the dice in the tray have landed: their own animations, which a busy phone can start a frame or two late, so
// not a clock. At most `cap` ms, in case a tab out of sight holds them back.
function landed(cap) {
  const going = $('tray').getAnimations({ subtree: true }).map(a => a.finished.catch(() => {})); // a throw cut short cancels
  return Promise.race([Promise.all(going), new Promise(resolve => setTimeout(resolve, cap))]);
}

// A pause in the opponent's turn, cut to `hurried` ms (or less) once you tap to hurry them along.
function wait(ms, hurried = 140) {
  return new Promise(resolve => {
    const t0 = performance.now();
    const tick = () => (performance.now() - t0 >= (hurry ? Math.min(ms, hurried) : ms) ? resolve() : setTimeout(tick, 30));
    tick();
  });
}

async function theirTurn() {
  const g = game, t = token;
  if (!g || g.turn !== 'them' || g.over || playing === t || two(g)) return;
  // A game saved while two copies of a turn ran at once can have the opponent's card full already.
  if (filled(g.board, g.them)) { if (filled(g.board, g.you)) finish(); else yourTurn(g); return; }
  const still = () => t === token && game === g;
  const pace = PACE[settings.pace], name = who(g).name, b = g.board;
  const glance = settings.pace === 'score', final = turnsLeft(b, g.them) === 1; // Just their score: no rolls played out
  const opp = new Opponent(TABLES[g.opp].play);
  // Their dice and slips come from the game's seed and the turn number, so a turn cut short by a reload (or a phone
  // closing the tab) plays out the same way again, instead of giving them another go.
  const rand = mulberry32((g.seed ^ Math.imul(g.number, 0x9E3779B1)) >>> 0), roll = () => 1 + Math.floor(rand() * 6);
  playing = t;
  busy = true;

  theirDice = true;
  g.held = [false, false, false, false, false];
  g.dice = g.dice.map(roll);
  g.rolls = 1;
  if (!glance) {
    status(`${final ? 'Last turn. ' : ''}${name} rolls.`);
    showDice([0, 1, 2, 3, 4]);
    render();
    await wait(pace.roll);
    if (!still()) return;
  }

  // At Just their score the same rolls and keeps are made, from the same seed, only none of them is shown.
  for (let left = b.rolls - 1; left > 0; left--) {
    const keep = opp.keep(b, g.them, g.dice, left, rand);
    if (!keep) break;
    g.held = keep;
    const n = keep.filter(Boolean).length;
    if (!glance) {
      status(n ? `${name} holds ${n === 1 ? 'one' : ['', '', 'two', 'three', 'four'][n]} and rolls again.` : `${name} rolls them all again.`);
      showDice();
      await wait(pace.think);
      if (!still()) return;
    }
    const rolled = [];
    g.dice = g.dice.map((d, i) => (keep[i] ? d : (rolled.push(i), roll())));
    g.rolls++;
    if (!glance) {
      showDice(rolled);
      await wait(pace.roll);
      if (!still()) return;
    }
  }
  if (glance) showDice(); // where they ended up, landed, with their last keep held

  // Hurried, the rolls go by before the dice land, but the turn ends on landed dice and a score you can read.
  if (hurry) {
    await landed(pace.tumble + 300);
    if (!still()) return;
  }
  const option = opp.box(b, g.them, g.dice, rand), made = makesBonus(b, g.them, option);
  const what = `${option.score} in ${boxLabel(option.box)}${option.extra ? `, plus ${b.extra} extra` : ''}${made ? ', and the\u00a0bonus' : ''}.`;
  theirPick = { id: option.box.id, score: option.score };
  status(`${glance && final ? 'Last turn. ' : ''}${name} scores ${what}`);
  render();
  pad.reveal(option.box.id); // on a short screen the box may be scrolled out of sight; your own turn moves the pad only to show a box you can score
  await wait(pace.choose, 450);
  if (!still()) return;

  g.them = mark(g.them, option);
  g.last = { id: option.box.id, score: option.score, extra: option.extra ? b.extra : 0, bonus: made }; // for your turn's line, after a reload or Carry on as well
  theirPick = null;
  fresh = { them: option.box.id, bonus: made ? 'them' : null };
  if (option.extra) toast(`${name} rolls another five of a kind: ${b.extra} extra points.`);
  else if (option.box.kind === 'five' && option.score) toast(`${name} rolls five of a kind.`);

  // Heard once, at the end of their turn, rather than as each line goes by: what they scored and where it leaves you.
  const scored = `${name} scored ${what}`;
  if (filled(b, g.you) && filled(b, g.them)) { finish(scored); return; }
  say(`${scored} You ${totals(b, g.you).total}, ${mid(name)} ${totals(b, g.them).total}. Your turn.`);
  yourTurn(g);
}

function yourTurn(g) {
  g.turn = 'you';
  g.number++;
  g.rolls = 0;
  g.held = [false, false, false, false, false];
  busy = false;
  hurry = false;
  playing = -1;
  theirDice = false;
  save();
  render();
  showDice();
  if (document.body.dataset.screen === 'home') renderHome(); // their turn ended behind the tour: Carry on says the new turn
}

// ---- starting and finishing ----

// A game at table `table` of the tour, or a quick game (table null) against the opponent from table `opp`, by the rules of
// table `at` (Classic unless it says otherwise). A quick game never counts on the tour, whatever its rules.
// `spec` is for a game that isn't one of those: { kind: 'friend', seed, score } plays the dice from a friend's link
// (see js/links.js), against the score they had with them, if the link has it. It counts nowhere. { kind: 'day', seed, day }
// is the table of the day `day` ("2026-11-19"): the first game finished or given up there counts for that day, and only there.
// { kind: 'two', names: ['Black', 'Red'] } is Two players: Classic, two people at one phone, counting nowhere, Black first
// unless it says first: 'them' (Play again lets the other player start). { kind: 'back', seed } is the back room, at
// table BACK against the Dealer, on the two twists that seed draws (see backCard()): won, it adds to a run of wins, and lost
// or given up it ends it.
function start(table, opp = table, at = table ?? 0, spec = {}) {
  const seed = spec.seed ?? ((Math.random() * 2 ** 31) | 0);
  const board = boardFor(at, seed);
  if (game && !game.over) concede(true);
  if (spec.kind === 'back') progress.back.next = null; // that draw is used: the next card draws afresh
  token++;
  game = {
    table, opp, seed, board,
    ...(spec.kind === 'friend' && { kind: 'friend', score: spec.score ?? null }),
    ...(spec.kind === 'day' && { kind: 'day', day: spec.day }),
    ...(spec.kind === 'back' && { kind: 'back' }),
    ...(spec.kind === 'two' && { kind: 'two', names: spec.names, first: spec.first === 'them' ? 'them' : 'you' }),
    you: blankCard(board), them: blankCard(board),
    turn: spec.kind === 'two' && spec.first === 'them' ? 'them' : 'you', number: 1, rolls: 0, last: null,
    dice: [die(), die(), die(), die(), die()], held: [false, false, false, false, false],
  };
  busy = hurry = false;
  picked = null;
  theirPick = null;
  theirDice = false;
  hideToast();
  closeSheets();
  open('game');
  document.querySelector('.pad-wrap').scrollTop = $('game').scrollTop = 0; // a new sheet of the pad, from the top (Carry on keeps your place)
  save();
  showDice();
  render();
  say($('status').textContent); // "Your turn. Roll the dice.", or which boxes are hot
}

// `lead`: what the opponent just scored, said before who won.
function finish(lead = '') {
  const g = game, b = g.board;
  token++;
  busy = false;
  g.over = true;
  g.held = [false, false, false, false, false]; // the opponent's last keep
  resultSeen = false;
  fresh.ring = true; // the winning total ringed as you watch, after the last score goes in
  const you = totals(b, g.you).total, them = totals(b, g.them).total, name = who(g).name;
  const won = you > them, tie = you === them;
  if (two(g)) { finishTwo(g, lead, you, them); return; }
  let before = false, best = ''; // you'd beaten this table already; a new best there, over one you had
  let counted = false; // the day's first game, at today's table
  let run = null; // in the back room, the run of wins before this game and after it, and the best run before it
  if (g.kind === 'day') counted = countDay(g, you, them);
  else if (g.kind === 'back') run = countBack(won, tie);
  else if (g.kind) { /* a friend's table counts nowhere */ } else if (g.table !== null) {
    const i = g.table, was = progress.best[i] || 0;
    before = !!progress.beaten[i];
    if (was && you > was) best = `Your best here: ${you} (was ${was}).`;
    progress.played[i] = (progress.played[i] || 0) + 1;
    if (won) { progress.won[i] = (progress.won[i] || 0) + 1; progress.beaten[i] = true; }
    progress.best[i] = Math.max(progress.best[i] || 0, you);
  } else {
    progress.quick.played++;
    if (won) progress.quick.won++;
  }
  save();
  render();
  showDice();
  if (document.body.dataset.screen === 'home') renderHome(); // it ended behind the tour: Carry on goes, and a table may open
  status(won ? 'You win.' : tie ? 'A tie.' : `${name} wins.`);
  say(`${lead ? `${lead} ` : ''}${won ? `You win, ${you} to ${them}.` : tie ? `A tie, ${you} all.` : `${name} wins, ${them} to ${you}.`}`);

  $('result-title').textContent = won ? `You beat ${mid(name)}` : tie ? 'A tie' : `${name} wins`;
  const last = g.table === TABLES.length - 1;
  // Beating the Dealer at the last table finishes the tour, and the result says so above its title.
  // A friend's table, and today's, say so there instead.
  const friend = g.kind === 'friend', day = g.kind === 'day';
  $('result-n').textContent = friend ? 'The same dice your friend had' : day ? `Today’s table · ${dayName(g.day)}` : run ? 'The back room'
    : won && last ? `Table ${TABLES.length} of ${TABLES.length} · the tour` : '';
  $('result-n').hidden = !$('result-n').textContent;
  const why = whyLine(b, g.you, g.them, name);
  const onward = won && g.table !== null && !last && !(before && progress.beaten[g.table + 1]); // a table to send you on to
  $('result-line').textContent = friend ? friendLine(you, g.score, won, why)
    : day ? (counted ? 'That one counts for today. There’s a new table tomorrow.' : 'Just practice: your first game today is the one that counts.')
    : run && won ? (run.now === 1 ? 'That starts a run.' : `That’s ${run.now} in a row.`)
    : run && tie ? 'A tie neither adds to a run nor ends it.'
    : won
    ? g.table === null ? (progress.beaten[g.opp] ? 'A good game.' : `A good game. It doesn’t count on the tour: ${mid(name)} is waiting at table ${g.opp + 1}.`)
      : last ? (before ? `You’ve beaten ${mid(name)} before. That’s still the whole tour.` : 'That’s the whole tour. Nobody at these tables has anything left to teach you.')
      : before ? (onward ? `You’ve beaten ${mid(name)} before; table ${g.table + 2} is still open.` : `You’ve beaten ${mid(name)} before.`)
      : `Table ${g.table + 2} is open: ${TABLES[g.table + 1].board.name}, against ${mid(TABLES[g.table + 1].who.name)}.`
    : tie ? 'Play it again to settle it.' : why || 'The dice owe you one.';
  // Why it went that way, from the two cards, unless it was close: on a loss in place of the line above, on a win under it.
  // At a friend's table it goes under the line about your friend, win or lose, unless that line is the reason itself.
  const beneath = won || day || (friend && g.score !== null) ? why : '';
  $('result-why').textContent = beneath;
  $('result-why').hidden = !beneath;
  const tile = (n, ringed) => (ringed ? `<b class="ringed">${n}${ring()}</b>` : `<b>${n}</b>`);
  // A friend's score goes between yours and the opponent's: both of you against the same opponent, with the same dice.
  const theirs = friend && g.score !== null ? `<div class="friend"><span>Your friend</span><b>${g.score}</b></div>` : '';
  $('result-scores').classList.toggle('three', !!theirs);
  $('result-scores').innerHTML = `<div><span>You</span>${tile(you, you >= them)}</div>${theirs}<div class="them"><span>${escape(name)}</span>${tile(them, them >= you)}</div>`;
  // What the opponent makes of it, in their red pencil under the scores (js/tour.js), named for a screen reader.
  const says = TABLES[g.opp].who.says;
  $('result-says').innerHTML = `<span class="vh">${escape(name)}: </span>${escape(won ? says.loses : tie ? says.ties : says.wins)}`;
  $('result-says').hidden = false;
  // In the back room: a new best run, or the run a loss has ended.
  if (run) best = won ? (run.best && run.now > run.best ? `Your best run: ${run.now} (was ${run.best}).` : '') : !tie && run.was ? `That ends a run of ${run.was}.` : '';
  $('result-best').textContent = best;
  $('result-best').hidden = !best;
  const next = $('b-next');
  // The back room's Play again opens the card for the next sitting, with the two twists it draws, as On to table 3 does.
  if (run) { next.textContent = 'Play again'; next.onclick = () => { backCard(); under = 'sheet-result'; }; }
  else if (onward) { next.textContent = `On to table ${g.table + 2}`; next.onclick = () => { intro(g.table + 1); under = 'sheet-result'; }; }
  else { next.textContent = g.kind ? 'Play the same dice again' : 'Play again'; next.onclick = () => again(g); }
  $('b-again').hidden = !onward;
  $('b-share').hidden = false;
  shareSaid('Share');
  const t = token;
  setTimeout(() => { if (t === token && game === g && !resultSeen) showResult(); }, 900); // unless a new game has started, or it's been opened already
}

// The end of a game at Two players: who won, by the pad, with nothing to count anywhere.
function finishTwo(g, lead, a, r) {
  const [black, red] = g.names, tie = a === r, winner = a > r ? black : red;
  save();
  render();
  showDice();
  if (document.body.dataset.screen === 'home') renderHome();
  status(tie ? 'A tie.' : `${winner} wins.`);
  say(`${lead ? `${lead} ` : ''}${tie ? `A tie, ${a} all.` : `${winner} wins, ${Math.max(a, r)} to ${Math.min(a, r)}.`}`);
  $('result-n').textContent = ''; // emptied as well: aria-labelledby reads it out even while it's hidden
  $('result-n').hidden = true;
  $('result-title').textContent = tie ? 'A tie' : `${winner} wins`;
  // What decided it, unless it was close (see js/why.js).
  const why = whyLine(g.board, g.you, g.them, red, black);
  $('result-line').textContent = tie ? 'Play it again to settle it.' : why || `${Math.max(a, r)} to ${Math.min(a, r)}: a close one.`;
  $('result-why').hidden = true;
  const tile = (n, ringed) => (ringed ? `<b class="ringed">${n}${ring()}</b>` : `<b>${n}</b>`);
  $('result-scores').classList.remove('three');
  $('result-scores').innerHTML = `<div><span>${escape(black)}</span>${tile(a, a >= r)}</div><div class="them"><span>${escape(red)}</span>${tile(r, r >= a)}</div>`;
  $('result-says').hidden = true; // nobody at the table but the two of you
  $('result-best').hidden = true;
  $('b-next').textContent = 'Play again';
  $('b-next').onclick = () => again(g);
  $('b-again').hidden = true;
  $('b-share').hidden = true;
  const t = token;
  setTimeout(() => { if (t === token && game === g && !resultSeen) showResult(); }, 900);
}

// The first game finished, or given up, at a day's table counts for that day (and a game from a day before today's, once
// today's has counted, for none). Whether this one did.
function countDay(g, you, them) {
  if (progress.today && progress.today.day >= g.day) return false;
  progress.today = { day: g.day, you, them };
  progress.days.played++;
  if (you !== null && you > them) progress.days.won++;
  return true;
}

// A game in the back room, won, lost or tied: a win adds to the run of wins, a loss ends it, and a tie leaves it as it was.
// The run before it and after it, and the best run before it.
function countBack(won, tie) {
  const b = progress.back, was = b.run, best = b.best;
  b.played++;
  if (won) { b.won++; b.run++; b.best = Math.max(b.best, b.run); } else if (!tie) b.run = 0;
  return { was, now: b.run, best };
}

// What a friend's table says on the result: how you did against the score they had with the same dice. A link without a
// score says what any game says.
function friendLine(you, score, won, why) {
  if (score === null) return won ? 'A good game.' : why || 'The dice owe you one.';
  const had = `Your friend had ${score} with the same dice`;
  return you > score ? `${had}: you beat them by ${you - score}.` : you < score ? `${had}, ${score - you} more than you.` : `${had}, the same as you.`;
}

// What Share sends: where, who won and by what, and a link that opens the same table with the same dice, against the score
// you had with them. "Full House, table 6: Hot Boxes. I beat Otto, 288 to 251. https://..."
function shareText(g) {
  const b = g.board, you = totals(b, g.you).total, them = totals(b, g.them).total, name = who(g).name;
  const at = g.kind === 'friend' ? `${b.name}, with the same dice as a friend` : g.kind === 'day' ? `today’s table (${dayName(g.day)}): ${b.name}`
    : g.kind === 'back' ? `the back room: ${b.name}` : g.table !== null ? `table ${g.table + 1}: ${b.name}` : `quick game: ${b.name}`;
  const result = you > them ? `I beat ${mid(name)}, ${you} to ${them}.` : them > you ? `${name} beat me, ${them} to ${you}.` : `${name} and I tied, ${you} all.`;
  const whole = you > them && g.table === TABLES.length - 1 ? ' That’s the whole tour.' : '';
  return `Full House, ${at}. ${result}${whole} ${linkFor({ table: rulesOf(g), opp: g.opp, seed: g.seed, score: you }, TABLES.length)}`;
}
// The phone's share sheet where there is one, and otherwise a copy to paste, which the button says it's made.
async function share() {
  const g = game;
  if (!g?.over) return;
  const text = shareText(g);
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (e) { if (e?.name === 'AbortError') return; } // closed without sending
  }
  const copied = await copy(text);
  if (game !== g) return;
  shareSaid(copied ? 'Copied.' : 'Couldn’t copy it.');
  say($('b-share').textContent);
  shareTimer = setTimeout(() => shareSaid('Share'), 2500);
}
let shareTimer = 0;
function shareSaid(text) { clearTimeout(shareTimer); $('b-share').textContent = text; }
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* not allowed here: the old way */ }
  const back = document.activeElement, box = document.createElement('textarea');
  try {
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.append(box);
    box.select();
    return document.execCommand('copy');
  } catch { return false; } finally { box.remove(); back?.focus?.({ preventScroll: true }); }
}

// The same again: another game at a table of the tour or a quick game, or the same dice again at a friend's table.
// At Two players, another game between the same two, with new dice.
// At Two players the other player starts it: Red after a game Black started, Black after one Red did.
const again = g => start(g.table, g.opp, rulesOf(g), two(g) ? { kind: 'two', names: g.names, first: starter(g) === 'you' ? 'them' : 'you' } : g.kind ? { kind: g.kind, seed: g.seed, score: g.score, day: g.day } : {});

// The result of the game that's just finished, as finish() wrote it. It can be closed, to look over the pad, and opened again.
function showResult() {
  if (!game?.over || !$('sheet-result').hidden) return;
  resultSeen = true;
  hideToast();
  openSheet('sheet-result', $('b-roll')); // closed, it can be opened again from there
}

// Leaving a game part way counts as a loss at that table. Leaving one that's over just goes back to the tour.
function concede(quietly) {
  const g = game;
  if (!g) return;
  if (!g.over) {
    token++;
    if (g.kind === 'day') countDay(g, null, null); // at Two players, or a friend's table: nowhere
    else if (g.kind === 'back') countBack(false, false);
    else if (g.kind) { /* counts nowhere */ } else if (g.table !== null) progress.played[g.table] = (progress.played[g.table] || 0) + 1;
    else progress.quick.played++;
    g.over = true;
  }
  game = null;
  busy = false;
  theirPick = null;
  save();
  if (!quietly) { closeSheets(); open('home'); }
}

// ---- drawing ----

// With Sound on, a game you're looking at is heard: not one whose opponent plays on behind the tour, or in a tab out of sight.
const heard = () => settings.sound && document.body.dataset.screen === 'game' && document.visibilityState === 'visible';
// A short buzz as a die is held or let go, on a phone that can (not an iPhone, whose browsers have no way to).
function buzz() {
  try { navigator.vibrate?.(12); } catch { /* not allowed here */ }
}

function showDice(rolled = []) {
  const g = game;
  if (!g) return;
  const mine = hands(g);
  // Your holds show only while there's a roll left for them to stay out of. The opponent's show to the end of their turn.
  const held = !mine || g.rolls < g.board.rolls ? g.held : [false, false, false, false, false];
  // As long as the dice take to land (--tumble), or, where motion is cut down and they land at once, a quick clatter.
  if (rolled.length && heard()) sound.rattle(rolled.length, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.15 : quick() ? 0.38 : 0.7);
  tray.show(g.dice, held, {
    rolled,
    theirs: two(g) ? g.turn === 'them' : !mine && theirDice, // at Two players, Red's dice are red from the start of their turn
    idle: mine && g.rolls === 0,
    canHold: mine && !busy && g.rolls > 0 && g.rolls < g.board.rolls,
    quick: quick(), // the dice land before roll() and PACE move on
    name: who(g).name,
    wild: !!g.board.wild,
  });
}

function render() {
  const g = game;
  if (!g) return;
  const b = g.board, opp = who(g), mine = hands(g) && !g.over, side = g.turn, card = g[side];
  const turns = b.boxes.length;
  $('g-table').textContent = where(g);
  if (document.body.dataset.screen === 'game') document.title = `${where(g)} · Full House`;
  // On two lines, the break comes after the dot, and "(2 left)" keeps together.
  $('g-twist').textContent = `${two(g) ? `${me(g)} against ${opp.name}` : `against ${mid(opp.name)}`}\u00a0· turn ${Math.min(g.number, turns)} of ${turns}`;
  document.documentElement.style.setProperty('--them-colour', opp.colour);

  const opts = mine && g.rolls > 0 && !busy ? options(b, card, g.dice) : null;
  const offers = opts && Object.fromEntries(opts.map(o => [o.box.id, o.score]));
  const you = totals(b, g.you).total, them = totals(b, g.them).total;
  const winner = g.over ? (you > them ? 'you' : them > you ? 'them' : 'both') : null;
  oppCard(g);
  pad.render({ board: b, you: g.you, them: g.them, name: opp.name, me: me(g), side, offers, picked, fresh, hints: settings.hints, theirPick, winner });
  if ((fresh.you || fresh.them) && heard()) sound.scratch(); // as the score is pencilled in
  fresh = {};

  const left = b.rolls - g.rolls;
  // On the opponent's turn the pips are theirs, empty until they roll: the save still holds your rolls till then.
  $('rolls').innerHTML = Array.from({ length: b.rolls }, (_, i) => `<i class="${i < g.rolls && (mine || theirDice) ? 'used' : ''}"></i>`).join('');
  // Not `disabled`, which would throw the keyboard's focus off the button while the dice are in the air: it stays put,
  // reads out whose turn it is, and roll() turns down a press it can't take.
  const button = $('b-roll');
  button.setAttribute('aria-disabled', String(!g.over && (!mine || busy || left <= 0 || allHeld(g))));
  button.textContent = g.over ? 'See the result' : !mine ? `${opp.name}’s turn` : g.rolls === 0 ? 'Roll' : left > 0 && allHeld(g) ? 'All five held' : left > 0 ? `Roll again (${left}\u00a0left)` : 'No rolls left';

  if (mine && !busy) {
    const joker = g.rolls > 0 && jokerState(b, card, g.dice), five = offers && b.boxes.find(x => x.kind === 'five');
    if (picked) {
      const o = opts?.find(x => x.box.id === picked), made = o && makesBonus(b, card, o);
      status(`Tap ${boxLabel(b.boxes.find(x => x.id === picked))} again to ${!o?.score ? 'write in a 0' : `score ${o.score}`}${o?.extra ? `, plus ${o.extra} extra${made ? ',' : ''}` : ''}${made ? ' and make the\u00a0bonus' : ''}.`);
    } else if (g.rolls === 0) status(firstLine(g));
    else if (joker) status(jokerLine(b, joker, opts));
    else if (left > 0 && allHeld(g)) status('All five held. Let one go to roll again, or pick a box to score in.');
    else if (five && offers[five.id]) status(`Five of a kind. ${offers[five.id]} in its box, if you want it.`); // a first one: the second has the joker's line
    else if (left > 0) status('Hold dice and roll again, or pick a box to score.');
    else status('Pick a box to score.');
  }
}

// The opponent's card from the table's intro, under Roll where a wide screen has room for it (css/app.css): their disc,
// name and line, and the table's twist in small print, naming the hot boxes at Hot Boxes. Not at Two players, where the
// other side of the pad is a person at the same phone.
function oppCard(g) {
  const card = $('opp-card');
  card.hidden = two(g);
  if (two(g)) return;
  const t = TABLES[g.opp], name = t.who.name, twist = `${g.board.blurb}${hotNames(g.board) ? ` This time it’s ${hotNames(g.board)}.` : ''}`;
  const html = `<i class="dot big" aria-hidden="true" style="--c:${t.who.colour}">${name.replace(/^The /, '')[0]}</i><div><b>${name}</b><span>${lineOf(g.opp)}</span></div>`;
  if ($('opp-who').innerHTML !== html) $('opp-who').innerHTML = html;
  if ($('opp-twist').textContent !== twist) $('opp-twist').textContent = twist;
}

// A second five of a kind lights only the boxes the joker rules allow, so the line says which, and what it earns.
// It keeps to two lines on a small phone, as every status line does, so the dice and the pad don't move.
function jokerLine(b, joker, opts) {
  const again = joker.extra ? `Five of a kind again: ${joker.extra} extra.` : 'Five of a kind again.';
  if (joker.forced) return `${again} It has to go in ${boxLabel(joker.forced)}.`;
  if (joker.topOnly) return `${again} Only top boxes are left${opts.every(o => !o.score) ? ': it scores 0 there' : ''}.`;
  if (joker.lower.length === 1) {
    const [box] = joker.lower, whole = ['full', 'small', 'large', 'pairs'].includes(box.kind);
    return `${again} It has to go in ${boxLabel(box)}${whole ? `, where it counts in full: ${opts[0].score}` : ''}.`;
  }
  const has = kind => joker.lower.some(x => x.kind === kind);
  const whole = [has('full') && 'a full house', (has('small') || has('large')) && 'a straight'].filter(Boolean).join(' or ') || (has('pairs') && 'two pairs');
  return `${again} ${whole ? `Any bottom box: ${whole} counts in full.` : 'It can go in any bottom box.'}`;
}

// Before your first roll: what the opponent just scored, or, as a game starts at Hot Boxes, which boxes are hot.
// Your last box starts with Last turn.
function firstLine(g) {
  // At Two players: whose turn it is, so the phone goes to the right person. "Red’s turn. Roll the dice."
  if (two(g)) return `${turnName(g)}’s ${turnsLeft(g.board, g[g.turn]) === 1 ? 'last turn' : 'turn'}. Roll the dice.`;
  const b = g.board, last = g.number > 1 && g.last && b.boxes.find(x => x.id === g.last.id), final = turnsLeft(b, g.you) === 1;
  const turn = final ? 'Last turn.' : 'Your turn.';
  const extra = g.last?.extra ? `, plus ${g.last.extra} extra${g.last.bonus ? ',' : ''}` : '';
  if (last) return `${turn} ${who(g).name} scored ${g.last.score} in ${boxLabel(last)}${extra}${g.last.bonus ? ' and made the\u00a0bonus' : ''}.`;
  if (final) return 'Last turn. Roll the dice.';
  if (g.number > 1) return 'Your turn.';
  return hotNames(b) ? `Hot this time: ${hotNames(b)}. Roll the dice.` : 'Your turn. Roll the dice.';
}
// The boxes that score three times over at a Hot Boxes table, drawn when you sat down: "Ones and Threes".
const hotNames = board => (board.hot ? board.boxes.filter(x => x.mult > 1).map(boxLabel).join(' and ') : '');

// The line under the dice. Written only when it changes.
function status(text) { if ($('status').textContent !== text) $('status').textContent = text; }

// What a screen reader hears, in a live region of its own (the line on screen isn't one): whole sentences at the moments
// that matter, rather than every line as it goes by. Things said at the same moment go out together, so that one doesn't
// cut the other off, and the same words again are still read out.
let saying = [];
function say(text) {
  if (!saying.length) {
    queueMicrotask(() => {
      const el = $('said'), next = saying.join(' ');
      saying = [];
      el.textContent = el.textContent === next ? `${next}\u00a0` : next;
    });
  }
  saying.push(text);
}

function renderHome() {
  const list = $('tables'), done = finished();
  $('tour-h').textContent = done ? 'The tour · finished' : 'The tour';
  list.innerHTML = TABLES.map((t, i) => {
    const beaten = !!progress.beaten[i], unlocked = i === 0 || !!progress.beaten[i - 1];
    const state = unlocked ? [beaten ? 'Beaten' : 'Next up', record(i), progress.best[i] && `your best ${progress.best[i]}`].filter(Boolean).join(' · ') : 'Locked';
    return `<li class="${beaten ? 'beaten' : unlocked ? 'next' : 'locked'}">
      <button type="button" data-table="${i}">
        <span class="n">${i + 1}${done && beaten ? TICK : ''}</span>
        <span class="txt"><b>${t.board.name}</b><span class="vs"><i class="dot" style="--c:${t.who.colour}"></i>${t.who.name}</span><small>${state}</small></span>
      </button></li>`;
  }).join('');
  // Once the tour is finished, your best at each table added up: a number to beat on a second time round.
  const sum = TABLES.reduce((a, t, i) => a + (progress.best[i] || 0), 0);
  $('tour-sum').innerHTML = done ? `<span>Total<small>your best at each table, added up</small></span><b>${sum}</b>` : '';
  $('tour-sum').hidden = !done;
  // The back room, after the tour once it's finished: the Dealer at two twists at once, with a run of wins in place of Beaten.
  const back = progress.back, d = TABLES[BACK - 1].who;
  const ran = back.played ? [back.run ? `run of ${back.run}` : 'no run going', back.best && `best run ${back.best}`, `won ${back.won} of ${back.played}`].filter(Boolean).join(' · ') : 'Two of the tour’s twists at once, drawn as you sit down';
  $('back-row').hidden = !done;
  $('back-row').innerHTML = done ? `<div class="next"><button type="button" data-back>
      <span class="n">${BACK + 1}</span>
      <span class="txt"><b>The back room</b><span class="vs"><i class="dot" style="--c:${d.colour}"></i>${d.name}</span><small>${ran[0].toUpperCase()}${ran.slice(1)}</small></span>
    </button></div>` : '';
  // Today's table: open to all, whatever's beaten, and unlocking nothing.
  const day = today(new Date(), TABLES.length), sat = TABLES[day.table], dayIn = dayDone(day.day), days = progress.days;
  const said = [dayIn ? `Today: ${dayScore(dayIn, sat.who.name)}` : 'The same dice for everyone today', days.played && `won ${days.won} of ${days.played} day${days.played === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  $('today-row').innerHTML = `<div class="${dayIn ? 'beaten' : 'next'}"><button type="button" data-day="${day.day}">
      <span class="n">${Number(day.day.slice(8))}</span>
      <span class="txt"><b>${sat.board.name}</b><span class="vs"><i class="dot" style="--c:${sat.who.colour}"></i>${sat.who.name}</span><small>${said}</small></span>
    </button></div>`;
  // Quick games open once you've beaten Pip, so the first game you win is always one that counts on the tour.
  $('quick').hidden = !progress.beaten[0];
  const q = progress.quick;
  $('quick-record').textContent = q.played > 0 && q.won <= q.played ? `Won ${q.won} of ${q.played}` : '';
  $('quick-record').hidden = !$('quick-record').textContent;
  // Once two tables are beaten, quick games can be played by the rules of any table you've beaten, Classic to begin with.
  const tables = quickTables(), at = quickAt();
  $('quick-blurb').textContent = tables.length ? 'The rules of any table you’ve beaten, against anyone you’ve met on the tour. They don’t count on the tour.' : 'Classic rules against anyone you’ve met on the tour.';
  $('quick-tables').hidden = !tables.length;
  $('quick-at').innerHTML = tables.map(i => `<label><input type="radio" name="quick-at" value="${i}"${i === at ? ' checked' : ''}><span>${TABLES[i].board.name}</span></label>`).join('');
  const met = TABLES.map((t, i) => ({ t, i })).filter(({ i }) => i === 0 || progress.beaten[i - 1]);
  $('people').innerHTML = met.map(({ t, i }) => `<button type="button" data-quick="${i}"><i class="dot" style="--c:${t.who.colour}"></i>${t.who.name}</button>`).join('');
  // Two players: the names typed last time, or Black and Red.
  const [black, red] = twoNames();
  $('b-two').innerHTML = `<i class="dot" style="--c:var(--ink)"></i>${escape(black)} <span class="and">and</span> <i class="dot" style="--c:${RED}"></i>${escape(red)}`;
  const c = $('b-continue'), going = game && !game.over;
  c.hidden = !going;
  if (going) c.innerHTML = `<b>Carry on</b><span>${two(game) ? `Two players: ${escape(me(game))} against ${escape(who(game).name)}` : `${where(game)}, against ${mid(who(game).name)}`}. Turn ${Math.min(game.number, game.board.boxes.length)} of ${game.board.boxes.length}.</span>`;
}

// The counted game at the table of day `day`, if it's been played: { you, them }, both null if it was given up.
const dayDone = day => (progress.today?.day === day ? progress.today : null);
// "you 288, Otto 251", or "given up".
const dayScore = (done, name) => (done.you === null ? 'given up' : `you ${done.you}, ${mid(name)} ${done.them}`);
// Today's table, as its card opens: by the rules of a table picked by the date, against that table's own opponent.
function dayCard() {
  const d = today(new Date(), TABLES.length);
  intro(null, d.table, { kind: 'day', at: d.table, seed: d.seed, day: d.day });
}

// The back room's card: the two twists the next sitting draws, the same each time it's opened until you sit down there,
// so that walking away from a draw you don't like doesn't change it.
function backCard() {
  const b = progress.back;
  if (b.next === null) { b.next = (Math.random() * 2 ** 31) | 0; save(); }
  intro(null, BACK - 1, { kind: 'back', at: BACK, seed: b.next });
}

// The two names for Two players: as typed (a space or two tidied away), or Black and Red.
const tidy = (typed, plain) => String(typed || '').replace(/\s+/g, ' ').trim().slice(0, 10) || plain;
const twoNames = () => [tidy(settings.names[0], 'Black'), tidy(settings.names[1], 'Red')];
function twoCard() {
  $('two-a').value = settings.names[0] || '';
  $('two-b').value = settings.names[1] || '';
  $('two-warn').textContent = ends();
  $('two-warn').hidden = !ends();
  openSheet('sheet-two');
}
$('b-two').addEventListener('click', twoCard);
$('b-two-sit').addEventListener('click', () => {
  settings.names = [tidy($('two-a').value, ''), tidy($('two-b').value, '')];
  start(null, 0, 0, { kind: 'two', names: twoNames() });
});
// Enter in a name sits you down, as on a form.
for (const id of ['two-a', 'two-b']) $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('b-two-sit').click(); } });

// The tour is finished once the Dealer, at the last table, is beaten.
const finished = () => !!progress.beaten[TABLES.length - 1];
// A tick pencilled on a beaten table's number, a little out of true, once the tour is finished.
const TICK = '<svg class="tick" viewBox="0 0 30 26" aria-hidden="true" focusable="false"><path class="halo" d="M4 14.5C6.5 16 8.5 18.5 10.5 22C14 13.5 19.5 7 27 2.5"/><path d="M4 14.5C6.5 16 8.5 18.5 10.5 22C14 13.5 19.5 7 27 2.5"/></svg>';

// The games played at a table, on its line on the tour: "won 2 of 5" once it's beaten, "lost 2" until then. A game
// given up, or tied, is one played and not won. Nothing before the first game, nor for a count that doesn't add up.
function record(i) {
  const played = progress.played[i] || 0, won = progress.won[i] || 0;
  if (!played || won > played) return '';
  return progress.beaten[i] ? `won ${won} of ${played}` : `lost ${played - won}`;
}

// The focus goes to the thing to do next there (Roll; on the tour, Carry on or the table that's next), unless the page is
// just opening, when a screen reader starts from the top.
function open(screen, { focus = true } = {}) {
  document.body.dataset.screen = screen;
  document.title = screen === 'game' && game ? `${where(game)} · Full House` : 'Full House';
  if (screen === 'home') { renderHome(); hideToast(); } // a message about the game stays with it (giving up raises its own after)
  window.scrollTo(0, 0);
  // Near the end of the tour the table you're on is below the fold: bring it into view, unless Carry on is the thing to tap.
  const at = screen === 'home' && $('b-continue').hidden && document.querySelector('#tables li.next');
  if (at) {
    const r = at.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight) at.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
  if (focus) {
    const to = screen === 'game' ? $('b-roll') : !$('b-continue').hidden ? $('b-continue') : document.querySelector('#tables li.next button, #tables li:last-child button');
    to?.focus({ preventScroll: true });
  }
  keepHistory();
}

// ---- sheets and messages ----

// A table on the tour, or a quick game (table null) against the opponent from table `opp`, by the rules chosen for it.
// A table not yet open shows its card too, its twist and its opponent, with what it takes to sit there in place of Sit down.
// With `spec` (see start()), a friend's table, by the rules of table `spec.at`: open to all, whatever's beaten, and with its
// dice settled by the link, a Hot Boxes table says which boxes are hot.
function intro(table, opp = table, spec = {}) {
  const at = spec.at ?? table ?? quickAt(), t = TABLES[opp], board = spec.kind ? boardFor(at, spec.seed) : TABLES[at].board;
  const locked = table !== null && table > 0 && !progress.beaten[table - 1];
  $('intro-n').textContent = spec.kind === 'friend' ? 'The same dice your friend had' : spec.kind === 'day' ? `Today’s table · ${dayName(spec.day)}`
    : spec.kind === 'back' ? 'The back room · after the tour' : table === null ? 'Quick game' : `Table ${table + 1} of ${TABLES.length}`;
  $('intro-title').textContent = board.name;
  $('intro-blurb').textContent = `${board.blurb}${spec.kind && hotNames(board) ? ` This time it’s ${hotNames(board)}.` : ''}`;
  const note = spec.kind === 'friend' ? `${spec.score !== null ? `Score to beat: ${spec.score}. ` : ''}It doesn’t count on the tour.`
    : spec.kind === 'day' ? (dayDone(spec.day) ? `Today’s game is in: ${dayScore(dayDone(spec.day), t.who.name)}. Another go is just practice.` : 'Everyone has the same dice today. Your first game is the one that counts, here and not on the tour.')
    : spec.kind === 'back' ? (progress.back.run ? `You’re on a run of ${progress.back.run}. Win to add to it; a loss, or giving up, ends\u00a0it.` : 'Two of the tour’s twists at once, new each time you sit down. Win to start a run.')
    : '';
  $('intro-note').textContent = note;
  $('intro-note').hidden = !note;
  $('intro-who').innerHTML = `<i class="dot big" aria-hidden="true" style="--c:${t.who.colour}">${t.who.name.replace(/^The /, '')[0]}</i><div><b>${t.who.name}</b><span>${lineOf(opp)}</span>${ends() && !locked ? `<em>${ends()}</em>` : ''}</div>`;
  $('intro-locked').textContent = locked ? `Beat ${mid(TABLES[table - 1].who.name)} to sit here` : '';
  $('intro-locked').hidden = !locked;
  $('b-sit').hidden = locked;
  $('b-sit').onclick = locked ? null : () => start(table, opp, at, spec);
  openSheet('sheet-intro');
}

// How to play, as a table plays it. Opened from a game: the table's own twist first, and its numbers throughout (the
// bonus, the rolls, what each box pays). Opened from the tour: the game as it comes in the box, and a word that some
// tables change it.
function showRules(board, here) {
  const COUNT = ['', 'one', 'two', 'three', 'four', 'five'], OVER = { 2: ', doubled', 3: ', three times over' };
  const lower = board.boxes.filter(b => !isUpper(b)), top = board.boxes.filter(b => b.kind === 'face');
  const of = kind => lower.find(b => b.kind === kind);
  const pays = (n, b) => n * (b.mult || 1), over = b => OVER[b.mult] || '';
  const total = b => `the total of all five dice${board.wild ? ', 1s wild' : ''}${over(b)}`;
  const box = {
    three: b => (of('four')?.mult === b.mult ? `<b>Three or four of a kind:</b> ${total(b)}.` : `<b>Three of a kind:</b> ${total(b)}.`),
    four: b => (of('three')?.mult === b.mult ? '' : `<b>Four of a kind:</b> ${total(b)}.`),
    pairs: b => `<b>Two pairs:</b> the four paired dice added up${board.wild ? ', 1s wild' : ''}${over(b)}.`,
    full: b => `<b>Full house</b>, three of one number and two of another: ${pays(25, b)}.`,
    small: b => `<b>Small straight</b>, four in a row: ${pays(30, b)}.`,
    large: b => `<b>Large straight</b>, five in a row: ${pays(40, b)}.`,
    five: b => `<b>Five of a kind:</b> ${pays(50, b)}.`,
    chance: b => `<b>Chance:</b> ${total(b).replace('the total of all five dice', 'the total, whatever the dice')}.`,
    low: b => `<b>Low road:</b> ${pays(30, b)} if the dice total 12 or less.`,
  };
  // Three of each number earns the bonus on a board where it adds up to the target exactly: not at Evens.
  const threeEach = top.length === 6 && 3 * top.reduce((a, b) => a + b.face * (b.mult || 1), 0) === board.bonus.at;
  const adders = board.boxes.filter(b => b.kind === 'evens' || b.kind === 'odds'); // Evens, and in the back room Odds
  const added = adders.length ? ` (or what the ${adders.map(b => (b.kind === 'evens' ? 'even' : 'odd')).join(' or ')} dice add up to, in ${adders.map(boxLabel).join(' or ')})` : '';
  const items = [
    here && `<b>At this table:</b> ${escape(board.blurb)}${hotNames(board) ? ` This time it’s ${hotNames(board)}.` : ''}`,
    `On your turn, roll all five dice. Tap any dice you want to hold, then roll the rest. You get ${COUNT[board.rolls]} rolls.`,
    'After any roll you can stop and score: tap a box on the pad, then tap it again to write the score in. Every turn fills one box, even if it scores nothing.',
    `<b>Top section:</b> add up the dice showing that number. Reach ${board.bonus.at} across the six boxes for a ${board.bonus.worth}-point bonus${threeEach ? ' (three of each number gets you there)' : ''}.`,
    lower.map(b => box[b.kind](b)).filter(Boolean).join(' '),
    `Once the Five of a kind box is filled, another five of a kind has to go in its own number’s box if that’s open. If not, it goes in any open box in the bottom section, where ${of('pairs') ? 'a full house, a straight or two pairs' : 'a full house or a straight'} counts in full. If the bottom is full too, it scores 0 in a top box${added}. It also earns ${board.extra} extra, unless the Five of a kind box holds a 0.`,
    'You and your opponent take turns until every box is filled. The higher total wins.',
    KEYS,
    !here && 'Some tables change these; each says how when you sit down.',
  ];
  $('rules-list').innerHTML = items.filter(Boolean).map(t => (t === KEYS ? `<li class="keys">${settings.keys ? KEYS : NO_KEYS}</li>` : `<li>${t}</li>`)).join('');
}

// Shown where there's a mouse, and so most likely a keyboard: see css/app.css. With the shortcuts off in the menu, the second.
const KEYS = 'On a keyboard: Space or R rolls and 1 to 5 hold the dice. Tab to a box and press Enter to pick it, then Enter again to score it. Space or Enter hurries the opponent along.';
const NO_KEYS = 'On a keyboard: Tab to Roll or a die and press Space or Enter. Tab to a box and press Enter to pick it, then Enter again to score it. Enter on Roll hurries the opponent along. The single-key shortcuts are off in the game’s menu.';

let opener = null;
let under = null; // the sheet this one was opened from, to go back to if it's turned down
const behind = () => [$('home'), $('game')]; // the screens under a sheet, out of reach while it's open
// `back` is where the focus goes when the sheet closes, if not to whatever had it before.
function openSheet(id, back) {
  closeSheets();
  opener = back || document.activeElement;
  behind().forEach(el => { el.inert = true; });
  $(id).hidden = false;
  $(id).querySelector('.primary:not([hidden]), .close, button:not([hidden])')?.focus({ preventScroll: true });
  keepHistory();
}
function closeSheets() {
  askGiveUp(false);
  const shown = document.querySelectorAll('.sheet:not([hidden])');
  shown.forEach(s => { s.hidden = true; });
  behind().forEach(el => { el.inert = false; }); // before the focus goes back, which it can't to something inert
  if (shown.length && opener?.focus && document.contains(opener)) opener.focus({ preventScroll: true });
  opener = null;
  under = null;
  keepHistory();
}
// Close a sheet by its own Not yet or ×, a tap beside it, or Escape. The next table's card, opened from a result, goes back to the result.
function dismiss() {
  const back = under;
  closeSheets();
  if (back && game?.over) openSheet(back);
}

let toastTimer = 0;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  say(text);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}
// A message is about the game it came up in: it goes when that game's result shows, or another game starts.
function hideToast() {
  clearTimeout(toastTimer);
  $('toast').hidden = true;
}

const escape = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---- saving ----

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
// Settings and progress from a save, with anything missing filled in. The game only ever saves these whole,
// but a save damaged some other way shouldn't stop it from starting.
// A save from before the three paces has a Quick opponents switch (fast) in place of the pace: on is Quick.
function settingsFrom(s) {
  const { fast, ...rest } = s && typeof s === 'object' ? s : {};
  const names = Array.isArray(rest.names) && rest.names.length === 2 ? rest.names.map(n => (typeof n === 'string' ? n.slice(0, 10) : '')) : ['', ''];
  return { hints: true, keys: true, sound: false, quickAt: 0, ...rest, names, pace: ['normal', 'quick', 'score'].includes(rest.pace) ? rest.pace : fast ? 'quick' : 'normal' };
}
function progressFrom(p) {
  const out = { beaten: [], best: [], played: [], won: [], quick: { played: 0, won: 0 }, today: null, days: { played: 0, won: 0 }, back: {}, ...p };
  for (const k of ['beaten', 'best', 'played', 'won']) if (!Array.isArray(out[k])) out[k] = [];
  out.quick = { played: 0, won: 0, ...(out.quick && typeof out.quick === 'object' ? out.quick : {}) };
  out.days = { played: 0, won: 0, ...(out.days && typeof out.days === 'object' ? out.days : {}) };
  // The back room: the run of wins going and the best run, the games won and played, and the seed of the next sitting's
  // draw once its card has been opened, so opening it again shows the same two twists (null until then).
  const back = out.back && typeof out.back === 'object' ? out.back : {};
  out.back = { run: 0, best: 0, played: 0, won: 0, ...back, next: Number.isInteger(back.next) ? back.next : null };
  if (!(out.today && typeof out.today === 'object' && typeof out.today.day === 'string')) out.today = null;
  return out;
}
// A saved game still being played, with every part the page reads there to pick it up again.
function whole(g) {
  try {
    const five = a => Array.isArray(a) && a.length === 5, b = g.board;
    return !g.over && (g.turn === 'you' || g.turn === 'them') && Number.isInteger(g.number) && Number.isInteger(g.rolls)
      && Number.isInteger(g.opp) && !!TABLES[g.opp] && (g.table === null || (Number.isInteger(g.table) && !!TABLES[g.table]))
      && five(g.dice) && g.dice.every(d => Number.isInteger(d) && d >= 1 && d <= 6) && five(g.held)
      && b.rolls > 0 && b.bonus.at > 0 && b.boxes.length > 0 && b.boxes.every(x => boxLabel(x) && x.id in g.you && x.id in g.them)
      && (g.kind !== 'two' || (Array.isArray(g.names) && g.names.length === 2 && g.names.every(n => typeof n === 'string' && n)
        && [undefined, 'you', 'them'].includes(g.first)));
  } catch { return false; } // a part missing altogether
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ settings, progress, game: game && !game.over ? game : null })); } catch { /* storage full or blocked */ }
}

// ---- buttons ----

$('b-roll').addEventListener('click', () => (game?.over ? showResult() : roll()));
$('b-home').addEventListener('click', () => open('home'));
function carryOn() {
  open('game');
  showDice();
  render();
  if (game?.turn === 'them' && !busy && !two(game)) theirTurn();
}
$('b-continue').addEventListener('click', carryOn);
$('today-row').addEventListener('click', e => { if (e.target.closest('[data-day]')) dayCard(); });
$('back-row').addEventListener('click', e => { if (e.target.closest('[data-back]')) backCard(); });
$('tables').addEventListener('click', e => { const b = e.target.closest('[data-table]'); if (b) intro(+b.dataset.table); });
// A quick game starts straight away, unless it would end the game you're in: then it asks first, as a table on the tour does.
$('people').addEventListener('click', e => {
  const b = e.target.closest('[data-quick]');
  if (!b) return;
  if (game && !game.over) intro(null, +b.dataset.quick);
  else start(null, +b.dataset.quick, quickAt());
});
$('quick-at').addEventListener('change', e => { settings.quickAt = +e.target.value; save(); });
$('b-tour').addEventListener('click', () => { closeSheets(); game = null; save(); open('home'); });
$('b-again').addEventListener('click', () => start(game.table, game.opp, rulesOf(game)));
// The result put aside, to look over the finished pad under it: See the result, where the focus goes back to, opens it again.
$('b-look').addEventListener('click', closeSheets);
$('b-share').addEventListener('click', share);
$('b-rules').addEventListener('click', () => { showRules(CLASSIC, false); openSheet('sheet-rules'); });
// From the menu, which closes as How to play opens: afterwards the focus goes back to the menu button.
$('b-menu-rules').addEventListener('click', () => { showRules(game?.board || CLASSIC, !!game); openSheet('sheet-rules', $('b-menu')); });
const showMenu = () => {
  if (!game) return;
  $('menu-title').textContent = where(game);
  $('menu-twist').textContent = two(game) ? `${game.board.blurb} ${me(game)} against ${who(game).name}, passing the phone between you. Nothing counts on the tour.`
    : `${game.board.blurb}${hotNames(game.board) ? ` This time it’s ${hotNames(game.board)}.` : ''} Against ${mid(who(game).name)}. ${lineOf(game.opp)}`;
  openSheet('sheet-menu');
};
// Giving up takes two taps, as scoring a box does: the first asks, and closing the menu takes the question back.
function askGiveUp(on) {
  givingUp = on;
  // At Two players nobody loses by it: the game just ends.
  $('b-concede').textContent = game?.over ? 'Back to the tour' : two(game) ? (on ? 'Tap again to end it.' : 'End this game') : on ? `Tap again to give up.${costs(game, ' ')}` : 'Give up this game';
  $('b-concede').classList.toggle('asked', on);
}
function giveUp() {
  const g = game;
  if (!g) return;
  if (g.over) { concede(false); return; } // nothing to lose
  if (!givingUp) { askGiveUp(true); return; }
  concede(false);
  if (!two(g)) toast(`You gave up${g.kind === 'back' ? ' in the back room' : g.table === null ? '' : ` at table ${g.table + 1}`}. ${who(g).name} takes that one.`);
}
$('b-menu').addEventListener('click', showMenu);
$('b-where').addEventListener('click', showMenu);
$('b-concede').addEventListener('click', giveUp);
document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', dismiss));
const TOGGLES = [['hints', 'o-hints'], ['sound', 'o-sound'], ['keys', 'o-keys']];
for (const [k, id] of TOGGLES) {
  $(id).checked = settings[k];
  $(id).addEventListener('change', e => { settings[k] = e.target.checked; save(); showDice(); render(); });
}
// Switched on, it makes its pencil scratch, so you know it works and how loud it is.
$('o-sound').addEventListener('change', e => { if (e.target.checked) sound.scratch(); });
const paces = [...document.querySelectorAll('input[name="pace"]')];
const showPace = () => paces.forEach(r => { r.checked = r.value === settings.pace; });
showPace();
for (const r of paces) r.addEventListener('change', () => { if (r.checked) { settings.pace = r.value; save(); showDice(); render(); } });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { dismiss(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return; // the browser's shortcuts, like Ctrl+R to reload
  if (document.body.dataset.screen !== 'game' || document.querySelector('.sheet:not([hidden])')) return;
  // On the opponent's turn, Space or Enter hurries them along, as a tap on the dice does: from Roll, where a score leaves
  // the focus, or from nowhere. Kept from Roll itself, so a Space let go as your turn comes doesn't roll for you.
  // With the shortcuts off (in the menu), only from Roll: Space presses only what has the focus, and R and 1 to 5 do nothing.
  const from = e.target.id === 'b-roll' || (settings.keys && e.target === document.body);
  if ((e.key === ' ' || e.key === 'Enter') && game?.turn === 'them' && busy && from) {
    e.preventDefault();
    hurry = true;
    return;
  }
  if (!settings.keys) return;
  // R rolls wherever the focus is; Space only when nothing has it, since Space presses the button in focus. Once the
  // game is over, they open its result, as the button does.
  if (e.key.toLowerCase() === 'r' || (e.key === ' ' && e.target === document.body)) { e.preventDefault(); if (game?.over) showResult(); else roll(); }
  if (/^[1-5]$/.test(e.key)) toggle(+e.key - 1);
});

// ---- open in two places ----

// The game can be open twice at once: in two tabs, or in a tab and the installed app. When the other copy saves, this
// one takes its settings and progress, so as not to save over them later, and its game as well, unless you're part
// way through a turn here that the other copy hasn't got past. Then this copy keeps its game, and whichever saves last wins.
addEventListener('storage', e => {
  if (e.key !== KEY || !e.newValue) return;
  let next;
  try { next = JSON.parse(e.newValue); } catch { return; }
  if (!next || typeof next !== 'object') return;
  if (next.settings && typeof next.settings === 'object') Object.assign(settings, settingsFrom(next.settings));
  if (next.progress && typeof next.progress === 'object') Object.assign(progress, progressFrom(next.progress));
  for (const [k, id] of TOGGLES) $(id).checked = settings[k];
  showPace();
  showDice();
  const theirs = whole(next.game) ? next.game : null, ours = game && !game.over ? game : null;
  if (JSON.stringify(theirs) !== JSON.stringify(ours) && !keepOurs(ours, theirs)) adopt(theirs);
  if (document.body.dataset.screen === 'home') renderHome(); else render();
});

// How far into a game a save is: the turn, then the rolls used, with the opponent's go after all of yours.
// (At Two players, the second player's rolls count after those of whoever started.)
const reached = g => g.number * 10 + (two(g) ? (g.turn === starter(g) ? 0 : 5) + g.rolls : g.turn === 'them' ? 9 : g.rolls);
// Part way through your turn here, with the other copy behind it in the same game, or on another game, or none.
function keepOurs(ours, theirs) {
  if (!ours || !hands(ours) || ours.rolls === 0) return false;
  if (!theirs || theirs.seed !== ours.seed) return true;
  return reached(theirs) < reached(ours) || (reached(theirs) === reached(ours) && theirs.dice.join() !== ours.dice.join());
}

// Take up the other copy's game, or its having none. The new token calls off whatever this copy still had to do for
// the old one (the opponent's next move, a result about to show), and a sheet about the old game closes.
function adopt(g) {
  token++;
  game = g;
  busy = hurry = false;
  picked = theirPick = null;
  theirDice = false;
  playing = -1;
  fresh = {};
  if ($('sheet-rules').hidden) closeSheets();
  if (document.body.dataset.screen !== 'game') return;
  if (!g) { closeSheets(); open('home'); return; }
  showDice();
  // As after a reload: the opponent's turn plays out here as well, the same way, since it comes from the game's seed.
  if (g.turn === 'them' && !two(g)) { busy = true; status(`${who(g).name}’s turn.`); setTimeout(theirTurn, 500); }
}

// ---- the back button ----

// The phone's back button (or the browser's) closes an open sheet, or goes from a game to the tour, where the game waits
// under Carry on, as after the arrow at the top. From the tour it leaves, as it always has. For that, the history has an
// entry of ours for the game and one for an open sheet, on top of the tour's own, each holding how many of ours there are
// up to it. They go on as the game and the sheets open, and come off as they close.
const depth = state => (Number.isInteger(state?.fullHouse) ? state.fullHouse : 0);
const sheetOpen = () => !!document.querySelector('.sheet:not([hidden])');
const onScreen = () => (document.body.dataset.screen === 'game' ? 1 : 0) + (sheetOpen() ? 1 : 0);
let steppingBack = 0; // steps back of ours that haven't landed yet
let matching = false;
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; // back on the tour, it starts at the top, as it always has

// Once whatever is opening and closing things has finished, so that one sheet closing as the next one opens moves nothing.
function keepHistory() {
  if (matching) return;
  matching = true;
  queueMicrotask(() => { matching = false; matchHistory(); });
}
function matchHistory() {
  if (steppingBack) return; // this runs again when they land
  try {
    const want = onScreen();
    for (let n = depth(history.state); n < want; n++) history.pushState({ fullHouse: n + 1 }, '');
    const extra = depth(history.state) - want;
    if (extra > 0) { history.go(-extra); steppingBack++; }
  } catch { /* where there's no history to keep (in a sandboxed frame, say), it plays the same, only without Back */ }
}
addEventListener('popstate', e => {
  if (steppingBack) { steppingBack--; keepHistory(); return; }
  const at = depth(e.state);
  // Back: close the sheet, then leave the game for the tour, until the screen is no deeper than the history.
  if (at < onScreen() && sheetOpen()) closeSheets();
  if (at < onScreen() && document.body.dataset.screen === 'game') open('home');
  // Forward again, from the tour onto the game's entry: carry on with the game, if it's still going.
  if (at > onScreen() && !sheetOpen() && document.body.dataset.screen === 'home' && game && !game.over) carryOn();
  keepHistory(); // and anything forward that can't be shown again is stepped back off
});

// ---- offline ----

if ('serviceWorker' in navigator && !('single' in document.documentElement.dataset) && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---- starting up ----

// A friend's link (see js/links.js) opens their table's card on the tour, with the game you're in, if any, under Carry on.
// The link comes off the address once read, so a reload doesn't open it again.
function takeLink() {
  if (!location.hash) return null;
  const link = readLink(location.hash, TABLES.length);
  try { history.replaceState(history.state, '', location.pathname + location.search); } catch { /* it stays: harmless */ }
  return link;
}
const friendCard = link => intro(null, link.opp, { kind: 'friend', at: link.table, seed: link.seed, score: link.score });
// One opened in a tab the game is in already only changes what's after the #.
addEventListener('hashchange', () => {
  const link = takeLink();
  if (!link) return;
  closeSheets();
  open('home', { focus: false });
  friendCard(link);
});

const link = takeLink();
open('home', { focus: false });
if (link) friendCard(link);
else if (game) {
  // A game in progress comes back where you left it. An opponent's turn that was cut short starts over, the same turn.
  open('game', { focus: false });
  showDice();
  render();
  if (game.turn === 'them' && !two(game)) { busy = true; status(`${who(game).name}’s turn.`); setTimeout(theirTurn, 500); }
}

// For the tests and the screenshot tool.
window.fullHouse = {
  get game() { return game; },
  get busy() { return busy; },
  get hurry() { return hurry; },
  progress,
  settings,
  start,
  set(g) { token++; game = g; busy = false; picked = null; theirPick = null; theirDice = false; open('game', { focus: false }); showDice(); render(); if (g.turn === 'them' && !two(g)) theirTurn(); }, // as a saved game comes back
};
