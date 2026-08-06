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
export const MAGNETS: Record<string, number> = { rally: 7.5, gt: 5.5, formula: 3.5 };

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
export const COAST_BRAKE = 0.55;
/** Rolling and aero drag, m/s^2 at max speed. */
export const DRAG = 2.4;

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
  /** Tail-out angle. Cosmetic, but driven by the same load as the deslot. */
  slip = 0;
  private debt = 0;

  telemetry: SlotTelemetry = {
    speed: 0, load: 0, danger: 0, lateral: 0, deslotted: false,
  };

  constructor(
    readonly car: CarClass,
    readonly track: Track,
    readonly lane: Lane,
    startS: number,
  ) {
    this.s = startS;
    const smp = track.sampleAt(startS);
    this.heading = Math.atan2(smp.tan.y, smp.tan.x);
  }

  /** Total lateral acceleration the slot and tyres can hold, m/s^2. */
  get gripBudget(): number {
    const surf = this.track.surface;
    return this.car.grip * surf.grip * G + (MAGNETS[this.car.id] ?? 5);
  }

  /** The fastest this lane can be taken at `s`, ignoring what comes next. */
  limitSpeedAt(s: number): number {
    const k = Math.abs(laneCurv(this.track.sampleAt(s), this.lane.offset));
    if (k < 1e-5) return this.car.maxSpeed;
    return Math.min(this.car.maxSpeed, Math.sqrt(this.gripBudget / k));
  }

  step(dt: number, now: number): void {
    if (this.deslotted) {
      this.stepOffSlot(dt);
      return;
    }

    const smp = this.track.sampleAt(this.s);
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

    const tan = this.track.sampleAt(this.s).tan;
    this.heading = Math.atan2(tan.y, tan.x);
    // The tail steps out as the budget runs down. Same number as the danger
    // meter, so what the car looks like and what the HUD says cannot disagree.
    const target = -Math.sign(k || 1) * clamp(load - 0.55, 0, 0.6) * 0.34;
    this.slip += (target - this.slip) * Math.min(1, dt * 9);
    this.heading += this.slip;

    this.telemetry = {
      speed: this.speed,
      load,
      danger: clamp(this.debt / DESLOT_DEBT, 0, 1),
      lateral,
      deslotted: false,
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
    this.telemetry = {
      speed: this.speed, load: 1, danger: 1, lateral: 0, deslotted: true,
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
    };
    if (this.deslotTimer <= 0) {
      // Re-slotted where it came off, stationary. The lost time is the penalty;
      // there is no need to also move the car backwards.
      this.deslotted = false;
      this.speed = 0;
      this.slip = 0;
      this.debt = 0;
      const tan = this.track.sampleAt(this.s).tan;
      this.heading = Math.atan2(tan.y, tan.x);
    }
  }

  /** Where to draw it. */
  get pos(): { x: number; y: number } {
    if (this.deslotted) return this.freePos;
    const smp = this.track.sampleAt(this.s);
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
