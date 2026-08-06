// Renders every car class large, on both a dark and a light ground, so the
// sprite art can actually be judged. Cars are ~20 px on screen during a race,
// which is far too small to tell "detailed" from "muddy".

import { SPRITE_L, SPRITE_W, carSprite } from "../src/carart";
import { CAR_CLASSES } from "../src/vehicle";

const PPM = 46;
const COLS: string[] = ["#ff5c5c", "#ffd23f", "#4fc3f7", "#c084fc"];

const cv = document.createElement("canvas");
cv.width = Math.ceil(SPRITE_L * PPM * COLS.length);
cv.height = Math.ceil(SPRITE_W * PPM * 3 * 2 + 120);
document.body.style.margin = "0";
document.body.appendChild(cv);
const ctx = cv.getContext("2d")!;

const classes = Object.keys(CAR_CLASSES);
let y = 0;
for (const ground of ["#243026", "#dbe9f1"]) {
  ctx.fillStyle = ground;
  ctx.fillRect(0, y, cv.width, SPRITE_W * PPM * 3 + 60);
  ctx.fillStyle = ground === "#243026" ? "#fff" : "#111";
  ctx.font = "16px system-ui";
  for (const id of classes) {
    ctx.fillText(`${CAR_CLASSES[id].name}`, 8, y + 20);
    COLS.forEach((col, i) => {
      const spr = carSprite(id, col);
      const x = i * SPRITE_L * PPM;
      ctx.save();
      ctx.globalAlpha = 0.36;
      ctx.drawImage(spr.shadow, x + 6, y + 34, SPRITE_L * PPM, SPRITE_W * PPM);
      ctx.restore();
      ctx.drawImage(spr.body, x, y + 28, SPRITE_L * PPM, SPRITE_W * PPM);
    });
    y += SPRITE_W * PPM;
  }
  y += 60;
}
