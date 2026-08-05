// Drives the real built game in Chromium at iPhone dimensions: picks a track,
// traces a racing line with realistic per-corner pacing, races it, and captures
// screenshots of every phase. Catches the whole class of bugs the headless
// physics harness cannot see — layout, input plumbing, rendering, HUD state.
//
//   npm run playtest

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const shots = join(root, "shots", process.argv[2] ? process.argv[2] : "harbour");
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const trackId = process.argv[2] ?? null;

await mkdir(shots, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--no-sandbox", "--disable-gpu", "--force-device-scale-factor=1"],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

await page.goto(`file://${resolve(root, "dist/index.html")}`);
await page.waitForSelector("#track-list .track-card", { timeout: 10000 });
await page.screenshot({ path: join(shots, "1-menu.png") });

// Pick the track.
const index = await page.evaluate((id) => {
  if (!id) return 0;
  const names = [...document.querySelectorAll("#track-list .track-card")].map((el) =>
    el.querySelector(".tc-name").textContent.trim().toLowerCase(),
  );
  const hit = names.findIndex((n) => n.includes(id.toLowerCase()));
  return hit < 0 ? 0 : hit;
}, trackId);
await page.locator("#track-list .track-card").nth(index).click();
await page.waitForSelector("#screen-draw:not(.hidden)", { timeout: 5000 });
await page.waitForTimeout(400);
await page.screenshot({ path: join(shots, "2-draw-empty.png") });

// Build a stroke in screen space from the track's own ideal line, paced by the
// speed profile — fast down the straights, slow through the corners, which is
// exactly what a competent player's finger does.
const stroke = await page.evaluate(() => {
  const g = window.__drawrace;
  const cam = g.renderer.camera;
  const W = g.renderer.cssWidth;
  const H = g.renderer.cssHeight;
  const track = g.track;
  const toScreen = (p) => [
    (p.x - cam.center.x) * cam.scale + W / 2,
    (p.y - cam.center.y) * cam.scale + H / 2,
  ];

  const samples = track.samples;
  const step = 5;
  const pts = [];
  for (let i = 0; i < samples.length; i += step) {
    // Bias toward the INSIDE of the corner, like a real racing line. `nor` is
    // the +90 degree rotation of the tangent, which points at the centre of
    // curvature when curv is positive — so the inside is +sign(curv), and
    // getting this backwards traces the outside of every corner and off the
    // track, which is exactly what it did.
    const s = samples[i];
    const off = Math.sign(s.curv) * Math.min(track.halfWidth * 0.55, Math.abs(s.curv) * 900);
    const p = { x: s.pos.x + s.nor.x * off, y: s.pos.y + s.nor.y * off };
    pts.push({ screen: toScreen(p), curv: Math.abs(s.curv) });
  }
  pts.push({ screen: toScreen(samples[0].pos), curv: 0 });

  // Pace the stroke the way a competent player would: the time spent on each
  // metre is inversely proportional to the speed that corner physically allows.
  const car = g.carClass;
  const aMax = car.grip * track.surface.grip * 9.81 * 0.85;
  for (const p of pts) {
    const v = p.curv > 1e-5 ? Math.min(car.maxSpeed, Math.sqrt(aMax / p.curv)) : car.maxSpeed;
    p.v = Math.max(6, v);
  }
  return { pts, scale: cam.scale, lapLength: track.length };
});

// Pace: total draw time targets ~6.5 s, distributed so tight curvature gets more
// time per metre. DRAW_SPEED_GAIN is 0.3, so ~6.5 s of drawing should race in
// roughly 6.5 / 0.3 = ~22 s per lap.
const TARGET_DRAW_MS = 3000; // dispatching ~120 pointer moves adds real overhead
const weights = stroke.pts.map((p) => 1 / p.v);
const totalW = weights.reduce((a, b) => a + b, 0);

const [sx, sy] = stroke.pts[0].screen;
await page.mouse.move(sx, sy);
await page.mouse.down();
const t0 = Date.now();
for (let i = 1; i < stroke.pts.length; i++) {
  const [x, y] = stroke.pts[i].screen;
  await page.mouse.move(x, y);
  const want = (weights[i] / totalW) * TARGET_DRAW_MS;
  const spent = Date.now() - t0;
  const target = (weights.slice(0, i + 1).reduce((a, b) => a + b, 0) / totalW) * TARGET_DRAW_MS;
  void want;
  const wait = Math.max(0, Math.round(target - spent));
  if (wait > 0) await page.waitForTimeout(wait);
  if (i === Math.floor(stroke.pts.length * 0.55)) {
    await page.screenshot({ path: join(shots, "3-draw-partial.png") });
  }
}
const drawMs = Date.now() - t0;
await page.mouse.up();

const pct = await page.evaluate(() => document.getElementById("draw-pct").textContent);
console.log(`stroke: ${stroke.pts.length} points in ${drawMs} ms, coverage ${pct}`);

// Racing?
await page.waitForSelector("#screen-race:not(.hidden)", { timeout: 5000 });
await page.waitForTimeout(2900); // let the countdown clear
await page.screenshot({ path: join(shots, "4-race-start.png") });

await page.waitForTimeout(6000);
await page.evaluate(() => document.getElementById("btn-turbo").click());
await page.waitForTimeout(600);
await page.screenshot({ path: join(shots, "5-race-turbo.png") });

const mid = await page.evaluate(() => {
  const g = window.__drawrace;
  const v = g.race.player.vehicle;
  return {
    speedKmh: Math.round(v.telemetry.speed * 3.6),
    lap: v.currentLap,
    onTrack: v.telemetry.onTrack,
    understeer: +v.telemetry.understeer.toFixed(2),
    turbo: +v.turboCharge.toFixed(2),
    pos: document.getElementById("hud-pos").textContent,
    particles: g.renderer.particles.length,
  };
});
console.log("mid-race:", JSON.stringify(mid));

await page.waitForTimeout(9000);
await page.screenshot({ path: join(shots, "6-race-late.png") });

await page.waitForSelector("#screen-results:not(.hidden)", { timeout: 90000 });
await page.waitForTimeout(300);
await page.screenshot({ path: join(shots, "7-results.png") });

const result = await page.evaluate(() => ({
  pos: document.getElementById("result-pos").textContent,
  time: document.getElementById("result-time").textContent,
  ref: document.getElementById("result-ref").textContent,
  medal: document.getElementById("result-medal-label").textContent,
  rows: [...document.querySelectorAll("#result-table .row")].map((r) =>
    r.textContent.replace(/\s+/g, " ").trim(),
  ),
}));
console.log("result:", JSON.stringify(result, null, 2));

// Back to the menu: does progress persist and re-render?
await page.click("#btn-menu-2");
await page.waitForSelector("#screen-menu:not(.hidden)");
await page.waitForTimeout(200);
await page.screenshot({ path: join(shots, "8-menu-after.png") });

await browser.close();

if (errors.length) {
  console.log(`\nFAIL  ${errors.length} page error(s):`);
  for (const e of errors) console.log(`  ${e}`);
  process.exit(1);
}
console.log("\nPASS  no page errors");
