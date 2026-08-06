# Slot Racer

A second game on the same bones. Same thirty circuits, same renderer, same
friction budget — but the car is pinned in a groove and you get one button.

    npm run build       -> dist/slot.html          (open it anywhere)
    npm run slottune    headless physics harness, all thirty circuits
    npm run slotplay    drives the built page in Chromium at phone size

## The mechanic

Hold for power, release and the motor brakes. There is no steering, so the only
decision is *when to lift*, and the only failure is asking a corner for more
cornering force than the guide pin and tyres can hold. Past that the pin pops out
and a marshal takes 2.4 s to put you back — more than a whole lap of being
careful.

The bar across the top is the cornering load as a fraction of the budget. A fast
lap keeps it high and never pins it.

## What the physics had to get right

Four things were wrong in the first working version, and each was found by
measuring rather than playing:

**The planner and the car disagreed about how tight the corner was.** The AI's
speed profile was the drawn-line game's `speedProfile`, handed the lane as a
point list sampled every 3 m — and a 3 m chord across a hairpin tip reads as a
gentler corner than the one the car drives. Grand Circuit deslotted while
planning at 74% of the budget. Both now read `laneCurv` at the same track
sample, so they cannot disagree.

**A slot car has no brake pedal.** The plan assumed it could brake at the figure
on the car sheet; releasing the trigger only shorts the motor, which is 55% of
that. Planning against the wrong number put the deslots on the *timid* margins —
careful was punished, brave was not.

**Braking was deslotting people.** Charging the deslot against combined
cornering-plus-braking demand, the way the drawn-line car computes understeer,
made lifting dangerous. But cornering force is forced by geometry and the pin
holds it or does not, whereas the motor cannot demand more retardation than the
contact patch gives. Only lateral load deslots you now, so lifting always helps.

**Deslotting on accumulated debt alone left a hole.** Duration is the right model
for the marginal case — it is what lets you feel the edge arriving instead of
flipping a coin on sampling noise. It is the wrong model for arriving at a
hairpin at 3× the speed it can take: a car driving the plan 18% too fast spent
9.3 s of one lap over the budget and never came off, because the excursions were
short and the debt decayed between them. There is now a hard ceiling above the
debt.

## The readback, which is the whole game

First playable version: "it plays terribly." It did, and the reason was one
number. Measured on a real device, there were **0.02 s** — a single frame —
between the grip meter first showing trouble and the pin leaving the slot. The
meter showed the load the car was under *now*, and lateral load only climbs once
you are already in the corner and already committed. The player was being told
about the mistake one frame after it stopped being fixable.

With no steering, anticipation is the entire game, so the readback has to be
about the corner arriving rather than the corner you are in. `outlook()` answers
one question, scanning 320 m down the slot:

> the fastest you could be going right now and still arrive at that corner under
> control — its own limit, plus whatever the coasting motor can shed over the
> road left after your reaction is spent

Urgency is how far past that you are. Above 1, lift. The cue now gives **1.4 s**
of warning, and `slottune` asserts the strongest thing that can be said about an
instrument: a policy that does nothing but obey it — lift when it lights, back on
when it clears, no plan, no memory of the circuit — gets round all thirty
circuits clean.

Three shapes of that calculation were wrong before this one, and each gave itself
away differently:

| attempt | how it failed |
|---|---|
| max of `v²k / budget` over a horizon whose length moved with speed | corners popped in and out of the window as the car breathed; the cue chattered on and off every 0.1 s and hysteresis could not fix a signal swinging 0.65–1.32 between ticks |
| separate formulas for near and far corners | a discontinuity exactly at the reaction distance: urgency spiked to 5.7 and collapsed to 0.06 as a hairpin crossed it, the cue cleared, and the car went back to full throttle into the corner |
| reaction distance + braking distance, over distance available | a floor — a corner 4 m away reported urgency above 1 whenever the reaction distance exceeded 4 m, which is always. The cue latched on, the car coasted to walking pace, and laps came in at 372 s instead of 28 |

The tell for the second one is worth keeping: allowing the player MORE reaction
time made the game *less* survivable. A safety margin that hurts when you widen
it is not a margin, it is a bug.

The camera was the other half. It sat centred on the car and axis-aligned, so
half a tall phone screen showed road already driven. It now turns with the car —
up is where you are going — which is what makes a portrait screen into lookahead.

## It moved in clicks

Reported next: "the car moves like little clicks instead of smooth motion."

`Track.sampleAt` floors to a sample index, and the samples are one metre apart.
That is invisible when you ask the track about surface or curvature, and very
visible when you ask it WHERE SOMETHING IS. The drawn-line car never noticed
because it integrates its own position and only queries the track for
properties; the slot car takes its position from the track, so it inherited the
quantisation directly. Measured: **42% of frames the car did not move at all**,
and then it jumped a whole metre. `Track.lerpAt` interpolates between the two
nearest samples, and that goes to 0% stationary frames with the frame-to-frame
roughness dropping from 1.03 to 0.01.

## The car is the instrument

The best readback here is not on the HUD at all, and it came from the player who
remembered how Groove Racer did it: **the back of the car swings out, and how far
it is thrown is how close you are to deslotting.**

That is what a slot car physically does. The guide pin holds the nose in the
groove, so as a corner loads up it is the tail that steps out, and when it comes
round too far the pin leaves. So the body yaws about the pin near the nose, not
about the car's centre — rotating about the centre reads as "wonky", rotating
about the pin reads as "the back is coming round".

Two things make it an instrument rather than decoration, and `slottune` asserts
both:

- **It is squared, not linear.** Linear was measurably useless: a lap that was
  never in trouble peaked at 19° against 23° for one that actually came off, so
  fine and nearly-off looked the same. Squared, a clean lap sits at 10° and a lap
  that deslots reaches 17–23°.
- **The cars are drawn at a minimum screen size.** The camera is deliberately
  wide, which leaves a 5.6 m car about eight pixels long — too small to read an
  angle off. Sprites now have a floor independent of the zoom.

## Show the layout, do not make them learn it

The other half of "difficult to drive", and the fix came from the game this one
is chasing. Groove Racer used a **fixed view with deliberately blocky cars** --
which its Pocket Gamer review credits with "making the tight track action easier
to follow" -- rather than any kind of warning indicator. That is the structural
answer. With no steering, every decision is about a corner you have not reached
yet, so put the corner on screen instead of captioning it.

The camera went through three shapes before landing there: a close chase cam
(4.0 s of track visible ahead), then a rotating one (5.0 s), then this -- fixed
orientation, framing the whole circuit where it fits and the widest readable
view where it does not. **7.2 s** on Harbour, 9.5 s on Grand Circuit. The LIFT
cue stays, but it is now confirming something already on screen rather than
substituting for it.

## The CPUs were not just better, they were cheating

Reported: "the CPUs seem much faster than the player car." They were, by a lot,
and for a reason that was my fault. A player obeying the cue was **7.8 s down
over a lap of Harbour and 16.4 s down on Nordic**, beaten by even the weakest
car by fifteen seconds.

The AI followed a planned speed profile -- the ideal speed at every point on the
circuit, tracked like a servo. That is information the player cannot have and a
precision one button cannot reach. The drawn-line game states the principle
plainly, that opponents get exactly what the player's stroke gives them and run
through the same simulation, and this had quietly broken it.

The AI now drives off **the same cue the player gets**, and skill is nothing but
how close to its edge each driver is willing to run. The field went from 7-16 s
ahead to 1.5-3.5 s, so a player who does anything better than blind obedience
wins. It also stopped the player always taking lane 0, the longest of the four
(1106 m against 1038 on Harbour) -- a standing handicap nobody agreed to.

That change exposed a deadlock. The AI reads the cue strictly and without
hysteresis, so it is the harshest possible reader of that signal -- and a
STOPPED car still read urgency above 1, because accelerating for the reaction
window would put it over the limit for something just ahead. One car sat
motionless 358 m into Grand Circuit for two and a half minutes, and since the
race waits for everyone, the race never ended. A cue about when to *lift* cannot
say "not yet" to a car that is not moving. `slottune` asserts it now.

## Faster cars: the magnet, not the top speed

Raising `maxSpeed` makes laps SLOWER. It only stretches the straights -- corner
speed comes from the grip budget -- so all the extra does is give you more to
shed, and more of the lap goes on lifting. Measured on Harbour at four magnet
settings, top speed x1.3 cost about a second a lap at every one of them.

The magnet lifts the whole lap instead. Going from 12 to 44 took a lap from
39 s to 28 and narrowed the gap to the AI at the same time. The ceiling is set
the way `GRIP_SCALE` is in the drawn-line game -- by the weakest circuit, since
past a point flat out simply works and the game is gone.

The magnet is scaled back on low-grip surfaces. At full strength on ice it
swamped the tyres and every surface drove the same.

## What was tried and removed

**Reaction lag as a skill knob.** The obvious second dial after planning margin,
and it is worth nothing here. Measured across three circuits and five margins, a
0.30 s delay never once caused a deslot and was consistently a hair *faster* —
the trigger is a closed loop and the braking zones run over a hundred metres, so
lifting late is an error the controller has shed long before the apex. Slot
racing is a calibration game, not a reflex game. Skill is planning margin and
nothing else.

## Lanes

Slots are constant offsets from the centreline, so the inside slot is shorter but
tighter and the outside is longer but faster. Over a lap with corners both ways
that mostly cancels; `slottune` asserts no slot is more than 6% better than
another, and measured across the thirty the spread is 0.8–2.5%. Cars cannot
touch, which is what real slot racing is: you pass because the other driver came
off at the hairpin.
