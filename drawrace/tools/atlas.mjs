// Every circuit's outline in one grid.
//
//   npm run atlas   ->  shots/atlas.png
//
// The cheapest and most brutal review in the project. Thirty layouts can each
// pass `npm run tune`, each be individually defensible, and still be the same
// circuit thirty times — which is exactly what the first version of this image
// showed: five distinct shapes and twenty-five variations on "circle with a
// bite out of it". No amount of reading the coordinates would have told me
// that. Seeing them side by side took one look.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { CHROME } from "./stroke.mjs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
await mkdir(resolve(root, "shots"), { recursive: true });
const out=resolve(root,"shots");
const b=await chromium.launch({executablePath:CHROME,args:["--no-sandbox","--disable-gpu"]});
const ctx=await b.newContext({viewport:{width:1200,height:1000},deviceScaleFactor:1});
const page=await ctx.newPage();
await page.goto(`file://${resolve(root,"dist/index.html")}`);
await page.waitForSelector("#track-list .track-card");
await page.evaluate(() => {
  const g = window.__drawrace;
  // Reach the track list through the menu the game already built.
  const cards = [...document.querySelectorAll("#track-list .track-card")];
  document.body.innerHTML = "<canvas id='atlas' width='1200' height='1000'></canvas>";
  const c = document.getElementById("atlas").getContext("2d");
  c.fillStyle = "#0b0e12"; c.fillRect(0,0,1200,1000);
  const defs = window.__TRACKS;
  const cols = 6, cw = 200, ch = 166;
  defs.forEach((def, i) => {
    const t = new window.__Track(def);
    const bx = (i % cols) * cw, by = Math.floor(i / cols) * ch;
    const bb = t.bounds, pad = 22;
    const sc = Math.min((cw-pad*2)/(bb.max.x-bb.min.x), (ch-pad*2-14)/(bb.max.y-bb.min.y));
    const mx = (bb.min.x+bb.max.x)/2, my=(bb.min.y+bb.max.y)/2;
    c.strokeStyle = {asphalt:"#8fa3b5",gravel:"#c9a86a",ice:"#8fc7e8"}[def.surface];
    c.lineWidth = Math.max(3, t.halfWidth*2*sc);
    c.lineJoin="round"; c.lineCap="round";
    c.beginPath();
    t.samples.forEach((s,k)=>{ const x=bx+cw/2+(s.pos.x-mx)*sc, y=by+ch/2+(s.pos.y-my)*sc-6;
      k?c.lineTo(x,y):c.moveTo(x,y); });
    c.closePath(); c.stroke();
    c.fillStyle="#e9eef4"; c.font="11px sans-serif"; c.textAlign="center";
    c.fillText(def.name, bx+cw/2, by+ch-8);
  });
});
await page.screenshot({ path: `${out}/atlas.png`, clip:{x:0,y:0,width:1200,height:1000} });
await b.close();
