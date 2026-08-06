// A car in a slot. One input: the trigger.
//
// Held, it drives. Released, it brakes — that is how a slot-car controller
// works, and it is why the game is about lifting rather than steering.
//
// The whole skill is the grip budget, and it is the SAME friction circle the
// drawn-line game uses: cornering and driving compete for one total. What is
// different is the consequence. A drawn-line car that runs out of grip
// understeers and goes wide, because it still has somewhere to go. A slotted car
// has nowhere to go — it is pinned laterally until it is not, and then it is off
// the track entirely.
//
// Deslotting is on a debt, not a threshold. Crossing 100% for a single tick is a
// twitch and survivable; sitting at 110% through a whole corner is not. Without
// that, a hairpin taken at the exact limit becomes a coin flip on sampling
// noise, and the player has no way to feel the edge coming — which is the one
// thing this game has to teach.

import { clamp } from "../math";
import { Track } from "../track";
import { CarClass } from "../vehicle";
import { Lane, laneCurv } from "./lane";

const G = 9.81;

/** How much of the tyre budget the guide pin adds. Flat, like a real magnet. */
export const MAGNETS: Record<string, number> = { rally: 55, gt: 44, formula: 30 };

/**
 * Slot cars are not scale models of the road cars, and should not drive like
 * them. The magnet above and these multipliers make them quick and pointy: they
 * leap off the line, run out to a much higher top speed, and carry more through
 * a corner than any of the drawn-line classes.
 *
 * Raising `maxSpeed` alone would only stretch the straights -- corner speed
 * comes from the grip budget -- so the magnet goes up with it. That lifts the
 * whole lap rather than just the bits between corners, which is what "the cars
 * should all be able to go faster" actually asks for.
 */
export const SLOT_TOP = 1.12;
export const SLOT_ACCEL = 1.85;

/** A car class, tuned for the slot. */
export function slotSpec(car: CarClass): CarClass {
  return {
    ...car,
    maxSpeed: car.maxSpeed * SLOT_TOP,
    accel: car.accel * SLOT_ACCEL,
  };
}

/** Over-budget seconds that pull the pin out of the slot. */
const DESLOT_DEBT = 0.34;
/** How fast the debt bleeds off once back inside the budget. */
const DEBT_DECAY = 1.2;
/**
 * Past this multiple of the budget the pin is simply gone, however briefly.
 *
 * The debt alone was not enough, and the hole it left was large: a car driving
 * the plan 18% too fast spent 9.3 s of a single lap over the budget, peaked at
 * 3.1x it, and never once came out of the slot -- because the excursions were
 * short (longest 0.48 s) and the debt decayed between them. Duration is the
 * right model for the marginal case, where the point is to let the player feel
 * the edge arriving. It is the wrong model for arriving at a hairpin at double
 * the speed it can take, which is not a near miss.
 */
const HARD_DESLOT = 1.35;
/** Braking when the trigger is released, as a fraction of full braking. */
export const COAST_BRAKE = 0.72;
/** Rolling and aero drag, m/s^2 at max speed. */
export const DRAG = 2.4;

/**
 * Where the lift cue fires, as a fraction of the budget. Below 1 on purpose --
 * see `outlook`.
 */
const CUE_MARGIN = 1.0;
/**
 * ...and where it clears again. The gap is hysteresis, and it is doing two
 * jobs. For the player, a cue that flickers on and off many times a second at
 * the boundary is unreadable. For the car, a policy that follows a chattering
 * cue chatters with it, and on ice -- where the budget is a quarter of
 * asphalt's, so `ahead` swings hard for small changes in speed -- that
 * overshoot was still deslotting a driver who did exactly as they were told.
 */
const CUE_CLEAR = 0.78;
/** How far down the road to look for a corner, metres. */
const OUTLOOK_HORIZON = 320;
/**
 * How long the trigger stays down after the cue lights: thumb plus cue tick.
 *
 * 0.4 s was enough for a policy reacting on the physics tick and not enough for
 * one going through a real browser, where the cue tick, the frame and the input
 * path stack up -- the in-browser test still came off once on Grand Circuit
 * while doing exactly what it was told. A simple human reaction is ~250 ms
 * before any decision is made, so budgeting half a second is the honest number
 * rather than the convenient one.
 */
const REACTION = 0.55;
/**
 * Where the DANGER part of the tail-out starts, as a fraction of the budget.
 *
 * High on purpose, so the two terms do not overlap. The base says "this car is
 * cornering" and covers the whole safe range; the danger term says "and it is
 * nearly gone" and only exists at the top. Starting it at 0.3 meant both were
 * growing together through every ordinary corner, and a clean lap reached 29
 * deg against 34 for one that came off -- barely a distinction, on the one
 * reading the player is supposed to steer by.
 */
const TAIL_START = 0.7;
/** How far the danger part throws it at the point the pin lets go, radians. */
const TAIL_MAX = 0.66;
/**
 * Tail-out present in any corner at all, at full load, radians.
 *
 * The squared danger term alone meant a car taken well within its limits sat
 * dead straight, and the back only appeared at the edge. A real slot car has
 * its tail out the whole way round a bend -- that is what the back wheels do
 * when the pin is dragging the nose through an arc -- so there is a plain
 * linear component underneath, and the squared one on top of it for the edge.
 */
const TAIL_BASE = 0.2;
/** Aim to arrive at a corner a little under its limit, not exactly on it. */
const CORNER_SAFE = 0.9;

/** Seconds a deslotted car spends off before a marshal puts it back. */
export const MARSHAL_DELAY = 2.4;

export interface SlotTelemetry {
  speed: number;
  /** Total grip demand as a fraction of the budget. 1.0 is the edge. */
  load: number;
  /** How close to deslotting, 0..1. This is the thing to put on screen. */
  danger: number;
  lateral: number;
  deslotted: boolean;
  /** Lift now. The cue the whole game is played off. */
  lift: boolean;
  /** Lifting no longer saves it. */
  tooLate: boolean;
}

/**
 * The one place the grip budget is computed.
 *
 * It has now been got wrong three times in this file's short life by being
 * written out twice -- planner and physics disagreeing about curvature, then
 * about braking, then about this. Each time the symptom was a car being
 * punished for following a plan that was never achievable. There is no version
 * of this where two copies stay in step, so there is one.
 *
 * The magnet is most of the budget, and it is what makes a slot car quick:
 * corner speed comes from grip, so a bigger magnet lifts the WHOLE lap rather
 * than just the straights. Measured on Harbour, going from 12 to 44 took a lap
 * from 39 s to 28. Raising top speed instead made laps SLOWER at every magnet
 * setting -- more speed to shed means more of the lap spent lifting -- which is
 * why `SLOT_TOP` is modest.
 *
 * Not fully surface-independent, though a real magnet pulling on steel rails
 * would be. At full strength on ice it swamped the tyres and every surface
 * drove the same, so it is scaled back where the grip is low and the circuits
 * keep their character.
 */
export function gripBudgetFor(car: CarClass, surfaceGrip: number): number {
  const magnet = (MAGNETS[car.id] ?? 30) * (0.6 + 0.4 * surfaceGrip);
  return car.grip * surfaceGrip * G + magnet;
}

export class SlotCar {
  /** Centreline arc length. The lane's own distance is tracked separately. */
  s: number;
  speed = 0;
  /** Distance travelled along this car's own lane, for lap counting. */
  distance = 0;
  laps = 0;
  finished = false;
  finishTime = 0;

  throttle = false;

  /** Off the slot: sliding free, then waiting for a marshal. */
  deslotted = false;
  deslotTimer = 0;
  deslotCount = 0;
  /** Free position and velocity while off the slot. */
  freePos = { x: 0, y: 0 };
  freeVel = { x: 0, y: 0 };

  heading = 0;
  /**
   * Body yaw about the guide pin, radians. NOT folded into `heading` -- heading
   * is where the slot points, and the pin follows it whatever the body does.
   */
  slip = 0;
  private debt = 0;
  /** Latched cue state, so it cannot flicker. Updated on a slow tick. */
  private cue = false;
  private cueTick = 0;
  private lastLook = { urgency: 0, ahead: 0 };
  /** Latest urgency reading, so an AI can drive off the same number the HUD shows. */
  get cueUrgency(): number {
    return this.deslotted ? 0 : this.lastLook.urgency;
  }

  telemetry: SlotTelemetry = {
    speed: 0, load: 0, danger: 0, lateral: 0, deslotted: false,
    lift: false, tooLate: false,
  };

  constructor(
    readonly car: CarClass,
    readonly track: Track,
    readonly lane: Lane,
    startS: number,
  ) {
    this.s = startS;
    const smp = track.lerpAt(startS);
    this.heading = Math.atan2(smp.tan.y, smp.tan.x);
  }

  /** Total lateral acceleration the slot and tyres can hold, m/s^2. */
  /** Total lateral acceleration the slot and tyres can hold, m/s^2. */
  get gripBudget(): number {
    return gripBudgetFor(this.car, this.track.surface.grip);
  }

  /**
   * What the road AHEAD is about to ask for, as a fraction of the budget.
   *
   * This is the number the game turns on, and the first version did not have
   * it. The meter showed the load the car was under *now* -- honest, and
   * useless, because lateral load only climbs once you are already in the
   * corner and already committed. Measured on a real device: 0.02 s, a single
   * frame, between the meter passing 95% and the pin leaving the slot. The
   * player was being told about the mistake one frame after it stopped being
   * fixable.
   *
   * With no steering, anticipation is the entire game, so the readback has to
   * be about the corner arriving rather than the corner you are in.
   *
   *   `ahead`      what it will demand if you hold the trigger.
   *   `committed`  what it will demand if you release it right now. Above 1.0
   *                the corner is already lost, and no input can save it.
   *   `lift`       the cue itself. Fires a little BEFORE the true limit, and
   *                that margin is not decoration: a player -- and the harness
   *                policy that stands in for one -- follows the cue by lifting
   *                when it lights and getting back on when it clears, which
   *                parks the car exactly on the cue's boundary. If the cue sits
   *                on 100% of the budget, hovering there means hovering at the
   *                limit, and on Glacier Pass, where ice leaves a quarter of
   *                the grip, that tipped over into deslots for a player doing
   *                exactly as they were told.
   *   `tooLate`    lifting no longer saves it. Worth showing separately: it is
   *                the difference between "lift" and "brace".
   */
  outlook(): {
    urgency: number;
    ahead: number;
    lift: boolean;
    tooLate: boolean;
  } {
    const budget = this.gripBudget;
    const v = this.speed;
    const coast = Math.min(this.car.brake * COAST_BRAKE, budget);
    const drive = this.car.accel * Math.max(0, 1 - (v / this.car.maxSpeed) ** 2);
    let urgency = 0;
    let ahead = 0;
    for (let d = 4; d <= OUTLOOK_HORIZON; d += 4) {
      const k = Math.abs(laneCurv(this.track.lerpAt(this.s + d), this.lane.offset));
      if (k < 1e-5) continue;
      ahead = Math.max(ahead, (v * v * k) / budget);
      // The speed that corner can be taken at, with a little in hand.
      const vreq2 = (budget * CORNER_SAFE) / k;
      // Deceleration needed to arrive at it, against the deceleration available.
      // Scale-free, so it does not care how far away the corner is or how fast
      // the car is going -- which is the whole point. An earlier version took a
      // max over a window whose LENGTH moved with speed, so corners popped in
      // and out of it as the car breathed and the cue chattered on and off
      // every 0.1 s. Hysteresis cannot fix a signal that swings 0.65 to 1.32
      // between ticks.
      //
      // Crucially this is measured from where the car will be after REACTION
      // seconds of still holding the trigger, not from where it is now. A
      // player -- and the harness policy that stands in for one -- holds the
      // trigger flat until told otherwise, so they are still accelerating while
      // the cue is deciding. Predicting from the current speed told three
      // circuits' worth of drivers to lift at a point that was already too late
      // for the speed they would actually be doing by the time they did.
      // Distance needed to deal with this corner, over distance available.
      // Above 1 you cannot make it: react, then brake, and you are still past
      // the entry. Scale-free, continuous, and with no special case for a
      // corner that is already close -- a near corner simply has `d` smaller
      // than the reaction distance, so the ratio goes above 1 on its own.
      //
      // Two earlier shapes of this were wrong in ways that only measurement
      // showed. Taking a max of `v^2 k / budget` over a horizon whose LENGTH
      // moved with speed made corners pop in and out of view, and the cue
      // chattered on and off every 0.1 s. Splitting near and far corners into
      // two formulas put a discontinuity exactly at the reaction distance:
      // urgency spiked to 5.7 and collapsed to 0.06 between ticks as a hairpin
      // crossed it, the cue cleared, and the car went back to full throttle
      // into the corner. It also made the cue react non-monotonically to the
      // reaction budget, which is how the discontinuity gave itself away --
      // allowing MORE reaction time made the game less survivable.
      // Nothing to decide about a corner you are already slow enough for. This
      // guard is load-bearing, not tidiness: without it a STOPPED car still
      // read urgency above 1, because accelerating for the reaction window
      // would put it over the limit for something just ahead -- so a driver
      // obeying the cue strictly would never take the throttle, and never move.
      // One AI sat motionless 358 m into Grand Circuit for two and a half
      // minutes, and because the race waits for every car, the race never
      // ended. A cue about when to LIFT cannot be allowed to say "not yet" to a
      // car that is stationary.
      if (v * v <= vreq2 * 0.5) continue;
      const vh = Math.min(this.car.maxSpeed, v + drive * REACTION);
      const dh = (v + vh) * 0.5 * REACTION;
      // The fastest you could be going right now and still arrive at that
      // corner under control: its own limit, plus whatever the coasting motor
      // can shed over the road left after the reaction is spent. Urgency is how
      // far past that you are.
      //
      // Expressed as a distance sum instead -- reaction distance plus braking
      // distance, over distance available -- it had a floor: a corner 4 m away
      // reported urgency above 1 whenever the reaction distance exceeded 4 m,
      // which is always. The cue latched on and never cleared, the car coasted
      // to walking pace, and laps came in at 372 s instead of 28. As a ratio of
      // speeds it goes to zero when the car is slow enough, which is the whole
      // point of the signal.
      const allowed2 = vreq2 + 2 * coast * Math.max(0, d - dh);
      urgency = Math.max(urgency, (vh * vh) / allowed2);
    }
    const lift = this.cue;
    return { urgency, ahead, lift, tooLate: urgency > 1.5 };
  }

  /** The fastest this lane can be taken at `s`, ignoring what comes next. */
  limitSpeedAt(s: number): number {
    const k = Math.abs(laneCurv(this.track.lerpAt(s), this.lane.offset));
    if (k < 1e-5) return this.car.maxSpeed;
    return Math.min(this.car.maxSpeed, Math.sqrt(this.gripBudget / k));
  }

  step(dt: number, now: number): void {
    if (this.deslotted) {
      this.stepOffSlot(dt);
      return;
    }

    const smp = this.track.lerpAt(this.s);
    const k = laneCurv(smp, this.lane.offset);
    const budget = this.gripBudget;

    const lateral = this.speed * this.speed * Math.abs(k);

    // Drive or brake. Engine falls off with speed, so top speed emerges rather
    // than being clamped — the same shape the drawn-line cars use.
    const drive =
      this.car.accel * Math.max(0, 1 - (this.speed / this.car.maxSpeed) ** 2);
    let longitudinal = this.throttle ? drive : -this.car.brake * COAST_BRAKE;
    longitudinal -= DRAG * (this.speed / this.car.maxSpeed);

    // What deslots a car is the LATERAL demand alone, and this took a
    // measurement to get right. Charging the deslot against the combined demand
    // -- cornering plus braking, the way the drawn-line car computes understeer
    // -- made lifting dangerous: a timid plan brakes more often, and it was
    // deslotting on Grand Circuit while planning at 74% of the budget, where a
    // brave plan at 94% got round clean. Exactly backwards.
    //
    // The physical difference is that a slot car's brake is not a pedal. Release
    // the trigger and the motor resists; it cannot demand more retardation than
    // the contact patch will give. Cornering force is not like that -- the
    // geometry forces it, the pin holds it or it does not. So lateral is what
    // can exceed the budget, and lifting can only ever help, because it takes
    // speed out of the v^2 that caused the problem.
    const load = lateral / budget;

    if (load > 1) this.debt += (load - 1) * dt;
    else this.debt = Math.max(0, this.debt - DEBT_DECAY * dt * (1 - load));

    if (this.debt >= DESLOT_DEBT || load > HARD_DESLOT) {
      this.deslot(smp, k);
      return;
    }

    // The circle still applies to what the motor can deliver: whatever the
    // corner has not spent is all there is left to drive or slow with. That is
    // why holding the trigger through a corner is slow even when it survives --
    // the grip to accelerate simply is not there.
    const forLong = Math.sqrt(Math.max(0, budget * budget - lateral * lateral));
    const applied = clamp(longitudinal, -forLong, forLong);

    this.speed = Math.max(0, this.speed + applied * dt);

    // Centreline arc length advances slower than lane distance on the outside of
    // a corner and faster on the inside, by exactly the offset-curve factor.
    const stretch = Math.max(0.25, 1 - smp.curv * this.lane.offset);
    const laneStep = this.speed * dt;
    this.s = wrap(this.s + laneStep / stretch, this.track.length);
    this.distance += laneStep;
    if (this.distance >= (this.laps + 1) * this.lane.length) this.laps++;

    const tan = this.track.lerpAt(this.s).tan;
    this.heading = Math.atan2(tan.y, tan.x);
    // THE readback. A slot car is held by a guide pin at its nose, so as the
    // corner loads up the tail is what steps out -- and how far it is thrown is
    // exactly how close the pin is to leaving the groove. That makes the car
    // itself the instrument, which beats any bar at the top of the screen: it is
    // where the player is already looking, it is diegetic, and it degrades
    // smoothly instead of being a light that comes on.
    //
    // Scaled across the whole usable range rather than the top of it. The first
    // version started at 55% of the budget and peaked at 12 deg, which at the
    // zoom this game plays at was a couple of pixels -- information nobody could
    // read. It now spans from a gentle lean well before the limit to a genuinely
    // alarming angle at the point the pin lets go.
    // Saturates early. Letting the base keep growing with load ate the
    // instrument's range: a clean lap reached 21 deg against 25 for one that
    // came off, so "leaning through a bend" and "about to lose it" looked alike
    // again. The base's job is to show that the car IS cornering; everything
    // above that is the danger term's to say.
    const base = clamp(load / 0.55, 0, 1) * TAIL_BASE;
    const edge = clamp((load - TAIL_START) / (HARD_DESLOT - TAIL_START), 0, 1);
    // Squared, so the tail stays calm through the range where nothing is going
    // to happen and only gets dramatic near the edge. Linear was measurably a
    // bad instrument: a lap that was never in trouble peaked at 19 deg against
    // 23 deg for one that actually came off, so "thrown right out" and "fine"
    // looked the same. The point of the pose is the difference between them.
    const target = -Math.sign(k || 1) * (base + edge * edge * TAIL_MAX);
    this.slip += (target - this.slip) * Math.min(1, dt * 10);

    // The outlook scan is the most expensive thing here and a person cannot
    // react faster than this anyway, so it runs at 30 Hz rather than 120.
    if (--this.cueTick <= 0) {
      this.cueTick = 4;
      const look = this.outlook();
      this.lastLook = look;
      this.cue = this.cue ? look.urgency > CUE_CLEAR : look.urgency > CUE_MARGIN;
    }

    this.telemetry = {
      speed: this.speed,
      load,
      danger: clamp(this.debt / DESLOT_DEBT, 0, 1),
      lateral,
      deslotted: false,
      lift: this.cue,
      tooLate: this.lastLook.urgency > 1.5,
    };
    void now;
  }

  private deslot(smp: { pos: { x: number; y: number }; tan: { x: number; y: number }; nor: { x: number; y: number } }, k: number): void {
    this.deslotted = true;
    this.deslotTimer = MARSHAL_DELAY;
    this.deslotCount++;
    this.debt = 0;
    const off = this.lane.offset;
    this.freePos = { x: smp.pos.x + smp.nor.x * off, y: smp.pos.y + smp.nor.y * off };
    // Straight on, plus a shove to the outside of the corner — which is where a
    // real car goes when the pin lets go.
    const outward = -Math.sign(k || 1);
    this.freeVel = {
      x: smp.tan.x * this.speed + smp.nor.x * outward * this.speed * 0.42,
      y: smp.tan.y * this.speed + smp.nor.y * outward * this.speed * 0.42,
    };
    this.cue = false;
    this.telemetry = {
      speed: this.speed, load: 1, danger: 1, lateral: 0, deslotted: true,
      lift: false, tooLate: false,
    };
  }

  private stepOffSlot(dt: number): void {
    this.deslotTimer -= dt;
    const sp = Math.hypot(this.freeVel.x, this.freeVel.y);
    if (sp > 0.2) {
      const decel = Math.min(sp, 11 * dt);
      const f = (sp - decel) / sp;
      this.freeVel = { x: this.freeVel.x * f, y: this.freeVel.y * f };
      this.freePos = {
        x: this.freePos.x + this.freeVel.x * dt,
        y: this.freePos.y + this.freeVel.y * dt,
      };
      this.heading = Math.atan2(this.freeVel.y, this.freeVel.x);
    }
    this.speed = sp;
    this.telemetry = {
      speed: sp, load: 0, danger: 1, lateral: 0, deslotted: true,
      lift: false, tooLate: false,
    };
    if (this.deslotTimer <= 0) {
      // Re-slotted where it came off, stationary. The lost time is the penalty;
      // there is no need to also move the car backwards.
      this.deslotted = false;
      this.speed = 0;
      this.slip = 0;
      this.debt = 0;
      const tan = this.track.lerpAt(this.s).tan;
      this.heading = Math.atan2(tan.y, tan.x);
    }
  }

  /** Where to draw it. */
  get pos(): { x: number; y: number } {
    if (this.deslotted) return this.freePos;
    const smp = this.track.lerpAt(this.s);
    return {
      x: smp.pos.x + smp.nor.x * this.lane.offset,
      y: smp.pos.y + smp.nor.y * this.lane.offset,
    };
  }
}

function wrap(x: number, n: number): number {
  const r = x % n;
  return r < 0 ? r + n : r;
}
