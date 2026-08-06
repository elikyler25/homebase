// Drive the built slot game in a real browser at phone size.
//
//   npm run slotplay [track-id]   ->  shots/slot/<track>/*.png
//
// The headless harness proves the physics is a game. This proves the game is
// reachable: that the button is where a thumb is, that holding it moves the car,
// that letting go slows it, that the meter moves, and that a race finishes into
// a results screen. That class of bug — everything correct, nothing playable —
// is exactly what the drawn-line build shipped twice before `modes` existed.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHROME } from "./stroke.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const trackId = process.argv[2] ?? "harbour";
const shots = join(root, "shots", "slot", trackId);
await mkdir(shots, { recursive: true });

const errors = [];
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-gpu"] });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

await page.goto(`file://${resolve(root, "dist/slot.html")}`);
await page.waitForSelector("#track-list .track-card", { timeout: 10000 });
await page.screenshot({ path: join(shots, "1-menu.png") });

const picked = await page.evaluate((id) => {
  const cards = [...document.querySelectorAll("#track-list .track-card")];
  const i = cards.findIndex((c) => c.querySelector(".name").textContent.toLowerCase().includes(id));
  if (i < 0) return null;
  cards[i].click();
  return cards[i].querySelector(".name").textContent;
}, trackId.toLowerCase());
if (!picked) {
  console.log(`no circuit matching "${trackId}"`);
  await browser.close();
  process.exit(1);
}
console.log(`circuit: ${picked}`);
await page.waitForTimeout(400);
await page.screenshot({ path: join(shots, "2-grid.png") });

const btn = await page.locator("#throttle").boundingBox();
const read = () =>
  page.evaluate(() => {
    const g = window.__slot;
    const p = g.race ? g.race.entrants[0].cara : null;
    return p && {
      speed: Math.round(p.speed * 3.6),
      load: +p.telemetry.load.toFixed(2),
      deslots: p.deslotCount,
      laps: p.laps,
      state: g.race.state,
      meter: document.getElementById("grip-fill").style.width,
      pos: document.getElementById("v-pos").textContent,
    };
  });

// One lap is enough to exercise everything, and three would put this harness
// past a minute of wall time for no extra coverage -- the game runs in real
// time, so the test costs exactly what the race costs.
await page.evaluate(() => { window.__slot.race.laps = 1; });

// Drive it: hold the trigger, but lift whenever the meter says the corner is
// about to run out of grip. This is exactly the loop a player runs, expressed
// as the crudest possible policy — if it cannot get round, neither can a person.
await page.waitForTimeout(3200); // countdown
const samples = [];
let held = false;
let shot = false;
const deadline = Date.now() + 90000;
while (Date.now() < deadline) {
  const t = await read();
  if (!t) break;
  samples.push(t);
  if (t.state === "finished") break;
  const want = t.load < 0.82;
  if (want !== held) {
    held = want;
    if (held) {
      await page.mouse.move(btn.x + btn.width / 2, btn.y + btn.height / 2);
      await page.mouse.down();
    } else {
      await page.mouse.up();
    }
  }
  if (!shot && samples.length > 40) {
    shot = true;
    await page.screenshot({ path: join(shots, "3-racing.png") });
  }
  await page.waitForTimeout(70);
}
if (held) await page.mouse.up();

const peakSpeed = Math.max(...samples.map((s) => s.speed));
const movedMeter = new Set(samples.map((s) => s.meter)).size;
const last = samples.at(-1) ?? {};
console.log(
  `peak ${peakSpeed} km/h, meter took ${movedMeter} distinct widths, ` +
    `${last.deslots} deslots, state ${last.state}`,
);

await page.waitForTimeout(900);
await page.screenshot({ path: join(shots, "4-result.png") });

const result = await page.evaluate(() => ({
  shown: document.getElementById("s-result").classList.contains("on"),
  title: document.getElementById("r-title").textContent,
  medal: document.getElementById("r-medal").textContent,
  rows: [...document.querySelectorAll("#r-rows tr")].map((r) => r.textContent.trim()),
  note: document.getElementById("r-note").textContent,
}));
console.log(JSON.stringify(result, null, 2));

const problems = [...errors];
if (last.state !== "finished") problems.push(`race never finished (state ${last.state})`);
if (peakSpeed < 40) problems.push(`car barely moved: peak ${peakSpeed} km/h`);
if (movedMeter < 8) problems.push(`grip meter is not live: ${movedMeter} distinct widths`);
if (!result.shown) problems.push("results screen never appeared");
if (!result.rows.length) problems.push("results table is empty");

await browser.close();
if (problems.length) {
  console.log(`\nFAIL\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("\nPASS  playable, no page errors");
