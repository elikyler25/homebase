// Track geometry: a closed Catmull-Rom centreline, resampled at uniform arc
// length, plus a spatial grid so "where am I on the track?" is O(1) per query
// (the physics step asks that for every car, every tick).

import {
  Vec2,
  catmullRom,
  clamp,
  vadd,
  vdist2,
  vlen,
  vnorm,
  vperp,
  vscale,
  vsub,
} from "./math";

export type SurfaceId = "asphalt" | "gravel" | "ice";

/** What the tyres are standing on. Off-track is one of these too. */
export interface SurfaceProps {
  id: string;
  /** Peak tyre friction coefficient. Scales the whole grip budget. */
  grip: number;
  /** Rolling resistance, m/s^2. */
  drag: number;
  /** How much the car keeps sliding once it breaks traction (0 = snappy, 1 = floaty). */
  slide: number;
}

export interface Surface extends SurfaceProps {
  id: SurfaceId;
  name: string;
}

export const SURFACES: Record<SurfaceId, Surface> = {
  asphalt: { id: "asphalt", grip: 1.0, drag: 0.35, slide: 0.28, name: "Asphalt" },
  gravel: { id: "gravel", grip: 0.82, drag: 1.1, slide: 0.55, name: "Gravel" },
  ice: { id: "ice", grip: 0.56, drag: 0.22, slide: 0.86, name: "Ice" },
};

/** Off-track is deliberately miserable: this is the cost of a sloppy line. */
export const OFFTRACK: SurfaceProps = {
  id: "offtrack",
  grip: 0.38,
  drag: 5.2,
  slide: 0.7,
};

export interface TrackDef {
  id: string;
  name: string;
  surface: SurfaceId;
  /** Half-width in metres is derived from this. */
  width: number;
  /** Closed loop of control points, metres. */
  points: [number, number][];
  laps: number;
  /** Which car classes may enter. First entry is the default. */
  classes: string[];
  /**
   * Medal thresholds as multipliers of the reference time — the race time a
   * perfectly-driven ideal line would set, simulated at load. Self-calibrating,
   * so retuning the physics never leaves a track with impossible golds.
   */
  medals: { gold: number; silver: number; bronze: number };
}

export interface TrackSample {
  pos: Vec2;
  /** Unit tangent, direction of travel. */
  tan: Vec2;
  /** Unit left normal. */
  nor: Vec2;
  /** Cumulative arc length at this sample. */
  s: number;
  /** Signed curvature, 1/m. Positive = turning left. */
  curv: number;
}

const RESAMPLE_STEP = 1.0; // metres between centreline samples
const GRID_CELL = 10; // metres

export class Track {
  readonly def: TrackDef;
  readonly surface: Surface;
  readonly samples: TrackSample[] = [];
  readonly length: number;
  readonly halfWidth: number;
  readonly left: Vec2[] = [];
  readonly right: Vec2[] = [];
  readonly bounds: { min: Vec2; max: Vec2 };

  private grid = new Map<number, number[]>();
  private gridOrigin: Vec2;
  private gridCols = 0;

  constructor(def: TrackDef) {
    this.def = def;
    this.surface = SURFACES[def.surface];
    this.halfWidth = def.width / 2;

    const dense = this.tessellate(def.points);
    this.length = this.resample(dense);
    this.computeFrames();

    for (const smp of this.samples) {
      this.left.push(vadd(smp.pos, vscale(smp.nor, this.halfWidth)));
      this.right.push(vadd(smp.pos, vscale(smp.nor, -this.halfWidth)));
    }

    const min = { x: Infinity, y: Infinity };
    const max = { x: -Infinity, y: -Infinity };
    for (const p of [...this.left, ...this.right]) {
      min.x = Math.min(min.x, p.x);
      min.y = Math.min(min.y, p.y);
      max.x = Math.max(max.x, p.x);
      max.y = Math.max(max.y, p.y);
    }
    this.bounds = { min, max };
    this.gridOrigin = { x: min.x - GRID_CELL, y: min.y - GRID_CELL };
    this.buildGrid();
  }

  /** Subdivide each control-point segment finely; arc length comes later. */
  private tessellate(pts: [number, number][]): Vec2[] {
    const cp = pts.map(([x, y]) => ({ x, y }));
    const n = cp.length;
    const out: Vec2[] = [];
    const SUB = 48;
    for (let i = 0; i < n; i++) {
      const p0 = cp[(i - 1 + n) % n];
      const p1 = cp[i];
      const p2 = cp[(i + 1) % n];
      const p3 = cp[(i + 2) % n];
      for (let j = 0; j < SUB; j++) {
        out.push(catmullRom(p0, p1, p2, p3, j / SUB));
      }
    }
    return out;
  }

  /** Walk the dense polyline emitting a sample every RESAMPLE_STEP metres. */
  private resample(dense: Vec2[]): number {
    const n = dense.length;
    let total = 0;
    const segLen: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      segLen[i] = vlen(vsub(dense[(i + 1) % n], dense[i]));
      total += segLen[i];
    }

    const count = Math.max(16, Math.round(total / RESAMPLE_STEP));
    const step = total / count;

    let seg = 0;
    let segPos = 0;
    for (let k = 0; k < count; k++) {
      const target = k * step;
      // advance to the segment containing `target`
      let walked = 0;
      // recompute cumulative lazily: keep a running pointer instead
      walked = segPos;
      while (seg < n && walked + segLen[seg] < target) {
        walked += segLen[seg];
        seg++;
      }
      segPos = walked;
      const s = seg % n;
      const t = segLen[s] > 1e-9 ? (target - walked) / segLen[s] : 0;
      const a = dense[s];
      const b = dense[(s + 1) % n];
      this.samples.push({
        pos: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        tan: { x: 0, y: 0 },
        nor: { x: 0, y: 0 },
        s: target,
        curv: 0,
      });
    }
    return total;
  }

  /** Tangent, normal and signed curvature via central differences. */
  private computeFrames(): void {
    const n = this.samples.length;
    for (let i = 0; i < n; i++) {
      const prev = this.samples[(i - 1 + n) % n].pos;
      const next = this.samples[(i + 1) % n].pos;
      const tan = vnorm(vsub(next, prev));
      this.samples[i].tan = tan;
      this.samples[i].nor = vperp(tan);
    }
    for (let i = 0; i < n; i++) {
      const a = this.samples[(i - 1 + n) % n].tan;
      const b = this.samples[(i + 1) % n].tan;
      const dTheta = Math.atan2(
        a.x * b.y - a.y * b.x,
        a.x * b.x + a.y * b.y,
      );
      const ds =
        vlen(vsub(this.samples[(i + 1) % n].pos, this.samples[(i - 1 + n) % n].pos)) ||
        1e-6;
      this.samples[i].curv = dTheta / ds;
    }
    // A little smoothing: raw curvature from a resampled polyline is noisy and
    // the AI speed profile reads it directly.
    const raw = this.samples.map((s) => s.curv);
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = -3; k <= 3; k++) acc += raw[(i + k + n) % n];
      this.samples[i].curv = acc / 7;
    }
  }

  private cellKey(cx: number, cy: number): number {
    return cy * this.gridCols + cx;
  }

  private buildGrid(): void {
    const w = this.bounds.max.x - this.gridOrigin.x + GRID_CELL * 2;
    const h = this.bounds.max.y - this.gridOrigin.y + GRID_CELL * 2;
    this.gridCols = Math.max(1, Math.ceil(w / GRID_CELL));
    const rows = Math.max(1, Math.ceil(h / GRID_CELL));
    for (let i = 0; i < this.samples.length; i++) {
      const p = this.samples[i].pos;
      const cx = clamp(Math.floor((p.x - this.gridOrigin.x) / GRID_CELL), 0, this.gridCols - 1);
      const cy = clamp(Math.floor((p.y - this.gridOrigin.y) / GRID_CELL), 0, rows - 1);
      const key = this.cellKey(cx, cy);
      let bucket = this.grid.get(key);
      if (!bucket) this.grid.set(key, (bucket = []));
      bucket.push(i);
    }
  }

  /**
   * Nearest centreline sample to `p`. Searches expanding rings of grid cells
   * and falls back to a linear scan if the point is far outside the track.
   */
  nearestIndex(p: Vec2): number {
    const cx = Math.floor((p.x - this.gridOrigin.x) / GRID_CELL);
    const cy = Math.floor((p.y - this.gridOrigin.y) / GRID_CELL);
    let best = -1;
    let bestD = Infinity;
    for (let ring = 0; ring <= 4; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          // only the shell of the ring
          if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
          const bucket = this.grid.get(this.cellKey(cx + dx, cy + dy));
          if (!bucket) continue;
          for (const i of bucket) {
            const d = vdist2(this.samples[i].pos, p);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          }
        }
      }
      if (best >= 0 && ring >= 1) return best;
    }
    if (best >= 0) return best;
    for (let i = 0; i < this.samples.length; i++) {
      const d = vdist2(this.samples[i].pos, p);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /**
   * Project a world point onto the centreline.
   * `lateral` is signed: positive to the left of the direction of travel.
   */
  project(p: Vec2): { index: number; s: number; lateral: number; onTrack: boolean } {
    const i = this.nearestIndex(p);
    const smp = this.samples[i];
    const d = vsub(p, smp.pos);
    const along = d.x * smp.tan.x + d.y * smp.tan.y;
    const lateral = d.x * smp.nor.x + d.y * smp.nor.y;
    let s = smp.s + along;
    if (s < 0) s += this.length;
    if (s >= this.length) s -= this.length;
    return { index: i, s, lateral, onTrack: Math.abs(lateral) <= this.halfWidth };
  }

  sampleAt(s: number): TrackSample {
    const n = this.samples.length;
    let idx = Math.floor((((s % this.length) + this.length) % this.length) / this.length * n);
    idx = clamp(idx, 0, n - 1);
    return this.samples[idx];
  }

  /** Shortest signed distance from a to b around the loop. */
  wrapDelta(a: number, b: number): number {
    let d = b - a;
    while (d > this.length / 2) d -= this.length;
    while (d < -this.length / 2) d += this.length;
    return d;
  }

  get startPos(): Vec2 {
    return this.samples[0].pos;
  }

  get startTan(): Vec2 {
    return this.samples[0].tan;
  }
}
