# Mirage War

A Miragine-War-style tactics duel for **two players on one screen**. Single HTML file, no build
step, no dependencies — open `index.html` in any browser and hit FIGHT.

## How it plays

Each round has two phases:

1. **Deploy** (25s, or until both players are ready) — spend gold on troops. Your army preview
   forms up on your half of the field. Melee sorts to the front, ranged behind.
2. **Battle** — the armies charge and fight on their own. Whoever still holds the field marches
   on the enemy castle; the damage scales with the gold value of your survivors (capped, so no
   single round ends the war).

Gold arrives every round and unspent gold earns 8% interest — saving for giants is a real option.
First castle to fall loses.

## Controls

| | Player 1 (blue, left) | Player 2 (red, right) |
|---|---|---|
| Buy | `1` `2` `3` `4` `5` `6` `7` | `U` `I` `O` `P` `[` `]` `\` |
| Refund last | `` ` `` | `Backspace` |
| Ready | `Left Shift` | `Right Shift` |

`M` mutes. The shop cards are clickable too, so a mouse works for either side.

## Units and counters

| Unit | Cost | Class | Notes |
|---|---|---|---|
| Peasant | 60 | infantry | cannon fodder, dies to anything with a cleave |
| Spearman | 130 | spears | 2.4× vs cavalry |
| Swordsman | 190 | infantry | 1.6× vs spears |
| Archer | 230 | ranged | long range, 1.7× vs infantry, poor vs armour |
| Knight | 350 | cavalry | fast, tramples ranged and mages, gutted by spears |
| Mage | 490 | mage | splash, 2.6× vs giants, folds to cavalry |
| Giant | 720 | tank | 1500 HP and a wide cleave that eats swarms |

Rock–paper–scissors is the whole game: whatever your opponent massed last round, buy its counter.
