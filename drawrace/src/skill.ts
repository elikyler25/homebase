// Balloon skill events.
//
// The original's other mode: no opponents, just a circuit strewn with balloons
// that have to be driven through. It changes what the stroke is for — a racing
// line is no longer automatically the right answer, because the balloons are
// deliberately placed off it, and every detour costs time you then have to make
// back somewhere else.
//
// Balloons are authored as (fraction of a lap, fraction of half-width) rather
// than world coordinates, so they follow the circuit's shape and survive any
// later change to a layout without needing to be re-placed by hand.

import { Vec2, vadd, vscale } from "./math";
import { Track } from "./track";

export interface BalloonSpec {
  /** Position around the lap, 0..1. */
  t: number;
  /** Lateral offset as a fraction of half-width; -1 is one edge, +1 the other. */
  lat: number;
}

export interface SkillEvent {
  id: string;
  name: string;
  trackId: string;
  classId: string;
  tier: 1 | 2 | 3;
  /** Laps to run. Skill events are a single lap — it is a puzzle, not a race. */
  laps: number;
  balloons: BalloonSpec[];
}

/** Balloons alternating across the track, so no single line collects them all. */
function slalom(count: number, from: number, to: number, amp = 0.62): BalloonSpec[] {
  const out: BalloonSpec[] = [];
  for (let i = 0; i < count; i++) {
    const t = from + ((to - from) * i) / Math.max(1, count - 1);
    out.push({ t, lat: (i % 2 === 0 ? 1 : -1) * amp });
  }
  return out;
}

/** Balloons hugging the outside of a corner — the opposite of the racing line. */
function outside(count: number, from: number, to: number, lat = 0.72): BalloonSpec[] {
  const out: BalloonSpec[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ t: from + ((to - from) * i) / Math.max(1, count - 1), lat });
  }
  return out;
}

export const SKILL_EVENTS: SkillEvent[] = [
  {
    id: "skill-harbour",
    name: "Harbour Slalom",
    trackId: "harbour",
    classId: "gt",
    tier: 1,
    laps: 1,
    balloons: [
      ...slalom(6, 0.05, 0.3),
      ...outside(3, 0.4, 0.5, 0.75),
      ...slalom(6, 0.6, 0.9, 0.55),
    ],
  },
  {
    id: "skill-lakeside",
    name: "Lakeside Lanterns",
    trackId: "lakeside",
    classId: "gt",
    tier: 1,
    laps: 1,
    balloons: [
      ...outside(4, 0.06, 0.18, -0.7),
      ...slalom(7, 0.26, 0.58, 0.62),
      ...outside(3, 0.66, 0.76, 0.74),
      ...slalom(5, 0.82, 0.96, 0.5),
    ],
  },
  {
    id: "skill-dustbowl",
    name: "Dust Bowl Scramble",
    trackId: "dustbowl",
    classId: "rally",
    tier: 2,
    laps: 1,
    balloons: [
      ...slalom(5, 0.04, 0.22, 0.68),
      ...outside(4, 0.32, 0.46, -0.78),
      ...slalom(7, 0.55, 0.94, 0.6),
    ],
  },
  {
    id: "skill-coppermine",
    name: "Copper Mine Run",
    trackId: "coppermine",
    classId: "rally",
    tier: 2,
    laps: 1,
    balloons: [
      ...slalom(6, 0.05, 0.26, 0.66),
      ...outside(3, 0.34, 0.44, 0.78),
      ...slalom(6, 0.52, 0.78, 0.6),
      ...outside(3, 0.85, 0.96, -0.72),
    ],
  },
  {
    id: "skill-crucible",
    name: "Crucible Gauntlet",
    trackId: "crucible",
    classId: "gt",
    tier: 3,
    laps: 1,
    balloons: [
      ...slalom(9, 0.03, 0.34, 0.68),
      ...outside(4, 0.4, 0.52, -0.76),
      ...slalom(7, 0.58, 0.8, 0.6),
      ...outside(4, 0.86, 0.97, 0.74),
    ],
  },
  {
    id: "skill-grand",
    name: "Grand Circuit Gauntlet",
    trackId: "grand",
    classId: "formula",
    tier: 3,
    laps: 1,
    balloons: [
      ...slalom(8, 0.03, 0.32, 0.7),
      ...outside(4, 0.38, 0.5, 0.8),
      ...slalom(6, 0.56, 0.74, 0.6),
      ...outside(4, 0.8, 0.95, -0.75),
    ],
  },
];

export interface Balloon {
  pos: Vec2;
  popped: boolean;
}

/** Resolve authored specs into world positions on a specific circuit. */
export function placeBalloons(track: Track, specs: BalloonSpec[]): Balloon[] {
  return specs.map((b) => {
    const smp = track.sampleAt(b.t * track.length);
    return {
      pos: vadd(smp.pos, vscale(smp.nor, b.lat * (track.halfWidth - 2.2))),
      popped: false,
    };
  });
}

/** Radius in metres within which a car pops a balloon. */
export const BALLOON_RADIUS = 3.4;

export const skillById = (id: string): SkillEvent | undefined =>
  SKILL_EVENTS.find((e) => e.id === id);
