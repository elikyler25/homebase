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
- An **Iron Knight** has 20 armour, so a Newbie's 5 damage lands as the minimum chip of 2. Swarms
  literally cannot kill it — but a **Vampire** hits it for 150 and heals 75% of that back.
- The **Dread Lord** is deliberately LIGHT. If the whole top of the ladder were armoured, every
  anti-light unit would be dead weight late game, so the second-most-expensive unit is a fast
  unarmoured demon that Ninjas and Samurai can actually punish.

Press <kbd>H</kbd> in game for the counter chart.

Hover any shop card for the full stat line.

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

Lane cycles SPREAD → TOP → MID → BOT, so you can mass on a flank instead of feeding the meat
grinder in the middle. Mending costs ◆450 for 700 crystal HP — a gold sink that buys you a comeback
if you can hold the field. `Space` pauses, `-`/`=` set game speed (1–3×), `H` shows the counter
chart, `` ` `` mutes. Clicking a card buys it; hovering one picks that unit type out of the melee.

## The roster

A straight price ladder, cheapest to most expensive:

| # | Unit | Price | Income | HP | Armour | Type | vs Light | vs Armored | Range |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Newbie | 40 | 2 | 70 | 0 | light | 12 | 5 | 22 |
| 2 | Veteran | 90 | 4 | 140 | 1 | light | 21 | 10 | 24 |
| 3 | Zombie | 140 | 5 | 320 | 2 | light | 18 | 13 | 22 |
| 4 | Samurai | 200 | 7 | 190 | 2 | light | 58 | 14 | 26 |
| 5 | Sword Man | 280 | 9 | 260 | 4 | armored | 33 | 24 | 26 |
| 6 | Ninja | 360 | 11 | 170 | 1 | light | 98 | 9 | 24 |
| 7 | Novice | 440 | 14 | 200 | 2 | light | 36 | 36 | 160 |
| 8 | Heavy Sword | 560 | 17 | 540 | 8 | armored | 43 | 43 | 30 |
| 9 | Monk | 700 | 20 | 300 | 3 | light | 26 | 152 | 130 |
| 10 | Vampire | 880 | 24 | 460 | 4 | light | 58 | 150 | 28 |
| 11 | Cavalry | 1100 | 28 | 620 | 6 | armored | 76 | 38 | 30 |
| 12 | Immortal | 1400 | 33 | 1150 | 12 | armored | 51 | 51 | 30 |
| 13 | Mage | 1750 | 38 | 380 | 2 | light | 78 | 78 | 205 |
| 14 | Iron Knight | 2200 | 44 | 1900 | 20 | armored | 94 | 70 | 34 |
| 15 | Dread Lord | 2800 | 52 | 1650 | 4 | **light** | 128 | 110 | 36 |
| 16 | High Lord | 3600 | 62 | 2600 | 16 | armored | 148 | 124 | 40 |

Cavalry, Iron Knight, Dread Lord and High Lord cleave a splash radius; Mage lobs splash at long
range; Vampire drains. There is no unit cap — gold is the only limit.

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
- **The CPU** reads the enemy army by remaining HP and buys the best-scoring unit it can afford.
  What separates the difficulties is *awareness*, not reaction speed: easy fights blind (it assumes
  a 50/50 enemy composition and caps itself at cheap units), normal reads the enemy through noise,
  hard reads it exactly. Measured over repeated games against a competent scripted opponent, easy
  wins 0/5, normal 3/5, hard 4/5.
- **Balance is simulated, not guessed.** Headless duels pit strategies against each other —
  blind teching, counter-buying by value, and cheap swarming. An earlier build had teching beating
  counter-play every time, which made the whole roster flat; after sharpening the specialists and
  trimming the top-tier generalists, counter-buying wins about 7 games in 10 and both beat swarming
  5/5.
