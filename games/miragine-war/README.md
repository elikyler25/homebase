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
| **CHAOS ×10** | 44000 wide (290× the area) | ×200 | one troop / 0.0025s | 200,000 | 20,000 |

EPIC is the same game at a different scale: twice the map, four times the gold and six times the
recruit rate, so armies run into the many hundreds and the front line becomes a solid wall of bodies.

CHAOS takes EPIC's dials ten times further — forty times the gold, sixty times the recruit rate.
Troops pour out faster than they can die, the field saturates in seconds and stays that way, and a
match is decided by which wall of bodies grinds through first. Measured with both sides recruiting
flat out: **4,200 troops on the field** — the ceiling — eleven thousand kills in
the first two and a half minutes and neither crystal scratched — CHAOS is decided by sudden death far
more often than by a breakthrough.

**Champions scale with the battle size.** At forty times the gold a 5,600-gold champion was
affordable in a tenth of a second and swallowed by the crowd immediately, which made it confetti.
Champion price and HP now scale with the mode: ×4 price and ×2.2 HP in EPIC, ×14 and ×4.5 in CHAOS.
A CHAOS champion arrives around the ten-second mark and is still standing minutes later.

One honest limit: **the map is capped by legibility, not by the engine.** Two people share one screen
with no scrolling, so a wider world means smaller troops, and past a point they stop being visible at
all — at CHAOS's zoom a rank-and-file soldier is 7 pixels tall, which is about the floor for reading
who is who. The map is 29× the area of NORMAL and bodies scale 3.4× to stay visible inside it.

**CHAOS ×10** is CHAOS again: ten times the area, five times the gold, twice the recruit rate. A
rank-and-file soldier is three pixels tall and individual troops stop being the unit of thought —
you are moving continents of bodies, and the front line is a churning coastline hundreds of troops
long. Measured with both sides recruiting flat out: **~19,700 troops on the field.**

Getting there needed a bug fixed first. The recruit loop bought at most one troop per frame and threw
away the remainder, so every rate faster than about 1/60s silently clamped: CHAOS asked for 200
troops a second and delivered 60, EPIC asked for 20 and delivered 15, and CHAOS ×10's whole point —
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

- A **light-killer** (Ninja, Berserker, Headhunter, Gladiator) does 98 to light and 9 to armoured —
  it butchers fodder and cannot dent plate.
- An **armour-breaker** (Monk, Runecaster, Bone Mage, Oracle) is the reverse at 26 / 152 — it exists
  to delete walls.
- A **wall** (Iron Ox, Ice Giant, Mammoth, Minotaur) has 14 armour, so fodder's 5 damage lands as the
  minimum chip of 2. Swarms literally cannot kill it; you need the breaker.

Press <kbd>H</kbd> in game for the counter chart.

Hover any shop card for the full stat line. The bar under each card is a **live counter advisor** —
it scores that unit against the enemy's army as it stands right now, green for a strong pick and red
for a wasted one, so you can read the matchup without memorising the table.

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
| **TRIBE** | Bone and muscle | Mammoth: +320 HP | **Chieftain** — every ally within 340 hits 30% harder |
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
  batching into one draw call, CHAOS ×10 spent 86.7 ms a frame in plain JavaScript at 19,700 troops:
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
- **Simpler sprites were the obvious idea and turned out not to be the problem.** At three pixels a
  troop the whole atlas is 48 sprites in a 2048×10 strip, baked once; drawing was never the bottleneck
  at this scale. The cost was all in per-troop bookkeeping — string keys, Map lookups, per-frame
  allocation, and a targeting scan that should not have been running.
- **The army is one draw call.** Canvas2D charges about 4 microseconds of call overhead per
  `drawImage`, so three thousand troops cost ~12 ms of CPU before a single pixel is filled — the
  frame was draw-call bound, not fill bound (the whole army is roughly one screenful of pixels, and
  a 3,100-troop frame used only 47 distinct sprites). Packing an atlas and drawing it with the
  9-argument `drawImage` only recovered 16%, because the overhead is per call. So the baked sprites
  now go into a WebGL texture and the entire army is submitted as a single triangle batch: **12.0 ms
  of CPU becomes 1.0 ms** (0.52 ms filling the vertex buffer, 0.45 ms uploading and drawing, 0.01 ms
  compositing the layer back into the 2D canvas). Everything else — ground, crystals, effects, bars,
  radar — stays on 2D, so layering and screen shake are untouched.
- **The batch is declined when it would not help.** Chrome silently falls back to a software GL
  driver whenever the real GPU is blocklisted, and software-rasterising three thousand textured
  quads is *slower* than the Canvas2D path it replaces — measured 30.0 ms against 16.2 ms on the
  same frame. The renderer string is checked for SwiftShader/llvmpipe and the batch is refused.
  Below 350 troops it is refused too: a full-screen GL layer has a fixed cost a skirmish never earns
  back. Missing WebGL and a lost context both fall back the same way, verified by blocking
  `getContext('webgl')` and by firing `WEBGL_lose_context` mid-battle — 3,100 troops kept rendering,
  no exceptions either time.
- **The game measures the device and scales itself.** A battle size is written for a machine nobody
  can know in advance: CHAOS asks for 4,200 troops and CHAOS ×10 for 20,000, which a laptop shrugs off
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
  - **Throttling recruitment cannot shrink a field that is already full.** Measured on a device taking
    250 ms a frame at CHAOS: the budget hit its floor within a second, and the battle then took **97
    more seconds to resolve, every one of them a slideshow**, because the four thousand troops already
    standing there were the cost. The governor now also retires the rear ranks — troops with nobody in
    reach, furthest from the fighting, never a champion. Same scenario: **playable in under five
    seconds.**
- **Retiring troops cannot decide a battle.** They are removed rather than killed, so no kill is
  credited and no body is left, and each side gives up the same *fraction* of its army — capped by
  what the smaller side can actually spare. A flat proportional split looked fair and was not: a
  player 13:1 ahead has thousands of troops walking up behind the line while the loser has none to
  give, so the cut fell almost entirely on the winner and took their lead from 93% of the field to
  71%. With the cap, a lopsided field keeps its 0.928 share exactly and a mirror match retires
  460/461 down to 291/291.
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
- **The radar is baked.** It repainted 3,000 blips a frame — about 2 ms of `fillRect`, with a
  `fillStyle` assignment per blip — and a cloud of two-pixel dots does not change meaningfully at
  60 Hz. Batched by side and cached into a small offscreen canvas refreshed every fifth frame:
  2.05 ms → 0.23 ms. It was also still sized in *world* units, so growing CHAOS to 14000 wide had
  quietly shrunk it to a 58×4 pixel smear; every dimension in it is now screen-relative.
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
