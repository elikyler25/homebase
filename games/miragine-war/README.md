# Mirage War

A one-screen, two-player take on **Miragine War**. Single HTML file, no build step, no
dependencies, no network — open `index.html` in a browser and hit FIGHT.

Works on a phone or tablet in landscape: tap the cards to buy. Turn the device sideways — it asks
you to.

Also playable solo: pick **VS CPU** on the menu (easy / normal / hard). The CPU recruits the same way
you do — it selects a troop and its crystal keeps producing it — so a solo battle fills the field the
way a two-player one does.

## Battle sizes

Pick one on the menu, alongside the opponent:

| | Map | Gold | Recruit rate | Crystal | Troop ceiling |
|---|---|---|---|---|---|
| **NORMAL BATTLE** | 2600 wide | ×1 | one troop / 0.30s | 6,000 | 2,600 |
| **EPIC BATTLE** | 5200 wide (4× the area) | ×4 | one troop / 0.05s | 18,000 | 2,600 |
| **CHAOS** | 14000 wide (29× the area) | ×40 | one troop / 0.005s | 48,000 | 4,200 |
| **MAELSTROM** | 66000 wide (645× the area) | ×200 | one troop / 0.001s | 1,500,000 | 26,000 |

EPIC is the same game at a different scale: twice the map, four times the gold and six times the
recruit rate, so armies run into the many hundreds and the front line becomes a solid wall of bodies.

CHAOS takes EPIC's dials ten times further — forty times the gold, sixty times the recruit rate.
Troops pour out faster than they can die, the field saturates in seconds and stays that way, and a
match is decided by which wall of bodies grinds through first. Measured with both sides recruiting
flat out: **4,200 troops on the field** — the ceiling — eleven thousand kills in
the first two and a half minutes and neither crystal scratched — CHAOS is decided by sudden death far
more often than by a breakthrough.

**Champions scale with the battle size.** At forty times the gold a champion was affordable in a
tenth of a second and swallowed by the crowd immediately, which made it confetti. Champion price and
HP now scale with the mode: ×4 price and ×2.2 HP in EPIC, ×14 and ×4.5 in CHAOS, ×100 and ×16 in
MAELSTROM. A CHAOS champion arrives around the ten-second mark and is still standing minutes later.

One honest limit: **the map is capped by legibility, not by the engine.** Two people share one screen
with no scrolling, so a wider world means smaller troops, and past a point they stop being visible at
all — at CHAOS's zoom a rank-and-file soldier is 7 pixels tall, which is about the floor for reading
who is who. The map is 29× the area of NORMAL and bodies scale 3.4× to stay visible inside it.

**MAELSTROM** is as large as the engine holds at sixty frames a second: a thousand troops a second
per side, six hundred troop-widths across the screen, and a ceiling of **26,000 bodies**. A soldier is
2.4 pixels tall and individual troops stop being the unit of thought — you are moving continents, and
the front line is a churning coastline a thousand troops long.

**Two different things cap this, and neither is the map.** A wider world with proportionally bigger
troops looks *identical*, because the whole world is always on screen and never scrolls — so "bigger
map" only ever means "smaller troops". What actually binds is:

- **Legibility.** At 2.4 pixels the dark rim around each body can still separate it from the one
  behind it. Below about 2 pixels the body is one pixel wide, the rim has nowhere to go, and the army
  becomes noise rather than troops.
- **JavaScript cost per troop.** Measured across whole matches with mixed armies on a mid machine:
  16,000 troops run a 5.7 ms median simulation, 20,000 run 7.6 ms, 26,000 run 9.7 ms with a 12.6 ms
  90th percentile, and 32,000 breaks down to a 23 ms 90th percentile — visible stutter. 26,000 is the
  last rung that holds. A faster machine keeps all of it; a slower one gets trimmed by the governor.

The first attempt at measuring this said 34,000, and was wrong: it sampled while the armies were still
marching towards each other. A field that is *fighting* costs two to three times more than the same
field walking, because that is where separation and combat resolution actually happen.

MAELSTROM runs the gold wide open at ×200, and at that rate **gold stops being a constraint** — the
whole ladder is affordable at the full thousand-a-second, so what you build is a purely tactical
choice rather than an economic one. That is the point of the mode. The price ladder does its work at
the other sizes: a Minotaur is 39% sustainable at CHAOS and 1% at NORMAL.

Getting there needed a bug fixed first. The recruit loop bought at most one troop per frame and threw
away the remainder, so every rate faster than about 1/60s silently clamped: CHAOS asked for 200
troops a second and delivered 60, EPIC asked for 20 and delivered 15, and MAELSTROM's whole point —
a faster gap — would have done nothing at all. It drains the accumulator now, and every size hits its
stated rate exactly. CHAOS holds 4,200 troops as a result, up from ~3,100.

Every battle size also **scales itself to your device.** The ceilings above are what the game will
use if your machine can hold them; if it cannot, the field finds its own level rather than turning
into a slideshow, and says so in the HUD. See the notes at the bottom for how.

Card flicker is a real hazard at this pace: at one recruit every 5 ms the "just bought" pulse fires
200 times a second and the affordability dimming flips every time gold crosses a price. Both are
damped — the selected card's pulse is suppressed above NORMAL's recruit rate (its permanent gold
outline already says it is recruiting), and the dimming runs on a quarter-second cadence with a
±15% deadband. Measured over three seconds at full CHAOS load: **0 class changes per second** on
every card, down from 16.

## How it plays

**Pick a troop and your crystal keeps making it.** One tap or one key sets your selection, and that
troop marches out continuously for as long as your gold lasts — you never tap once per soldier.
Pick a different troop to switch, or press the same one again to stop and save up. The selected card
is outlined in gold and named in your HUD.

No turns and no waiting. Shatter the enemy crystal to win. Crystals shoot back, so a thin push gets
picked apart before it lands.

### Armour is the counter system

Every unit is **LIGHT** or **ARMORED**, and every unit has two separate damage numbers — one
against light, one against armoured. Armour then subtracts flat damage from every hit.

That's the whole rock-paper-scissors:

- A **light-killer** (Ninja, Berserker, Headhunter, Gladiator) does 117 to light and 11 to armoured —
  it butchers fodder and cannot dent plate.
- An **armour-breaker** (Monk, Runecaster, Bone Mage, Oracle) is the reverse at 32 / 188 — it exists
  to delete walls.
- A **wall** (Iron Ox, Ice Giant, Mammoth, Minotaur) has 18 armour, so fodder's 5 damage lands as the
  minimum chip — 0.4, a fourteenth of what the breaker does. Swarms really cannot kill it; you need
  the breaker. The floor is a *fraction* of the attacker's damage rather than a flat 2, because a flat
  minimum meant armour stopped mattering once numbers got large: a thousand fodder chipping 2 apiece
  out-damaged what they were supposedly unable to hurt. Nothing is ever fully immune, so no fight can
  stalemate.

Press <kbd>H</kbd> in game for the counter chart.

Hover any shop card for the full stat line. The bar under each card is a **live counter advisor** —
it scores that unit against the enemy's army as it stands right now, green for a strong pick and red
for a wasted one, so you can read the matchup without memorising the table.

### The price ladder

Each tier costs roughly **two and a half times** the one below it and hits about that much harder:

| Tier | Price | Step |
|---|---|---|
| fodder | ◆15 | — |
| shield line | ◆140 | ×9.3 |
| light-killer / skirmisher | ◆340 / ◆370 | ×2.4 |
| armour-breaker | ◆900 | ×2.4 |
| flanker / artillery | ◆2,200 / ◆2,500 | ×2.4 |
| wall | ◆6,000 | ×2.4 |
| champion | ◆15,000 | ×2.5 |

Value-per-gold stays broadly flat across the ladder, so massing cheap troops is still a real
strategy — what the steepness buys is that a wall is a *commitment* rather than a slightly dearer
soldier. The old curve was nearly flat through the middle (◆230 against ◆250, ◆1,020 against ◆1,330),
which meant that with plenty of gold there was no reason not to simply buy the top of it.

**Walls cleave.** This was not a flourish — it is the only thing that makes the top of the ladder
worth buying. Combat here follows Lanchester's square law: equal gold buys `gold / price` bodies, and
a side's fighting power scales with the *square* of its numbers, so cheap units win a pure numbers
fight no matter how good the expensive one is per unit. Measured before the change, a wall won 1 of 7
gold-for-gold duels — the most expensive thing on the board was the worst buy. With area damage it
wins 6 of 7, and beats the tier below it head-on. The units that already had splash (artillery,
flankers) were the only ones that had ever bucked the trend.

One thing the same test showed that is *not* a fault: the middle rungs still lose head-to-head against
the tier below. That is the rock-paper-scissors, not the ladder — a light-killer is supposed to lose
to a shield line, and an armour-breaker is supposed to lose to a light-killer. Comparing adjacent
tiers head-on is meaningless when one is the other's hard counter.

### The ground you fight on

The field is not a flat plain. Three kinds of terrain are laid out **mirrored across the centre**, so
neither side ever gets the better ground:

| Terrain | Effect |
|---|---|
| **Woods** (four patches, on the flanks) | Troops inside take **40% less missile damage** and move 18% slower |
| **High ground** (the shrine hill, centre) | Troops on it deal **+14% damage** |
| **Marsh** (two strips, mid-field) | Wading costs 38% of your speed and 10% of your damage |

Nothing blocks movement — there is no pathfinding and nothing to get stuck on. Terrain changes what
*happens* where you fight, which is enough to make position matter: artillery that dominates open
ground is blunted the moment the enemy reaches the treeline, the shrine is worth taking twice over,
and the marsh is somewhere to avoid rather than somewhere to hold.

### The shrine

A neutral obelisk stands mid-field. Have more troops standing on it than your opponent and it
turns to you, paying **+◆240 every payday** for as long as you hold it. It gives the fight a place
to be, and gives a losing player something to take back.

From round 28 both crystals start crumbling on their own, harder every payday. No war lasts forever.

### Veterans

A unit that kills gets sharper — +12% damage per 3 kills, up to +36%, marked with gold chevrons.
Combined with income, that makes an army you keep alive worth far more than one you keep replacing.

### Your army is your economy

Every living unit pays **income** at each payday (every 10 seconds — that's the round counter), on
top of a base that climbs steeply each round, so late armies get very large. Units you keep alive fund the next wave, so a bad trade costs
you the fight and the bank at once.

## Controls

| | Player 1 (blue, left) | Player 2 (red, right) |
|---|---|---|
| Select troop, row 1 | `1` `2` `3` `4` `Q` `W` `E` `R` | `7` `8` `9` `0` `U` `I` `O` `P` |
| Select troop, row 2 | `A` `S` `D` `F` `Z` `X` `C` `V` | `J` `K` `L` `;` `M` `,` `.` `/` |
| Spawn lane | `Left Shift` | `Right Shift` |
| Mend crystal | `5` | `6` |
| Stance | `T` | `'` |

Lane cycles SPREAD → HIGH → MID → LOW, so you can mass on a flank instead of feeding the meat
grinder in the middle. Stance toggles ADVANCE / HOLD — on HOLD your troops fall back to your own
half and fight under your crystal's guns instead of marching out, which is how you survive a bad
patch. The cost is that your opponent takes the shrine while you sit. Mending costs ◆450 for 700 crystal HP — a gold sink that buys you a comeback
if you can hold the field. `Space` pauses, `-`/`=` set game speed (1–3×), `H` shows the counter
chart, `` ` `` mutes. Tapping a card selects it; tapping it again stops recruiting; hovering one
picks that unit type out of the melee.

## Armies

Each player picks one of four armies on the menu — they can be different, and the CPU uses whichever
you assign to P2.

| Army | Character | Signature perk | Champion |
|---|---|---|---|
| **TRIBE** | Bone and muscle | Mammoth: +550 HP | **Chieftain** — every ally within 340 hits 30% harder |
| **LEGION** | Shields and reach | Hoplite: +2 armour | **Zeus** — long-range splash that arcs to five more enemies |
| **NORSE** | Everything charges at once | Berserker: swings 10% faster | **Thor** — a 190-radius cleave |
| **DYNASTY** | Fire from range | Fire Archer: looses 5% faster | **Monkey King** — very fast, drains 38% of damage dealt |

**Champions are limited to one on the field at a time.** They cost 5,600–6,100, they announce
themselves when they arrive and when they die, and they are worth roughly their price in troops —
three of the four hold against ~42 shield-line soldiers bought with the same gold.

### The eight roles

Every army fields the same eight jobs at the same stats. That is deliberate: simulated round-robins
showed that even small per-faction stat tilts swung entire matchups — range worst of all, since a
ranged unit fires from behind a screen and takes almost nothing back — so making one army "the
long-ranged one" quietly made it the best one. Identity lives in the art, the names, the perk and the
champion instead.

| Role | Price | HP | Armour | Type | vs Light | vs Armored | Range | Job |
|---|---|---|---|---|---|---|---|---|
| fodder | 15 | 70 | 0 | light | 12 | 5 | 40 | cheap bodies, and what actually breaks a crystal |
| shield line | 135 | 260 | 4 | armored | 33 | 24 | 48 | holds the middle |
| light-killer | 230 | 170 | 1 | light | 98 | 9 | 44 | butchers fodder, cannot dent plate |
| skirmisher | 250 | 200 | 2 | light | 36 | 36 | 260 | steady ranged damage |
| armour-breaker | 570 | 260 | 3 | light | 26 | 152 | 208 | the answer to walls |
| flanker | 1020 | 620 | 6 | armored | 76 | 38 | 56 | fast, cleaves 53 |
| artillery | 1330 | 300 | 2 | light | 78 | 78 | 316 | longest reach, cleaves 99 |
| wall | 2240 | 1700 | 14 | armored | 78 | 58 | 64 | swarms literally cannot hurt it |

**Elites win the field, cheap troops break the crystal.** Siege damage is mostly per-body rather
than per-power, so a champion is not also the best battering ram. Winning the fight and cashing it
in are two different jobs.

## Interface

The menu is a setup sheet, not a wall of text: four labelled rows — **Opponent**, **Battle**,
**Blue army**, **Red army** — then one primary action. Army chips name the champion they bring, and
picking one previews that roster in the shop immediately. Rules and the full control map live behind
a **How to play** disclosure so the default view stays clean, and the panel collapses gracefully on a
phone (tagline and disclosure drop away, the panel scrolls inside itself, FIGHT stays on screen).

Your opponent, battle size and both armies are **remembered between sessions**, along with the mute
setting. <kbd>Space</kbd> brings up a proper pause card rather than a word in the corner.

In battle the HUD is grouped chips over a dark ground rather than a run-on line: army tag, gold,
income, troops, what you're recruiting, lane and stance. Shop cards carry the key, the armour type,
the sprite, the name, its **role** (fodder, shield line, light-killer, skirmisher, armour-breaker,
flanker, artillery, wall, CHAMPION), the price and the live counter bar. The end screen is a result
card per side with kills, spend and the army each player actually built — with the setup rows still
underneath, so a rematch with different armies is one tap.

## Notes on the build

- **Sprites are procedural.** Each unit composes a silhouette from head / body / weapon / extras
  (crowns, horns, kasa hats, capes, bat wings, mounts, tower shields), so units are told apart by
  shape rather than colour. Every unit/team/animation frame is baked once into a cached canvas and
  blitted, which is what keeps 300-unit battles smooth — drawing them as paths every frame cost
  ~66 ms/frame, the cache brings it to ~19 ms.
- **Static layers are painted once.** Field, grass, flowers and the vignette live on an offscreen
  canvas; blood decals accumulate on a second one. Neither is repainted per frame.
- **A spatial hash** backs targeting, splash and unit separation, so army size doesn't blow up the
  simulation (300 units simulate in ~1.3 ms/frame).
- **The CPU recruits exactly the way you do.** It selects a card and its crystal streams that troop
  continuously; `cpuThink` only chooses *which* card, and the same auto-recruit loop in `step()` does
  the spawning. It used to buy one unit per think tick, which was survivable at the normal battle
  size and absurd at CHAOS — you recruit 200 troops a second there and it managed one or two. It now
  fields 1,000–3,300 troops in a CHAOS match instead of a handful.
- **That change needed the CPU's economics rethought, not just its trigger.** Recruiting flat out
  keeps its purse near zero, so the old "can I afford this right now" filter would have pinned it to
  fodder for the entire match. Affordability is judged against *income* instead — anything it can
  cover within a fraction of a payday is fair game and the recruit loop saves up for it. Mending
  needed the same treatment: a lump sum is something a continuous spender never has, so when the
  crystal is in real danger it stops recruiting and saves, the way a player would.
- **The difficulty ladder had to be re-measured afterwards, and it had genuinely broken.** Against
  four fixed player strategies at every battle size, the old build won 4/5/9 of 12 at EPIC and
  6/11/12 at NORMAL for easy/normal/hard. Switching the CPU to continuous recruiting flattened that
  to 7/6/9 and 8/11/9 — easy had become far too strong, and hard had got *weaker*, fielding six
  troops against a player's eighty-seven. The cause was `costPow`: with continuous recruiting,
  value-per-gold is the whole game, and at 1.0 hard still liked the big units enough to stall saving
  for them. Raising hard's `costPow` to 1.35 and slowing the lower levels' recruit rate restores it —
  now 4/9/12 at EPIC and 6/9/11 at NORMAL, and hard's army recovers from 39 troops to 273.
- **What separates the difficulties** is still *awareness* above all: easy fights blind (it assumes a
  50/50 enemy composition and caps itself at cheap units), normal reads the enemy through noise, hard
  reads it exactly. On top of that it now recruits at 1/5 of your rate on easy, 1/2.2 on normal, and
  at your exact rate on hard.
- **Mirror matches were not 50/50.** Testing the factions turned up a fairness bug that had nothing
  to do with them: attacks resolve in array order, so troops earlier in the list strike first and can
  kill before being struck back — and team 0's troops are reliably earlier. The sweep now alternates
  direction each frame. (The harness still shows swings between identical runs, so its noise floor is
  above the effect of a single faction perk; that is why the rosters are equal by construction rather
  than balanced by measurement.)
- **Balance is simulated, not guessed.** A headless harness runs round-robin duels between
  strategies — blind teching, counter-picking, tech-rushing, cheap swarming — and reports win/loss.
  It has caught three real design faults so far: teching beating counter-play every time (the roster
  was decorative), the top two units being ~4× the value-per-gold of everything else, and — the one
  no static metric found — ranged units quietly dominating, because they fire from behind a melee
  screen and take almost nothing back. Counter-picking now beats blind teching 5-1, and picking the
  *wrong* counter loses 6-0, which is the shape you want.
- **Colour is never the only cue.** Blue rings are solid, red rings are dashed.
- **Battle size is one switch.** Map width, gold multiplier, recruit interval, crystal HP, the troop
  ceiling and the per-unit size and speed multipliers all come from a single table, applied at the
  start of a match and restored cleanly when you switch back. Auto-recruit pauses at the ceiling so a
  runaway battle can't stall the frame — deliberate purchases are never blocked.
- **Twenty thousand troops needed the simulation rewritten, not the renderer.** With the army already
  batching into one draw call, the largest battle spent 86.7 ms a frame in plain JavaScript at 19,700 troops:
  63.3 ms of `step`, 8.8 ms sorting for draw order, 14.6 ms filling the vertex buffer. It is now
  **11.1 ms** — about 8× — from four changes, in order of what they were worth:
  - **`findTarget` was running every frame for every troop that had nobody in sight.** The retarget
    condition included `|| !a.tgt`, so a unit that found nothing rescanned its whole 560-unit sight
    radius on the very next frame — and on a 44000-wide map most of the army is marching with no
    enemy in range. Finding nothing now backs off like finding something does. **25 ms → 6.3 ms**,
    more than half the simulation, and the fix is one clause.
  - **The spatial hash allocated a fresh `Map` of fresh arrays every frame** — 20,000 pushes and
    thousands of allocations — and charged a hash on every one of the ~100 cell lookups a sight-radius
    query makes. It counting-sorts into one reused `Int32Array` now, so a lookup is an array index and
    a steady-state frame allocates nothing. The cell size also scales with the troops (they are 4.6×
    bigger here than at NORMAL), and `findTarget` searches expanding rings and stops as soon as
    nothing further out could be nearer. Grid rebuild 6.5 ms → 1.4 ms, a full targeting sweep
    68 ms → 23 ms.
  - **The sprite cache was keyed by a string.** `gid_team_walk_swing_perspective` meant one string
    concatenation and one Map hash per troop per frame, 20,000 of them, inside the hottest loop in the
    renderer. Packed into an integer index it is **14.6 ms → 4.2 ms**.
  - **Draw order was a comparator sort** of 20,000 objects. Bucketing by screen row is O(n) and costs
    **8.8 ms → 0.6 ms** — with bodies three pixels tall, the ordering inside a bucket is invisible.
- **CHAOS got faster while carrying more.** The same work took it from 3,121 troops at 6.70 ms of
  `step` to 4,200 troops at **1.60 ms** — a third more army for a quarter of the cost.
- **Small battles draw simplified bodies.** Below about eight pixels there is no room in a troop for
  a walk cycle, a weapon swing or a perspective step — CHAOS draws soldiers at seven pixels, MAELSTROM
  at 2.4, and a phone screen shrinks every size past that. Those battles bake **one flat silhouette
  per unit per side** instead of twenty-four animated variants. NORMAL and EPIC are untouched.

  The saving is not in the drawing — a sprite is baked once either way, so simpler *art* costs nothing
  per frame. It is that the hot loops stop computing a walk frame, a swing state and a perspective
  band for every troop on every frame; that the atlas collapses (a CHAOS field of one unit type goes
  from dozens of sprites to two); and that the box loses all the padding that only ever existed to
  accommodate lances and capes, which halves the pixels blitted per troop.

  It also turned out to **look better**, which was not the expectation. Rendered side by side at CHAOS
  zoom, the detailed sprites are dominated by their skin-tone heads: the field reads as one beige mass
  and blue is hard to tell from red at a glance. The flat bodies are mostly team colour, so the front
  line is legible. The single biggest thing for readability was not detail but the dark rim around each
  body — at this density what makes a troop visible is the edge between it and the one behind it.

- **And it was never lag at all.** "It lags the second the two armies meet" turned out to be the
  literal truth, and the cause was not performance. A big unit falling is supposed to land a punch —
  a few frames of *hitstop* and a screen shake — and the test for "big" was `u.size >= 30`. But `size`
  is the battle-size-**scaled** value: at CHAOS every unit is 3.4× and fodder is 68, at MAELSTROM 5.5×
  and fodder is 110. So **every single death** armed a 0.06 s freeze. Since hitstop skips the
  simulation entirely, the game stopped simulating on **71% of frames at CHAOS and 79% at MAELSTROM**
  the instant the armies met, with the screen shaking flat out. Measured on NORMAL, where nothing is
  scaled: 0%.

  That is not slowness, but it is impossible to tell apart from it — and it is why several rounds of
  genuine optimisation changed nothing. The test is `baseSize` now, so only units that are actually
  big qualify at any scale; a mass battle gets none of it, since with hundreds dying a second there is
  no individual death to punctuate; and it cannot stack, so a row of walls falling together is one
  jolt rather than a continuous freeze. A champion falling still outranks a wall. Both big sizes now
  measure **0% frozen**, and a wall dying in a small battle still lands its punch.

  The same bug was in the dust puff (`u.spd > 55`, also scaled) and had already been found and fixed
  once in the minimap blips. Scaled stats compared against unscaled constants: worth grepping for as
  a class rather than fixing one at a time.

- **The worst bug in the project was a scroll handler.** `fit()` is wired to `visualViewport`'s
  **scroll** event so the board stays pinned when a phone's address bar slides. Every one of those
  calls ran a full `resize()`: rebuild the terrain, repaint the entire background, drop the sprite
  cache. And the background was scaling its decoration count with *world* area — 272,000 blades of
  grass on the largest map — so one `resize()` there took **4.5 seconds**. On a phone, where that
  event fires continuously while scrolling, the game was freezing for seconds at a time no matter how
  fast the simulation ran. Every optimisation before this was invisible next to it.

  Two fixes. `resize()` is idempotent now — it early-outs unless the box, the pixel ratio or the world
  actually changed, so a repeated `fit()` costs **0.01 ms** instead of 3.6 seconds. And decoration
  density is a screen property, not a world one: the whole world is always on screen, so it is capped
  at 1,200. Background repaint on the largest map went **4,452 ms → 1.6 ms**.
- **Resolution is a dial the governor can turn.** Rendering cost is per pixel — three full-screen
  blits a frame for ground, decals and the troop layer, plus the batch's own rasterisation — and none
  of that cares how many troops there are. On a fill-bound machine, shedding troops does nothing at
  all, which is exactly the shape of a lag report that survives round after round of CPU optimisation.
  So the governor now turns the backing store down before it starts removing troops: the canvas keeps
  its CSS size and the browser scales it back up. At 64% the pixel count drops 2.4×, and at
  two-pixel bodies it is barely visible. Losing sharpness costs a player far less than losing half
  their army. The empty decal layer is no longer blitted at all.

- **The most expensive thing in the frame was not in the frame budget at all.** After several rounds
  of optimising JavaScript that measured fast, the game was still reported as laggy — which meant the
  cost was somewhere the governor could not see. It was: `updateHUD` ran every frame doing thirty
  `getElementById` lookups and twenty `textContent`/`style` writes, unconditionally. The JavaScript
  for that measures at a tenth of a millisecond, but every touched node dirties style, layout and
  paint, and **the browser does that work after our frame function returns** — outside the window
  `performance.now()` can bracket. On a phone, re-laying out a HUD with eighteen shop cards sixty
  times a second costs far more than the simulation does, and the governor had no way to know.

  Nodes are looked up once and cached, and every write is dirty-checked. Measured with a
  `MutationObserver` over a live battle: **20 DOM writes a frame became 0.1 actual mutations a frame**
  — in a saturated battle the field sits at its ceiling and those values genuinely do not change
  between frames, so the old code was repainting the HUD for nothing sixty times a second.
- **The governor now has a second signal it cannot be blind to.** Our own work is still the primary
  measurement, because the gap between frames on its own is untrustworthy — a display capped at 30 Hz
  looks identical to a machine that cannot keep up. But when the wall clock says a frame took far
  longer than our work explains, that gap *is* the browser doing something expensive on our behalf, so
  the governor believes the wall clock instead. Only above 45 ms: no display caps below about 30 Hz,
  so a genuine 33 ms vsync is never mistaken for trouble. The HUD also shows the frame rate whenever
  it drops below 45, so there is a number to report rather than a feeling.

- **The hot fields live in typed arrays.** Separation and target-finding were spending most of their
  time chasing pointers — `gUnits[gItems[i]]`, then `.x`, then `.y`, then `.u.size`, three
  dereferences before any arithmetic. Benchmarked on the real separation loop over 26,000 troops, the
  *identical* work over flat `Float32Array`s ran in half the time (2.1 ms against 4.1–5.6 ms) and, more
  usefully, with a quarter of the variance — and variance is what a player feels as stutter.

  So the handful of fields those two loops touch (x, y, size, team, dead) are mirrored into parallel
  typed arrays indexed by grid slot. The unit objects stay the source of truth for everything else.
  The mirror is filled during the grid rebuild, which already walks every live unit; refreshed once
  before separation, since the main loop moves things; and written back after, separation being the
  only hot loop that moves anything. A death mid-step writes through to the mirror, or targeting would
  chase corpses.

  Honest accounting: the whole-`step` gain was **~1 ms of ~9 ms**, not the 2× the microbenchmark
  implied — separation is only part of `step`, and the mirror costs two extra passes over the army.
  The separation pass itself went from ~3.2 ms to **2.2 ms**, including those passes.
- **Sprite resolution folded into the vertex fill.** These were two separate walks over 26,000 units,
  kept apart because a sprite baked mid-pass invalidates the atlas the vertices are indexed against.
  In a steady battle nothing new is ever baked, so it is one pass now that simply repeats if the cache
  grew — the retry costs one frame's fill, once, and the saved walk is worth ~1.5 ms every frame.

- **The HUD was separately walking all 26,000 units every frame** for a per-side count and income.
  That tally now happens in the grid rebuild, which already touches every live unit — **1.2 ms →
  0.1 ms**.
- **Separation skips troops that are not crowded.** Checking the occupancy of a unit's own cell is one
  array read and skips the nine-cell scan entirely. It fires for about a quarter of the army in a full
  battle. A pair can be missed only if *both* are alone in their cells, since either one scanning
  pushes both apart.

- **Two things stop a crowd going quadratic.** A spatial hash is only a win while the crowd is spread
  across cells, and there is a real case where it is not: when one army takes the field, the survivors
  pile onto the enemy crystal and thousands of troops end up inside a couple of cells, each testing
  itself against every other. Measured at 80 ms a frame for a 24,000-troop field. Separation now caps
  the neighbours it tests per troop — pushing apart the nearest two dozen resolves the overlap just as
  well and keeps the cost linear whatever the crowd does. It also runs for only a fifth of the army
  each frame past 24,000 troops, since at two and a half pixels a body there is nothing to see.

- **The game measures the device and scales itself.** A battle size is written for a machine nobody
  can know in advance: CHAOS asks for 4,200 troops and MAELSTROM for 26,000, which a laptop shrugs off
  and an old phone does not. Each frame times its own simulation and drawing — deliberately *not* the
  gap between frames, since a 30 Hz display or a throttled background tab would otherwise look
  identical to a machine that cannot keep up. Past 13 ms of work it sheds; below 8 ms it gives the
  load back. Against synthetic devices it now lands within half a percent of the right ceiling —
  20,000 troops on a fast one, 12,955 where 13,000 was the theoretical limit, 6,471 where 6,500 was.
- **The first version of that governor did not work, and CHAOS was unplayable because of it.** Three
  separate faults, each of which alone was enough:
  - **It discarded any frame over 200 ms as "a hitch".** So the worse a device was struggling, the
    more certain the governor was to do nothing at all — on a machine taking 250 ms a frame it never
    shed a single troop, and the smoothed frame time sat at a comfortable 7 ms while the game was a
    slideshow. It clamps the sample now instead of throwing it away, and reacts fast to bad news
    (0.3 smoothing on the way up) while giving load back slowly (0.05 on the way down).
  - **It decided every 30 _frames_ and cut 10% each time.** At five frames a second that is a decision
    every six seconds, so climbing down from a full field took about two minutes. It decides on
    wall-clock now, and the cut is proportional: if a frame costs four times the budget the field is
    four times too big, and one decision says so.
  - **Throttling recruitment cannot shrink a field that is already full.** This one is a known limit
    rather than a fix. Measured on a device taking 250 ms a frame at CHAOS: the budget hits its floor
    within a second, but the four thousand troops already standing there are what costs the time, and
    they have to be worked off by the fighting. A version that retired the rear ranks to claw that
    time back was built and measured — playable in under five seconds instead of ninety-seven — and
    then removed, because troops quietly vanishing is a worse thing to watch than a slow recovery.
    The simplified bodies attack the same problem from the other side: they make each troop cheap
    enough that the ceiling is rarely reached at all.

- **The renderer asks the device which of the two is faster.** The batch should win by a distance, and
  does everywhere it can be measured here — but compositing a WebGL layer into a 2D canvas is a plain
  texture copy on some drivers and a full readback on others, and a readback would make it lose. That
  is not knowable from a machine with no GPU, so the game times both on the real one: a handful of
  frames each way, once per battle, once the field is big enough for the answer to matter, bailing out
  early once one is clearly 2.5× worse. The governor ignores the probe's frames, since the losing
  renderer's samples are not the device's real speed.
- **The buy sound had no throttle.** Every combat sound is rate-limited — "stops 200 swords becoming a
  buzzsaw" — but the one that fires on every purchase was not, because nothing had ever purchased 200
  times a second. Fixing the recruit rate made it do exactly that: **800 Web Audio nodes a second**
  across both crystals, each with scheduled gain ramps. It measures at only 2.9% of a frame budget on
  a desktop, but node creation on a phone is far more expensive, and 400 beeps a second was a buzzsaw
  nobody could hear anyway. Throttled to 19.
- **`Math.hypot` is not free.** V8's version guards against overflow that coordinates on a
  14000-unit map can never reach, at several times the cost of a plain `sqrt`. It was being called a
  few times per unit per frame.
- **Image smoothing off.** Sprites blit 1:1, so canvas filtering was pure waste — turning it off
  took a 2,900-troop CHAOS frame from 28.8 ms to 12.9 ms with no visual change whatsoever. Easily the
  cheapest win in the project.
- **A blocky crowd renderer was tried and rejected.** Drawing troops as flat rectangles past 1,800
  units tripled the frame rate, but a screenshot showed it read as Lego rather than an army. The
  sprites stayed; the smoothing fix made them affordable anyway.
- **Crowd rendering.** Past 900 troops the per-unit trimmings (hit flash, hover ring, veteran
  chevrons, full health bars) drop away, particles are capped, and separation resolves half the crowd
  per frame. Sprites for troops only a few pixels tall are baked in a cropped box, since the padding
  that accommodates lances and capes is otherwise most of the pixels being pushed. A 3,100-troop
  CHAOS battle on the 14000-wide map runs 5.9 ms of simulation and 16.0 ms of drawing — about 46 fps
  in software rendering, and hardware compositing is well clear of 60.
- **One virtual resolution.** The world is always 2000 units wide and the canvas scales to fit, so a
  phone in landscape sees the same proportions a desktop does rather than desktop-sized troops on a
  250-pixel strip of field. The shop collapses on short screens — smaller cards, then icons instead
  of names — so the battlefield always keeps about three quarters of the height. Troops are drawn in
  device space so each cached sprite blits 1:1 rather than being resampled — 9.3 ms versus 22.8 ms
  for 680 sprites.
- **Rendering.** Sprites are baked at three quantised perspective scales and blitted at native size
  on integer origins, which is far cheaper than scaled draws: a 680-unit battle draws in ~13 ms in
  software rendering, down from ~41 ms, and simulates in ~3.6 ms.
- **Stances are checked for dominance too.** A permanent turtle loses 0-5 to a pusher, which is the
  intent — HOLD is for surviving a bad patch, not a way to win by waiting.
