// Small 2D vector / scalar helpers. World units are metres, angles radians.

export interface Vec2 {
  x: number;
  y: number;
}

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const vclone = (a: Vec2): Vec2 => ({ x: a.x, y: a.y });
export const vadd = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const vsub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const vscale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const vdot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
/** 2D cross product (z of the 3D cross). Sign gives turn direction. */
export const vcross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const vlen = (a: Vec2): number => Math.hypot(a.x, a.y);
export const vlen2 = (a: Vec2): number => a.x * a.x + a.y * a.y;
export const vdist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const vdist2 = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

export function vnorm(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

/** Rotate by `ang` radians (screen space: +y down, so this reads clockwise). */
export function vrot(a: Vec2, ang: number): Vec2 {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

/** Left-hand perpendicular. */
export const vperp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

export const vlerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const invLerp = (a: number, b: number, x: number): number =>
  Math.abs(b - a) < 1e-9 ? 0 : (x - a) / (b - a);

/** Smooth 0..1 ramp. */
export const smoothstep = (x: number): number => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Shortest signed angular difference b - a, wrapped to [-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Move `a` toward `b` by at most `maxStep` radians, taking the short way round. */
export function approachAngle(a: number, b: number, maxStep: number): number {
  const d = angleDiff(a, b);
  return a + clamp(d, -maxStep, maxStep);
}

/**
 * Frame-rate independent exponential smoothing.
 * `rate` is the fraction of the gap closed per second.
 */
export const damp = (a: number, b: number, rate: number, dt: number): number =>
  b + (a - b) * Math.exp(-rate * dt);

/** Deterministic PRNG so replays and AI lines are reproducible run to run. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    // xorshift32
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

/**
 * Catmull-Rom interpolation of four control points at parameter t in [0,1],
 * returning the point between p1 and p2.
 */
export function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

/** Format seconds as m:ss.mmm — race-timing style. */
export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "--:--.---";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec - m * 60);
  const ms = Math.floor((sec - Math.floor(sec)) * 1000);
  return `${m}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
}

/** Format a gap like +1.234 / -0.512. */
export function formatGap(sec: number): string {
  if (!isFinite(sec)) return "--";
  const sign = sec >= 0 ? "+" : "-";
  return `${sign}${Math.abs(sec).toFixed(3)}`;
}
