# Hustle Lite

A smaller, more polished take on [*Your Only Move Is HUSTLE*](https://store.steampowered.com/app/2212330/Your_Only_Move_Is_HUSTLE/) —
the simultaneous-turn fighting game where nobody has reflexes, only reads.

Two changes from the original:

1. **Fewer options.** Thirteen neutral moves per fighter instead of twenty-plus, on a
   three-character roster that all shares one defensive skeleton.
2. **The counters are shown.** Hover any move and the **threat board** runs *every* reply
   your rival currently has, simulates each one against your move, and ranks them. You stop
   having to watch them to learn what beats what.

Open `index.html` in a browser, or `dist/hustle-lite-standalone.html` for the single file.

## The Oracle

Four settings, in the header, from teaching tool to blindfold:

- **Full board** — every reply they hold, ranked, with damage and frame advantage. The top
  row is crowned as their best answer.
- **Yomi chain** — the ladder instead of the list. What beats your move; what beats *that*
  (the move to play if you think they have read you); what beats that. The chain stops where
  the read loops, which is the exact point where thinking one level deeper stops helping.
- **Risk only** — the temperature, not the list.
- **Off** — you are on your own.

After every exchange, a line under the arena tells you what would actually have worked:
*"They played Parry. Grab was the answer — hit · 8, you end +14f. Yours ranked 7 of 13."*

None of this is hardcoded. The board, the chain and the post-mortem all call the same
`resolveTurn()` the fight itself runs, so they cannot drift out of step with the game. A test
asserts that replaying the top row reproduces its displayed numbers exactly.

## The roster

Three archetypes on the speed / reach / damage triangle. Guards, Parry, Dodge, movement,
Hustle, Burst and wake-ups are identical for everyone; identity comes from the five strikes,
the super, and how far each fighter walks.

| | Health | Fastest | Reach | Biggest hit | Identity |
|---|---|---|---|---|---|
| **Duelist** | 144 | 4f | 125 | 29 | Balanced. Armoured Lunge to get in. |
| **Bruiser** | 158 | 6f | 150 | 30 | Slow, heavily armoured, enormous. Low super goes under High Guard. |
| **Blade** | 137 | 3f | 150 | 29 | Fastest and longest, no armour. Steps *through* pokes instead of tanking them. |

## What it kept from the original

Researched from the Steam guides, the Mizuumi wiki and community frame-data notes:

- **Simultaneous commitment.** Both fighters pick from frozen time; the turn plays out frame
  by frame. No reacting, only predicting.
- **Frame advantage decides the next turn.**
- **High/low guard, parry, grab, dodge.** Grabs beat guards; guards beat strikes; speed beats
  anything slower to the punch.
- **Meter and Hustle.** Hustle is a taunt that banks two meter and thirty frames of standing
  perfectly still.
- **Burst.** Escapes a combo — unless they read it and guard, in which case it is simply gone.
- **Proration, guts, and sadness.** Long combos scale down, low health takes less, and
  refusing to engage costs you health.

## What it changed

- **Best of three rounds**, with a 70-turn clock decided on health share.
- **Counter-hits**: catching someone in their wind-up pays 40% extra damage and stun. This is
  what makes raw speed worth having.
- **Armour is taxed** — powering through a hit costs you 28% of your own follow-through, so it
  is a trade rather than a free pass.
- **Sadness is per fighter**, so the one running away is the one who bleeds.
- **Fighters cannot swap sides.** An overshooting dash stops at the opponent.

## The rock-paper-scissors web

| Move | Beats | Loses to |
|------|-------|----------|
| Fast poke | anything slower to the punch; wind-ups, for counter-hit damage | Parry, Dodge, guards |
| Low | High Guard, Parry | Low Guard, faster strikes |
| High | Low Guard, Parry, Dodge | High Guard, faster strikes |
| Armoured approach | pokes, Parry | guards, Grab |
| Grab | both guards, Parry, armour | anything faster, Dodge |
| Parry (frames 2–9) | fast strikes and supers | everything slower, Grab |
| Dodge Roll | almost everything | chasing moves, and the tempo you gave up |
| Super | slow strikes, Grab | guards, Parry |

Nothing here is hardcoded — it falls out of the frame data in `src/engine.js`, which is also
what the threat board and the AI read.

## The rival

Not a script. Each turn it builds the full payoff matrix over both movesets, solves it with
fictitious play for a mixed equilibrium, and samples from that. Difficulty controls how much
noise is added and how heavily it best-responds to a read of your recent habits.

| Level | Behaviour |
|-------|-----------|
| Rookie | Mostly random. Learn the buttons. |
| Fighter | Plays the odds, forgives habits. |
| Yomi | Mixes well and starts reading you. |
| Oracle | Punishes any pattern you show. |

Because it solves the same matrix the threat board shows you, the board is never a cheat sheet
against it — you both know the best answer, which is exactly the layer the original is about.

## Balance, honestly

From `tests/balance.mjs`, the current state:

- **No dominant button.** The best single mashed move on any character wins 20% of a
  best-of-three against the Oracle AI; most win 0–3%.
- **The roster is a cycle**: Blade beats Duelist, Duelist ties Bruiser, Bruiser beats Blade.
  Picking a character is itself a read. The Bruiser–Blade edge is steep (roughly 87/13), so
  counterpicking matters more than it should there.
- **Soft spot**: High Guard, Low Guard and Hustle still sit near 1% of AI play. Hustle is
  meant to be a rare greed option; the guards being that rare is a genuine weakness, and the
  next balance pass should look at making lows and highs more threatening.

These numbers come from a one-ply AI playing itself. A human plays differently, so treat them
as a floor on health, not proof of it.

## Layout

| Path | Role |
|------|------|
| `src/engine.js` | all fight logic: characters, frame-by-frame resolution, threat board, yomi chain, post-mortem, AI. Pure — no DOM |
| `src/render.js` | canvas replay of an engine timeline, plus synthesised sound |
| `src/ui.js` | DOM, turn loop, input |
| `src/style.css` | presentation |
| `index.html` | dev entry point, loads `src/*` as modules |
| `build.py` | inlines everything into `dist/` (stdlib only) |
| `tests/engine.test.mjs` | 182 assertions locking down the RPS web |
| `tests/balance.mjs` | balance readout: dominant strategies, dead moves, matchup matrix |

## Working on it

```sh
node games/hustle-lite/tests/engine.test.mjs     # must be green before committing
node games/hustle-lite/tests/balance.mjs         # readout, not pass/fail — slow, a few minutes
python3 games/hustle-lite/build.py --check       # rebuild both bundles
```

`build.py` writes two files: `hustle-lite.html` is a fragment for hosts that supply their own
document wrapper, and `hustle-lite-standalone.html` adds the wrapper so it opens by
double-clicking. `--check` asserts the output is genuinely self-contained.

Run the balance harness after any frame-data change. It is the only thing that catches a
dominant strategy or a dead move before a player does.
