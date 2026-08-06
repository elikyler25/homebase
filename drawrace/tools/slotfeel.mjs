// What does the player actually see and feel? Frame rate, how far ahead the
// camera looks, and how much warning there is before a deslot.
import { chromium } from "playwright";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CHROME } from "./stroke.mjs";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const id = process.argv[2] ?? "harbour";
const b = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-gpu"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto(`file://${resolve(root, "dist/slot.html")}`);
await page.waitForSelector("#track-list .track-card");
await page.evaluate((id) => {
  [...document.querySelectorAll("#track-list .track-card")]
    .find((c) => c.querySelector(".name").textContent.toLowerCase().includes(id)).click();
}, id.toLowerCase());
await page.waitForTimeout(3600);

// hold the throttle down and just watch
const btn = await page.locator("#throttle").boundingBox();
await page.mouse.move(btn.x + btn.width / 2, btn.y + btn.height / 2);
await page.mouse.down();

const data = await page.evaluate(() => new Promise((done) => {
  const g = window.__slot;
  const frames = [];
  const samples = [];
  let last = performance.now();
  let n = 0;
  const tick = () => {
    const now = performance.now();
    frames.push(now - last);
    last = now;
    const c = g.race.entrants[0].cara;
    const cam = g.renderer.camera;
    const o = c.outlook();
    samples.push({ v: c.speed, scale: cam.scale, load: c.telemetry.load, ahead: o.ahead, urgency: o.urgency, lift: c.telemetry.lift, off: c.deslotted, t: now });
    if (++n < 400) requestAnimationFrame(tick); else done({ frames, samples });
  };
  requestAnimationFrame(tick);
}));
await page.mouse.up();

const fr = data.frames.slice(5).sort((a, b) => a - b);
const p50 = fr[Math.floor(fr.length * 0.5)], p95 = fr[Math.floor(fr.length * 0.95)];
console.log(`frame time  p50 ${p50.toFixed(1)} ms (${(1000/p50).toFixed(0)} fps)  p95 ${p95.toFixed(1)} ms (${(1000/p95).toFixed(0)} fps)`);

const moving = data.samples.filter((s) => s.v > 5 && !s.off);
const look = moving.map((s) => (844 / 2) / s.scale / s.v);
look.sort((a, b) => a - b);
const vs = moving.map((s) => s.v);
console.log(`speed       ${(Math.min(...vs)*3.6).toFixed(0)}-${(Math.max(...vs)*3.6).toFixed(0)} km/h`);
console.log(`camera      scale ${Math.min(...moving.map(s=>s.scale)).toFixed(2)}-${Math.max(...moving.map(s=>s.scale)).toFixed(2)} px/m`);
console.log(`lookahead   median ${look[Math.floor(look.length/2)].toFixed(1)} s of track visible ahead of the car (min ${look[0].toFixed(1)} s)`);

// How much warning does the LIFT cue give before the car actually comes off?
const lead = [];
let firstWarn = -1;
let wasOff = false;
for (const s of data.samples) {
  if (s.off && !wasOff && firstWarn >= 0) lead.push((s.t - firstWarn) / 1000);
  if (s.off) { firstWarn = -1; wasOff = true; continue; }
  wasOff = false;
  if (s.lift) { if (firstWarn < 0) firstWarn = s.t; }
  else firstWarn = -1;
}
const oldLead = [];
let oldWarn = -1; wasOff = false;
for (const s of data.samples) {
  if (s.off && !wasOff && oldWarn >= 0) oldLead.push((s.t - oldWarn) / 1000);
  if (s.off) { oldWarn = -1; wasOff = true; continue; }
  wasOff = false;
  if (s.load > 0.95) { if (oldWarn < 0) oldWarn = s.t; } else oldWarn = -1;
}
const fmt = (a) => (a.length ? a.map((x) => x.toFixed(2) + "s").join(", ") : "n/a");
console.log(`LIFT cue    ${fmt(lead)} of warning before the deslot`);
console.log(`old meter   ${fmt(oldLead)} (what it used to give)`);
const warnShare = data.samples.filter((s) => !s.off && s.lift).length / data.samples.length;
console.log(`cue on for  ${(warnShare * 100).toFixed(0)}% of the lap`);

await b.close();
