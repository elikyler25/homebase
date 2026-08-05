// Browser check for the two modes the physics harness cannot see: the ghost of
// your own best lap, and hot seat.
//
//   npm run modes
//
// Both live almost entirely in game-shell state — localStorage, phase order,
// which screen is showing — so they can pass `npm run tune` while being
// completely broken in a browser. This drives the real built file.

import { chromium } from "playwright";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CHROME, traceLap } from "./stroke.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${label}${detail ? `  ${detail}` : ""}`);
};

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
await page.waitForSelector("#track-list .track-card");

/** Draw a lap and jump to the end of the race. */
async function runRace() {
  await page.waitForSelector("#screen-draw:not(.hidden)");
  await page.waitForTimeout(300);
  await traceLap(page, { totalMs: 1600 });
  await page.waitForSelector("#screen-race:not(.hidden)", { timeout: 5000 });
  await page.waitForTimeout(200);
  const ghostVisible = !(await page.locator("#hud-ghost-card").getAttribute("class")).includes(
    "hidden",
  );
  const turboVisible = !(await page
    .locator(".turbo-wrap")
    .getAttribute("class"))
    .includes("hidden");
  await page.evaluate(() => document.getElementById("btn-skip").click());
  await page.waitForSelector("#screen-results:not(.hidden)", { timeout: 20000 });
  const res = await page.evaluate(() => ({
    pos: document.getElementById("result-pos").textContent,
    medal: document.getElementById("result-medal-label").textContent,
    best: document.getElementById("result-best").textContent,
    rows: [...document.querySelectorAll("#result-table .row")].map((r) =>
      r.textContent.replace(/\s+/g, " ").trim(),
    ),
  }));
  return { ...res, ghostVisible, turboVisible };
}

// ------------------------------------------------------------------- ghost
console.log("Ghost");
await page.locator("#track-list .track-card").first().click();
const first = await runRace();
check("a first run has no ghost to race", !first.ghostVisible);
check(
  "a first run is a personal best",
  first.best.includes("New personal best"),
  first.best,
);
check(
  "the stroke behind the best lap is stored",
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("drawrace.progress.v2") ?? "{}");
    return Object.keys(p.ghosts ?? {}).length > 0;
  }),
);

await page.click("#btn-retry");
const second = await runRace();
check("the second run races a ghost", second.ghostVisible);
check(
  "the ghost is listed but not ranked",
  second.rows.some((r) => r.includes("Ghost")) &&
    second.rows.filter((r) => /^\d/.test(r)).length === 5,
  second.rows.find((r) => r.includes("Ghost")) ?? "no ghost row",
);

// ---------------------------------------------------------------- hot seat
console.log("\nHot seat");
await page.click("#btn-menu-2");
await page.waitForSelector("#screen-menu:not(.hidden)");
await page.locator("#hs-opts .hs-chip", { hasText: "2" }).first().click();
await page.locator("#track-list .track-card").first().click();

await page.waitForSelector("#screen-draw:not(.hidden)");
await page.waitForTimeout(300);
await traceLap(page, { totalMs: 1600 });
await page.waitForSelector("#screen-handover:not(.hidden)", { timeout: 5000 });
check(
  "player one's stroke hands over instead of racing",
  await page.evaluate(() => document.getElementById("ho-name").textContent === "Player 2"),
);
await page.click("#btn-handover");

const hs = await runRace();
check("hot seat has no turbo button", !hs.turboVisible);
check("hot seat has no ghost", !hs.ghostVisible);
check("hot seat is scored as a win, not a medal", hs.medal === "Winner", hs.medal);
check(
  "both seats are classified",
  hs.rows.length === 2 && hs.rows.some((r) => r.includes("P1")) && hs.rows.some((r) => r.includes("P2")),
  hs.rows.join(" | "),
);
check(
  "hot seat does not write to the career",
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem("drawrace.progress.v2") ?? "{}");
    // One circuit raced solo, twice; hot seat must not have added a second key.
    return Object.keys(p.best ?? {}).length === 1;
  }),
);

await browser.close();

if (errors.length) {
  console.log(`\n${errors.length} page error(s):`);
  for (const e of errors) console.log(`  ${e}`);
  failures += errors.length;
}
console.log(
  `\n${failures === 0 ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${failures} failure${failures === 1 ? "" : "s"}\n`,
);
process.exit(failures === 0 ? 0 : 1);
