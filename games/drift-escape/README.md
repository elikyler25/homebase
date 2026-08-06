# Drift Escape

A top-down arcade police chase — the mobile-game formula (Pako, Smashy Road): one fast car,
one city, an escalating swarm of cruisers, and no finish line. You lose when your car does.

Open `index.html` in a browser. No build, no server, no dependencies.

```
open games/drift-escape/index.html          # macOS
xdg-open games/drift-escape/index.html      # Linux
```

## Controls

**Hold anywhere and steer with your thumb.** Drag *away* from where you want the nose to point —
your thumb leads the **back** of the car around. Swing it hard across the nose and the tail breaks
loose on its own. The stick floats: drag past full lock and the anchor follows, so you never run
out of travel. Mouse drag works the same way.

Two buttons: **DRIFT** (handbrake, to hold a slide deliberately) and **BOOST**. Throttle holds
itself while you're steering.

Keyboard, if you'd rather: `W A S D` / arrows to drive, `Space` handbrake, `Shift` boost,
`R` restart, `M` mute.

## How it plays

- **Drift to survive.** Sideways speed builds a chain; the chain banks score *and* refills boost.
  Hitting anything drops the chain. So the fast line and the pretty line are the same line.
- **Heat** climbs on a timer, from 1 to 6. Each level puts more and faster cruisers on you.
  Break line of sight for 7 seconds and it ticks back down — worth 300.
- **Ram them.** Cruisers take more damage from a collision than you do, so a well-timed hit at
  speed wrecks one for 400. Cowardice is not the meta.
- **Walls cost speed, cops cost health.** Scraping a building kills your chain and your momentum
  but barely dents you. The police are the thing that ends the run.

## How it works

Single HTML file, canvas 2D, no libraries.

### Driving

The drift model is the standard arcade one: each frame the car's world velocity is decomposed
into forward and lateral components in car space, engine force is applied along the forward
axis, and lateral velocity is decayed by a grip constant. Drifting is nothing more than that
constant dropping when the handbrake is down (`0.802` → `0.968`), so the sideways component
survives the frame instead of being scrubbed off. Steering authority ramps in with speed and
eases back at the top end so the car stays pointable at 700 px/s.

The thumb stick converts your drag into a *target heading* — the opposite of the drag vector —
and steers proportionally toward it. Because a hard swing means a large angle error, the game
can tell a deliberate direction change from a lane correction, and drops traction for you when
the error exceeds ~55°. That's what makes one-thumb play work without a dedicated drift button.

### The city

Not a grid. Three things break the graph-paper read that a uniform lattice gives you:

1. **Irregular streets.** Block pitch varies 200–430px and street width 92–205px, bookended by a
   perimeter ring road.
2. **Superblocks.** Blocks merge into 2×1 / 1×2 / 2×2 units, and the streets they swallow stop
   being drawn — so streets terminate, jog, and dead-end instead of running edge to edge. A `cuts`
   set records every swallowed segment so lane markings don't paint across a superblock.
3. **Diagonal avenues.** Two, aimed through the middle third at 30–60° off the grid and on
   opposite diagonals so they cross. Anything they touch is deleted.

Districts come from two smooth value-noise fields — density and greenness — rather than a
per-block random roll. That matters more than it sounds: sampling `Math.random()` per block
scatters towers and parkland like confetti, and the city reads as noise. Sampling a smooth field
makes them contiguous, so you get a real skyline in the core, a park belt cutting across it, and
residential sprawl at the edges. Each district fills its block differently — towers, mid-rise,
house rows, warehouses with open apron, treed parks, plazas with a fountain.

Because the layout is arbitrary, collision can't be grid math. Everything solid goes into a
spatial hash (240px buckets, visit-stamped to dedupe across buckets), giving O(1) lookup with
circle-vs-AABB and circle-vs-circle push-out. Cruisers run the same physics as the player, steer
toward a lead-predicted intercept, and use three whisker probes plus a stuck timer to stay off
the corners. They spawn only on intersections verified open on all four sides.

## Tuning

The knobs worth touching are near the top of the script: `MAX_SPEED`, `ACCEL`, `MAX_TURN`, the
two grip constants in `driveCar`, `STICK_DEAD` / `STICK_MAX` for stick feel, `districtFor` for
the shape of the city, `copTarget()` for chase pressure, and the heat interval in `update`.
