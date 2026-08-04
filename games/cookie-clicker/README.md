# Crumbfall

An incremental bakery — a cookie clicker, with the parts that make idle games
annoying taken out.

**Play it:** open `index.html` in a browser. That's the whole install. No build
step, no dependencies, no server, no account. It runs off `file://`.

```
games/cookie-clicker/
├── index.html      markup
├── styles.css      one stylesheet, light + dark
├── game.js         all the logic, one file, no dependencies
└── game.test.js    headless self-test — node game.test.js
```

## What's different from the original

The core loop is familiar: click a cookie, buy things that click it for you.
These are the changes worth having.

**Your ovens run while you're gone.** Come back after a break and you get a
report of what was baked: 50% of your rate, capped at 3 hours (upgradeable to
80% and 12 hours). The dialog shows exactly what was counted and what was past
the cap, so the number is never a mystery.

**Clicking stays interesting.** Sustained clicking builds a combo multiplier
that decays when you stop, and every click can crit for ×10. Both are visible
on screen and both are upgradeable — clicking is a real strategy rather than a
thing you stop doing after ten minutes.

**Golden cookies are findable.** They're anchored to the viewport, not the
page, so one never spawns below the fold where you'd miss it. Active effects
get a countdown bar at the top of the screen instead of leaving you guessing
how long your ×7 has left.

**Buying is informed.** ×1 / ×10 / ×100 / Max, and every building shows what it
actually contributes — cookies per second each, total, and its share of your
output — plus a countdown to when you can afford it. You can sell for half
back. Buildings you can't nearly afford stay hidden, with one teaser ahead so
there's always something to aim for.

**Nothing is hidden from you.** A stats panel lists every multiplier in play:
global CpS bonus, crit chance and payout, combo ceiling, buff stacking, offline
rate and cap. If a number moved, you can find out why.

**Your save is yours.** It lives in this browser's local storage and goes
nowhere else. Export it as text, paste it into another machine, done. Delete
everything is one button and it means it.

**It's playable on a phone**, in light or dark, with keyboard support
(<kbd>Space</kbd> clicks), reduced-motion support, and screen-reader labels on
every buyable. Particles can be turned off.

**No dark patterns.** No timers designed to pull you back, no currency you
can't earn, no nagging. It's a game about a number going up.

## Progression

- **12 buildings**, from a Nimble Cursor to The Idea of a Cookie.
- **Upgrades** — six productivity tiers per building (at 1, 5, 25, 50, 100 and
  150 owned), plus hand-written upgrades for clicking, crits, combos, golden
  cookies, offline baking and global output.
- **Badges** for milestones. Each one permanently adds +0.5% to your rate, and
  they survive everything.
- **Legacies** (prestige). Cash in your all-time total for legacy chips: +1.5%
  cookies per second and +1% per click, each, forever. Chips scale with the
  cube root of your all-time cookies, so the first is quick and the hundredth
  is a project. Resetting costs you cookies, buildings and upgrades; it never
  costs you badges, chips or stats.

## Working on it

```sh
node game.test.js      # 23 checks, no dependencies, no DOM
```

The self-test covers the things that are painful to verify by clicking: bulk
cost maths against a brute-force sum, `maxAffordable` never overspending or
leaving a purchase on the table, number formatting across every suffix tier,
save round-trips, and hostile saves (junk fields, `Infinity`, inflated chip
counts) being rejected rather than trusted. Content tables are checked for
duplicate ids and for cost/output curves that always move the right way.

`game.js` is one closure in numbered sections — formatting, content, state,
derived values, upgrades, actions, golden cookies, achievements, saves, DOM,
wiring, loop, boot. Game content lives in the tables at the top; adding a
building or an upgrade means adding a row, not touching the engine. It exports
its pure functions under `module.exports` when required from Node, which is how
the self-test reaches them without a DOM.

Rendering is throttled to ~16 fps independently of the simulation, which runs
on `requestAnimationFrame` with a clamped delta so a backgrounded tab doesn't
mint cookies on return.
