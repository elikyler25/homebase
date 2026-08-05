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

Four circuits, three car classes, two laps, medals scaled off a simulated ideal lap.

## Running it

```
npm install
npm run build      # -> dist/index.html, fully self-contained
npm run dev        # unminified
```

Open `dist/index.html` in any browser, or add it to your iPhone home screen for full-screen
play. No CDN, no external requests, no network at runtime. The whole game is ~49 kB.

## Verification

Two harnesses, because they catch different things.

```
npm run check      # tsc, strict
npm run tune       # headless physics harness — no DOM, real Vehicle/Track/Line code
npm run playtest   # drives the built game in Chromium at iPhone size, screenshots each phase
```

`npm run tune` asserts the properties that make the game work rather than just that it runs:
every track is drivable, the draw→race mapping is calibrated, greed is punished, AI skill
levels are monotonic, medals are reachable, and line tracking stays continuous. It found the
substantive bugs in this build — a lap counter that scored the grid crossing as a completed
lap, a tyre-scrub term acting as a speed governor, a racing-line optimiser that drove itself
off a technical circuit, and a planning margin that inverted the entire AI field.

`npm run playtest [track]` traces a real stroke with pointer events and captures
`shots/<track>/*.png`.

## Layout

| Path | Role |
|------|------|
| `src/math.ts` | vectors, damping, deterministic PRNG |
| `src/track.ts` | closed spline, arc-length resampling, surfaces, spatial-grid projection |
| `src/tracks.ts` | the four circuits |
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

The original shipped 180 challenges across 30 tracks. This is the engine and four circuits —
the career tree, balloon skill runs, hot-seat, and the remaining layouts are content on top of
a core that is already doing the hard part.
