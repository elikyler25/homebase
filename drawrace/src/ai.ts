// Opponent racing lines.
//
// The AI does not cheat and does not use a separate driving model. It gets a
// RacingLine exactly like the player's — a path plus a target speed at every
// point — and is then handed to the same Vehicle simulation. A skill level is
// just how much of the grip budget the line was planned against, so a rookie
// line is genuinely a slower line rather than a fast car with a handbrake on.

import { RacingLine } from "./line";
import { Vec2, clamp, makeRng, vadd, vdist, vlen, vscale, vsub } from "./math";
import { Track } from "./track";
import { CarClass } from "./vehicle";

const G = 9.81;

/** Headroom left to the path-follower when planning a speed profile. */
const PLAN_MARGIN = 0.85;

export interface AiDriver {
  name: string;
  skill: number;
  colour: string;
}

export const DRIVER_POOL: AiDriver[] = [
  { name: "Aalto", skill: 0.75, colour: "#c084fc" },
  { name: "Bergman", skill: 0.70, colour: "#34d399" },
  { name: "Costa", skill: 0.65, colour: "#fb923c" },
  { name: "Duval", skill: 0.60, colour: "#60a5fa" },
  { name: "Eskola", skill: 0.55, colour: "#f472b6" },
  { name: "Falk", skill: 0.50, colour: "#a3e635" },
];

/**
 * Iteratively relax a line toward minimum curvature inside the track edges.
 * Smoothing positions and re-projecting onto the track normal is a cheap
 * stand-in for a proper optimiser and converges to a recognisably racing line:
 * out wide on entry, tight to the apex, out again on exit.
 */
export function optimiseLine(
  track: Track,
  margin: number,
  iterations = 900,
  jitterSeed = 0,
  jitterAmount = 0,
): Vec2[] {
  const n = track.samples.length;
  const maxOff = Math.max(0.5, track.halfWidth - margin);
  const offsets = new Float64Array(n);

  if (jitterAmount > 0) {
    const rng = makeRng(jitterSeed || 1);
    // Low-frequency wobble so each driver commits to a slightly different line
    // rather than looking noisy corner to corner.
    const harmonics = 4;
    const amp: number[] = [];
    const phase: number[] = [];
    for (let h = 0; h < harmonics; h++) {
      amp.push((rng() * 2 - 1) * jitterAmount);
      phase.push(rng() * Math.PI * 2);
    }
    for (let i = 0; i < n; i++) {
      let o = 0;
      for (let h = 0; h < harmonics; h++) {
        o += amp[h] * Math.sin(((i / n) * (h + 1) * Math.PI * 2) + phase[h]);
      }
      offsets[i] = clamp(o, -maxOff, maxOff);
    }
  }

  const posAt = (i: number): Vec2 => {
    const s = track.samples[(i + n) % n];
    return vadd(s.pos, vscale(s.nor, offsets[(i + n) % n]));
  };

  for (let iter = 0; iter < iterations; iter++) {
    const relax = 0.35;
    for (let i = 0; i < n; i++) {
      const prev = posAt(i - 1);
      const next = posAt(i + 1);
      const mid = { x: (prev.x + next.x) / 2, y: (prev.y + next.y) / 2 };
      const smp = track.samples[i];
      const desired = vsub(mid, smp.pos).x * smp.nor.x + vsub(mid, smp.pos).y * smp.nor.y;
      offsets[i] = clamp(
        offsets[i] + (desired - offsets[i]) * relax,
        -maxOff,
        maxOff,
      );
    }
  }

  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) out.push(posAt(i));
  return containLine(track, out, margin);
}

/**
 * Force a line back inside the track edges.
 *
 * The offset representation above only guarantees a point is within half-width
 * of *its own* centreline sample. Where the track turns sharply the normals of
 * neighbouring samples cross, and a point that looks legal against sample i can
 * be well outside the tarmac measured against sample j — which is how the
 * optimiser was driving the reference line off a technical circuit. Re-project
 * against the real nearest sample and clamp, which is the same test the physics
 * uses to decide what surface a car is on.
 */
function containLine(track: Track, pts: Vec2[], margin: number): Vec2[] {
  const limit = Math.max(0.4, track.halfWidth - margin);
  const out = pts.map((p) => ({ ...p }));
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      const proj = track.project(out[i]);
      if (Math.abs(proj.lateral) <= limit) continue;
      const smp = track.samples[proj.index];
      const clamped = clamp(proj.lateral, -limit, limit);
      out[i] = vadd(smp.pos, vscale(smp.nor, clamped));
      moved = true;
    }
    if (!moved) break;
    // Clamping introduces kinks; a light smoothing pass keeps the curvature
    // estimate (and therefore the speed profile) sane.
    const prev = out.map((p) => ({ ...p }));
    const n = out.length;
    for (let i = 0; i < n; i++) {
      const a = prev[(i - 1 + n) % n];
      const b = prev[i];
      const c = prev[(i + 1) % n];
      out[i] = {
        x: (a.x + b.x * 2 + c.x) / 4,
        y: (a.y + b.y * 2 + c.y) / 4,
      };
    }
  }
  // Final hard clamp — smoothing must not be the last word on legality.
  for (let i = 0; i < out.length; i++) {
    const proj = track.project(out[i]);
    if (Math.abs(proj.lateral) > limit) {
      const smp = track.samples[proj.index];
      out[i] = vadd(smp.pos, vscale(smp.nor, clamp(proj.lateral, -limit, limit)));
    }
  }
  return out;
}

/** Signed curvature of a closed polyline, 1/m, smoothed. */
function curvatureOf(pts: Vec2[]): number[] {
  const n = pts.length;
  const raw = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const ab = vsub(b, a);
    const bc = vsub(c, b);
    const cross = ab.x * bc.y - ab.y * bc.x;
    const la = vlen(ab);
    const lb = vlen(bc);
    const lc = vdist(a, c);
    const denom = la * lb * lc;
    raw[i] = denom > 1e-6 ? (2 * cross) / denom : 0;
  }
  // Light mean to kill sampling noise...
  const smoothed = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -2; k <= 2; k++) acc += raw[(i + k + n) % n];
    smoothed[i] = acc / 5;
  }
  // ...then a local *maximum*, because a speed profile is a limit, not an
  // average. Averaging over a wide window flattens the apex of a tight corner,
  // the planner concludes the hairpin is gentler than it is, and the fastest
  // lines end up the least drivable ones.
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (let k = -3; k <= 3; k++) {
      const c = smoothed[(i + k + n) % n];
      if (Math.abs(c) > Math.abs(peak)) peak = c;
    }
    out[i] = peak;
  }
  return out;
}

/**
 * Speed profile for a path: cornering limit from curvature, then backward and
 * forward passes so braking and acceleration are physically reachable.
 */
export function speedProfile(
  pts: Vec2[],
  car: CarClass,
  surfaceGrip: number,
  skill: number,
): number[] {
  const n = pts.length;
  const curv = curvatureOf(pts);
  // Plan below the true limit. The profile is computed from the curvature of
  // the *path*, but a car following that path has tracking error, so its real
  // instantaneous curvature is always a little higher. Planning at 100% makes
  // the follower understeer for the whole lap — and inverts the skill ordering,
  // because the highest-skill line becomes the least drivable one.
  const aMax = car.grip * surfaceGrip * G * skill * PLAN_MARGIN;

  const ds = new Array<number>(n);
  for (let i = 0; i < n; i++) ds[i] = vdist(pts[i], pts[(i + 1) % n]) || 0.01;

  const vmax = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const k = Math.abs(curv[i]);
    const corner = k > 1e-5 ? Math.sqrt(aMax / k) : Infinity;
    vmax[i] = Math.min(corner, car.maxSpeed * skill);
  }

  // Two wrapped passes settle the loop; a third changes nothing measurable.
  for (let pass = 0; pass < 3; pass++) {
    // Braking: you must already be slow enough for the corner ahead.
    for (let i = n - 1; i >= 0; i--) {
      const j = (i + 1) % n;
      const reachable = Math.sqrt(vmax[j] * vmax[j] + 2 * car.brake * skill * ds[i]);
      vmax[i] = Math.min(vmax[i], reachable);
    }
    // Power: you cannot be faster than what the engine could have built up to.
    for (let i = 0; i < n; i++) {
      const j = (i - 1 + n) % n;
      const engineHere =
        car.accel * Math.max(0.15, 1 - (vmax[j] / car.maxSpeed) ** 2);
      const reachable = Math.sqrt(vmax[j] * vmax[j] + 2 * engineHere * ds[j]);
      vmax[i] = Math.min(vmax[i], reachable);
    }
  }
  return vmax;
}

/** Build a complete, race-ready line for one opponent. */
export function buildAiLine(
  track: Track,
  car: CarClass,
  skill: number,
  seed: number,
): RacingLine {
  const jitter = (1 - skill) * track.halfWidth * 0.45;
  const pts = optimiseLine(track, car.radius + 2.0, 900, seed, jitter);
  const speeds = speedProfile(pts, car, track.surface.grip, skill);
  return RacingLine.fromNodes(pts, speeds, true);
}

/**
 * The reference line: perfectly optimised, full grip. Its simulated race time
 * is what medal thresholds are scaled from, so retuning the physics retunes
 * the medals with it.
 */
export function buildReferenceLine(track: Track, car: CarClass): RacingLine {
  const pts = optimiseLine(track, car.radius + 2.0, 1200, 0, 0);
  // Plan at slightly under the limit. A line planned at exactly 100% of grip
  // leaves the path-follower no margin for its own tracking error, so the
  // "ideal" car spends the lap understeering and sets a poor reference.
  const speeds = speedProfile(pts, car, track.surface.grip, 0.95);
  return RacingLine.fromNodes(pts, speeds, true);
}
