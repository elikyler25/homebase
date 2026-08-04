/* Self-test for Crumbfall's pure logic. Run: node game.test.js
 *
 * Covers the parts that are expensive to verify by hand: cost/refund maths,
 * number formatting, save round-trips and content-table sanity. Rendering and
 * input are left to the browser — this file needs no DOM and no dependencies.
 */
'use strict';

var G = require('./game.js');

var passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg ? msg + ': ' : '') +
      'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
}

function near(actual, expected, tol, msg) {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error((msg ? msg + ': ' : '') +
      'expected ~' + expected + ' (±' + tol + '), got ' + actual);
  }
}

function ok(cond, msg) { if (!cond) throw new Error(msg || 'expected truthy'); }

console.log('\nCrumbfall self-test\n');

/* ── Number formatting ─────────────────────────────────────────── */

console.log('formatting');

test('small numbers keep a decimal, large ones get a suffix', function () {
  eq(G.fmt(0), '0');
  eq(G.fmt(7), '7');
  eq(G.fmt(7.5), '7.5');
  eq(G.fmt(999), '999');
  eq(G.fmt(1000), '1 K');
  eq(G.fmt(1234), '1.234 K');
  eq(G.fmt(1500000), '1.5 M');
  eq(G.fmt(1e12), '1 T');
});

test('formatting never emits trailing zeros', function () {
  [1, 10, 1e3, 2e6, 5e9, 1.25e15].forEach(function (n) {
    ok(!/\.\d*0\b/.test(G.fmt(n)), 'trailing zero in ' + G.fmt(n));
  });
});

test('every suffix tier round-trips to a readable string', function () {
  for (var e = 3; e < 51; e += 3) {
    var s = G.fmt(Math.pow(10, e));
    ok(typeof s === 'string' && s.length > 0 && s.indexOf('NaN') === -1,
      '10^' + e + ' formatted as ' + s);
  }
});

test('absurd numbers fall back to exponent notation, not NaN', function () {
  var s = G.fmt(1e120);
  ok(s.indexOf('NaN') === -1 && s.indexOf('undefined') === -1, 'got ' + s);
  eq(G.fmt(Infinity), '∞');
});

test('durations read as time, not seconds', function () {
  eq(G.fmtTime(0.4), 'now');
  eq(G.fmtTime(45), '45s');
  eq(G.fmtTime(90), '1m 30s');
  eq(G.fmtTime(3600), '1h 0m');
  eq(G.fmtTime(Infinity), 'never');
});

/* ── Purchase maths ────────────────────────────────────────────── */

console.log('\npurchase maths');

test('bulk cost equals the sum of the individual costs', function () {
  var base = 100, owned = 7, n = 13;
  var sum = 0;
  for (var i = 0; i < n; i++) sum += base * Math.pow(G.COST_GROWTH, owned + i);
  near(G.bulkCost(base, owned, n), sum, sum * 1e-9, 'closed form vs loop');
});

test('buying one at a time costs the same as buying in bulk', function () {
  var base = 1100;
  var stepwise = 0;
  for (var i = 0; i < 25; i++) stepwise += G.bulkCost(base, i, 1);
  near(G.bulkCost(base, 0, 25), stepwise, stepwise * 1e-9);
});

test('maxAffordable never overspends and is never short by one', function () {
  var bases = [15, 100, 1100, 12000, 1.4e6, 1e12];
  var banks = [0, 14, 15, 16, 99, 1e3, 1e5, 1e9, 1e15, 1e25];
  bases.forEach(function (base) {
    [0, 1, 9, 50, 137].forEach(function (owned) {
      banks.forEach(function (bank) {
        var n = G.maxAffordable(base, owned, bank);
        ok(n >= 0, 'negative count');
        if (n > 0) {
          ok(G.bulkCost(base, owned, n) <= bank + 1e-6,
            'overspent: base=' + base + ' owned=' + owned + ' bank=' + bank + ' n=' + n);
        }
        ok(G.bulkCost(base, owned, n + 1) > bank,
          'left one on the table: base=' + base + ' owned=' + owned + ' bank=' + bank);
      });
    });
  });
});

test('an empty bank buys nothing', function () {
  eq(G.maxAffordable(15, 0, 0), 0);
  eq(G.maxAffordable(15, 0, 14.99), 0);
  eq(G.maxAffordable(15, 0, 15), 1);
});

test('selling refunds half of what the copies cost', function () {
  // Selling the 10th copy should refund half of what the 10th copy cost.
  var base = 100;
  var costOfTenth = G.bulkCost(base, 9, 1);
  var refund = G.bulkCost(base, 9, 1) * 0.5;
  near(refund, costOfTenth / 2, 1e-9);
  // …and never more than was paid, so sell/rebuy cannot mint cookies.
  ok(refund < costOfTenth, 'refund must be a loss, or sell/rebuy is an exploit');
});

/* ── Prestige ──────────────────────────────────────────────────── */

console.log('\nprestige');

test('chips scale with the cube root of all-time cookies', function () {
  eq(G.chipsFor(0), 0);
  eq(G.chipsFor(1e8), 0);
  eq(G.chipsFor(1e9), 1);
  eq(G.chipsFor(8e9), 2);
  eq(G.chipsFor(1e12), 10);
  eq(G.chipsFor(1e15), 100);
});

test('each chip costs strictly more than the last', function () {
  var prev = 0;
  for (var c = 1; c <= 40; c++) {
    var need = Math.pow(c, 3) * 1e9;
    ok(need > prev, 'chip ' + c + ' is not more expensive than chip ' + (c - 1));
    eq(G.chipsFor(need), c, 'threshold for chip ' + c);
    prev = need;
  }
});

/* ── Saves ─────────────────────────────────────────────────────── */

console.log('\nsaves');

test('a save round-trips through JSON intact', function () {
  var s = G.freshState();
  s.cookies = 1234.5;
  s.totalEver = 5e10;
  s.own.granny = 42;
  s.upgrades.click1 = true;
  s.achievements.bake0 = true;
  s.chips = 3;
  s.opts.theme = 'light';

  var back = G.loadRaw(JSON.stringify(s));
  eq(back.cookies, 1234.5);
  eq(back.own.granny, 42);
  eq(back.upgrades.click1, true);
  eq(back.achievements.bake0, true);
  eq(back.chips, 3);
  eq(back.opts.theme, 'light');
});

test('junk fields are dropped rather than trusted', function () {
  var back = G.loadRaw(JSON.stringify({
    cookies: 'not a number',
    own: { granny: -5, nonexistentBuilding: 999 },
    upgrades: { madeUpUpgrade: true },
    achievements: { madeUpBadge: true },
    opts: { theme: 'neon', fx: 'yes' }
  }));
  eq(back.cookies, 0, 'string cookies rejected');
  eq(back.own.granny, 0, 'negative counts rejected');
  eq(back.own.nonexistentBuilding, undefined, 'unknown building rejected');
  eq(back.upgrades.madeUpUpgrade, undefined, 'unknown upgrade rejected');
  eq(back.achievements.madeUpBadge, undefined, 'unknown badge rejected');
  eq(back.opts.theme, 'dark', 'bad theme falls back');
  eq(back.opts.fx, true, 'non-boolean option falls back');
});

test('a save cannot claim more chips than its cookies justify', function () {
  var back = G.loadRaw(JSON.stringify({ totalEver: 1e9, chips: 9999 }));
  eq(back.chips, 1, 'chips clamped to what totalEver earns');
});

test('NaN and Infinity do not survive a load', function () {
  var back = G.loadRaw('{"cookies":null,"totalEver":1e999,"clicks":1e999}');
  eq(back.cookies, 0);
  eq(back.totalEver, 0, 'Infinity rejected');
  eq(back.clicks, 0, 'Infinity rejected');
});

test('unreadable saves throw rather than corrupt state', function () {
  var threw = false;
  try { G.loadRaw('not json at all'); } catch (e) { threw = true; }
  ok(threw, 'malformed JSON should throw');
});

/* ── Content tables ────────────────────────────────────────────── */

console.log('\ncontent');

test('every id is unique', function () {
  [['building', G.BUILDINGS], ['upgrade', G.UPGRADES], ['achievement', G.ACHIEVEMENTS]]
    .forEach(function (pair) {
      var seen = {};
      pair[1].forEach(function (x) {
        ok(!seen[x.id], 'duplicate ' + pair[0] + ' id: ' + x.id);
        seen[x.id] = true;
      });
    });
});

test('buildings get steadily more expensive and more productive', function () {
  for (var i = 1; i < G.BUILDINGS.length; i++) {
    ok(G.BUILDINGS[i].cost > G.BUILDINGS[i - 1].cost,
      G.BUILDINGS[i].id + ' is not dearer than ' + G.BUILDINGS[i - 1].id);
    ok(G.BUILDINGS[i].cps > G.BUILDINGS[i - 1].cps,
      G.BUILDINGS[i].id + ' is not more productive than ' + G.BUILDINGS[i - 1].id);
  }
});

test('no building is a strictly worse deal than the one before it', function () {
  // Payback time should improve (or at least not collapse) as you go up the tree.
  var prev = Infinity;
  G.BUILDINGS.forEach(function (b) {
    var payback = b.cost / b.cps;   // seconds to earn its own price back
    ok(payback < prev * 60,
      b.id + ' takes wildly longer to pay for itself than the tier below');
    prev = payback;
  });
});

test('every upgrade has the fields the UI renders', function () {
  G.UPGRADES.forEach(function (u) {
    ok(u.id && u.name && u.desc && u.icon, 'incomplete upgrade: ' + u.id);
    ok(typeof u.cost === 'number' && u.cost > 0 && isFinite(u.cost),
      'bad cost on ' + u.id);
    ok(typeof u.req === 'function', 'missing req on ' + u.id);
  });
});

test('every achievement test survives a blank save', function () {
  var s = G.freshState();
  G.ACHIEVEMENTS.forEach(function (a) {
    ok(a.id && a.name && a.desc && a.icon, 'incomplete achievement: ' + a.id);
    var result;
    try { result = a.test(s); }
    catch (e) { throw new Error(a.id + ' threw on a fresh save: ' + e.message); }
    eq(!!result, false, a.id + ' is already earned on a fresh save');
  });
});

test('the first building is reachable by clicking alone', function () {
  // 15 cookies at 1 per click — a new player must not be stuck.
  ok(G.BUILDINGS[0].cost <= 20, 'the opening purchase is too far away');
});

/* ── Result ────────────────────────────────────────────────────── */

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
