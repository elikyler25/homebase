# Mirage War

A one-screen, two-player take on **Miragine War**. Single HTML file, no build step, no
dependencies, no network — open `index.html` in a browser and hit FIGHT.

Works on a phone or tablet in landscape: tap the cards to buy. Turn the device sideways — it asks
you to.

Also playable solo: pick **VS CPU** on the menu (easy / normal / hard).

## Battle sizes

Pick one on the menu, alongside the opponent:

| | Map | Gold | Recruit rate | Crystal | Troop ceiling |
|---|---|---|---|---|---|
| **NORMAL BATTLE** | 2600 wide | ×1 | one troop / 0.30s | 6,000 | 2,600 |
| **EPIC BATTLE** | 5200 wide (4× the area) | ×4 | one troop / 0.05s | 18,000 | 2,600 |
| **CHAOS** | 9000 wide (12× the area) | ×40 | one troop / 0.005s | 48,000 | 3,200 |

EPIC is the same game at a different scale: twice the map, four times the gold and six times the
recruit rate, so armies run into the many hundreds and the front line becomes a solid wall of bodies.

CHAOS takes EPIC's dials ten times further — forty times the gold, sixty times the recruit rate.
Troops pour out faster than they can die, the field saturates in seconds and stays that way, and a
match is decided by which wall of bodies grinds through first. Measured with both sides recruiting
flat out: **~2,900 troops on the field**, both sides pinned at the ceiling, ten thousand kills in the
first two and a half minutes and neither crystal scratched — CHAOS is decided by sudden death far
more often than by a breakthrough.

**Champions scale with the battle size.** At forty times the gold a 5,600-gold champion was
affordable in a tenth of a second and swallowed by the crowd immediately, which made it confetti.
Champion price and HP now scale with the mode: ×4 price and ×2.2 HP in EPIC, ×14 and ×4.5 in CHAOS.
A CHAOS champion arrives around the ten-second mark and is still standing minutes later.

One honest limit: **the map could not go the full ten times.** Two people share one screen with no
scrolling, so a wider world means smaller troops, and past a point they stop being visible at all —
at CHAOS's zoom a soldier is already under ten pixels tall. The map grows as far as legibility
allows (12× the area of NORMAL) and bodies scale up with it; gold and recruit rate take the full 10×.

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
- **The CPU** profiles the enemy army by remaining HP *per unit type*, then scores every affordable
  unit by damage-after-their-armour against how long it would survive their damage output.
  What separates the difficulties is *awareness*, not reaction speed: easy fights blind (it assumes
  a 50/50 enemy composition and caps itself at cheap units), normal reads the enemy through noise,
  hard reads it exactly. Benchmarked against a *strong* scripted player — one that counter-picks by
  value every 0.4s — easy wins 0/6, normal 3/6, hard 5/6.
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
- **Image smoothing off.** Sprites blit 1:1, so canvas filtering was pure waste — turning it off
  took a 2,900-troop CHAOS frame from 28.8 ms to 12.9 ms with no visual change whatsoever. Easily the
  cheapest win in the project.
- **A blocky crowd renderer was tried and rejected.** Drawing troops as flat rectangles past 1,800
  units tripled the frame rate, but a screenshot showed it read as Lego rather than an army. The
  sprites stayed; the smoothing fix made them affordable anyway.
- **Crowd rendering.** Past 900 troops the per-unit trimmings (hit flash, hover ring, veteran
  chevrons, full health bars) drop away, particles are capped, and separation resolves half the crowd
  per frame. Sprites for troops only a few pixels tall are baked in a cropped box, since the padding
  that accommodates lances and capes is otherwise most of the pixels being pushed. A 2,770-troop
  CHAOS battle draws in ~28 ms in software rendering.
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
