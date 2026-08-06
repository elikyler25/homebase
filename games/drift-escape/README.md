# Drift Escape

A top-down arcade police chase — the mobile-game formula (Pako, Smashy Road): one fast car,
one city, an escalating swarm of cruisers, and no finish line. You lose when your car does.

Open `index.html` in a browser. No build, no server, no dependencies.

```
open games/drift-escape/index.html          # macOS
xdg-open games/drift-escape/index.html      # Linux
```

## Controls

| Key | |
|---|---|
| `W` / `↑` | throttle |
| `S` / `↓` | brake, then reverse |
| `A` `D` / `← →` | steer |
| `Space` | handbrake — breaks traction, starts the drift |
| `Shift` | boost (drifting is what refills it) |
| `R` | restart · `M` mute |

On touch devices the on-screen pads appear on first touch and the throttle is held for you —
steer, drift, boost.

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

The drift model is the standard arcade one: each frame the car's world velocity is decomposed
into forward and lateral components in car space, engine force is applied along the forward
axis, and lateral velocity is decayed by a grip constant. Drifting is nothing more than that
constant dropping when the handbrake is down (`0.802` → `0.968`), so the sideways component
survives the frame instead of being scrubbed off. Steering authority ramps in with speed and
eases back at the top end so the car stays pointable at 700 px/s.

The city is a fixed `18 × 18` grid of blocks with roads carved between them. Each cell holds a
small list of building rectangles, which makes collision an O(1) cell lookup plus a circle-vs-AABB
push-out against the 3×3 neighbourhood. Buildings are drawn with a fake extrusion that leans away
from the screen centre — the swept region of a rectangle translated by an offset, drawn as the
offset rect plus the two edge quads that can show a gap.

Cruisers run the same physics as the player, steer toward a lead-predicted intercept, and use
three whisker probes to avoid driving into corners. A stuck timer reverses them out of anything
they wedge themselves into.

## Tuning

The knobs worth touching are all near the top of the script: `MAX_SPEED`, `ACCEL`, `MAX_TURN`,
the two grip constants in `driveCar`, `copTarget()` for chase pressure, and the heat interval in
`update`.
