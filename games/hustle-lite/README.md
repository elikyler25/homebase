# Hustle Lite

A smaller, more polished take on [*Your Only Move Is HUSTLE*](https://store.steampowered.com/app/2212330/Your_Only_Move_Is_HUSTLE/) —
the simultaneous-turn fighting game where nobody has reflexes, only reads.

Two changes from the original:

1. **Fewer options.** Thirteen neutral moves per fighter instead of twenty-plus, on a
   three-character roster that all shares one defensive skeleton.
2. **The counters are shown.** Hover any move and the **threat board** runs *every* reply
   your rival currently has, simulates each one against your move, and ranks them. You stop
   having to watch them to learn what beats what.

Two modes: **Solo** (one on one, best of three) and **Squad** (three a side, where you order
two of your fighters in the same turn so they combo together).

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

## Squad mode

Three fighters a side, one on point and two on the bench. Every turn you order your point
fighter **and** may call one benched teammate, who runs in ahead of you and performs their
assist move a few frames later.

That delay is the whole feature. Land a knockdown, call an assist into the stun, and the two
of them combo together — the engine counts it as one string, so proration applies across the
pair rather than resetting for the second attacker.

The counterplay is that your teammate arrives **in front** of you and is fully exposed. Call
one into a fast poke and they eat it at 1.5× damage and sit on a long cooldown. Assists are
worth using (an always-call strategy beats a never-call one), but they are not free.

- **Call teammate** arms an assist; it folds into whichever move you press next, which keeps
  the grid at thirteen buttons instead of thirty-eight.
- **Tag** swaps your point fighter — twenty-four naked frames, so do it after a knockdown.
- Benched fighters recover slowly, but only back up to half health.
- Fighters carry smaller health pools in squad mode; three full-size pools a side never run
  out inside the clock.
- A team loses when all three are down, or on team health share at turn 110.

The threat board, the yomi chain and the post-mortem all work in squad mode and account for
assist calls on both sides — a row can read *"Charge + Bruiser"*.

## The roster

Three archetypes on the speed / reach / damage triangle. Guards, Parry, Dodge, movement,
Hustle, Burst and wake-ups are identical for everyone; identity comes from the five strikes,
the super, and how far each fighter walks.

| | Health | Fastest | Reach | Biggest hit | Identity |
|---|---|---|---|---|---|
| **Duelist** | 144 | 4f | 125 | 29 | Balanced. Armoured Lunge to get in. |
| **Bruiser** | 172 | 5f | 150 | 30 | Slow, heavily armoured, enormous. Low super goes under High Guard. |
| **Blade** | 124 | 3f | 150 | 29 | Fastest and longest, no armour. Steps *through* pokes instead of tanking them. |

In squad mode these pools are scaled down, since each side fields three of them.

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
- **Counter-hits**: catching someone in their wind-up pays extra damage and stun. This is
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

- **Overall win rates** across all matchups, position averaged: Duelist 44%, Bruiser 46%,
  Blade 60%. No matchup is worse than 34/66.
- **No dominant button.** The best single mashed move on any character wins a small fraction
  of a best-of-three against the Oracle AI; most win nothing at all.
- **Assists are worth it but not free**: always-call beats never-call, and both lose heavily
  to an AI that mixes.

**Known soft spots**, written down rather than papered over:

- Blade is still the strongest pick at 60%, and specifically beats the Duelist 66/34.
- High Guard, Low Guard and Hustle sit near 1% of AI play. Hustle is meant to be a rare greed
  option; the guards being that rare is a genuine weakness.
- Squad matches still reach the turn limit more often than they end in a wipeout — closer
  now that health drains properly, but the clock decides more of them than it should.

These numbers come from a one-ply AI playing itself. A human plays differently, so treat them
as a floor on health, not proof of it.

### The spacing weight

One number in `scoreFor` matters more than any frame data: the pull toward each character's
own effective range. Set too low, both AIs drift to a 270-unit stand-off where nothing
reaches, roughly 4% of turns land a hit, and every match is decided by the clock at
three-quarters health. Raising it to 9 puts the AI at a real fighting range with about a
fifth of turns connecting — and it changed the character balance enough to need a full
retune. If matches ever start feeling passive again, look here first.

## Layout

| Path | Role |
|------|------|
| `src/engine.js` | all fight logic: characters, squads, frame-by-frame resolution, threat board, yomi chain, post-mortem, AI. Pure — no DOM |
| `src/render.js` | canvas replay of an engine timeline, plus synthesised sound |
| `src/ui.js` | DOM, turn loop, input |
| `src/style.css` | presentation |
| `index.html` | dev entry point, loads `src/*` as modules |
| `build.py` | inlines everything into `dist/` (stdlib only) |
| `tests/engine.test.mjs` | 182 assertions locking down the solo RPS web |
| `tests/squad.test.mjs` | 79 assertions for teams, assists, tagging and lives |
| `tests/balance.mjs` | balance readout: dominant strategies, dead moves, matchup matrix |

## Working on it

```sh
node games/hustle-lite/tests/engine.test.mjs     # solo — must be green before committing
node games/hustle-lite/tests/squad.test.mjs      # squad — likewise
node games/hustle-lite/tests/balance.mjs         # readout, not pass/fail — slow, a few minutes
python3 games/hustle-lite/build.py --check       # rebuild both bundles
```

`build.py` writes two files: `hustle-lite.html` is a fragment for hosts that supply their own
document wrapper, and `hustle-lite-standalone.html` adds the wrapper so it opens by
double-clicking. `--check` asserts the output is genuinely self-contained.

Run the balance harness after any frame-data change. It is the only thing that catches a
dominant strategy or a dead move before a player does.
