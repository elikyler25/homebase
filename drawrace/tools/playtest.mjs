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

import { CHROME, traceLap } from "./stroke.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const shots = join(root, "shots", process.argv[2] ? process.argv[2] : "harbour");
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

// Trace the lap, screenshotting partway through. ~3 s of drawing at a gain of
// 0.3 should race in roughly 3 / 0.3 = ~10 s a lap.
const { drawMs, points } = await traceLap(page, {
  totalMs: 3000,
  onProgress: async (i, n) => {
    if (i === Math.floor(n * 0.55)) {
      await page.screenshot({ path: join(shots, "3-draw-partial.png") });
    }
  },
});

const pct = await page.evaluate(() => document.getElementById("draw-pct").textContent);
console.log(`stroke: ${points} points in ${drawMs} ms, coverage ${pct}`);

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
