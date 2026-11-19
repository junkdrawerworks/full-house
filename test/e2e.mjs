// Plays the game in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
// Give it part of a step's name to run only the steps that match:  node test/e2e.mjs tour
// (the offline checks at the end run only with no name given, or with offline:  node test/e2e.mjs offline)
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
    window.fullHouse.settings.pace = 'quick';
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
// Pip beaten at table 1, which a quick game waits for: on a fresh page, before anything else.
async function pipBeaten(page) {
  await page.evaluate(() => localStorage.setItem('full-house.v1', JSON.stringify({ progress: { beaten: [true] } })));
  await page.reload();
}

try {
  await step('a game through the tour', async ({ page, ctx, game, myTurn, settled }) => {
    // The tour: the first table open, the rest locked.
    assert.equal(await page.locator('#tables li').count(), 8);
    assert.match(await page.textContent('#tables li:nth-child(1)'), /Next up/);
    assert.equal(await page.locator('#tables li.locked').count(), 7);
    // No quick game until Pip is beaten, so the first game you win counts on the tour.
    assert.ok(await page.isHidden('#quick'), 'a quick game is offered before Pip is beaten');

    // Sit down at table 1.
    await page.click('[data-table="0"]');
    await page.waitForSelector('#sheet-intro:not([hidden])');
    assert.match(await page.textContent('#intro-title'), /Classic/);
    await page.click('#b-sit');
    assert.equal(await page.evaluate(() => document.body.dataset.screen), 'game');
    await page.evaluate(() => { window.fullHouse.settings.pace = 'quick'; });

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
      window.fullHouse.settings.pace = 'quick';
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
    assert.ok(await page.isVisible('#quick'), 'no quick game once Pip is beaten');
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
    await page.evaluate(() => { window.fullHouse.settings.pace = 'quick'; });
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
    // A tap straight after scoring, while the line still says what you scored and before they've rolled, counts too.
    await page.click('#b-roll');
    await settled();
    await page.locator('tr.can').first().click();
    await page.locator('tr.can').first().click();
    const t1 = Date.now();
    await page.touchscreen.tap(die.x + die.width / 2, die.y + die.height / 2);
    assert.match(await page.textContent('#status'), /^You score/, 'the tap came after they had started');
    await myTurn();
    assert.ok(Date.now() - t1 < 3000, `their turn took ${Date.now() - t1} ms after a tap straight after scoring`);
  });

  await step('the tour keeps up with a turn that ends behind it, and a message from the game stays with the game', async ({ page, myTurn }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    const banner = () => page.textContent('#b-continue span');
    // Five of a kind on turn 1, then straight to the tour while the opponent plays.
    await page.evaluate(() => {
      const g = structuredClone(window.fullHouse.game);
      Object.assign(g, { rolls: 1, dice: [6, 6, 6, 6, 6] });
      window.fullHouse.settings.pace = 'quick';
      window.fullHouse.set(g);
    });
    await page.click('tr[data-box="five"]');
    await page.click('tr[data-box="five"]');
    assert.ok(await page.isVisible('#toast'));
    await page.click('#b-home');
    assert.ok(await page.isHidden('#toast'), 'the game’s message came onto the tour');
    assert.equal(await banner(), 'Table 1: Classic, against Pip. Turn 1 of 13.');
    await myTurn();
    assert.equal(await banner(), 'Table 1: Classic, against Pip. Turn 2 of 13.', 'Carry on kept the turn you left on');
    // Their last turn, ending the game behind the tour: Carry on goes, and the result comes up over the tour.
    await page.click('#b-continue');
    await page.evaluate(() => {
      const g = structuredClone(window.fullHouse.game);
      for (const b of g.board.boxes) { g.you[b.id] = b.id === 'chance' ? null : 20; g.them[b.id] = b.id === 'chance' ? null : 5; }
      Object.assign(g, { number: 13, rolls: 1, turn: 'you' });
      window.fullHouse.set(g);
    });
    await page.click('tr[data-box="chance"]');
    await page.click('tr[data-box="chance"]');
    await page.click('#b-home');
    await page.waitForFunction(() => window.fullHouse.game?.over, null, { timeout: 30000 });
    assert.ok(await page.isHidden('#b-continue'), 'Carry on still offered for a game that ended behind the tour');
    assert.match(await page.textContent('#tables li:nth-child(2)'), /Next up/);
    await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 5000 });
  });

  await step('on a shorter phone a new game starts at the top of the pad, and carrying on keeps your place', async ({ page }) => {
    const pad = () => page.evaluate(() => document.querySelector('.pad-wrap').scrollTop);
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.evaluate(() => { document.querySelector('.pad-wrap').scrollTop = 9999; });
    const down = await pad();
    assert.ok(down > 40, 'the whole pad fits, so this checks nothing');
    await page.click('#b-home');
    await page.click('#b-continue');
    assert.equal(await pad(), down, 'Carry on lost your place on the pad');
    await page.click('#b-home');
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    assert.equal(await pad(), 0, 'a new game started with the pad scrolled down');
  }, { viewport: { width: 375, height: 667 } });

  await step('the tour shows the table you’re on, even near the end of it', async ({ page }) => {
    const next = () => page.evaluate(() => { const r = document.querySelector('#tables li.next').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
    await page.evaluate(() => localStorage.setItem('full-house.v1', JSON.stringify({ progress: { beaten: [true, true, true, true, true, true, true], best: [231, 247, 260, 240, 250, 255, 238], played: [1, 1, 1, 1, 1, 1, 1], won: [1, 1, 1, 1, 1, 1, 1] } })));
    await page.reload();
    let r = await next();
    assert.ok(r.top >= 0 && r.bottom <= 844, `with seven tables beaten, the Next up row is at ${r.top} to ${r.bottom}px in an 844px screen`);
    // Back from a game there, the same.
    await page.click('[data-table="7"]');
    await page.click('#b-sit');
    await page.click('#b-menu');
    await page.click('#b-concede');
    await page.click('#b-concede');
    r = await next();
    assert.ok(r.top >= 0 && r.bottom <= 844, `back from a game, the Next up row is at ${r.top} to ${r.bottom}px`);
    // With a game to carry on, the tour stays at the top, where Carry on is.
    await page.click('[data-table="7"]');
    await page.click('#b-sit');
    await page.click('#b-home');
    assert.equal(await page.evaluate(() => scrollY), 0, 'the tour scrolled away from Carry on');
  });

  await step('each table on the tour shows the games won and played there, and your best, at every width', async ({ page }) => {
    const line = n => page.textContent(`#tables li:nth-child(${n}) small`);
    // A fresh tour: nothing played, and no count under Quick game, which isn't offered yet.
    assert.equal(await line(1), 'Next up');
    assert.equal(await line(2), 'Locked');
    await page.evaluate(() => localStorage.setItem('full-house.v1', JSON.stringify({ progress: { beaten: [true, true], best: [231, 247, 142], played: [5, 13, 2], won: [2, 1, 0], quick: { played: 8, won: 3 } } })));
    await page.reload();
    assert.equal(await line(1), 'Beaten · won 2 of 5 · your best 231');
    assert.equal(await line(2), 'Beaten · won 1 of 13 · your best 247');
    assert.equal(await line(3), 'Next up · lost 2 · your best 142');
    assert.equal(await line(4), 'Locked');
    assert.equal(await page.textContent('#quick-record'), 'Won 3 of 8');
    // Giving up there is one more game played and not won.
    await page.click('[data-table="2"]');
    await page.click('#b-sit');
    await page.click('#b-menu');
    await page.click('#b-concede');
    await page.click('#b-concede');
    assert.equal(await line(3), 'Next up · lost 3 · your best 142');
    // On the narrowest phone each line still fits its row, wrapping rather than running off the card.
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 700 });
      const over = await page.evaluate(() => [...document.querySelectorAll('#tables li, #tables small, #quick-record')]
        .filter(el => el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().right > innerWidth).map(el => el.textContent.trim().slice(0, 40)));
      assert.deepEqual(over, [], `at ${width} wide, a line runs past its row`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `at ${width} wide the tour scrolls sideways`);
    }
  });

  await step('a locked table shows its card, its twist and its opponent, and what it takes to sit there', async ({ page, game }) => {
    // On a fresh tour: table 3's card, with Beat Maud to sit here in place of Sit down, and the focus on Not yet.
    await page.click('[data-table="2"]');
    await page.waitForSelector('#sheet-intro:not([hidden])');
    assert.equal(await page.textContent('#intro-n'), 'Table 3 of 8');
    assert.equal(await page.textContent('#intro-title'), 'Triple Sixes');
    assert.match(await page.textContent('#intro-blurb'), /^Sixes score three times over/);
    assert.equal(await page.textContent('#intro-who span'), 'Patient. Waits for the big numbers.');
    assert.equal(await page.textContent('#intro-locked'), 'Beat Maud to sit here');
    assert.ok(await page.isVisible('#intro-locked'));
    assert.ok(await page.isHidden('#b-sit'), 'a locked table offers Sit down');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Not yet');
    await page.keyboard.press('Escape');
    assert.equal(await game(), null, 'a locked table started a game');
    assert.ok(await page.isHidden('#sheet-intro'));
    // The Dealer's, from a game in progress at table 1: no warning that sitting down ends it, since you can't.
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-home');
    await page.click('[data-table="7"]');
    assert.equal(await page.textContent('#intro-locked'), 'Beat Wren to sit here');
    assert.doesNotMatch(await page.textContent('#intro-who'), /Sitting down/);
    await page.click('#sheet-intro .plain');
    // The table that's next is as it was: Sit down, and no word about beating anyone.
    await page.click('[data-table="0"]');
    assert.ok(await page.isVisible('#b-sit'));
    assert.ok(await page.isHidden('#intro-locked'));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'b-sit');
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
    // Closed, the finished pad is there to read, and the button brings the result back: by Look at the pad on the result,
    // by Escape, and by the back button. Put aside by its own button, the focus goes to See the result.
    for (const close of [() => page.click('#b-look'), () => page.keyboard.press('Escape'), () => page.goBack()]) {
      assert.equal(await page.getAttribute('#b-roll', 'aria-disabled'), 'false');
      await page.click('#b-roll');
      assert.ok(await result(), 'the button did not open the result again');
      assert.match(await page.textContent('#result-title'), /You beat Pip/);
      await close();
      await page.waitForSelector('#sheet-result', { state: 'hidden' });
      assert.equal(await page.evaluate(() => document.body.dataset.screen), 'game');
      assert.ok(await page.evaluate(() => !document.getElementById('game').inert), 'the pad is out of reach with the result put aside');
    }
    await page.click('#b-roll');
    await page.click('#b-look');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'b-roll', 'the focus did not go to See the result');
    // R and Space don't roll a finished game: they open its result, as the button does.
    await page.keyboard.press('r');
    assert.ok(await result(), 'R did not open the result');
    assert.equal((await t.game()).over, true);
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press(' ');
    assert.ok(await result(), 'Space did not open the result');
    assert.equal(await page.textContent('#b-roll'), 'See the result');
    // On to table 2, then Escape on its card: the result again. It counted once.
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

  await step('your turn says what the opponent just scored, and a game at Hot Boxes starts by naming its hot boxes', async ({ page, game, myTurn, settled }) => {
    const status = () => page.textContent('#status');
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.evaluate(() => { window.fullHouse.settings.pace = 'quick'; });
    assert.equal(await status(), 'Your turn. Roll the dice.');
    await page.click('#b-roll');
    await settled();
    await page.locator('tr.can').first().click();
    await page.locator('tr.can').first().click();
    await page.click('#tray');
    await myTurn();
    const [id, score] = Object.entries((await game()).them).find(([k, v]) => k !== 'extras' && v !== null);
    const line = `Your turn. Pip scored ${score} in ${await page.textContent(`tr[data-box="${id}"] th b`)}.`;
    assert.equal(await status(), line);
    // It's still there after a reload, and after the tour and Carry on; it goes once you roll.
    await page.reload();
    await myTurn();
    assert.equal(await status(), line, 'after a reload');
    await page.click('#b-home');
    await page.click('#b-continue');
    assert.equal(await status(), line, 'after Carry on');
    await page.click('#b-roll');
    await settled();
    assert.notEqual(await status(), line);

    // Hot Boxes, sat down to with seed 15: Fours and Sixes are hot, and the first line and the menu say so.
    const sit = (seed, hot) => page.evaluate(async ([seed, hot]) => {
      const { boardFor } = await import('./js/tour.js');
      window.fullHouse.start(5);
      const g = structuredClone(window.fullHouse.game);
      g.seed = seed;
      g.board = boardFor(5, seed);
      if (hot) g.board.boxes.forEach(b => { b.mult = hot.includes(b.id) ? 3 : 1; });
      window.fullHouse.set(g);
    }, [seed, hot]);
    await sit(15);
    assert.equal(await status(), 'Hot this time: Fours and Sixes. Roll the dice.');
    await page.click('#b-menu');
    assert.equal(await page.textContent('#menu-twist'), `${await page.evaluate(() => window.fullHouse.game.board.blurb)} This time it’s Fours and Sixes. Against Otto. Steady. Hardly puts a foot wrong.`);
    await page.keyboard.press('Escape');

    // The longest of these lines keep to two lines, as every status line does, on a small phone and a phone.
    const lines = () => page.evaluate(() => { const e = document.getElementById('status'); return Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)); });
    for (const [width, height] of [[320, 568], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await sit(15, ['three', 'small']);
      assert.equal(await status(), 'Hot this time: Three of a kind and Small straight. Roll the dice.');
      assert.ok(await lines() <= 2, `at ${width} x ${height}, the line runs to three lines: ${await status()}`);
      await page.evaluate(() => {
        window.fullHouse.start(7);
        const g = structuredClone(window.fullHouse.game);
        g.them.three = 60;
        Object.assign(g, { number: 2, last: { id: 'three', score: 60 } });
        window.fullHouse.set(g);
      });
      assert.equal(await status(), 'Your turn. The Dealer scored 60 in Three of a kind.');
      assert.ok(await lines() <= 2, `at ${width} x ${height}, the line runs to three lines: ${await status()}`);
      await page.evaluate(() => {
        const g = structuredClone(window.fullHouse.game);
        Object.assign(g.them, { five: 100, full: 50, extras: 1 });
        Object.assign(g, { number: 3, last: { id: 'full', score: 50, extra: g.board.extra } });
        window.fullHouse.set(g);
      });
      assert.equal(await status(), 'Your turn. The Dealer scored 50 in Full house, plus 100 extra.');
      assert.ok(await lines() <= 2, `at ${width} x ${height}, the line runs to three lines: ${await status()}`);
    }
  });

  await step('the last turn says so, yours and the opponent’s', async ({ page, myTurn }) => {
    const status = () => page.textContent('#status');
    await page.evaluate(() => window.fullHouse.start(0));
    // Your last box, Chance, with Pip's last score to report, then with nothing to report.
    const last = (them, more) => page.evaluate(([them, more]) => {
      const g = structuredClone(window.fullHouse.game);
      for (const b of g.board.boxes) { g.you[b.id] = b.id === 'chance' ? null : 10; g.them[b.id] = b.id in them ? them[b.id] : 10; }
      Object.assign(g, { number: 13, rolls: 0, turn: 'you', held: [false, false, false, false, false] }, more);
      window.fullHouse.set(g);
    }, [them, more]);
    await last({ five: 0 }, { last: { id: 'five', score: 0, extra: 0 } });
    assert.equal(await status(), 'Last turn. Pip scored 0 in Five of a kind.');
    await last({}, { last: null });
    assert.equal(await status(), 'Last turn. Roll the dice.');
    // The turn before isn't the last: the usual lines.
    await last({}, { number: 12, last: { id: 'five', score: 10, extra: 0 } });
    await page.evaluate(() => { const g = structuredClone(window.fullHouse.game); g.you.f1 = null; window.fullHouse.set(g); });
    assert.equal(await status(), 'Your turn. Pip scored 10 in Five of a kind.');
    // Pip's last go, and the one before it.
    const theirs = async open => {
      await page.evaluate(open => {
        const g = structuredClone(window.fullHouse.game);
        for (const b of g.board.boxes) { g.you[b.id] = 10; g.them[b.id] = open.includes(b.id) ? null : 10; }
        g.you.chance = null;
        Object.assign(g, { number: 12, rolls: 0, turn: 'them', held: [false, false, false, false, false] });
        window.fullHouse.set(g);
      }, open);
      return status();
    };
    assert.equal(await theirs(['chance']), 'Last turn. Pip rolls.');
    await myTurn();
    assert.equal(await theirs(['chance', 'f1']), 'Pip rolls.');
    await myTurn();
  });

  await step('the dice have landed by the time their scores show, at every pace', async ({ page, myTurn }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    // The dice still moving at the moment something turns true, looked for every few milliseconds. With `thrown`, only
    // dice in the air: at Just their score the opponent's dice appear as their score does, the held ones lifting.
    let thrown = false;
    const moving = when => page.evaluate(([when, thrown]) => new Promise(resolve => {
      const test = new Function(`return ${when}`);
      const air = a => !thrown || a.animationName === 'hop' || a.effect.target.classList.contains('cube');
      const look = () => (test() ? resolve(document.getAnimations().filter(a => a.playState === 'running' && a.effect.target.closest('#tray') && air(a)).length) : setTimeout(look, 4));
      look();
    }), [when, thrown]);
    for (const choice of ['normal', 'quick', 'score']) {
      await page.evaluate(choice => document.querySelector(`input[name="pace"][value="${choice}"]`).click(), choice);
      const pace = { normal: 'at the usual pace', quick: 'with quick opponents', score: 'with just their score' }[choice];
      thrown = choice === 'score';
      await myTurn();
      const offered = moving(`!!document.querySelector('#pad tr.can')`);
      await page.click('#b-roll');
      assert.equal(await offered, 0, `${pace}, the pad offers scores while your dice are still tumbling`);
      const said = moving(`/scores \\d+ in/.test(document.getElementById('status').textContent)`);
      await page.locator('tr.can').first().click();
      await page.locator('tr.can').first().click();
      assert.equal(await said, 0, `${pace}, the opponent's score is announced while their dice are still tumbling`);

      // Hurried along with a tap: the rolls go by faster, but the last one lands before the score shows, and the
      // score stays up long enough to read.
      await myTurn();
      await page.click('#b-roll');
      await page.waitForFunction(() => !window.fullHouse.busy);
      const hurried = moving(`/scores \\d+ in/.test(document.getElementById('status').textContent)`);
      const upFor = page.evaluate(() => new Promise(resolve => {
        const line = () => /scores \d+ in/.test(document.getElementById('status').textContent);
        let from = 0;
        const look = () => {
          if (!from && line()) from = performance.now();
          if (from && !line()) resolve(performance.now() - from); else setTimeout(look, 4);
        };
        look();
      }));
      upFor.catch(() => {}); // looked at below, unless something else fails first
      await page.locator('tr.can').first().click();
      await page.locator('tr.can').first().click();
      const die = await page.locator('.die >> nth=2').boundingBox();
      await page.touchscreen.tap(die.x + die.width / 2, die.y + die.height / 2);
      assert.equal(await hurried, 0, `${pace}, hurried along, the opponent's score is announced while their dice are still tumbling`);
      const up = await upFor;
      assert.ok(up >= 400, `${pace}, hurried along, the opponent's score is up for only ${Math.round(up)} ms`);
    }
    thrown = false;
    // Asked for less motion, the dice don't tumble at all.
    await myTurn();
    await page.waitForTimeout(500); // the opponent's held dice have dropped back
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.click('#b-roll');
    await page.waitForTimeout(200);
    assert.equal(await moving('true'), 0, 'the dice tumble though less motion was asked for');
  });

  await step('at Just their score the opponent’s dice show where they ended up and the score goes in in about a second, the same turn as at any pace', async ({ page, myTurn }) => {
    // An old save's Quick opponents switch, on, comes up as Quick.
    await page.evaluate(() => localStorage.setItem('full-house.v1', JSON.stringify({ settings: { fast: true, hints: true } })));
    await page.reload();
    assert.equal(await page.evaluate(() => window.fullHouse.settings.pace), 'quick');
    await page.evaluate(() => window.fullHouse.start(2)); // Triple Sixes, against Bea
    await page.click('#b-menu');
    assert.equal(await page.isChecked('input[name="pace"][value="quick"]'), true);
    await page.click('.seg label:nth-child(3)'); // Just their score
    await page.keyboard.press('Escape');
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('full-house.v1'))).settings.pace, 'score', 'the pace was not saved');
    // Bea's turn 12 of 13, then her last, from one game's seed: everything the page shows during each, and how long it took.
    const ready = await page.evaluate(() => {
      const g = structuredClone(window.fullHouse.game);
      for (const b of g.board.boxes) { g.you[b.id] = b.id === 'f5' ? null : 10; g.them[b.id] = ['chance', 'f6'].includes(b.id) ? null : 10; }
      return Object.assign(g, { number: 12, rolls: 0, turn: 'them', seed: 1234, held: [false, false, false, false, false] });
    });
    const watch = (g, pace) => page.evaluate(([g, pace]) => new Promise(resolve => {
      window.fullHouse.settings.pace = pace;
      const lines = [], t0 = performance.now();
      let moved = 0;
      const look = () => {
        const line = document.getElementById('status').textContent;
        if (lines.at(-1) !== line) lines.push(line);
        moved += document.getAnimations().filter(a => a.playState === 'running' && (a.animationName === 'hop' || a.effect.target.classList.contains('cube'))).length; // a throw, not a die lifting as it's held
        const now = window.fullHouse.game;
        if (now.turn === 'you' && !window.fullHouse.busy) resolve({ lines, moved, ms: performance.now() - t0, them: now.them, dice: now.dice });
        else setTimeout(look, 10);
      };
      window.fullHouse.set(g);
      look();
    }), [g, pace]);
    const glance = await watch(ready, 'score');
    assert.equal(glance.moved, 0, 'a die tumbled at Just their score');
    assert.deepEqual(glance.lines.filter(l => /rolls|holds/.test(l)), [], `a roll was played out: ${glance.lines}`);
    assert.ok(glance.lines.some(l => /^Bea scores \d+ in /.test(l)), `her score was not shown: ${glance.lines}`);
    assert.ok(glance.ms >= 900 && glance.ms < 2500, `her turn took ${Math.round(glance.ms)} ms`);
    const usual = await watch(ready, 'quick');
    assert.deepEqual([usual.them, usual.dice], [glance.them, glance.dice], 'the same turn came out differently at another pace');
    assert.ok(usual.lines.some(l => /^Bea (rolls|holds)/.test(l)));
    assert.ok(usual.moved > 0, 'the check for tumbling dice sees none at Quick either');
    // Her last turn says so, though there is no "Bea rolls." line to say it on.
    const last = { ...structuredClone(ready), them: glance.them, number: 13 };
    const end = await page.evaluate(([g]) => new Promise(resolve => {
      window.fullHouse.settings.pace = 'score';
      window.fullHouse.set(g);
      const look = () => (/scores/.test(document.getElementById('status').textContent) ? resolve(document.getElementById('status').textContent) : setTimeout(look, 10));
      look();
    }), [last]);
    assert.match(end, /^Last turn\. Bea scores \d+ in /);
    await myTurn();
  });

  await step('a message sits over the bar, clear of the dice, and doesn’t outlast its game', async t => {
    const { page } = t;
    await pipBeaten(page);
    await page.evaluate(() => { window.fullHouse.settings.pace = 'quick'; window.fullHouse.start(7); });
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
      window.fullHouse.settings.pace = 'quick';
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
    assert.equal(await page.textContent('#menu-twist'), `${await page.evaluate(() => window.fullHouse.game.board.blurb)} Against Sol. Quick hands. Not many slips.`);
    await page.keyboard.press('Escape');
    // A box the dice score nothing in is written in, not scored.
    await page.evaluate(() => {
      const g = structuredClone(window.fullHouse.game);
      // Sol's Five of a kind holds a 0, so a five of a kind on Sol's last turn earns no extra 100 to change what decided it.
      for (const b of g.board.boxes) { g.you[b.id] = b.id === 'large' || b.id === 'chance' ? null : 1; g.them[b.id] = b.id === 'chance' ? null : b.id === 'five' ? 0 : 20; }
      Object.assign(g, { number: 12, rolls: 1, turn: 'you', dice: [2, 2, 2, 3, 3] });
      window.fullHouse.settings.pace = 'quick';
      window.fullHouse.set(g);
    });
    // Until it's picked it shows a light dash, not a 0 that looks like a score; picked, the 0 it would write in.
    const large = () => page.textContent('tr[data-box="large"] td.you');
    assert.equal(await large(), '–', 'a box that scores nothing shows a pencilled score');
    assert.equal(await page.textContent('tr[data-box="chance"] td.you'), '12');
    await page.click('tr[data-box="large"]');
    assert.equal(await page.textContent('#status'), 'Tap Large straight again to write in a 0.');
    assert.equal(await large(), '0');
    await page.click('tr[data-box="chance"]');
    assert.equal(await page.textContent('#status'), 'Tap Chance again to score 12.');
    assert.equal(await large(), '–');
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
    // Lost by a lot: the line says what decided it, from the two cards, in place of the dice owing you one.
    assert.match(await page.textContent('#result-line'), /^Sol’s (top|bottom) section came to \d+ and yours to \d+\.$/);
    assert.equal(await page.textContent('#result-line'), await page.evaluate(async () => { const g = window.fullHouse.game; return (await import('./js/why.js')).whyLine(g.board, g.you, g.them, 'Sol'); }));
    assert.ok(await page.isHidden('#result-why'), 'a loss says why twice');
    assert.equal(await page.textContent('#b-next'), 'Play again');
  });

  await step('the Dealer has a small “the” inside a sentence, and keeps his capital at the start of one', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('full-house.v1', JSON.stringify({ progress: { beaten: [true, true, true, true, true, true], best: [200, 200, 200, 200, 200, 200] } })));
    await page.reload();
    // Beat Wren at table 7: table 8 opens, against the Dealer.
    await page.evaluate(() => {
      window.fullHouse.settings.pace = 'quick';
      window.fullHouse.start(6);
      const g = structuredClone(window.fullHouse.game);
      for (const b of g.board.boxes) { g.you[b.id] = b.id === 'low' ? null : 20; g.them[b.id] = b.id === 'low' ? null : b.id === 'five' ? 0 : 5; }
      Object.assign(g, { number: 13, rolls: 1, turn: 'you' });
      window.fullHouse.set(g);
    });
    await page.click('tr[data-box="low"]');
    await page.click('tr[data-box="low"]');
    await page.click('#tray');
    await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
    assert.equal(await page.textContent('#result-line'), 'Table 8 is open: High Stakes, against the Dealer.');
    assert.ok(await page.isHidden('#result-n'), 'a win before the last table says the tour is done');
    // At his table: the bar, the menu and Carry on.
    await page.click('#b-next');
    await page.click('#b-sit');
    assert.equal(await page.textContent('#g-twist'), 'against the Dealer\u00a0· turn 1 of 13');
    assert.equal(await page.textContent('.pad thead .them'), 'The Dealer');
    await page.click('#b-menu');
    assert.match(await page.textContent('#menu-twist'), / Against the Dealer\. Hasn’t lost a game in years\.$/);
    await page.keyboard.press('Escape');
    await page.click('#b-home');
    assert.equal(await page.textContent('#b-continue span'), 'Table 8: High Stakes, against the Dealer. Turn 1 of 13.');
    assert.match(await page.textContent('#tables li:nth-child(8)'), /The Dealer/);
    // Not finished yet: no ticks, no total, and the heading says only The tour.
    assert.equal(await page.textContent('#tour-h'), 'The tour');
    assert.equal(await page.locator('#tables .tick').count(), 0);
    assert.ok(await page.isHidden('#tour-sum'));
    // Beat him, and the result's title has the small "the" too; his own turn starts with the capital.
    await page.click('#b-continue');
    await page.evaluate(() => {
      const g = structuredClone(window.fullHouse.game);
      for (const b of g.board.boxes) { g.you[b.id] = b.id === 'chance' ? null : 20; g.them[b.id] = b.id === 'chance' ? null : b.id === 'five' ? 0 : 5; }
      Object.assign(g, { number: 13, rolls: 1, turn: 'you' });
      window.fullHouse.set(g);
    });
    await page.click('tr[data-box="chance"]');
    await page.click('tr[data-box="chance"]');
    await page.waitForFunction(() => /^Last turn\. The Dealer rolls\.$/.test(document.getElementById('status').textContent));
    await page.click('#tray');
    await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
    assert.equal(await page.textContent('#result-title'), 'You beat the Dealer');
    // That finishes the tour: the result says so above its title, and the tour card is finished, a tick pencilled on each
    // table's number and your best at each added up at its foot.
    assert.equal(await page.textContent('#result-n'), 'Table 8 of 8 · the tour');
    assert.ok(await page.isVisible('#result-n'));
    assert.equal(await page.getAttribute('#sheet-result .panel', 'aria-labelledby'), 'result-n result-title');
    const bests = await page.evaluate(() => window.fullHouse.progress.best);
    assert.equal(bests.length, 8);
    await page.click('#b-tour');
    assert.equal(await page.textContent('#tour-h'), 'The tour · finished');
    assert.equal(await page.locator('#tables li.beaten .n .tick').count(), 8);
    assert.equal(await page.textContent('#tour-sum'), `Totalyour best at each table, added up${bests.reduce((a, b) => a + b, 0)}`);
    assert.ok(await page.isVisible('#tour-sum'));
    // Beaten, his line is in the past tense: on his card on the tour, in a quick game's, and in the menu at his table.
    await page.click('[data-table="7"]');
    assert.equal(await page.textContent('#intro-who span'), 'Hadn’t lost a game in years.');
    await page.click('#b-sit');
    await page.click('#b-menu');
    assert.match(await page.textContent('#menu-twist'), / Against the Dealer\. Hadn’t lost a game in years\.$/);
    await page.keyboard.press('Escape');
    await page.click('#b-home');
    await page.click('#people [data-quick="7"]');
    assert.equal(await page.textContent('#intro-who span'), 'Hadn’t lost a game in years.');
    await page.keyboard.press('Escape');
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
      window.fullHouse.settings.pace = 'quick';
      window.fullHouse.set(g);
      return g.you.chance;
    });
    await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
    assert.equal(await page.textContent('#result-title'), 'A tie');
    assert.equal(await page.textContent('#result-line'), 'Play it again to settle it.');
    assert.equal(await page.textContent('#result-scores'), `You${total}Pip${total}`);
    // Pip's word on it, under the scores in his red pencil, named for a screen reader only.
    assert.equal(await page.textContent('#result-says'), 'Pip: Is that allowed? Let’s do it again.');
    assert.equal(await page.textContent('#result-says .vh'), 'Pip: ');
    assert.equal(await page.$eval('#result-says', e => getComputedStyle(e).color), await page.$eval('#result-scores .them b', e => getComputedStyle(e).color), 'not in the red pencil of the opponent’s score');
    assert.equal(await page.textContent('#b-next'), 'Play again');
    assert.equal(await page.textContent('#status'), 'A tie.');
    const p = await page.evaluate(() => window.fullHouse.progress);
    assert.equal(p.played[0], 1);
    assert.ok(!p.won[0] && !p.beaten[0], 'a tie counted as a win');
  });

  await step('a loss by 20 or less says the dice owe you one, and a win by as little says nothing more', async ({ page }) => {
    // The last turn is Pip's, from the game's seed: work out what Pip will score, and give yourself a total `by` off it.
    for (const by of [-20, 20, -21]) {
      await page.evaluate(async by => {
        const [{ Opponent, playTurn }, { TABLES }, R, { mulberry32 }] = await Promise.all(['./js/ai.js', './js/tour.js', './js/rules.js', './js/rng.js'].map(u => import(u)));
        window.fullHouse.settings.pace = 'score';
        window.fullHouse.start(0);
        const g = structuredClone(window.fullHouse.game);
        for (const b of g.board.boxes) { g.them[b.id] = b.id === 'chance' ? null : b.id === 'five' ? 0 : 5; g.you[b.id] = 0; }
        Object.assign(g, { number: 13, rolls: 0, turn: 'them' });
        const { option } = playTurn(new Opponent(TABLES[0].play), g.board, g.them, mulberry32((g.seed ^ Math.imul(13, 0x9E3779B1)) >>> 0));
        g.you.chance = R.totals(g.board, R.mark(g.them, option)).total + by;
        window.fullHouse.set(g);
      }, by);
      await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
      const line = await page.textContent('#result-line');
      if (by === -20) assert.equal(line, 'The dice owe you one.');
      if (by === -21) assert.match(line, /^Pip’s (top|bottom) section came to \d+ and yours to \d+\.$/);
      if (by === 20) assert.equal(line, 'Table 2 is open: Evens, against Maud.');
      assert.equal(await page.textContent('#result-says'), by > 0 ? 'Pip: I kept all the fours. Was that wrong?' : 'Pip: Beginner’s luck. Mine, I mean.');
      assert.ok(await page.isHidden('#result-why'), `a game won or lost by ${Math.abs(by)} says why under the line`);
      await page.keyboard.press('Escape');
    }
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
      window.fullHouse.settings.pace = 'quick';
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

    // One bottom box left: the line names it, and what it counts there.
    const all = { f1: 3, f3: 9, f4: 12, f5: 15, f6: 18, three: 20, four: 0, full: 25, small: 30, chance: 22, five: 50 };
    await at({ ...all }, [6, 6, 6, 6, 6]);
    assert.equal(await status(), 'Five of a kind again: 100 extra. It has to go in Large straight, where it counts in full: 40.');
    assert.deepEqual(await can(), ['large']);
    await twoLines();
    const { chance, ...noChance } = all;
    await at({ ...noChance, large: 40 }, [6, 6, 6, 6, 6]);
    assert.equal(await status(), 'Five of a kind again: 100 extra. It has to go in Chance.');
    assert.deepEqual(await can(), ['chance']);
    await twoLines();

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
    // And your turn's line after it, after a reload too.
    await t.myTurn();
    assert.equal(await status(), 'Your turn. Pip scored 5 in Ones, plus 100 extra.');
    await twoLines();
    await page.reload();
    await t.myTurn();
    assert.equal(await status(), 'Your turn. Pip scored 5 in Ones, plus 100 extra.');
  });

  await step('the winning total is ringed in pencil on the pad and the result, both on a tie, drawn in unless less motion is asked for', async t => {
    const { page } = t;
    // Where the rings are, what colour, and whether they're drawn in: on the pad's Totals, then the result's tiles.
    const rings = () => page.evaluate(() => [...document.querySelectorAll('#pad tfoot td'), ...document.querySelectorAll('#result-scores b')].map(el => {
      const svg = el.querySelector('svg.ring');
      if (!svg) return null;
      const path = getComputedStyle(svg.querySelector('path'));
      return { same: getComputedStyle(svg).stroke === getComputedStyle(el).color, drawn: path.animationName === 'none' ? 0 : parseFloat(path.animationDuration), hidden: svg.getAttribute('aria-hidden') };
    }));
    const ring = (drawn = 0.6) => ({ same: true, drawn, hidden: 'true' });
    // A win: your Total and your tile.
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await t.myTurn();
    assert.deepEqual(await rings(), [null, null], 'a total is ringed before the game is over');
    await win(t);
    assert.deepEqual(await rings(), [ring(), null, ring(), null]);
    assert.equal(await page.textContent('#result-scores div:first-child b'), (await page.textContent('#pad tfoot td.you')), 'the ring has text of its own');
    // Looked over again later, the pad's ring is simply there.
    await page.keyboard.press('Escape');
    await page.waitForSelector('#sheet-result', { state: 'hidden' });
    await page.click('#b-menu');
    await page.click('#o-hints');
    await page.keyboard.press('Escape');
    assert.deepEqual((await rings()).slice(0, 2), [ring(0), null], 'the ring is drawn in again on a redraw');
    // A loss: theirs, in red pencil.
    await page.evaluate(() => {
      window.fullHouse.start(0);
      const g = structuredClone(window.fullHouse.game);
      for (const b of g.board.boxes) { g.you[b.id] = b.id === 'chance' ? null : 0; g.them[b.id] = b.id === 'chance' ? null : 10; }
      Object.assign(g, { number: 13, rolls: 1, turn: 'you' });
      window.fullHouse.set(g);
    });
    await page.click('tr[data-box="chance"]');
    await page.click('tr[data-box="chance"]');
    await page.click('#tray');
    await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
    assert.deepEqual(await rings(), [null, ring(), null, ring()]);
    // A tie: both, and with less motion asked for, simply there.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(async () => {
      const [{ Opponent, playTurn }, { TABLES }, R, { mulberry32 }] = await Promise.all(['./js/ai.js', './js/tour.js', './js/rules.js', './js/rng.js'].map(u => import(u)));
      window.fullHouse.start(0);
      const g = structuredClone(window.fullHouse.game);
      for (const b of g.board.boxes) { g.them[b.id] = b.id === 'chance' ? null : b.id === 'five' ? 0 : 5; g.you[b.id] = 0; }
      Object.assign(g, { number: 13, rolls: 0, turn: 'them' });
      const { option } = playTurn(new Opponent(TABLES[0].play), g.board, g.them, mulberry32((g.seed ^ Math.imul(13, 0x9E3779B1)) >>> 0));
      g.you.chance = R.totals(g.board, R.mark(g.them, option)).total;
      window.fullHouse.set(g);
    });
    await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
    assert.equal(await page.textContent('#result-title'), 'A tie');
    assert.deepEqual(await rings(), [ring(0), ring(0), ring(0), ring(0)]);
  });

  await step('the result says when you’ve beaten your best at a table, and doesn’t open a table twice', async t => {
    const { page } = t;
    // A game at a table (null for a quick game) with every box but Chance worth `each` to you, played to its result.
    // The opponent's Five of a kind holds a 0, so a five of a kind on their last turn (about one game in twenty for
    // Pip) earns them no extra 100 to win a game the test means you to win. Yours holds a 0 too, as a box that can only
    // score 50 or nothing would: a 10 there reads as a five of a kind, and the line on what decided the game says so.
    const play = async (table, each) => {
      await page.evaluate(([table, each]) => {
        window.fullHouse.settings.pace = 'quick';
        window.fullHouse.start(table, table ?? 0);
        const g = structuredClone(window.fullHouse.game);
        for (const b of g.board.boxes) { g.you[b.id] = b.id === 'chance' ? null : b.id === 'five' ? 0 : each; g.them[b.id] = b.id === 'chance' ? null : b.id === 'five' ? 0 : 5; }
        Object.assign(g, { number: 13, rolls: 1, turn: 'you' });
        window.fullHouse.set(g);
      }, [table, each]);
      await page.click('tr[data-box="chance"]');
      await page.click('tr[data-box="chance"]');
      await page.click('#tray');
      await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
      const why = await page.evaluate(async () => { const g = window.fullHouse.game; return (await import('./js/why.js')).whyLine(g.board, g.you, g.them, window.fullHouse.game.opp === 7 ? 'The Dealer' : 'Pip'); });
      return { why, shown: await page.isVisible('#result-why') ? await page.textContent('#result-why') : null, line: await page.textContent('#result-line'), best: await page.isVisible('#result-best') ? await page.textContent('#result-best') : null, next: await page.textContent('#b-next'), you: +(await page.textContent('#result-scores div:first-child b')) };
    };
    // A quick game won against Pip before table 1 is beaten: it says why the tour hasn't moved, and where Pip is.
    const early = await play(null, 20);
    assert.equal(early.line, 'A good game. It doesn’t count on the tour: Pip is waiting at table 1.');
    assert.equal(early.next, 'Play again');
    assert.equal((await page.evaluate(() => window.fullHouse.progress)).beaten[0], undefined);
    // The first win at table 1: the next table opens, and there was no best to beat.
    const first = await play(0, 10);
    assert.equal(first.line, 'Table 2 is open: Evens, against Maud.');
    assert.equal(first.best, null);
    // Won by a lot: what decided it, under the line.
    assert.match(first.why, /^Your (top|bottom) section came to \d+ and Pip’s to \d+\.$/);
    assert.equal(first.shown, first.why);
    // A better win there: a new best, and table 2 isn't opened a second time.
    const better = await play(0, 20);
    assert.equal(better.line, 'You’ve beaten Pip before; table 2 is still open.');
    assert.equal(better.best, `Your best here: ${better.you} (was ${first.you}).`);
    assert.equal(better.next, 'On to table 2');
    // A lesser win, a loss and a quick game say nothing about a best. A loss with more than your best does.
    assert.equal((await play(0, 15)).best, null);
    const lost = await play(0, 0);
    assert.match(lost.why, /^Pip’s (top|bottom) section came to \d+ and yours to \d+\.$/);
    assert.equal(lost.line, lost.why);
    assert.equal(lost.shown, null);
    assert.equal(lost.best, null);

    const quick = await play(null, 20);
    assert.equal(quick.best, null);
    assert.equal(quick.line, 'A good game.', 'a quick game against an opponent already beaten');
    await page.evaluate(() => { window.fullHouse.progress.best[0] = 3; });
    const close = await play(0, 0);
    assert.equal(close.line, close.why || 'The dice owe you one.');
    assert.equal(close.best, `Your best here: ${close.you} (was 3).`);
    assert.equal((await page.evaluate(() => window.fullHouse.progress)).best[0], close.you);
    // The last table, beaten a second time.
    await page.evaluate(() => { for (let i = 0; i < 8; i++) window.fullHouse.progress.beaten[i] = true; });
    const dealer = await play(7, 20);
    assert.equal(dealer.line, 'You’ve beaten the Dealer before. That’s still the whole tour.');
    assert.equal(dealer.next, 'Play again');
    // Table 1 again, with table 2 beaten too: nothing to send you on to, so the button plays it again.
    const again = await play(0, 20);
    assert.equal(again.line, 'You’ve beaten Pip before.');
    assert.equal(again.next, 'Play again');
    assert.ok(await page.isHidden('#b-again'), 'Play this table again offered beside Play again');
    await page.click('#b-next');
    assert.equal(await page.textContent('#g-table'), 'Table 1: Classic');
    assert.equal((await page.evaluate(() => window.fullHouse.game)).number, 1);
  });

  await step('giving up takes two taps, and the tour says what happened', async ({ page, game, settled }) => {
    await pipBeaten(page);
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
    await pipBeaten(page);
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

  await step('back in a game during the opponent’s turn, the line says whose turn it is and their pips start empty', async ({ page, myTurn, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-roll');
    await settled();
    await page.locator('tr.can').first().click();
    await page.locator('tr.can').first().click();
    await page.waitForFunction(() => /^Pip /.test(document.getElementById('status').textContent));
    // Straight after the page opens, before their turn starts over half a second later.
    const opened = async () => {
      const h = await page.waitForFunction(() => window.fullHouse && {
        said: document.getElementById('status').textContent,
        used: document.querySelectorAll('#rolls i.used').length,
        started: document.getElementById('tray').classList.contains('theirs'),
      }, null, { polling: 'raf' });
      return h.jsonValue();
    };
    await page.reload({ waitUntil: 'commit' });
    const at = await opened();
    assert.equal(at.started, false, 'their turn had started over already');
    assert.equal(at.said, 'Pip’s turn.', 'the line under the dice after a reload');
    assert.equal(at.used, 0, 'the pips show your own rolls on their turn');
    await myTurn();
  });

  await step('after a roll the line says how to go on, in one line on a small phone and a phone', async ({ page, settled }) => {
    const lines = () => page.evaluate(() => { const e = document.getElementById('status'), r = document.createRange(); r.selectNodeContents(e); return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size; });
    for (const [width, height] of [[320, 568], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => {
        window.fullHouse.start(0);
        const g = structuredClone(window.fullHouse.game);
        Object.assign(g, { rolls: 1, dice: [1, 2, 3, 3, 6] });
        window.fullHouse.set(g);
      });
      assert.equal(await page.textContent('#status'), 'Hold dice and roll again, or pick a box to score.');
      assert.equal(await lines(), 1, `at ${width} wide the line takes more than one line`);
    }
  });

  await step('a first five of a kind is noticed as the dice land, at the box’s own value', async ({ page, settled }) => {
    const status = () => page.textContent('#status');
    const rolled = (table, dice, more = {}, you = {}) => page.evaluate(([table, dice, more, you]) => {
      window.fullHouse.start(table);
      const g = structuredClone(window.fullHouse.game);
      Object.assign(g.you, you);
      Object.assign(g, { rolls: 1, dice }, more);
      window.fullHouse.set(g);
    }, [table, dice, more, you]);
    await rolled(0, [5, 5, 5, 5, 5]);
    assert.equal(await status(), 'Five of a kind. 50 in its box, if you want it.');
    await page.click('tr[data-box="f5"]');
    assert.equal(await status(), 'Tap Fives again to score 25.', 'a picked box says what it would score');
    // After the last roll too, and doubled at High Stakes.
    await rolled(0, [2, 2, 2, 2, 2], { rolls: 3 });
    assert.equal(await status(), 'Five of a kind. 50 in its box, if you want it.');
    await rolled(7, [6, 6, 6, 6, 6]);
    assert.equal(await status(), 'Five of a kind. 100 in its box, if you want it.');
    // Not with the box filled: then it's the second one's line. Nor on an ordinary roll.
    await rolled(0, [5, 5, 5, 5, 5], {}, { five: 0 });
    assert.match(await status(), /^Five of a kind again\./);
    await rolled(0, [5, 5, 5, 5, 4]);
    assert.equal(await status(), 'Hold dice and roll again, or pick a box to score.');
    // Rolled for real (from a seed whose first roll is five 5s), and heard as well as seen.
    await page.evaluate(() => {
      window.fullHouse.settings.pace = 'quick';
      window.fullHouse.start(0);
      window.fullHouse.set({ ...structuredClone(window.fullHouse.game), seed: 1263 });
    });
    await page.click('#b-roll');
    await settled();
    assert.equal(await status(), 'Five of a kind. 50 in its box, if you want it.');
    assert.equal(await page.textContent('#said'), 'You rolled 5, 5, 5, 5, 5. 2 rolls left. Five of a kind. 50 in its box, if you want it.');
  });

  await step('reaching the bonus says so, and the bonus is pencilled in', async ({ page, myTurn }) => {
    const status = () => page.textContent('#status');
    const bonus = who => page.evaluate(who => {
      const td = document.querySelector(`#pad tr.sub td.${who}`), span = td.querySelector('span');
      return { text: td.textContent, fresh: td.classList.contains('fresh'), drawn: span ? getComputedStyle(span).animationName : null };
    }, who);
    // Yours: 45 on top with Sixes open, and four sixes rolled.
    await page.evaluate(() => {
      window.fullHouse.settings.pace = 'quick';
      window.fullHouse.start(0);
      const g = structuredClone(window.fullHouse.game);
      Object.assign(g.you, { f1: 3, f2: 6, f3: 9, f4: 12, f5: 15 });
      Object.assign(g, { number: 6, rolls: 1, dice: [6, 6, 6, 6, 2] });
      window.fullHouse.set(g);
    });
    assert.match((await bonus('you')).text, /^45\/63on pace$/); // the bonus so far, and three of each so far
    await page.click('tr[data-box="f6"]');
    assert.equal(await status(), 'Tap Sixes again to score 24 and make the\u00a0bonus.');
    await page.click('tr[data-box="f6"]');
    assert.equal(await status(), 'You score 24 in Sixes, and the 35\u00a0bonus.');
    assert.deepEqual(await bonus('you'), { text: '35', fresh: true, drawn: 'write' }, 'the bonus is not pencilled in as you watch');
    // A box that doesn't make it says nothing of the bonus.
    await page.evaluate(() => {
      const g = structuredClone(window.fullHouse.game);
      Object.assign(g.you, { f6: null, f5: null });
      Object.assign(g, { turn: 'you', rolls: 1, dice: [5, 2, 3, 4, 1] });
      window.fullHouse.set(g);
    });
    await page.click('tr[data-box="f5"]');
    assert.equal(await status(), 'Tap Fives again to score 5.');
    // The opponent's: Pip has 62 on top with Ones the only box left, at a seed where Pip rolls at least one 1.
    await page.evaluate(async () => {
      const [{ Opponent, playTurn }, { TABLES }, { mulberry32 }] = await Promise.all(['./js/ai.js', './js/tour.js', './js/rng.js'].map(u => import(u)));
      const g = structuredClone(window.fullHouse.game);
      for (const b of g.board.boxes) { g.you[b.id] = b.id === 'chance' || b.id === 'large' ? null : 10; g.them[b.id] = b.id === 'f1' ? null : 10; }
      Object.assign(g.them, { f2: 10, f3: 12, f4: 12, f5: 13, f6: 15 }); // 62
      Object.assign(g, { number: 11, rolls: 0, turn: 'them', held: [false, false, false, false, false] });
      for (g.seed = 1; ; g.seed++) {
        const { option } = playTurn(new Opponent(TABLES[0].play), g.board, g.them, mulberry32((g.seed ^ Math.imul(g.number, 0x9E3779B1)) >>> 0));
        if (option.score > 0) break;
      }
      window.fullHouse.set(g);
    });
    await page.waitForFunction(() => /scores/.test(document.getElementById('status').textContent), null, { timeout: 15000 });
    assert.match(await status(), /^Pip scores \d in Ones, and the\u00a0bonus\.$/);
    await myTurn();
    assert.match(await status(), /^Your turn\. Pip scored \d in Ones and made the\u00a0bonus\.$/);
    assert.deepEqual(await bonus('them'), { text: '35', fresh: true, drawn: 'write' });
    await page.reload();
    await myTurn();
    assert.match(await status(), /^Your turn\. Pip scored \d in Ones and made the\u00a0bonus\.$/, 'after a reload');
    assert.equal((await bonus('them')).fresh, false);
    // Asked for less motion, it's simply there.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => {
      const g = structuredClone(window.fullHouse.game);
      for (const b of g.board.boxes) g.you[b.id] = b.id === 'chance' ? null : 10;
      Object.assign(g.you, { f1: null, f2: 10, f3: 12, f4: 12, f5: 13, f6: 15 });
      Object.assign(g, { rolls: 1, dice: [1, 1, 2, 3, 4] });
      window.fullHouse.set(g);
    });
    await page.click('tr[data-box="f1"]');
    await page.click('tr[data-box="f1"]');
    assert.deepEqual(await bonus('you'), { text: '35', fresh: true, drawn: 'none' });
  });

  await step('a bonus out of reach is a pencilled 0, and a column with nothing written in it has no total yet', async ({ page }) => {
    const pad = () => page.evaluate(() => {
      const cell = td => ({ text: td.textContent, pencil: !!td.querySelector('span') && !td.querySelector('small') });
      return {
        bonus: [...document.querySelectorAll('#pad tr.sub td')].slice(0, 2).map(cell),
        totals: [...document.querySelectorAll('#pad tfoot td')].map(td => td.textContent),
        inks: [...document.querySelectorAll('#pad tr.sub td')].slice(0, 2).map(td => getComputedStyle(td).color),
      };
    });
    await page.evaluate(() => window.fullHouse.start(0));
    // A fresh sheet: the bonus so far in small print, and no totals pencilled in.
    let p = await pad();
    assert.deepEqual(p.totals, ['', ''], 'a fresh sheet has totals written in');
    assert.deepEqual(p.bonus, [{ text: '0/63', pencil: false }, { text: '0/63', pencil: false }]);
    // Your top filled at 41, theirs at 62: a pencilled 0 each, theirs in red. A top still open keeps its small print.
    await page.evaluate(() => {
      const g = structuredClone(window.fullHouse.game);
      Object.assign(g.you, { f1: 2, f2: 4, f3: 6, f4: 8, f5: 10, f6: 11 });
      Object.assign(g.them, { f1: 3, f2: 6, f3: 9, f4: 12, f5: 15, f6: 17, chance: 20 });
      Object.assign(g, { number: 8 });
      window.fullHouse.set(g);
    });
    p = await pad();
    assert.deepEqual(p.bonus, [{ text: '0', pencil: true }, { text: '0', pencil: true }]);
    assert.notEqual(p.inks[0], p.inks[1], 'the opponent’s 0 is not in red pencil');
    assert.deepEqual(p.totals, ['41', '82']);
    await page.evaluate(() => {
      const g = structuredClone(window.fullHouse.game);
      g.you.f6 = null;
      for (const b of g.board.boxes) g.them[b.id] = null;
      g.them.chance = 20;
      window.fullHouse.set(g);
    });
    p = await pad();
    assert.deepEqual(p.bonus, [{ text: '30/63', pencil: false }, { text: '0/63', pencil: false }]);
    assert.deepEqual(p.totals, ['30', '20'], 'a column with a box written in has its total');
  });

  await step('the bonus row says whether each column is on pace for the bonus, in small print that fits the row', async ({ page }) => {
    const bonus = () => page.$$eval('#pad tr.sub td', tds => tds.slice(0, 2).map(td => [...td.querySelectorAll('small')].map(e => e.textContent)));
    await page.setViewportSize({ width: 320, height: 568 });
    await page.evaluate(() => window.fullHouse.start(7)); // the Dealer's wider columns
    assert.deepEqual(await bonus(), [['0/63'], ['0/63']], 'a pace before any number box is filled');
    // Ahead, behind, on pace, and out of reach, in either column.
    const set = (you, them) => page.evaluate(([you, them]) => {
      const g = structuredClone(window.fullHouse.game);
      Object.assign(g.you, you); Object.assign(g.them, them);
      window.fullHouse.set(g);
    }, [you, them]);
    await set({ f6: 24, f1: 1 }, { f5: 10, f4: 8 });
    assert.deepEqual(await bonus(), [['25/63', '4 ahead'], ['18/63', '9 behind']]);
    await set({ f6: 18, f1: null }, { f5: 0, f4: 0, f6: 6, f3: 3 });
    assert.deepEqual(await bonus(), [['18/63', 'on pace'], ['9/63']], 'a pace on a bonus out of reach');
    const m = await page.evaluate(() => ({
      row: document.querySelector('#pad tr.sub').getBoundingClientRect().height,
      size: parseFloat(getComputedStyle(document.querySelector('#pad small.par')).fontSize),
      over: [...document.querySelectorAll('#pad small.par')].some(e => e.scrollWidth > e.parentElement.clientWidth),
    }));
    assert.ok(m.row <= 34.5, `the bonus row is ${m.row}px tall with its pace`);
    assert.ok(m.size >= 12.5, `the pace is ${m.size}px`);
    assert.equal(m.over, false, 'the pace runs past its column');
    // Made: the bonus is pencilled in, with no pace under it.
    await set({ f6: 30, f5: 25, f4: 8 }, {});
    assert.deepEqual((await bonus())[0], []);
  });

  await step('your dice come from the game’s seed: the same in each place on a roll for anyone playing from it, whatever they held', async ({ page, game, settled }) => {
    const expected = await page.evaluate(async () => {
      const { rollFor } = await import('./js/rng.js');
      return [rollFor(4242, 1, 1), rollFor(4242, 1, 2)];
    });
    // The same seed twice, holding different dice: each roll throws the same numbers into the places it throws.
    for (const hold of [[0, 1], [2, 3, 4]]) {
      await page.evaluate(() => {
        window.fullHouse.start(0);
        const g = structuredClone(window.fullHouse.game);
        g.seed = 4242;
        window.fullHouse.settings.pace = 'quick';
        window.fullHouse.set(g);
      });
      await page.click('#b-roll');
      await settled();
      assert.deepEqual((await game()).dice, expected[0], 'the first roll');
      for (const i of hold) await page.click(`.die >> nth=${i}`);
      await page.click('#b-roll');
      await settled();
      const dice = (await game()).dice;
      for (let i = 0; i < 5; i++) assert.equal(dice[i], hold.includes(i) ? expected[0][i] : expected[1][i], `place ${i + 1}, holding ${hold}`);
    }
  });

  await step('a friend’s link opens their table with their dice and their score to beat, at any table, counting nowhere', async t => {
    const { page, game } = t;
    const seed = parseInt('k3j2h1', 36);
    await page.goto(`${base}#table=6&dice=k3j2h1&score=288`);
    await page.waitForSelector('#sheet-intro:not([hidden])');
    assert.equal(await page.evaluate(() => location.hash), '', 'the link comes off the address, so a reload doesn’t open it again');
    assert.equal(await page.textContent('#intro-n'), 'The same dice your friend had');
    assert.equal(await page.textContent('#intro-title'), 'Hot Boxes');
    assert.match(await page.textContent('#intro-blurb'), /This time it’s \w+.* and .*\.$/, 'the hot boxes the link’s dice draw');
    assert.match(await page.textContent('#intro-who'), /Otto/);
    assert.equal(await page.textContent('#intro-note'), 'Score to beat: 288. It doesn’t count on the tour.');
    assert.ok(await page.isVisible('#b-sit'), 'table 6 is open from a link, though nothing on the tour is beaten');
    await page.click('#b-sit');
    let g = await game();
    assert.deepEqual([g.kind, g.seed, g.opp, g.table, g.score, g.board.id], ['friend', seed, 5, null, 288, 'hot']);
    assert.equal(await page.textContent('#g-table'), 'A friend’s table: Hot Boxes');
    const expected = await page.evaluate(async seed => {
      const [{ rollFor }, { boardFor }] = await Promise.all([import('./js/rng.js'), import('./js/tour.js')]);
      return { dice: rollFor(seed, 1, 1), hot: boardFor(5, seed).boxes.filter(b => b.mult > 1).map(b => b.id) };
    }, seed);
    assert.deepEqual(g.board.boxes.filter(b => b.mult > 1).map(b => b.id), expected.hot);
    await page.evaluate(() => { window.fullHouse.settings.pace = 'quick'; });
    await page.click('#b-roll');
    await t.settled();
    assert.deepEqual((await game()).dice, expected.dice, 'your first roll is the one your friend had');

    // The result: you, your friend and Otto, and how you did against your friend. Nothing counts on the tour.
    await win(t);
    const you = await page.evaluate(() => { const g = window.fullHouse.game; return Object.values(g.you).reduce((a, v) => a + (v || 0), 0); });
    assert.equal(await page.textContent('#result-n'), 'The same dice your friend had');
    assert.deepEqual(await page.locator('#result-scores span').allTextContents(), ['You', 'Your friend', 'Otto']);
    assert.equal(await page.textContent('#result-scores .friend b'), '288');
    assert.match(await page.textContent('#result-line'), /^Your friend had 288 with the same dice(: you beat them by \d+\.|, \d+ more than you\.|, the same as you\.)$/);
    assert.ok(you > 0);
    assert.deepEqual(await page.evaluate(() => { const p = window.fullHouse.progress; return [p.played.length, p.won.length, p.beaten.length, p.quick.played]; }), [0, 0, 0, 0]);
    assert.equal(await page.textContent('#b-next'), 'Play the same dice again');
    await page.click('#b-next');
    g = await game();
    assert.deepEqual([g.kind, g.seed, g.score, g.over], ['friend', seed, 288, undefined]);

    // A link opened in a tab the game is in: a quick game's, against someone other than the table's own, with no score.
    // The game in progress waits under Carry on, and sitting down says it ends it.
    await page.evaluate(() => { location.hash = 'table=1&vs=8&dice=1'; });
    await page.waitForFunction(() => document.getElementById('intro-title').textContent === 'Classic');
    assert.equal(await page.evaluate(() => document.body.dataset.screen), 'home');
    assert.ok(await page.isVisible('#b-continue'));
    assert.match(await page.textContent('#intro-who'), /The Dealer.*Sitting down here ends the game you’re in/);
    assert.equal(await page.textContent('#intro-note'), 'It doesn’t count on the tour.');
    await page.click('#b-sit');
    assert.deepEqual(await page.evaluate(() => { const g = window.fullHouse.game; return [g.kind, g.seed, g.opp, g.board.id, g.score]; }), ['friend', 1, 7, 'classic', null]);
    assert.deepEqual(await page.evaluate(() => window.fullHouse.progress.played.length), 0, 'the friend’s game given up counts nowhere');

    // A link that doesn't make sense opens nothing, and comes off the address all the same.
    for (const bad of ['table=9&dice=1', 'table=2&dice=', 'table=2&dice=zzzzzzzz', 'table=0&dice=5', 'tour']) {
      await page.goto(`${base}#${bad}`);
      assert.ok(await page.isHidden('#sheet-intro'), bad);
      assert.equal(await page.evaluate(() => location.hash), '', bad);
    }
  });

  await step('Share sends who won and a link with the same dice: the share sheet where there is one, or a copy', async t => {
    const { page, ctx, game } = t;
    await page.evaluate(() => { navigator.share = async data => { window.shared = data; }; });
    await page.evaluate(() => window.fullHouse.start(0));
    await win(t);
    const g = await game(), total = side => page.textContent(`#pad tfoot td.${side}`).then(Number);
    const [you, them] = [await total('you'), await total('them')];
    await page.click('#b-share');
    await page.waitForFunction(() => window.shared);
    assert.deepEqual(await page.evaluate(() => window.shared), { text: `Full House, table 1: Classic. I beat Pip, ${you} to ${them}. https://full-house.junkdrawer.works/#table=1&dice=${g.seed.toString(36)}&score=${you}` });
    assert.equal(await page.textContent('#b-share'), 'Share', 'the share sheet says it all itself');

    // Closed without sending: nothing more. Where there's no share sheet: a copy, and the button says so.
    await page.evaluate(() => { navigator.share = async () => { throw new DOMException('closed', 'AbortError'); }; });
    await page.click('#b-share');
    assert.equal(await page.textContent('#b-share'), 'Share');
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    await page.evaluate(() => { delete navigator.share; Object.defineProperty(navigator, 'share', { value: undefined, configurable: true, writable: true }); });
    await page.click('#b-share');
    await page.waitForFunction(() => document.getElementById('b-share').textContent === 'Copied.');
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^Full House, table 1: Classic\. I beat Pip, \d+ to \d+\. https:\/\/full-house\.junkdrawer\.works\/#table=1&dice=/);
    await page.waitForFunction(() => document.getElementById('b-share').textContent === 'Share', null, { timeout: 5000 });

    // A loss, the Dealer at the last table, and a quick game against someone from another table.
    await page.evaluate(() => { navigator.share = async data => { window.shared = data; }; window.shared = null; });
    const finishAs = (table, opp, at, mine, theirs) => page.evaluate(([table, opp, at, mine, theirs]) => {
      window.fullHouse.progress.beaten = [true, true, true, true, true, true, true];
      window.fullHouse.start(table, opp, at);
      const g = structuredClone(window.fullHouse.game);
      for (const b of g.board.boxes) { g.you[b.id] = mine; g.them[b.id] = theirs; }
      g.you.chance = null;
      Object.assign(g, { number: 13, rolls: 3, turn: 'you', dice: [1, 1, 2, 2, 3] });
      window.fullHouse.set(g);
    }, [table, opp, at, mine, theirs]);
    const shareFrom = async () => {
      await page.locator('tr[data-box="chance"]').click();
      await page.locator('tr[data-box="chance"]').click();
      await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
      await page.evaluate(() => { window.shared = null; });
      await page.click('#b-share');
      await page.waitForFunction(() => window.shared);
      return page.evaluate(() => window.shared.text);
    };
    await page.evaluate(() => { window.fullHouse.settings.pace = 'score'; });
    await finishAs(1, 1, 1, 0, 20);
    assert.match(await shareFrom(), /^Full House, table 2: Evens\. Maud beat me, 2\d\d to 9\. https:\/\/full-house\.junkdrawer\.works\/#table=2&dice=[0-9a-z]+&score=9$/);
    await finishAs(7, 7, 7, 30, 0);
    assert.match(await shareFrom(), /^Full House, table 8: High Stakes\. I beat the Dealer, \d+ to 0\. That’s the whole tour\. https:\/\/full-house\.junkdrawer\.works\/#table=8&dice=[0-9a-z]+&score=\d+$/);
    await finishAs(null, 2, 0, 30, 0);
    assert.match(await shareFrom(), /^Full House, quick game: Classic\. I beat Bea, \d+ to 0\. https:\/\/full-house\.junkdrawer\.works\/#table=1&dice=[0-9a-z]+&vs=3&score=\d+$/);
  });

  await step('today’s table is open to all with the same dice for everyone, and its first game, won or given up, is the one that counts', async t => {
    const { page, game } = t;
    // A day whose table is Triple Sixes, which has the Chance box the last turn here is played in.
    await page.clock.setFixedTime(new Date(2026, 10, 17, 12));
    await page.reload();
    assert.equal(await page.textContent('#today-row b'), 'Triple Sixes');
    const d = await page.evaluate(async () => (await import('./js/links.js')).today());
    const name = await page.evaluate(async i => { const { TABLES } = await import('./js/tour.js'); return [TABLES[i].board.name, TABLES[i].who.name]; }, d.table);
    const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(d.day.slice(5, 7)) - 1];
    const dated = `${Number(d.day.slice(8))} ${month}`;
    // On the tour from the first visit, with nothing beaten.
    assert.ok(await page.isVisible('#today-row [data-day]'));
    assert.equal(await page.textContent('#today-row b'), name[0]);
    assert.match(await page.textContent('#today-row .vs'), new RegExp(name[1]));
    assert.equal(await page.textContent('#today-row small'), 'The same dice for everyone today');
    assert.equal(await page.textContent('#today-row .n'), String(Number(d.day.slice(8))));
    await page.click('#today-row [data-day]');
    await page.waitForSelector('#sheet-intro:not([hidden])');
    assert.equal(await page.textContent('#intro-n'), `Today’s table · ${dated}`);
    assert.equal(await page.textContent('#intro-title'), name[0]);
    assert.equal(await page.textContent('#intro-note'), 'Everyone has the same dice today. Your first game is the one that counts, here and not on the tour.');
    await page.click('#b-sit');
    let g = await game();
    assert.deepEqual([g.kind, g.day, g.seed, g.opp, g.table, g.board.id === (await page.evaluate(async i => (await import('./js/tour.js')).TABLES[i].board.id, d.table))], ['day', d.day, d.seed, d.table, null, true]);
    assert.equal(await page.textContent('#g-table'), `Today’s table: ${name[0]}`);

    // Won: it counts for today, and the tour says so.
    await win(t);
    assert.equal(await page.textContent('#result-n'), `Today’s table · ${dated}`);
    assert.equal(await page.textContent('#result-line'), 'That one counts for today. There’s a new table tomorrow.');
    let p = await page.evaluate(() => window.fullHouse.progress);
    const you = await page.textContent('#pad tfoot td.you').then(Number), them = await page.textContent('#pad tfoot td.them').then(Number);
    assert.deepEqual([p.today, p.days, p.played.length, p.quick.played], [{ day: d.day, you, them }, { played: 1, won: 1 }, 0, 0]);
    await page.evaluate(() => { window.shared = null; navigator.share = async data => { window.shared = data; }; });
    await page.click('#b-share');
    await page.waitForFunction(() => window.shared);
    assert.equal((await page.evaluate(() => window.shared)).text, `Full House, today’s table (${dated}): ${name[0]}. I beat ${name[1].replace(/^The /, 'the ')}, ${you} to ${them}. https://full-house.junkdrawer.works/#table=${d.table + 1}&dice=${d.seed.toString(36)}&score=${you}`);

    // Again: the same dice, just practice, counting for nothing.
    assert.equal(await page.textContent('#b-next'), 'Play the same dice again');
    await page.click('#b-next');
    g = await game();
    assert.deepEqual([g.kind, g.seed, g.day], ['day', d.seed, d.day]);
    await win(t);
    assert.equal(await page.textContent('#result-line'), 'Just practice: your first game today is the one that counts.');
    p = await page.evaluate(() => window.fullHouse.progress);
    assert.deepEqual([p.today.you, p.days], [you, { played: 1, won: 1 }]);
    await page.click('#b-tour');
    assert.equal(await page.textContent('#today-row small'), `Today: you ${you}, ${name[1].replace(/^The /, 'the ')} ${them} · won 1 of 1 day`);
    assert.equal(await page.getAttribute('#today-row > div', 'class'), 'beaten');
    await page.click('#today-row [data-day]');
    assert.equal(await page.textContent('#intro-note'), `Today’s game is in: you ${you}, ${name[1].replace(/^The /, 'the ')} ${them}. Another go is just practice.`);

    // Given up as the day's first game: it counts, as a game played and not won, and survives a reload.
    await page.evaluate(() => { window.fullHouse.progress.today = null; });
    await page.click('#b-sit');
    await page.click('#b-menu');
    await page.click('#b-concede');
    await page.click('#b-concede');
    p = await page.evaluate(() => window.fullHouse.progress);
    assert.deepEqual([p.today, p.days], [{ day: d.day, you: null, them: null }, { played: 2, won: 1 }]);
    await page.reload();
    assert.equal(await page.textContent('#today-row small'), 'Today: given up · won 1 of 2 days');
  });

  await step('Two players: Black and Red take turns at one phone, Red’s dice red and the red column taking the taps, and nothing counts', async ({ page, game, settled }) => {
    const filledIn = card => Object.entries(card).filter(([k, v]) => k !== 'extras' && v !== null).length;
    // There from the first visit, nothing beaten.
    assert.equal(await page.textContent('#b-two'), 'Black and Red');
    await page.click('#b-two');
    await page.waitForSelector('#sheet-two:not([hidden])');
    assert.ok(await page.isHidden('#two-warn'), 'no game to end');
    await page.fill('#two-a', '  Mum ');
    await page.click('#b-two-sit');
    let g = await game();
    assert.deepEqual([g.kind, g.names, g.table, g.board.id], ['two', ['Mum', 'Red'], null, 'classic']);
    assert.equal(await page.textContent('#g-table'), 'Two players');
    assert.equal(await page.textContent('#g-twist'), 'Mum against Red\u00a0· turn 1 of 13');
    assert.deepEqual(await page.locator('#pad thead th').allTextContents(), ['Box', 'Mum', 'Red']);
    assert.equal(await page.textContent('#status'), 'Mum’s turn. Roll the dice.');
    await page.evaluate(() => { window.fullHouse.settings.pace = 'quick'; });
    const dice = await page.evaluate(async seed => { const { rollFor } = await import('./js/rng.js'); return [rollFor(seed, 1, 1, 0), rollFor(seed, 1, 1, 1)]; }, g.seed);

    // Black's turn: roll and score. Then the phone goes to Red.
    await page.click('#b-roll');
    await settled();
    assert.deepEqual((await game()).dice, dice[0]);
    assert.equal(await page.locator('#pad td.them.offer').count(), 0);
    await page.locator('tr.can').first().click();
    await page.locator('tr.can').first().click();
    g = await game();
    assert.deepEqual([g.turn, g.number, g.rolls, filledIn(g.you), filledIn(g.them)], ['them', 1, 0, 1, 0]);
    assert.equal(await page.textContent('#status'), 'Red’s turn. Roll the dice.');
    assert.equal(await page.textContent('#b-roll'), 'Roll');
    assert.ok(await page.evaluate(() => document.getElementById('tray').classList.contains('theirs')), 'Red’s dice are red');

    // Red's turn: their own dice, and the red column takes the taps.
    await page.click('#b-roll');
    await settled();
    assert.deepEqual((await game()).dice, dice[1]);
    assert.ok(await page.locator('#pad td.them.offer').count() > 0, 'the red column shows what Red’s dice would score');
    assert.equal(await page.locator('#pad td.you.offer').count(), 0);
    const red = await page.locator('tr.can').first().getAttribute('data-box');
    await page.locator('tr.can').first().click();
    assert.match(await page.textContent('#status'), /^Tap .* again/);
    await page.locator('tr.can').first().click();
    g = await game();
    assert.notEqual(g.them[red], null);
    assert.deepEqual([g.turn, g.number, filledIn(g.you), filledIn(g.them)], ['you', 2, 1, 1]);
    assert.equal(await page.textContent('#status'), 'Mum’s turn. Roll the dice.');
    assert.ok(await page.evaluate(() => !document.getElementById('tray').classList.contains('theirs')));
    // Nobody plays for Red, after a reload either.
    await page.reload();
    await page.waitForTimeout(1200);
    g = await game();
    assert.deepEqual([g.turn, filledIn(g.them), await page.evaluate(() => window.fullHouse.busy)], ['you', 1, false]);
    await page.evaluate(() => {
      const g = structuredClone(window.fullHouse.game);
      g.turn = 'them';
      window.fullHouse.set(g);
    });
    await page.waitForTimeout(1200);
    g = await game();
    assert.deepEqual([g.turn, g.rolls, filledIn(g.them)], ['them', 0, 1], 'Red’s turn waits for Red');

    // The last turns, and the result: who won, with nothing counted anywhere and nothing to share.
    await page.evaluate(() => {
      const g = structuredClone(window.fullHouse.game);
      for (const b of g.board.boxes) { g.you[b.id] = b.id === 'chance' ? null : 20; g.them[b.id] = b.id === 'chance' ? null : 5; }
      Object.assign(g, { number: 13, rolls: 0, turn: 'you' });
      window.fullHouse.settings.pace = 'quick';
      window.fullHouse.set(g);
    });
    assert.equal(await page.textContent('#status'), 'Mum’s last turn. Roll the dice.');
    for (const who of ['Red', null]) {
      await page.click('#b-roll');
      await settled();
      await page.locator('tr.can').first().click();
      await page.locator('tr.can').first().click();
      if (who) assert.equal(await page.textContent('#status'), `${who}’s last turn. Roll the dice.`);
    }
    await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
    const [a, r] = [await page.textContent('#pad tfoot td.you').then(Number), await page.textContent('#pad tfoot td.them').then(Number)];
    assert.ok(a > r);
    assert.equal(await page.textContent('#result-title'), 'Mum wins');
    assert.match(await page.textContent('#result-line'), /^Mum’s (top|bottom) section came to \d+ and Red’s to \d+\.$/);
    assert.deepEqual(await page.locator('#result-scores span').allTextContents(), ['Mum', 'Red']);
    assert.ok(await page.isHidden('#result-says'), 'Red has an opponent’s line');
    assert.ok(await page.isHidden('#b-share'));
    assert.ok(await page.isHidden('#b-again'));
    assert.ok(await page.isHidden('#result-n'));
    const p = await page.evaluate(() => window.fullHouse.progress);
    assert.deepEqual([p.played.length, p.won.length, p.beaten.length, p.quick.played, p.days.played], [0, 0, 0, 0, 0]);
    assert.equal(await page.textContent('#b-next'), 'Play again');
    await page.click('#b-next');
    g = await game();
    assert.deepEqual([g.kind, g.names, g.number, g.over], ['two', ['Mum', 'Red'], 1, undefined]);

    // Play again lets the other player start: Red rolls first, in red, and the round ends after Mum's turn.
    assert.deepEqual([g.turn, g.first], ['them', 'them']);
    assert.equal(await page.textContent('#status'), 'Red’s turn. Roll the dice.');
    assert.ok(await page.evaluate(() => document.getElementById('tray').classList.contains('theirs')), 'Red’s dice aren’t red as Red starts');
    assert.deepEqual(await page.locator('#pad thead th').allTextContents(), ['Box', 'Mum', 'Red'], 'the columns swapped');
    for (const [turn, number, next] of [['you', 1, 'Mum’s turn. Roll the dice.'], ['them', 2, 'Red’s turn. Roll the dice.']]) {
      await page.click('#b-roll');
      await settled();
      await page.locator('tr.can').first().click();
      await page.locator('tr.can').first().click();
      g = await game();
      assert.deepEqual([g.turn, g.number], [turn, number]);
      assert.equal(await page.textContent('#status'), next);
    }
    // A reload part way through Red's turn keeps it: a save further on in the round is the same game, not an older one.
    await page.reload();
    g = await game();
    assert.deepEqual([g.turn, g.number, g.first], ['them', 2, 'them']);
    // Red has the last turn of all now: Mum's card fills last, and the game after this one is Mum's to start again.
    await page.evaluate(() => {
      const g = structuredClone(window.fullHouse.game);
      for (const b of g.board.boxes) { g.you[b.id] = b.id === 'chance' ? null : 20; g.them[b.id] = b.id === 'chance' ? null : 5; }
      Object.assign(g, { number: 13, rolls: 0, turn: 'them' });
      window.fullHouse.set(g);
    });
    assert.equal(await page.textContent('#status'), 'Red’s last turn. Roll the dice.');
    for (const who of ['Mum', null]) {
      await page.click('#b-roll');
      await settled();
      await page.locator('tr.can').first().click();
      await page.locator('tr.can').first().click();
      if (who) assert.equal(await page.textContent('#status'), `${who}’s last turn. Roll the dice.`);
    }
    await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
    assert.equal(await page.textContent('#result-title'), 'Mum wins');
    await page.click('#b-next');
    g = await game();
    assert.deepEqual([g.turn, g.first, g.number], ['you', 'you', 1]);
    assert.equal(await page.textContent('#status'), 'Mum’s turn. Roll the dice.');

    // Ending one part way is two taps, and no loss for anyone.
    await page.click('#b-menu');
    assert.equal(await page.textContent('#b-concede'), 'End this game');
    await page.click('#b-concede');
    assert.equal(await page.textContent('#b-concede'), 'Tap again to end it.');
    await page.click('#b-concede');
    assert.equal(await page.evaluate(() => document.body.dataset.screen), 'home');
    assert.ok(await page.isHidden('#toast'));
    assert.deepEqual(await page.evaluate(() => [window.fullHouse.progress.quick.played, window.fullHouse.settings.names]), [0, ['Mum', '']]);
    assert.equal(await page.textContent('#b-two'), 'Mum and Red');
  });

  await step('leaving a game that counts nowhere says it is no loss', async ({ page }) => {
    // Part way through a friend's game: sitting down elsewhere ends it, with no loss.
    await page.goto(`${base}#table=1&dice=1&score=100`);
    await page.waitForSelector('#sheet-intro:not([hidden])');
    await page.click('#b-sit');
    await page.click('#b-menu');
    await page.click('#b-concede');
    assert.equal(await page.textContent('#b-concede'), 'Tap again to give up.');
    await page.keyboard.press('Escape');
    await page.click('#b-home');
    await page.click('[data-table="0"]');
    assert.match(await page.textContent('#intro-who'), /Sitting down here ends the game you’re in\.$/);
    await page.click('#sheet-intro .plain[data-close]');
    await page.click('#b-two');
    assert.equal(await page.textContent('#two-warn'), 'Sitting down here ends the game you’re in.');
    // From a two-player game, a table that counts says it does.
    await page.click('#b-two-sit');
    await page.click('#b-home');
    await page.click('[data-table="0"]');
    assert.match(await page.textContent('#intro-who'), /Sitting down here ends the game you’re in\.$/);
    await page.click('#sheet-intro .plain[data-close]');
    await page.evaluate(() => window.fullHouse.start(0));
    await page.click('#b-home');
    await page.click('#b-two');
    assert.equal(await page.textContent('#two-warn'), 'Sitting down here ends the game you’re in. It counts as a\u00a0loss.');
    await page.click('#sheet-two .plain[data-close]');
  });

  await step('a two-player result keeps no line from the game before over its title', async ({ page, settled }) => {
    // A friend's game finished, then a two-player one: its result is labelled by its own title alone.
    for (const kind of ['friend', 'two']) {
      await page.evaluate(k => {
        const fh = window.fullHouse;
        fh.start(null, 0, 0, k === 'two' ? { kind: 'two', names: ['Black', 'Red'] } : { kind: 'friend', seed: 1, score: 100 });
        const g = structuredClone(fh.game);
        for (const b of g.board.boxes) { g.you[b.id] = b.id === 'chance' ? null : 20; g.them[b.id] = 5; }
        Object.assign(g, { number: 13, rolls: 0, turn: 'you' });
        fh.settings.pace = 'quick';
        fh.set(g);
      }, kind);
      await page.click('#b-roll');
      await settled();
      await page.locator('tr.can').first().click();
      await page.locator('tr.can').first().click();
      await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
      assert.equal(await page.textContent('#result-n'), kind === 'friend' ? 'The same dice your friend had' : '');
      // Pip has his word at a friend's table; at Two players nobody has, not even the opponent from the game before.
      if (kind === 'friend') assert.equal(await page.textContent('#result-says'), 'Pip: I kept all the fours. Was that wrong?');
      else assert.ok(await page.isHidden('#result-says'), 'a two-player result has a line from the opponent');
      await page.click('#b-look');
    }
  });

  await step('with all five dice held there is nothing to roll', async ({ page, game, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-roll');
    await settled();
    for (let i = 0; i < 5; i++) await page.click(`.die >> nth=${i}`);
    assert.equal(await page.getAttribute('#b-roll', 'aria-disabled'), 'true', 'Roll is on with every die held');
    // The line and the button say why, so a grey button doesn't look broken.
    assert.equal(await page.textContent('#status'), 'All five held. Let one go to roll again, or pick a box to score in.');
    assert.equal(await page.textContent('#b-roll'), 'All five held');
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press(' ');
    assert.equal((await game()).rolls, 1, 'a roll was used up with every die held');
    // Let one go and you can roll again.
    await page.click('.die >> nth=4');
    assert.equal(await page.getAttribute('#b-roll', 'aria-disabled'), 'false');
    assert.equal(await page.textContent('#b-roll'), 'Roll again (2\u00a0left)');
    assert.doesNotMatch(await page.textContent('#status'), /All five held/);
  });

  await step('while your dice are in the air the line under them is empty, at the same height', async ({ page, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    const line = () => page.evaluate(() => { const e = document.getElementById('status'); return { said: e.textContent, height: e.getBoundingClientRect().height, busy: window.fullHouse.busy }; });
    const before = await line();
    assert.equal(before.said, 'Your turn. Roll the dice.');
    await page.click('#b-roll');
    assert.deepEqual(await line(), { said: '', height: before.height, busy: true }, 'the line while the first roll is in the air');
    await settled();
    assert.notEqual((await line()).said, '', 'no line once the dice land');
    // A box picked, then a roll: "Tap ... again" doesn't stay under the new dice.
    await page.locator('tr.can').first().click();
    assert.match((await line()).said, /^Tap .* again/);
    await page.click('#b-roll');
    assert.deepEqual(await line(), { said: '', height: before.height, busy: true }, 'the line while the second roll is in the air');
    await settled();
    assert.notEqual((await line()).said, '');
  });

  await step('after the last roll the Held tags come off, while the opponent’s still show', async ({ page, game, settled, myTurn }) => {
    await page.evaluate(() => window.fullHouse.start(0));
    await page.evaluate(() => { window.fullHouse.settings.pace = 'quick'; });
    await page.click('#b-roll');
    await settled();
    await page.click('.die >> nth=0');
    await page.click('.die >> nth=1');
    await page.click('#b-roll');
    await settled();
    assert.equal(await page.locator('.die.held').count(), 2, 'with a roll left the held dice say so');
    await page.click('#b-roll');
    await settled();
    assert.match(await page.textContent('#b-roll'), /No rolls left/);
    assert.equal(await page.locator('.die.held').count(), 0, 'dice are tagged Held with no rolls left');
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.die')].map(d => d.getAttribute('aria-pressed'))), ['false', 'false', 'false', 'false', 'false']);
    assert.deepEqual((await game()).held.slice(0, 2), [true, true], 'the game forgot what was held');
    // The opponent's holds show while they roll, after their last roll too: a seed on which Pip holds some dice, not
    // all, for that last roll (found the way the game plays their turn, from the seed and the turn number).
    await page.evaluate(async () => {
      const [{ Opponent }, { TABLES }, { mulberry32 }] = await Promise.all(['./js/ai.js', './js/tour.js', './js/rng.js'].map(u => import(u)));
      const g = structuredClone(window.fullHouse.game), b = g.board, opp = new Opponent(TABLES[0].play);
      for (let seed = 1; ; seed++) {
        const rand = mulberry32((seed ^ Math.imul(g.number, 0x9E3779B1)) >>> 0), roll = () => 1 + Math.floor(rand() * 6);
        let dice = Array.from({ length: 5 }, roll), keep = null;
        for (let left = b.rolls - 1; left > 0; left--) {
          keep = opp.keep(b, g.them, dice, left, rand);
          if (!keep) break;
          dice = dice.map((d, i) => (keep[i] ? d : roll()));
        }
        if (keep && keep.some(Boolean) && !keep.every(Boolean)) { g.seed = seed; break; }
      }
      Object.assign(g, { turn: 'them', rolls: 0, held: [false, false, false, false, false] });
      window.fullHouse.settings.pace = 'normal';
      window.fullHouse.set(g);
    });
    await page.waitForFunction(rolls => window.fullHouse.game.rolls === rolls && document.querySelector('.tray.theirs .die.held'), (await game()).board.rolls, { timeout: 30000 })
      .catch(() => assert.fail('the opponent’s Held tags did not show after their last roll'));
    await myTurn();
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

  await step('a screen reader hears the roll, the holds, the pick, the opponent’s turn and the result', async t => {
    const { page, game, myTurn, settled } = t;
    const said = () => page.evaluate(() => document.getElementById('said').textContent.trim());
    assert.equal(await page.getAttribute('#said', 'aria-live'), 'polite');
    assert.equal(await page.getAttribute('#status', 'aria-live'), null, 'the line on screen is read out as well');
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.evaluate(() => { window.fullHouse.settings.pace = 'quick'; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight), 0, 'what a screen reader hears makes the page scroll');
    await page.click('#b-roll');
    await settled();
    let g = await game();
    assert.equal(await said(), `You rolled ${g.dice.join(', ')}. 2 rolls left.`);
    await page.click('.die >> nth=0');
    await page.click('.die >> nth=2');
    assert.equal(await said(), `Holding ${g.dice[0]}, ${g.dice[2]}.`);
    await page.click('.die >> nth=0');
    await page.click('.die >> nth=2');
    assert.equal(await said(), 'Holding none.');
    const row = page.locator('tr.can').first();
    await row.click();
    assert.match(await said(), /^Tap .+ again to (score \d+|write in a 0)\.$/);
    assert.equal(await said(), await page.textContent('#status'));
    await row.click();
    assert.match(await said(), /^You score \d+ in /);
    await page.click('#tray');
    await myTurn();
    g = await game();
    const [id, score] = Object.entries(g.them).find(([k, v]) => k !== 'extras' && v !== null);
    const you = Object.entries(g.you).filter(([k, v]) => k !== 'extras' && v !== null)[0][1];
    assert.equal(await said(), `Pip scored ${score} in ${await page.textContent(`tr[data-box="${id}"] th b`)}. You ${you}, Pip ${score}. Your turn.`);
    // The last turn: what they scored, then who won and by how much.
    await win(t);
    const [mine, theirs] = await page.$$eval('#pad tfoot td', tds => tds.map(td => +td.textContent));
    assert.match(await said(), new RegExp(`^Pip scored \\d+ in Chance\\. You win, ${mine} to ${theirs}\\.$`));
    // A message is heard too.
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.fullHouse.start(0));
    await page.click('#b-menu');
    await page.click('#b-concede');
    await page.click('#b-concede');
    assert.equal(await said(), 'You gave up at table 1. Pip takes that one.');
  });

  await step('an open box is read out as what it would do, and a picked one as pressed', async ({ page, settled }) => {
    const boxes = () => page.$$eval('tr.can', rows => rows.map(r => ({ id: r.dataset.box, role: r.getAttribute('role'), label: r.getAttribute('aria-label'), pressed: r.getAttribute('aria-pressed'), shows: r.querySelector('td.you span')?.textContent ?? null })));
    await page.evaluate(() => { window.fullHouse.settings.pace = 'quick'; window.fullHouse.start(2); }); // Triple Sixes
    assert.equal(await page.textContent('#pad caption'), 'Score pad');
    await page.click('#b-roll');
    await settled();
    let open = await boxes();
    assert.ok(open.length >= 12);
    for (const b of open) {
      assert.equal(b.role, 'button');
      assert.equal(b.pressed, 'false');
      assert.ok(b.label.endsWith(b.shows === '–' ? ': write in 0' : `: score ${b.shows}`), `${b.id} is read as "${b.label}" and shows ${b.shows}`);
    }
    assert.match(open.find(b => b.id === 'f6').label, /^Sixes, times 3: /);
    assert.match(open.find(b => b.id === 'f1').label, /^Ones: /);
    await page.click('tr[data-box="f6"]');
    open = await boxes();
    assert.deepEqual(open.filter(b => b.pressed === 'true').map(b => b.id), ['f6'], 'the picked box is not the one pressed');
    // With the scores hidden, the boxes say only where you can score, and the picked one what it would score.
    await page.evaluate(() => { window.fullHouse.settings.hints = false; window.fullHouse.set(structuredClone(window.fullHouse.game)); });
    await page.click('tr[data-box="f1"]');
    open = await boxes();
    for (const b of open) if (b.id !== 'f1') assert.match(b.label, /^[^:]+: score here$/, b.label);
    assert.match(open.find(b => b.id === 'f1').label, /^Ones: (score \d+|write in 0)$/);
  });

  await step('the dice, the sheets, the settings and the page say what they are', async ({ page, myTurn, settled }) => {
    const labels = () => page.$$eval('.die', ds => ds.map(d => d.getAttribute('aria-label')));
    assert.equal(await page.title(), 'Full House');
    assert.equal(await page.locator('main').count(), 1);
    await page.click('[data-table="0"]');
    assert.equal(await page.getAttribute('#sheet-intro .dot.big', 'aria-hidden'), 'true', 'the avatar’s letter is read out');
    const describedBy = await page.getAttribute('#sheet-intro [role="dialog"]', 'aria-describedby');
    assert.deepEqual(describedBy.split(' '), ['intro-blurb', 'intro-who', 'intro-note', 'intro-locked']);
    await page.click('#b-sit');
    assert.equal(await page.title(), 'Table 1: Classic · Full House');
    assert.ok(await page.isVisible('main #tray[role="group"][aria-label="Dice"]'));
    assert.deepEqual(await labels(), [1, 2, 3, 4, 5].map(n => `Die ${n}, not rolled`), 'dice not yet rolled are read as numbers');
    await page.evaluate(() => { window.fullHouse.settings.pace = 'quick'; });
    await page.click('#b-roll');
    await settled();
    await page.click('.die >> nth=1');
    const dice = (await page.evaluate(() => window.fullHouse.game.dice));
    assert.deepEqual(await labels(), dice.map((v, i) => `Die ${i + 1}: ${v}${i === 1 ? ', held' : ''}`));
    await page.locator('tr.can').first().click();
    await page.locator('tr.can').first().click();
    await page.waitForFunction(() => document.getElementById('tray').classList.contains('theirs'), null, { timeout: 30000 });
    assert.match((await labels())[0], /^Pip’s die: [1-6](, held)?$/);
    await page.click('#tray');
    await myTurn();
    // The bar's buttons open sheets, and the settings are switches named by their bold words.
    for (const id of ['b-where', 'b-menu']) assert.equal(await page.getAttribute(`#${id}`, 'aria-haspopup'), 'dialog');
    await page.click('#b-menu');
    assert.equal(await page.getAttribute('#sheet-menu [role="dialog"]', 'aria-describedby'), 'menu-twist');
    const pace = page.getByRole('group', { name: 'Opponents’ turns', exact: true });
    assert.equal(await pace.count(), 1, 'the opponents’ pace is not a group of that name');
    assert.deepEqual(await pace.getByRole('radio').evaluateAll(rs => rs.map(r => r.labels[0].textContent)), ['Unhurried', 'Quick', 'Just their score']);
    assert.equal(await pace.getByRole('radio', { name: 'Unhurried', exact: true }).isChecked(), true, 'a new player’s pace is not Unhurried');
    assert.equal(await page.getByRole('switch', { name: 'Show what each box would score', exact: true }).count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.getAttribute('#sheet-result [role="dialog"]', 'aria-describedby'), 'result-line result-why result-scores result-says');
    await page.click('#b-home');
    assert.equal(await page.title(), 'Full House');
  });

  await step('with a contrast theme on, the dice, the used rolls, the picked box and the settings still show', async ({ page, settled }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.evaluate(() => { window.fullHouse.settings.pace = 'quick'; window.fullHouse.start(0); });
    await page.click('#b-roll');
    await settled();
    await page.locator('tr.can').first().click();
    const look = await page.evaluate(() => {
      const css = sel => getComputedStyle(document.querySelector(sel));
      return {
        face: css('.die .face').forcedColorAdjust, // the dice keep their own colours
        used: css('.rolls i.used').backgroundColor,
        open: css('.rolls i:not(.used)').backgroundColor,
        picked: css('tr.picked td.you').backgroundColor,
        unpicked: css('tr.can:not(.picked) td.you').backgroundColor,
        roll: css('#b-roll').borderTopStyle,
      };
    });
    assert.equal(look.face, 'none', 'the dice take the theme’s colours, which leaves them blank');
    assert.notEqual(look.used, look.open, 'a used roll looks like one still to come');
    assert.notEqual(look.picked, look.unpicked, 'the picked box looks like the rest');
    assert.equal(look.roll, 'solid', 'Roll has no edge');
    await page.click('#b-menu');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('o-hints')).appearance), 'auto', 'the settings show no control');
    const pace = () => page.$$eval('.seg span', ss => ss.map(s => getComputedStyle(s).backgroundColor));
    const paces = await pace();
    assert.ok(paces[0] !== paces[1] && paces[1] === paces[2], `the pace chosen looks like the others: ${paces}`);
  });

  await step('with the text enlarged, Roll, the Held tag and the bar keep all their words in view', async ({ page, settled }) => {
    const look = () => page.evaluate(() => {
      const roll = document.getElementById('b-roll'), r = roll.getBoundingClientRect(), words = document.createRange();
      words.selectNodeContents(roll);
      const w = words.getBoundingClientRect(), die = document.querySelector('.die.held'), tag = die.querySelector('.held-tag').getBoundingClientRect();
      const cut = el => el.scrollWidth > el.clientWidth + 1;
      return { roll: w.top >= r.top - 1 && w.bottom <= r.bottom + 1, overDie: Math.round(die.getBoundingClientRect().bottom - tag.top), underTray: Math.round(document.getElementById('tray').getBoundingClientRect().bottom - tag.bottom), bar: [cut(document.getElementById('g-table')), cut(document.getElementById('g-twist'))] };
    });
    await page.evaluate(() => { window.fullHouse.settings.pace = 'quick'; window.fullHouse.start(6); }); // Pairs and the Low Road, the longest name in the bar
    await page.click('#b-roll');
    await settled();
    await page.click('.die >> nth=0');
    await page.waitForTimeout(600); // risen, as a held die is
    for (const k of [1, 1.5, 2]) {
      // Text made bigger on its own, as a browser's text-only zoom does: every size in px times k.
      await page.evaluate(k => {
        for (const el of document.querySelectorAll('body *')) el.dataset.px ||= parseFloat(getComputedStyle(el).fontSize);
        for (const el of document.querySelectorAll('body *')) el.style.fontSize = `${el.dataset.px * k}px`;
      }, k);
      const seen = await look();
      assert.ok(seen.roll, `at ${k} times, Roll cuts off its words`);
      assert.ok(seen.overDie <= 0, `at ${k} times, the Held tag is ${seen.overDie}px over its die`);
      assert.ok(seen.underTray >= 8, `at ${k} times, the Held tag is on the tray's frame`);
      assert.deepEqual(seen.bar, [false, false], `at ${k} times, the bar cuts off its words`);
    }
  }, { viewport: { width: 320, height: 568 } });

  // A small window zoomed in (1024 x 640 at 200%, 1280 x 800 at 300%, 1280 x 1024 at 400%) or a small phone sideways.
  for (const [width, height] of [[512, 320], [568, 320], [427, 267], [320, 256]]) {
    await step(`in a short window (${width} x ${height}) the game scrolls, every box can be reached, and the Total stays at the foot`, async ({ page, settled }) => {
      await page.evaluate(() => { window.fullHouse.settings.pace = 'quick'; window.fullHouse.start(0); });
      await page.click('#b-roll');
      await settled();
      const look = id => page.evaluate(id => {
        const r = document.querySelector(`tr[data-box="${id}"]`).getBoundingClientRect(), t = document.querySelector('#pad tfoot th').getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, totalTop: t.top, totalBottom: t.bottom, vh: innerHeight, pad: document.querySelector('.pad-wrap').clientHeight };
      }, id);
      const open = await page.$$eval('tr.can', rows => rows.map(r => r.dataset.box));
      assert.ok((await look(open[0])).pad > 400, `the pad shows only ${(await look(open[0])).pad}px at a time`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight), 0, 'the page scrolls as well as the game');
      // Scrolled with the wheel to the foot: the last box shows above the Total, and the Total at the foot of the window.
      const roll = await page.locator('#b-roll').boundingBox();
      await page.mouse.move(roll.x + 10, roll.y + 10);
      await page.mouse.wheel(0, 3000);
      await page.waitForTimeout(400);
      let m = await look('chance');
      assert.ok(m.bottom <= m.totalTop + 1 && m.top >= 0, `Chance can't be scrolled into view: ${JSON.stringify(m)}`);
      assert.ok(m.totalBottom <= m.vh && m.totalBottom >= m.vh - 16, `the Total isn't at the foot of the window: ${JSON.stringify(m)}`); // the pad's margin under it
      // By keyboard, each open box comes into view clear of the Total as the focus reaches it, top to bottom and back.
      await page.focus(`tr[data-box="${open[0]}"]`);
      for (const [key, ids] of [['ArrowDown', open.slice(1)], ['ArrowUp', open.slice(0, -1).reverse()]]) {
        for (const id of ids) {
          await page.keyboard.press(key);
          await page.waitForTimeout(450);
          m = await look(id);
          assert.ok(m.top >= -1 && m.bottom <= m.totalTop + 1, `${id} isn't in view after ${key}: ${JSON.stringify(m)}`);
        }
      }
      // Picked from there, and scored with a tap.
      await page.keyboard.press('Enter');
      await page.locator(`tr[data-box="${open[0]}"]`).click();
      assert.notEqual((await page.evaluate(() => window.fullHouse.game)).you[open[0]], null);
    }, { viewport: { width, height } });
  }

  await step('keyboard: Space or Enter hurries the opponent, and How to play says which keys do what', async ({ page, game, myTurn, settled }) => {
    await page.click('#b-rules');
    assert.ok(await page.isVisible('#rules-list .keys'), 'How to play does not say the keys on a computer');
    assert.match(await page.textContent('#rules-list .keys'), /^On a keyboard: Space or R rolls/);
    await page.keyboard.press('Escape');
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    for (const key of ['Enter', ' ']) {
      await page.keyboard.press('r');
      await settled();
      await page.focus('tr.can >> nth=0');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter'); // scored: the focus is on Roll, and the opponent is about to play
      assert.equal(await page.evaluate(() => window.fullHouse.hurry), false);
      await page.keyboard.press(key);
      assert.equal(await page.evaluate(() => window.fullHouse.hurry), true, `${JSON.stringify(key)} did not hurry the opponent`);
      await myTurn();
      assert.equal((await game()).rolls, 0, `${JSON.stringify(key)} rolled your dice as well`);
    }
    // Held down past the end of their turn, Space doesn't roll for you as it's let go.
    await page.keyboard.press('r');
    await settled();
    await page.focus('tr.can >> nth=0');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.down(' ');
    await myTurn();
    await page.keyboard.up(' ');
    await page.waitForTimeout(100);
    assert.equal((await game()).rolls, 0, 'letting go of Space rolled for you');
  }, { desktop: true });

  await step('keyboard: the shortcuts can be turned off in the menu, on a computer only, and then R, 1 to 5 and a loose Space do nothing', async ({ page, game, myTurn, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-menu');
    const keys = page.getByRole('switch', { name: 'Keyboard shortcuts', exact: true });
    assert.ok(await keys.isVisible(), 'no Keyboard shortcuts switch on a computer');
    assert.equal(await keys.isChecked(), true, 'the shortcuts start off');
    await keys.click();
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('full-house.v1'))).settings.keys, false, 'the switch was not saved');
    await page.click('#b-menu-rules');
    assert.match(await page.textContent('#rules-list .keys'), /^On a keyboard: Tab to Roll or a die and press Space or Enter\..*The single-key shortcuts are off in the game’s menu\.$/);
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.activeElement.blur());
    for (const key of ['r', ' ', '1']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(100);
      assert.equal((await game()).rolls, 0, `${JSON.stringify(key)} rolled with the shortcuts off`);
    }
    // Space still presses what has the focus: Roll, then a die.
    await page.focus('#b-roll');
    await page.keyboard.press(' ');
    await settled();
    assert.equal((await game()).rolls, 1);
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('1');
    assert.equal((await game()).held[0], false, '1 held a die with the shortcuts off');
    await page.focus('.die >> nth=0');
    await page.keyboard.press(' ');
    assert.equal((await game()).held[0], true, 'Space on a die did not hold it');
    // Their turn: a loose Space doesn't hurry them, Enter on Roll does.
    await page.focus('tr.can >> nth=0');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press(' ');
    assert.equal(await page.evaluate(() => window.fullHouse.hurry), false, 'a loose Space hurried the opponent with the shortcuts off');
    await page.focus('#b-roll');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.fullHouse.hurry), true, 'Enter on Roll did not hurry the opponent');
    await myTurn();
    // On again, R rolls.
    await page.click('#b-menu');
    await keys.click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('r');
    await settled();
    assert.equal((await game()).rolls, 1, 'R did not roll with the shortcuts back on');
  }, { desktop: true });

  // Sound itself can't be judged here, only that it's made when it should be: each sound the page starts is noted, with how
  // much of it there is (the sum of its samples squared), and each buzz.
  await step('Sound starts off; switched on, a throw rattles, more for more dice, a score scratches, holding a die buzzes, and a game behind the tour is quiet', async ({ page, myTurn, settled }) => {
    await page.addInitScript(() => {
      window.heard = [];
      window.lengths = [];
      window.buzzed = [];
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        let energy = 0;
        for (const x of this.buffer.getChannelData(0)) energy += x * x;
        window.heard.push(energy);
        window.lengths.push(this.buffer.duration);
        return start.apply(this, args);
      };
      Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, value: ms => { window.buzzed.push(ms); return true; } });
    });
    await page.reload();
    const heard = () => page.evaluate(() => window.heard.length), buzzed = () => page.evaluate(() => window.buzzed.length);
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.evaluate(() => { window.fullHouse.settings.pace = 'quick'; });
    // Off at first: a roll and a hold make no sound and no buzz.
    await page.click('#b-roll');
    await settled();
    await page.click('.die >> nth=0');
    assert.equal(await heard(), 0, 'a sound with Sound off');
    assert.equal(await buzzed(), 0, 'a buzz with Sound off');
    await page.click('.die >> nth=0');
    await page.click('#b-menu');
    const sw = page.getByRole('switch', { name: 'Sound', exact: true });
    assert.equal(await sw.isChecked(), false, 'Sound starts on');
    await sw.click();
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('full-house.v1'))).settings.sound, true, 'the switch was not saved');
    assert.equal(await heard(), 1, 'switching Sound on makes no sound to show it works');
    await page.keyboard.press('Escape');
    // Four dice held, one buzz each; the one left rattles as it's thrown.
    for (const i of [0, 1, 2, 3]) await page.click(`.die >> nth=${i}`);
    assert.equal(await buzzed(), 4, 'holding a die does not buzz');
    await page.click('#b-roll');
    await settled();
    assert.equal(await heard(), 2, 'a throw makes no sound');
    const row = page.locator('tr.can').first();
    await row.click();
    assert.equal(await heard(), 2, 'picking a box makes a sound, before anything is written');
    await row.click();
    assert.equal(await heard(), 3, 'a score written in makes no sound');
    // The opponent's first throw is all five dice: more of a rattle than your one die.
    await myTurn();
    // (Heard so far: the switch, your one die, your score, then the opponent's five dice.)
    const [one, five] = await page.evaluate(() => [window.heard[1], window.heard[3]]);
    assert.ok(five > 2 * one, `five dice thrown (${five.toFixed(1)}) are not much more of a rattle than one (${one.toFixed(1)})`);
    assert.ok(await heard() > 4, 'the opponent’s turn makes no sound');
    // Where motion is cut down the dice land at once, so their rattle is a quick clatter, not one that goes on after them.
    // Your score goes in, then back to the tour before the opponent rolls: their turn, played out behind it, is quiet.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.click('#b-roll');
    await settled();
    const [thrown, still] = await page.evaluate(() => [window.lengths[1], window.lengths.at(-1)]);
    assert.ok(thrown > 0.45 && still < 0.3, `with motion cut down the rattle lasts ${still.toFixed(2)} s, against ${thrown.toFixed(2)} s for dice that tumble`);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const before = await heard();
    await row.click();
    await row.click();
    await page.click('#b-home');
    await page.waitForFunction(() => window.fullHouse.game?.turn === 'you', null, { timeout: 30000 });
    assert.equal(await heard(), before + 1, 'the opponent’s turn behind the tour made a sound');
    // Still on after a reload, and once off, quiet again.
    await page.reload();
    if (await page.isVisible('#b-continue')) await page.click('#b-continue'); // the reload may open on the game itself
    await page.click('#b-menu');
    assert.equal(await sw.isChecked(), true, 'Sound is off again after a reload');
    await sw.click();
    await page.keyboard.press('Escape');
    await page.click('#b-roll');
    await settled();
    await page.click('.die >> nth=0');
    assert.equal(await heard(), 0, 'a sound with Sound switched off again');
    assert.equal(await buzzed(), 0, 'a buzz with Sound switched off again');
  });

  await step('on a phone the menu has no Keyboard shortcuts switch', async ({ page }) => {
    await page.evaluate(() => window.fullHouse.start(0));
    await page.click('#b-menu');
    assert.ok(await page.isHidden('#o-keys'), 'a phone’s menu offers keyboard shortcuts');
  });

  await step('keyboard: Roll keeps the focus, so Enter on it rolls each time', async ({ page, game, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    const focused = () => page.evaluate(() => document.activeElement.id || document.activeElement.tagName);
    for (let i = 0; i < 20 && (await focused()) !== 'b-roll'; i++) await page.keyboard.press('Tab');
    assert.equal(await focused(), 'b-roll', 'Tab did not reach Roll');
    for (let n = 1; n <= 3; n++) {
      await page.keyboard.press('Enter');
      assert.equal(await focused(), 'b-roll', `the focus left Roll as roll ${n} was in the air`);
      await settled();
      assert.equal((await game()).rolls, n, `Enter ${n} did not roll`);
      assert.equal(await focused(), 'b-roll', `the focus left Roll after roll ${n}`);
    }
    // Out of rolls it stays where it is, says so, and does nothing.
    assert.equal(await page.textContent('#b-roll'), 'No rolls left');
    assert.equal(await page.getAttribute('#b-roll', 'aria-disabled'), 'true');
    await page.keyboard.press('Enter');
    assert.equal((await game()).rolls, 3);
    assert.equal(await focused(), 'b-roll');
  }, { desktop: true });

  await step('keyboard: the focus goes to what comes next, and arrows move between the open boxes', async ({ page, myTurn, settled }) => {
    const focused = () => page.evaluate(() => { const a = document.activeElement; return a.id || a.dataset.box || (a.dataset.table && `table ${a.dataset.table}`) || a.tagName; });
    await page.focus('[data-table="0"]');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter'); // Sit down
    assert.equal(await focused(), 'b-roll', 'the focus did not go to Roll as the game began');
    await page.evaluate(() => { window.fullHouse.settings.pace = 'quick'; });
    await page.keyboard.press('Enter');
    await settled();
    // One Tab from Roll is the first open box, and the arrows, Home and End go between the open ones.
    await page.keyboard.press('Tab');
    const open = await page.$$eval('tr.can', rows => rows.map(r => r.dataset.box));
    assert.equal(await focused(), open[0], 'Tab from Roll did not reach the first open box');
    for (const [key, want] of [['ArrowDown', open[1]], ['ArrowDown', open[2]], ['End', open.at(-1)], ['ArrowDown', open.at(-1)], ['ArrowUp', open.at(-2)], ['Home', open[0]], ['ArrowUp', open[0]]]) {
      await page.keyboard.press(key);
      assert.equal(await focused(), want, `${key} went to the wrong box`);
    }
    assert.equal((await page.evaluate(() => window.fullHouse.game.rolls)), 1, 'an arrow did something else as well');
    // Scored, the focus goes to Roll, which says whose turn it is, and then that it's yours.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    assert.equal(await focused(), 'b-roll', 'the focus did not go to Roll after scoring');
    assert.equal(await page.textContent('#b-roll'), 'Pip’s turn');
    await myTurn();
    assert.equal(await focused(), 'b-roll', 'the focus left Roll during the opponent’s turn');
    assert.equal(await page.textContent('#b-roll'), 'Roll');
    // Back to the tour: on Carry on. And from there into the game: on Roll.
    await page.click('#b-home');
    assert.equal(await focused(), 'b-continue', 'the focus did not go to Carry on');
    await page.keyboard.press('Enter');
    assert.equal(await focused(), 'b-roll', 'the focus did not go to Roll on carrying on');
    // The last turn: the result comes up, and closed, it hands the focus back to Roll, where Space opens it again.
    await lastTurn({ page, myTurn, settled });
    await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
    await page.keyboard.press('Escape');
    assert.equal(await focused(), 'b-roll', 'the focus did not come back to Roll from the result');
    await page.keyboard.press(' ');
    assert.ok(await page.isVisible('#sheet-result .panel'), 'Space on Roll did not open the result');
    // Back to the tour from the result: on the table that's next up.
    await page.click('#b-tour');
    assert.equal(await focused(), 'table 1', 'the focus did not go to the next table');
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
    await pipBeaten(page);
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
    assert.ok(await page.isHidden('#quick'), 'quick games are offered with no table beaten');
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

  await step('a new game’s dice show the numbers they hold, and are read out as not rolled', async ({ page, settled }) => {
    await pipBeaten(page);
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
      return [{ '0,0': 1, '0,270': 2, '270,0': 3, '90,0': 4, '0,90': 5, '0,180': 6 }[`${x},${y}`], +b.dataset.v, b.getAttribute('aria-label')];
    }));
    for (const [shown, held] of dice) assert.equal(shown, held, `a die shows ${shown} and holds ${held}`);
    assert.deepEqual(dice.map(d => d[2]), [1, 2, 3, 4, 5].map(n => `Die ${n}, not rolled`));
  });

  await step('at Wild Ones each 1 on the dice has a Wild tag on top, read out as wild, yours and the opponent’s; nowhere else', async ({ page }) => {
    const dice = () => page.$$eval('.die', ds => ds.map(d => ({
      wild: d.classList.contains('wild') && getComputedStyle(d.querySelector('.wild-tag')).opacity === '1',
      label: d.getAttribute('aria-label'),
    })));
    const deal = (table, g) => page.evaluate(([table, g]) => {
      window.fullHouse.start(table);
      window.fullHouse.set({ ...structuredClone(window.fullHouse.game), ...g });
    }, [table, g]);
    // Before a roll the faces are left over from the last one: no tag.
    await deal(4, { dice: [1, 1, 1, 1, 1] });
    await page.waitForTimeout(300);
    assert.deepEqual((await dice()).map(d => d.wild), [false, false, false, false, false], 'a 1 not yet rolled is tagged wild');
    // Rolled, the 1s are tagged and read as wild, held or not.
    await deal(4, { rolls: 1, dice: [1, 6, 1, 4, 6], held: [true, false, false, false, true] });
    await page.waitForTimeout(300);
    const shown = await dice();
    assert.deepEqual(shown.map(d => d.wild), [true, false, true, false, false]);
    assert.deepEqual(shown.map(d => d.label), ['Die 1: 1, wild, held', 'Die 2: 6', 'Die 3: 1, wild', 'Die 4: 4', 'Die 5: 6, held']);
    // On top of the die, inside the tray, clear of the Held tag under it.
    const box = sel => page.locator(sel).boundingBox();
    const [tag, held, die, tray] = await Promise.all([box('.die >> nth=0 >> .wild-tag'), box('.die >> nth=0 >> .held-tag'), box('.die >> nth=0'), box('#tray')]);
    assert.ok(tag.y < die.y && tag.y + tag.height > die.y, 'the Wild tag is not on the die’s top edge');
    assert.ok(tag.y + tag.height < held.y, 'the Wild tag runs into the Held tag');
    assert.ok(tag.y >= tray.y + 6, 'the Wild tag is off the top of the tray');
    // The opponent's dice are read the same way.
    await page.evaluate(async () => {
      const { Tray } = await import('./js/dice.js');
      const el = document.createElement('div');
      document.body.append(el);
      new Tray(el, { onToggle() {} }).show([2, 1, 3, 1, 5], [false, true, false, false, false], { theirs: true, name: 'Jules', wild: true });
      window.labels = [...el.querySelectorAll('.die')].map(d => d.getAttribute('aria-label'));
      el.remove();
    });
    assert.deepEqual(await page.evaluate(() => window.labels), ['Jules’s die: 2', 'Jules’s die: 1, wild, held', 'Jules’s die: 3', 'Jules’s die: 1, wild', 'Jules’s die: 5']);
    // No other table has wild 1s.
    await deal(0, { rolls: 1, dice: [1, 6, 1, 4, 6] });
    await page.waitForTimeout(300);
    assert.deepEqual((await dice()).map(d => d.wild), [false, false, false, false, false], 'a 1 at Classic is tagged wild');
    assert.equal((await dice())[0].label, 'Die 1: 1');
  });

  await step('a new game’s dice are simply there when you sit down, without a spin', async t => {
    const { page, settled } = t;
    const faces = () => page.evaluate(() => [...document.querySelectorAll('.die')].map(b => b.dataset.v).join(''));
    // Anything still moving in the tray: a cube turning to its new face, or a die hopping or settling. Only the dimming
    // of dice not yet rolled may fade in.
    const moving = () => page.evaluate(() => document.getElementById('tray').getAnimations({ subtree: true })
      .filter(a => !['opacity', 'filter'].includes(a.transitionProperty)).map(a => `${a.effect.target.className} ${a.transitionProperty || a.animationName}`));
    const sitDown = async how => {
      const before = await faces();
      await page.click('#b-sit');
      const m = await moving();
      assert.notEqual(await faces(), before, 'the new game has the same dice as the last, so this checks nothing');
      assert.deepEqual(m, [], `sitting down ${how}, the new game’s dice move into place`);
    };
    // From the tour, after giving up a game.
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-roll');
    await settled();
    await page.waitForTimeout(900); // landed and still
    await page.click('#b-menu');
    await page.click('#b-concede');
    await page.click('#b-concede');
    await page.click('[data-table="0"]');
    await sitDown('from the tour');
    // From the result of a game won, on to the next table, over the game just played.
    await t.page.evaluate(() => { window.fullHouse.settings.pace = 'quick'; });
    await win(t);
    await page.waitForTimeout(900);
    await page.click('#b-next');
    await sitDown('from the result');
  });

  await step('a thrown die stays inside the tray, and its corners show no hole as it turns', async ({ page }) => {
    for (const [width, height] of [[390, 844], [844, 390], [430, 932]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => { window.fullHouse.start(0); window.fullHouse.settings.pace = 'normal'; });
      await page.click('#b-roll');
      // Held still, then stepped through the tumble 20 ms at a time.
      const m = await page.evaluate(async () => {
        const tray = document.getElementById('tray'), going = tray.getAnimations({ subtree: true });
        going.forEach(a => a.pause());
        const t = tray.getBoundingClientRect(), out = { over: -99, under: -99, core: true };
        for (let ms = 0; ms <= 700; ms += 20) {
          going.forEach(a => { a.currentTime = ms; });
          for (const f of tray.querySelectorAll('.face')) {
            const r = f.getBoundingClientRect();
            out.over = Math.max(out.over, t.top - r.top);
            out.under = Math.max(out.under, r.bottom - t.bottom);
          }
          if (ms < 600) out.core &&= [...tray.querySelectorAll('.core')].every(c => getComputedStyle(c).visibility === 'visible');
        }
        going.forEach(a => a.finish());
        out.clip = getComputedStyle(tray).clipPath;
        return out;
      });
      await page.waitForFunction(() => !window.fullHouse.busy);
      await page.waitForTimeout(100);
      const size = `at ${width} x ${height}`;
      // How far depends on how each die happens to turn: at most about 6px over a dozen rolls each, against 21 to 25px
      // with the old high hop. The tray clips what gets past its edge.
      assert.ok(m.over <= 10, `${size} a die rises ${m.over.toFixed(1)}px above the tray`);
      assert.ok(m.under <= 10, `${size} a die drops ${m.under.toFixed(1)}px below the tray`);
      assert.notEqual(m.clip, 'none', `${size} nothing keeps the dice inside the tray`);
      assert.ok(m.core, `${size} a tumbling cube is hollow`);
      // At rest the cube's middle is out of sight, so it can't show through a face.
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.core')].filter(c => getComputedStyle(c).visibility !== 'hidden').length), 0, `${size} a die at rest shows its middle`);
    }
  });

  await step('the tour’s footer has the house line, then How to play, and the game’s menu has the house line at its foot', async ({ page }) => {
    assert.deepEqual(await page.locator('#home .jd-foot a, #home .jd-foot button').allTextContents(), ['Part of junkdrawer.works', 'Privacy', 'How to play']);
    const house = sel => page.locator(`${sel} .jd-foot a`).evaluateAll(as => as.map(a => [a.textContent, a.getAttribute('href')]));
    const line = [['Part of junkdrawer.works', 'https://junkdrawer.works/'], ['Privacy', 'https://junkdrawer.works/privacy.html']];
    assert.deepEqual(await house('#home'), line);
    await page.click('#b-rules');
    assert.ok(await page.isVisible('#sheet-rules .panel'));
    await page.keyboard.press('Escape');
    // In a game, where the tour's footer is out of sight: the menu has the same line, last, under Give up.
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-menu');
    assert.deepEqual(await house('#sheet-menu'), line);
    const [give, foot, panel] = await Promise.all(['#b-concede', '#sheet-menu .jd-foot', '#sheet-menu .panel'].map(s => page.locator(s).boundingBox()));
    assert.ok(foot.y >= give.y + give.height, 'the house line is not under Give up');
    assert.ok(Math.abs(foot.x + foot.width / 2 - (panel.x + panel.width / 2)) < 2, 'the house line is not centred in the menu');
    assert.ok(await page.locator('#sheet-menu .jd-foot a').evaluateAll(as => as.every(a => a.offsetParent)), 'the house line is hidden in the menu');
  });

  await step('the small buttons are a thumb high: the footer’s links, the bar’s arrows, a sheet’s ×, the quick-game names', async ({ page }) => {
    const small = sel => page.evaluate(sel => [...document.querySelectorAll(sel)].filter(e => e.offsetParent).map(e => {
      const r = e.getBoundingClientRect();
      return { what: e.getAttribute('aria-label') || e.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) };
    }).filter(b => b.h < 44 || b.w < 44), sel);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => { document.body.dataset.screen = 'home'; });
      assert.equal(await page.locator('#home .jd-foot a, #home .jd-foot button, .people button').count(), 5); // with Two players
      assert.deepEqual(await small('#home .jd-foot a, #home .jd-foot button, .people button'), [], `at ${width} wide, on the tour`);
      const foot = await page.evaluate(() => [...document.querySelectorAll('#home .jd-foot a, #home .jd-foot button')].map(e => e.getBoundingClientRect().top));
      assert.ok(foot.every(t => t === foot[0]), `at ${width} wide, the footer’s links take more than one line`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `at ${width} wide, the tour scrolls sideways`);
      await page.evaluate(() => window.fullHouse.start(6)); // Pairs and the Low Road, the longest name in the bar
      assert.deepEqual(await small('.bar button'), [], `at ${width} wide, in the game’s bar`);
      await page.click('#b-menu');
      assert.deepEqual(await small('#sheet-menu .close, #sheet-menu .jd-foot a'), [], `at ${width} wide, in the menu`);
      const menuFoot = await page.evaluate(() => [...document.querySelectorAll('#sheet-menu .jd-foot a')].map(e => e.getBoundingClientRect().top));
      assert.ok(menuFoot.length === 2 && menuFoot.every(t => t === menuFoot[0]), `at ${width} wide, the menu’s house line takes more than one line`);
      await page.click('#sheet-menu .close');
    }
  });

  await step('a quick second tap on a box, a die, the tray or a button is a tap, not a zoom, and pinch zoom stays', async ({ page, settled }) => {
    // touch-action: manipulation, which turns off double-tap zoom (on iOS Safari too) and nothing else. It isn't inherited,
    // but a browser goes by the element's and all its ancestors' together, so one of those will do.
    const touch = sel => page.evaluate(sel => [...document.querySelectorAll(sel)].filter(e => {
      for (let a = e; a; a = a.parentElement) if (getComputedStyle(a).touchAction === 'manipulation') return false;
      return true;
    }).map(e => e.id || e.className || e.tagName), sel);
    assert.deepEqual(await touch('.jd-foot a, .jd-foot button, .people button, #tables button'), [], 'on the tour');
    await page.evaluate(() => window.fullHouse.start(0));
    await page.click('#b-roll');
    await settled();
    assert.deepEqual(await touch('.tray, .die, .pad, tr.can, .bar button, #b-roll'), [], 'in the game');
    await page.click('#b-menu');
    assert.deepEqual(await touch('#sheet-menu button, #sheet-menu .toggle'), [], 'in the menu');
    assert.match(await page.getAttribute('meta[name="viewport"]', 'content'), /^width=device-width, initial-scale=1, viewport-fit=cover$/, 'the page stops pinch zoom');
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

  // The page itself never loads the big icons, so nothing else would notice one missing: a phone fetches them only as
  // it installs the game.
  await step('every icon the install uses is there, of the type and size the manifest says', async ({ page }) => {
    const at = new URL(await page.getAttribute('link[rel="manifest"]', 'href'), base);
    const { icons } = await (await fetch(at)).json();
    for (const icon of icons) {
      const res = await fetch(new URL(icon.src, at));
      assert.equal(res.status, 200, `${icon.src} is not there`);
      assert.equal(res.headers.get('content-type'), icon.type, `${icon.src} is not served as ${icon.type}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (icon.type === 'image/png') {
        assert.equal(bytes.toString('latin1', 1, 4), 'PNG', `${icon.src} is not a PNG`);
        assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes, `${icon.src} is not the size the manifest says`);
      } else assert.equal(icon.sizes, 'any', `${icon.src} has a size, which a ${icon.type} doesn’t`);
    }
    const has = (purpose, size) => icons.some(i => (i.purpose || 'any').split(' ').includes(purpose) && (!size || i.sizes === size));
    assert.ok(has('any', '192x192') && has('any', '512x512'), 'the manifest needs an icon at 192 and at 512');
    assert.ok(has('maskable'), 'the manifest has no maskable icon, the one Android crops to its own shape');
  });

  // Chrome on Android shows its large install sheet, with the pictures, only when the manifest lists screenshots it can
  // use: each at least 320 and at most 3840 pixels a side, the long side no more than 2.3 times the short one, and all of
  // one form factor the same shape. A fixed id keeps an installed copy the same app if the start address ever changes.
  await step('the install sheet has the README’s phone pictures, of the size the manifest says, and the app a fixed id', async ({ page }) => {
    const at = new URL(await page.getAttribute('link[rel="manifest"]', 'href'), base);
    const manifest = await (await fetch(at)).json();
    assert.equal(new URL(manifest.id, new URL(manifest.start_url, at)).href, base, 'the app’s id is not the game’s address');
    assert.ok(manifest.description, 'the install sheet has no description');
    const shots = manifest.screenshots || [];
    assert.ok(shots.length >= 3, 'the install sheet has fewer than three pictures');
    const shapes = new Set();
    for (const shot of shots) {
      assert.match(shot.src, /^docs\/phone-[a-z]+\.png$/, `${shot.src} is not one of the README’s phone pictures`);
      const res = await fetch(new URL(shot.src, at));
      assert.equal(res.status, 200, `${shot.src} is not there`);
      assert.equal(res.headers.get('content-type'), shot.type, `${shot.src} is not served as ${shot.type}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      assert.equal(bytes.toString('latin1', 1, 4), 'PNG', `${shot.src} is not a PNG`);
      const [w, h] = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
      assert.equal(`${w}x${h}`, shot.sizes, `${shot.src} is not the size the manifest says`);
      assert.ok(Math.min(w, h) >= 320 && Math.max(w, h) <= 3840 && Math.max(w, h) / Math.min(w, h) <= 2.3, `${shot.src} is a size Chrome won’t show`);
      assert.equal(shot.form_factor, 'narrow', `${shot.src} is not marked as a phone picture`);
      assert.ok(shot.label, `${shot.src} has no words for a screen reader`);
      shapes.add((w / h).toFixed(3));
    }
    assert.equal(shapes.size, 1, 'the phone pictures are not all the same shape');
  });

  await step('a quick game asks first when it would end the game you’re in', async ({ page, game }) => {
    await pipBeaten(page);
    const progress = () => page.evaluate(() => window.fullHouse.progress);
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-home');
    await page.click('[data-quick="0"]');
    await page.waitForSelector('#sheet-intro:not([hidden])');
    assert.equal(await page.textContent('#intro-n'), 'Quick game');
    assert.equal(await page.textContent('#intro-title'), 'Classic');
    assert.match(await page.textContent('#intro-who'), /Pip.*Sitting down here ends the game you’re in\. It counts as a\u00a0loss\.$/);
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

  await step('once two tables are beaten, a quick game can be played by the rules of any table you’ve beaten, and never counts on the tour', async ({ page, game }) => {
    // One table beaten: no choice, Classic rules.
    await pipBeaten(page);
    assert.ok(await page.isHidden('#quick-tables'), 'a choice of tables with only one beaten');
    assert.equal(await page.textContent('#quick-blurb'), 'Classic rules against anyone you’ve met on the tour.');
    // Three beaten: Classic, Evens and Triple Sixes, Classic chosen.
    await page.evaluate(() => localStorage.setItem('full-house.v1', JSON.stringify({ progress: { beaten: [true, true, true], best: [200, 210, 220], played: [1, 1, 1], won: [1, 1, 1] } })));
    await page.reload();
    assert.ok(await page.isVisible('#quick-tables'));
    assert.equal(await page.textContent('#quick-blurb'), 'The rules of any table you’ve beaten, against anyone you’ve met on the tour. They don’t count on the tour.');
    const group = page.getByRole('group', { name: 'Rules', exact: true });
    assert.deepEqual(await group.getByRole('radio').evaluateAll(rs => rs.map(r => r.labels[0].textContent)), ['Classic', 'Evens', 'Triple Sixes']);
    assert.ok(await group.getByRole('radio', { name: 'Classic', exact: true }).isChecked());
    assert.deepEqual(await page.$$eval('#quick-at span', ss => ss.filter(e => e.getBoundingClientRect().height < 44 || e.getBoundingClientRect().width < 44).map(e => e.textContent)), [], 'a table to choose is smaller than a thumb');
    // Classic still plays as before.
    await page.click('[data-quick="2"]');
    assert.equal(await page.textContent('#g-table'), 'Quick game');
    assert.equal((await game()).board.id, 'classic');
    await page.click('#b-home');
    // Wild Ones isn't beaten, so it isn't offered; Triple Sixes is, against Pip.
    await page.click('#quick-at label:nth-child(3)');
    await page.click('[data-quick="0"]');
    await page.waitForSelector('#sheet-intro:not([hidden])'); // it would end the Classic game in progress, so it asks first
    assert.equal(await page.textContent('#intro-title'), 'Triple Sixes');
    assert.equal(await page.textContent('#intro-n'), 'Quick game');
    await page.click('#b-sit');
    let g = await game();
    assert.equal(g.table, null);
    assert.equal(g.opp, 0);
    assert.equal(g.board.id, 'sixes');
    assert.equal(await page.textContent('#g-table'), 'Quick game: Triple Sixes');
    assert.equal(await page.locator('tr[data-box="f6"] .mult').count(), 1, 'the Sixes box is not marked ×3');
    await page.click('#b-home');
    assert.equal(await page.textContent('#b-continue span'), 'Quick game: Triple Sixes, against Pip. Turn 1 of 13.');
    // The choice is kept for next time.
    await page.reload();
    await page.click('#b-home');
    assert.ok(await page.getByRole('radio', { name: 'Triple Sixes', exact: true }).isChecked(), 'the table chosen was forgotten');
    // Win it: counted as a quick game, not at table 3, and Play again keeps Triple Sixes' rules.
    await page.click('#b-continue');
    const before = await page.evaluate(() => structuredClone(window.fullHouse.progress));
    await page.evaluate(() => {
      window.fullHouse.settings.pace = 'score';
      const g = structuredClone(window.fullHouse.game);
      for (const b of g.board.boxes) { g.you[b.id] = b.id === 'chance' ? null : 20; g.them[b.id] = b.id === 'chance' ? null : b.id === 'five' ? 0 : 5; }
      Object.assign(g, { number: 13, rolls: 1, turn: 'you' });
      window.fullHouse.set(g);
    });
    await page.click('tr[data-box="chance"]');
    await page.click('tr[data-box="chance"]');
    await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
    const after = await page.evaluate(() => window.fullHouse.progress);
    assert.deepEqual([after.played, after.won, after.best, after.beaten], [before.played, before.won, before.best, before.beaten], 'a quick game counted on the tour');
    assert.equal(after.quick.played, before.quick.played + 1);
    assert.equal(after.quick.won, before.quick.won + 1);
    assert.ok(await page.isHidden('#result-best'));
    await page.click('#b-next');
    g = await game();
    assert.equal(g.number, 1);
    assert.equal(g.board.id, 'sixes', 'Play again went back to Classic');
    assert.equal(await page.textContent('#g-table'), 'Quick game: Triple Sixes');
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
    assert.ok(await page.isVisible('#rules-list li >> nth=0'));
    assert.ok(await page.isHidden('#rules-list .keys'), 'a phone is told about the keyboard');
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

  await step('on a computer the opponent’s card sits under Roll, with the table’s twist, clear of the pad; not on a phone, nor at Two players', async ({ page }) => {
    const card = () => page.evaluate(() => {
      const el = document.getElementById('opp-card'), r = el.getBoundingClientRect(), pad = document.getElementById('pad').getBoundingClientRect();
      return { shown: !!el.offsetParent, text: [...el.querySelectorAll('b, span, .twist')].map(e => e.textContent).join('\n'), bottom: r.bottom, right: r.right, padLeft: pad.left, height: innerHeight };
    });
    await page.evaluate(() => window.fullHouse.start(5)); // Hot Boxes, against Otto
    for (const [width, height] of [[1280, 800], [1024, 768]]) {
      await page.setViewportSize({ width, height });
      const c = await card();
      assert.ok(c.shown, `no opponent’s card at ${width} x ${height}`);
      const { board } = await page.evaluate(() => window.fullHouse.game);
      const hot = board.boxes.filter(b => b.mult > 1).length;
      assert.equal(hot, 2);
      assert.match(c.text, /Otto\s+Steady\. Hardly puts a foot wrong\.\s+Two boxes, picked at random.*This time it’s \w[\w ]* and \w[\w ]*\.$/s, 'the card is not Otto’s, with the twist and the hot boxes');
      assert.ok(c.bottom <= c.height, `the card runs off the foot of the screen at ${width} x ${height}`);
      assert.ok(c.right <= c.padLeft, `the card runs into the pad at ${width} x ${height}`);
    }
    // A table with no hot boxes says only its twist; a phone, upright or sideways, has no card, nor a window too short for it.
    await page.evaluate(() => window.fullHouse.start(7));
    assert.match((await card()).text, /^The Dealer\s+Hasn’t lost a game in years\.\s+Four rolls a turn/);
    for (const [width, height] of [[390, 844], [932, 430], [900, 600]]) {
      await page.setViewportSize({ width, height });
      assert.equal((await card()).shown, false, `an opponent’s card at ${width} x ${height}, a phone or a short window`);
    }
    // At Two players the other side of the pad is a person: no card.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => window.fullHouse.start(null, 0, 0, { kind: 'two', names: ['Black', 'Red'] }));
    assert.equal((await card()).shown, false, 'an opponent’s card at Two players');
  }, { desktop: true });

  await step('on an upright tablet the dice are a third bigger and the pad a fifth, reaching near the foot of the screen; phones and computers as they were', async ({ page }) => {
    const sizes = () => page.evaluate(() => {
      const row = document.querySelector('#pad tbody tr[data-box="f1"]').getBoundingClientRect(), wrap = document.querySelector('.pad-wrap');
      return { die: document.querySelector('.die').getBoundingClientRect().width, row: row.height, label: parseFloat(getComputedStyle(document.querySelector('#pad th[scope="row"] b')).fontSize),
        bottom: document.getElementById('pad').getBoundingClientRect().bottom, scrolls: wrap.scrollHeight > wrap.clientHeight + 1, height: innerHeight,
        tag: document.querySelector('.held-tag').getBoundingClientRect().bottom, tray: document.getElementById('tray').getBoundingClientRect().bottom };
    });
    await page.evaluate(() => window.fullHouse.start(0));
    // Not tall enough to count as a tablet in the browser (an older iPad with Safari's bars): phone size, as before.
    await page.setViewportSize({ width: 820, height: 960 });
    const before = await sizes();
    assert.equal(before.die, 62);
    for (const [width, height] of [[820, 1080], [744, 1133], [820, 1180]]) {
      await page.setViewportSize({ width, height });
      const now = await sizes();
      assert.ok(Math.abs(now.die / before.die - 4 / 3) < 0.03, `the dice are not a third bigger at ${width} x ${height}: ${now.die}`);
      assert.ok(Math.abs(now.row / before.row - 1.2) < 0.05, `the pad's rows are not a fifth taller at ${width} x ${height}: ${now.row} from ${before.row}`);
      assert.equal(now.label, 18, `the pad's labels are not a fifth bigger at ${width} x ${height}`);
      assert.ok(!now.scrolls && now.bottom <= height, `the pad doesn't fit the screen at ${width} x ${height}`);
      assert.ok(now.tag - 7 <= now.tray - 9, `a held die's tag reaches the tray's wooden frame at ${width} x ${height}`); // a held die sits 7px up; the frame is 9px
      if (height <= 1133) assert.ok(now.bottom >= 0.85 * height, `the pad stops well short of the foot of the screen at ${width} x ${height}: ${now.bottom}`);
    }
    // A phone, and a computer, keep their sizes.
    for (const [width, height, die] of [[390, 844, 52.65], [1280, 800, 76], [1032, 1376, 76]]) {
      await page.setViewportSize({ width, height });
      assert.ok(Math.abs((await sizes()).die - die) < 0.1, `the dice changed size at ${width} x ${height}`);
    }
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

  await step('sideways on a phone with a notch, every die lands on the felt, clear of the wooden frame', async ({ page, ctx }) => {
    const cdp = await ctx.newCDPSession(page);
    // iPhones held sideways (the notch's inset each side), then small phones with none.
    for (const [width, height, inset] of [[852, 393, 59], [844, 390, 47], [812, 375, 44], [640, 360, 0], [667, 375, 0]]) {
      await page.setViewportSize({ width, height });
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { left: inset, right: inset, top: 0, bottom: inset ? 21 : 0 } });
      await page.evaluate(() => window.fullHouse.start(0));
      await page.evaluate(() => { window.fullHouse.settings.pace = 'quick'; });
      for (let n = 0; n < 3; n++) { // each roll nudges and tilts the dice a little differently
        await page.evaluate(() => { const g = structuredClone(window.fullHouse.game); g.rolls = 0; window.fullHouse.set(g); });
        await page.click('#b-roll');
        await page.waitForFunction(() => !window.fullHouse.busy);
        await page.waitForTimeout(500); // settled from their nudge and tilt
        const m = await page.evaluate(() => {
          const t = document.querySelector('.tray').getBoundingClientRect(), felt = { left: t.left + 9, right: t.right - 9 }; // inside the 9px frame
          const dice = [...document.querySelectorAll('.die')].map(d => d.getBoundingClientRect());
          const laid = [...document.querySelectorAll('.die')].map(d => ({ left: d.offsetLeft, right: d.offsetLeft + d.offsetWidth })); // before the nudge and tilt
          return { felt, first: dice[0].left, last: dice[4].right, apart: Math.min(...laid.slice(1).map((d, i) => d.left - laid[i].right)), d: laid[0].right - laid[0].left };
        });
        const size = `at ${width} x ${height} with ${inset}px for the notch`;
        assert.ok(m.first >= m.felt.left, `${size} the first die is ${(m.felt.left - m.first).toFixed(1)}px onto the frame`);
        assert.ok(m.last <= m.felt.right, `${size} the last die is ${(m.last - m.felt.right).toFixed(1)}px onto the frame`);
        assert.ok(m.apart >= 8, `${size} the dice are only ${m.apart.toFixed(1)}px apart`);
        assert.ok(m.d >= 40, `${size} the dice are only ${m.d}px wide`);
      }
    }
  }, { viewport: { width: 852, height: 393 } });

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
      // Tall phones, a tablet, a phone held sideways and a desktop keep the roomier layout they had (an upright tablet's
      // rows a fifth taller again: see the tablet's own step).
      for (const [width, height] of [[390, 844], [412, 915], [430, 932], [768, 1024], [844, 390], [1280, 800]]) {
        await page.setViewportSize({ width, height });
        const m = await look(), at = `at table ${table + 1}, ${width} x ${height},`;
        assert.equal(m.roll, 50, `${at} the Roll button is ${m.roll}px tall`);
        assert.equal(m.row, width === 768 ? 44 : 36, `${at} a row with a hint is ${m.row}px tall`);
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
      window.fullHouse.settings.pace = 'quick';
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
      await page.waitForTimeout(700); // the box you can score shows already, so nothing glides
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

  await step('on a short phone, when no box you can score is in view after a roll, the pad brings the nearest one up', async ({ page }) => {
    // Late in a game with only bottom boxes open (or only top ones), the pad left at the other end by the opponent's pick.
    const late = (open, scrollTop) => page.evaluate(([open, scrollTop]) => {
      window.fullHouse.start(0);
      const g = structuredClone(window.fullHouse.game);
      for (const b of g.board.boxes) { g.you[b.id] = open.includes(b.id) ? null : 10; g.them[b.id] = open.includes(b.id) ? null : 8; }
      Object.assign(g, { number: 11, rolls: 0, turn: 'you' });
      window.fullHouse.settings.pace = 'quick';
      window.fullHouse.set(g);
      document.querySelector('.pad-wrap').scrollTop = scrollTop;
    }, [open, scrollTop]);
    // The open boxes wholly in the pad's window, below its top edge and above the Total.
    const inView = () => page.evaluate(() => {
      const w = document.querySelector('.pad-wrap').getBoundingClientRect(), total = document.querySelector('.pad tfoot th').getBoundingClientRect();
      return [...document.querySelectorAll('tr.can')].filter(tr => { const r = tr.getBoundingClientRect(); return r.top >= w.top - 0.5 && r.bottom <= Math.min(w.bottom, total.top) + 0.5; }).map(tr => tr.dataset.box);
    });
    const pad = () => page.evaluate(() => document.querySelector('.pad-wrap').scrollTop);
    const roll = async () => { await page.click('#b-roll'); await page.waitForFunction(() => !window.fullHouse.busy); };
    for (const [open, scrollTop, first] of [[['large', 'five', 'chance'], 0, 'large'], [['f1', 'f2'], 9999, 'f2']]) {
      await late(open, scrollTop);
      assert.deepEqual(await inView(), [], `with the pad scrolled to ${scrollTop ? 'its end' : 'its top'} an open box shows already, so this checks nothing`);
      await roll();
      await page.waitForFunction(() => document.querySelector('tr.can'));
      await page.waitForFunction(first => {
        const r = document.querySelector(`tr[data-box="${first}"]`).getBoundingClientRect(), w = document.querySelector('.pad-wrap').getBoundingClientRect();
        return r.top >= w.top - 0.5 && r.bottom <= Math.min(w.bottom, document.querySelector('.pad tfoot th').getBoundingClientRect().top) + 0.5;
      }, first, { timeout: 5000 }).catch(() => assert.fail(`after a roll with ${open.join(', ')} open and none in view, ${first} stayed out of sight`));
      assert.equal(await page.evaluate(() => scrollY || document.querySelector('.game').getBoundingClientRect().top), 0, 'the page itself moved');
      // Once one is in view, the next roll leaves the pad where it is.
      await page.waitForTimeout(700);
      const at = await pad();
      await roll();
      await page.waitForTimeout(700);
      assert.equal(await pad(), at, 'the pad moved with an open box in view');
    }
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
    await page.evaluate(() => { window.fullHouse.settings.pace = 'quick'; });
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

  await step('three games in a row each end clean', async ({ page, game, myTurn, settled }) => {
    const progress = () => page.evaluate(() => structuredClone(window.fullHouse.progress));
    const tapDice = async () => {
      const die = await page.locator('.die >> nth=2').boundingBox();
      await page.touchscreen.tap(die.x + die.width / 2, die.y + die.height / 2);
    };
    // One turn by taps: roll once, score the box that pays least (or the first), and tap the dice to hurry them along.
    const turn = async (least = false) => {
      await page.click('#b-roll');
      await settled();
      const rows = await page.$$eval('tr.can', rows => rows.map(r => ({ id: r.dataset.box, score: +r.querySelector('td.you').textContent || 0 })));
      const id = least ? rows.reduce((a, b) => (b.score < a.score ? b : a)).id : rows[0].id;
      await page.click(`tr[data-box="${id}"]`);
      await page.click(`tr[data-box="${id}"]`);
      await tapDice();
      await page.waitForFunction(() => window.fullHouse.game?.over || (window.fullHouse.game?.turn === 'you' && !window.fullHouse.busy), null, { timeout: 30000 });
    };
    // A game that has just opened: nothing left over from the last one, on the pad, in the tray, on the line or in a
    // message; then their first turn starts with nothing held.
    const opensClean = async (name, label) => {
      const s = await page.evaluate(() => ({
        cells: [...document.querySelectorAll('#pad tbody tr[data-box] td')].map(td => td.textContent.trim()).filter(Boolean),
        totals: [...document.querySelectorAll('#pad tfoot td')].map(td => td.textContent),
        marks: document.querySelectorAll('#pad .fresh, #pad .offer, #pad tr.picked, #pad tr.can').length,
        held: document.querySelectorAll('.die.held').length,
        toast: document.getElementById('toast').hidden,
        status: document.getElementById('status').textContent,
        pips: document.querySelectorAll('#rolls i.used').length,
        table: document.getElementById('g-table').textContent,
        sheets: document.querySelectorAll('.sheet:not([hidden])').length,
      }));
      assert.deepEqual(s, { cells: [], totals: ['', ''], marks: 0, held: 0, toast: true, status: 'Your turn. Roll the dice.', pips: 0, table: label, sheets: 0 }, `${label} did not open clean`);
      const g = await game();
      assert.deepEqual([g.number, g.rolls, g.turn, g.held, g.last], [1, 0, 'you', [false, false, false, false, false], null]);
      // Their first turn: the line says they roll, and nothing of theirs is held yet.
      const first = page.waitForFunction(name => {
        const said = document.getElementById('status').textContent;
        return said.endsWith(' rolls.') && { said, held: document.querySelectorAll('.die.held').length + window.fullHouse.game.held.filter(Boolean).length };
      }, name, { polling: 5, timeout: 30000 }).then(h => h.jsonValue());
      first.catch(() => {});
      await turn(true);
      assert.deepEqual(await first, { said: `${name} rolls.`, held: 0 });
    };
    // A finished game: the result is the pad's totals, and the progress moved by this one game at this table only.
    const endsClean = async (before, table, won) => {
      await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
      const r = await page.evaluate(() => ({
        result: [...document.querySelectorAll('#result-scores b')].map(b => +b.textContent),
        pad: [...document.querySelectorAll('#pad tfoot td')].map(td => +td.textContent),
      }));
      assert.deepEqual(r.result, r.pad, 'the result is not what the pad adds up to');
      assert.equal(r.result[0] > r.result[1], won, won ? 'meant to win this one' : 'meant to lose this one');
      const want = structuredClone(before);
      want.played[table] = (want.played[table] || 0) + 1;
      if (won) { want.won[table] = (want.won[table] || 0) + 1; want.beaten[table] = true; }
      want.best[table] = Math.max(want.best[table] || 0, r.result[0]);
      assert.deepEqual(await progress(), want, 'the progress moved by more than this game');
    };

    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-menu');
    await page.click('.seg label:nth-child(2)'); // Quick
    await page.keyboard.press('Escape');

    // 1. Lost at Classic, scoring as little as it can, then Play again.
    let before = await progress();
    await opensClean('Pip', 'Table 1: Classic');
    while (!(await game()).over) await turn(true);
    await endsClean(before, 0, false);
    assert.equal(await page.textContent('#b-next'), 'Play again');
    await page.click('#b-next');

    // 2. Given up part way: one game played, nothing more.
    before = await progress();
    await opensClean('Pip', 'Table 1: Classic');
    await turn();
    await page.click('#b-menu');
    await page.click('#b-concede');
    await page.click('#b-concede');
    const want = structuredClone(before);
    want.played[0] = (want.played[0] || 0) + 1;
    assert.deepEqual(await progress(), want, 'giving up moved the progress by more than one game played');
    assert.ok(await page.isVisible('#toast'), 'the tour says nothing about giving up');

    // 3. Won, from one turn before the end, then on to table 2.
    before = await progress();
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await opensClean('Pip', 'Table 1: Classic');
    await page.evaluate(() => {
      const g = structuredClone(window.fullHouse.game);
      for (const b of g.board.boxes) { g.you[b.id] = b.id === 'chance' ? null : 20; g.them[b.id] = b.id === 'chance' ? null : b.id === 'five' ? 0 : 5; }
      Object.assign(g, { number: 13, rolls: 0, turn: 'you' });
      window.fullHouse.set(g);
    });
    await myTurn();
    await turn();
    await endsClean(before, 0, true);
    await page.click('#b-next');
    await page.click('#b-sit');
    await opensClean('Maud', 'Table 2: Evens');
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
  const hosted = 'the copy for a host page takes the host’s light or dark, whatever the system’s, and plays from the disk';
  if (oneFile.includes(only) || hosted.includes(only)) execSync('node scripts/build.mjs', { cwd: root, stdio: 'ignore' });
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

  // dist/artifact.html, the same page without <html>, <head> and <body>, put inside a host's own page, as a host that
  // sets data-theme="light" or "dark" on <html> does: the host's choice wins over the system's either way.
  if (!only || hosted.includes(only)) {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const dir = await mkdtemp(join(tmpdir(), 'full-house-host-'));
    try {
      const artifact = await readFile(join(root, 'dist/artifact.html'), 'utf8');
      for (const theme of ['light', 'dark']) {
        await writeFile(join(dir, `${theme}.html`), `<!doctype html>\n<html lang="en" data-theme="${theme}">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>A host</title></head>\n<body>\n${artifact}\n</body>\n</html>\n`);
      }
      const css = await readFile(join(root, 'css/app.css'), 'utf8');
      const hex = h => `rgb(${h.match(/[0-9a-f]{2}/gi).map(x => parseInt(x, 16)).join(', ')})`;
      const palette = {
        light: hex(css.match(/^:root \{[^}]*?--table: (#[0-9a-f]{6})/m)[1]),
        dark: hex(css.match(/@media \(prefers-color-scheme: dark\) \{\s*:root \{[^}]*?--table: (#[0-9a-f]{6})/)[1]),
      };
      await step(hosted, async ({ page, myTurn, settled }) => {
        for (const theme of ['light', 'dark']) {
          await page.goto(pathToFileURL(join(dir, `${theme}.html`)).href);
          for (const scheme of ['dark', 'light']) {
            await page.emulateMedia({ colorScheme: scheme });
            assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), palette[theme], `with the host ${theme} and the system ${scheme}, the table is not the ${theme} one`);
          }
        }
        // A game, from sitting down to the opponent's first turn played out.
        await page.emulateMedia({ colorScheme: 'dark' });
        assert.equal(await page.locator('#tables li').count(), 8);
        await page.click('[data-table="0"]');
        await page.click('#b-sit');
        assert.equal(await page.evaluate(() => Math.round(document.getElementById('game').getBoundingClientRect().height)), 844, 'the game does not fill the host page');
        assert.ok(await page.locator('.pad tfoot').isVisible(), 'the pad is out of sight');
        await page.evaluate(() => { window.fullHouse.settings.pace = 'quick'; });
        await page.click('#b-roll');
        await settled();
        await page.locator('tr.can').first().click();
        await page.locator('tr.can').first().click();
        await page.waitForFunction(() => window.fullHouse.game.turn === 'them');
        await myTurn();
        assert.equal(await page.evaluate(() => window.fullHouse.game.number), 2, 'the opponent did not play its first turn');
      }, { at: pathToFileURL(join(dir, 'dark.html')).href });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

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

  // carry.js, which brings saves over from the game's old address, junkdrawer.works/full-house/, the first time it
  // opens at its own. It does nothing away from https://*.junkdrawer.works, so both addresses are routed to stand-ins
  // here: this game's files, and a carry.html that answers the way the live one does. (Not in step(), which would count
  // every request to them as leaving the site.) A stopped page fires no load event, so loads are counted as requests.
  const NEW = 'https://full-house.junkdrawer.works/', OLD = 'https://junkdrawer.works/';
  const standIn = `<!doctype html><title>junkdrawer.works</title><script>
    addEventListener('message', e => {
      if (e.origin !== 'https://full-house.junkdrawer.works' || !e.data || e.data.carry !== true) return;
      const local = {};
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('full-house.')) local[k] = localStorage.getItem(k); }
      e.source.postMessage({ carried: { local, idb: [] } }, e.origin);
    });
  </script>`;
  const oldSave = JSON.stringify({ settings: { fast: true }, progress: { beaten: [true, true, true], best: [231, 247, 260], played: [2, 1, 3], won: [1, 1, 1] }, game: null });
  async function carrying(name, fn, { home = true, init } = {}) {
    if (only && !name.includes(only)) return;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, serviceWorkers: 'block' });
    const problems = [];
    try {
      if (init) await ctx.addInitScript(init);
      await ctx.route(NEW + '**', async r => {
        let path = decodeURIComponent(new URL(r.request().url()).pathname);
        if (path === '/blank.html') return r.fulfill({ body: '<title>blank</title>', contentType: 'text/html' }); // somewhere to write a save first
        if (path.endsWith('/')) path += 'index.html';
        try { await r.fulfill({ body: await readFile(join(root, path)), contentType: TYPES[extname(path)] || 'text/html' }); } catch { await r.fulfill({ status: 404, body: '' }); }
      });
      await ctx.route(OLD + '**', r => {
        const path = new URL(r.request().url()).pathname;
        if (path === '/carry.html' && home) return r.fulfill({ body: standIn, contentType: 'text/html' });
        if (path === '/full-house/') return r.fulfill({ body: '<title>Full House</title>', contentType: 'text/html' }); // the old address
        return r.fulfill({ status: 404, body: 'Not found', contentType: 'text/html' });
      });
      ctx.on('request', r => { if (!r.url().startsWith(NEW) && !r.url().startsWith(OLD) && !r.url().startsWith('data:')) problems.push('left the site: ' + r.url()); });
      // A visit in a new tab: how long until the game opened, and how many times the page loaded to get there.
      const visit = async (at = NEW) => {
        const page = await ctx.newPage();
        page.on('pageerror', e => problems.push(e.message));
        let loads = 0;
        page.on('request', r => { if (r.isNavigationRequest() && r.frame() === page.mainFrame()) loads++; });
        const t0 = Date.now();
        await page.goto(at, { waitUntil: 'commit' }).catch(() => {}); // carry.js stops the first load
        if (at === NEW) await page.waitForFunction(() => window.fullHouse, null, { timeout: 12000 }).catch(() => assert.fail(`the game never opened: the page loaded ${loads} times in 12 s`));
        const took = Date.now() - t0;
        await page.waitForTimeout(500); // and nothing loads it again after
        return { page, took, loads: () => loads };
      };
      const storage = page => page.evaluate(() => ({ ...localStorage }));
      await fn({ visit, storage });
      assert.deepEqual(problems, [], `problems while carrying: ${name}`);
    } finally {
      await ctx.close();
    }
    console.log(`ok  ${name}`);
  }

  await carrying('carry.js: a save at the old address comes over in one reload, and the tour shows it', async ({ visit, storage }) => {
    const old = await visit(OLD + 'full-house/');
    await old.page.evaluate(save => { localStorage.setItem('full-house.v1', save); }, oldSave);
    const first = await visit();
    assert.equal(first.loads(), 2, 'the page loaded more than once again to carry the save');
    const kept = await storage(first.page);
    assert.equal(kept['full-house.v1'], oldSave, 'the save did not come over');
    assert.match(kept['junkdrawer.carried'], /^\d{4}-/, 'carrying was not noted as done');
    assert.equal(await first.page.locator('#tables li.beaten').count(), 3, 'the tour does not show the tables beaten at the old address');
    assert.match(await first.page.textContent('#tables li:nth-child(2)'), /your best 247/);
    const again = await visit();
    assert.equal(again.loads(), 1, 'the next visit tried to carry the save again');
  });

  await carrying('carry.js: with nothing at the old address to answer, the game opens in a few seconds, and gives up after three visits', async ({ visit, storage }) => {
    const first = await visit();
    assert.ok(first.took < 5000, `the game took ${first.took} ms to open`);
    assert.equal(first.loads(), 2);
    assert.equal((await storage(first.page))['junkdrawer.carry-tries'], '1');
    // A reload in the same tab plays on without asking again; the next visit, in a new tab, tries again.
    await first.page.reload();
    await first.page.waitForFunction(() => window.fullHouse);
    assert.equal(first.loads(), 3, 'a reload in the same tab tried again');
    const second = await visit();
    assert.equal(second.loads(), 2);
    assert.equal((await storage(second.page))['junkdrawer.carry-tries'], '2');
    const third = await visit();
    assert.equal(third.loads(), 2);
    const kept = await storage(third.page);
    assert.equal(kept['junkdrawer.carry-tries'], '3');
    assert.equal(kept['junkdrawer.carried'], 'gave up');
    assert.equal((await visit()).loads(), 1, 'it tried again after giving up');
  }, { home: false });

  await carrying('carry.js: with storage that can be read but not written, the game opens at once, loading only once', async ({ visit }) => {
    const first = await visit();
    assert.equal(first.loads(), 1, 'the page was stopped and loaded again, with nowhere to put a save or note that it had');
    assert.equal(await first.page.locator('#tables li').count(), 8);
  }, { init: () => { Storage.prototype.setItem = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); }; } });

  await carrying('carry.js: a save already at the new address is kept, not written over by the old one', async ({ visit, storage }) => {
    const old = await visit(OLD + 'full-house/');
    await old.page.evaluate(save => { localStorage.setItem('full-house.v1', save); }, oldSave);
    const mine = JSON.stringify({ settings: { fast: false }, progress: { beaten: [true], best: [199], played: [1], won: [1] }, game: null });
    const blank = await visit(NEW + 'blank.html');
    await blank.page.evaluate(save => { localStorage.setItem('full-house.v1', save); }, mine);
    const first = await visit();
    assert.equal(first.loads(), 2);
    const kept = await storage(first.page);
    assert.equal(kept['full-house.v1'], mine, 'the old save wrote over the one already here');
    assert.ok(kept['junkdrawer.carried'], 'carrying was not noted as done');
    assert.equal(await first.page.locator('#tables li.beaten').count(), 1);
  });

  // Offline, checked the junkdrawer house kit's way, from a server that answers like GitHub Pages: a browser may keep
// each file for ten minutes, and asks again by its ETag. `net` is the connection: 'up', 'down' (the server drops every
// connection) or 'stalled' (a plane's or a train's wifi: it takes each request and holds on to it). With `release`
// set it serves the next release. The server's own switches are needed because the browser's offline switch can't
// make a stall, and in some Chromium builds it doesn't stop the service worker's own requests. Then what the offline
// copy keeps. Run with no name given, or with offline.
if (!only || only.includes('offline')) {
  const { createServer } = await import('node:http');
  const { readFile } = await import('node:fs/promises');
  const { join, extname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { createHash } = await import('node:crypto');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const sw0 = await readFile(join(root, 'sw.js'), 'utf8');
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
  // Another project served from the same address (localhost, say) keeps its own offline copy, and an old release of
  // this one left its copy behind: the worker deletes only the old release's.
  await page.goto(base + 'manifest.webmanifest');
  await page.evaluate(() => Promise.all(['other-project-v1', 'full-house-v2', 'full-house-v2-old'].map(k => caches.open(k))));
  await page.goto(base);
  await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 });
  assert.deepEqual((await page.evaluate(() => caches.keys())).sort(), ['full-house-v2-old', sw0.match(/const CACHE = '([^']+)'/)[1], 'other-project-v1'].sort(), 'the worker deleted copies that are not its own old ones');
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
  console.log('ok  offline, on a stalled connection, and a release\'s offline copy whole and up to date');
}
} finally {
  await browser.close();
  server.close();
}
console.log('all good');
