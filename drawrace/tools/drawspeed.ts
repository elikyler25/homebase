// Does drawing faster make the car spin more without making it go faster?
//
//   npm run drawspeed [track-id]
//
// Reported by a player: "the faster I draw, the more drift and spin-out, even
// though the car has a low top speed — draw crazy fast and medium fast and the
// car goes the same speed, but the spin-out is way more when I draw fast."
//
// The claim is testable. Take ONE path, trace it at a range of finger speeds,
// and print what the car actually does. If speed saturates while slide keeps
// climbing, the player is right and the readback is broken: past some finger
// speed the game stops giving you anything for drawing faster and only starts
// charging you for it.
import { optimiseLine, speedProfile } from "../src/ai";
import { DRAW_SPEED_GAIN, RacingLine, RawSample } from "../src/line";
import { Vec2, vdist } from "../src/math";
import { PHYS_DT } from "../src/race";
import { Track } from "../src/track";
import { TRACKS } from "../src/tracks";
import { CAR_CLASSES, Vehicle } from "../src/vehicle";

/** Walk `pts` at `mult` times the finger speed the planned profile implies. */
function draw(pts: Vec2[], speeds: number[], mult: number, hz = 120): RawSample[] {
  const out: RawSample[] = [{ p: { ...pts[0] }, t: 0 }];
  const dt = 1 / hz;
  let t = 0;
  let seg = 0;
  let frac = 0;
  let guard = 0;
  while (seg < pts.length - 1 && guard++ < 500000) {
    let remaining = Math.max(1, (speeds[seg] / DRAW_SPEED_GAIN) * mult) * dt;
    while (remaining > 0 && seg < pts.length - 1) {
      const segLen = vdist(pts[seg], pts[seg + 1]);
      if (segLen < 1e-6) { seg++; frac = 0; continue; }
      const left = (1 - frac) * segLen;
      if (remaining < left) { frac += remaining / segLen; remaining = 0; }
      else { remaining -= left; seg++; frac = 0; }
    }
    t += dt;
    if (seg >= pts.length - 1) break;
    const a = pts[seg], b = pts[seg + 1];
    out.push({ p: { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac }, t: t * 1000 });
  }
  return out;
}

const id = process.argv[2] ?? "harbour";
const def = TRACKS.find((d) => d.id.includes(id)) ?? TRACKS[0];
const track = new Track(def);
const car = CAR_CLASSES[def.classes[0]];

const path = optimiseLine(track, car.radius + 1.0, 900, 0, 0);
const plan = speedProfile(path, car, track.surface.grip, 0.9);
const closedPts = [...path, path[0]];
const closedSpeeds = [...plan, plan[0]];

console.log(`\n${def.name} [${def.surface}, ${car.name}]  lap ${track.length.toFixed(0)} m  ` +
  `car max ${(car.maxSpeed * 3.6).toFixed(0)} km/h\n`);
// Two ways to trace the same path. `planned` modulates the finger the way the
// optimal profile says to -- slow for the corners, fast down the straights --
// and is what the rest of the harness uses. `uniform` drags the finger at ONE
// speed the whole way round, which is what a person actually does, and is the
// experiment the player ran: same path, same shape, just faster.
const MODE = process.argv[3] === "planned" ? "planned" : "uniform";
const flat = closedSpeeds.map(() => car.maxSpeed);
const base = MODE === "planned" ? closedSpeeds : flat;

console.log(`  tracing the path at a ${MODE} finger speed\n`);
console.log("  finger    samples   line asks   car peak   car mean    race   sliding   slip mean/peak");
console.log("  " + "-".repeat(88));

for (const mult of MODE === "planned"
  ? [0.6, 0.8, 1.0, 1.5, 2.0, 3.0, 5.0, 8.0]
  : [0.15, 0.2, 0.3, 0.4, 0.5, 0.7, 1.0, 1.5, 3.0]) {
  const raw = draw(closedPts, base, mult);
  const line = RacingLine.fromInput([...raw], car.maxSpeed, car.brake, true);

  // What the line asks for, as a fraction of the car's top speed. A stroke that
  // has saturated asks for max everywhere and has no shape left to lose.
  const asks = line.nodes.map((n) => n.speed);
  const askMean = asks.reduce((a, b) => a + b, 0) / Math.max(1, asks.length);
  const pinned = asks.filter((v) => v >= car.maxSpeed - 0.01).length / Math.max(1, asks.length);

  const smp = track.sampleAt(track.length - 4);
  const veh = new Vehicle(car, line, track, smp.pos, Math.atan2(smp.tan.y, smp.tan.x));
  let t = 0, slide = 0, peak = 0, sum = 0, n = 0, slipSum = 0, slipPeak = 0;
  let pursuitSum = 0, correctSum = 0, offSum = 0;
  for (let i = 0; i < Math.floor(300 / PHYS_DT); i++) {
    veh.step(PHYS_DT);
    t += PHYS_DT; n++;
    sum += veh.telemetry.speed;
    peak = Math.max(peak, veh.telemetry.speed);
    const slip = Math.abs(veh.telemetry.slipAngle);
    slipSum += slip;
    slipPeak = Math.max(slipPeak, slip);
    if (veh.telemetry.understeer > 0.08 * (veh.debug.aPeak || 20)) slide += PHYS_DT;
    pursuitSum += Math.abs(veh.debug.latPursuit);
    correctSum += Math.abs(veh.debug.latCorrect);
    offSum += Math.abs(veh.debug.crossErr);
    if (veh.lapsDone >= 1) break;
  }
  const deg = (r: number) => ((r * 180) / Math.PI).toFixed(1);
  console.log(
    `  ${mult.toFixed(1)}x   ${String(raw.length).padStart(7)}   ` +
    `${(askMean * 3.6).toFixed(0).padStart(4)} km/h` +
    ` ${(pinned * 100).toFixed(0).padStart(3)}%max   ` +
    `${(peak * 3.6).toFixed(0).padStart(4)}      ${(sum / n * 3.6).toFixed(0).padStart(4)}   ` +
    `${(veh.lapsDone >= 1 ? t : NaN).toFixed(1).padStart(6)}s  ` +
    `${slide.toFixed(1).padStart(6)}s   ${deg(slipSum / n)}/${deg(slipPeak)} deg   ` +
    `pursuit ${(pursuitSum / n).toFixed(1)} correct ${(correctSum / n).toFixed(1)} ` +
    `off-line ${(offSum / n).toFixed(1)} m`,
  );
}
console.log("");
