// Plays the game in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
// Give it part of a step's name to run only the steps that match:  node test/e2e.mjs tour
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const browser = await pw.chromium.launch();
const only = process.argv.slice(2).join(' ');

// Each step starts on a fresh page with nothing saved: a phone (upright unless it says otherwise), or a desktop with a mouse.
// `at` is the page to open, the game from the test server unless it says otherwise. Anything the page asks for from
// elsewhere, anything the server hasn't got (a 404) and any request of its own that fails is a problem.
async function step(name, fn, { desktop = false, serviceWorkers = 'block', viewport = { width: 390, height: 844 }, at = base } = {}) {
  if (only && !name.includes(only)) return;
  const size = desktop ? { viewport: { width: 1280, height: 800 } } : { viewport, deviceScaleFactor: 2, hasTouch: true };
  const ctx = await browser.newContext({ ...size, serviceWorkers });
  const page = await ctx.newPage();
  const problems = [], home = at.slice(0, at.lastIndexOf('/') + 1);
  page.on('pageerror', e => problems.push(e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('request', r => { if (!r.url().startsWith(home) && !r.url().startsWith('data:')) problems.push('left the site: ' + r.url()); });
  page.on('response', r => { if (r.status() >= 400) problems.push(`${r.status()}: ${r.url()}`); });
  page.on('requestfailed', r => { if (r.url().startsWith(home)) problems.push(`failed (${r.failure()?.errorText}): ${r.url()}`); });
  const game = () => page.evaluate(() => window.fullHouse.game);
  const myTurn = () => page.waitForFunction(() => window.fullHouse.game?.turn === 'you' && !window.fullHouse.busy, null, { timeout: 30000 });
  const settled = () => page.waitForFunction(() => !window.fullHouse.busy, null, { timeout: 30000 });
  try {
    await page.goto(at);
    await page.evaluate(() => document.fonts.ready);
    await fn({ page, ctx, game, myTurn, settled });
    assert.deepEqual(problems, [], `problems while playing: ${name}`);
  } finally {
    await ctx.close();
  }
  console.log(`ok  ${name}`);
}

// The last turn of a game you're well ahead in, with only Chance left to fill: roll and score it.
async function lastTurn({ page, myTurn, settled }) {
  await page.evaluate(() => {
    const g = structuredClone(window.fullHouse.game);
    for (const b of g.board.boxes) { g.you[b.id] = b.id === 'chance' ? null : 20; g.them[b.id] = b.id === 'chance' ? null : 5; }
    Object.assign(g, { number: 13, rolls: 0, turn: 'you' });
    window.fullHouse.settings.fast = true;
    window.fullHouse.set(g);
  });
  await myTurn();
  await page.click('#b-roll');
  await settled();
  await page.locator('tr.can').first().click();
  await page.locator('tr.can').first().click();
}
// ...and once the opponent has played their last turn, the result.
async function win(t) {
  await lastTurn(t);
  await t.page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
}

try {
  await step('a game through the tour', async ({ page, ctx, game, myTurn, settled }) => {
    // The tour: the first table open, the rest locked.
    assert.equal(await page.locator('#tables li').count(), 8);
    assert.match(await page.textContent('#tables li:nth-child(1)'), /Next up/);
    assert.equal(await page.locator('#tables li.locked').count(), 7);

    // Sit down at table 1.
    await page.click('[data-table="0"]');
    await page.waitForSelector('#sheet-intro:not([hidden])');
    assert.match(await page.textContent('#intro-title'), /Classic/);
    await page.click('#b-sit');
    assert.equal(await page.evaluate(() => document.body.dataset.screen), 'game');
    await page.evaluate(() => { window.fullHouse.settings.fast = true; });

    // Roll, hold two dice, roll again: the held dice stay put.
    await page.click('#b-roll');
    await settled();
    let g = await game();
    assert.equal(g.rolls, 1);
    await page.click('.die >> nth=0');
    await page.click('.die >> nth=1');
    assert.equal(await page.getAttribute('.die >> nth=0', 'aria-pressed'), 'true');
    const kept = (await game()).dice.slice(0, 2);
    await page.click('#b-roll');
    await settled();
    g = await game();
    assert.equal(g.rolls, 2);
    assert.deepEqual(g.dice.slice(0, 2), kept, 'held dice were not rolled');

    // Pick a box, then tap it again to score it. Then the opponent plays its turn.
    const row = page.locator('tr.can').first();
    const id = await row.getAttribute('data-box');
    await row.click();
    assert.match(await page.textContent('#status'), /again to (score \d+|write in a 0)\.$/);
    await row.click();
    g = await game();
    assert.notEqual(g.you[id], null, 'the score went in');
    assert.equal(g.turn, 'them');
    await page.click('#tray'); // hurry them along
    await myTurn();
    g = await game();
    assert.equal(Object.values(g.them).filter(v => v !== null).length - 1, 1, 'the opponent filled one box'); // minus `extras`
    assert.equal(g.number, 2);

    // A game in progress survives a reload.
    await page.reload();
    await myTurn();
    assert.deepEqual((await game()).you, g.you);
    assert.equal(await page.evaluate(() => document.body.dataset.screen), 'game');

    // The last turn of a game you're well ahead in: win, and the next table opens.
    await page.evaluate(() => {
      const g = structuredClone(window.fullHouse.game);
      const ids = g.board.boxes.map(b => b.id);
      for (const id of ids.slice(0, 12)) { g.you[id] = 20; g.them[id] = 5; }
      g.you.chance = null; g.them.chance = null;
      g.number = 13; g.rolls = 0; g.turn = 'you';
      window.fullHouse.settings.fast = true;
      window.fullHouse.set(g);
    });
    await myTurn();
    await page.click('#b-roll');
    await settled();
    await page.locator('tr.can').first().click();
    await page.locator('tr.can').first().click();
    await page.click('#tray');
    await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
    assert.match(await page.textContent('#result-title'), /You beat Pip/);
    assert.match(await page.textContent('#b-next'), /On to table 2/);
    const progress = await page.evaluate(() => window.fullHouse.progress);
    assert.equal(progress.beaten[0], true);
    assert.equal(progress.played[0], 1);
    await page.click('#b-next');
    await page.waitForSelector('#sheet-intro:not([hidden])');
    assert.match(await page.textContent('#intro-title'), /Evens/);

    // Table 2 has an Evens box where the Ones were.
    await page.click('#b-sit');
    assert.equal(await page.locator('tr[data-box="evens"]').count(), 1);
    assert.equal(await page.locator('tr[data-box="f1"]').count(), 0);

    // Giving up counts as a game played, and goes back to the tour, where table 2 is next.
    await page.click('#b-menu');
    await page.click('#b-concede');
    await page.click('#b-concede');
    assert.equal(await page.evaluate(() => document.body.dataset.screen), 'home');
    assert.equal((await page.evaluate(() => window.fullHouse.progress)).played[1], 1);
    assert.match(await page.textContent('#tables li:nth-child(2)'), /Next up/);
    assert.match(await page.textContent('#tables li:nth-child(1)'), /Beaten/);
    assert.equal(await page.locator('#people button').count(), 2, 'Pip and Maud for a quick game');

    // A quick game: classic rules against someone you've met.
    await page.click('[data-quick="1"]');
    assert.match(await page.textContent('#g-table'), /Quick game/);
    assert.match(await page.textContent('#g-twist'), /Maud/);

    // Fits a phone: nothing scrolls sideways.
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page scrolls sideways on a phone');

    // Works offline once it has been opened.
    await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 }).catch(() => {});
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => window.fullHouse?.game);
    assert.equal(await page.locator('.die').count(), 5, 'the game did not load offline');
    await ctx.setOffline(false);
  }, { serviceWorkers: 'allow' });

  await step('the opponent plays one turn, even after back and carry on while the turn passes', async ({ page, game, myTurn, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.evaluate(() => { window.fullHouse.settings.fast = true; });
    await page.click('#b-roll');
    await settled();
    // Score a box, then back to the tour and carry on, all before the opponent has started.
    await page.evaluate(() => {
      const row = () => document.querySelector('#pad tr.can');
      const id = row().dataset.box;
      row().click();
      document.querySelector(`#pad tr[data-box="${id}"]`).click();
      document.getElementById('b-home').click();
      document.getElementById('b-continue').click();
    });
    await myTurn();
    await page.waitForTimeout(3000); // a second copy of the turn would land a moment after the first
    let g = await game();
    assert.equal(g.turn, 'you');
    assert.equal(g.number, 2, 'one turn each');
    assert.equal(Object.values(g.them).filter(v => v !== null).length - 1, 1, 'the opponent filled one box');

    // The same just after opening the game again during the opponent's turn.
    await page.click('#b-roll');
    await settled();
    await page.locator('tr.can').first().click();
    await page.locator('tr.can').first().click();
    await page.reload({ waitUntil: 'commit' });
    await page.waitForFunction(() => {
      if (!window.fullHouse) return false;
      document.getElementById('b-home').click();
      document.getElementById('b-continue').click();
      return true;
    }, null, { polling: 10 });
    await myTurn();
    await page.waitForTimeout(3000);
    g = await game();
    assert.equal(g.number, 3, 'one turn each');
    assert.equal(Object.values(g.them).filter(v => v !== null).length - 1, 2, 'the opponent filled one box a turn');
  });

  await step('tapping the dice hurries the opponent along', async ({ page, myTurn, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-roll');
    await settled();
    await page.locator('tr.can').first().click();
    await page.locator('tr.can').first().click();
    await page.waitForFunction(() => /rolls\.$/.test(document.getElementById('status').textContent));
    // At the usual pace their turn takes four and a half seconds; tapping their dice (not the felt) rushes it.
    const t0 = Date.now();
    const die = await page.locator('.die >> nth=2').boundingBox();
    for (let i = 0; i < 3; i++) await page.touchscreen.tap(die.x + die.width / 2, die.y + die.height / 2);
    await myTurn();
    assert.ok(Date.now() - t0 < 3000, `their turn took ${Date.now() - t0} ms after tapping the dice`);
  });

  await step('a finished game is not offered to carry on', async t => {
    const { page } = t;
    const screen = () => page.evaluate(() => document.body.dataset.screen);
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await win(t);
    // On to table 2, then Not yet: the result is back. Close it, and the arrow goes back to the tour.
    await page.click('#b-next');
    await page.click('#sheet-intro [data-close].plain');
    assert.ok(await page.isVisible('#sheet-result .panel'), 'Not yet left no way on from the finished game');
    assert.equal(await screen(), 'game');
    await page.keyboard.press('Escape');
    await page.click('#b-home');
    assert.ok(await page.isHidden('#b-continue'), 'Carry on offered for a finished game');

    // Escape on the result sheet, then the menu, which has nothing to give up: one tap goes back to the tour.
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await win(t);
    await page.keyboard.press('Escape');
    await page.click('#b-menu');
    assert.equal(await page.textContent('#b-concede'), 'Back to the tour');
    await page.click('#b-concede');
    assert.equal(await screen(), 'home');
    assert.ok(await page.isHidden('#sheet-menu'));
    assert.ok(await page.isHidden('#b-continue'), 'Carry on offered for a finished game');
    assert.equal((await page.evaluate(() => window.fullHouse.progress)).played[0], 2, 'two games played, no extra loss');
  });

  await step('a finished game can be looked over, and its result opened again', async t => {
    const { page } = t;
    const result = () => page.isVisible('#sheet-result .panel');
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    // The opponent holds dice on their last turn; once the game is over nothing is held.
    await lastTurn(t);
    await page.waitForFunction(() => window.fullHouse.game?.over, null, { timeout: 30000 });
    assert.equal(await page.locator('.die.held').count(), 0, 'dice are still held on a finished game');
    assert.deepEqual((await t.game()).held, [false, false, false, false, false]);
    // The button opens the result before it comes up by itself, and it doesn't then open a second time.
    assert.equal(await page.textContent('#b-roll'), 'See the result');
    await page.click('#b-roll');
    assert.ok(await result());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
    assert.equal(await result(), false, 'the result came up again by itself after it was closed');
    // Closed, the finished pad is there to read, and the button brings the result back: by Escape, and by the back button.
    for (const close of [() => page.keyboard.press('Escape'), () => page.goBack()]) {
      assert.ok(await page.isEnabled('#b-roll'));
      await page.click('#b-roll');
      assert.ok(await result(), 'the button did not open the result again');
      assert.match(await page.textContent('#result-title'), /You beat Pip/);
      await close();
      await page.waitForSelector('#sheet-result', { state: 'hidden' });
      assert.equal(await page.evaluate(() => document.body.dataset.screen), 'game');
    }
    // R and Space don't roll a finished game.
    await page.keyboard.press('r');
    assert.equal((await t.game()).over, true);
    assert.equal(await page.textContent('#b-roll'), 'See the result');
    // On to table 2, then Escape on its card: the result again. It counted once.
    await page.click('#b-roll');
    await page.click('#b-next');
    await page.waitForSelector('#sheet-intro:not([hidden])');
    await page.keyboard.press('Escape');
    assert.ok(await result(), 'Escape on the next table left no way on');
    assert.equal((await page.evaluate(() => window.fullHouse.progress)).played[0], 1);
    // Play this table again works from there.
    await page.click('#b-again');
    assert.equal(await result(), false);
    assert.equal((await t.game()).number, 1);
    assert.equal(await page.textContent('#b-roll'), 'Roll');
    assert.equal(await page.locator('.die.held').count(), 0);
  });

  await step('after you score, the line says what you scored and your dice stay yours until the opponent rolls', async ({ page, game, myTurn, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-roll');
    await settled();
    // Straight after the second tap, and for as long as the opponent hasn't rolled.
    const row = page.locator('tr.can').first();
    const label = await row.locator('th b').textContent();
    await row.click();
    const now = () => page.evaluate(() => ({ said: document.getElementById('status').textContent, red: document.getElementById('tray').classList.contains('theirs'), turn: window.fullHouse.game.turn, dice: window.fullHouse.game.dice.join('') }));
    const mine = (await game()).dice.join('');
    await row.click();
    const seen = [];
    for (let at = await now(); !/^Pip /.test(at.said); at = await now()) { seen.push(at); await page.waitForTimeout(50); }
    assert.ok(seen.length > 2, 'the opponent rolled at once');
    for (const at of seen) {
      assert.equal(at.turn, 'them');
      assert.match(at.said, new RegExp(`^You score \\d+ in ${label}\\.$`), 'the line after scoring');
      assert.equal(at.dice, mine);
      assert.equal(at.red, false, 'your own dice turned red before the opponent rolled');
    }
    // Once they roll, the dice are theirs: and after a reload part way through their turn as well.
    assert.ok((await now()).red, 'the opponent’s dice are not red');
    await page.reload();
    await page.waitForFunction(() => /^Pip /.test(document.getElementById('status').textContent));
    assert.ok((await now()).red, 'after a reload the opponent’s dice are not red');
    await myTurn();
    assert.equal((await now()).red, false);

    // Another five of a kind: the line gives the extra too.
    await page.evaluate(() => {
      const g = structuredClone(window.fullHouse.game);
      Object.assign(g.you, { five: 50, f6: null });
      Object.assign(g, { dice: [6, 6, 6, 6, 6], rolls: 1, turn: 'you' });
      window.fullHouse.set(g);
    });
    await page.click('tr[data-box="f6"]');
    await page.click('tr[data-box="f6"]');
    assert.equal((await now()).said, 'You score 30 in Sixes, plus 100 extra.');
  });

  await step('the dice have landed by the time their scores show, at either pace', async ({ page, myTurn }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    // The dice still moving at the moment something turns true, looked for every few milliseconds.
    const moving = when => page.evaluate(when => new Promise(resolve => {
      const test = new Function(`return ${when}`);
      const look = () => (test() ? resolve(document.getAnimations().filter(a => a.playState === 'running' && a.effect.target.closest('#tray')).length) : setTimeout(look, 4));
      look();
    }), when);
    for (const fast of [false, true]) {
      await page.evaluate(fast => { if (document.getElementById('o-fast').checked !== fast) document.getElementById('o-fast').click(); }, fast);
      const pace = fast ? 'with quick opponents' : 'at the usual pace';
      await myTurn();
      const offered = moving(`!!document.querySelector('#pad tr.can')`);
      await page.click('#b-roll');
      assert.equal(await offered, 0, `${pace}, the pad offers scores while your dice are still tumbling`);
      const said = moving(`/scores \\d+ in/.test(document.getElementById('status').textContent)`);
      await page.locator('tr.can').first().click();
      await page.locator('tr.can').first().click();
      assert.equal(await said, 0, `${pace}, the opponent's score is announced while their dice are still tumbling`);
    }
    // Asked for less motion, the dice don't tumble at all.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await myTurn();
    await page.click('#b-roll');
    await page.waitForTimeout(200);
    assert.equal(await moving('true'), 0, 'the dice tumble though less motion was asked for');
  });

  await step('a message sits over the bar, clear of the dice, and doesn’t outlast its game', async t => {
    const { page } = t;
    await page.evaluate(() => { window.fullHouse.settings.fast = true; window.fullHouse.start(7); });
    // The longest one there is, on a small phone, a phone, a phone held sideways and a desktop.
    for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1280, 800]]) {
      await page.setViewportSize({ width, height });
      const m = await page.evaluate(async () => {
        const toast = document.getElementById('toast');
        toast.textContent = 'The Dealer rolls another five of a kind: 100 extra points.';
        toast.hidden = false;
        await Promise.all(toast.getAnimations().map(a => a.finished)); // once it has dropped into place
        const r = toast.getBoundingClientRect(), out = { top: r.top, bottom: r.bottom, left: r.left, right: r.right, tray: document.getElementById('tray').getBoundingClientRect().top };
        // It lies over the bar's buttons on a small phone, and a tap on one still reaches it.
        out.blocks = ['b-home', 'b-menu'].filter(id => {
          const b = document.getElementById(id).getBoundingClientRect(), x = b.left + b.width / 2;
          return [b.top + 4, b.top + b.height / 2].some(y => !document.getElementById(id).contains(document.elementFromPoint(x, y)));
        });
        toast.hidden = true;
        return out;
      });
      assert.ok(m.bottom <= m.tray, `at ${width} x ${height} a message reaches ${m.bottom}px, over the dice tray at ${m.tray}px`);
      assert.ok(m.top >= 0 && m.left >= 0 && m.right <= width, `at ${width} x ${height} a message runs off the screen`);
      assert.deepEqual(m.blocks, [], `at ${width} x ${height} a message takes the taps meant for the bar's buttons`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    // Five of a kind on the last turn: its message is gone by the time the result is up.
    await page.evaluate(() => {
      const g = structuredClone(window.fullHouse.game);
      for (const b of g.board.boxes) { g.you[b.id] = b.id === 'five' ? null : 20; g.them[b.id] = b.id === 'five' ? null : 5; }
      Object.assign(g, { number: 13, rolls: 1, turn: 'you', dice: [6, 6, 6, 6, 6] });
      window.fullHouse.set(g);
    });
    await page.click('tr[data-box="five"]');
    await page.click('tr[data-box="five"]');
    assert.equal(await page.textContent('#toast'), 'Five of a kind.');
    assert.ok(await page.isVisible('#toast'));
    await page.waitForFunction(() => /rolls\.$/.test(document.getElementById('status').textContent));
    await page.click('#tray'); // hurry them along, so the result comes while the message would still be up
    await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
    assert.ok(await page.isHidden('#toast'), 'a message from the game is still up over its result');
    // And a message doesn't carry into a new game.
    await page.click('#b-tour');
    await page.evaluate(() => window.fullHouse.start(0));
    await page.click('#b-menu');
    await page.click('#b-concede');
    await page.click('#b-concede');
    assert.ok(await page.isVisible('#toast'));
    await page.click('[data-quick="0"]');
    assert.ok(await page.isHidden('#toast'), 'the message about the last game is up over the new one');
    // Asked for less motion, messages and sheets appear without sliding in.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.click('#b-menu');
    await page.click('#b-concede');
    await page.click('#b-concede');
    await page.click('#b-rules');
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'something still slides in though less motion was asked for');
  });

  await step('everything the opponent has is in red pencil: bonus, extra fives, and the result', async t => {
    const { page } = t;
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.evaluate(() => {
      const g = structuredClone(window.fullHouse.game);
      for (const b of g.board.boxes) { g.you[b.id] = b.id === 'chance' ? null : 20; g.them[b.id] = b.id === 'chance' ? null : 12; }
      g.you.extras = g.them.extras = 1;
      Object.assign(g, { number: 13, rolls: 1, turn: 'you' });
      window.fullHouse.settings.fast = true;
      window.fullHouse.set(g);
    });
    const ink = sel => page.evaluate(sel => getComputedStyle(document.querySelector(sel)).color, sel);
    const red = await ink('#pad tfoot td.them'), black = await ink('#pad tfoot td.you');
    assert.notEqual(red, black);
    for (const row of ['Bonus', 'Extra fives']) {
      const cells = page.locator('#pad tr.sub', { hasText: row }).locator('td');
      assert.match(await cells.nth(1).textContent(), /^\d+$/);
      assert.equal(await cells.nth(0).evaluate(td => getComputedStyle(td).color), black, `your ${row}`);
      assert.equal(await cells.nth(1).evaluate(td => getComputedStyle(td).color), red, `the opponent's ${row} is not in red pencil`);
    }
    // The result: their number in red, and readable on its tile, light and dark.
    await page.click('tr[data-box="chance"]');
    await page.click('tr[data-box="chance"]');
    await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      const c = await page.evaluate(() => {
        const rgb = s => s.match(/[\d.]+/g).map(Number);
        const b = document.querySelector('#result-scores div:last-child b'), yours = document.querySelector('#result-scores div:first-child b');
        const [r, g, bl, a = 1] = rgb(getComputedStyle(b.parentElement).backgroundColor), under = rgb(getComputedStyle(document.querySelector('#sheet-result .panel')).backgroundColor);
        const tile = [r, g, bl].map((v, i) => v * a + under[i] * (1 - a));
        const lum = c => { const [x, y, z] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * x + 0.7152 * y + 0.0722 * z; };
        const l1 = lum(rgb(getComputedStyle(b).color).slice(0, 3)), l2 = lum(tile);
        return { same: getComputedStyle(b).color === getComputedStyle(yours).color, contrast: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) };
      });
      assert.equal(c.same, false, `${colorScheme}: the opponent's score on the result is in your ink`);
      assert.ok(c.contrast >= 4.5, `${colorScheme}: the opponent's score on the result has a contrast of ${c.contrast.toFixed(2)}`);
    }
  });

  await step('the wording: a box that scores nothing, who you’re playing, and a loss', async t => {
    const { page } = t;
    await page.evaluate(() => window.fullHouse.start(3)); // Two Rolls, against Sol
    await page.click('#b-menu');
    assert.equal(await page.textContent('#menu-twist'), `${await page.evaluate(() => window.fullHouse.game.board.blurb)} Against Sol. Quick hands. Loves a big Chance.`);
    await page.keyboard.press('Escape');
    // A box the dice score nothing in is written in, not scored.
    await page.evaluate(() => {
      const g = structuredClone(window.fullHouse.game);
      for (const b of g.board.boxes) { g.you[b.id] = b.id === 'large' || b.id === 'chance' ? null : 1; g.them[b.id] = b.id === 'chance' ? null : 20; }
      Object.assign(g, { number: 12, rolls: 1, turn: 'you', dice: [2, 2, 2, 3, 3] });
      window.fullHouse.settings.fast = true;
      window.fullHouse.set(g);
    });
    await page.click('tr[data-box="large"]');
    assert.equal(await page.textContent('#status'), 'Tap Large straight again to write in a 0.');
    await page.click('tr[data-box="chance"]');
    assert.equal(await page.textContent('#status'), 'Tap Chance again to score 12.');
    // Lose, and the line doesn't ask what the button under it already offers.
    await page.click('tr[data-box="large"]');
    await page.click('tr[data-box="large"]');
    assert.equal(await page.textContent('#status'), 'You score 0 in Large straight.');
    await page.click('#tray');
    await t.myTurn();
    await page.click('#b-roll');
    await t.settled();
    await page.click('tr[data-box="chance"]');
    await page.click('tr[data-box="chance"]');
    await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
    assert.equal(await page.textContent('#result-title'), 'Sol wins');
    assert.equal(await page.textContent('#result-line'), 'The dice owe you one.');
    assert.equal(await page.textContent('#b-next'), 'Play again');
  });

  await step('a tie says so, and counts as a game played but not won', async ({ page }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    // The last turn is Pip's, from the game's seed: work out what Pip will score, and give yourself the same total.
    const total = await page.evaluate(async () => {
      const [{ Opponent, playTurn }, { TABLES }, R, { mulberry32 }] = await Promise.all(['./js/ai.js', './js/tour.js', './js/rules.js', './js/rng.js'].map(u => import(u)));
      const g = structuredClone(window.fullHouse.game);
      for (const b of g.board.boxes) { g.them[b.id] = b.id === 'chance' ? null : b.id === 'five' ? 0 : 5; g.you[b.id] = 0; }
      Object.assign(g, { number: 13, rolls: 0, turn: 'them' });
      const { option } = playTurn(new Opponent(TABLES[0].play), g.board, g.them, mulberry32((g.seed ^ Math.imul(13, 0x9E3779B1)) >>> 0));
      g.you.chance = R.totals(g.board, R.mark(g.them, option)).total;
      window.fullHouse.settings.fast = true;
      window.fullHouse.set(g);
      return g.you.chance;
    });
    await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
    assert.equal(await page.textContent('#result-title'), 'A tie');
    assert.equal(await page.textContent('#result-line'), 'Play it again to settle it.');
    assert.equal(await page.textContent('#result-scores'), `You${total}Pip${total}`);
    assert.equal(await page.textContent('#b-next'), 'Play again');
    assert.equal(await page.textContent('#status'), 'A tie.');
    const p = await page.evaluate(() => window.fullHouse.progress);
    assert.equal(p.played[0], 1);
    assert.ok(!p.won[0] && !p.beaten[0], 'a tie counted as a win');
  });

  await step('a second five of a kind says where it has to go and what it earns, in two lines on a small phone', async t => {
    const { page } = t;
    await page.setViewportSize({ width: 320, height: 568 });
    await page.evaluate(() => window.fullHouse.start(0));
    // Your turn at Classic with these dice rolled once, these boxes of yours filled, and the opponent from this seed and turn.
    const at = (you, dice = [4, 4, 4, 4, 4], more = {}, them = {}) => page.evaluate(([you, dice, more, them]) => {
      const g = structuredClone(window.fullHouse.game);
      for (const b of g.board.boxes) { g.you[b.id] = b.id in you ? you[b.id] : null; g.them[b.id] = b.id in them ? them[b.id] : null; }
      Object.assign(g, { number: 2, rolls: 1, turn: 'you', dice, held: [false, false, false, false, false] }, more);
      window.fullHouse.settings.fast = true;
      window.fullHouse.set(g);
    }, [you, dice, more, them]);
    const status = () => page.textContent('#status');
    const can = () => page.$$eval('tr.can', rows => rows.map(r => r.dataset.box));
    const lines = () => page.evaluate(() => { const e = document.getElementById('status'); return Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)); });
    // An ordinary roll, for the height of the line.
    await at({}, [1, 2, 3, 4, 6]);
    const ordinary = await page.evaluate(() => document.getElementById('status').getBoundingClientRect().height);
    const twoLines = async () => {
      assert.ok(await lines() <= 2, `the line runs to three lines: ${await status()}`);
      assert.equal(await page.evaluate(() => document.getElementById('status').getBoundingClientRect().height), ordinary, 'the line is a different height from an ordinary one');
    };

    // Fours is open: it has to go there, and the 100 extra shows before it's scored.
    await at({ five: 50 });
    assert.equal(await status(), 'Five of a kind again: 100 extra. It has to go in Fours.');
    assert.deepEqual(await can(), ['f4']);
    await twoLines();
    await page.click('tr[data-box="f4"]');
    assert.equal(await status(), 'Tap Fours again to score 20, plus 100 extra.');
    await page.click('tr[data-box="f4"]');
    assert.equal(await status(), 'You score 20 in Fours, plus 100 extra.');

    // Fours is filled: any box in the bottom section, where a full house and the straights count in full.
    await at({ five: 50, f4: 8 });
    assert.equal(await status(), 'Five of a kind again: 100 extra. Any bottom box: a full house or a straight counts in full.');
    assert.deepEqual(await can(), ['three', 'four', 'full', 'small', 'large', 'chance']);
    await twoLines();
    await page.click('tr[data-box="large"]');
    assert.equal(await status(), 'Tap Large straight again to score 40, plus 100 extra.');

    // The Five of a kind box crossed out with a 0: the same rules, with nothing extra.
    await at({ five: 0 });
    assert.equal(await status(), 'Five of a kind again. It has to go in Fours.');
    await page.click('tr[data-box="f4"]');
    assert.equal(await status(), 'Tap Fours again to score 20.');

    // Fours and the whole bottom section filled: a 0 in a top box.
    await at({ five: 50, f4: 8, three: 10, four: 0, full: 25, small: 30, large: 0, chance: 20 });
    assert.equal(await status(), 'Five of a kind again: 100 extra. Only top boxes are left: it scores 0 there.');
    assert.deepEqual(await can(), ['f1', 'f2', 'f3', 'f5', 'f6']);
    await twoLines();

    // The opponent's line says it too. (Pip rolls five 1s on turn 2 of the game with seed 2.)
    await at({}, [2, 3, 4, 5, 6], { seed: 2, turn: 'them' }, { five: 50 });
    await page.waitForFunction(() => /scores/.test(document.getElementById('status').textContent), null, { timeout: 15000 });
    assert.equal(await status(), 'Pip scores 5 in Ones, plus 100 extra.');
  });

  await step('the result says when you’ve beaten your best at a table, and doesn’t open a table twice', async t => {
    const { page } = t;
    // A game at a table (null for a quick game) with every box but Chance worth `each` to you, played to its result.
    // The opponent's Five of a kind holds a 0, so a five of a kind on their last turn (about one game in twenty for
    // Pip) earns them no extra 100 to win a game the test means you to win.
    const play = async (table, each) => {
      await page.evaluate(([table, each]) => {
        window.fullHouse.settings.fast = true;
        window.fullHouse.start(table, table ?? 0);
        const g = structuredClone(window.fullHouse.game);
        for (const b of g.board.boxes) { g.you[b.id] = b.id === 'chance' ? null : each; g.them[b.id] = b.id === 'chance' ? null : b.id === 'five' ? 0 : 5; }
        Object.assign(g, { number: 13, rolls: 1, turn: 'you' });
        window.fullHouse.set(g);
      }, [table, each]);
      await page.click('tr[data-box="chance"]');
      await page.click('tr[data-box="chance"]');
      await page.click('#tray');
      await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
      return { line: await page.textContent('#result-line'), best: await page.isVisible('#result-best') ? await page.textContent('#result-best') : null, next: await page.textContent('#b-next'), you: +(await page.textContent('#result-scores div:first-child b')) };
    };
    // The first win at table 1: the next table opens, and there was no best to beat.
    const first = await play(0, 10);
    assert.equal(first.line, 'Table 2 is open: Evens, against Maud.');
    assert.equal(first.best, null);
    // A better win there: a new best, and table 2 isn't opened a second time.
    const better = await play(0, 20);
    assert.equal(better.line, 'You’ve beaten Pip before; table 2 is still open.');
    assert.equal(better.best, `Your best here: ${better.you} (was ${first.you}).`);
    assert.equal(better.next, 'On to table 2');
    // A lesser win, a loss and a quick game say nothing about a best. A loss with more than your best does.
    assert.equal((await play(0, 15)).best, null);
    const lost = await play(0, 0);
    assert.equal(lost.line, 'The dice owe you one.');
    assert.equal(lost.best, null);
    assert.equal((await play(null, 20)).best, null);
    await page.evaluate(() => { window.fullHouse.progress.best[0] = 3; });
    const close = await play(0, 0);
    assert.equal(close.line, 'The dice owe you one.');
    assert.equal(close.best, `Your best here: ${close.you} (was 3).`);
    assert.equal((await page.evaluate(() => window.fullHouse.progress)).best[0], close.you);
    // The last table, beaten a second time.
    await page.evaluate(() => { for (let i = 0; i < 8; i++) window.fullHouse.progress.beaten[i] = true; });
    const dealer = await play(7, 20);
    assert.equal(dealer.line, 'You’ve beaten The Dealer before. That’s still the whole tour.');
    assert.equal(dealer.next, 'Play again');
  });

  await step('giving up takes two taps, and the tour says what happened', async ({ page, game, settled }) => {
    const screen = () => page.evaluate(() => document.body.dataset.screen);
    const label = () => page.textContent('#b-concede');
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-roll');
    await settled();
    // One tap asks, and the game is still there.
    await page.click('#b-menu');
    assert.equal(await label(), 'Give up this game');
    await page.click('#b-concede');
    assert.equal(await label(), 'Tap again to give up. It counts as a loss.');
    assert.equal(await screen(), 'game');
    assert.equal((await game()).rolls, 1, 'one tap gave the game up');
    assert.equal((await page.evaluate(() => window.fullHouse.progress)).played[0], undefined, 'one tap counted the game');
    // Closing the menu takes the question back, however it's closed: the next tap asks again.
    for (const close of [() => page.click('#sheet-menu .close'), () => page.keyboard.press('Escape'), () => page.goBack()]) {
      await close();
      await page.waitForSelector('#sheet-menu', { state: 'hidden' });
      await page.click('#b-menu');
      assert.equal(await label(), 'Give up this game', 'the menu opened with giving up already asked');
      await page.click('#b-concede');
      assert.equal(await screen(), 'game');
      assert.ok(await game(), 'a tap after closing the menu gave the game up');
    }
    // The second tap gives up, and the tour says so.
    await page.click('#b-concede');
    assert.equal(await screen(), 'home');
    assert.equal(await game(), null);
    assert.equal((await page.evaluate(() => window.fullHouse.progress)).played[0], 1);
    assert.equal(await page.textContent('#toast'), 'You gave up at table 1. Pip takes that one.');
    assert.ok(await page.isVisible('#toast'));
    // A quick game has no table to name.
    await page.click('[data-quick="0"]');
    await page.click('#b-menu');
    assert.equal(await label(), 'Give up this game');
    await page.click('#b-concede');
    await page.click('#b-concede');
    assert.equal(await page.textContent('#toast'), 'You gave up. Pip takes that one.');
  });

  await step('giving up while the opponent writes a score leaves no trace in the next game', async ({ page, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-roll');
    await settled();
    await page.locator('tr.can').first().click();
    await page.locator('tr.can').first().click();
    // While "Pip scores N in X" shows, give up and start a quick game.
    await page.waitForFunction(() => {
      if (!/scores \d+ in/.test(document.getElementById('status').textContent)) return false;
      document.getElementById('b-menu').click();
      document.getElementById('b-concede').click();
      document.getElementById('b-concede').click();
      document.querySelector('[data-quick="0"]').click();
      return true;
    }, null, { polling: 20, timeout: 30000 });
    assert.equal(await page.textContent('#g-table'), 'Quick game');
    assert.equal(await page.locator('#pad td.them.offer').count(), 0, 'a score from the last game is pencilled in');
  });

  await step('reloading during the opponent’s turn plays the same turn again', async ({ page, game, myTurn, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-roll');
    await settled();
    await page.locator('tr.can').first().click();
    await page.locator('tr.can').first().click();
    // What the opponent is about to write in, and the dice it has: reload before it's written, and it comes out the same.
    const about = () => page.waitForFunction(() => {
      const said = document.getElementById('status').textContent;
      return /scores \d+ in/.test(said) && `${said} ${window.fullHouse.game.dice.join('')}`;
    }, null, { polling: 20, timeout: 30000 }).then(h => h.jsonValue());
    const before = await about();
    await page.reload();
    assert.equal(await about(), before, 'a reload gave the opponent another go at their turn');
    await myTurn();
    const them = Object.entries((await game()).them).filter(([id, v]) => id !== 'extras' && v !== null);
    assert.equal(them.length, 1, 'the opponent filled one box');
    assert.equal(them[0][1], +/scores (\d+) in/.exec(before)[1], 'the opponent wrote a different score from the one it said');
  });

  await step('with all five dice held there is nothing to roll', async ({ page, game, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-roll');
    await settled();
    for (let i = 0; i < 5; i++) await page.click(`.die >> nth=${i}`);
    assert.ok(await page.isDisabled('#b-roll'), 'Roll is on with every die held');
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press(' ');
    assert.equal((await game()).rolls, 1, 'a roll was used up with every die held');
    // Let one go and you can roll again.
    await page.click('.die >> nth=4');
    assert.ok(await page.isEnabled('#b-roll'));
  });

  await step('with a mouse, a picked box shows its amber fill', async ({ page, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-roll');
    await settled();
    const box = await page.locator('tr.can').first().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width / 2 + 2, box.y + box.height / 2); // the pointer rests on the picked row
    const fill = () => page.evaluate(() => getComputedStyle(document.querySelector('tr.picked th')).backgroundColor);
    assert.equal(await fill(), 'rgba(227, 168, 43, 0.38)', 'the picked row is grey under the pointer');

    // A box that scores three times over has a tint of its own, which picking it covers too.
    await page.evaluate(() => window.fullHouse.start(2));
    await page.click('#b-roll');
    await settled();
    await page.click('tr[data-box="f6"]');
    await page.mouse.move(0, 0);
    assert.equal(await fill(), 'rgba(227, 168, 43, 0.38)', 'a picked box at three times keeps its own tint');
  }, { desktop: true });

  await step('keyboard: R rolls wherever the focus is, and the browser keeps its shortcuts', async ({ page, game, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.evaluate(() => addEventListener('keydown', e => { window.kept = e.defaultPrevented; }));
    await page.keyboard.press('Control+r');
    assert.equal((await game()).rolls, 0, 'Ctrl+R rolled the dice');
    assert.equal(await page.evaluate(() => window.kept), false, 'Ctrl+R was kept from the browser');
    await page.keyboard.press('r');
    await settled();
    assert.equal((await game()).rolls, 1);
    await page.keyboard.press('Control+1');
    assert.equal((await game()).held[0], false, 'Ctrl+1 held a die');
    await page.click('.die >> nth=0'); // holds it, and the focus is on it now
    await page.keyboard.press('Shift+R');
    await settled();
    assert.equal((await game()).rolls, 2, 'R did nothing with a die focused');
  }, { desktop: true });

  await step('keyboard: Enter on a box picks it, and Enter again scores it', async ({ page, game, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.keyboard.press('r');
    await settled();
    await page.focus('tr.can >> nth=0'); // where Tab gets to after the dice and Roll
    const id = await page.evaluate(() => document.activeElement.dataset.box);
    await page.keyboard.press('Enter');
    assert.match(await page.textContent('#status'), /again to (score \d+|write in a 0)\.$/);
    await page.keyboard.press('Enter');
    const g = await game();
    assert.notEqual(g.you[id], null, 'the second Enter did not score the box');
    assert.equal(g.turn, 'them');
  }, { desktop: true });

  await step('with a mouse, Space still rolls after picking a box', async ({ page, game, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-roll');
    await settled();
    const row = page.locator('tr.can').first();
    const id = await row.getAttribute('data-box');
    await row.click(); // picked, to see what it would score
    assert.match(await page.textContent('#status'), /again to (score \d+|write in a 0)\.$/);
    await page.keyboard.press(' ');
    await settled();
    const g = await game();
    assert.equal(g.you[id], null, 'Space scored the box picked with the mouse');
    assert.equal(g.rolls, 2);
  }, { desktop: true });

  await step('keyboard: Tab stays inside an open sheet, and the focus comes back after', async ({ page }) => {
    await page.focus('[data-table="0"]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#sheet-intro:not([hidden])');
    const reached = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      reached.push(await page.evaluate(() => {
        const a = document.activeElement;
        return a === document.body || a.closest('#sheet-intro') ? '' : a.textContent.trim();
      }));
    }
    assert.deepEqual(reached.filter(Boolean), [], 'Tab reached the page behind the sheet');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.table), '0', 'the focus did not come back to table 1');
  }, { desktop: true });

  await step('the result of a finished game does not pop up over the next one', async t => {
    const { page } = t;
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await lastTurn(t);
    // As soon as the game is over, before its result shows: back to the tour and a quick game.
    await page.waitForFunction(() => {
      if (!window.fullHouse.game?.over) return false;
      document.getElementById('b-home').click();
      document.querySelector('[data-quick="0"]').click();
      return true;
    }, null, { polling: 20, timeout: 30000 });
    await page.waitForTimeout(1500);
    assert.ok(await page.isHidden('#sheet-result'), 'the last game’s result popped up over the new one');
    assert.equal(await page.textContent('#g-table'), 'Quick game');
  });

  await step('a damaged save opens on the tour, keeping what it can', async ({ page }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    const good = await page.evaluate(() => structuredClone(window.fullHouse.game));
    const load = async save => {
      await page.evaluate(s => localStorage.setItem('full-house.v1', s), JSON.stringify(save));
      await page.reload();
      return page.evaluate(() => document.body.dataset.screen);
    };
    // Progress with a part that isn't a list: the tour still shows.
    await load({ progress: { beaten: null, best: [250] } });
    assert.equal(await page.locator('#tables li').count(), 8);
    assert.equal(await page.locator('#people button').count(), 1);
    // A game with parts missing or out of range is dropped, and the progress kept.
    const progress = { beaten: [true], best: [250], played: [1], won: [1] };
    const broken = [{ table: 0, opp: 0, turn: 'you', number: 1, rolls: 0 }, {}, { ...good, opp: 99 }, { ...good, turn: 'them', you: null, them: null }, { ...good, dice: [0, 1, 2, 3, 4] }];
    for (const g of broken) {
      assert.equal(await load({ progress, game: g }), 'home');
      assert.ok(await page.isHidden('#b-continue'), `a damaged game is offered to carry on: ${JSON.stringify(g).slice(0, 50)}`);
      assert.match(await page.textContent('#tables li:nth-child(2)'), /Next up/);
    }
    // A whole game still picks up where it was.
    assert.equal(await load({ progress, game: good }), 'game');
  });

  await step('a new game’s dice show the numbers they’re read out as', async ({ page, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-roll');
    await settled();
    await page.click('#b-menu');
    await page.click('#b-concede');
    await page.click('#b-concede');
    await page.click('[data-quick="0"]');
    // Which face each cube is turned to show, from its rotation.
    const dice = await page.evaluate(() => [...document.querySelectorAll('.die')].map(b => {
      const [x, y] = b.querySelector('.cube').style.transform.match(/-?\d+/g).map(n => ((+n % 360) + 360) % 360);
      return [{ '0,0': 1, '0,270': 2, '270,0': 3, '90,0': 4, '0,90': 5, '0,180': 6 }[`${x},${y}`], +b.getAttribute('aria-label')];
    }));
    for (const [shown, read] of dice) assert.equal(shown, read, `a die shows ${shown} and is read out as ${read}`);
  });

  await step('the tour’s footer has the house line, then How to play', async ({ page }) => {
    assert.deepEqual(await page.locator('.jd-foot a, .jd-foot button').allTextContents(), ['Part of junkdrawer.works', 'Privacy', 'How to play']);
    await page.click('#b-rules');
    assert.ok(await page.isVisible('#sheet-rules .panel'));
  });

  await step('the small buttons are a thumb high: the footer’s links, the bar’s arrows, a sheet’s ×, the quick-game names', async ({ page }) => {
    const small = sel => page.evaluate(sel => [...document.querySelectorAll(sel)].filter(e => e.offsetParent).map(e => {
      const r = e.getBoundingClientRect();
      return { what: e.getAttribute('aria-label') || e.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) };
    }).filter(b => b.h < 44 || b.w < 44), sel);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => { document.body.dataset.screen = 'home'; });
      assert.equal(await page.locator('.jd-foot a, .jd-foot button, .people button').count(), 4);
      assert.deepEqual(await small('.jd-foot a, .jd-foot button, .people button'), [], `at ${width} wide, on the tour`);
      const foot = await page.evaluate(() => [...document.querySelectorAll('.jd-foot a, .jd-foot button')].map(e => e.getBoundingClientRect().top));
      assert.ok(foot.every(t => t === foot[0]), `at ${width} wide, the footer’s links take more than one line`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `at ${width} wide, the tour scrolls sideways`);
      await page.evaluate(() => window.fullHouse.start(6)); // Pairs and the Low Road, the longest name in the bar
      assert.deepEqual(await small('.bar button'), [], `at ${width} wide, in the game’s bar`);
      await page.click('#b-menu');
      assert.deepEqual(await small('#sheet-menu .close'), [], `at ${width} wide, in the menu`);
      await page.click('#sheet-menu .close');
    }
  });

  await step('the browser’s bar is the colour of the table, light and dark', async ({ page }) => {
    const colours = () => page.evaluate(async () => ({
      bar: [...document.querySelectorAll('meta[name="theme-color"]')].find(m => matchMedia(m.media).matches)?.content,
      table: getComputedStyle(document.documentElement).getPropertyValue('--table').trim(),
      manifest: await (await fetch(document.querySelector('link[rel="manifest"]').href)).json(),
    }));
    const light = await colours();
    assert.equal(light.bar, light.table, 'in light, the browser’s bar is not the table’s colour');
    assert.equal(light.manifest.theme_color, light.table, 'an installed game’s bar is not the table’s colour');
    assert.equal(light.manifest.background_color, light.table, 'an installed game opens on another colour than the table’s');
    await page.emulateMedia({ colorScheme: 'dark' });
    const dark = await colours();
    assert.notEqual(dark.table, light.table, 'the table has no dark colour');
    assert.equal(dark.bar, dark.table, 'in dark, the browser’s bar is not the table’s colour');
  });

  await step('a quick game asks first when it would end the game you’re in', async ({ page, game }) => {
    const progress = () => page.evaluate(() => window.fullHouse.progress);
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-home');
    await page.click('[data-quick="0"]');
    await page.waitForSelector('#sheet-intro:not([hidden])');
    assert.equal(await page.textContent('#intro-n'), 'Quick game');
    assert.equal(await page.textContent('#intro-title'), 'Classic');
    assert.match(await page.textContent('#intro-who'), /Pip.*Sitting down here ends the game you’re in\./);
    // Not yet: the game at table 1 carries on, and nothing is counted.
    await page.click('#sheet-intro [data-close].plain');
    assert.equal(await page.evaluate(() => document.body.dataset.screen), 'home');
    assert.equal((await game()).table, 0, 'the tour game was ended');
    assert.equal((await progress()).played[0], undefined, 'a game was counted');
    // Sit down: that game counts as a loss, as it would for a table on the tour, and the quick game starts.
    await page.click('[data-quick="0"]');
    await page.click('#b-sit');
    assert.equal(await page.textContent('#g-table'), 'Quick game');
    assert.equal((await game()).table, null);
    assert.equal((await progress()).played[0], 1);
  });

  await step('How to play is in the game’s menu, and closing it goes back to the game', async ({ page }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    const focused = () => page.evaluate(() => document.activeElement.id);
    await page.click('#b-menu');
    await page.click('#b-menu-rules');
    assert.ok(await page.isVisible('#sheet-rules .panel'), 'How to play did not open');
    assert.ok(await page.isHidden('#sheet-menu'), 'the menu stayed open under How to play');
    await page.keyboard.press('Escape');
    assert.ok(await page.isHidden('#sheet-rules'));
    assert.equal(await page.evaluate(() => document.body.dataset.screen), 'game');
    assert.equal(await focused(), 'b-menu', 'the focus did not come back to the menu button');
    // The same when a tap moves no focus on the way, as in Safari: the menu opened from the table's name this time.
    await page.evaluate(() => { document.activeElement.blur(); document.getElementById('b-where').click(); });
    await page.evaluate(() => document.getElementById('b-menu-rules').click());
    await page.click('#sheet-rules .close');
    assert.equal(await focused(), 'b-menu', 'the focus was lost after How to play from the menu');
  });

  await step('How to play tells the table’s own rules from a game, and the boxed game’s from the tour', async ({ page }) => {
    const sheet = () => page.$$eval('#rules-list li', l => l.map(li => li.textContent));
    const fromGame = async table => {
      await page.evaluate(table => window.fullHouse.start(table), table);
      await page.click('#b-menu');
      await page.click('#b-menu-rules');
      const text = await sheet();
      await page.keyboard.press('Escape');
      return text;
    };
    // From the tour: the classic numbers, and a word that tables change them.
    await page.click('#b-rules');
    let text = await sheet();
    await page.keyboard.press('Escape');
    assert.match(text.join(' '), /Reach 63 across the six boxes for a 35-point bonus \(three of each number gets you there\)/);
    assert.match(text.join(' '), /You get three rolls\./);
    assert.equal(text.at(-1), 'Some tables change these; each says how when you sit down.');
    assert.ok(!text.some(t => t.startsWith('At this table')));
    // The joker rules as options() plays them, the cases a zeroed box or a full bottom section leave included.
    assert.ok(text.includes('Once the Five of a kind box is filled, another five of a kind has to go in its own number’s box if that’s open. If not, it goes in any open box in the bottom section, where a full house or a straight counts in full. If the bottom is full too, it scores 0 in a top box. It also earns 100 extra, unless the Five of a kind box holds a 0.'), text.join('\n'));

    // Evens: its twist first, and the bonus at 72, with nothing about 63 or three of each.
    text = await fromGame(1);
    assert.equal(text[0], `At this table: ${await page.evaluate(() => window.fullHouse.game.board.blurb)}`);
    assert.match(text.join(' '), /Reach 72 across the six boxes for a 35-point bonus\./);
    assert.ok(!/63|three of each/.test(text.join(' ')), text.join('\n'));
    assert.ok(!text.includes('Some tables change these; each says how when you sit down.'));
    // Two Rolls: two rolls. High Stakes: four, and the bottom section at double.
    assert.match((await fromGame(3)).join(' '), /You get two rolls\./);
    text = (await fromGame(7)).join(' ');
    assert.match(text, /You get four rolls\./);
    assert.match(text, /Full house, three of one number and two of another: 50\. Small straight, four in a row: 60\. Large straight, five in a row: 80\. Five of a kind: 100\./);
    assert.match(text, /the total of all five dice, doubled/);
    // Hot Boxes: which two boxes are hot this time, and the bonus they make.
    text = await fromGame(5);
    const hot = await page.evaluate(() => window.fullHouse.game.board);
    const names = hot.boxes.filter(b => b.mult > 1).map(b => ({ f1: 'Ones', f2: 'Twos', f3: 'Threes', f4: 'Fours', f5: 'Fives', f6: 'Sixes', three: 'Three of a kind', four: 'Four of a kind', full: 'Full house', small: 'Small straight', large: 'Large straight', chance: 'Chance' })[b.id]);
    assert.ok(text[0].endsWith(` This time it’s ${names.join(' and ')}.`), text[0]);
    assert.match(text.join(' '), new RegExp(`Reach ${hot.bonus.at} across the six boxes for a 35-point bonus \\(three of each number gets you there\\)`));
  });

  await step('a phone held sideways has the pad beside the dice, with room to read it', async ({ page, settled }) => {
    await page.evaluate(() => window.fullHouse.start(7)); // High Stakes, whose ×2 badges make the widest pad
    await page.click('#b-roll');
    await settled();
    for (const [width, height] of [[844, 390], [667, 375]]) {
      await page.setViewportSize({ width, height });
      const m = await page.evaluate(() => {
        const box = s => { const r = document.querySelector(s).getBoundingClientRect(); return { left: r.left, right: r.right }; };
        const tray = box('.tray');
        return {
          tray, pad: box('.pad'), window: document.querySelector('.pad-wrap').clientHeight,
          diceIn: [...document.querySelectorAll('.die')].every(d => { const r = d.getBoundingClientRect(); return r.left >= tray.left && r.right <= tray.right; }),
          sideways: document.documentElement.scrollWidth > innerWidth,
        };
      });
      assert.ok(m.tray.right <= m.pad.left, `at ${width} x ${height} the pad is under the dice, not beside them`);
      assert.ok(m.window >= 300, `at ${width} x ${height} the pad shows only ${m.window}px at a time`);
      assert.ok(m.diceIn, `at ${width} x ${height} the dice spill out of the tray`);
      assert.equal(m.sideways, false, `at ${width} x ${height} the page scrolls sideways`);
    }
  }, { viewport: { width: 844, height: 390 } });

  await step('the Dealer’s name fits on one line of the pad, and a box marked ×2 is no taller than any other', async ({ page }) => {
    const sizes = table => page.evaluate(table => {
      window.fullHouse.start(table);
      const box = s => document.querySelector(s).getBoundingClientRect();
      return {
        head: Math.round(box('.pad thead').height), row: Math.round(box('tr[data-box="four"]').height), pad: Math.round(box('.pad').height),
        label: box('tr[data-box="three"] th b').height, you: box('.pad thead .you').width, them: box('.pad thead .them').width,
        sideways: document.documentElement.scrollWidth > innerWidth,
      };
    }, table);
    for (const width of [320, 360, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const classic = await sizes(0), high = await sizes(7);
      assert.equal(high.head, classic.head, `at ${width} wide, The Dealer takes two lines of the pad’s heading`);
      assert.equal(high.row, classic.row, `at ${width} wide, a box marked ×2 is taller than a plain one`);
      assert.equal(high.pad, classic.pad, `at ${width} wide, the pad is taller at High Stakes than at Classic`);
      assert.ok(high.label < 20, `at ${width} wide, Three of a kind and its ×2 take two lines`);
      assert.equal(high.you, high.them, `at ${width} wide, the two score columns are different widths`);
      assert.equal(high.sideways, false, `at ${width} wide, the page scrolls sideways`);
    }
  });

  await step('the Total stays in view at the foot of the pad while the boxes scroll under it', async ({ page, settled }) => {
    await page.evaluate(() => window.fullHouse.start(0));
    await page.click('#b-roll');
    await settled();
    // Where the Total is, what a tap in the middle of it lands on, and whether any box shows through below it.
    const look = () => page.evaluate(() => {
      const wrap = document.querySelector('.pad-wrap'), w = wrap.getBoundingClientRect();
      const t = document.querySelector('.pad tfoot th').getBoundingClientRect(), last = document.querySelector('.pad tbody:last-of-type tr:last-child').getBoundingClientRect();
      const at = y => document.elementFromPoint(t.left + 30, y)?.closest('.pad tr');
      let below = false;
      for (let y = t.bottom + 2; y < Math.min(w.bottom, innerHeight) - 1; y += 2) if (at(y)) below = true;
      return {
        inView: t.top >= w.top && t.bottom <= w.bottom + 0.5 && t.bottom <= innerHeight + 0.5, tapped: at(t.top + t.height / 2)?.className, below,
        gap: t.top - last.bottom, more: wrap.scrollHeight - wrap.clientHeight, scrollTop: wrap.scrollTop,
      };
    });
    for (const [width, height] of [[360, 640], [390, 664], [320, 568], [844, 390]]) {
      await page.setViewportSize({ width, height });
      const size = `at ${width} x ${height}`;
      await page.evaluate(() => { document.querySelector('.pad-wrap').scrollTop = 0; });
      let m = await look();
      assert.ok(m.more > 40, `${size} the whole pad fits, so this checks nothing`);
      assert.ok(m.inView, `${size} the Total is out of view with the pad at its top`);
      assert.equal(m.tapped, 'total', `${size} something lies over the Total`);
      assert.equal(m.below, false, `${size} boxes show below the Total`);
      // Half way down, the same.
      await page.evaluate(() => { const w = document.querySelector('.pad-wrap'); w.scrollTop = (w.scrollHeight - w.clientHeight) / 2; });
      m = await look();
      assert.ok(m.inView && m.tapped === 'total' && !m.below, `${size} the Total is not at the foot of the pad half way down`);
      // At the end the Total is where it's printed, straight after the last box, which it doesn't cover.
      await page.evaluate(() => { document.querySelector('.pad-wrap').scrollTop = 9999; });
      m = await look();
      assert.ok(m.inView, `${size} the Total is out of view with the pad at its end`);
      assert.ok(Math.abs(m.gap) < 1, `${size} the Total is ${m.gap}px from the last box with the pad at its end`);
    }
    // On a tall phone the whole pad fits and nothing scrolls.
    await page.setViewportSize({ width: 412, height: 915 });
    const m = await look();
    assert.equal(m.more, 0, 'on a tall phone the pad does not fit');
    assert.ok(m.inView && Math.abs(m.gap) < 1, 'on a tall phone the Total is not where it is printed');
  });

  await step('the pad’s small print is big enough to read, on one line, in rows no taller for it', async ({ page, settled }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    // The longest hints (Two pairs; a hot box three times over, on a board with every box hot), the Dealer's wider
    // columns and doubled hints, a raised bonus line, wild ones, and triple sixes.
    for (const table of [6, 7, 5, 'all hot', 4, 2]) {
      await page.evaluate(table => {
        if (table !== 'all hot') { window.fullHouse.start(table); return; }
        window.fullHouse.start(5);
        const g = structuredClone(window.fullHouse.game);
        g.board.boxes.forEach(b => { b.mult = 3; });
        window.fullHouse.set(g);
      }, table);
      await page.click('#b-roll');
      await settled();
      await page.click('.die >> nth=0');
      const m = await page.evaluate(() => {
        const px = (s, p = 'fontSize') => parseFloat(getComputedStyle(document.querySelector(s))[p]);
        const hints = [...document.querySelectorAll('.pad th[scope="row"] small')];
        return {
          hint: px('.pad th[scope="row"] small'), held: px('.held-tag'), progress: px('.pad .sub td small'),
          colour: getComputedStyle(hints[0]).color,
          twoLines: hints.filter(e => e.getBoundingClientRect().height > 16 || e.scrollWidth > e.clientWidth).map(e => e.textContent),
          rows: [...document.querySelectorAll('.pad tbody:last-of-type tr[data-box]')].slice(1).map(r => r.getBoundingClientRect().height),
          bonus: document.querySelector('.pad tr.sub').getBoundingClientRect().height,
          sideways: document.documentElement.scrollWidth > innerWidth,
        };
      });
      assert.ok(m.hint >= 12.5, `a box’s hint is ${m.hint}px`);
      assert.ok(m.held >= 12, `the HELD tag is ${m.held}px`);
      assert.ok(m.progress >= 13, `the bonus so far is ${m.progress}px`);
      assert.match(m.colour, /^rgb\(/, 'a box’s hint is see-through');
      const at = typeof table === 'number' ? `table ${table + 1}` : 'a board with every box hot';
      assert.deepEqual(m.twoLines, [], `at ${at}, 320 wide, a hint doesn’t fit on its line`);
      assert.ok(m.rows.every(h => h <= 36.5), `at ${at} a row with a hint is taller than 36px: ${m.rows}`);
      assert.ok(m.bonus <= 34.5, `at ${at} the bonus row is ${m.bonus}px tall`);
      assert.equal(m.sideways, false, `at ${at}, 320 wide, the page scrolls sideways`);
    }
  });

  await step('on a shorter phone things sit closer together, so the whole pad fits under the dice', async ({ page, ctx, settled }) => {
    const look = () => page.evaluate(() => {
      const box = s => document.querySelector(s).getBoundingClientRect();
      const wrap = document.querySelector('.pad-wrap'), tray = box('.tray');
      return {
        over: wrap.scrollHeight - wrap.clientHeight, roll: box('.roll').height, row: Math.round(box('tr[data-box="full"]').height),
        barTop: box('.bar').top, padBottom: box('.pad').bottom, statusBottom: box('.status').bottom, actionsTop: box('.actions').top,
        tagsInFelt: [...document.querySelectorAll('.die.held .held-tag')].every(t => t.getBoundingClientRect().bottom <= tray.bottom - 8.5),
        diceInTray: [...document.querySelectorAll('.die')].every(d => d.getBoundingClientRect().top >= tray.top && d.getBoundingClientRect().bottom <= tray.bottom),
      };
    });
    // Mid-turn, two dice held and the two-line hint showing, at Classic and at High Stakes.
    const sit = async table => {
      await page.evaluate(table => window.fullHouse.start(table), table);
      await page.click('#b-roll');
      await settled();
      await page.click('.die >> nth=0');
      await page.click('.die >> nth=3');
      await page.waitForTimeout(600); // the held dice have risen
    };
    for (const table of [0, 7]) {
      await sit(table);
      // 390 x 763 is what a 390 x 844 phone has left with the game installed; 393 x 759, the same for a 393 x 852 one.
      for (const [width, height] of [[390, 763], [393, 759], [412, 780]]) {
        await page.setViewportSize({ width, height });
        const m = await look(), at = `at table ${table + 1}, ${width} x ${height},`;
        assert.equal(m.over, 0, `${at} the pad is ${m.over}px too tall to fit`);
        assert.ok(m.statusBottom <= m.actionsTop, `${at} the line runs into the Roll button`);
        assert.ok(m.tagsInFelt, `${at} HELD is on the tray's wooden edge`);
        assert.ok(m.diceInTray, `${at} the dice spill out of the tray`);
      }
      // Shorter still, it can't all fit, and the same holds for what's above the pad.
      for (const [width, height] of [[390, 664], [360, 640], [320, 568]]) {
        await page.setViewportSize({ width, height });
        const m = await look(), at = `at table ${table + 1}, ${width} x ${height},`;
        assert.ok(m.statusBottom <= m.actionsTop, `${at} the line runs into the Roll button`);
        assert.ok(m.tagsInFelt && m.diceInTray, `${at} the dice or HELD don't fit the tray`);
      }
      // Tall phones, a tablet, a phone held sideways and a desktop keep the roomier layout they had.
      for (const [width, height] of [[390, 844], [412, 915], [430, 932], [768, 1024], [844, 390], [1280, 800]]) {
        await page.setViewportSize({ width, height });
        const m = await look(), at = `at table ${table + 1}, ${width} x ${height},`;
        assert.equal(m.roll, 50, `${at} the Roll button is ${m.roll}px tall`);
        assert.equal(m.row, 36, `${at} a row with a hint is ${m.row}px tall`);
        assert.ok(m.tagsInFelt && m.diceInTray, `${at} the dice or HELD don't fit the tray`);
        if (height > width) assert.equal(m.over, 0, `${at} the pad is ${m.over}px too tall to fit`);
      }
    }
    // An installed game on a 390 x 844 phone: the screen is 844 tall, but a notch and a home bar take 81 of it.
    const cdp = await ctx.newCDPSession(page);
    let notch = true;
    try { await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, bottom: 34 } }); } catch { notch = false; }
    if (notch) {
      await page.setViewportSize({ width: 390, height: 844 });
      const m = await look();
      assert.ok(m.barTop >= 47, 'the bar is under the notch');
      assert.equal(m.over, 0, `under a notch and over a home bar, the pad is ${m.over}px too tall to fit`);
      assert.ok(m.padBottom <= 844 - 34, 'the pad runs under the home bar');
    } else console.log('    (this Chromium can’t pretend to have a notch: that part was skipped)');
  });

  await step('on a short phone the pad scrolls to the box the opponent scores in, and the page stays put', async ({ page, myTurn }) => {
    await page.evaluate(() => window.fullHouse.start(0));
    // The opponent's turn, with only these boxes left for them to score in, and the pad scrolled to its top or its end.
    const theirTurn = (open, scrollTop) => page.evaluate(([open, scrollTop]) => {
      const g = structuredClone(window.fullHouse.game);
      for (const b of g.board.boxes) { g.you[b.id] = b.id === 'three' ? null : 20; g.them[b.id] = open.includes(b.id) ? null : 5; }
      Object.assign(g, { number: 12, rolls: 0, turn: 'them' });
      window.fullHouse.settings.fast = true;
      window.fullHouse.set(g);
      document.querySelector('.pad-wrap').scrollTop = scrollTop;
    }, [open, scrollTop]);
    // Whether a box's row is in the pad's window, below its top edge and above the Total.
    const shown = id => page.evaluate(id => {
      const r = document.querySelector(`tr[data-box="${id}"]`).getBoundingClientRect(), w = document.querySelector('.pad-wrap').getBoundingClientRect();
      const total = document.querySelector('.pad tfoot th').getBoundingClientRect();
      return r.top >= w.top - 0.5 && r.bottom <= Math.min(w.bottom, total.top) + 0.5;
    }, id);
    const picked = async () => (await page.waitForFunction(() => document.querySelector('td.them.picked')?.closest('tr').dataset.box, null, { timeout: 30000 })).jsonValue();
    const pad = () => page.evaluate(() => document.querySelector('.pad-wrap').scrollTop);
    const pageMoved = () => page.evaluate(() => scrollY !== 0 || document.scrollingElement.scrollTop !== 0 || document.querySelector('.game').getBoundingClientRect().top !== 0);

    for (const [open, scrollTop, where] of [[['f1', 'f2'], 9999, 'above'], [['five', 'chance'], 0, 'below'], [['f4', 'f5'], 9999, 'above']]) {
      await theirTurn(open, scrollTop);
      const id = await picked();
      assert.ok(open.includes(id));
      // It glides there, so give it a moment; the score is written in meanwhile, in the same row.
      await page.waitForFunction(id => {
        const r = document.querySelector(`tr[data-box="${id}"]`).getBoundingClientRect(), w = document.querySelector('.pad-wrap').getBoundingClientRect();
        return r.top >= w.top - 0.5 && r.bottom <= Math.min(w.bottom, document.querySelector('.pad tfoot th').getBoundingClientRect().top) + 0.5;
      }, id, { timeout: 5000 }).catch(() => assert.fail(`the opponent scored in ${id}, ${where} what the pad was showing, and it stayed out of sight`));
      assert.equal(await pageMoved(), false, 'the page itself moved');
      // Your turn starts with the pad where that left it.
      await myTurn();
      await page.waitForTimeout(700);
      const at = await pad();
      assert.ok(await shown(id), `their score in ${id} went out of sight again`);
      if (id === 'f1') assert.equal(at, 0, 'the pad stopped just short of its top');
      await page.click('#b-roll');
      await page.waitForFunction(() => !window.fullHouse.busy);
      assert.equal(await pad(), at, 'the pad moved at the start of your turn');
    }

    // A box already in view moves nothing.
    await theirTurn(['five', 'chance'], 9999);
    await picked();
    await myTurn();
    await page.waitForTimeout(700);
    assert.equal(await pad(), await page.evaluate(() => { const w = document.querySelector('.pad-wrap'); return w.scrollHeight - w.clientHeight; }), 'the pad moved though the box was in view');

    // With less motion asked for, it's there at once.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await theirTurn(['f1', 'f2'], 9999);
    const id = await picked();
    await page.waitForTimeout(60);
    assert.ok(await shown(id), 'with less motion asked for, the box was not in view straight away');
    assert.equal(await pageMoved(), false, 'the page itself moved');
  }, { viewport: { width: 360, height: 640 } });

  await step('keyboard: a box picked while scrolled out of sight comes into view, and Tab stops clear of the Total', async ({ page, settled }) => {
    await page.setViewportSize({ width: 1280, height: 420 }); // a short window, where the pad scrolls beside the dice
    await page.evaluate(() => window.fullHouse.start(0));
    await page.keyboard.press('r');
    await settled();
    const shown = () => page.evaluate(() => {
      const r = document.activeElement.closest('tr[data-box]')?.getBoundingClientRect() || document.querySelector('tr.picked').getBoundingClientRect();
      const w = document.querySelector('.pad-wrap').getBoundingClientRect(), total = document.querySelector('.pad tfoot th').getBoundingClientRect();
      return r.top >= w.top - 0.5 && r.bottom <= Math.min(w.bottom, total.top) + 0.5;
    });
    // Tab from the Roll button through every box: each one it lands on is in view, not under the Total.
    await page.focus('#b-roll');
    for (let i = 0; i < 13; i++) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => document.activeElement.dataset.box);
      assert.ok(id, 'Tab left the pad early');
      await page.waitForTimeout(350);
      assert.ok(await shown(), `Tab reached ${id}, out of sight or under the Total`);
    }
    // The focus on Ones, the pad then scrolled to its end with the wheel, and Enter: the picked box comes back into view.
    await page.focus('tr.can[data-box="f1"]');
    await page.evaluate(() => { document.querySelector('.pad-wrap').scrollTop = 9999; });
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.querySelector('tr.picked')?.dataset.box), 'f1');
    await page.waitForFunction(() => document.querySelector('.pad-wrap').scrollTop === 0, null, { timeout: 5000 }).catch(() => assert.fail('Ones was picked out of sight and stayed there'));
    assert.equal(await page.evaluate(() => scrollY), 0, 'the page itself moved');
  }, { desktop: true });

  await step('a second copy open at the same time picks up what the other one saves', async t => {
    const { page, ctx } = t;
    const other = await ctx.newPage(), trouble = [];
    other.on('pageerror', e => trouble.push(e.message));
    await other.goto(base);
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('full-house.v1')));
    const until = (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 15000 });
    const gameIn = p => p.evaluate(() => window.fullHouse.game);

    // Beat Pip in one copy: the other copy's tour shows it, and the next thing it saves keeps it.
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await win(t);
    await until(other, () => /Next up/.test(document.querySelector('#tables li:nth-child(2)').textContent));
    await other.click('[data-quick="1"]'); // Maud, met by beating Pip; with no game going there, it starts at once
    assert.equal((await saved()).game.opp, 1, 'the quick game was not saved');
    assert.equal((await saved()).progress.beaten[0], true, 'the other copy saved over the win');
    // The first copy puts the new game in place of the last one's result.
    await until(page, () => document.getElementById('g-table').textContent === 'Quick game');
    assert.ok(await page.isHidden('#sheet-result'), 'the result of the last game stayed up over the new one');

    // A setting changed in one copy changes in the other.
    await other.click('#b-menu');
    await other.click('#o-hints');
    await until(page, () => !window.fullHouse.settings.hints && !document.getElementById('o-hints').checked);
    await other.keyboard.press('Escape');

    // A roll in one copy shows in the other, and carries on there, even part way through a turn in the first.
    await page.click('#b-roll');
    await t.settled();
    await until(other, g => JSON.stringify(window.fullHouse.game) === g && !window.fullHouse.busy, JSON.stringify(await gameIn(page)));
    await other.click('#b-roll');
    await until(other, () => !window.fullHouse.busy);
    await until(page, g => JSON.stringify(window.fullHouse.game) === g, JSON.stringify(await gameIn(other)));
    // But a save from behind a roll made here (a copy slow to save, say) doesn't take that roll back.
    const mine = await gameIn(page);
    await other.evaluate(g => {
      const s = JSON.parse(localStorage.getItem('full-house.v1'));
      localStorage.setItem('full-house.v1', JSON.stringify({ ...s, settings: { ...s.settings, hints: true }, game: { ...g, rolls: 1 } }));
    }, mine);
    await until(page, () => window.fullHouse.settings.hints); // that save has arrived
    assert.deepEqual(await gameIn(page), mine, 'a save a roll behind took back a roll');

    // Scoring a box in one copy: both play the opponent's turn, the same way, and come to turn 2.
    await page.locator('tr.can').first().click();
    await page.locator('tr.can').first().click();
    await t.myTurn();
    await until(other, () => window.fullHouse.game?.number === 2 && window.fullHouse.game.turn === 'you' && !window.fullHouse.busy);
    assert.deepEqual(await gameIn(other), await gameIn(page));

    // Both copies play the last turn of the game too, and it counts once.
    await lastTurn(t);
    await until(page, () => !window.fullHouse.game || window.fullHouse.game.over);
    await page.waitForTimeout(3000); // the other copy's turn would end a moment later
    assert.equal((await saved()).progress.quick.played, 1, 'the game was counted twice');
    assert.equal(await other.evaluate(() => window.fullHouse.progress.quick.played), 1);
    assert.equal(await other.evaluate(() => window.fullHouse.busy || !!window.fullHouse.game && !window.fullHouse.game.over), false, 'the other copy is still playing');
    assert.deepEqual(trouble, [], 'problems in the other copy');
  });

  await step('a second copy plays the opponent’s turn when the first closes part way through it', async ({ page, ctx, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.evaluate(() => { window.fullHouse.settings.fast = true; });
    const other = await ctx.newPage();
    await other.goto(base); // opens on the game in progress
    await page.click('#b-roll');
    await settled();
    await page.locator('tr.can').first().click();
    await page.locator('tr.can').first().click();
    await page.close(); // straight after scoring, before the opponent has played
    await other.waitForFunction(() => window.fullHouse.game?.number === 2 && window.fullHouse.game.turn === 'you' && !window.fullHouse.busy, null, { timeout: 15000 });
    const g = await other.evaluate(() => window.fullHouse.game);
    assert.equal(Object.values(g.them).filter(v => v !== null).length - 1, 1, 'the opponent filled one box');
  });

  await step('the back button closes a sheet, or goes from a game to the tour, and leaves from the tour', async t => {
    const { page } = t;
    await page.goto('about:blank'); // come from somewhere, so that leaving has somewhere to go
    await page.goto(base);
    // What's showing (the screen, and any sheet over it), and that the history holds an entry of the page's own for each.
    const at = (showing, entries) => page.waitForFunction(([showing, entries]) => {
      const now = document.body.dataset.screen + [...document.querySelectorAll('.sheet:not([hidden])')].map(s => ` + ${s.id}`).join('');
      return now === showing && (history.state?.fullHouse || 0) === entries;
    }, [showing, entries], { timeout: 10000 });
    const progress = () => page.evaluate(() => window.fullHouse.progress);

    // How to play on the tour: back closes it.
    await page.click('#b-rules');
    await at('home + sheet-rules', 1);
    await page.goBack();
    await at('home', 0);
    // A game, sat down to from down the tour: back goes to the tour, from the top, where the game waits under Carry on,
    // not given up and not counted.
    const scrolled = await page.evaluate(() => { scrollTo(0, document.body.scrollHeight); document.querySelector('[data-table="0"]').click(); return scrollY; });
    assert.ok(scrolled > 0);
    await page.click('#b-sit');
    await at('game', 1);
    await page.click('#b-roll');
    await t.settled();
    await page.goBack();
    await at('home', 0);
    assert.equal(await page.evaluate(() => scrollY), 0, 'back to the tour, it was scrolled down');
    assert.ok(await page.isVisible('#b-continue'), 'back gave the game up');
    assert.equal((await progress()).played[0], undefined, 'back counted the game');
    // Forward goes back into it.
    await page.goForward();
    await at('game', 1);
    assert.equal((await t.game()).rolls, 1);
    // In the game, back closes the menu and stays in the game.
    await page.click('#b-menu');
    await at('game + sheet-menu', 2);
    await page.goBack();
    await at('game', 1);
    // A sheet closed and another opened straight after, before the step back for the first has landed: the second stays.
    await page.click('#b-menu');
    await page.evaluate(() => { document.querySelector('#sheet-menu .close').click(); setTimeout(() => document.getElementById('b-menu').click()); });
    await page.waitForTimeout(500);
    await at('game + sheet-menu', 2);
    // A sheet closed on the page leaves nothing behind for back to close, so the next back goes to the tour.
    await page.click('#sheet-menu .close');
    await at('game', 1);
    await page.goBack();
    await at('home', 0);
    // The same after a reload with the menu open: the game shows, and back goes to the tour.
    await page.click('#b-continue');
    await page.click('#b-menu');
    await at('game + sheet-menu', 2);
    await page.reload();
    await at('game', 1);
    await page.goBack();
    await at('home', 0);
    // A game's result: back closes it, then goes to the tour, where the game is over.
    await page.click('#b-continue');
    await win(t);
    await at('game + sheet-result', 2);
    await page.goBack();
    await at('game', 1);
    await page.goBack();
    await at('home', 0);
    assert.ok(await page.isHidden('#b-continue'), 'Carry on offered for a finished game');
    assert.equal((await progress()).played[0], 1);
    // From the tour, back leaves.
    await page.goBack();
    assert.equal(page.url(), 'about:blank');
  });

  // The one-file copy that npm run build makes: built afresh, opened from the disk, and played to a result.
  const oneFile = 'the one-file copy from npm run build opens from the disk and plays a game to its end';
  if (oneFile.includes(only)) execSync('node scripts/build.mjs', { cwd: root, stdio: 'ignore' });
  await step(oneFile, async t => {
    const { page } = t;
    assert.equal(await page.evaluate(() => 'single' in document.documentElement.dataset), true, 'not the one-file copy');
    assert.equal(await page.locator('#tables li').count(), 8);
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await win(t);
    assert.match(await page.textContent('#result-title'), /You beat Pip/);
    assert.ok(await page.evaluate(() => [...document.fonts].some(f => f.family.includes('Barlow Condensed') && f.status === 'loaded')), 'its fonts did not load');
  }, { at: pathToFileURL(join(root, 'dist/full-house.html')).href });

  await step('a save stuck with both cards full on the opponent’s turn ends the game', async ({ page, myTurn }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    const stuck = async (theirs, yours) => {
      await page.evaluate(([theirs, yours]) => {
        const g = structuredClone(window.fullHouse.game);
        g.board.boxes.forEach((b, i) => { g.them[b.id] = i < theirs ? 5 : null; g.you[b.id] = i < yours ? 20 : null; });
        Object.assign(g, { number: 14, rolls: 3, turn: 'them' });
        localStorage.setItem('full-house.v1', JSON.stringify({ settings: { fast: true }, progress: window.fullHouse.progress, game: g }));
      }, [theirs, yours]);
      await page.reload();
    };
    // The opponent's card is full but yours isn't: it's your turn.
    await stuck(13, 11);
    await myTurn();
    // Both full: the game ends.
    await stuck(13, 13);
    await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 15000 });
    assert.match(await page.textContent('#result-title'), /You beat Pip/);
  });
} finally {
  // Offline, checked the junkdrawer house kit's way, from a server that answers like GitHub Pages: a browser may keep
// each file for ten minutes, and asks again by its ETag. `net` is the connection: 'up', 'down' (the server drops every
// connection) or 'stalled' (a plane's or a train's wifi: it takes each request and holds on to it). With `release`
// set it serves the next release. The server's own switches are needed because the browser's offline switch can't
// make a stall, and in some Chromium builds it doesn't stop the service worker's own requests.
{
  const { createServer } = await import('node:http');
  const { readFile } = await import('node:fs/promises');
  const { join, extname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { createHash } = await import('node:crypto');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
  let net = 'up', release = false;
  const held = [];
  const server = createServer((req, res) => {
    if (net === 'down') { req.socket.destroy(); return; }
    if (net === 'stalled') { held.push([req, res]); return; }
    serve(req, res);
  }).listen(0);
  async function serve(req, res) {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    let body;
    try { body = await readFile(join(root, path)); } catch { res.writeHead(404); res.end(); return; }
    if (release && path === '/sw.js') body = Buffer.from(String(body).replace(/const FILES = '[0-9a-f]*'/, "const FILES = 'next'"));
    if (release && path === '/index.html') body = Buffer.concat([body, Buffer.from('<!-- the next release -->\n')]);
    const etag = `"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
    const head = { etag, 'cache-control': 'max-age=600', 'content-type': TYPES[extname(path)] || 'text/html' };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, head); res.end(); return; }
    res.writeHead(200, head);
    res.end(body);
  }
  const base = `http://localhost:${server.address().port}/`;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 });
  const title = await page.title();

  // Works offline once it has been opened.
  net = 'down';
  await ctx.setOffline(true);
  await page.reload();
  assert.equal(await page.title(), title, 'the page did not open offline');
  await ctx.setOffline(false);

  // On a connection that's up but not answering, it opens from the copy too, after the worker's few seconds' wait for
  // the network: the page and every file it loads (were any of them left waiting on the network, it wouldn't open).
  net = 'stalled';
  const t0 = Date.now();
  await page.reload({ timeout: 10000 }).catch(() => {});
  const took = Date.now() - t0;
  assert.ok(took < 8000, `the page took ${took} ms to open on a stalled connection`);
  assert.equal(await page.title(), title, 'the page did not open on a stalled connection');
  net = 'up';
  for (const [req, res] of held.splice(0)) serve(req, res);

  // A new release: every file in the new copy comes from the server, though the browser still has its own copies of
  // the old ones for ten minutes. (The next release changes index.html, and so FILES in sw.js, as a real one does.)
  release = true;
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  for (const end = Date.now() + 10000; !(await page.evaluate(async () => !!(await (await caches.match('index.html'))?.text())?.includes('<!-- the next release -->')));) {
    assert.ok(Date.now() < end, "the new release's offline copy kept the old index.html");
    await new Promise(r => setTimeout(r, 100));
  }
  assert.deepEqual(problems, [], 'problems while offline or on a stalled connection');
  await ctx.close();
  server.close();

  // Every file the page loads is in SHELL, so the offline copy a release installs has all of it: what index.html links
  // to or loads, the fonts css/app.css uses, and every module the scripts import. (A file left out would still be
  // cached the first time it's fetched, so nothing above would notice; only an installed copy updating in the
  // background would be left without it.)
  {
    const sw = await readFile(join(root, 'sw.js'), 'utf8');
    const shell = new Set([...sw.match(/SHELL = \[([^\]]*)\]/)[1].replace(/\/\/.*/g, '').matchAll(/'([^']*)'/g)].map(m => m[1]));
    const html = await readFile(join(root, 'index.html'), 'utf8'), css = await readFile(join(root, 'css/app.css'), 'utf8');
    const local = u => !/^([a-z]+:|\/\/|#)/i.test(u);
    const loads = [
      ...[...html.matchAll(/\s(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(local),
      ...[...css.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)].map(m => m[1]).filter(local).map(u => new URL(u, 'http://x/css/').pathname.slice(1)),
    ];
    const { readdir } = await import('node:fs/promises');
    for (const f of (await readdir(join(root, 'js'))).filter(f => f.endsWith('.js'))) {
      const js = await readFile(join(root, 'js', f), 'utf8');
      loads.push(...[...js.matchAll(/^import [^;]*? from '([^']+)'/gm)].map(m => new URL(m[1], 'http://x/js/').pathname.slice(1)));
    }
    const missing = [...new Set(loads)].filter(f => !shell.has(f));
    assert.deepEqual(missing, [], `sw.js doesn't keep files the page loads: add them to SHELL`);
    assert.ok(loads.includes('js/rules.js') && loads.includes('fonts/caveat.woff2') && loads.includes('carry.js'), `the check found too little: ${loads}`);
  }

  // sw.js changes whenever a file it keeps does, so a release replaces the whole offline copy at once: FILES in sw.js
  // is a fingerprint of every file in SHELL (sha1 of each, in the list's order, an address like './' read as its
  // index.html; the first 8 hex of the sha1 of those).
  const sw = await readFile(join(root, 'sw.js'), 'utf8');
  const shell = [...sw.match(/SHELL = \[([^\]]*)\]/)[1].replace(/\/\/.*/g, '').matchAll(/'([^']*)'/g)].map(m => m[1]);
  const all = createHash('sha1');
  for (const f of shell) all.update(createHash('sha1').update(await readFile(join(root, f.endsWith('/') ? f + 'index.html' : f))).digest());
  const files = all.digest('hex').slice(0, 8);
  assert.equal(sw.match(/const FILES = '([0-9a-f]*)'/)?.[1], files, `a file sw.js keeps for offline has changed: set FILES in sw.js to '${files}'`);
}

await browser.close();
  server.close();
}
console.log('all good');
