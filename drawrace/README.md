# DrawRace

A rebuild of **DrawRace 2: Racing Evolved** (RedLynx, 2011) for the web, mobile-first.

Trace your racing line around the circuit. How fast you draw is how fast the car goes — so
slow your finger through the corners, or watch it run wide. Then lift your finger and watch
the lap play out against four opponents.

## The mechanic

One gesture per race. The stroke you draw carries a speed at every point, and the car tries
to be at that speed, there, with the grip it actually has.

- **The line is the readback.** Wide and pale where you were slow, tapering to a thin red
  stripe where you were flat out. You debug your own lap by looking at it.
- **Grip is a budget.** Turning and accelerating compete for one friction circle. Ask for
  more lateral acceleration than the tyres own and the car simply cannot make the corner —
  it runs wide, onto the grass, exactly as far as your greed deserved.
- **Sliding tyres give back less.** Past the limit, grip falls off, so overdriving compounds:
  wider, less grip, wider still. Overcooking a hairpin costs you the corner, not a tenth.
- **Turbo charges under braking** and takes its cut of the grip budget *first* — which is why
  deploying it mid-corner is a good way to end up in the scenery.
- **Surfaces bite differently.** Asphalt, gravel, ice: 1.0 / 0.82 / 0.56 friction.
- **Smoke is diegetic.** Tyre smoke appears exactly when the grip budget is blown, off the
  rear wheels — it is the feedback, not a decoration on top of it.

**Twelve circuits across three championships**, three car classes, two laps, medals scaled off a
simulated ideal lap. Later championships unlock on medals won, so the loose surfaces and the
formula cars arrive once your drawing hand has had some practice.

Cars are drawn per class rather than tinted from one shape: a rally hatchback with light pods
and a roof spoiler, a GT coupe with haunches and a swan-neck wing, an open-wheeler with
exposed tyres, wings and a visible helmet. Sprites are baked once per (class, colour) and
blitted rotated, because re-pathing that much detail for five cars every frame does not hold
60 fps on a phone.

## Running it

```
npm install
npm run build      # -> dist/index.html, fully self-contained
npm run dev        # unminified
```

Open `dist/index.html` in any browser, or add it to your iPhone home screen for full-screen
play. No CDN, no external requests, no network at runtime. The whole game is ~57 kB.

## Verification

Two harnesses, because they catch different things.

```
npm run check      # tsc, strict
npm run tune       # headless physics harness — no DOM, real Vehicle/Track/Line code
npm run playtest   # drives the built game in Chromium at iPhone size, screenshots each phase
npm run diag       # isolates path vs speed profile when the car misbehaves
```

`npm run tune` asserts the properties that make the game work rather than just that it runs:
every track is drivable, the draw→race mapping is calibrated, greed is punished, AI skill
levels are monotonic, medals are reachable, and line tracking stays continuous. It found the
substantive bugs in this build — a lap counter that scored the grid crossing as a completed
lap, a tyre-scrub term acting as a speed governor, a racing-line optimiser that drove itself
off a technical circuit, and a planning margin that inverted the entire AI field.

It also models a *realistic* stroke, not an idealised one — centreline-ish path, finger wobble,
and braking that begins AT the corner rather than before it. That distinction mattered: against
the idealised stroke everything looked fine, while a realistic one finished last on all eight
tracks sliding 24-30 s a race. See "Why the player's car used to drift" below.

`npm run playtest [track]` traces a real stroke with pointer events and captures
`shots/<track>/*.png`.

## Why the player's car used to drift

Worth recording, because the diagnosis was not where it looked. The player and the AI run
identical physics, so the asymmetry had to be in how their lines were built. `npm run diag`
walks the four combinations:

| | slide | lateral demand |
|---|---|---|
| optimised path + planned profile | 0.00 s | 56% of grip |
| **player path** + planned profile | 0.00 s | 46% of grip |
| optimised path + **naive profile** | 11.94 s | **116%** of grip |
| player path + naive profile | 20.37 s | **144%** of grip |

The path was innocent — a wobbly hand-drawn path slides *zero* when its speeds are planned. It
was entirely the speed profile: the AI's planner keeps a deliberate margin, while a person
eyeballing corner speed lands near the theoretical limit, so every ordinary stroke sat
permanently over the grip budget and understeered the whole lap.

The fix was to raise the grip budget so a sensible stroke fits inside it (`GRIP_SCALE`), lower
the AI's skill to compensate, strengthen the post-limit tyre falloff so greed still costs, and
cut the slip-angle visual — at its old coefficient an understeering car ploughing wide struck a
35-degree oversteer drift pose against the AI's steady 2-4.

## Layout

| Path | Role |
|------|------|
| `src/math.ts` | vectors, damping, deterministic PRNG |
| `src/track.ts` | closed spline, arc-length resampling, surfaces, spatial-grid projection |
| `src/tracks.ts` | the twelve circuits |
| `src/carart.ts` | per-class car sprites, baked offscreen |
| `src/line.ts` | pointer input → arc-length path with a speed at every node |
| `src/vehicle.ts` | the physics: friction circle, tyre falloff, path following, turbo |
| `src/ai.ts` | racing-line optimiser + speed profile; opponents share the player's physics |
| `src/race.ts` | grid, clock, contact, headless sim for medal calibration |
| `src/render.ts` | baked track layer, speed-coded line, skid marks, particles |
| `src/game.ts` | phases, input, camera, HUD |
| `tools/tune.ts` | physics harness |
| `tools/playtest.mjs` | browser playtest |

### One calibration worth knowing

`DRAW_SPEED_GAIN` (0.3) converts finger speed to car speed, and it is exactly the ratio of
time-spent-drawing to time-spent-racing: draw a lap in 5 s and the car takes ~17 s to do it.
It is also device-independent — a larger screen scales the path length and the finger's world
speed by the same factor, so the mapping holds on a phone and a desktop alike.

## Not yet built

The original shipped 180 challenges across 30 tracks. This has twelve circuits and a three-tier
career; balloon skill runs, hot-seat multiplayer and the remaining layouts are content on top of
a core that is already doing the hard part.
