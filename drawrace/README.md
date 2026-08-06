# DrawRace

A rebuild of **DrawRace 2: Racing Evolved** (RedLynx, 2011) for the web, mobile-first.

Trace your racing line around the circuit. How fast you draw is how fast the car goes — so
slow your finger through the corners, or watch it run wide. Then lift your finger and watch the
lap play out against four opponents.

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
- **Surfaces bite differently.** Asphalt, gravel, ice: 1.0 / 0.82 / 0.64 friction.
- **Smoke is diegetic.** Tyre smoke appears exactly when the grip budget is blown, off the
  rear wheels — it is the feedback, not a decoration on top of it.

**Thirty circuits and six balloon skill events across three championships**, three car classes,
medals scaled off a simulated ideal lap. Later championships unlock on medals won, so the loose
surfaces and the formula cars arrive once your drawing hand has had some practice. Where a
circuit admits more than one class you pick before drawing, and results are filed per class —
a lap in a rally car around a GT circuit is a different problem.

**Your best lap comes back as a ghost.** What gets saved is the stroke, not a recording of
positions — the physics is deterministic, so re-driving the line reproduces the lap for about
1.3 kB, and the ghost stays valid if the physics is ever retuned. The HUD carries a live delta
so you can see which corner you are actually losing it in. The ghost is scenery: no contact, no
ranking, no effect on the race it appears in, and the harness asserts all three.

**Hot seat** puts two to four people on one phone. Everyone draws in turn behind a handover
screen, then all the strokes race at once. Two things change to keep it a fair comparison: the
grid is a single row abreast rather than the usual stagger — worth about half a second across
four slots, which is more than the difference between two people's lines — and turbo fires by
rule instead of by tap, since one screen cannot take a tap for four cars. Nothing is written to
the career; a shared-device race would otherwise credit whoever owns the phone with a lap
somebody else drew.

**The game explains itself now.** A how-to card on the first run, then two pieces of coaching
that both fall out of the physics rather than being written alongside it. While you draw, any
stretch of line asking for more grip than the tyres own gets a red halo — the same
*v²k > grip* comparison the vehicle makes every tick, evaluated on the whole stroke before the
lights go out. After the race, the results screen draws your lap and highlights the twelfth of
the circuit where the car actually spent the most time past its budget, measured tick by tick
during the race rather than predicted. A time tells you that you were slow; that map tells you
*where*, which is the only actionable thing about a lap you drew in one gesture.

**Skill events** are the other mode: no opponents, one lap, and a course strewn with balloons
placed deliberately *off* the racing line. The fast line stops being automatically the right
answer, because every detour has to be paid back somewhere else.

**Sound is synthesized, not sampled** — oscillators and filtered noise, so it costs no bytes and
cannot fall out of sync with the physics. The tyre squeal is driven by the same understeer value
the grip budget produces, so it starts exactly when the tyres actually let go.

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
play. No CDN, no external requests, no network at runtime. The whole game is ~86 kB.

## Verification

Four harnesses, because they catch different things.

```
npm run check      # tsc, strict
npm run tune       # headless physics harness — no DOM, real Vehicle/Track/Line code
npm run playtest   # drives the built game in Chromium at iPhone size, screenshots each phase
npm run modes      # drives the ghost and hot seat in a browser — they live in shell state
npm run diag       # isolates path vs speed profile when the car misbehaves
npm run where      # says which twelfth of the lap a realistic stroke is losing time in
```

`npm run tune` asserts the properties that make the game work rather than just that it runs:
every track is drivable, the draw→race mapping is calibrated, greed is punished, AI skill
levels are monotonic, medals are reachable, and line tracking stays continuous. It found the
substantive bugs in this build — a lap counter that scored the grid crossing as a completed
lap, a tyre-scrub term acting as a speed governor, a racing-line optimiser that drove itself
off a technical circuit, and a planning margin that inverted the entire AI field.

It also models a *realistic* stroke, not an idealised one — centreline-ish path, finger wobble,
and braking that begins AT the corner rather than before it. That distinction mattered: against
the idealised stroke everything looked fine, while a realistic one finished last on every track,
sliding 24-30 s a race. See "Why the player's car used to drift" below.

`npm run playtest [track]` traces a real stroke with pointer events and captures
`shots/<track>/*.png`. `npm run modes` uses the same tracing to check the parts that live in
game-shell state rather than in physics — localStorage, phase order, which screen is showing —
because those pass `tune` while being completely broken in a browser.

`npm run where` is newer and earned its place immediately. It buckets a lap into twelfths and
prints, for the reference line and a realistic stroke, the time spent in each bucket and how
much of it was over the grip budget. The distinction it draws is the useful one: a circuit
losing time evenly across twelve buckets is simply hard, while a circuit losing three seconds in
*one* bucket has a specific corner a person cannot drive. Marina Point was rebuilt five times on
that evidence — every earlier version had a deep in-and-out pinch entered off the fastest part
of the lap, which is not a corner, it is a wall.

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
| `src/tracks.ts` | the thirty circuits |
| `src/ghost.ts` | saving and replaying your best stroke |
| `src/coach.ts` | over-the-limit warnings, and where the lap was lost |
| `src/carart.ts` | per-class car sprites, baked offscreen |
| `src/line.ts` | pointer input → arc-length path with a speed at every node |
| `src/vehicle.ts` | the physics: friction circle, tyre falloff, path following, turbo |
| `src/ai.ts` | racing-line optimiser + speed profile; opponents share the player's physics |
| `src/race.ts` | grid, clock, contact, headless sim for medal calibration |
| `src/render.ts` | baked track layer, speed-coded line, skid marks, particles, balloons |
| `src/audio.ts` | synthesized engine, tyre squeal, rumble, turbo, cues |
| `src/skill.ts` | balloon skill events and their placement |
| `src/game.ts` | phases, input, camera, HUD |
| `tools/tune.ts` | physics harness |
| `tools/playtest.mjs` | browser playtest |
| `tools/modes.mjs` | browser check for the ghost and hot seat |
| `tools/stroke.mjs` | shared "trace a lap with pointer events" helper |
| `tools/diag.ts` | path-vs-profile isolation |
| `tools/where.ts` | which twelfth of the lap the time goes in |
| `tools/carsheet.ts` | renders the car sprites large, for judging the art |

### One calibration worth knowing

`DRAW_SPEED_GAIN` (0.3) converts finger speed to car speed, and it is exactly the ratio of
time-spent-drawing to time-spent-racing: draw a lap in 5 s and the car takes ~17 s to do it.
It is also device-independent — a larger screen scales the path length and the finger's world
speed by the same factor, so the mapping holds on a phone and a desktop alike.

## Laying out a circuit

Thirty of them exist now, they grow across the championships — roughly 490 m in the Rookie Cup
(run over three laps), 600 in the National Series, 690 in the World League — and they get
proportionally wider as they grow. That widening is not decoration. **Scaling a layout up does
not scale its difficulty evenly**: corner radius grows linearly with size while braking distance
grows with the square of speed, so a feature that is a corner at 500 m is a wall at 900 m. Every
attempt at a 1.45x World League ended with the *reference* line sliding off the road.

Five of the thirty are pure geometric shapes — an oval, a triangle, a rounded rectangle, a long
oval and a long rectangle — generated as true circular arcs rather than placed by eye. The other
twenty-five are organic loops, and they are more alike than they should be. See "What thirty
circuits taught me" below for why that is harder to fix than it sounds.

Beyond size, the same mistakes accounted for nearly every failure:

**A pinch entered off the fastest part of the lap is a wall, not a corner.** The stroke arrives
far too fast and grinds almost to a halt; `where` shows it as three seconds lost in one twelfth
while the other eleven look perfectly normal. Sandhills was fixed without moving a single point —
the lap now *starts* just after its pinch, so the pinch arrives at the end of the lap with the
corners before it having already taken the speed out.

**A notch must go inwards.** Every feature that works — Nordic, Fjord, Marina, Autodrome — cuts
into the infield and comes back out. Midnight Sun spent four attempts oscillating around a knife
edge because its "notch" was actually an outward kink, an S, and no amount of adjusting the depth
of the wrong shape makes it the right one.

**Opening a corner up can make it worse.** Counterintuitive until you see why: a wobbly stroke
demands lateral acceleration proportional to *v²*, so a faster corner punishes finger wobble
harder than a slower one does. Repeatedly, the fix was to tighten rather than loosen.

**Corner-poor circuits compress the AI field.** Top speed is capped for everybody, so a driver's
skill only expresses itself in corners — give a circuit three of them and the whole field lands
within a couple of seconds, the ordering goes with the noise, and a decent human stroke has
nothing to beat. Both the oval and the triangle failed on exactly this, and both were fixed by
*tightening* their corners until skill had somewhere to show.

## What thirty circuits taught me

`npm run atlas` renders every layout's outline into one grid, and it is the most brutal review in
the project. Thirty circuits can each pass `npm run tune`, each be individually defensible, and
still be the same circuit thirty times — which is what the first atlas showed: five distinct
shapes and twenty-five variations on "circle with a bite out of it". No amount of reading
coordinates would have told me that.

Fixing it turned out to be much harder than drawing new outlines, and the reason is worth
recording. **This engine wants continuously-varying curvature.** Three separate attempts at
sharp-cornered geometric silhouettes — diamonds, crosses, octagons, Z-shapes, chevrons — failed:

| attempt | result |
|---|---|
| polygons with 2-point corner cuts | 29 of 30 failed; the spline kinked far tighter than the radius asked for |
| true circular arcs, radius ~2x road half-width | 26 failed; the planner braked for corners the racing line could not fit through |
| circular arcs, radius ~4x half-width | 26 failed; a constant-radius arc sits at the limit along its *whole* length, so finger wobble is over the limit for the entire corner |
| quadratic-Bezier fillets (varying curvature) | 31 failed; the tighter apex made it worse again |

The five geometric shapes that survived are the ones whose corners are either very large (the
ovals) or few and slow (the triangle). The remaining twenty-five are organic loops because organic
loops are what a hand-drawn stroke can actually drive — and making them read as distinct is a
genuine open problem here, not a matter of picking prettier outlines.

## Not yet built

The original shipped 180 challenges across its 30 tracks. This has the thirty, six balloon skill
events, a three-tier career, ghosts and hot seat. What is left is depth per circuit rather than
more circuits: multiple challenge types on each layout, and a proper endurance format.
