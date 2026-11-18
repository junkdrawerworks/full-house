// The score pad: a printed form with your column and your opponent's, scores pencilled in.
// On your turn, the open boxes show what the dice would score there; tap one to pick it, and again to write it in.

import { boxLabel, boxHint, isUpper, totals } from './rules.js';

export class Pad {
  // onPick(boxId): the player tapped a box in their column.
  constructor(el, { onPick }) {
    this.el = el;
    this.onPick = onPick;
    el.addEventListener('click', e => {
      const row = e.target.closest('tr[data-box]');
      if (row && row.classList.contains('can')) onPick(row.dataset.box);
    });
    el.addEventListener('keydown', e => {
      const row = e.target.closest('tr[data-box]');
      if (!row || !row.classList.contains('can')) return;
      // Up and Down go between the open boxes, Home and End to the first and the last, so a box is a Tab and an arrow or two away.
      const open = [...el.querySelectorAll('tr.can')], at = open.indexOf(row);
      const to = { ArrowUp: at - 1, ArrowDown: at + 1, Home: 0, End: open.length - 1 }[e.key];
      if (to !== undefined) {
        e.preventDefault();
        const next = open[Math.max(0, Math.min(to, open.length - 1))];
        next.focus({ preventScroll: true });
        this.reveal(next.dataset.box, { anywhere: true });
        return;
      }
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      onPick(row.dataset.box);
      this.reveal(row.dataset.box, { anywhere: true }); // a box picked from the keyboard may have been scrolled out of sight
    });
  }

  // Bring a box's row into view in the pad's own window, which is all that moves: the page stays where it is. It goes
  // just far enough to clear the window's top, or the Total stuck to its foot, and nowhere if the row shows already.
  // In a window so short that the whole game scrolls instead (see css/app.css), it scrolls the game, but only when
  // `anywhere` says so: the keyboard's moves, not the opponent's, which would take the dice out of sight.
  reveal(id, { anywhere = false } = {}) {
    const row = this.el.querySelector(`tr[data-box="${id}"]`), foot = this.el.querySelector('tfoot th');
    let wrap = this.el.parentElement;
    if (!row || !foot) return;
    if (getComputedStyle(wrap).overflowY === 'visible') {
      if (!anywhere) return;
      wrap = wrap.parentElement;
    }
    const r = row.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    const floor = Math.min(w.bottom, foot.getBoundingClientRect().top);
    const by = r.top < w.top ? r.top - w.top : r.bottom > floor ? r.bottom - floor : 0;
    if (!by) return;
    let top = wrap.scrollTop + by;
    if (by < 0 && top < 48) top = 0; // nearly back at the top: all the way, so the heading shows as well
    wrap.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  // When none of the boxes you can score shows in the pad's window (the opponent's pick may have left it at the other end),
  // bring the nearest into view: the first one below the window, or else the last one above it. One that shows already,
  // even if only one, moves nothing, nor does a window so short that the whole game scrolls.
  revealOpen() {
    const wrap = this.el.parentElement, foot = this.el.querySelector('tfoot th'), rows = [...this.el.querySelectorAll('tr.can')];
    if (!foot || !rows.length || getComputedStyle(wrap).overflowY === 'visible') return;
    const w = wrap.getBoundingClientRect(), floor = Math.min(w.bottom, foot.getBoundingClientRect().top);
    const at = rows.map(row => row.getBoundingClientRect());
    if (at.some(r => r.top >= w.top - 0.5 && r.bottom <= floor + 0.5)) return;
    const below = rows.find((row, i) => at[i].bottom > floor + 0.5);
    this.reveal((below || rows[rows.length - 1]).dataset.box);
  }

  // board, both cards, the opponent's name, and on your turn: what each allowed box would score ({ id: score }),
  // which box is picked, and which boxes were just written in (to pencil them in as you watch).
  render({ board, you, them, name, offers = null, picked = null, fresh = {}, hints = true, theirPick = null }) {
    // Redrawing replaces the rows, so note the one with the keyboard focus to give it back afterwards.
    // Only the keyboard's: a box picked with a tap or a click would keep it too, and the next Space would score it.
    const a = document.activeElement;
    const focused = this.el.contains(a) && fromKeyboard(a) ? a.closest('tr[data-box]')?.dataset.box : null;
    const ty = totals(board, you), tt = totals(board, them);
    const cell = (card, b, who) => {
      const v = card[b.id];
      if (v !== null) return `<td class="${who}${fresh[who] === b.id ? ' fresh' : ''}"><span>${v}</span></td>`;
      if (who === 'you' && offers && b.id in offers) {
        const show = hints || picked === b.id;
        return `<td class="you offer${picked === b.id ? ' picked' : ''}">${show ? `<span>${offers[b.id]}</span>` : ''}</td>`;
      }
      if (who === 'them' && theirPick?.id === b.id) return `<td class="them offer picked"><span>${theirPick.score}</span></td>`;
      return `<td class="${who}"></td>`;
    };
    // An open box is a button, named for what it would do, since its row's text would read your score and the opponent's
    // run together: "Sixes, times 3: score 18", "Ones: write in 0", or with the scores hidden, "Sixes: score here".
    const said = b => {
      const what = !(hints || picked === b.id) ? 'score here' : offers[b.id] ? `score ${offers[b.id]}` : 'write in 0';
      return `${boxLabel(b)}${b.mult > 1 ? `, times ${b.mult}` : ''}: ${what}`;
    };
    const row = b => {
      const can = offers && b.id in offers;
      const mult = b.mult > 1 ? `<em class="mult">×${b.mult}</em>` : '', hint = boxHint(b, board);
      const button = can ? ` tabindex="0" role="button" aria-pressed="${picked === b.id}" aria-label="${escape(said(b))}"` : '';
      return `<tr data-box="${b.id}" class="${can ? 'can' : ''}${picked === b.id ? ' picked' : ''}${b.mult > 1 ? ' hot' : ''}"${button}>
        <th scope="row"><b>${boxLabel(b)}${mult}</b>${hint ? `<small>${hint}</small>` : ''}</th>${cell(you, b, 'you')}${cell(them, b, 'them')}</tr>`;
    };
    const upper = board.boxes.filter(isUpper), lower = board.boxes.filter(b => !isUpper(b));
    const bonusCell = (t, who) => `<td class="${who}">${t.bonus ? t.bonus : t.upper >= 0 ? `<small>${t.upper}/${board.bonus.at}</small>` : ''}</td>`;
    const anyExtras = you.extras || them.extras;
    this.el.classList.toggle('long', name.length > 6); // the Dealer: see css/app.css
    this.el.innerHTML = `
      <caption class="vh">Score pad</caption>
      <thead><tr><th scope="col"><span class="vh">Box</span></th><th scope="col" class="you">You</th><th scope="col" class="them">${escape(name)}</th></tr></thead>
      <tbody>${upper.map(row).join('')}
        <tr class="sub"><th scope="row"><b>Bonus</b><small>${board.bonus.at} or more on top: ${board.bonus.worth}</small></th>${bonusCell(ty, 'you')}${bonusCell(tt, 'them')}</tr>
      </tbody>
      <tbody>${lower.map(row).join('')}
        ${anyExtras ? `<tr class="sub"><th scope="row"><b>Extra fives</b><small>${board.extra} each</small></th><td class="you">${ty.extras || ''}</td><td class="them">${tt.extras || ''}</td></tr>` : ''}
      </tbody>
      <tfoot><tr class="total"><th scope="row">Total</th><td class="you">${ty.total}</td><td class="them">${tt.total}</td></tr></tfoot>`;
    if (focused) this.el.querySelector(`tr.can[data-box="${focused}"]`)?.focus({ preventScroll: true });
  }
}

const escape = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// Whether the focus came from the keyboard, the way a browser decides to draw a focus ring. Browsers too old to say count as no.
const fromKeyboard = el => { try { return el.matches(':focus-visible'); } catch { return false; } };
