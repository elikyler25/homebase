// ASHFALL regression harness.
//
//   npm i playwright && node games/ashfall/test.js
//
// Boots the real game in headless Chromium and asserts on live state. Every case
// below is a bug that actually shipped — each one failed before its fix and passes
// after. No mocks: it drives the same functions the game loop drives.
//
// ponytail: asserts against globals rather than a public API, because the game is
// deliberately one file with no module boundary. If it ever grows one, test that.
const { chromium } = require('playwright');
const path = require('path');

const GAME = 'file://' + path.resolve(__dirname, 'index.html');
// The container ships its own Chromium; fall back to Playwright's if absent.
const EXE = require('fs').existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  \x1b[32mPASS\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ' — ' + detail : ''}`); }
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } });
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_(CONNECTION|NAME|INTERNET)/.test(m.text())) jsErrors.push(m.text()); });

  await page.goto(GAME);
  await page.waitForFunction(() => typeof window.startRun === 'function');
  await page.evaluate(() => startRun());
  await page.waitForTimeout(150);

  const r = await page.evaluate(() => {
    const R = {};
    const clearBox = () => { for (let y = 100; y < 140; y++) for (let x = 100; x < 140; x++) setc(x, y, AIR, 0); };

    // Bouncing shots must reflect off a FLOOR, not burn their whole budget on it.
    clearBox();
    for (let y = 140; y < 150; y++) for (let x = 100; x < 140; x++) setc(x, y, STONE, 0);
    shots.length = 0; mobs.length = 0; P.x = 120; P.y = 110;
    mkShot(120, 130, 0, 1, { s: SP.BOUNCE, dmg: 0, speed: 180, spread: 0, bounce: 5, life: 300, owner: 'p' });
    let roseAgain = false, spentPerFrame = [];
    for (let f = 0; f < 24; f++) {
      const b0 = shots[0] && shots[0].bounce;
      stepShots();
      if (!shots[0]) break;
      if (shots[0].vy < 0) roseAgain = true;
      spentPerFrame.push(b0 - shots[0].bounce);
    }
    R.bounceReflects = roseAgain;
    R.bounceMaxSpentInOneFrame = Math.max(...spentPerFrame, 0);
    R.bounceBuried = shots[0] ? isBlocking(gget(shots[0].x | 0, shots[0].y | 0)) : false;

    // ACID BLOOD must stop sludge poison.
    shots.length = 0; clearBox();
    for (let y = 108; y < 118; y++) for (let x = 115; x < 126; x++) setc(x, y, SLUDGE, 0);
    P.perks = { toxproof: 1 }; P.hp = 100; P.hpMax = 100; P.iframe = 0; P.poison = 0; P.alive = true;
    P.x = 120; P.y = 112;
    for (let f = 0; f < 120; f++) stepPlayer();
    R.toxproofHp = P.hp;

    // FIREPROOF must stop the burn damage-over-time, not just the ignition source.
    clearBox();
    P.perks = { fireproof: 1 }; P.hp = 100; P.hpMax = 100; P.iframe = 0; P.poison = 0; P.alive = true;
    P.x = 120; P.y = 112; P.burn = 120;
    for (let f = 0; f < 120; f++) stepPlayer();
    R.fireproofHp = P.hp;

    // ...but an unprotected witch still burns.
    clearBox();
    P.perks = {}; P.hp = 100; P.hpMax = 100; P.iframe = 0; P.poison = 0; P.alive = true;
    P.x = 120; P.y = 112; P.burn = 120;
    for (let f = 0; f < 120; f++) stepPlayer();
    R.noPerkBurnHp = P.hp;

    // GLASS CANNON doubles blast damage as well as direct hits.
    mobs.length = 0; shots.length = 0; P.perks = {}; P.hp = 999; P.hpMax = 999;
    spawnMob('brute', 200, 300);
    const m = mobs[mobs.length - 1], hp0 = m.hp;
    const dmg = (n, k, perks) => { P.perks = perks; m.hp = hp0; hurtMob(m, n, k); return hp0 - m.hp; };
    R.glass = {
      shot: dmg(10, 'shot', {}), boom: dmg(10, 'boom', {}),
      glassShot: dmg(10, 'shot', { glass: 1 }), glassBoom: dmg(10, 'boom', { glass: 1 }),
      env: dmg(10, 'env', { glass: 1 }),
    };
    m.dead = true; mobs.length = 0;

    // PROSPECTOR pays +50% gold and pulls from further out.
    P.perks = {}; drops.length = 0;
    spawnMob('brute', P.x + 2, P.y); hurtMob(mobs[mobs.length - 1], 999, 'shot');
    const plainDrops = drops.length;
    drops.length = 0; mobs.length = 0;
    P.perks = { rich: 1 };
    spawnMob('brute', P.x + 2, P.y); hurtMob(mobs[mobs.length - 1], 999, 'shot');
    R.gold = { plain: plainDrops, rich: drops.length };
    drops.length = 0; mobs.length = 0; P.perks = {};

    // A wand of nothing but modifiers must SAY so, not stutter in silence.
    const w = makeWand({ cap: 4, spells: ['DMG', 'DMG', 'DMG', 'DMG'] });
    w.mana = w.manaMax; wands.push(w);
    const old = wsel; wsel = wands.length - 1;
    toastT = 0; toastMsg = ''; noCastWarn = 0;
    curWand().delayT = 0; curWand().reloadT = 0;
    tryCast(curWand());
    R.allModsToast = toastMsg;
    wands.pop(); wsel = old;

    // The deck/draw model is the heart of the game — pin its arithmetic.
    const resolve = spells => {
      const x = makeWand({ cap: 4, spells: spells.slice() });
      const out = [];
      for (let k = 0; k < 2; k++) {
        const res = wandResolve(x);
        if (!res) { out.push(null); break; }
        out.push({ n: res.groups.length, mana: res.manaCost, wrapped: res.wrapped });
        if (res.needsReload) x.fresh = true;
      }
      return out;
    };
    R.wrapOnce = resolve(['SPARK', 'TRIPLE', 'ARROW', null]);
    R.noPhantomCast = resolve(['DMG', 'DMG', 'DMG', 'DMG']);

    return R;
  });

  const runtime = await page.evaluate(async () => {
    // Let a real run breathe for a few seconds under input and watch for NaN.
    let nan = 0;
    const _s = window.step;
    window.step = function () {
      _s();
      if (!isFinite(P.x) || !isFinite(P.y) || !isFinite(P.hp)) nan++;
      for (const sh of shots) if (!isFinite(sh.x) || !isFinite(sh.y)) nan++;
    };
    startRun();
    Object.assign(keys, { d: 1, f: 1, ' ': 1 });
    await new Promise(r => setTimeout(r, 3000));
    return { nan, alive: P.alive, mobs: mobs.length, shots: shots.length };
  });

  await browser.close();

  console.log('\nASHFALL regression suite\n');
  ok('bouncing shot reflects off a floor', r.bounceReflects);
  ok('bounce spends at most one charge per frame', r.bounceMaxSpentInOneFrame <= 1, `spent ${r.bounceMaxSpentInOneFrame}`);
  ok('bouncing shot never ends up inside terrain', r.bounceBuried === false);
  ok('ACID BLOOD blocks sludge poison', r.toxproofHp === 100, `hp ${r.toxproofHp}`);
  ok('FIREPROOF blocks the burn DoT', r.fireproofHp === 100, `hp ${r.fireproofHp}`);
  ok('burning still hurts without FIREPROOF', r.noPerkBurnHp < 100, `hp ${r.noPerkBurnHp}`);
  ok('GLASS CANNON doubles direct hits', r.glass.glassShot === r.glass.shot * 2);
  ok('GLASS CANNON doubles blast damage', r.glass.glassBoom === r.glass.boom * 2, JSON.stringify(r.glass));
  ok('GLASS CANNON does not buff environmental damage', r.glass.env === 10, `env ${r.glass.env}`);
  ok('PROSPECTOR pays +50% gold', r.gold.rich === Math.round(r.gold.plain * 1.5), JSON.stringify(r.gold));
  ok('all-modifier wand explains itself', /ONLY MODIFIERS/.test(r.allModsToast), `toast "${r.allModsToast}"`);
  ok('wand wraps exactly once per cast', r.wrapOnce[1] && r.wrapOnce[1].n === 3 && r.wrapOnce[1].wrapped, JSON.stringify(r.wrapOnce));
  ok('modifier-only wand resolves to no cast', r.noPhantomCast[0] === null);
  ok('3s of live play produces no NaN', runtime.nan === 0, `${runtime.nan} NaN frames`);
  ok('player survives the opening cavern', runtime.alive);
  ok('no uncaught JS errors', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
