// Is the player actually at a disadvantage, or does it just feel that way?
import { Track } from "../src/track";
import { TRACKS } from "../src/tracks";
import { CAR_CLASSES } from "../src/vehicle";
import { slotSpec } from "../src/slot/slotcar";
import { makeLanes, laneLength } from "../src/slot/lane";
import { simulateSlot } from "../src/slot/slotrace";

const RIVAL = [0.84, 0.72, 0.58];
for (const id of ["harbour", "nordic"]) {
  const def = TRACKS.find((d) => d.id.includes(id))!;
  const track = new Track(def);
  const car = slotSpec(CAR_CLASSES[def.classes[0]]);
  const lanes = makeLanes(track, 4);
  console.log(`\n${def.name}  car max ${(car.maxSpeed * 3.6).toFixed(0)} km/h`);
  console.log(`  lane lengths ${lanes.map((L) => laneLength(track, L.offset).toFixed(0)).join(" / ")} m  (player is lane 1)`);
  // The player, obeying the cue and nothing else -- the only strategy the game
  // actually teaches.
  const you = simulateSlot(track, car, lanes[1], (c) => !c.telemetry.lift, 1);
  console.log(`  you (obeying the cue, lane 1):  ${you.time.toFixed(2)}s  peak ${(you.peak*3.6).toFixed(0)} km/h`);
  RIVAL.forEach((skill, i) => {
    const L = lanes[[0, 2, 3][i]];
    const nerve = 0.88 + skill * 0.22;
    const r = simulateSlot(track, car, L, (c) => c.cueUrgency < nerve, 1);
    console.log(`  AI skill ${skill} (lane ${[0,2,3][i]}):        ${r.time.toFixed(2)}s  peak ${(r.peak*3.6).toFixed(0)} km/h` +
      `   -> ${(you.time - r.time).toFixed(2)}s ahead of you  ${r.deslots}d`);
  });
}
