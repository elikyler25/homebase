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

  constructor(
    readonly track: Track,
    playerLine: RacingLine,
    playerCar: CarClass,
    drivers: AiDriver[],
    aiCar: CarClass,
  ) {
    const grid = gridSlots(track, drivers.length + 1);

    this.player = {
      vehicle: new Vehicle(playerCar, playerLine, track, grid[0].pos, grid[0].heading, "You"),
      name: "You",
      colour: playerCar.colour,
      isPlayer: true,
    };
    this.entrants.push(this.player);

    drivers.forEach((d, i) => {
      const line = buildAiLine(track, aiCar, d.skill, 1000 + i * 7919);
      const slot = grid[i + 1];
      this.entrants.push({
        vehicle: new Vehicle(aiCar, line, track, slot.pos, slot.heading, d.name),
        name: d.name,
        colour: d.colour,
        isPlayer: false,
      });
    });
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
      e.vehicle.step(dt);
      if (e.vehicle.lapsDone >= this.track.def.laps) {
        e.vehicle.finished = true;
        e.vehicle.finishTime = this.elapsed;
      }
    }
    resolveContacts(this.entrants.map((e) => e.vehicle));

    if (this.entrants.every((e) => e.vehicle.finished)) {
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
          if (e.vehicle.lapsDone >= this.track.def.laps) {
            e.vehicle.finished = true;
            e.vehicle.finishTime = this.elapsed;
          }
        }
      }
      this.state = "finished";
    }
  }

  deployPlayerTurbo(): boolean {
    if (this.state !== "running") return false;
    return this.player.vehicle.deployTurbo();
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
      lap: Math.min(e.vehicle.currentLap, this.track.def.laps),
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

/** Staggered grid slots behind the start line, alternating sides. */
function gridSlots(track: Track, count: number): { pos: Vec2; heading: number }[] {
  const out: { pos: Vec2; heading: number }[] = [];
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
