// Vehicle simulation.
//
// The car is a point mass with a grip budget. Every tick it wants two things:
// to be pointed along the drawn line (lateral acceleration) and to be at the
// speed the player drew (longitudinal acceleration). Those two demands compete
// for one budget — the friction circle — and when the total demand exceeds it,
// the car slides.
//
// That single constraint is where the whole game lives. Draw a fast line into a
// tight corner and the lateral demand blows the budget, the car cannot generate
// the turn it was asked for, and it runs wide exactly as far as your greed
// deserved. Nothing here special-cases "skidding"; it falls out.

import { RacingLine } from "./line";
import { Vec2, clamp, damp, vadd, vlen, vnorm, vscale, vsub } from "./math";
import { OFFTRACK, Track } from "./track";

const G = 9.81;

/**
 * Global tyre-grip scale.
 *
 * Measured, a hand-drawn stroke demands 22-28 m/s^2 of lateral acceleration
 * where a planned AI line demands 9-11. That is not because the player's *path*
 * is worse — a wobbly centreline stroke with a planned profile slides zero — it
 * is because a person eyeballing corner speed lands near the theoretical limit
 * while the AI's planner deliberately keeps a margin. With the budget at 19,
 * every ordinary stroke sat permanently over it, so the player's car understeered
 * all lap and finished last on every track while the AI never slid at all.
 *
 * Raising the budget so a sensible stroke fits inside it is the fix. The AI is
 * not handed the same gift: its planned speeds scale with the square root of
 * grip, so its skill levels were lowered to compensate and the field still has
 * to be beaten on merit.
 */
const GRIP_SCALE = 1.75;

export interface CarClass {
  id: string;
  name: string;
  /** Peak engine acceleration at zero speed, m/s^2. */
  accel: number;
  /** Peak braking deceleration, m/s^2. */
  brake: number;
  /** Tyre grip coefficient, multiplied by the surface. 1.0 ~= 1g. */
  grip: number;
  maxSpeed: number;
  /** Extra longitudinal acceleration while turbo is deployed. */
  turboThrust: number;
  /** Half-length of the car in metres, for drawing and contact. */
  radius: number;
  colour: string;
}

export const CAR_CLASSES: Record<string, CarClass> = {
  rally: {
    id: "rally",
    name: "Rally",
    accel: 14,
    brake: 18,
    grip: 1.7 * GRIP_SCALE,
    maxSpeed: 52,
    turboThrust: 11,
    radius: 2.1,
    colour: "#ffd23f",
  },
  gt: {
    id: "gt",
    name: "GT",
    accel: 17,
    brake: 22,
    grip: 1.95 * GRIP_SCALE,
    maxSpeed: 63,
    turboThrust: 13,
    radius: 2.1,
    colour: "#ff5c5c",
  },
  formula: {
    id: "formula",
    name: "Formula",
    accel: 21,
    brake: 27,
    grip: 2.35 * GRIP_SCALE,
    maxSpeed: 76,
    turboThrust: 15,
    radius: 2.0,
    colour: "#4fc3f7",
  },
};

export interface VehicleTelemetry {
  speed: number;
  /** How much lateral acceleration was demanded beyond the grip budget. */
  understeer: number;
  slipAngle: number;
  onTrack: boolean;
  gripUsed: number;
}

export class Vehicle {
  pos: Vec2;
  vel: Vec2 = { x: 0, y: 0 };
  heading: number;
  slipAngle = 0;

  /** Arc length along its own racing line. */
  lineS = 0;
  /** Arc length along the track centreline, used for lap counting. */
  trackS = 0;
  /**
   * Times the finish line has been crossed since the car was placed. Cars start
   * *behind* the line, so the first crossing begins lap 1 rather than completing
   * one — hence `lapsDone` is one less than the crossing count.
   */
  crossings = 0;
  finished = false;
  finishTime = Infinity;
  /** Distance covered, for ranking mid-race. */
  distance = 0;

  turboCharge = 0;
  turboTimer = 0;
  turboReady = true;
  /** Distances at which turbo was deployed, so a ghost can replay them. */
  turboAt: number[] = [];

  telemetry: VehicleTelemetry = {
    speed: 0,
    understeer: 0,
    slipAngle: 0,
    onTrack: true,
    gripUsed: 0,
  };

  /** Recent skid segments, consumed by the renderer. */
  skidEmit: { pos: Vec2; heading: number; intensity: number }[] = [];
  dustEmit: { pos: Vec2; vel: Vec2; kind: "dust" | "tyre" | "smoke" }[] = [];
  /** Alternates so smoke leaves one rear wheel then the other. */
  private smokeSide = 1;
  /** Previous tick's cross-track error, used to detect a car that is lost. */
  private lastCrossErr = 0;

  /** Diagnostic breakdown of where the lateral demand came from. */
  debug = { latPursuit: 0, latCorrect: 0, aPeak: 0, wanted: 0, crossErr: 0 };

  constructor(
    public readonly car: CarClass,
    public readonly line: RacingLine,
    public readonly track: Track,
    startPos: Vec2,
    startHeading: number,
    public readonly label = "",
  ) {
    this.pos = { ...startPos };
    this.heading = startHeading;
    const p = track.project(startPos);
    this.trackS = p.s;
    this.lineS = line.nearestS(startPos, 0, line.length, line.length);
  }

  get speed(): number {
    return vlen(this.vel);
  }

  /** Laps actually completed. */
  get lapsDone(): number {
    return Math.max(0, this.crossings - 1);
  }

  /** Lap currently being driven, 1-based, for display. */
  get currentLap(): number {
    return Math.max(1, this.crossings);
  }

  /** Deploy turbo if there is charge. Returns whether it fired. */
  deployTurbo(): boolean {
    if (this.turboCharge < 0.25 || this.turboTimer > 0) return false;
    this.turboTimer = 1.1 + this.turboCharge * 0.5;
    this.turboCharge = 0;
    this.turboAt.push(this.distance);
    return true;
  }

  step(dt: number): void {
    if (this.finished) return;
    this.skidEmit.length = 0;
    this.dustEmit.length = 0;

    const speed = this.speed;

    // --- Where am I, and what am I standing on? -------------------------
    const proj = this.track.project(this.pos);
    const onTrack = proj.onTrack;
    const surf = onTrack ? this.track.surface : OFFTRACK;

    // Lap bookkeeping: a jump from the last quarter of the lap to the first is
    // a crossing of the start/finish line. Going the other way is a lap back.
    const lapLen = this.track.length;
    const prevS = this.trackS;
    if (prevS > lapLen * 0.75 && proj.s < lapLen * 0.25) this.crossings++;
    else if (prevS < lapLen * 0.25 && proj.s > lapLen * 0.75) this.crossings--;
    this.trackS = proj.s;

    // --- Follow the line -------------------------------------------------
    // Normally a tight, forward-biased search: a drawn line can cross itself and
    // a global nearest-point query would teleport the car onto the wrong branch.
    // But a bounded window also means a car thrown a long way off can never find
    // its way home, so past a large error, re-acquire globally.
    const lost = Math.abs(this.lastCrossErr) > this.track.halfWidth * 3 + 12;
    this.lineS = lost
      ? this.line.nearestS(this.pos, this.lineS, this.line.length, this.line.length)
      : this.line.nearestS(this.pos, this.lineS, clamp(speed * 0.4 + 6, 8, 26), 6);

    // Lookahead has to stay short relative to corner radius. Long lookahead
    // makes pure pursuit cut the chord: it turns in late, then demands more
    // lateral grip than exists and ploughs wide — which looked like a physics
    // problem but was really a tracking-error problem, and was pushing even the
    // ideal line off a technical circuit.
    const lookahead = clamp(speed * 0.22 + 3, 3.5, 14);
    const target = this.line.at(this.lineS + lookahead);
    // Read the requested speed slightly ahead so the car reacts like a driver
    // rather than a servo snapping to the value under its own axle.
    const wanted = this.line.at(this.lineS + speed * 0.18);
    const desiredSpeed = Math.min(wanted.speed, this.car.maxSpeed);

    const toTarget = vsub(target.pos, this.pos);
    const L = Math.max(2, vlen(toTarget));
    const dir = vnorm(toTarget);

    // Pure pursuit: the curvature that would bring us onto the target point.
    const velDir =
      speed > 0.6 ? vnorm(this.vel) : { x: Math.cos(this.heading), y: Math.sin(this.heading) };
    const alpha = Math.atan2(
      velDir.x * dir.y - velDir.y * dir.x,
      velDir.x * dir.x + velDir.y * dir.y,
    );
    const kappa = (2 * Math.sin(alpha)) / L;
    const latPursuit = speed * speed * kappa;

    // --- The grip budget --------------------------------------------------
    const aPeak = this.car.grip * surf.grip * G;

    // Pure pursuit alone tracks a line loosely — it aims at a point ahead and
    // tolerates a steady offset, so every car ends up driving the follower's
    // limit rather than the line it was given. That flattened the whole AI field
    // to within half a second regardless of skill. A PD term on cross-track
    // error is what a real driver adds when they notice they are running wide,
    // and it makes the planned line the thing that decides the lap time again.
    //
    // It has to be bounded, though, and it has to fade out at low speed. A car
    // sitting 30 m off its line would otherwise demand five times the grip it
    // owns purely to get back — which collapses its own traction through the
    // falloff below and leaves it stranded, spinning, forever.
    const here = this.line.at(this.lineS);
    const nHere = { x: -here.tan.y, y: here.tan.x };
    const crossErr =
      (this.pos.x - here.pos.x) * nHere.x + (this.pos.y - here.pos.y) * nHere.y;
    const crossRate = this.vel.x * nHere.x + this.vel.y * nHere.y;
    const authority = clamp(speed / 9, 0, 1);
    const latCorrect =
      clamp(-3.2 * crossErr - 2.6 * crossRate, -aPeak * 0.55, aPeak * 0.55) * authority;

    this.lastCrossErr = crossErr;
    this.debug = { latPursuit, latCorrect, aPeak, wanted: desiredSpeed, crossErr };

    const latDemand = latPursuit + latCorrect;

    // Post-peak tyre falloff. A sliding tyre does not hold the same grip it had
    // at the limit — it holds less, and the further past the limit you ask it to
    // go the less it gives back. This is the difference between overdriving
    // costing a tenth and overdriving costing you the corner: it compounds, so a
    // line drawn flat out into a hairpin loses grip, runs wider, demands more
    // grip still, and ends up on the marbles. Without it a greedy stroke merely
    // understeers politely and can even be quicker than a measured one.
    //
    // Bounded, for the same reason as above: unbounded falloff is a cliff where
    // any small over-ask compounds to a spin, which punishes the *fastest* lines
    // hardest and inverts the skill ordering. And it is driven by the cornering
    // demand only — the recovery controller pulling hard to get back on line is
    // not the driver overcooking a corner, and must not be charged as if it were.
    const overAsk = Math.max(0, Math.abs(latPursuit) / Math.max(aPeak, 0.01) - 1);
    const aMax = aPeak * (1 - 0.45 * clamp(overAsk, 0, 1));

    // Engine falls off with speed; that, not a hard clamp, sets top speed.
    const throttleAvail =
      this.car.accel * Math.max(0, 1 - (speed / this.car.maxSpeed) ** 2);
    const speedErr = desiredSpeed - speed;
    let longDemand =
      speedErr >= 0
        ? Math.min(throttleAvail, speedErr * 2.6)
        : Math.max(-this.car.brake, speedErr * 2.6);

    // Turbo takes its cut of the budget *first*, which is precisely why it can
    // ruin a corner: whatever it eats is no longer available to turn with.
    const turboing = this.turboTimer > 0;
    if (turboing) {
      this.turboTimer -= dt;
      longDemand = Math.max(longDemand, this.car.turboThrust);
      this.dustEmit.push({
        pos: { ...this.pos },
        vel: vscale(velDir, -speed * 0.35),
        kind: "smoke",
      });
    }

    let latAcc: number;
    let longAcc: number;
    if (turboing) {
      // Longitudinal priority — the boost is committed, the corner takes what's left.
      longAcc = clamp(longDemand, -aMax, aMax);
      const rem = Math.sqrt(Math.max(0, aMax * aMax - longAcc * longAcc));
      latAcc = clamp(latDemand, -rem, rem);
    } else {
      // Lateral priority — you must make the corner before you make time.
      latAcc = clamp(latDemand, -aMax, aMax);
      const rem = Math.sqrt(Math.max(0, aMax * aMax - latAcc * latAcc));
      longAcc = clamp(longDemand, -rem, rem);
    }

    const understeer = Math.max(0, Math.abs(latDemand) - Math.abs(latAcc));

    // --- Consequences of exceeding the budget -----------------------------
    // Sliding tyres scrub some speed, but only some. This coefficient has to
    // stay low: crank it up and it becomes a speed governor that quietly holds
    // the car at its cornering limit, so overcooking a corner costs a little
    // time and nothing else. The punishment that matters is geometric — latAcc
    // is capped, the car cannot generate the turn it was asked for, and it runs
    // wide onto the grass under its own momentum.
    const scrub = understeer * (0.09 + surf.slide * 0.1);
    let newSpeed = speed + longAcc * dt - scrub * dt;

    // Rolling resistance and the off-track punishment.
    newSpeed -= surf.drag * dt;
    newSpeed = Math.max(0, newSpeed);

    // Turbo charges under braking — the game rewards the driver who slowed
    // down properly, then hands them the means to make it back.
    if (longAcc < -1) {
      this.turboCharge = clamp(
        this.turboCharge + (-longAcc / this.car.brake) * dt * 0.55,
        0,
        1,
      );
    }

    // --- Integrate --------------------------------------------------------
    if (speed > 0.5) {
      const yawRate = latAcc / Math.max(speed, 0.5);
      const ang = yawRate * dt;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const vx = this.vel.x * c - this.vel.y * s;
      const vy = this.vel.x * s + this.vel.y * c;
      this.vel = { x: vx, y: vy };
    } else {
      // Crawling: point at the target so we can get going again.
      this.vel = vscale(dir, Math.max(newSpeed, 0.01));
    }

    const curLen = vlen(this.vel) || 1e-6;
    this.vel = vscale(this.vel, newSpeed / curLen);
    this.pos = vadd(this.pos, vscale(this.vel, dt));
    this.distance += newSpeed * dt;

    // --- Attitude ---------------------------------------------------------
    // Slip angle is cosmetic-but-honest: the nose points into the corner more
    // than the velocity vector does, and the excess is how sideways you are.
    // Slip angle is cosmetic-but-honest: the nose points into the corner more
    // than the velocity vector does, and the excess is how sideways you are.
    //
    // The understeer coefficient used to be 0.5, which put the car at ~29 deg of
    // body slip for being 100% over budget and peaked at 35 deg — a full
    // oversteer drift pose for what is actually an understeering car ploughing
    // wide. Against the AI's steady 2-4 deg it read as the player's car being a
    // different, wilder machine. It is the same machine; it was just being asked
    // for more than it had, and then drawn as though it were sliding sideways.
    const slipTarget =
      clamp(understeer / Math.max(aMax, 1), 0, 1.2) * Math.sign(latDemand || 1) * 0.16 +
      clamp(-latAcc / Math.max(aMax, 1), -1, 1) * surf.slide * 0.18;
    this.slipAngle = damp(this.slipAngle, slipTarget, 6 + (1 - surf.slide) * 8, dt);

    const velAngle = Math.atan2(this.vel.y, this.vel.x);
    this.heading = velAngle + this.slipAngle;

    // --- Effects ----------------------------------------------------------
    const gripUsed = Math.hypot(latAcc, longAcc) / Math.max(aMax, 0.01);
    if ((understeer > 0.6 || gripUsed > 0.94) && newSpeed > 4) {
      this.skidEmit.push({
        pos: { ...this.pos },
        heading: this.heading,
        intensity: clamp(understeer / 6 + (gripUsed - 0.9) * 3, 0.15, 1),
      });
    }
    if (!onTrack && newSpeed > 3) {
      this.dustEmit.push({
        pos: { ...this.pos },
        vel: vscale(velDir, -newSpeed * 0.3),
        kind: "dust",
      });
    } else if (surf.id === "gravel" && newSpeed > 8 && understeer > 0.2) {
      this.dustEmit.push({
        pos: { ...this.pos },
        vel: vscale(velDir, -newSpeed * 0.25),
        kind: "dust",
      });
    }

    // Tyre smoke off the rear wheels once they are genuinely sliding. This is
    // the clearest read the player gets that a corner was overcooked: it shows
    // up exactly when the grip budget has been blown, not on a timer, so the
    // smoke is diegetic feedback rather than decoration. Alternating sides
    // keeps the plume from stacking into one dense blob.
    if (understeer > 1.2 && newSpeed > 6 && onTrack) {
      const lat = { x: -velDir.y, y: velDir.x };
      const rear = vsub(this.pos, vscale(velDir, this.car.radius * 0.75));
      this.smokeSide = -this.smokeSide;
      this.dustEmit.push({
        pos: vadd(rear, vscale(lat, this.smokeSide * this.car.radius * 0.42)),
        vel: vadd(
          vscale(velDir, -newSpeed * 0.22),
          vscale(lat, this.smokeSide * 1.8),
        ),
        kind: "tyre",
      });
    }

    this.telemetry = {
      speed: newSpeed,
      understeer,
      slipAngle: this.slipAngle,
      onTrack,
      gripUsed,
    };
  }
}
