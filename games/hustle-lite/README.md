# Hustle Lite

A smaller, more polished take on [*Your Only Move Is HUSTLE*](https://store.steampowered.com/app/2212330/Your_Only_Move_Is_HUSTLE/) —
the simultaneous-turn fighting game where nobody has reflexes, only reads.

Two changes from the original:

1. **Fewer options.** One shared moveset of thirteen neutral moves instead of five characters
   with twenty-plus each. Every move in it is load-bearing.
2. **The counters are shown.** Hover any move and the **threat board** runs *every* reply your
   rival currently has, simulates each one against your move, and ranks them. The top row is
   their best answer. You stop having to watch them to learn what beats what.

Open `index.html` in a browser, or `dist/hustle-lite.html` for the standalone single file.

## What it kept from the original

Researched from the Steam guides, the Mizuumi wiki and the community frame-data notes:

- **Simultaneous commitment.** Both fighters pick from frozen time; the turn then plays out
  frame by frame. There is no reacting, only predicting.
- **Frame advantage decides the next turn.** Land something and you act first; whiff and they do.
- **High/low guard, parry, grab, dodge.** Grabs beat guards, guards beat strikes, speed beats
  everything slower to the punch.
- **Meter and Hustle.** Hustle is a taunt that banks two meter and thirty frames of standing
  perfectly still. Meter buys an invulnerable reversal.
- **Burst.** Escapes a combo — unless they read it and guard, in which case it is simply gone.
- **Proration, guts, and sadness.** Long combos scale down, low health takes less, and refusing
  to engage costs you health.

## What it changed

- **One archetype, mirrored.** No character select.
- **Armoured Lunge** as the designated approach tool, because with no jumps or projectiles a
  fast poke would otherwise wall the approach entirely (the balance harness found this).
- **A 60-turn clock.** Time over goes to whoever is ahead on health.
- **Sadness is per fighter**, not global — the one running away is the one who bleeds, so two
  passive fighters cannot tie their way to a draw.

## The rock-paper-scissors web

| Move | Beats | Loses to |
|------|-------|----------|
| Jab (4f) | anything slower to the punch | Parry, Dodge, guards |
| Sweep (low) | High Guard, Parry | Low Guard, Jab, Dodge |
| Overhead (high) | Low Guard, Parry, Dodge | High Guard, Jab |
| Lunge (armoured) | pokes, Parry, Dodge | guards, Grab |
| Grab | both guards, Parry, Lunge's armour | Jab, Dodge, Rising Fang |
| Parry (frames 2–7) | Jab, Rising Fang | everything slower, Grab |
| Dodge Roll | almost everything | Lunge, and the tempo you gave up |
| Rising Fang (2 meter) | slow strikes, Grab | guards, Parry |

Nothing here is hardcoded — it falls out of the frame data in `src/engine.js`, which is also
what the threat board and the AI read. If the numbers change, the table changes with them.

## The rival

Not a script. Each turn it builds the full payoff matrix over both movesets, solves it with
fictitious play for a mixed equilibrium, and samples from that. Difficulty controls two dials:
how much noise is added, and how heavily it best-responds to a read of your recent habits.

| Level | Behaviour |
|-------|-----------|
| Rookie | Mostly random. Learn the buttons. |
| Fighter | Plays the odds, forgives habits. |
| Yomi | Mixes well and starts reading you. |
| Oracle | Punishes any pattern you show. |

Because it solves the same matrix the threat board shows you, the board is never a cheat sheet
against it — you both know the best answer, which is exactly the layer the original game is about.

## Layout

| Path | Role |
|------|------|
| `src/engine.js` | all fight logic: moves, frame-by-frame resolution, threat board, AI. Pure — no DOM |
| `src/render.js` | canvas replay of an engine timeline, plus synthesised sound |
| `src/ui.js` | DOM, turn loop, input |
| `src/style.css` | presentation |
| `index.html` | dev entry point, loads `src/*` as modules |
| `build.py` | inlines everything into `dist/hustle-lite.html` (stdlib only) |
| `tests/engine.test.mjs` | 129 assertions locking down the RPS web |
| `tests/balance.mjs` | balance readout: dominant strategies and dead moves |

## Working on it

```sh
node games/hustle-lite/tests/engine.test.mjs     # must be green before committing
node games/hustle-lite/tests/balance.mjs         # readout, not pass/fail
python3 games/hustle-lite/build.py --check       # rebuild the single-file bundle
```

`build.py --check` asserts the bundle is genuinely self-contained: no surviving imports or
exports, no external hosts, no stray document wrapper.

The balance harness is the one to run after any frame-data change. It answers whether a single
mashed button can beat a thinking opponent, and whether every move still earns its slot.
