// Shared browser helper: trace a full lap on the canvas with real pointer events.
//
// Both browser harnesses need this and it is the fiddly part — the stroke has to
// start on the grid, follow the inside of every corner, and be *paced*, because
// how fast the finger moves is the game's only input.

export const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

/** Sample the current track's ideal line into screen space, with a speed each. */
export async function planStroke(page) {
  return page.evaluate(() => {
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
    const pts = [];
    for (let i = 0; i < samples.length; i += 5) {
      // `nor` is the +90 degree rotation of the tangent, so it points at the
      // centre of curvature when curv is positive — the inside is +sign(curv).
      // Getting this backwards traces the outside of every corner, off the road.
      const s = samples[i];
      const off = Math.sign(s.curv) * Math.min(track.halfWidth * 0.55, Math.abs(s.curv) * 900);
      const p = { x: s.pos.x + s.nor.x * off, y: s.pos.y + s.nor.y * off };
      pts.push({ screen: toScreen(p), curv: Math.abs(s.curv) });
    }
    pts.push({ screen: toScreen(samples[0].pos), curv: 0 });

    const car = g.carClass;
    const aMax = car.grip * track.surface.grip * 9.81 * 0.85;
    for (const p of pts) {
      const v = p.curv > 1e-5 ? Math.min(car.maxSpeed, Math.sqrt(aMax / p.curv)) : car.maxSpeed;
      p.v = Math.max(6, v);
    }
    return { pts, lapLength: track.length };
  });
}

/**
 * Draw the lap. Time is spent per point in inverse proportion to the speed that
 * corner allows, which is what a competent player's finger does.
 * `onProgress(i, n)` fires per point, for screenshots mid-stroke.
 */
export async function traceLap(page, { totalMs = 3000, onProgress } = {}) {
  const stroke = await planStroke(page);
  const weights = stroke.pts.map((p) => 1 / p.v);
  const totalW = weights.reduce((a, b) => a + b, 0);
  let acc = 0;

  const [sx, sy] = stroke.pts[0].screen;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  const t0 = Date.now();
  for (let i = 1; i < stroke.pts.length; i++) {
    const [x, y] = stroke.pts[i].screen;
    await page.mouse.move(x, y);
    acc += weights[i];
    const wait = Math.max(0, Math.round((acc / totalW) * totalMs - (Date.now() - t0)));
    if (wait > 0) await page.waitForTimeout(wait);
    if (onProgress) await onProgress(i, stroke.pts.length);
  }
  const drawMs = Date.now() - t0;
  await page.mouse.up();
  return { drawMs, points: stroke.pts.length };
}
