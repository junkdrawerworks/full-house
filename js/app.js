// Full House: the tour, a game in progress, and the opponent's turns played out on the table.

import { blankCard, options, jokerState, mark, totals, filled, boxLabel, isUpper } from './rules.js';
import { TABLES, boardFor, CLASSIC } from './tour.js';
import { Opponent } from './ai.js';
import { Tray } from './dice.js';
import { Pad } from './pad.js';
import { mulberry32 } from './rng.js';

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
const who = g => TABLES[g.opp].who;
const where = g => (g.table === null ? 'Quick game' : `Table ${g.table + 1}: ${g.board.name}`); // "Table 3: Triple Sixes"
// A name inside a sentence: "against the Dealer". At the start of one, and on the pad and the tour, it keeps its capital.
const mid = name => name.replace(/^The /, 'the ');
const die = () => 1 + Math.floor(Math.random() * 6);

// ---- your turn ----

const allHeld = g => g.rolls > 0 && g.held.every(Boolean); // nothing left to roll

function roll() {
  const g = game;
  if (!g || g.over || busy || g.turn !== 'you' || g.rolls >= g.board.rolls || allHeld(g)) return;
  picked = null;
  const rolled = [];
  g.dice = g.dice.map((d, i) => (g.held[i] && g.rolls > 0 ? d : (rolled.push(i), die())));
  if (g.rolls === 0) g.held = [false, false, false, false, false];
  g.rolls++;
  busy = true;
  showDice(rolled);
  render();
  save();
  setTimeout(() => {
    busy = false;
    showDice();
    render();
    if (game !== g) return;
    const left = g.board.rolls - g.rolls;
    say(`You rolled ${g.dice.join(', ')}. ${left ? `${left} roll${left === 1 ? '' : 's'} left.` : 'No rolls left.'}${jokerState(g.board, g.you, g.dice) ? ` ${$('status').textContent}` : ''}`);
  }, settings.fast ? 450 : 750);
}

function toggle(i) {
  const g = game;
  if (!g || busy || g.turn !== 'you' || g.rolls === 0 || g.rolls >= g.board.rolls) return;
  g.held[i] = !g.held[i];
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
  if (!g || busy || g.turn !== 'you' || g.rolls === 0) return;
  if (picked !== id) { picked = id; render(); say($('status').textContent); return; }
  const option = options(g.board, g.you, g.dice).find(o => o.box.id === id);
  if (!option) return;
  g.you = mark(g.you, option);
  fresh = { you: id };
  picked = null;
  if (option.extra) toast(`Another five of a kind: ${g.board.extra} extra points.`);
  else if (option.box.kind === 'five' && option.score) toast('Five of a kind.');
  g.turn = 'them';
  g.held = [false, false, false, false, false];
  hurry = false; // a tap from here on hurries the turn that's coming, even before they roll
  busy = true; // the opponent is about to play, so going back and carrying on mustn't start their turn as well
  save();
  render();
  showDice(); // still yours, until the opponent rolls
  $('b-roll').focus({ preventScroll: true }); // the box picked from the keyboard has gone: Roll says whose turn it is, then yours
  const line = `You score ${option.score} in ${boxLabel(option.box)}${option.extra ? `, plus ${g.board.extra} extra` : ''}.`;
  status(line);
  say(line);
  setTimeout(theirTurn, settings.fast ? 300 : 650);
}

// ---- the opponent's turn ----

// `tumble` is how long thrown dice take to land (--tumble in css/app.css).
const PACE = { normal: { roll: 800, think: 650, choose: 850, tumble: 700 }, fast: { roll: 420, think: 280, choose: 420, tumble: 380 } };

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
  if (!g || g.turn !== 'them' || g.over || playing === t) return;
  // A game saved while two copies of a turn ran at once can have the opponent's card full already.
  if (filled(g.board, g.them)) { if (filled(g.board, g.you)) finish(); else yourTurn(g); return; }
  const still = () => t === token && game === g;
  const pace = PACE[settings.fast ? 'fast' : 'normal'], name = who(g).name, b = g.board;
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
  status(`${name} rolls.`);
  showDice([0, 1, 2, 3, 4]);
  render();
  await wait(pace.roll);
  if (!still()) return;

  for (let left = b.rolls - 1; left > 0; left--) {
    const keep = opp.keep(b, g.them, g.dice, left, rand);
    if (!keep) break;
    g.held = keep;
    const n = keep.filter(Boolean).length;
    status(n ? `${name} holds ${n === 1 ? 'one' : ['', '', 'two', 'three', 'four'][n]} and rolls again.` : `${name} rolls them all again.`);
    showDice();
    await wait(pace.think);
    if (!still()) return;
    const rolled = [];
    g.dice = g.dice.map((d, i) => (keep[i] ? d : (rolled.push(i), roll())));
    g.rolls++;
    showDice(rolled);
    await wait(pace.roll);
    if (!still()) return;
  }

  // Hurried, the rolls go by before the dice land, but the turn ends on landed dice and a score you can read.
  if (hurry) {
    await landed(pace.tumble + 300);
    if (!still()) return;
  }
  const option = opp.box(b, g.them, g.dice, rand);
  theirPick = { id: option.box.id, score: option.score };
  status(`${name} scores ${option.score} in ${boxLabel(option.box)}${option.extra ? `, plus ${b.extra} extra` : ''}.`);
  render();
  pad.reveal(option.box.id); // on a short screen the box may be scrolled out of sight; your own turn never moves the pad
  await wait(pace.choose, 450);
  if (!still()) return;

  g.them = mark(g.them, option);
  g.last = { id: option.box.id, score: option.score }; // for your turn's line, after a reload or Carry on as well
  theirPick = null;
  fresh = { them: option.box.id };
  if (option.extra) toast(`${name} rolls another five of a kind: ${b.extra} extra points.`);
  else if (option.box.kind === 'five' && option.score) toast(`${name} rolls five of a kind.`);

  // Heard once, at the end of their turn, rather than as each line goes by: what they scored and where it leaves you.
  const scored = `${name} scored ${option.score} in ${boxLabel(option.box)}${option.extra ? `, plus ${b.extra} extra` : ''}.`;
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

function start(table, opp = table) {
  const seed = (Math.random() * 2 ** 31) | 0;
  const board = table === null ? CLASSIC : boardFor(table, seed);
  if (game && !game.over) concede(true);
  token++;
  game = {
    table, opp, seed, board,
    you: blankCard(board), them: blankCard(board),
    turn: 'you', number: 1, rolls: 0, last: null,
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
  const you = totals(b, g.you).total, them = totals(b, g.them).total, name = who(g).name;
  const won = you > them, tie = you === them;
  let before = false, best = ''; // you'd beaten this table already; a new best there, over one you had
  if (g.table !== null) {
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
  const onward = won && g.table !== null && !last && !(before && progress.beaten[g.table + 1]); // a table to send you on to
  $('result-line').textContent = won
    ? g.table === null ? (progress.beaten[g.opp] ? 'A good game.' : `A good game. It doesn’t count on the tour: ${mid(name)} is waiting at table ${g.opp + 1}.`)
      : last ? (before ? `You’ve beaten ${mid(name)} before. That’s still the whole tour.` : 'That’s the whole tour. Nobody at these tables has anything left to teach you.')
      : before ? (onward ? `You’ve beaten ${mid(name)} before; table ${g.table + 2} is still open.` : `You’ve beaten ${mid(name)} before.`)
      : `Table ${g.table + 2} is open: ${TABLES[g.table + 1].board.name}, against ${mid(TABLES[g.table + 1].who.name)}.`
    : tie ? 'Play it again to settle it.' : 'The dice owe you one.';
  $('result-scores').innerHTML = `<div><span>You</span><b>${you}</b></div><div class="them"><span>${escape(name)}</span><b>${them}</b></div>`;
  $('result-best').textContent = best;
  $('result-best').hidden = !best;
  const next = $('b-next');
  if (onward) { next.textContent = `On to table ${g.table + 2}`; next.onclick = () => { intro(g.table + 1); under = 'sheet-result'; }; }
  else { next.textContent = 'Play again'; next.onclick = () => start(g.table, g.opp); }
  $('b-again').hidden = !onward;
  const t = token;
  setTimeout(() => { if (t === token && game === g && !resultSeen) showResult(); }, 900); // unless a new game has started, or it's been opened already
}

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
    if (g.table !== null) progress.played[g.table] = (progress.played[g.table] || 0) + 1;
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

function showDice(rolled = []) {
  const g = game;
  if (!g) return;
  const mine = g.turn === 'you';
  tray.show(g.dice, g.held, {
    rolled,
    theirs: !mine && theirDice,
    idle: mine && g.rolls === 0,
    canHold: mine && !busy && g.rolls > 0 && g.rolls < g.board.rolls,
    quick: settings.fast, // the dice land before roll() and PACE move on
    name: who(g).name,
  });
}

function render() {
  const g = game;
  if (!g) return;
  const b = g.board, opp = who(g), mine = g.turn === 'you' && !g.over;
  const turns = b.boxes.length;
  $('g-table').textContent = where(g);
  if (document.body.dataset.screen === 'game') document.title = `${where(g)} · Full House`;
  // On two lines, the break comes after the dot, and "(2 left)" keeps together.
  $('g-twist').textContent = `against ${mid(opp.name)}\u00a0· turn ${Math.min(g.number, turns)} of ${turns}`;
  document.documentElement.style.setProperty('--them-colour', opp.colour);

  const opts = mine && g.rolls > 0 && !busy ? options(b, g.you, g.dice) : null;
  const offers = opts && Object.fromEntries(opts.map(o => [o.box.id, o.score]));
  pad.render({ board: b, you: g.you, them: g.them, name: opp.name, offers, picked, fresh, hints: settings.hints, theirPick });
  fresh = {};

  const left = b.rolls - g.rolls;
  $('rolls').innerHTML = Array.from({ length: b.rolls }, (_, i) => `<i class="${i < g.rolls && (mine || g.turn === 'them') ? 'used' : ''}"></i>`).join('');
  // Not `disabled`, which would throw the keyboard's focus off the button while the dice are in the air: it stays put,
  // reads out whose turn it is, and roll() turns down a press it can't take.
  const button = $('b-roll');
  button.setAttribute('aria-disabled', String(!g.over && (!mine || busy || left <= 0 || allHeld(g))));
  button.textContent = g.over ? 'See the result' : !mine ? `${opp.name}’s turn` : g.rolls === 0 ? 'Roll' : left > 0 ? `Roll again (${left}\u00a0left)` : 'No rolls left';

  if (mine && !busy) {
    const joker = g.rolls > 0 && jokerState(b, g.you, g.dice);
    if (picked) {
      const o = opts?.find(x => x.box.id === picked);
      status(`Tap ${boxLabel(b.boxes.find(x => x.id === picked))} again to ${!o?.score ? 'write in a 0' : `score ${o.score}`}${o?.extra ? `, plus ${o.extra} extra` : ''}.`);
    } else if (g.rolls === 0) status(firstLine(g));
    else if (joker) status(jokerLine(b, joker, opts));
    else if (left > 0) status('Tap dice to hold them, then roll again. Or pick a box to score.');
    else status('Pick a box to score.');
  }
}

// A second five of a kind lights only the boxes the joker rules allow, so the line says which, and what it earns.
// It keeps to two lines on a small phone, as every status line does, so the dice and the pad don't move.
function jokerLine(b, joker, opts) {
  const again = joker.extra ? `Five of a kind again: ${joker.extra} extra.` : 'Five of a kind again.';
  if (joker.forced) return `${again} It has to go in ${boxLabel(joker.forced)}.`;
  if (joker.topOnly) return `${again} Only top boxes are left${opts.every(o => !o.score) ? ': it scores 0 there' : ''}.`;
  const has = kind => joker.lower.some(x => x.kind === kind);
  const whole = [has('full') && 'a full house', (has('small') || has('large')) && 'a straight'].filter(Boolean).join(' or ') || (has('pairs') && 'two pairs');
  return `${again} ${whole ? `Any bottom box: ${whole} counts in full.` : 'It can go in any bottom box.'}`;
}

// Before your first roll: what the opponent just scored, or, as a game starts at Hot Boxes, which boxes are hot.
function firstLine(g) {
  const b = g.board, last = g.number > 1 && g.last && b.boxes.find(x => x.id === g.last.id);
  if (last) return `Your turn. ${who(g).name} scored ${g.last.score} in ${boxLabel(last)}.`;
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
  const list = $('tables');
  list.innerHTML = TABLES.map((t, i) => {
    const beaten = !!progress.beaten[i], unlocked = i === 0 || !!progress.beaten[i - 1];
    const state = beaten ? `Beaten${progress.best[i] ? ` · your best ${progress.best[i]}` : ''}` : unlocked ? 'Next up' : 'Locked';
    return `<li class="${beaten ? 'beaten' : unlocked ? 'next' : 'locked'}">
      <button type="button" data-table="${i}" ${unlocked ? '' : 'disabled'}>
        <span class="n">${i + 1}</span>
        <span class="txt"><b>${t.board.name}</b><span class="vs"><i class="dot" style="--c:${t.who.colour}"></i>${t.who.name}</span><small>${state}</small></span>
      </button></li>`;
  }).join('');
  const met = TABLES.map((t, i) => ({ t, i })).filter(({ i }) => i === 0 || progress.beaten[i - 1]);
  $('people').innerHTML = met.map(({ t, i }) => `<button type="button" data-quick="${i}"><i class="dot" style="--c:${t.who.colour}"></i>${t.who.name}</button>`).join('');
  const c = $('b-continue'), going = game && !game.over;
  c.hidden = !going;
  if (going) c.innerHTML = `<b>Carry on</b><span>${where(game)}, against ${mid(who(game).name)}. Turn ${Math.min(game.number, game.board.boxes.length)} of ${game.board.boxes.length}.</span>`;
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

// A table on the tour, or a quick game (table null) against the opponent from table `opp`.
function intro(table, opp = table) {
  const t = TABLES[opp], board = table === null ? CLASSIC : t.board;
  $('intro-n').textContent = table === null ? 'Quick game' : `Table ${table + 1} of ${TABLES.length}`;
  $('intro-title').textContent = board.name;
  $('intro-blurb').textContent = board.blurb;
  $('intro-who').innerHTML = `<i class="dot big" aria-hidden="true" style="--c:${t.who.colour}">${t.who.name.replace(/^The /, '')[0]}</i><div><b>${t.who.name}</b><span>${t.who.line}</span>${game && !game.over ? '<em>Sitting down here ends the game you’re in.</em>' : ''}</div>`;
  $('b-sit').onclick = () => start(table, opp);
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
    pairs: b => `<b>Two pairs:</b> the four paired dice added up${over(b)}.`,
    full: b => `<b>Full house</b>, three of one number and two of another: ${pays(25, b)}.`,
    small: b => `<b>Small straight</b>, four in a row: ${pays(30, b)}.`,
    large: b => `<b>Large straight</b>, five in a row: ${pays(40, b)}.`,
    five: b => `<b>Five of a kind:</b> ${pays(50, b)}.`,
    chance: b => `<b>Chance:</b> ${total(b).replace('the total of all five dice', 'the total, whatever the dice')}.`,
    low: b => `<b>Low road:</b> ${pays(30, b)} if the dice total 12 or less.`,
  };
  // Three of each number earns the bonus on a board where it adds up to the target exactly: not at Evens.
  const threeEach = top.length === 6 && 3 * top.reduce((a, b) => a + b.face * (b.mult || 1), 0) === board.bonus.at;
  const evens = board.boxes.find(b => b.kind === 'evens');
  const items = [
    here && `<b>At this table:</b> ${escape(board.blurb)}${hotNames(board) ? ` This time it’s ${hotNames(board)}.` : ''}`,
    `On your turn, roll all five dice. Tap any dice you want to hold, then roll the rest. You get ${COUNT[board.rolls]} rolls.`,
    'After any roll you can stop and score: tap a box on the pad, then tap it again to write the score in. Every turn fills one box, even if it scores nothing.',
    `<b>Top section:</b> add up the dice showing that number. Reach ${board.bonus.at} across the six boxes for a ${board.bonus.worth}-point bonus${threeEach ? ' (three of each number gets you there)' : ''}.`,
    lower.map(b => box[b.kind](b)).filter(Boolean).join(' '),
    `Once the Five of a kind box is filled, another five of a kind has to go in its own number’s box if that’s open. If not, it goes in any open box in the bottom section, where ${of('pairs') ? 'a full house, a straight or two pairs' : 'a full house or a straight'} counts in full. If the bottom is full too, it scores 0 in a top box${evens ? ` (or what the even dice add up to, in ${boxLabel(evens)})` : ''}. It also earns ${board.extra} extra, unless the Five of a kind box holds a 0.`,
    'You and your opponent take turns until every box is filled. The higher total wins.',
    KEYS,
    !here && 'Some tables change these; each says how when you sit down.',
  ];
  $('rules-list').innerHTML = items.filter(Boolean).map(t => (t === KEYS ? `<li class="keys">${t}</li>` : `<li>${t}</li>`)).join('');
}

// Shown where there's a mouse, and so most likely a keyboard: see css/app.css.
const KEYS = 'On a keyboard: Space or R rolls and 1 to 5 hold the dice. Tab to a box and press Enter to pick it, then Enter again to score it. Space or Enter hurries the opponent along.';

let opener = null;
let under = null; // the sheet this one was opened from, to go back to if it's turned down
const behind = () => [$('home'), $('game')]; // the screens under a sheet, out of reach while it's open
// `back` is where the focus goes when the sheet closes, if not to whatever had it before.
function openSheet(id, back) {
  closeSheets();
  opener = back || document.activeElement;
  behind().forEach(el => { el.inert = true; });
  $(id).hidden = false;
  $(id).querySelector('.primary, .close, button')?.focus({ preventScroll: true });
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
function settingsFrom(s) {
  return { fast: false, hints: true, ...s };
}
function progressFrom(p) {
  const out = { beaten: [], best: [], played: [], won: [], quick: { played: 0, won: 0 }, ...p };
  for (const k of ['beaten', 'best', 'played', 'won']) if (!Array.isArray(out[k])) out[k] = [];
  out.quick = { played: 0, won: 0, ...(out.quick && typeof out.quick === 'object' ? out.quick : {}) };
  return out;
}
// A saved game still being played, with every part the page reads there to pick it up again.
function whole(g) {
  try {
    const five = a => Array.isArray(a) && a.length === 5, b = g.board;
    return !g.over && (g.turn === 'you' || g.turn === 'them') && Number.isInteger(g.number) && Number.isInteger(g.rolls)
      && Number.isInteger(g.opp) && !!TABLES[g.opp] && (g.table === null || (Number.isInteger(g.table) && !!TABLES[g.table]))
      && five(g.dice) && g.dice.every(d => Number.isInteger(d) && d >= 1 && d <= 6) && five(g.held)
      && b.rolls > 0 && b.bonus.at > 0 && b.boxes.length > 0 && b.boxes.every(x => boxLabel(x) && x.id in g.you && x.id in g.them);
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
  if (game?.turn === 'them' && !busy) theirTurn();
}
$('b-continue').addEventListener('click', carryOn);
$('tables').addEventListener('click', e => { const b = e.target.closest('[data-table]'); if (b) intro(+b.dataset.table); });
// A quick game starts straight away, unless it would end the game you're in: then it asks first, as a table on the tour does.
$('people').addEventListener('click', e => {
  const b = e.target.closest('[data-quick]');
  if (!b) return;
  if (game && !game.over) intro(null, +b.dataset.quick);
  else start(null, +b.dataset.quick);
});
$('b-tour').addEventListener('click', () => { closeSheets(); game = null; save(); open('home'); });
$('b-again').addEventListener('click', () => start(game.table, game.opp));
$('b-rules').addEventListener('click', () => { showRules(CLASSIC, false); openSheet('sheet-rules'); });
// From the menu, which closes as How to play opens: afterwards the focus goes back to the menu button.
$('b-menu-rules').addEventListener('click', () => { showRules(game?.board || CLASSIC, !!game); openSheet('sheet-rules', $('b-menu')); });
const showMenu = () => {
  if (!game) return;
  $('menu-title').textContent = where(game);
  $('menu-twist').textContent = `${game.board.blurb}${hotNames(game.board) ? ` This time it’s ${hotNames(game.board)}.` : ''} Against ${mid(who(game).name)}. ${who(game).line}`;
  openSheet('sheet-menu');
};
// Giving up takes two taps, as scoring a box does: the first asks, and closing the menu takes the question back.
function askGiveUp(on) {
  givingUp = on;
  $('b-concede').textContent = game?.over ? 'Back to the tour' : on ? 'Tap again to give up. It counts as a loss.' : 'Give up this game';
  $('b-concede').classList.toggle('asked', on);
}
function giveUp() {
  const g = game;
  if (!g) return;
  if (g.over) { concede(false); return; } // nothing to lose
  if (!givingUp) { askGiveUp(true); return; }
  concede(false);
  toast(`You gave up${g.table === null ? '' : ` at table ${g.table + 1}`}. ${who(g).name} takes that one.`);
}
$('b-menu').addEventListener('click', showMenu);
$('b-where').addEventListener('click', showMenu);
$('b-concede').addEventListener('click', giveUp);
document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', dismiss));
const TOGGLES = [['fast', 'o-fast'], ['hints', 'o-hints']];
for (const [k, id] of TOGGLES) {
  $(id).checked = settings[k];
  $(id).addEventListener('change', e => { settings[k] = e.target.checked; save(); showDice(); render(); });
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { dismiss(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return; // the browser's shortcuts, like Ctrl+R to reload
  if (document.body.dataset.screen !== 'game' || document.querySelector('.sheet:not([hidden])')) return;
  // On the opponent's turn, Space or Enter hurries them along, as a tap on the dice does: from Roll, where a score leaves
  // the focus, or from nowhere. Kept from Roll itself, so a Space let go as your turn comes doesn't roll for you.
  if ((e.key === ' ' || e.key === 'Enter') && game?.turn === 'them' && busy && (e.target === document.body || e.target.id === 'b-roll')) {
    e.preventDefault();
    hurry = true;
    return;
  }
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
  showDice();
  const theirs = whole(next.game) ? next.game : null, ours = game && !game.over ? game : null;
  if (JSON.stringify(theirs) !== JSON.stringify(ours) && !keepOurs(ours, theirs)) adopt(theirs);
  if (document.body.dataset.screen === 'home') renderHome(); else render();
});

// How far into a game a save is: the turn, then the rolls used, with the opponent's go after all of yours.
const reached = g => g.number * 10 + (g.turn === 'them' ? 9 : g.rolls);
// Part way through your turn here, with the other copy behind it in the same game, or on another game, or none.
function keepOurs(ours, theirs) {
  if (!ours || ours.turn !== 'you' || ours.rolls === 0) return false;
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
  if (g.turn === 'them') { busy = true; setTimeout(theirTurn, 500); }
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

open('home', { focus: false });
if (game) {
  // A game in progress comes back where you left it. An opponent's turn that was cut short starts over, the same turn.
  open('game', { focus: false });
  showDice();
  render();
  if (game.turn === 'them') { busy = true; setTimeout(theirTurn, 500); }
}

// For the tests and the screenshot tool.
window.fullHouse = {
  get game() { return game; },
  get busy() { return busy; },
  get hurry() { return hurry; },
  progress,
  settings,
  start,
  set(g) { token++; game = g; busy = false; picked = null; theirPick = null; theirDice = false; open('game', { focus: false }); showDice(); render(); if (g.turn === 'them') theirTurn(); }, // as a saved game comes back
};
