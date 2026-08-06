// Slots cut into the track.
//
// A slot is a fixed lane: a constant lateral offset from the centreline that a
// car is pinned to. It cannot steer, so the only decision left is the throttle,
// and the only failure is asking a corner for more than the guide pin and tyres
// can hold — at which point the car deslots and a marshal has to put it back.
//
// The geometry that matters is the offset curve. For a centreline point `p` with
// left normal `n` and signed curvature `k` (positive turns left), the lane at
// offset `d` along `n` sits at `p + d*n`, and:
//
//   curvature   k_d = k / (1 - k*d)
//   arc length  ds_d = (1 - k*d) * ds
//
// So the inside lane of a corner is shorter but tighter, and the outside lane is
// longer but faster. Over a lap with corners both ways that mostly cancels, and
// what is left is a real trade rather than a handicap — `npm run slottune`
// asserts no lane is more than a few percent off the others.

import { Vec2, vadd, vscale } from "../math";
import { Track, TrackSample } from "../track";

/** How much of the road to leave outside the outermost slots, in metres. */
const EDGE_MARGIN = 3.2;

export interface Lane {
  /** Lateral offset from the centreline, metres along the left normal. */
  offset: number;
  /** Total length of this lane's lap, metres. */
  length: number;
  /** Index, 0 = leftmost. */
  index: number;
}

/**
 * Evenly spaced slots across the road.
 *
 * Slots are laid out from the left edge inward. Two slots on a narrow circuit
 * would sit almost on the centreline and look wrong, so the spacing is capped:
 * past a point, extra road becomes verge rather than wider spacing.
 */
export function makeLanes(track: Track, count: number): Lane[] {
  const usable = Math.max(0, track.halfWidth - EDGE_MARGIN);
  // Capped tighter than the road allows. Lane length differs by 2*pi times the
  // offset spread over a closed lap -- about 104 m across Ridgeway's four slots
  // at the old 5.5 m spacing -- and once the magnet went up, lap time started
  // tracking distance more closely than cornering, so that spread showed up as
  // a 7.5% advantage for the inside slot. Which lane you draw should not be the
  // race. At 4 m the spread is about 75 m and the gap is back under 6%.
  const spacing = Math.min((usable * 2) / Math.max(1, count - 1), 4.0);
  const first = -((count - 1) / 2) * spacing;
  const lanes: Lane[] = [];
  for (let i = 0; i < count; i++) {
    const offset = first + i * spacing;
    lanes.push({ offset, length: laneLength(track, offset), index: i });
  }
  return lanes;
}

/** Lap length of the lane at `offset`. */
export function laneLength(track: Track, offset: number): number {
  const n = track.samples.length;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = track.samples[i];
    const b = track.samples[(i + 1) % n];
    const ds = Math.abs(track.wrapDelta(a.s, b.s));
    total += ds * (1 - a.curv * offset);
  }
  return total;
}

/** Curvature of the lane at a centreline sample. */
export function laneCurv(smp: TrackSample, offset: number): number {
  const denom = 1 - smp.curv * offset;
  // A slot further from the centreline than the corner's radius would be inside
  // the centre of curvature, where the offset curve folds back on itself. No
  // circuit here comes close (the tightest fold radius is many times the road
  // width), but clamping keeps a bad track definition from producing infinities
  // rather than a visible, debuggable wrong shape.
  return smp.curv / Math.max(0.25, denom);
}

/** World position of the lane at a centreline sample. */
export function lanePos(smp: TrackSample, offset: number): Vec2 {
  return vadd(smp.pos, vscale(smp.nor, offset));
}

/** The lane as a closed point list, for the speed planner. */
export function lanePoints(track: Track, offset: number, step = 3): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < track.samples.length; i += step) {
    out.push(lanePos(track.samples[i], offset));
  }
  return out;
}
