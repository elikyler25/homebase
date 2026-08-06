// The race: one slot each, no contact, everybody home.
//
// Slot racing has no overtaking in the usual sense — cars cannot touch, they are
// in separate grooves. What you are racing is the other driver's throttle
// discipline, and the pass happens because they deslotted at the hairpin and you
// did not. That makes the AI simple to state: it knows the fastest speed its own
// lane can carry, and how well it holds itself to that is its skill.

import { clamp } from "../math";
import { Track } from "../track";
import { CarClass } from "../vehicle";
import { Lane, laneCurv } from "./lane";
import { COAST_BRAKE, MAGNETS, SlotCar } from "./slotcar";

export const SLOT_DT = 1 / 120;

/**
 * The fastest speed profile a slot can carry, indexed by track sample.
 *
 * This started out as a call to the drawn-line game's `speedProfile`, fed the
 * lane as a point list. That was wrong in a way that took a measurement to see:
 * it re-derives curvature from the points it is given, sampled every 3 m, and a
 * 3 m chord across the tip of a hairpin reads as a gentler corner than the one
 * the car actually drives. Planner and physics then disagreed about how tight
 * the corner was, and Grand Circuit deslotted even when planning at 74% of the
 * grip budget — a careful driver being punished for the planner's arithmetic.
 * Now both read `laneCurv` at the same sample, so they cannot disagree.
 *
 * `margin` is the share of the budget spent on cornering. The rest is what is
 * left to accelerate, brake and overcome drag with, because the slot car obeys
 * a friction circle: at margin 1.0 there is nothing left and even coasting drag
 * puts the car over.
 */
export function lanePlan(
  track: Track,
  car: CarClass,
  lane: Lane,
  margin: number,
): number[] {
  const n = track.samples.length;
  const budget = car.grip * track.surface.grip * 9.81 + (MAGNETS[car.id] ?? 5);
  const aLat = budget * margin;
  const stretch = (i: number) =>
    Math.max(0.25, 1 - track.samples[i].curv * lane.offset);

  const ds = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = track.samples[i];
    const b = track.samples[(i + 1) % n];
    ds[i] = Math.abs(track.wrapDelta(a.s, b.s)) * stretch(i) || 0.01;
  }

  const v = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const k = Math.abs(laneCurv(track.samples[i], lane.offset));
    v[i] = Math.min(car.maxSpeed, k > 1e-5 ? Math.sqrt(aLat / k) : Infinity);
  }
  // Whatever the corner did not spend is what is available to slow down or
  // speed up with -- the friction circle, applied to the plan as well as the car.
  const spare = Math.sqrt(Math.max(0.04, 1 - margin * margin)) * budget;
  // A slot car has no brake pedal. Releasing the trigger shorts the motor, and
  // that is ALL the retardation there is -- a fraction of the figure on the car
  // sheet. Planning against `car.brake` had the plan braking far too late for a
  // car that cannot brake that hard, and the deslots landed on the TIMID
  // margins: at 0.74 the plan believed in 22 m/s^2 of braking, at 0.94 the
  // friction circle cut its own belief to 17, so being careful was punished and
  // being brave was not. Same class of bug as the curvature above, same fix --
  // the plan and the car read one number.
  const coast = car.brake * COAST_BRAKE;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const j = (i + 1) % n;
      const brake = Math.min(coast, spare);
      v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * brake * ds[i]));
    }
    for (let i = 0; i < n; i++) {
      const j = (i - 1 + n) % n;
      const engine = car.accel * Math.max(0.15, 1 - (v[j] / car.maxSpeed) ** 2);
      const push = Math.min(engine, spare);
      v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * push * ds[j]));
    }
  }
  return v;
}

export interface SlotEntrantOpts {
  name: string;
  colour: string;
  car: CarClass;
  lane: Lane;
  /** 0..1. Undefined for the human. */
  skill?: number;
  seed?: number;
}

export class SlotEntrant {
  readonly cara: SlotCar;
  readonly isPlayer: boolean;
  /** Target speed the AI is chasing, indexed by lane-point. */
  private plan: number[] = [];
  private wanted = 0;

  constructor(
    readonly opts: SlotEntrantOpts,
    track: Track,
    startS: number,
  ) {
    this.cara = new SlotCar(opts.car, track, opts.lane, startS);
    this.isPlayer = opts.skill === undefined;
    if (!this.isPlayer) {
      const skill = opts.skill!;
      // Planning margin is what separates a driver who leaves something for the
      // bumps from one who deslots at the first hairpin.
      this.plan = lanePlan(track, opts.car, opts.lane, 0.74 + skill * 0.2);
      // Skill is margin and nothing else. A reaction-lag term was tried and
      // removed: measured across three circuits and five margins, 0.3 s of
      // delay never caused a deslot and was consistently a hair faster, because
      // the trigger is a closed loop and the braking zones are long. Keeping it
      // would have been a knob that looked like difficulty and was not.
    }
  }

  update(dt: number, track: Track): void {
    if (!this.isPlayer) {
      const idx =
        Math.round((this.cara.s / track.length) * this.plan.length) % this.plan.length;
      this.wanted = this.plan[(idx + this.plan.length) % this.plan.length];
      this.cara.throttle = this.cara.speed < this.wanted;
    }
    this.cara.step(dt, 0);
  }
}

export interface SlotStanding {
  name: string;
  colour: string;
  isPlayer: boolean;
  position: number;
  laps: number;
  time: number;
  finished: boolean;
  deslots: number;
  gap: number;
}

export class SlotRace {
  readonly entrants: SlotEntrant[] = [];
  time = 0;
  countdown = 3;
  state: "countdown" | "running" | "finished" = "countdown";

  constructor(
    readonly track: Track,
    readonly laps: number,
    entries: SlotEntrantOpts[],
  ) {
    // Everyone starts abreast on the same centreline arc length. Slots already
    // separate the cars, so there is no reason to stagger the grid — and a
    // stagger would hand out a lead measured in metres before anyone has
    // touched a trigger. (The drawn-line game learned this the hard way.)
    const startS = track.length - 6;
    for (const e of entries) this.entrants.push(new SlotEntrant(e, track, startS));
  }

  update(dt: number): void {
    if (this.state === "finished") return;
    if (this.state === "countdown") {
      this.countdown -= dt;
      if (this.countdown > 0) return;
      this.state = "running";
    }
    this.time += dt;
    for (const e of this.entrants) {
      if (e.cara.finished) continue;
      e.update(dt, this.track);
      if (e.cara.laps >= this.laps) {
        e.cara.finished = true;
        e.cara.finishTime = this.time;
      }
    }
    if (this.entrants.every((e) => e.cara.finished)) this.state = "finished";
  }

  /** Ordered by finish time, then by distance covered. */
  standings(): SlotStanding[] {
    const sorted = [...this.entrants].sort((a, b) => {
      if (a.cara.finished && b.cara.finished) return a.cara.finishTime - b.cara.finishTime;
      if (a.cara.finished) return -1;
      if (b.cara.finished) return 1;
      return b.cara.distance - a.cara.distance;
    });
    const leader = sorted[0];
    return sorted.map((e, i) => ({
      name: e.opts.name,
      colour: e.opts.colour,
      isPlayer: e.isPlayer,
      position: i + 1,
      laps: e.cara.laps,
      time: e.cara.finished ? e.cara.finishTime : this.time,
      finished: e.cara.finished,
      deslots: e.cara.deslotCount,
      gap:
        e.cara.finished && leader.cara.finished
          ? e.cara.finishTime - leader.cara.finishTime
          : (leader.cara.distance - e.cara.distance),
    }));
  }
}

/**
 * The best lap this car can actually drive in this slot.
 *
 * Deliberately measured by DRIVING it, not by integrating the planner's speed
 * profile. The planner does not know about drag, and a real trigger is on or
 * off rather than a servo holding an exact speed, so the integrated profile
 * came out about 10% quicker than anything reachable — which made gold
 * unreachable on every circuit rather than hard. Searching down from the
 * bravest margin for the fastest clean lap gives a yardstick that is by
 * construction possible.
 */
export function slotReferenceTime(track: Track, car: CarClass, lane: Lane): number {
  let best = Infinity;
  for (let m = 0.99; m >= 0.68; m -= 0.03) {
    const r = simulateSlot(track, car, lane, planPolicy(track, car, lane, m), 1);
    if (r.finished && r.deslots === 0) best = Math.min(best, r.time);
  }
  return best;
}

/** Drive a car with a given throttle policy. For harnesses and ghosts. */
export function simulateSlot(
  track: Track,
  car: CarClass,
  lane: Lane,
  policy: (c: SlotCar, t: number) => boolean,
  laps = 1,
  limit = 400,
): SlotRun {
  const c = new SlotCar(car, track, lane, track.length - 6);
  let t = 0;
  let peak = 0;
  let sum = 0;
  let dangerSum = 0;
  let loadSum = 0;
  let loadPeak = 0;
  let loaded = 0;
  let warned = 0;
  let episodes = 0;
  let wasLit = false;
  let n = 0;
  while (t < limit) {
    c.throttle = policy(c, t);
    c.step(SLOT_DT, t);
    t += SLOT_DT;
    n++;
    peak = Math.max(peak, c.speed);
    sum += c.speed;
    dangerSum += c.telemetry.danger;
    loadSum += c.telemetry.load;
    loadPeak = Math.max(loadPeak, c.telemetry.load);
    if (c.telemetry.load > 0.6) loaded++;
    if (c.telemetry.lift) warned++;
    if (c.telemetry.lift && !wasLit) episodes++;
    wasLit = c.telemetry.lift;
    if (c.laps >= laps) break;
  }
  const done = c.laps >= laps;
  const d = Math.max(1, n);
  return {
    time: done ? t : Infinity,
    finished: done,
    deslots: c.deslotCount,
    peak,
    mean: sum / d,
    danger: dangerSum / d,
    load: loadSum / d,
    loadPeak,
    loadedFraction: loaded / d,
    warnedFraction: warned / d,
    cueEpisodes: episodes,
  };
}

export interface SlotRun {
  time: number;
  finished: boolean;
  deslots: number;
  peak: number;
  mean: number;
  /** Mean of the last-moment deslot warning, 0..1. */
  danger: number;
  /** Mean cornering load as a fraction of the budget. The HUD meter. */
  load: number;
  loadPeak: number;
  /**
   * Share of the lap spent above 60% of the budget -- i.e. actually leaning on
   * the car. Mean load is the wrong statistic for this: it is dragged down by
   * straights, so Cathedral and Riverside, which are mostly straight, read as
   * having a dead grip meter when what they have is a long straight.
   */
  loadedFraction: number;
  /** Share of the lap the "lift" cue was showing. */
  warnedFraction: number;
  /**
   * How many separate times the cue lit. The failure that matters is a LATCHED
   * cue -- one that comes on and stays on -- and the share of the lap is a poor
   * proxy for it: across the thirty that share runs unbroken from 38% to 51%,
   * so any line drawn through it splits circuits that differ only in how many
   * corners they have. Counting episodes asks the real question, which is
   * whether the thing is still a per-corner signal.
   */
  cueEpisodes: number;
}

/**
 * A driver who thinks the car has more grip than it has: the right plan, driven
 * `scale` times too fast everywhere.
 *
 * Not the same thing as planning at a margin above 1.0, which was the first
 * attempt. Raising the margin also shrinks what the planner believes it has
 * left to brake with, so the car crawls into corners and never actually
 * overcooks one -- at margin 1.14 it lapped Harbour two seconds QUICKER than a
 * sane plan and never deslotted once. Scaling the target speed keeps the
 * braking model honest and misjudges only the thing a person misjudges.
 */
export function overconfidentPolicy(
  track: Track,
  car: CarClass,
  lane: Lane,
  margin: number,
  scale: number,
): (c: SlotCar) => boolean {
  const plan = lanePlan(track, car, lane, margin);
  return (c: SlotCar) => {
    const idx = Math.round((c.s / track.length) * plan.length) % plan.length;
    return c.speed < plan[(idx + plan.length) % plan.length] * scale;
  };
}

/** A throttle policy that aims at a planned speed, with reaction lag. */
export function planPolicy(
  track: Track,
  car: CarClass,
  lane: Lane,
  margin: number,
  lagSeconds = 0,
): (c: SlotCar, t: number) => boolean {
  const plan = lanePlan(track, car, lane, margin);
  return (c: SlotCar) => {
    // Lag is a delay in SEEING the corner, not in sampling the plan. Modelled as
    // a stale sample it was worth nothing: holding the previous (higher) target
    // a moment longer carried more speed in, and a laggy trigger came out
    // marginally faster than a sharp one. What a slow driver actually does is
    // lift for the corner they are already in rather than the one arriving, so
    // the plan is read from where the car WAS — which is exactly how the
    // drawn-line harness models a lagging finger.
    const behind = lagSeconds * c.speed;
    const s = ((c.s - behind) % track.length + track.length) % track.length;
    const idx = Math.round((s / track.length) * plan.length) % plan.length;
    const wanted = plan[(idx + plan.length) % plan.length];
    return c.speed < wanted;
  };
}

/** Medal thresholds, scaled off the flawless lap. */
export function slotMedals(ref: number): { gold: number; silver: number; bronze: number } {
  return { gold: ref * 1.06, silver: ref * 1.14, bronze: ref * 1.26 };
}

export const clampSkill = (x: number): number => clamp(x, 0, 1);
