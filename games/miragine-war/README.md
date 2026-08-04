# Mirage War

A two-player-on-one-keyboard take on **Miragine War**. Single HTML file, no build step, no
dependencies, no network — open `index.html` in a browser and hit FIGHT.

## How it plays

There are no turns and no waiting. Both players buy troops whenever they can afford them, and each
one marches out of their crystal the moment it's bought. Destroy the enemy crystal to win. Crystals
shoot back at anything that gets close.

### Armour is the counter system

Every unit is **LIGHT** or **ARMORED**, and every unit has two separate damage numbers — one
against light, one against armoured. On top of that, armour subtracts flat damage from every hit.

That's the whole rock-paper-scissors:

- A **Ninja** does 74 to light and 9 to armoured — it butchers cheap infantry and cannot dent plate.
- A **Monk** is the reverse (26 / 118) — it exists to delete armoured units.
- An **Iron Knight** has 20 armour, so a Newbie's 5 damage lands as the minimum chip of 2. Swarms
  literally cannot kill it. A **Vampire** can — 118 vs armoured, and it heals for 75% of the damage
  it deals.

Hover any shop card for that unit's full stat line.

### Your army is your economy

Every living unit pays **income** at each payday (every 15 seconds — that's the round counter). Keep
units alive and they fund the next wave; trade badly and you lose the fight and the bank at once.
Income also rises with the round number, so late-game armies get expensive fast.

## Controls

| | Player 1 (blue, left) | Player 2 (red, right) |
|---|---|---|
| Buy row 1 | `1` `2` `3` `4` `Q` `W` `E` `R` | `7` `8` `9` `0` `U` `I` `O` `P` |
| Buy row 2 | `A` `S` `D` `F` `Z` `X` `C` `V` | `J` `K` `L` `;` `M` `,` `.` `/` |

`Space` pauses, `` ` `` mutes. Clicking a card buys it too, so a mouse works for either side.

## The roster

A straight price ladder, cheapest to most expensive:

| # | Unit | Price | Income | HP | Armour | Type | vs Light | vs Armored | Range |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Newbie | 40 | 2 | 70 | 0 | light | 12 | 5 | 22 |
| 2 | Veteran | 90 | 4 | 140 | 1 | light | 21 | 10 | 24 |
| 3 | Zombie | 140 | 5 | 320 | 2 | light | 18 | 13 | 22 |
| 4 | Samurai | 200 | 7 | 190 | 2 | light | 42 | 14 | 26 |
| 5 | Sword Man | 280 | 9 | 260 | 4 | armored | 33 | 24 | 26 |
| 6 | Ninja | 360 | 11 | 170 | 1 | light | 74 | 9 | 24 |
| 7 | Novice | 440 | 14 | 200 | 2 | light | 38 | 38 | 160 |
| 8 | Heavy Sword | 560 | 17 | 540 | 8 | armored | 43 | 43 | 30 |
| 9 | Monk | 700 | 20 | 300 | 3 | light | 26 | 118 | 130 |
| 10 | Vampire | 880 | 24 | 420 | 4 | light | 54 | 118 | 28 |
| 11 | Cavalry | 1100 | 28 | 620 | 6 | armored | 76 | 38 | 30 |
| 12 | Immortal | 1400 | 33 | 1150 | 12 | armored | 51 | 51 | 30 |
| 13 | Mage | 1750 | 38 | 380 | 2 | light | 89 | 89 | 205 |
| 14 | Iron Knight | 2200 | 44 | 1900 | 20 | armored | 101 | 76 | 34 |
| 15 | Dread Lord | 2800 | 52 | 1500 | 10 | armored | 139 | 120 | 36 |
| 16 | High Lord | 3600 | 62 | 2600 | 16 | armored | 164 | 139 | 40 |

Cavalry, Iron Knight, Dread Lord and High Lord cleave a splash radius; Mage lobs splash at long
range; Vampire drains. There is no unit cap — gold is the only limit.
