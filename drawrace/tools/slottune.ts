// Headless harness for the slot game.
//
//   npm run slottune [track-ids]
//
// Same rule as the drawn-line harness: assert the properties that make it a
// game, not that it runs. A slot car with one button is a very small design, so
// there are only a few things that can be true or false about it, and all of
// them matter:
//
//   1. Flat out deslots. If holding the trigger down all lap works, there is no
//      game — the button may as well not exist.
//   2. Lifting works. A planned throttle gets home without deslotting.
//   3. Being braver is faster, right up until it is not. Margin has to buy lap
//      time monotonically until it starts costing deslots.
//   4. No lane is a free win. Inside slots are shorter but tighter; if one lane
//      dominates, the race is decided on the grid.
//   5. Reaction time matters. A laggier trigger is slower than a sharper one on
//      the same plan, or the skill ceiling is fake.

import { formatTime } from "../src/math";
import { Track } from "../src/track";
import { TRACKS } from "../src/tracks";
import { CAR_CLASSES } from "../src/vehicle";
import { makeLanes, laneLength } from "../src/slot/lane";
import {
  SLOT_DT,
  SlotRace,
  overconfidentPolicy,
  planPolicy,
  simulateSlot,
  slotMedals,
  slotReferenceTime,
} from "../src/slot/slotrace";

const PASS = "\x1b[32mPASS\x1b[0m";
const FAIL = "\x1b[31mFAIL\x1b[0m";
let failures = 0;
const f = (x: number, d = 2) => (isFinite(x) ? x.toFixed(d) : "DNF");

function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) failures++;
  console.log(`  ${ok ? PASS : FAIL}  ${label}${detail ? `  ${detail}` : ""}`);
}

console.log("\n=== slot racing harness ===\n");

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const sweep = only.length
  ? TRACKS.filter((t) => only.some((o) => t.id.includes(o)))
  : TRACKS;

for (const def of sweep) {
  const track = new Track(def);
  const car = CAR_CLASSES[def.classes[0]];
  const lanes = makeLanes(track, 4);
  const mid = lanes[1];
  console.log(
    `${def.name}  [${def.surface}, ${car.name}]  lap ${track.length.toFixed(0)} m, ` +
      `${lanes.length} slots, grip budget ${(car.grip * track.surface.grip * 9.81).toFixed(0)}+mag`,
  );

  // --- 1. flat out must not work ---------------------------------------
  const flat = simulateSlot(track, car, mid, () => true, 1);
  check(
    "holding the trigger down deslots",
    flat.deslots > 0,
    `${flat.deslots} deslots, ${f(flat.time)}s`,
  );

  // --- 2. a planned trigger gets home ----------------------------------
  const clean = simulateSlot(track, car, mid, planPolicy(track, car, mid, 0.88), 1);
  check("a planned lap finishes", clean.finished, `${f(clean.time)}s`);
  check("a planned lap does not deslot", clean.deslots === 0, `${clean.deslots} deslots`);

  const ref = slotReferenceTime(track, car, mid);
  check(
    "a planned lap is within reach of the reference",
    clean.finished && clean.time < ref * 1.5,
    `${f(clean.time)}s vs ref ${f(ref)}s`,
  );

  // --- 3. braver is faster, until it deslots ----------------------------
  const margins = [0.6, 0.72, 0.84, 0.94];
  const runs = margins.map((m) => simulateSlot(track, car, mid, planPolicy(track, car, mid, m), 1));
  let monotonic = true;
  for (let i = 1; i < runs.length; i++) {
    if (runs[i].deslots === 0 && runs[i - 1].deslots === 0 && runs[i].time > runs[i - 1].time) {
      monotonic = false;
    }
  }
  check(
    "a braver clean lap is a faster lap",
    monotonic,
    runs.map((r, i) => `${margins[i]}:${f(r.time)}s/${r.deslots}d`).join("  "),
  );
  check(
    "the brave end of the range is where the deslots are",
    runs[runs.length - 1].deslots >= runs[0].deslots,
    `${runs[0].deslots} at 0.60 vs ${runs[runs.length - 1].deslots} at 0.94`,
  );

  // --- 4. no lane is a free win ----------------------------------------
  const laneTimes = lanes.map((L) => {
    const r = simulateSlot(track, car, L, planPolicy(track, car, L, 0.88), 1);
    return { L, r };
  });
  const good = laneTimes.filter((x) => x.r.finished);
  const best = Math.min(...good.map((x) => x.r.time));
  const worst = Math.max(...good.map((x) => x.r.time));
  check(
    "every slot can finish",
    good.length === lanes.length,
    laneTimes.map((x) => `${x.L.index}:${f(x.r.time)}s`).join("  "),
  );
  check(
    "no slot is more than 6% better than another",
    good.length > 0 && worst / best < 1.06,
    `best ${f(best)}s worst ${f(worst)}s (${f(((worst / best) - 1) * 100, 1)}%)  ` +
      `lengths ${lanes.map((L) => laneLength(track, L.offset).toFixed(0)).join("/")}`,
  );

  // --- 5. misjudging the corner is what costs you ----------------------
  // NOT reaction time. The first version of this asserted that a sharper
  // trigger beats a laggier one, and it is simply false here: with a closed
  // loop on the trigger and only a coasting motor to slow the car, braking
  // zones run over a hundred metres, so lifting 0.3 s late is a ~10% error the
  // controller has shed long before the apex. Measured across five margins on
  // three circuits, a 0.30 s delay never once cost a deslot and was marginally
  // FASTER every time. Slot racing is not a reflex game; it is a calibration
  // game, and the assertion should test calibration.
  const greedy = simulateSlot(track, car, mid, overconfidentPolicy(track, car, mid, 0.88, 1.18), 1);
  check(
    "a driver who overestimates the grip deslots",
    greedy.deslots > 0,
    `${greedy.deslots} deslots driving the 0.88 plan 18% too fast, vs ${clean.deslots} on plan`,
  );
  check(
    "and is slower for it",
    !greedy.finished || greedy.time > clean.time,
    `${f(greedy.time)}s vs ${f(clean.time)}s`,
  );

  // --- 6. medals are reachable ------------------------------------------
  const medals = slotMedals(ref);
  check(
    "gold is reachable by a good lap",
    clean.time <= medals.gold,
    `${f(clean.time)}s  gold<=${f(medals.gold)}s`,
  );

  // --- 7. the danger meter has to mean something ------------------------
  // If it reads high on a lap that never deslots, or low on one that does, it is
  // decoration and the player has no warning.
  // The load meter is the one on screen, and it has to be a live reading rather
  // than an idiot light: a good lap should sit well up the bar (you are using
  // the grip) without ever pinning it.
  check(
    "the load meter reads live on a good lap without pinning",
    clean.loadedFraction > 0.12 && clean.loadPeak <= 1.02,
    `${f(clean.loadedFraction * 100, 0)}% of the lap loaded, peak ${f(clean.loadPeak)}, ` +
      `mean ${f(clean.load)}`,
  );
  check(
    "the load meter pins when the lap is over the limit",
    greedy.loadPeak > 1.05,
    `greedy peak ${f(greedy.loadPeak)} vs clean ${f(clean.loadPeak)}`,
  );
  check(
    "the deslot warning stays quiet on a clean lap",
    clean.danger < 0.35,
    `mean danger ${f(clean.danger)}`,
  );
}

// --- whole-race checks --------------------------------------------------
{
  const def = sweep[0] ?? TRACKS[0];
  const track = new Track(def);
  const car = CAR_CLASSES[def.classes[0]];
  const lanes = makeLanes(track, 4);
  console.log(`\nA full race on ${def.name}`);

  const race = new SlotRace(track, 2, [
    { name: "You", colour: "#ff5c5c", car, lane: lanes[0] },
    { name: "Aalto", colour: "#4fc3f7", car, lane: lanes[1], skill: 0.92 },
    { name: "Bergman", colour: "#ffd23f", car, lane: lanes[2], skill: 0.74 },
    { name: "Costa", colour: "#9ccc65", car, lane: lanes[3], skill: 0.55 },
  ]);
  // The player drives to a plan too, so the race measures the AI rather than an
  // idle car.
  const drive = planPolicy(track, car, lanes[0], 0.86);
  let guard = 0;
  while (race.state !== "finished" && guard++ < 120000) {
    const p = race.entrants[0];
    if (race.state === "running") p.cara.throttle = drive(p.cara, race.time);
    race.update(SLOT_DT);
  }
  const table = race.standings();
  check("every car is classified", table.length === 4, `${table.length}`);
  check("every car finishes", table.every((r) => r.finished), table.map((r) => `${r.name} ${formatTime(r.time)}`).join("  "));

  const ai = table.filter((r) => !r.isPlayer);
  const skills: Record<string, number> = { Aalto: 0.92, Bergman: 0.74, Costa: 0.55 };
  let ordered = true;
  for (let i = 1; i < ai.length; i++) {
    if (skills[ai[i].name] > skills[ai[i - 1].name]) ordered = false;
  }
  check(
    "the AI field finishes in skill order",
    ordered,
    ai.map((r) => `${r.name}(${skills[r.name]}) P${r.position}`).join("  "),
  );
  check(
    "the race is not a procession decided by deslots alone",
    table.some((r) => r.deslots === 0),
    table.map((r) => `${r.name} ${r.deslots}d`).join("  "),
  );
}

console.log(`\n${failures === 0 ? PASS : FAIL}  ${failures} failure${failures === 1 ? "" : "s"}\n`);
process.exit(failures === 0 ? 0 : 1);
