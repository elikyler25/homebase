// The ghost: your own best lap, saved and replayed alongside you.
//
// What gets stored is the *line*, not a recording of positions. A drawn line
// already carries a speed at every node, and the physics is deterministic, so
// re-running the stored line reproduces the lap while costing a fraction of what
// a per-frame position trace would. It also means the ghost stays valid if the
// physics is retuned — it re-drives your stroke under the new rules rather than
// sliding along a path the car can no longer take.
//
// Turbo is the one thing the line does not carry, because it is tapped live. So
// the distances at which it was deployed are stored too; without them the ghost
// would replay your best lap several tenths slower than the time next to it.

import { RacingLine } from "./line";
import { Vec2 } from "./math";

/**
 * Nodes are 1.5 m apart, which is far finer than a ghost needs. Keeping every
 * fourth puts a 550 m lap at ~90 points — around 1.5 kB of JSON — and
 * localStorage has to hold one per circuit-and-class the player has raced.
 */
const DECIMATE = 4;

export interface GhostData {
  /** Flat [x, y, speed, ...], one decimal place. */
  p: number[];
  /** Distances travelled, in metres, at which turbo was deployed. */
  b?: number[];
}

export function encodeGhost(line: RacingLine, turboAt: number[]): GhostData | null {
  const n = line.nodes.length;
  if (n < 12) return null;
  const p: number[] = [];
  // Drop the final node of a closed line: it duplicates the first, and
  // fromNodes re-closes the loop itself.
  const last = line.closed ? n - 1 : n;
  for (let i = 0; i < last; i += DECIMATE) {
    const nd = line.nodes[i];
    p.push(round1(nd.pos.x), round1(nd.pos.y), round1(nd.speed));
  }
  if (p.length < 24) return null;
  return { p, b: turboAt.map(round1) };
}

export function decodeGhost(data: GhostData | undefined): {
  line: RacingLine;
  turboAt: number[];
} | null {
  const p = data?.p;
  if (!p || p.length < 24 || p.length % 3 !== 0) return null;
  const pts: Vec2[] = [];
  const speeds: number[] = [];
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i];
    const y = p[i + 1];
    const sp = p[i + 2];
    if (!isFinite(x) || !isFinite(y) || !isFinite(sp)) return null;
    pts.push({ x, y });
    speeds.push(sp);
  }
  const line = RacingLine.fromNodes(pts, speeds, true);
  if (!line.valid) return null;
  const turboAt = (data?.b ?? []).filter((v) => isFinite(v)).sort((a, b) => a - b);
  return { line, turboAt };
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
