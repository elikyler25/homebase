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

## Folded kart circuits

The circuits are kart layouts now: an outer loop with the road folded back into
the infield anywhere from once to four times, the way a real kart track packs a
long lap into a small field. Laps run 960-2900 m over a single lap, and the
returns are genuine concave corners — the only places the car turns the other
way.

Getting there needed an engine fix, and the failure had been silent rather than
obvious. `Track.project` found the globally nearest centreline sample, so a car
that ran wide at a hairpin snapped onto the *next fold over* — 60 m away in
space, but hundreds of metres away along the track. Its lap position jumped, the
lap counter fired, and a flat-out stroke posted **20 s on a 1086 m circuit** by
teleporting across the folds. Projection and line re-acquisition are now hinted
by where the car already was, so two folds metres apart in space stay far apart
along the track and cannot be confused. `containLine` had the identical bug and
got the identical fix. `bestLine` is new too: the racing-line relaxation fights
the containment clamp through every tight corner and could return a line slower
than the centreline it started from (an 84 s reference against a 73 s flat-out
lap), so it now takes whichever actually wins.

Three things then had to change together, and none of them work alone:

**Path jitter, 0.45 → 0.12 of half-width.** The AI drivers differ by a lateral
nudge so five cars do not share one line. On a folded circuit a nudge through a
tight infield return is worth several seconds either way, and the field's
finishing order became chaotic — a 0.92-skill driver routinely finished behind a
0.72 one. Skill should express itself in the speeds a driver plans, not in where
its line happens to land. That single change fixed ten circuits.

**The reference line got its own planning margin.** It was planning at 81% of
grip, which on a corner-dense circuit is slow enough that a *sliding* flat-out
lap beat it. Separating `REF_MARGIN` from `PLAN_MARGIN` sharpens the yardstick
without also making the five cars you are racing faster.

**Grip is up 18%** (`GRIP_SCALE` 1.82 → 2.15), which is the whole point of
folding the circuits. On a ring, more grip makes a flat-out stroke viable and the
game evaporates; a 2% rise used to break six circuits. On a layout where hairpins
make flat-out impossible *geometrically*, the grip budget stops being the only
thing holding greed back, and there is finally headroom. The ceiling is real and
the harness finds it: at 2.40 a flat-out lap of Timber Trail stops being punished
at all, so 2.15 is where it sits. Across the thirty, a realistic stroke now
spends 15.9% of the race past the limit instead of 20.2%.

The remaining tuning was per-circuit and mostly width: a wide road lets a
sliding car stay on it, so the circuits where a flat-out stroke was not being
punished got narrower, and the ones where a realistic stroke could not get home
got wider. Two ice circuits could not be made to work with two returns at all —
ice has 64% of asphalt's grip, and a late-braking stroke put 16.8 s into a
single corner — so they took the shape of the one ice layout that does work.

`tools/kart_layouts.py` generates them. Its `min_self_gap` check is the one that
matters: two folds must stay further apart than the road is wide, or the circuit
is ambiguous however good the projection is.

That check was wrong for a while, and wrong in the direction that hides itself.
It separated two points by counting *samples* between them — but `arcpoly` puts
about eight samples in a corner and one every 30 m on a straight, so a fixed skip
of 14 meant 300 m of straight and 35 m of corner. Every circuit with tight outer
corners reported a fold conflict against its own kerb: two points consecutive on
the racing line, "35 m apart". Aurora was rejected four times over it, and the
fitter kept inflating circuits to clear a gap that was never real. Separation is
now measured along the track, which is the quantity that was always meant.

There is a second gap between what this file emits and what the game builds: a
polyline versus a spline through it. A fold narrow enough for the smoothing to
round off would disappear with nothing complaining — the lap still closes, the
physics still pass, and the circuit in the game is simply not the one in the
layout file. `npm run tune` now asserts every authored point lands within half a
road width of the road that gets built (worst case across the thirty: 0.5 m), and
`npm run circuit -- <id>` draws the two on top of each other when a single
circuit needs looking at.

## Circuits that fill the screen

They were too small, and the reason was not lap length — it was aspect ratio. A roughly square
circuit on a 390x844 phone fits by width and leaves 45% of the screen empty. Every layout is now
cut across its middle and pulled apart vertically, with the two halves joined by straights: laps
grew about 60% (750-1050 m), the footprints became portrait, and **every corner radius is
unchanged**, because only straight sections were inserted. On a phone the circuit went from
368x368 px to 362x686.

Four circuits could not take it and kept their original geometry: an oval with longer straights
is just more flat-out-able, and three others put the extra speed straight into a corner that
could not absorb it.

That change also surfaced a genuine bug. The draw screen has a panel across the top, and once
circuits were tall enough to reach it, the start/finish line ended up *behind* it — where a finger
press never reaches the canvas. The circuit was untraceable. The camera now fits the visible band
between the overlays rather than the whole viewport.

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
ovals) or few and slow (the triangle). The remaining twenty-five were organic loops because
organic loops are what a hand-drawn stroke can actually drive.

**The way out was folding, not drawing.** Sharp silhouettes fail because a hand-drawn stroke
cannot hold a tight constant-radius corner. A *fold* — the road turned back into the infield
through a wide hairpin — makes a circuit read as busy and distinct while every individual corner
stays generous. Once circuits were folded, the second atlas showed the same problem in a new
costume: thirty folded circuits that were all "portrait rectangle with the folds cut into the
right-hand flank". Same silhouette, thirty times, for the mundane reason that the generator only
knew one topology.

So `circuit()` now takes returns on all four edges, and the box itself gets warped: `taper` for a
trapezoid, `shear` for a parallelogram, `rot` to put the whole circuit on the diagonal. Reading
down that column is how the table is meant to be checked. The levers that actually change what
you see on the track-select screen, roughly in order:

1. the outer shape — rectangle, trapezoid, parallelogram, diagonal
2. aspect — portrait, landscape, square
3. which edges fold in, and whether opposite folds interlock like a comb
4. fold depth — a stub off one edge versus a spear driven across the infield
5. count — one fold reads as a lap with a kink, four reads as a maze

The lesson underneath all of it: **the atlas is the review, not the tune harness.** Thirty
circuits passed every physics assertion in both of the versions it rejected.

## Not yet built

The original shipped 180 challenges across its 30 tracks. This has the thirty, six balloon skill
events, a three-tier career, ghosts and hot seat. What is left is depth per circuit rather than
more circuits: multiple challenge types on each layout, and a proper endurance format.
