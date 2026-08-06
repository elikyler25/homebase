// The drawn racing line: raw pointer samples in, an arc-length-parameterised
// path with a target speed at every node out.
//
// The one rule that makes DrawRace work: how fast your finger moved over a
// stretch of track is how fast the car wants to be there. Everything else
// (grip, slip, going wide) is the physics answering back.

import { Vec2, clamp, lerp, vdist, vnorm, vsub } from "./math";

export interface RawSample {
  p: Vec2;
  /** Milliseconds, monotonic. */
  t: number;
}

export interface LineNode {
  pos: Vec2;
  tan: Vec2;
  s: number;
  /** Target speed the player asked for here, m/s. */
  speed: number;
  /** Signed curvature of the line itself, 1/m. Positive turns toward the left normal. */
  curv: number;
}

/**
 * Finger metres-per-second -> car metres-per-second.
 *
 * This constant is more meaningful than it looks. Since both the stroke and the
 * lap cover the same path, the gain is exactly the ratio of how long you spend
 * drawing to how long the race then takes: draw a lap in 5 s at gain 0.3 and the
 * car takes ~17 s to do it. It is also device-independent — a bigger screen
 * scales the path length and the finger's world speed by the same factor.
 */
export const DRAW_SPEED_GAIN = 0.3;
/** Never let the car fully stall, or a hesitant stroke becomes a dead race. */
export const MIN_DRAW_SPEED = 3.5;

const NODE_STEP = 1.5; // metres between line nodes

export class RacingLine {
  nodes: LineNode[] = [];
  length = 0;
  /**
   * A closed line loops: arc length wraps, so lap two re-runs the same stroke
   * without the car falling off the end of its own path.
   */
  closed = false;

  static fromNodes(pts: Vec2[], speeds: number[], closed = false): RacingLine {
    const line = new RacingLine();
    line.closed = closed;
    line.build(closed ? [...pts, pts[0]] : pts, closed ? [...speeds, speeds[0]] : speeds);
    return line;
  }

  /**
   * Build from raw pointer input. `maxSpeed` clamps to the car's top speed so a
   * frantic swipe cannot exceed what the machinery can actually do.
   */
  static fromInput(
    raw: RawSample[],
    maxSpeed: number,
    brake: number,
    closed = true,
  ): RacingLine {
    if (raw.length < 2) return new RacingLine();

    // 1. Per-sample finger speed, in world metres per second.
    const rawSpeed: number[] = new Array(raw.length).fill(0);
    for (let i = 1; i < raw.length; i++) {
      const dt = Math.max(1, raw[i].t - raw[i - 1].t) / 1000;
      rawSpeed[i] = vdist(raw[i].p, raw[i - 1].p) / dt;
    }
    rawSpeed[0] = rawSpeed[1] ?? 0;

    // 2. Smooth it. Fingers are jittery and touch sampling is uneven; without
    //    this the speed profile is a sawtooth and the car pumps the throttle.
    const smoothSpeed = movingAverage(rawSpeed, 5);

    // 3. Smooth positions too, lightly — jitter reads as curvature otherwise,
    //    and curvature is what the grip budget is spent on.
    const pts = smoothPositions(raw.map((r) => r.p), 5);

    const speeds = smoothSpeed.map((sp) =>
      clamp(sp * DRAW_SPEED_GAIN, MIN_DRAW_SPEED, maxSpeed),
    );

    const line = new RacingLine();
    line.closed = closed;
    if (closed) {
      // Rejoin the stroke to its own start so the seam at start/finish carries
      // the player's speed through instead of dropping to a stop.
      pts.push(pts[0]);
      speeds.push(speeds[0]);
    }
    line.build(pts, speeds);
    line.applyBrakingFeasibility(brake);
    return line;
  }

  /**
   * Lower speeds ahead of slower ones until the profile is actually reachable
   * under braking.
   *
   * Without this the player is quietly asked to do arithmetic no person can do
   * while drawing: to slow their finger far enough *before* a corner that the
   * car's deceleration limit happens to land it at the right entry speed. What
   * a real finger does instead is slow down AT the corner — so the car arrived
   * far too fast, understeered the whole way through, and ploughed wide. The
   * measured cost was brutal: a realistic stroke slid 24-30 s per race against
   * the AI's 0-3 s and finished last on every single track, because the AI's
   * profile gets exactly this pass and the player's did not.
   *
   * This only ever *reduces* speed, and only before a point that is already
   * slower, so it never hands out pace the player did not ask for. Choosing how
   * fast to take a corner is still entirely the player's problem — this just
   * stops the car being late to the braking zone the player clearly intended.
   */
  private applyBrakingFeasibility(brake: number): void {
    const n = this.nodes.length;
    if (n < 3 || brake <= 0) return;
    // Three wrapped passes settle a closed loop; the seam node is the same
    // point as node 0, so it has to be re-tied before each pass.
    for (let pass = 0; pass < 3; pass++) {
      if (this.closed) this.nodes[n - 1].speed = this.nodes[0].speed;
      for (let i = n - 2; i >= 0; i--) {
        const ds = this.nodes[i + 1].s - this.nodes[i].s;
        if (ds <= 0) continue;
        const reachable = Math.sqrt(
          this.nodes[i + 1].speed * this.nodes[i + 1].speed + 2 * brake * ds,
        );
        if (this.nodes[i].speed > reachable) this.nodes[i].speed = reachable;
      }
      if (!this.closed) break;
    }
  }

  /** Resample an arbitrary polyline + per-point speeds onto uniform nodes. */
  private build(pts: Vec2[], speeds: number[]): void {
    if (pts.length < 2) return;

    const cum: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + vdist(pts[i], pts[i - 1]));
    }
    const total = cum[cum.length - 1];
    if (total < 1) return;

    const count = Math.max(2, Math.round(total / NODE_STEP));
    let seg = 0;
    for (let k = 0; k <= count; k++) {
      const target = (k / count) * total;
      while (seg < cum.length - 2 && cum[seg + 1] < target) seg++;
      const segLen = cum[seg + 1] - cum[seg];
      const t = segLen > 1e-9 ? (target - cum[seg]) / segLen : 0;
      this.nodes.push({
        pos: {
          x: lerp(pts[seg].x, pts[seg + 1].x, t),
          y: lerp(pts[seg].y, pts[seg + 1].y, t),
        },
        tan: { x: 0, y: 0 },
        s: target,
        speed: lerp(speeds[seg] ?? 0, speeds[seg + 1] ?? speeds[seg] ?? 0, t),
        curv: 0,
      });
    }
    this.length = total;

    const n = this.nodes.length;
    for (let i = 0; i < n; i++) {
      const ia = this.closed ? (i - 1 + n) % n : Math.max(0, i - 1);
      const ib = this.closed ? (i + 1) % n : Math.min(n - 1, i + 1);
      this.nodes[i].tan = vnorm(vsub(this.nodes[ib].pos, this.nodes[ia].pos));
    }

    // Signed curvature of the line, from the rate the tangent turns. The vehicle
    // uses this as steering feedforward, so it is smoothed: a drawn line carries
    // finger noise, and noise here becomes phantom steering demand.
    const raw = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      const ia = this.closed ? (i - 1 + n) % n : Math.max(0, i - 1);
      const ib = this.closed ? (i + 1) % n : Math.min(n - 1, i + 1);
      const a = this.nodes[ia].tan;
      const b = this.nodes[ib].tan;
      const dTheta = Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
      const ds = vdist(this.nodes[ib].pos, this.nodes[ia].pos) || 1e-6;
      raw[i] = dTheta / ds;
    }
    for (let i = 0; i < n; i++) {
      let acc = 0;
      let cnt = 0;
      for (let k = -4; k <= 4; k++) {
        const j = this.closed ? (i + k + n) % n : i + k;
        if (j < 0 || j >= n) continue;
        acc += raw[j];
        cnt++;
      }
      this.nodes[i].curv = acc / Math.max(1, cnt);
    }
  }

  /** Wrap (closed) or clamp (open) an arc length into range. */
  private wrapS(s: number): number {
    if (!this.closed) return clamp(s, 0, this.length);
    const L = this.length || 1;
    return ((s % L) + L) % L;
  }

  get valid(): boolean {
    return this.nodes.length > 8 && this.length > 20;
  }

  /** Interpolated state at arc length `s`, clamped to the ends. */
  at(s: number): { pos: Vec2; tan: Vec2; speed: number; curv: number } {
    const n = this.nodes;
    if (n.length === 0) {
      return { pos: { x: 0, y: 0 }, tan: { x: 1, y: 0 }, speed: 0, curv: 0 };
    }
    const fi = (this.wrapS(s) / this.length) * (n.length - 1);
    const i = clamp(Math.floor(fi), 0, n.length - 2);
    const t = fi - i;
    const a = n[i];
    const b = n[i + 1];
    return {
      pos: { x: lerp(a.pos.x, b.pos.x, t), y: lerp(a.pos.y, b.pos.y, t) },
      tan: vnorm({ x: lerp(a.tan.x, b.tan.x, t), y: lerp(a.tan.y, b.tan.y, t) }),
      speed: lerp(a.speed, b.speed, t),
      curv: lerp(a.curv, b.curv, t),
    };
  }

  /**
   * Nearest arc length to `p`, searched in a window around `hintS`.
   *
   * Deliberately local: a drawn line can cross itself, and a global nearest
   * search would teleport the car to the wrong branch at every intersection.
   */
  nearestS(p: Vec2, hintS: number, forward = 14, back = 6): number {
    const n = this.nodes;
    if (n.length < 2) return 0;
    const segCount = n.length - 1;
    const perNode = this.length / segCount;
    const hintIdx = Math.round(this.wrapS(hintS) / perNode);
    // Asymmetric and tight. A car travels forward along its line, so a wide
    // symmetric window buys nothing and costs correctness: when the car slides
    // well off the path, a distant branch can become the global nearest point
    // and progress teleports. Bounding how far the search may look keeps
    // re-acquisition local — a lost car crawls back on, it does not warp.
    const spanF = Math.max(2, Math.round(forward / perNode));
    const spanB = Math.max(2, Math.round(back / perNode));

    let bestS = this.wrapS(hintS);
    let bestD = Infinity;
    for (let k = -spanB; k <= spanF; k++) {
      let i = hintIdx + k;
      if (this.closed) {
        i = ((i % segCount) + segCount) % segCount;
      } else if (i < 0 || i >= segCount) {
        continue;
      }
      const a = n[i].pos;
      const b = n[i + 1].pos;
      const ab = vsub(b, a);
      const len2 = ab.x * ab.x + ab.y * ab.y;
      if (len2 < 1e-9) continue;
      const t = clamp(((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / len2, 0, 1);
      const cx = a.x + ab.x * t;
      const cy = a.y + ab.y * t;
      const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
      if (d < bestD) {
        bestD = d;
        bestS = n[i].s + (n[i + 1].s - n[i].s) * t;
      }
    }
    // Always in [0, length) for a closed line. Callers use this only as a search
    // hint and as a base for lookahead, and `at()` wraps, so there is nothing to
    // gain from tracking an ever-growing unwrapped value.
    return bestS;
  }

  /** Peak speed across the line, for normalising the line's colour ramp. */
  get maxSpeed(): number {
    let m = 0;
    for (const nd of this.nodes) m = Math.max(m, nd.speed);
    return m || 1;
  }

  get minSpeed(): number {
    let m = Infinity;
    for (const nd of this.nodes) m = Math.min(m, nd.speed);
    return isFinite(m) ? m : 0;
  }
}

function movingAverage(xs: number[], radius: number): number[] {
  const out = new Array(xs.length);
  for (let i = 0; i < xs.length; i++) {
    let acc = 0;
    let n = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= xs.length) continue;
      acc += xs[j];
      n++;
    }
    out[i] = acc / Math.max(1, n);
  }
  return out;
}

function smoothPositions(pts: Vec2[], passes: number): Vec2[] {
  let cur = pts;
  for (let p = 0; p < passes; p++) {
    const next: Vec2[] = [cur[0]];
    for (let i = 1; i < cur.length - 1; i++) {
      next.push({
        x: (cur[i - 1].x + cur[i].x * 2 + cur[i + 1].x) / 4,
        y: (cur[i - 1].y + cur[i].y * 2 + cur[i + 1].y) / 4,
      });
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}
