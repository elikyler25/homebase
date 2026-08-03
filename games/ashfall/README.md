# ASHFALL

An original falling-sand roguelite in the spirit of Noita. One file, no build step,
no dependencies. Not affiliated with Nolla Games — no Noita assets or code are used.

Open `index.html` in a browser. That's the whole install.

## What it is

Every pixel of the world is simulated: sand falls, water flows and displaces, oil
floats on water and burns, fire spreads by material flammability, lava cools to stone
on contact with water, acid dissolves by per-material resistance, gunpowder chains.
The player is subject to all of it — smoke suffocates you in your own tunnel.

The wand is a **program**. Spells resolve left to right in a deck/draw model: a
modifier attaches to the first real spell on its right, a multicast pulls the next N
into one cast, a trigger makes a spell carry a payload it fires on impact. When a
modifier runs out of spells to its right the wand **wraps** to slot 1 and reads
again — then must recharge. That wrap is the deepest trick in the game, and the
sanctum's `RUN THE WAND` preview animates the read-head walking the tape so you can
see exactly what a build does before spending a run on it.

## Layout

| Path | Role |
|------|------|
| `index.html` | the entire game — sim, spells, worldgen, entities, render, UI |
| `test.js` | headless regression suite (see below) |

Inside `index.html` the sections are banner-commented in this order: materials → grid
→ sim → explosion → spells → wand → noise → biomes → worldgen → entities →
projectiles → mobs → particles → render → input → player → camera → HUD → screens →
perks → sanctum UI → flow → loop → wire → boot.

## Tests

```sh
npm i playwright
node games/ashfall/test.js
```

Boots the real game in headless Chromium and asserts against live state — no mocks,
it drives the same functions the game loop drives. Every case is a bug that actually
shipped: each fails before its fix and passes after. If you change the sim, the wand
resolver, or the perk table, run this first.

The suite is deliberately regression-shaped rather than exhaustive. When you fix a
bug, add the case that would have caught it.

## Conventions

- **Stdlib only.** No engine, no framework, no bundler. The game is one file a
  stranger can open from disk, and it should stay that way.
- **Comment the scar, not the code.** The long comments in `index.html` exist because
  something non-obvious went wrong there — biased hash producing a world with no
  caves, jetpack exhaust written as real cells suffocating the player, a multicast
  wrapping onto itself and firing 43 projectiles. Keep that habit: when a fix is
  subtle, write down what the bug looked like from the player's seat.
- **Perks must do what they say.** Each entry in `PERKS` is a promise in plain
  English; if the text says "sludge does nothing to you," the code has to honour it
  for sludge specifically. Several perks drifted from their own descriptions.
- Mark deliberate shortcuts with a `// ponytail:` comment naming the ceiling and the
  upgrade path.

## Known gaps

- The page pulls Silkscreen and IBM Plex Mono from Google Fonts, so offline it falls
  back to system monospace and the layout shifts slightly. Embedding subsets would
  fix it at the cost of file size.
- `shuffle` wands are honest about it in the UI, but the `RUN THE WAND` preview can
  only show slot order — it says so, but it can't predict a shuffled draw.
- Steam and smoke cannot rise through liquid (gas density loses the density test), so
  steam generated under water is stuck until the water drains.
