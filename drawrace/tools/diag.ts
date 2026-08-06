// Isolates WHY a player's stroke slides so much more than an AI line.
//
// The AI differs from a player in two independent ways: it drives a better
// PATH (minimum-curvature, apex-hugging) and it drives a better SPEED PROFILE
// (planned against a margin, feasible under braking). This walks the four
// combinations so the blame lands on one of them instead of both.

import { buildAiLine, optimiseLine, speedProfile } from "../src/ai";
import { RacingLine } from "../src/line";
import { Vec2, vadd, vscale } from "../src/math";
import { PHYS_DT } from "../src/race";
import { Track } from "../src/track";
import { TRACKS } from "../src/tracks";
import { CAR_CLASSES, CarClass, Vehicle } from "../src/vehicle";

function centrelinePath(track: Track, bias: number, wobble: number): Vec2[] {
  const n = track.samples.length;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const smp = track.samples[i];
    const b = Math.sign(smp.curv) * Math.min(track.halfWidth * bias, Math.abs(smp.curv) * 500);
    const w =
      Math.sin((i / n) * Math.PI * 2 * 5 + 1.1) * wobble +
      Math.sin((i / n) * Math.PI * 2 * 11 + 0.4) * wobble * 0.5;
    out.push(vadd(smp.pos, vscale(smp.nor, b + w)));
  }
  return out;
}

/** Naive profile: what a person eyeballs, with no planning margin. */
function naiveProfile(pts: Vec2[], car: CarClass, grip: number, pace: number): number[] {
  const n = pts.length;
  const aMax = car.grip * grip * 9.81;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const bc = { x: c.x - b.x, y: c.y - b.y };
    const cross = ab.x * bc.y - ab.y * bc.x;
    const la = Math.hypot(ab.x, ab.y);
    const lb = Math.hypot(bc.x, bc.y);
    const lc = Math.hypot(c.x - a.x, c.y - a.y);
    const k = la * lb * lc > 1e-6 ? Math.abs((2 * cross) / (la * lb * lc)) : 0;
    const v = k > 1e-5 ? Math.sqrt((aMax * pace) / k) : car.maxSpeed * pace;
    out.push(Math.min(car.maxSpeed * pace, Math.max(6, v)));
  }
  return out;
}

function run(track: Track, car: CarClass, line: RacingLine, laps: number) {
  const smp = track.sampleAt(track.length - 4);
  const veh = new Vehicle(car, line, track, smp.pos, Math.atan2(smp.tan.y, smp.tan.x));
  let t = 0;
  let slide = 0;
  let off = 0;
  let peakUnder = 0;
  let sumUnder = 0;
  let sumPursuit = 0;
  let sumCorrect = 0;
  let sumCross = 0;
  let n = 0;
  for (let i = 0; i < 300 / PHYS_DT; i++) {
    veh.step(PHYS_DT);
    t += PHYS_DT;
    n++;
    const u = veh.telemetry.understeer;
    sumUnder += u;
    sumPursuit += Math.abs(veh.debug.latPursuit);
    sumCorrect += Math.abs(veh.debug.latCorrect);
    sumCross += Math.abs(veh.debug.crossErr);
    peakUnder = Math.max(peakUnder, u);
    if (u > 0.5) slide += PHYS_DT;
    if (!veh.telemetry.onTrack) off += PHYS_DT;
    if (veh.lapsDone >= laps) break;
  }
  return {
    t, slide, off, peakUnder,
    meanUnder: sumUnder / Math.max(1, n),
    meanPursuit: sumPursuit / Math.max(1, n),
    meanCorrect: sumCorrect / Math.max(1, n),
    meanCross: sumCross / Math.max(1, n),
    aPeak: veh.debug.aPeak,
  };
}

const f = (x: number, d = 2) => (isFinite(x) ? x.toFixed(d) : "DNF");
const track = new Track(TRACKS[0]);
const car = CAR_CLASSES[TRACKS[0].classes[0]];
const laps = TRACKS[0].laps;
const grip = track.surface.grip;

console.log(`\n${TRACKS[0].name} — isolating path vs profile\n`);
console.log(
  "case                                   time   slide    off   meanU  |latPursuit| |latCorrect| |crossErr|  aPeak",
);

const cases: [string, RacingLine][] = [];

// A: the AI itself.
cases.push(["A  optimised path + planned profile", buildAiLine(track, car, 0.85, 1000)]);

// B: player-ish path, but with a properly planned profile on that path.
const pPath = centrelinePath(track, 0.3, 1.1);
cases.push([
  "B  player path  + planned profile",
  RacingLine.fromNodes(pPath, speedProfile(pPath, car, grip, 0.85), true),
]);

// C: optimised path, but a naive eyeballed profile.
const oPath = optimiseLine(track, car.radius + 2.0, 900, 0, 0);
cases.push([
  "C  optimised path + naive profile",
  RacingLine.fromNodes(oPath, naiveProfile(oPath, car, grip, 0.9), true),
]);

// D: both player-ish — the case the game actually ships.
cases.push([
  "D  player path  + naive profile",
  RacingLine.fromNodes(pPath, naiveProfile(pPath, car, grip, 0.9), true),
]);

for (const [label, line] of cases) {
  const r = run(track, car, line, laps);
  console.log(
    `${label.padEnd(38)} ${f(r.t).padStart(5)}s ${f(r.slide).padStart(6)}s ` +
      `${f(r.off).padStart(5)}s ${f(r.meanUnder).padStart(6)} ` +
      `${f(r.meanPursuit).padStart(12)} ${f(r.meanCorrect).padStart(11)} ` +
      `${f(r.meanCross).padStart(9)} ${f(r.aPeak).padStart(6)}`,
  );
}
console.log("");
