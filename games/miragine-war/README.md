# Mirage War

A one-screen, two-player take on **Miragine War**. Single HTML file, no build step, no
dependencies, no network — open `index.html` in a browser and hit FIGHT.

Also playable solo: pick **VS CPU** on the menu (easy / normal / hard).

## How it plays

No turns and no waiting. Both sides buy troops whenever they can afford them, and each one marches
out of their crystal the moment it's bought. Shatter the enemy crystal to win. Crystals shoot back,
so a thin push gets picked apart before it lands.

### Armour is the counter system

Every unit is **LIGHT** or **ARMORED**, and every unit has two separate damage numbers — one
against light, one against armoured. Armour then subtracts flat damage from every hit.

That's the whole rock-paper-scissors:

- A **Ninja** does 98 to light and 9 to armoured — it butchers cheap infantry and cannot dent plate.
- A **Monk** is the reverse (26 / 152) — it exists to delete armoured units.
- An **Iron Knight** has 14 armour, so a Newbie's 5 damage lands as the minimum chip of 2. Swarms
  literally cannot kill it — but a **Vampire** hits it for 150 and heals 75% of that back.
- The **Dread Lord** is deliberately LIGHT. If the whole top of the ladder were armoured, every
  anti-light unit would be dead weight late game, so the second-most-expensive unit is a fast
  unarmoured demon that Ninjas and Samurai can actually punish.

Press <kbd>H</kbd> in game for the counter chart.

Hover any shop card for the full stat line. The bar under each card is a **live counter advisor** —
it scores that unit against the enemy's army as it stands right now, green for a strong pick and red
for a wasted one, so you can read the matchup without memorising the table.

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
top of a base that grows each round. Units you keep alive fund the next wave, so a bad trade costs
you the fight and the bank at once.

## Controls

| | Player 1 (blue, left) | Player 2 (red, right) |
|---|---|---|
| Buy row 1 | `1` `2` `3` `4` `Q` `W` `E` `R` | `7` `8` `9` `0` `U` `I` `O` `P` |
| Buy row 2 | `A` `S` `D` `F` `Z` `X` `C` `V` | `J` `K` `L` `;` `M` `,` `.` `/` |
| Spawn lane | `Left Shift` | `Right Shift` |
| Mend crystal | `5` | `6` |
| Stance | `T` | `'` |

Lane cycles SPREAD → HIGH → MID → LOW, so you can mass on a flank instead of feeding the meat
grinder in the middle. Stance toggles ADVANCE / HOLD — on HOLD your troops fall back to your own
half and fight under your crystal's guns instead of marching out, which is how you survive a bad
patch. The cost is that your opponent takes the shrine while you sit. Mending costs ◆450 for 700 crystal HP — a gold sink that buys you a comeback
if you can hold the field. `Space` pauses, `-`/`=` set game speed (1–3×), `H` shows the counter
chart, `` ` `` mutes. Clicking a card buys it; hovering one picks that unit type out of the melee.

## The roster

A straight price ladder, cheapest to most expensive:

| # | Unit | Price | Income | HP | Armour | Type | vs Light | vs Armored | Range |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Newbie | 22 | 2 | 70 | 0 | light | 12 | 5 | 22 |
| 2 | Veteran | 55 | 4 | 140 | 1 | light | 21 | 10 | 24 |
| 3 | Zombie | 95 | 5 | 320 | 2 | light | 18 | 13 | 22 |
| 4 | Samurai | 185 | 7 | 190 | 2 | light | 58 | 14 | 26 |
| 5 | Sword Man | 190 | 9 | 260 | 4 | **armored** | 33 | 24 | 26 |
| 6 | Ninja | 330 | 11 | 170 | 1 | light | 98 | 9 | 24 |
| 7 | Novice | 360 | 14 | 200 | 2 | light | 36 | 36 | 140 |
| 8 | Heavy Sword | 520 | 17 | 540 | 8 | **armored** | 43 | 43 | 30 |
| 9 | Monk | 820 | 20 | 260 | 3 | light | 26 | 152 | 112 |
| 10 | Vampire | 1250 | 24 | 460 | 4 | light | 58 | 150 | 28 |
| 11 | Cavalry | 1450 | 28 | 620 | 6 | **armored** | 76 | 38 | 30 |
| 12 | Immortal | 1500 | 33 | 1150 | 12 | **armored** | 51 | 51 | 30 |
| 13 | Mage | 1900 | 38 | 300 | 2 | light | 78 | 78 | 170 |
| 14 | Iron Knight | 3200 | 44 | 1700 | 14 | **armored** | 78 | 58 | 34 |
| 15 | Dread Lord | 4600 | 52 | 1500 | 4 | light | 128 | 110 | 36 |
| 16 | High Lord | 8200 | 62 | 2200 | 12 | **armored** | 130 | 108 | 40 |

Mage and Cavalry carry the widest cleave — they are the answer to swarms. Dread Lord and High Lord
cleave a little; the Iron Knight is a pure wall with none. Vampire drains. There is no unit cap —
gold is the only limit.

**Elites win the field, cheap troops break the crystal.** Siege damage is mostly per-body rather
than per-power, so a High Lord is not also the best battering ram. Winning the fight and cashing it
in are two different jobs.

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
- **Balance is simulated, not guessed.** A headless harness runs round-robin duels between
  strategies — blind teching, counter-picking, tech-rushing, cheap swarming — and reports win/loss.
  It has caught three real design faults so far: teching beating counter-play every time (the roster
  was decorative), the top two units being ~4× the value-per-gold of everything else, and — the one
  no static metric found — ranged units quietly dominating, because they fire from behind a melee
  screen and take almost nothing back. Counter-picking now beats blind teching 5-1, and picking the
  *wrong* counter loses 6-0, which is the shape you want.
- **Colour is never the only cue.** Blue rings are solid, red rings are dashed.
- **Rendering.** Sprites are baked at three quantised perspective scales and blitted at native size
  on integer origins, which is far cheaper than scaled draws: a 680-unit battle draws in ~13 ms in
  software rendering, down from ~41 ms, and simulates in ~3.6 ms.
- **Stances are checked for dominance too.** A permanent turtle loses 0-5 to a pusher, which is the
  intent — HOLD is for surviving a bad patch, not a way to win by waiting.
