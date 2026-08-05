// Where on the lap does a realistic stroke lose its time?
//
//   npm run where [trackId ...]
//
// `npm run tune` says a circuit is unfair; `npm run diag` says whether the path
// or the speed profile is to blame. This says *where*. It buckets the lap into
// twelfths and prints, for the reference line and for a realistic stroke, the
// time spent in each bucket and how much of it was spent over the grip budget.
//
// The distinction matters more than it sounds. A circuit whose loss is spread
// evenly across twelve buckets is simply hard. A circuit that loses three
// seconds in ONE bucket has a specific corner that cannot be driven by a person
// — and no amount of retuning the physics will fix a corner. Marina Point was
// rebuilt on exactly that evidence.

import { buildReferenceLine } from "../src/ai";
import { RacingLine, RawSample } from "../src/line";
import { Vec2, vadd, vdist, vscale } from "../src/math";
import { PHYS_DT } from "../src/race";
import { Track } from "../src/track";
import { TRACKS } from "../src/tracks";
import { CAR_CLASSES, CarClass, Vehicle } from "../src/vehicle";

/** Walk a polyline emitting samples at 120 Hz, as a finger would. */
function synthDraw(pts: Vec2[], carSpeeds: number[], hz = 120): RawSample[] {
  const out: RawSample[] = [];
  let t = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = vdist(pts[i + 1], pts[i]);
    const dur = d / Math.max(1, carSpeeds[i] / 0.3);
    const steps = Math.max(1, Math.round(dur * hz));
    for (let k = 0; k < steps; k++) {
      const f = k / steps;
      out.push({
        p: {
          x: pts[i].x + (pts[i + 1].x - pts[i].x) * f,
          y: pts[i].y + (pts[i + 1].y - pts[i].y) * f,
        },
        t: (t + dur * f) * 1000,
      });
    }
    t += dur;
  }
  out.push({ p: pts[pts.length - 1], t: t * 1000 });
  return out;
}

/** The same model tune.ts grades against: centreline-ish, wobbly, braking late. */
function realisticStroke(track: Track, car: CarClass, lag = 14, wobble = 1.1, pace = 0.9) {
  const n = track.samples.length;
  const aRef = car.grip * track.surface.grip * 9.81 * 0.62;
  const pts: Vec2[] = [];
  const speeds: number[] = [];
  for (let i = 0; i < n; i++) {
    const smp = track.samples[i];
    const bias = Math.sign(smp.curv) * Math.min(track.halfWidth * 0.3, Math.abs(smp.curv) * 500);
    const wob =
      Math.sin((i / n) * Math.PI * 2 * 5 + 1.1) * wobble +
      Math.sin((i / n) * Math.PI * 2 * 11 + 0.4) * wobble * 0.5;
    pts.push(vadd(smp.pos, vscale(smp.nor, bias + wob)));
    const lagIdx = Math.round(i - lag);
    const k = Math.abs(track.samples[((lagIdx % n) + n) % n].curv);
    const v = k > 1e-5 ? Math.sqrt((aRef * pace) / k) : car.maxSpeed * pace;
    speeds.push(Math.min(car.maxSpeed * pace, Math.max(6, v)));
  }
  pts.push(pts[0]);
  speeds.push(speeds[0]);
  return { pts, speeds };
}

const BUCKETS = 12;

function lapProfile(track: Track, car: CarClass, line: RacingLine, tag: string): number[] {
  const smp = track.sampleAt(track.length - 4);
  const veh = new Vehicle(car, line, track, smp.pos, Math.atan2(smp.tan.y, smp.tan.x));
  const time = new Array(BUCKETS).fill(0);
  const slide = new Array(BUCKETS).fill(0);
  for (let i = 0; i < 300 / PHYS_DT; i++) {
    veh.step(PHYS_DT);
    const b = Math.min(BUCKETS - 1, Math.floor((veh.trackS / track.length) * BUCKETS));
    time[b] += PHYS_DT;
    if (veh.telemetry.understeer > 0.08 * (veh.debug.aPeak || 20)) slide[b] += PHYS_DT;
    if (veh.lapsDone >= 1) break;
  }
  console.log(
    `  ${tag.padEnd(10)}` + time.map((t, i) => `${t.toFixed(1)}/${slide[i].toFixed(1)}`.padStart(9)).join(""),
  );
  return time;
}

const wanted = process.argv.slice(2);
const defs = wanted.length ? TRACKS.filter((t) => wanted.includes(t.id)) : TRACKS;

for (const def of defs) {
  const track = new Track(def);
  const car = CAR_CLASSES[def.classes[0]];
  const ref = buildReferenceLine(track, car);
  const s = realisticStroke(track, car);
  const human = RacingLine.fromInput(synthDraw(s.pts, s.speeds), car.maxSpeed, car.brake);

  console.log(`\n${def.name}  —  seconds/sliding per twelfth of the lap`);
  const a = lapProfile(track, car, ref, "reference");
  const b = lapProfile(track, car, human, "real");
  const loss = a.map((t, i) => b[i] - t);
  console.log("  loss      " + loss.map((v) => v.toFixed(2).padStart(9)).join(""));
  const worst = loss.indexOf(Math.max(...loss));
  const total = loss.reduce((x, y) => x + y, 0);
  console.log(
    `  ${total.toFixed(2)}s lost a lap; worst twelfth #${worst} at ${loss[worst].toFixed(2)}s` +
      (loss[worst] > total * 0.45 && loss[worst] > 0.9
        ? "  <-- one corner is doing this, not the circuit"
        : ""),
  );
}
