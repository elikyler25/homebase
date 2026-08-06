// Top-down car art.
//
// Each class gets a real silhouette rather than a tinted rectangle: a rally
// hatchback with light pods and mud flaps, a GT coupe with haunches and a swan
// wing, an open-wheeler with exposed tyres on outriggers. Drawn once per
// (class, colour) into an offscreen canvas and blitted rotated thereafter —
// re-pathing this much detail every frame for five cars would not hold 60 fps
// on a phone.
//
// Everything is authored in metres with the car pointing along +x, origin at the
// centre of the wheelbase, so the sprite lines up with the physics body.

/** Sprite resolution. Cars are ~4.5 m long and never drawn above ~8 px/m. */
export const SPRITE_PPM = 26;
/** Canvas footprint in metres — wide enough for open-wheel tyres and wings. */
export const SPRITE_L = 5.6;
export const SPRITE_W = 3.0;

type Mode = "body" | "shadow";

/** Multiply a hex colour's channels, clamped. Cheap body shading. */
export function shade(hex: string, mul: number): string {
  const m = hex.replace("#", "");
  const n = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${cl(parseInt(n.slice(0, 2), 16) * mul)},${cl(
    parseInt(n.slice(2, 4), 16) * mul,
  )},${cl(parseInt(n.slice(4, 6), 16) * mul)})`;
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** A tyre, seen from above: dark, slightly rounded, with a faint sidewall. */
function tyre(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, wid: number, mode: Mode): void {
  ctx.fillStyle = mode === "shadow" ? "#000" : "#15181b";
  roundRect(ctx, x - len / 2, y - wid / 2, len, wid, wid * 0.32);
  ctx.fill();
  if (mode === "body") {
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    roundRect(ctx, x - len / 2, y - wid / 2, len, wid * 0.28, wid * 0.14);
    ctx.fill();
  }
}

/** Body shading: light reads as coming from the car's left (-y). */
function bodyGradient(
  ctx: CanvasRenderingContext2D,
  colour: string,
  halfWidth: number,
): CanvasGradient {
  const g = ctx.createLinearGradient(0, -halfWidth, 0, halfWidth);
  g.addColorStop(0, shade(colour, 1.3));
  g.addColorStop(0.42, colour);
  g.addColorStop(1, shade(colour, 0.62));
  return g;
}

function glass(mode: Mode): string {
  return mode === "shadow" ? "#000" : "rgba(20,28,38,0.88)";
}

// --------------------------------------------------------------- rally

function drawRally(ctx: CanvasRenderingContext2D, colour: string, mode: Mode): void {
  const L = 4.3;
  const hw = 0.84; // body half-width
  const axle = 0.9; // tyres sit outboard of the bodywork so they stay readable

  // Wheels first, so the arches overlap them.
  tyre(ctx, L * 0.29, -axle, 0.78, 0.36, mode);
  tyre(ctx, L * 0.29, axle, 0.78, 0.36, mode);
  tyre(ctx, -L * 0.3, -axle, 0.82, 0.38, mode);
  tyre(ctx, -L * 0.3, axle, 0.82, 0.38, mode);

  // Hatchback body: blunt nose, squared tail.
  ctx.fillStyle = mode === "shadow" ? "#000" : bodyGradient(ctx, colour, hw);
  ctx.beginPath();
  ctx.moveTo(L * 0.5, -hw * 0.62);
  ctx.quadraticCurveTo(L * 0.53, 0, L * 0.5, hw * 0.62);
  ctx.lineTo(L * 0.36, hw * 0.94);
  ctx.lineTo(-L * 0.4, hw);
  ctx.quadraticCurveTo(-L * 0.5, hw * 0.95, -L * 0.5, hw * 0.62);
  ctx.lineTo(-L * 0.5, -hw * 0.62);
  ctx.quadraticCurveTo(-L * 0.5, -hw * 0.95, -L * 0.4, -hw);
  ctx.lineTo(L * 0.36, -hw * 0.94);
  ctx.closePath();
  ctx.fill();

  if (mode === "shadow") return;

  // Roof, inset and lighter — reads as the highest surface.
  ctx.fillStyle = shade(colour, 1.12);
  roundRect(ctx, -L * 0.24, -hw * 0.74, L * 0.42, hw * 1.48, 0.24);
  ctx.fill();

  // Windscreen and rear glass.
  ctx.fillStyle = glass(mode);
  ctx.beginPath();
  ctx.moveTo(L * 0.2, -hw * 0.7);
  ctx.lineTo(L * 0.06, -hw * 0.78);
  ctx.lineTo(L * 0.06, hw * 0.78);
  ctx.lineTo(L * 0.2, hw * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-L * 0.26, -hw * 0.72);
  ctx.lineTo(-L * 0.4, -hw * 0.62);
  ctx.lineTo(-L * 0.4, hw * 0.62);
  ctx.lineTo(-L * 0.26, hw * 0.72);
  ctx.closePath();
  ctx.fill();

  // Rally light pod on the bonnet.
  ctx.fillStyle = "rgba(255,250,225,0.95)";
  for (const oy of [-0.42, -0.14, 0.14, 0.42]) {
    ctx.beginPath();
    ctx.arc(L * 0.4, oy, 0.13, 0, Math.PI * 2);
    ctx.fill();
  }

  // Tail lights.
  ctx.fillStyle = "rgba(255,60,45,0.9)";
  roundRect(ctx, -L * 0.5, -hw * 0.72, 0.16, hw * 0.4, 0.06);
  ctx.fill();
  roundRect(ctx, -L * 0.5, hw * 0.32, 0.16, hw * 0.4, 0.06);
  ctx.fill();

  // Roof spoiler.
  ctx.fillStyle = shade(colour, 0.7);
  roundRect(ctx, -L * 0.5, -hw * 0.8, 0.2, hw * 1.6, 0.07);
  ctx.fill();
}

// ------------------------------------------------------------------ GT

function drawGT(ctx: CanvasRenderingContext2D, colour: string, mode: Mode): void {
  const L = 4.55;
  const hw = 0.88; // body half-width
  const axleF = 0.93;
  const axleR = 0.97; // rear track slightly wider, like the real thing

  tyre(ctx, L * 0.31, -axleF, 0.8, 0.35, mode);
  tyre(ctx, L * 0.31, axleF, 0.8, 0.35, mode);
  tyre(ctx, -L * 0.29, -axleR, 0.88, 0.42, mode);
  tyre(ctx, -L * 0.29, axleR, 0.88, 0.42, mode);

  // Coupe: pointed nose, waisted middle, wide rear haunches.
  ctx.fillStyle = mode === "shadow" ? "#000" : bodyGradient(ctx, colour, hw);
  ctx.beginPath();
  ctx.moveTo(L * 0.52, 0);
  ctx.quadraticCurveTo(L * 0.5, -hw * 0.62, L * 0.34, -hw * 0.82);
  ctx.quadraticCurveTo(L * 0.05, -hw * 0.96, -L * 0.12, -hw * 0.86);
  ctx.quadraticCurveTo(-L * 0.34, -hw, -L * 0.46, -hw * 0.92);
  ctx.lineTo(-L * 0.48, hw * 0.92);
  ctx.quadraticCurveTo(-L * 0.34, hw, -L * 0.12, hw * 0.86);
  ctx.quadraticCurveTo(L * 0.05, hw * 0.96, L * 0.34, hw * 0.82);
  ctx.quadraticCurveTo(L * 0.5, hw * 0.62, L * 0.52, 0);
  ctx.closePath();
  ctx.fill();

  if (mode === "shadow") {
    // Wing, so the shadow matches the silhouette.
    roundRect(ctx, -L * 0.54, -hw * 0.98, 0.22, hw * 1.96, 0.06);
    ctx.fill();
    return;
  }

  // Long bonnet highlight.
  ctx.fillStyle = shade(colour, 1.16);
  roundRect(ctx, L * 0.1, -hw * 0.5, L * 0.3, hw, 0.2);
  ctx.fill();

  // Cabin glass, set back.
  ctx.fillStyle = glass(mode);
  ctx.beginPath();
  ctx.moveTo(L * 0.08, -hw * 0.62);
  ctx.lineTo(-L * 0.12, -hw * 0.7);
  ctx.lineTo(-L * 0.24, -hw * 0.5);
  ctx.lineTo(-L * 0.24, hw * 0.5);
  ctx.lineTo(-L * 0.12, hw * 0.7);
  ctx.lineTo(L * 0.08, hw * 0.62);
  ctx.closePath();
  ctx.fill();

  // Livery stripe down the spine — broken either side of the canopy, because a
  // stripe painted straight across the glass reads as a seam, not a livery.
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  roundRect(ctx, L * 0.1, -0.1, L * 0.4, 0.2, 0.05);
  ctx.fill();
  roundRect(ctx, -L * 0.46, -0.1, L * 0.2, 0.2, 0.05);
  ctx.fill();

  // Headlights.
  ctx.fillStyle = "rgba(255,252,235,0.95)";
  roundRect(ctx, L * 0.38, -hw * 0.66, 0.26, 0.22, 0.08);
  ctx.fill();
  roundRect(ctx, L * 0.38, hw * 0.44, 0.26, 0.22, 0.08);
  ctx.fill();

  // Tail lights.
  ctx.fillStyle = "rgba(255,55,40,0.92)";
  roundRect(ctx, -L * 0.49, -hw * 0.74, 0.14, hw * 0.5, 0.05);
  ctx.fill();
  roundRect(ctx, -L * 0.49, hw * 0.24, 0.14, hw * 0.5, 0.05);
  ctx.fill();

  // Swan-neck rear wing, sitting proud of the bodywork.
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  roundRect(ctx, -L * 0.56, -hw * 1.0, 0.26, hw * 2.0, 0.07);
  ctx.fill();
  ctx.fillStyle = shade(colour, 0.66);
  roundRect(ctx, -L * 0.55, -hw * 0.98, 0.22, hw * 1.96, 0.06);
  ctx.fill();
}

// ------------------------------------------------------------- formula

function drawFormula(ctx: CanvasRenderingContext2D, colour: string, mode: Mode): void {
  const L = 5.0;
  const hw = 0.46; // tub half-width — narrow
  const track = 0.82; // half the axle track; tyres sit well outboard

  // Exposed tyres on outriggers.
  for (const [x, w, t] of [
    [L * 0.3, 0.94, 0.36],
    [-L * 0.26, 1.04, 0.44],
  ] as [number, number, number][]) {
    for (const s of [-1, 1]) {
      if (mode === "body") {
        ctx.strokeStyle = shade(colour, 0.55);
        ctx.lineWidth = 0.1;
        ctx.beginPath();
        ctx.moveTo(x, s * hw * 0.6);
        ctx.lineTo(x, s * track);
        ctx.stroke();
      }
      tyre(ctx, x, s * track, w, t, mode);
    }
  }

  // Front wing.
  ctx.fillStyle = mode === "shadow" ? "#000" : shade(colour, 0.8);
  roundRect(ctx, L * 0.4, -track - 0.16, 0.3, (track + 0.16) * 2, 0.06);
  ctx.fill();

  // Rear wing.
  ctx.fillStyle = mode === "shadow" ? "#000" : shade(colour, 0.66);
  roundRect(ctx, -L * 0.52, -track - 0.06, 0.28, (track + 0.06) * 2, 0.06);
  ctx.fill();

  // Tub: needle nose widening to the sidepods.
  ctx.fillStyle = mode === "shadow" ? "#000" : bodyGradient(ctx, colour, hw * 1.6);
  ctx.beginPath();
  ctx.moveTo(L * 0.5, -hw * 0.3);
  ctx.lineTo(L * 0.5, hw * 0.3);
  ctx.quadraticCurveTo(L * 0.2, hw * 0.6, L * 0.02, hw * 1.15);
  ctx.lineTo(-L * 0.3, hw * 1.5);
  ctx.quadraticCurveTo(-L * 0.46, hw * 1.2, -L * 0.5, hw * 0.5);
  ctx.lineTo(-L * 0.5, -hw * 0.5);
  ctx.quadraticCurveTo(-L * 0.46, -hw * 1.2, -L * 0.3, -hw * 1.5);
  ctx.lineTo(L * 0.02, -hw * 1.15);
  ctx.quadraticCurveTo(L * 0.2, -hw * 0.6, L * 0.5, -hw * 0.3);
  ctx.closePath();
  ctx.fill();

  if (mode === "shadow") return;

  // Cockpit opening and the driver's helmet.
  ctx.fillStyle = "rgba(14,20,28,0.9)";
  roundRect(ctx, -L * 0.1, -hw * 0.72, L * 0.24, hw * 1.44, 0.16);
  ctx.fill();
  ctx.fillStyle = "#e9eef4";
  ctx.beginPath();
  ctx.arc(-L * 0.02, 0, 0.26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(20,28,38,0.9)";
  ctx.beginPath();
  ctx.arc(L * 0.02, 0, 0.16, 0, Math.PI * 2);
  ctx.fill();

  // Airbox behind the driver.
  ctx.fillStyle = shade(colour, 1.2);
  ctx.beginPath();
  ctx.moveTo(-L * 0.14, -hw * 0.5);
  ctx.lineTo(-L * 0.34, -hw * 0.34);
  ctx.lineTo(-L * 0.34, hw * 0.34);
  ctx.lineTo(-L * 0.14, hw * 0.5);
  ctx.closePath();
  ctx.fill();

  // Nose flash, so heading is obvious at small sizes.
  ctx.fillStyle = "rgba(255,255,255,0.62)";
  roundRect(ctx, L * 0.22, -hw * 0.2, L * 0.22, hw * 0.4, 0.06);
  ctx.fill();
}

const DRAWERS: Record<string, (c: CanvasRenderingContext2D, colour: string, m: Mode) => void> = {
  rally: drawRally,
  gt: drawGT,
  formula: drawFormula,
};

function render(classId: string, colour: string, mode: Mode): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = Math.ceil(SPRITE_L * SPRITE_PPM);
  cv.height = Math.ceil(SPRITE_W * SPRITE_PPM);
  const ctx = cv.getContext("2d")!;
  ctx.translate(cv.width / 2, cv.height / 2);
  ctx.scale(SPRITE_PPM, SPRITE_PPM);
  if (mode === "shadow") {
    ctx.filter = "blur(0.06px)";
    ctx.globalAlpha = 1;
  }
  (DRAWERS[classId] ?? drawGT)(ctx, colour, mode);
  return cv;
}

const cache = new Map<string, { body: HTMLCanvasElement; shadow: HTMLCanvasElement }>();

/** Cached sprite pair for a car. Built on first use, reused thereafter. */
export function carSprite(
  classId: string,
  colour: string,
): { body: HTMLCanvasElement; shadow: HTMLCanvasElement } {
  const key = `${classId}|${colour}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = { body: render(classId, colour, "body"), shadow: render(classId, colour, "shadow") };
    cache.set(key, hit);
  }
  return hit;
}
