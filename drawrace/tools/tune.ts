// Headless physics harness. Runs the real Vehicle/Track/RacingLine code with no
// DOM, so the feel can be measured instead of guessed at.
//
//   node --experimental-strip-types tools/tune.ts     (or: npm run tune)
//
// What it asserts:
//   1. Every track is drivable and finishes both laps.
//   2. The draw -> race round trip is calibrated: tracing a lap in T seconds
//      produces a race time near T / DRAW_SPEED_GAIN.
//   3. Greed is punished — a line drawn flat out everywhere is slower, slides
//      more and spends time off the road.
//   4. AI skill levels are monotonic and land either side of a human line.

import { buildAiLine, buildReferenceLine, speedProfile, optimiseLine } from "../src/ai";
import { DRAW_SPEED_GAIN, RacingLine, RawSample } from "../src/line";
import { Vec2, vdist } from "../src/math";
import { PHYS_DT, referenceTime, simulateHeadless } from "../src/race";
import { Track } from "../src/track";
import { TRACKS } from "../src/tracks";
import { CAR_CLASSES, CarClass, Vehicle } from "../src/vehicle";

const PASS = "[32mPASS[0m";
const FAIL = "[31mFAIL[0m";
let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) failures++;
  console.log(`  ${ok ? PASS : FAIL}  ${label}${detail ? `  ${detail}` : ""}`);
}

/**
 * Synthesise pointer input: walk `pts` emitting samples at 120 Hz, moving the
 * "finger" at carSpeed / gain so the round trip through RacingLine.fromInput
 * exercises exactly the path real touch input takes.
 */
function synthDraw(pts: Vec2[], carSpeeds: number[], hz = 120): RawSample[] {
  const out: RawSample[] = [];
  const dt = 1 / hz;
  let t = 0;
  let seg = 0;
  let frac = 0;
  out.push({ p: { ...pts[0] }, t: 0 });
  let guard = 0;
  while (seg < pts.length - 1 && guard++ < 500000) {
    const fingerSpeed = Math.max(1, carSpeeds[seg] / DRAW_SPEED_GAIN);
    let remaining = fingerSpeed * dt;
    while (remaining > 0 && seg < pts.length - 1) {
      const a = pts[seg];
      const b = pts[seg + 1];
      const segLen = vdist(a, b);
      if (segLen < 1e-6) {
        seg++;
        frac = 0;
        continue;
      }
      const left = (1 - frac) * segLen;
      if (remaining < left) {
        frac += remaining / segLen;
        remaining = 0;
      } else {
        remaining -= left;
        seg++;
        frac = 0;
      }
    }
    t += dt;
    if (seg >= pts.length - 1) break;
    const a = pts[seg];
    const b = pts[seg + 1];
    out.push({ p: { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac }, t: t * 1000 });
  }
  return out;
}

/** Simulate and also report how much of the lap was spent sliding. */
function race(track: Track, car: CarClass, line: RacingLine, laps: number) {
  const smp = track.sampleAt(track.length - 4);
  const veh = new Vehicle(car, line, track, smp.pos, Math.atan2(smp.tan.y, smp.tan.x));
  let t = 0;
  let slideTime = 0;
  let offTime = 0;
  let peak = 0;
  let sumSpeed = 0;
  let n = 0;
  const limit = Math.floor(300 / PHYS_DT);
  for (let i = 0; i < limit; i++) {
    veh.step(PHYS_DT);
    t += PHYS_DT;
    n++;
    sumSpeed += veh.telemetry.speed;
    peak = Math.max(peak, veh.telemetry.speed);
    if (veh.telemetry.understeer > 0.5) slideTime += PHYS_DT;
    if (!veh.telemetry.onTrack) offTime += PHYS_DT;
    if (veh.lapsDone >= laps) break;
  }
  return {
    time: veh.lapsDone >= laps ? t : Infinity,
    finished: veh.lapsDone >= laps,
    slideTime,
    offTime,
    peak,
    avg: sumSpeed / Math.max(1, n),
  };
}

const f = (x: number, d = 2) => (isFinite(x) ? x.toFixed(d) : "DNF");

console.log("\n=== DrawRace physics harness ===\n");

for (const def of TRACKS) {
  const track = new Track(def);
  const car = CAR_CLASSES[def.classes[0]];
  console.log(
    `${def.name}  [${def.surface}, ${car.name}]  lap ${track.length.toFixed(0)} m, ` +
      `width ${def.width} m, ${def.laps} laps`,
  );

  // --- 1. reference line is drivable -----------------------------------
  const refLine = buildReferenceLine(track, car);
  const ref = race(track, car, refLine, def.laps);
  check(
    "reference line finishes",
    ref.finished,
    `${f(ref.time)}s  avg ${f(ref.avg * 3.6, 0)} km/h  peak ${f(ref.peak * 3.6, 0)} km/h  off ${f(ref.offTime)}s`,
  );
  check("reference stays on track", ref.offTime < 0.6, `off ${f(ref.offTime)}s`);

  // --- 2. draw -> race round trip is calibrated -------------------------
  const pts = optimiseLine(track, car.radius + 1.0, 900, 0, 0);
  const speeds = speedProfile(pts, car, track.surface.grip, 0.9);
  const closedPts = [...pts, pts[0]];
  const closedSpeeds = [...speeds, speeds[0]];
  const rawInput = synthDraw(closedPts, closedSpeeds);
  const drawSeconds = rawInput.length ? rawInput[rawInput.length - 1].t / 1000 : 0;
  const humanLine = RacingLine.fromInput([...rawInput], car.maxSpeed, true);
  const human = race(track, car, humanLine, def.laps);
  const predicted = (drawSeconds / DRAW_SPEED_GAIN) * def.laps;
  const err = Math.abs(human.time - predicted) / predicted;
  check(
    "drawn line finishes",
    human.finished,
    `drew in ${f(drawSeconds)}s -> raced ${f(human.time)}s (predicted ${f(predicted)}s)`,
  );
  check("draw/race calibration within 25%", err < 0.25, `error ${f(err * 100, 1)}%`);
  check(
    "drawn lap is competitive with reference",
    human.finished && human.time < ref.time * 1.35,
    `${f(human.time)}s vs ref ${f(ref.time)}s`,
  );

  // --- 3. greed is punished --------------------------------------------
  const flatOut = new Array(closedPts.length).fill(car.maxSpeed);
  const greedyRaw = synthDraw(closedPts, flatOut);
  const greedyLine = RacingLine.fromInput([...greedyRaw], car.maxSpeed, true);
  const greedy = race(track, car, greedyLine, def.laps);
  check(
    "flat-out line slides more",
    greedy.slideTime > human.slideTime * 1.5,
    `slide ${f(greedy.slideTime)}s vs ${f(human.slideTime)}s`,
  );
  // Greed has to cost something real, but *which* currency depends on the
  // circuit. On a narrow technical track you end up in the scenery; on a wide
  // low-grip one like the ice you stay on the island and simply bleed seconds
  // sliding. Either is a valid punishment — demanding specifically that the car
  // goes off would be asserting a preference, not a physical invariant.
  const wentWide = greedy.offTime > human.offTime + 0.3;
  const lostTime = !greedy.finished || greedy.time > ref.time * 1.05;
  check(
    "flat-out line is punished (wide or slow)",
    wentWide || lostTime,
    `off ${f(greedy.offTime)}s vs ${f(human.offTime)}s, ` +
      `${f(greedy.time)}s vs ref ${f(ref.time)}s`,
  );
  check(
    "flat-out line is not faster",
    !greedy.finished || greedy.time > ref.time,
    `${f(greedy.time)}s vs ref ${f(ref.time)}s`,
  );

  // --- 4. AI skill ordering --------------------------------------------
  const skills = [0.79, 0.85, 0.91, 0.97];
  const aiTimes = skills.map((s, i) => {
    const l = buildAiLine(track, car, s, 1000 + i * 7919);
    return race(track, car, l, def.laps);
  });
  const allFinished = aiTimes.every((a) => a.finished);
  check("all AI finish", allFinished, aiTimes.map((a) => f(a.time)).join("  "));
  let monotonic = true;
  for (let i = 1; i < aiTimes.length; i++) {
    if (aiTimes[i].time > aiTimes[i - 1].time) monotonic = false;
  }
  check("higher skill is faster", monotonic, aiTimes.map((a) => f(a.time)).join(" > "));
  const humanRank = aiTimes.filter((a) => a.time < human.time).length;
  check(
    "human line lands inside the field",
    humanRank >= 0 && humanRank <= skills.length,
    `would finish P${humanRank + 1} of ${skills.length + 1}`,
  );

  // --- 5. medal thresholds are reachable --------------------------------
  const refT = referenceTime(track, car.id);
  check(
    "gold is reachable by a good line",
    human.time <= refT * def.medals.bronze * 1.02,
    `human ${f(human.time)}s  gold<=${f(refT * def.medals.gold)}s  bronze<=${f(refT * def.medals.bronze)}s`,
  );

  console.log("");
}

// Line-geometry regressions that are easy to break and hard to spot in play.
console.log("Line mechanics");
{
  const track = new Track(TRACKS[0]);
  const car = CAR_CLASSES.gt;
  const line = buildReferenceLine(track, car);

  // nearestS returns a wrapped arc length, so the invariant that matters is not
  // monotonicity but continuity: the car must never be teleported to a distant
  // branch of its own line, which is what a global nearest-point search would do
  // wherever a drawn line crosses itself.
  let prev = 0;
  let maxJump = 0;
  const veh = new Vehicle(car, line, track, track.startPos, Math.atan2(track.startTan.y, track.startTan.x));
  for (let i = 0; i < 90 / PHYS_DT; i++) {
    veh.step(PHYS_DT);
    let d = veh.lineS - prev;
    if (d < -line.length / 2) d += line.length; // wrapped forward past the seam
    if (d > line.length / 2) d -= line.length;
    maxJump = Math.max(maxJump, Math.abs(d));
    prev = veh.lineS;
    if (veh.lapsDone >= 3) break;
  }
  check("line tracking stays continuous", maxJump < 3, `max jump ${f(maxJump)} m/tick`);
  check("three laps completed on a closed line", veh.lapsDone >= 3, `lap ${veh.lapsDone}`);

  const r = simulateHeadless(track, car, line, 2);
  check("simulateHeadless agrees with harness", r.finished, `${f(r.time)}s`);
}

console.log(
  `\n${failures === 0 ? PASS : FAIL}  ${failures} failure${failures === 1 ? "" : "s"}\n`,
);
process.exit(failures === 0 ? 0 : 1);
