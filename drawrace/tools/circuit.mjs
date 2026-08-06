// One circuit, big, at its real road width, with the authored polyline drawn on
// top of it.
//
//   npm run circuit -- grand   ->  shots/circuit-grand.png
//
// The atlas answers "are these thirty different circuits?". This answers the
// question underneath it: "is the circuit the game builds the one I authored?"
// `tools/kart_layouts.py` emits a polyline; `Track` runs a Catmull-Rom spline
// through it and resamples by arc length, and a fold narrow enough for the
// spline to round off would vanish somewhere between the two without either
// side complaining. Drawing both in one image is the whole check -- the red
// line should sit inside the grey road everywhere.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHROME } from "./stroke.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const id = process.argv[2];
if (!id) {
  console.log("usage: npm run circuit -- <track-id>");
  process.exit(1);
}
await mkdir(resolve(root, "shots"), { recursive: true });
const out = process.argv[3] ?? join(root, "shots", `circuit-${id}.png`);

const b = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-gpu"] });
const ctx = await b.newContext({ viewport: { width: 800, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(`file://${resolve(root, "dist/index.html")}`);
await page.waitForSelector("#track-list .track-card");

const name = await page.evaluate((id) => {
  const def = window.__TRACKS.find((d) => d.id === id || d.id.includes(id));
  if (!def) return null;
  document.body.innerHTML = "<canvas id='a' width='800' height='800'></canvas>";
  const c = document.getElementById("a").getContext("2d");
  c.fillStyle = "#0b0e12";
  c.fillRect(0, 0, 800, 800);
  const t = new window.__Track(def);
  const bb = t.bounds, pad = 44;
  const sc = Math.min((800 - pad * 2) / (bb.max.x - bb.min.x), (800 - pad * 2) / (bb.max.y - bb.min.y));
  const mx = (bb.min.x + bb.max.x) / 2, my = (bb.min.y + bb.max.y) / 2;
  const P = (x, y) => [400 + (x - mx) * sc, 400 + (y - my) * sc];
  const path = (pts, get) => {
    c.beginPath();
    pts.forEach((p, k) => {
      const [x, y] = P(...get(p));
      k ? c.lineTo(x, y) : c.moveTo(x, y);
    });
    c.closePath();
    c.stroke();
  };
  c.strokeStyle = "#3a4450";
  c.lineWidth = t.halfWidth * 2 * sc;
  c.lineJoin = "round";
  c.lineCap = "round";
  path(t.samples, (s) => [s.pos.x, s.pos.y]);
  c.strokeStyle = "#e2554a";
  c.lineWidth = 1.5;
  path(def.points, (p) => [p[0], p[1]]);
  c.fillStyle = "#e9eef4";
  c.font = "14px sans-serif";
  c.fillText(`${def.name}  ${t.length.toFixed(0)} m  width ${def.width} m`, 14, 24);
  return def.name;
}, id);

if (!name) {
  console.log(`no circuit matching "${id}"`);
  await b.close();
  process.exit(1);
}
await page.screenshot({ path: out });
await b.close();
console.log(`${name} -> ${out}`);
