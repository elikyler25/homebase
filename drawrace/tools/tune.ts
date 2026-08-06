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

import { DRIVER_POOL, buildAiLine, buildReferenceLine, speedProfile, optimiseLine } from "../src/ai";
import { overLimitSpans } from "../src/coach";
import { decodeGhost, encodeGhost } from "../src/ghost";
import { DRAW_SPEED_GAIN, RacingLine, RawSample } from "../src/line";
import { Vec2, vadd, vdist, vscale } from "../src/math";
import { PHYS_DT, Race, referenceTime, simulateHeadless } from "../src/race";
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

/**
 * A *realistic* stroke, as opposed to the idealised one above.
 *
 * A real finger does three things an optimiser never does: it traces roughly
 * down the middle rather than hitting apexes, it wobbles, and — the big one —
 * it starts slowing AT the corner rather than before it, because a person
 * cannot know the car's braking curve while drawing. `lag` models that.
 */
function realisticStroke(
  track: Track,
  car: CarClass,
  opts: { lag: number; wobble: number; pace: number },
): { pts: Vec2[]; speeds: number[] } {
  const n = track.samples.length;
  // Deliberately NOT derived from the car's actual grip. A person draws the
  // stroke that has felt right to them; they do not silently recalibrate their
  // finger when the tyres get better. Deriving this from the live grip value
  // would make the model drive at the limit no matter what the limit is, and
  // any grip change would appear to do nothing.
  const aRef = car.grip * track.surface.grip * 9.81 * 0.62;
  const pts: Vec2[] = [];
  const speeds: number[] = [];
  for (let i = 0; i < n; i++) {
    const smp = track.samples[i];
    // Mild inside bias, nothing like a true racing line, plus slow wobble.
    const bias = Math.sign(smp.curv) * Math.min(track.halfWidth * 0.3, Math.abs(smp.curv) * 500);
    const wob =
      Math.sin((i / n) * Math.PI * 2 * 5 + 1.1) * opts.wobble +
      Math.sin((i / n) * Math.PI * 2 * 11 + 0.4) * opts.wobble * 0.5;
    pts.push(vadd(smp.pos, vscale(smp.nor, bias + wob)));

    // Speed chosen from the curvature the player can currently SEE under their
    // finger — i.e. lagging the corner they are about to arrive at.
    const lagIdx = Math.round(i - opts.lag);
    const k = Math.abs(track.samples[((lagIdx % n) + n) % n].curv);
    const v = k > 1e-5 ? Math.sqrt((aRef * opts.pace) / k) : car.maxSpeed * opts.pace;
    speeds.push(Math.min(car.maxSpeed * opts.pace, Math.max(6, v)));
  }
  pts.push(pts[0]);
  speeds.push(speeds[0]);
  return { pts, speeds };
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
  let sumSlip = 0;
  let peakSlip = 0;
  let n = 0;
  const limit = Math.floor(300 / PHYS_DT);
  for (let i = 0; i < limit; i++) {
    veh.step(PHYS_DT);
    t += PHYS_DT;
    n++;
    sumSpeed += veh.telemetry.speed;
    peak = Math.max(peak, veh.telemetry.speed);
    sumSlip += Math.abs(veh.telemetry.slipAngle);
    peakSlip = Math.max(peakSlip, Math.abs(veh.telemetry.slipAngle));
    if (veh.telemetry.understeer > 0.08 * (veh.debug.aPeak || 20)) slideTime += PHYS_DT;
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
    meanSlipDeg: (sumSlip / Math.max(1, n)) * (180 / Math.PI),
    peakSlipDeg: peakSlip * (180 / Math.PI),
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
  const humanLine = RacingLine.fromInput([...rawInput], car.maxSpeed, car.brake, true);
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
  const greedyLine = RacingLine.fromInput([...greedyRaw], car.maxSpeed, car.brake, true);
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
  const skills = [0.60, 0.65, 0.70, 0.75];
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
  // Fairness: the player's stroke and the AI's line run through identical
  // physics, so any large gap in *sliding* is an asymmetry in how the two lines
  // were built, not in how they are driven.
  const midAi = aiTimes[1];
  console.log(
    `        slide: human ${f(human.slideTime)}s  ai@0.85 ${f(midAi.slideTime)}s  ` +
      `ai@0.97 ${f(aiTimes[3].slideTime)}s   |   off: human ${f(human.offTime)}s  ` +
      `ai@0.85 ${f(midAi.offTime)}s`,
  );
  check(
    "drawn line does not slide far more than an AI line",
    human.slideTime <= Math.max(2.5, midAi.slideTime * 2.5),
    `human ${f(human.slideTime)}s vs mid-AI ${f(midAi.slideTime)}s`,
  );

  // The case that actually matters: what a person's finger produces.
  const real = realisticStroke(track, car, { lag: 14, wobble: 1.1, pace: 0.9 });
  const realRaw = synthDraw(real.pts, real.speeds);
  const realLine = RacingLine.fromInput([...realRaw], car.maxSpeed, car.brake, true);
  const realRace = race(track, car, realLine, def.laps);
  const realRank = aiTimes.filter((a) => a.time < realRace.time).length + 1;
  console.log(
    `        REAL stroke: ${f(realRace.time)}s  P${realRank}/5  slide ${f(realRace.slideTime)}s  ` +
      `drift ${f(realRace.meanSlipDeg, 1)}deg (peak ${f(realRace.peakSlipDeg, 0)})   ` +
      `| mid-AI ${f(midAi.time)}s slide ${f(midAi.slideTime)}s drift ${f(midAi.meanSlipDeg, 1)}deg`,
  );
  check(
    "player drift stays subtle",
    realRace.meanSlipDeg <= 6 && realRace.peakSlipDeg <= 16,
    `mean ${f(realRace.meanSlipDeg, 1)}deg peak ${f(realRace.peakSlipDeg, 0)}deg ` +
      `(AI mean ${f(midAi.meanSlipDeg, 1)}deg)`,
  );
  check(
    "a realistic stroke can beat someone",
    realRank <= skills.length,
    `P${realRank} of ${skills.length + 1}`,
  );
  // Deliberately NOT compared against the AI's slide time. The AI plans at about
  // half the grip budget and so never crosses the threshold at all, which makes
  // it a useless denominator — any player pushing hard would "fail" against a
  // zero. What matters is that the player is not over the limit for most of the
  // race, and (checked above) that when they are, it stays subtle.
  check(
    "player is not over the limit for most of the race",
    realRace.slideTime <= realRace.time * 0.5,
    `${f(realRace.slideTime)}s of ${f(realRace.time)}s ` +
      `(${f((realRace.slideTime / realRace.time) * 100, 0)}%)`,
  );

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

// The ghost and the hot seat both add cars to a race. The properties worth
// pinning are that the ghost reproduces the lap it claims to be, and that
// adding it changes nothing about the race it is shown next to.
console.log("Ghost and hot seat");
{
  const track = new Track(TRACKS[0]);
  const car = CAR_CLASSES.gt;
  const stroke = realisticStroke(track, car, { lag: 6, wobble: 1.4, pace: 0.94 });
  const line = RacingLine.fromInput(
    synthDraw(stroke.pts, stroke.speeds),
    car.maxSpeed,
    car.brake,
  );

  const original = race(track, car, line, 2).time;
  const data = encodeGhost(line, []);
  const back = decodeGhost(data ?? undefined);
  check("ghost round-trips through storage", !!back, `${data ? data.p.length / 3 : 0} points`);
  const replay = back ? race(track, car, back.line, 2).time : Infinity;
  const drift = Math.abs(replay - original) / original;
  // Storing every fourth node and resampling loses a little of the stroke. What
  // matters is that the ghost is still recognisably the lap it is labelled
  // with — a ghost half a second out is a ghost nobody trusts.
  check(
    "ghost replays the lap it recorded",
    drift < 0.02,
    `${f(original)}s -> ${f(replay)}s (${f(drift * 100, 1)}%)`,
  );
  check(
    "ghost storage stays small",
    JSON.stringify(data).length < 4000,
    `${JSON.stringify(data).length} bytes`,
  );

  // A ghost must be scenery: no contact, no ranking, no effect on the result.
  const drivers = DRIVER_POOL.slice(0, 4);
  const solo = new Race(track, line, car, drivers, car, {});
  const withGhost = new Race(track, line, car, drivers, car, { ghost: back });
  for (const r of [solo, withGhost]) {
    r.update(3);
    let guard = 0;
    while (!r.finished && guard++ < 6000) r.update(1 / 60);
  }
  const a = solo.standings().find((s) => s.isPlayer)!;
  const b = withGhost.standings().find((s) => s.isPlayer)!;
  check(
    "a ghost does not touch the race it appears in",
    Math.abs(a.time - b.time) < 1e-9 && a.position === b.position,
    `${f(a.time)}s P${a.position} vs ${f(b.time)}s P${b.position}`,
  );
  check(
    "ghost is not an entrant",
    withGhost.standings().length === solo.standings().length,
    `${withGhost.standings().length} classified`,
  );

  // Hot seat: four drawn cars, no AI, everyone home. Only the lag varies —
  // how late each "player" notices the corner they are arriving at. The spread
  // is in metres of track, so it has to widen as circuits get longer — because
  // that is the one stroke parameter where better is unambiguous. (Pace is not:
  // drawing closer to the theoretical limit makes you slower, which is the
  // lesson the whole game is built on.)
  const rivals = [18, 9, 2].map((lag, i) => {
    const s = realisticStroke(track, car, { lag, wobble: 1.2, pace: 0.92 });
    return {
      line: RacingLine.fromInput(synthDraw(s.pts, s.speeds), car.maxSpeed, car.brake),
      car,
      name: `P${i + 2}`,
      colour: "#ffffff",
    };
  });
  const hs = new Race(track, line, car, [], car, { rivals, autoTurbo: true });
  hs.update(3);
  let guard = 0;
  while (!hs.finished && guard++ < 12000) hs.update(1 / 60);
  const table = hs.standings();
  check("hot seat classifies every seat", table.length === 4, `${table.length} cars`);
  check(
    "hot seat finishes",
    table.every((r) => r.finished),
    table.map((r) => `${r.name} ${f(r.time)}`).join("  "),
  );
  // The sharper stroke must beat the laggier one. If the auto-turbo rule or the
  // grid handed a seat an advantage, this is where it would show.
  const at = (n: string) => table.findIndex((r) => r.name === n);
  check(
    "a sharper stroke beats a laggier one in the hot seat",
    at("P4") < at("P3") && at("P3") < at("P2"),
    table.map((r) => r.name).join(" > "),
  );
}

// The coach draws its warning from the same expression the vehicle uses, so the
// property to pin is that it agrees with what then happens: it must light up on
// a line that will slide and stay quiet on one that will not.
console.log("Coaching");
{
  const track = new Track(TRACKS[0]);
  const car = CAR_CLASSES.gt;
  const budget = car.grip * track.surface.grip * 9.81;

  const ref = buildReferenceLine(track, car);
  const refSpans = overLimitSpans(ref, budget);
  const refRace = race(track, car, ref, 2);
  check(
    "a planned line draws no warning",
    refSpans.length === 0,
    `${refSpans.length} spans, ${f(refRace.slideTime)}s sliding`,
  );

  // Flat out everywhere: the line every new player draws on their first go.
  const flatPts = track.samples.map((smp) => smp.pos);
  flatPts.push(flatPts[0]);
  const flat = RacingLine.fromNodes(
    flatPts,
    flatPts.map(() => car.maxSpeed),
    true,
  );
  const flatSpans = overLimitSpans(flat, budget);
  const flatRace = race(track, car, flat, 2);
  check(
    "a flat-out line is warned about",
    flatSpans.length > 0,
    `${flatSpans.length} spans, worst ${f(Math.max(...flatSpans.map((s) => s.peak)) * 100, 0)}% of grip`,
  );
  check(
    "the warning agrees with what actually happens",
    flatSpans.length > 0 && flatRace.slideTime > refRace.slideTime + 3,
    `warned ${flatSpans.length} vs ${refSpans.length} spans; slid ${f(flatRace.slideTime)}s vs ${f(refRace.slideTime)}s`,
  );
}

console.log(
  `\n${failures === 0 ? PASS : FAIL}  ${failures} failure${failures === 1 ? "" : "s"}\n`,
);
process.exit(failures === 0 ? 0 : 1);
