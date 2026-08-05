// Race orchestration: the grid, the clock, contact between cars, and the
// headless simulation used to calibrate medal times.

import { AiDriver, buildAiLine, buildReferenceLine } from "./ai";
import { RacingLine } from "./line";
import { Vec2, vadd, vlen, vscale, vsub } from "./math";
import { Track } from "./track";
import { CAR_CLASSES, CarClass, Vehicle } from "./vehicle";

export type RaceState = "countdown" | "running" | "finished";

export interface Entrant {
  vehicle: Vehicle;
  name: string;
  colour: string;
  isPlayer: boolean;
  /** True for every hand-drawn car, including the hot-seat rivals. */
  isHuman?: boolean;
}

/** A hand-drawn car other than player one — hot seat. */
export interface HumanEntry {
  line: RacingLine;
  car: CarClass;
  name: string;
  colour: string;
}

export interface RaceOptions {
  /** Laps for this event; defaults to the circuit's own. */
  laps?: number;
  /** Extra human-drawn cars, racing on equal terms with player one. */
  rivals?: HumanEntry[];
  /** A previous best, re-driven alongside. Not in the race, not in contact. */
  ghost?: { line: RacingLine; turboAt: number[] } | null;
  /**
   * Fire turbo by rule rather than by tap. One screen cannot take a tap for
   * four cars at once, so hot seat gives every car the same automatic rule
   * instead of handing player one an advantage nobody else can answer.
   */
  autoTurbo?: boolean;
}

export interface Standing {
  name: string;
  colour: string;
  isPlayer: boolean;
  position: number;
  time: number;
  finished: boolean;
  gap: number;
  lap: number;
}

/** Fixed physics step. Rendering interpolates; the sim never varies. */
export const PHYS_DT = 1 / 120;
const COUNTDOWN = 2.6;

export class Race {
  state: RaceState = "countdown";
  elapsed = 0;
  countdown = COUNTDOWN;
  entrants: Entrant[] = [];
  player!: Entrant;
  private accumulator = 0;

  /** Laps for this event; defaults to the circuit's own, overridden by skill runs. */
  readonly laps: number;

  /**
   * Your own previous best, re-driven. Deliberately kept out of `entrants`: it
   * must not be rankable, collidable, or able to end the race, and every one of
   * those would need a special case if it lived in the field.
   */
  ghost: Vehicle | null = null;
  private ghostTurbo: number[] = [];
  private ghostTurboNext = 0;
  private ghostTime = 0;
  private autoTurbo: boolean;

  constructor(
    readonly track: Track,
    playerLine: RacingLine,
    playerCar: CarClass,
    drivers: AiDriver[],
    aiCar: CarClass,
    opts: RaceOptions = {},
  ) {
    this.laps = opts.laps ?? track.def.laps;
    this.autoTurbo = !!opts.autoTurbo;
    const rivals = opts.rivals ?? [];
    const grid = gridSlots(track, drivers.length + rivals.length + 1, rivals.length > 0);

    this.player = {
      vehicle: new Vehicle(playerCar, playerLine, track, grid[0].pos, grid[0].heading, "You"),
      name: rivals.length ? "P1" : "You",
      colour: playerCar.colour,
      isPlayer: true,
      isHuman: true,
    };
    this.entrants.push(this.player);

    rivals.forEach((r, i) => {
      const slot = grid[i + 1];
      this.entrants.push({
        vehicle: new Vehicle(r.car, r.line, track, slot.pos, slot.heading, r.name),
        name: r.name,
        colour: r.colour,
        isPlayer: false,
        isHuman: true,
      });
    });

    drivers.forEach((d, i) => {
      const line = buildAiLine(track, aiCar, d.skill, 1000 + i * 7919);
      const slot = grid[i + 1 + rivals.length];
      this.entrants.push({
        vehicle: new Vehicle(aiCar, line, track, slot.pos, slot.heading, d.name),
        name: d.name,
        colour: d.colour,
        isPlayer: false,
      });
    });

    if (opts.ghost) {
      // Same slot as the player, so the two start level and the gap you watch
      // open up is entirely the difference between the two strokes.
      this.ghost = new Vehicle(
        playerCar,
        opts.ghost.line,
        track,
        grid[0].pos,
        grid[0].heading,
        "Ghost",
      );
      this.ghostTurbo = opts.ghost.turboAt;
    }
  }

  get finished(): boolean {
    return this.state === "finished";
  }

  /** Advance by real time, consuming it in fixed physics steps. */
  update(dtReal: number): void {
    const dt = Math.min(dtReal, 0.1);
    if (this.state === "countdown") {
      this.countdown -= dt;
      if (this.countdown <= 0) this.state = "running";
      return;
    }
    if (this.state === "finished") return;

    this.accumulator += dt;
    let guard = 0;
    while (this.accumulator >= PHYS_DT && guard++ < 240) {
      this.stepOnce(PHYS_DT);
      this.accumulator -= PHYS_DT;
    }
  }

  private stepOnce(dt: number): void {
    this.elapsed += dt;
    for (const e of this.entrants) {
      if (e.vehicle.finished) continue;
      if (this.autoTurbo && e.isHuman) autoDeploy(e.vehicle);
      e.vehicle.step(dt);
      if (e.vehicle.lapsDone >= this.laps) {
        e.vehicle.finished = true;
        e.vehicle.finishTime = this.elapsed;
      }
    }
    resolveContacts(this.entrants.map((e) => e.vehicle));

    this.stepGhost(dt);

    if (this.entrants.every((e) => e.vehicle.finished)) {
      this.runGhostOut();
      this.state = "finished";
    } else if (this.player.vehicle.finished) {
      // Once the player is home, run the rest out quickly rather than making
      // them watch the tail of the field circulate.
      let guard = 0;
      while (!this.entrants.every((e) => e.vehicle.finished) && guard++ < 20000) {
        this.elapsed += PHYS_DT;
        for (const e of this.entrants) {
          if (e.vehicle.finished) continue;
          e.vehicle.step(PHYS_DT);
          if (e.vehicle.lapsDone >= this.laps) {
            e.vehicle.finished = true;
            e.vehicle.finishTime = this.elapsed;
          }
        }
      }
      this.runGhostOut();
      this.state = "finished";
    }
  }

  /**
   * The ghost keeps its own clock. It starts with the field and runs the same
   * laps, but the race can be wrapped up before it gets home — and a ghost with
   * no finish time is a ghost the results screen cannot report.
   */
  private stepGhost(dt: number): void {
    const g = this.ghost;
    if (!g || g.finished) return;
    // Replay the boosts from the recorded lap at the distances they were taken,
    // so the ghost sets the time it is labelled with.
    while (
      this.ghostTurboNext < this.ghostTurbo.length &&
      g.distance >= this.ghostTurbo[this.ghostTurboNext]
    ) {
      this.ghostTurboNext++;
      g.deployTurbo();
    }
    g.step(dt);
    this.ghostTime += dt;
    if (g.lapsDone >= this.laps) {
      g.finished = true;
      g.finishTime = this.ghostTime;
    }
  }

  private runGhostOut(): void {
    let guard = 0;
    while (this.ghost && !this.ghost.finished && guard++ < 40000) this.stepGhost(PHYS_DT);
  }

  deployPlayerTurbo(): boolean {
    if (this.state !== "running" || this.autoTurbo) return false;
    return this.player.vehicle.deployTurbo();
  }

  /**
   * Seconds the player is behind their ghost (negative if ahead). Distance
   * converted at the player's current speed — the same approximation every
   * live timing screen uses, and honest at any speed worth reading it at.
   */
  ghostDelta(): number {
    if (!this.ghost) return NaN;
    const p = this.player.vehicle;
    return (this.ghost.distance - p.distance) / Math.max(p.telemetry.speed, 6);
  }

  standings(): Standing[] {
    const rows = this.entrants.map((e) => ({
      name: e.name,
      colour: e.colour,
      isPlayer: e.isPlayer,
      position: 0,
      time: e.vehicle.finishTime,
      finished: e.vehicle.finished,
      gap: 0,
      lap: Math.min(e.vehicle.currentLap, this.laps),
      _dist: e.vehicle.distance,
    }));
    rows.sort((a, b) => {
      if (a.finished && b.finished) return a.time - b.time;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b._dist - a._dist;
    });
    const leader = rows[0];
    rows.forEach((r, i) => {
      r.position = i + 1;
      r.gap = r.finished && leader.finished ? r.time - leader.time : NaN;
    });
    return rows;
  }
}

/**
 * The hot-seat turbo rule. Fire once the tank is nearly full and the line ahead
 * is straight enough to spend grip on speed rather than on turning — which is
 * exactly the advice the game gives a player holding the button. Applied to
 * every drawn car identically, so the race still comes down to the strokes.
 */
function autoDeploy(v: Vehicle): void {
  if (v.turboCharge < 0.8 || v.turboTimer > 0) return;
  if (v.telemetry.speed < v.car.maxSpeed * 0.45) return;
  if (Math.abs(v.line.at(v.lineS + 20).curv) > 0.006) return;
  v.deployTurbo();
}

/**
 * Grid slots behind the start line.
 *
 * Normally staggered, alternating sides, which hands the player pole — fine
 * against AI. `abreast` puts everyone on one row instead, and hot seat needs it:
 * a staggered grid is worth about half a second across four slots, which is
 * larger than the difference between two people's strokes. A mode whose whole
 * point is comparing strokes cannot decide itself on who drew first.
 */
function gridSlots(
  track: Track,
  count: number,
  abreast = false,
): { pos: Vec2; heading: number }[] {
  const out: { pos: Vec2; heading: number }[] = [];
  if (abreast) {
    const smp = track.sampleAt(track.length - 6);
    const heading = Math.atan2(smp.tan.y, smp.tan.x);
    for (let i = 0; i < count; i++) {
      const t = count < 2 ? 0 : (i / (count - 1)) * 2 - 1;
      out.push({ pos: vadd(smp.pos, vscale(smp.nor, t * track.halfWidth * 0.86)), heading });
    }
    return out;
  }
  for (let i = 0; i < count; i++) {
    const back = 6 + i * 7;
    const s = track.length - back;
    const smp = track.sampleAt(s);
    const side = (i % 2 === 0 ? 1 : -1) * track.halfWidth * 0.35;
    out.push({
      pos: vadd(smp.pos, vscale(smp.nor, side)),
      heading: Math.atan2(smp.tan.y, smp.tan.x),
    });
  }
  return out;
}

/**
 * Soft contact. Cars are discs that refuse to overlap; the push is split
 * between them and scrubs a little speed, so a bump costs time without
 * turning into a pinball physics showcase.
 */
function resolveContacts(cars: Vehicle[]): void {
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      if (a.finished || b.finished) continue;
      const minDist = a.car.radius + b.car.radius;
      const d = vsub(b.pos, a.pos);
      const dist = vlen(d);
      if (dist >= minDist || dist < 1e-6) continue;
      const n = vscale(d, 1 / dist);
      const overlap = (minDist - dist) * 0.5;
      a.pos = vsub(a.pos, vscale(n, overlap));
      b.pos = vadd(b.pos, vscale(n, overlap));

      // Bleed the closing component of relative velocity.
      const rel = vsub(b.vel, a.vel);
      const closing = rel.x * n.x + rel.y * n.y;
      if (closing < 0) {
        const imp = vscale(n, closing * 0.45);
        a.vel = vadd(a.vel, imp);
        b.vel = vsub(b.vel, imp);
      }
    }
  }
}

/**
 * Run a line to the flag with no rendering. Used for medal calibration and for
 * the tuning harness — same Vehicle, same constants, just faster than real time.
 */
export function simulateHeadless(
  track: Track,
  car: CarClass,
  line: RacingLine,
  laps: number,
  maxSeconds = 400,
): { time: number; finished: boolean; peakSpeed: number; offTrackTime: number } {
  const smp = track.sampleAt(track.length - 4);
  const veh = new Vehicle(car, line, track, smp.pos, Math.atan2(smp.tan.y, smp.tan.x));
  let t = 0;
  let peak = 0;
  let off = 0;
  const limit = Math.floor(maxSeconds / PHYS_DT);
  for (let i = 0; i < limit; i++) {
    veh.step(PHYS_DT);
    t += PHYS_DT;
    peak = Math.max(peak, veh.telemetry.speed);
    if (!veh.telemetry.onTrack) off += PHYS_DT;
    if (veh.lapsDone >= laps) {
      return { time: t, finished: true, peakSpeed: peak, offTrackTime: off };
    }
  }
  return { time: t, finished: false, peakSpeed: peak, offTrackTime: off };
}

/** The time a perfect line would set. Medal thresholds scale off this. */
export function referenceTime(track: Track, carId: string): number {
  const car = CAR_CLASSES[carId] ?? CAR_CLASSES.gt;
  const line = buildReferenceLine(track, car);
  const r = simulateHeadless(track, car, line, track.def.laps);
  return r.finished ? r.time : Infinity;
}

export function medalFor(
  time: number,
  reference: number,
  medals: { gold: number; silver: number; bronze: number },
): "gold" | "silver" | "bronze" | null {
  if (!isFinite(time) || !isFinite(reference)) return null;
  if (time <= reference * medals.gold) return "gold";
  if (time <= reference * medals.silver) return "silver";
  if (time <= reference * medals.bronze) return "bronze";
  return null;
}
