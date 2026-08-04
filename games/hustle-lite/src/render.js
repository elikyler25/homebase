/*
 * HUSTLE LITE — renderer.
 *
 * Draws the arena and replays a `resolveTurn` timeline. It reads the engine's output and
 * never decides anything itself: every position, phase and impact on screen came out of
 * the simulation, so what you watch is exactly what was scored.
 */
import { RULES, CHARS, pointOf } from './engine.js';

const W = 1000, H = 340;
const GROUND = 282;
const S = 1.28;          // fighter scale — YOMIH reads big and bold, not dainty
const COL = { ink: '#ffffff', dim: '#555555', floor: '#000000' };
const PX = 2;            // the scene is drawn this many times smaller, then blitted up
const FONT = '"Press Start 2P", ui-monospace, monospace';

// Player one always reads cool, player two always reads warm, whichever characters are
// picked — you should never have to work out which fighter is yours.
const SIDE_TINT = ['#3fe0cf', '#ff5f78'];
const sideColour = (state, i) => (state ? mixHex(CHARS[pointOf(state, i).char].accent, SIDE_TINT[i], 0.72) : SIDE_TINT[i]);

function mixHex(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [ar, ag, ab] = p(a), [br, bg, bb] = p(b);
  const c = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}

/* ------------------------------------------------------------------ poses */

/*
 * A pose is four numbers: how far the fighter leans, how low they crouch, the angle of
 * the weapon arm, and how far it extends. Everything on screen is derived from the phase
 * the engine reported for that frame, so the animation cannot drift out of sync with it.
 */
function poseFor(phase, m, t) {
  switch (phase) {
    case 'startup': return { lean: -0.22, crouch: 0.1, arm: -2.3, reach: 0.25 + t * 0.1 };
    case 'active': return { lean: 0.42, crouch: 0.06, arm: armAngle(m), reach: 1 };
    case 'recovery': return { lean: 0.16, crouch: 0.18, arm: armAngle(m) + 0.5, reach: 0.55 };
    case 'armour': return { lean: 0.3, crouch: 0.12, arm: -1.9, reach: 0.3 };
    case 'guard': return { lean: -0.1, crouch: m.id === 'lowGuard' ? 0.5 : 0.2, arm: m.id === 'lowGuard' ? 1.1 : -0.55, reach: 0.42 };
    case 'blockstun': return { lean: -0.32, crouch: m.id === 'lowGuard' ? 0.52 : 0.24, arm: m.id === 'lowGuard' ? 1.2 : -0.6, reach: 0.4 };
    case 'parryWindow': return { lean: 0.05, crouch: 0.08, arm: -1.15, reach: 0.6 };
    case 'parryRecover': return { lean: -0.18, crouch: 0.22, arm: -0.2, reach: 0.35 };
    case 'invuln': return { lean: 0.1, crouch: 0.62, arm: 0.9, reach: 0.22 };
    case 'move': return { lean: 0.24, crouch: 0.14, arm: -0.75, reach: 0.34 };
    case 'hustle': return { lean: -0.12, crouch: 0.05, arm: -2.7 + Math.sin(t * 9) * 0.5, reach: 0.5 };
    case 'stun': return { lean: -0.62, crouch: 0.34, arm: 1.5, reach: 0.3 };
    case 'parried': return { lean: -0.75, crouch: 0.4, arm: 1.8, reach: 0.28 };
    default: return { lean: 0, crouch: 0.08, arm: -0.7, reach: 0.35 };
  }
}
const armAngle = (m) => (m.level === 'low' ? 0.95 : m.level === 'high' ? -1.35 : -0.12);

/* --------------------------------------------------------------- fighter */

/*
 * A fighter is a solid silhouette, not a stick figure: a blocky head, a torso that flares
 * at the hips, two legs, and an arm that carries the weapon. Coordinates snap to a coarse
 * grid so the shapes stay square once the scene is blitted up.
 */
const snap = (v) => Math.round(v / 4) * 4;

function drawFighter(g, x, facing, pose, colour, opts = {}) {
  const { ghost = 0, flash = 0, down = false } = opts;
  const lean = pose.lean * facing;
  const crouch = pose.crouch;

  g.save();
  g.globalAlpha = 1 - ghost;
  g.fillStyle = flash ? '#ffffff' : colour;

  if (down) {
    g.fillRect(snap(x - 40 * facing), snap(GROUND - 22), snap(70), snap(22));
    g.fillRect(snap(x + 28 * facing), snap(GROUND - 34), snap(24), snap(24));
    g.restore();
    return;
  }

  const hipY = snap(GROUND - 38 + crouch * 16);
  const shoulderY = snap(hipY - 44);
  const headY = snap(shoulderY - 32);      // leaves a gap: the head is its own shape
  const cx = snap(x + lean * 10);

  // legs, set wide enough apart to read as two
  g.fillRect(snap(cx - 20 - lean * 5), hipY, snap(14), snap(GROUND - hipY));
  g.fillRect(snap(cx + 6 + lean * 10), hipY, snap(14), snap(GROUND - hipY));

  // torso — narrow at the shoulders, flaring to the hips
  const shW = 30, hipW = 40;
  g.beginPath();
  g.moveTo(snap(cx - shW / 2), shoulderY);
  g.lineTo(snap(cx + shW / 2), shoulderY);
  g.lineTo(snap(cx + hipW / 2), hipY + 5);
  g.lineTo(snap(cx - hipW / 2), hipY + 5);
  g.closePath();
  g.fill();

  // head
  g.fillRect(snap(cx - 11 + lean * 6), headY, snap(22), snap(24));

  // The arm and weapon only come out when the pose actually extends. An idle fighter in
  // the source game is a plain silhouette; a raised arm at rest just reads as noise.
  if (pose.reach > 0.42) {
    const a = pose.arm * facing;
    const len = 20 + pose.reach * 34;
    const ax = cx + lean * 5;
    const ay = shoulderY + 8;
    for (let i = 1; i <= 4; i++) {
      const d = (len * i) / 4;
      g.fillRect(snap(ax + Math.cos(a) * d * facing - 5), snap(ay + Math.sin(a) * d - 5), snap(10), snap(10));
    }
    g.fillStyle = flash ? '#ffffff' : '#c2ccd6';
    const bx = ax + Math.cos(a) * len * facing;
    const by = ay + Math.sin(a) * len;
    for (let i = 1; i <= 5; i++) {
      const d = (34 * i) / 5;
      g.fillRect(snap(bx + Math.cos(a) * d * facing - 4), snap(by + Math.sin(a) * d - 4), snap(8), snap(8));
    }
  }

  g.restore();
}

/* ---------------------------------------------------------------- arena */

function drawArena(g, shake, top, bot, left, right) {
  g.save();
  g.translate(shake.x, shake.y);
  const L = left - 80, R = right + 80;

  // Black. Not near-black, not a gradient — the source game is pure black and everything
  // else in the palette is calibrated against it.
  g.fillStyle = '#000';
  g.fillRect(L, top - 120, R - L, bot - top + 240);

  // The floor: one white rule with tall ticks hanging off it. This single element does
  // more to place the game than anything else on screen — it is the spacing readout.
  g.strokeStyle = '#ffffff';
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(L, GROUND); g.lineTo(R, GROUND); g.stroke();
  g.lineWidth = 5;
  for (let x = Math.ceil(L / 100) * 100; x < R; x += 100) {
    g.beginPath(); g.moveTo(x, GROUND + 2); g.lineTo(x, GROUND + 24); g.stroke();
  }

  // The walls, marked rather than shaded.
  g.strokeStyle = '#2e2e2e'; g.lineWidth = 4;
  g.beginPath();
  g.moveTo(RULES.ARENA_MIN, GROUND - 130); g.lineTo(RULES.ARENA_MIN, GROUND);
  g.moveTo(RULES.ARENA_MAX, GROUND - 130); g.lineTo(RULES.ARENA_MAX, GROUND);
  g.stroke();
  g.restore();
}

/** A translucent wedge showing exactly how far a move reaches. */
let activeStage = null;   // the live Stage, so world-space helpers can read the zoom
function drawRange(g, x, facing, range, colour, dashed, label) {
  if (!range) return;
  g.save();
  g.globalAlpha = dashed ? 0.5 : 0.65;
  g.strokeStyle = colour;
  g.lineWidth = 1.5;
  if (dashed) g.setLineDash([5, 5]);
  const tip = x + range * facing;
  g.beginPath();
  g.moveTo(x, GROUND - 4);
  g.lineTo(tip, GROUND - 4);
  g.stroke();
  g.beginPath();
  g.moveTo(tip, GROUND - 16); g.lineTo(tip, GROUND + 6);
  g.stroke();
  g.setLineDash([]);
  if (label) {
    activeStage?.label(label, tip - 8 * facing, GROUND + (dashed ? 96 : 60), colour, 8,
      facing > 0 ? 'right' : 'left');
  }
  g.restore();
}

/* -------------------------------------------------------------- playback */

export class Stage {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.vw = W; this.vh = H;         // world units currently visible
    this.resize();
    new ResizeObserver(() => { this.resize(); this.draw(); }).observe(canvas);
    this.shake = { x: 0, y: 0, mag: 0 };
    this.sparks = [];
    this.trails = [];
    this.result = null;
    this.frame = 0;
    this.acc = 0;
    this.hitstop = 0;
    this.playing = false;
    this.fps = 26;
    this.onFrame = null;
    this.onEnd = null;
    this.preview = null;      // { x:[..], phases, ranges } for the idle/planning view
    this.floats = [];
    this.state = null;        // whose colours to draw with
    this.mode = 'preview';    // 'preview' | 'playback'
    activeStage = this;
    this.boxes = false;       // hitbox / hurtbox overlay
    this.adv = null;          // frame advantage to print once the exchange settles
  }

  /**
   * Match the backing bitmap to the element and work out the world-to-screen transform.
   *
   * The arena is always as wide as the world (so spacing reads the same at any size) and
   * the ground is pinned near the bottom, with whatever vertical room is left becoming sky.
   * Drawing at a fixed aspect instead leaves dead bands above and below on tall screens.
   */
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(320, this.c.clientWidth || W);
    const h = Math.max(180, this.c.clientHeight || H);
    this.c.width = Math.round(w * dpr);
    this.c.height = Math.round(h * dpr);
    this.dpr = dpr;
    this.cssW = w;
    this.cssH = h;
    this.groundPx = h * 0.84;

    // Everything is drawn into a canvas a third of the size and blitted up with smoothing
    // off. That single step is what makes the whole scene — figures, sparks, text — read as
    // chunky pixel art instead of smooth vectors, without redrawing any of it by hand.
    if (!this.off) { this.off = document.createElement('canvas'); this.og = this.off.getContext('2d'); }
    this.off.width = Math.max(120, Math.round(w / PX));
    this.off.height = Math.max(80, Math.round(h / PX));
  }

  /**
   * A camera, the way a fighting game has one: centred between the fighters and zoomed to
   * the distance between them. Drawing the whole 1000-unit arena at a fixed scale instead
   * leaves the fighters tiny at the bottom of an empty screen on any tall display.
   */
  aimCamera(x0, x1, snap = false) {
    const gap = Math.abs(x0 - x1);
    const visW = Math.min(W + 40, Math.max(840, gap + 620));
    const target = {
      scale: Math.min(this.cssW / visW, this.cssH / 260),
      x: Math.max(RULES.ARENA_MIN - 30, Math.min(RULES.ARENA_MAX + 30, (x0 + x1) / 2)),
    };
    if (!this.cam || snap) this.cam = { ...target };
    else {
      this.cam.scale += (target.scale - this.cam.scale) * 0.18;
      this.cam.x += (target.x - this.cam.x) * 0.18;
    }
    const s = this.cam.scale;
    this.scale = s;
    this.topWorld = GROUND - this.groundPx / s;
    this.botWorld = this.topWorld + this.cssH / s;
    this.leftWorld = this.cam.x - this.cssW / (2 * s);
    this.rightWorld = this.leftWorld + this.cssW / s;
  }

  /** World point to offscreen pixel, for text that must not scale with the camera. */
  toScreen(wx, wy) {
    return [
      (this.cssW / 2 - this.cam.x * this.scale + wx * this.scale) / PX,
      (this.groundPx + (wy - GROUND) * this.scale) / PX,
    ];
  }

  /**
   * Draw labels at a fixed pixel size regardless of zoom. Text drawn in world units grows
   * and shrinks with the camera, which at close range turns a caption into a billboard.
   */
  label(text, wx, wy, colour, size = 8, align = 'center') {
    const g = this.og;
    const [x, y] = this.toScreen(wx, wy);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = colour;
    g.font = `${size}px ${FONT}`;
    g.textAlign = align;
    g.fillText(text, Math.round(x), Math.round(y));
    g.restore();
  }

  /** Put the offscreen canvas into world coordinates for the rest of the drawing code. */
  applyTransform() {
    const k = this.scale / PX;
    this.og.setTransform(k, 0, 0, k, (this.cssW / 2 - this.cam.x * this.scale) / PX,
      (this.groundPx - GROUND * this.scale) / PX);
  }

  /** Show a static neutral pose — used between turns while you are choosing. */
  setPreview(state, myMove, theirBestMove, showThreat) {
    this.playing = false;
    this.mode = 'preview';
    this.state = state;
    this.preview = { state, myMove, theirBestMove, showThreat };
    this.draw();
  }

  play(result, state, adv = null) {
    if (state) this.state = state;
    this.snapCam = true;
    this.result = result;
    this.adv = adv;
    this.mode = 'playback';
    this.frame = 0;
    this.acc = 0;
    this.hitstop = 0;
    this.sparks.length = 0;
    this.trails.length = 0;
    this.floats.length = 0;
    this.playing = true;
  }

  /** Scrubbing works whenever an exchange has been resolved, playing or not. */
  seek(f) {
    if (!this.result) return;
    this.playing = false;
    this.mode = 'playback';
    this.frame = Math.max(0, Math.min(this.result.total, f));
    this.trails.length = 0;
    this.draw();
  }
  get scrubbable() { return !!this.result; }

  update(dt) {
    // decay shake and particles even while paused, so a scrubbed frame settles cleanly
    this.shake.mag *= Math.pow(0.001, dt);
    const ang = Math.random() * Math.PI * 2;
    this.shake.x = Math.cos(ang) * this.shake.mag;
    this.shake.y = Math.sin(ang) * this.shake.mag * 0.6;
    for (const s of this.sparks) { s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 900 * dt; }
    this.sparks = this.sparks.filter((s) => s.life > 0);
    for (const t of this.trails) t.life -= dt;
    this.trails = this.trails.filter((t) => t.life > 0);
    for (const f of this.floats) { f.life -= dt; f.y -= dt * 34; }
    this.floats = this.floats.filter((f) => f.life > 0);

    if (this.playing && this.result) {
      if (this.hitstop > 0) this.hitstop -= dt;
      else {
        this.acc += dt * this.fps;
        while (this.acc >= 1) {
          this.acc -= 1;
          if (this.frame >= this.result.total) { this.playing = false; this.onEnd?.(); break; }
          this.frame++;
          this.enterFrame(this.frame);
        }
      }
    }
    this.draw();
  }

  enterFrame(f) {
    const tl = this.result.timeline[f];
    if (!tl) return;
    this.onFrame?.(f);
    for (let i = 0; i < 2; i++) {
      if (tl.phase[i] === 'active' || tl.phase[i] === 'startup') {
        const m = this.result.summary[i].move;
        this.trails.push({
          x: tl.x[i], colour: sideColour(this.state, i), life: 0.3,
          facing: (tl.x[0] <= tl.x[1] ? 1 : -1) * (i === 0 ? 1 : -1),
          pose: poseFor(tl.phase[i], m, f / 10),
        });
      }
    }
    for (const e of tl.events) {
      const victim = tl.x[1 - e.by];
      if (e.type === 'hit') {
        this.shake.mag = Math.min(16, 5 + e.dmg * 0.4);
        this.hitstop = 0.09 + Math.min(0.11, e.dmg * 0.005);
        this.confetti(victim, GROUND - 110, e.counter ? 30 : 22);
        this.float(victim, GROUND - 96, `${e.counter ? 'COUNTER ' : ''}${e.dmg}`, e.counter ? '#ffe066' : '#ffffff');
      } else if (e.type === 'block') {
        this.shake.mag = 3; this.hitstop = 0.05;
        this.burst(victim, GROUND - 60, 8, '#9fb3c8');
        this.float(victim, GROUND - 92, 'GUARD', '#9fb3c8');
      } else if (e.type === 'armour') {
        this.shake.mag = 4; this.hitstop = 0.06;
        this.burst(victim, GROUND - 60, 10, '#ffab5e');
        this.float(victim, GROUND - 92, 'ARMOUR', '#ffab5e');
      } else if (e.type === 'parry') {
        this.shake.mag = 7; this.hitstop = 0.19;
        this.burst(tl.x[e.by], GROUND - 60, 22, '#7cc4ff');
        this.float(tl.x[e.by], GROUND - 100, 'PARRY', '#7cc4ff');
      } else if (e.type === 'clash') {
        this.shake.mag = 6; this.hitstop = 0.1;
        this.burst((tl.x[0] + tl.x[1]) / 2, GROUND - 55, 14, '#ffd166');
      }
    }
  }

  /** A damage number that drifts up and fades — the fastest way to read an exchange. */
  float(x, y, text, colour) {
    this.floats.push({ x, y, text, colour, life: 0.95 });
  }

  /** Multicoloured impact confetti, the way the source game punctuates a clean hit. */
  confetti(x, y, n) {
    const palette = ['#ffe14d', '#ff5f78', '#7dffb0', '#6fd8ff', '#c39bff', '#ffffff', '#ff9f43'];
    for (let i = 0; i < n; i++) this.burst(x, y, 1, palette[i % palette.length]);
  }

  burst(x, y, n, colour) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 90 + Math.random() * 360;
      this.sparks.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 90,
        life: 0.22 + Math.random() * 0.4, colour, size: 7 + Math.round(Math.random() * 3) * 5,
      });
    }
  }

  draw() {
    if (!this.off) this.resize();
    const g = this.og;
    const pos = this.mode === 'playback' && this.result
      ? (this.result.timeline[this.frame]?.x ?? [400, 600])
      : (this.preview ? [pointOf(this.preview.state, 0).x, pointOf(this.preview.state, 1).x] : [400, 600]);
    this.aimCamera(pos[0], pos[1], this.snapCam);
    this.snapCam = false;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#000';
    g.fillRect(0, 0, this.off.width, this.off.height);
    this.applyTransform();
    drawArena(g, this.shake, this.topWorld, this.botWorld, this.leftWorld, this.rightWorld);
    g.save();
    g.translate(this.shake.x, this.shake.y);

    if (this.mode === 'playback' && this.result) this.drawFrame(g);
    else if (this.preview) this.drawPreview(g);

    // After-images. Ghosts of the frames just gone, which is how you read a swing.
    for (const tr of this.trails) {
      const a = Math.max(0, tr.life / 0.3);
      drawFighter(g, tr.x, tr.facing, tr.pose, tr.colour, { ghost: 1 - a * 0.3 });
    }
    g.globalAlpha = 1;

    for (const s of this.sparks) {
      g.globalAlpha = Math.max(0, Math.min(1, s.life * 3));
      g.fillStyle = s.colour;
      const sz = s.size ?? 8;
      g.fillRect(Math.round(s.x / 6) * 6, Math.round(s.y / 6) * 6, sz, sz);
    }
    g.globalAlpha = 1;

    g.globalAlpha = 1;
    g.restore();

    for (const f of this.floats) {
      this.og.globalAlpha = Math.max(0, Math.min(1, f.life * 1.6));
      this.label(f.text, f.x, f.y, f.colour, 8);
      this.og.globalAlpha = 1;
    }

    // Blit the low-res scene up with smoothing off — this is the pixel look.
    const v = this.g;
    v.setTransform(1, 0, 0, 1, 0, 0);
    v.imageSmoothingEnabled = false;
    v.clearRect(0, 0, this.c.width, this.c.height);
    v.drawImage(this.off, 0, 0, this.off.width, this.off.height, 0, 0, this.c.width, this.c.height);
  }

  drawPreview(g) {
    const { state, myMove, theirBestMove, showThreat } = this.preview;
    const [a, b] = [pointOf(state, 0), pointOf(state, 1)];
    const facing = a.x <= b.x ? 1 : -1;

    if (myMove?.range) {
      drawRange(g, a.x, facing, myMove.range, sideColour(state, 0), false, `${myMove.name} ${myMove.range}`);
    }
    if (showThreat && theirBestMove?.range) {
      drawRange(g, b.x, -facing, theirBestMove.range, sideColour(state, 1), true, `${theirBestMove.name} ${theirBestMove.range}`);
    }

    const stub = { id: '', level: 'mid' };
    drawFighter(g, a.x, facing, poseFor(idlePhase(a), stub, 0), sideColour(state, 0), { down: a.state === 'down' });
    drawFighter(g, b.x, -facing, poseFor(idlePhase(b), stub, 0), sideColour(state, 1), { down: b.state === 'down' });

    // "You" over your own fighter, exactly as the source game labels the sides.
    this.label('You', a.x, GROUND - 122, '#ffffff', 8);
    this.label(`${Math.round(Math.abs(a.x - b.x))} apart`, (a.x + b.x) / 2, GROUND - 168, '#5a5a5a', 8);
  }

  drawFrame(g) {
    const r = this.result;
    const tl = r.timeline[this.frame];
    if (!tl) return;
    const facing = tl.x[0] <= tl.x[1] ? 1 : -1;

    if (this.boxes) this.drawBoxes(g, tl, facing);

    for (let i = 0; i < 2; i++) {
      const m = r.summary[i].move;
      const ph = tl.phase[i];
      const colour = sideColour(this.state, i);
      const face = i === 0 ? facing : -facing;
      const flash = ph === 'active' || ph === 'parryWindow';
      if (ph === 'active') drawRange(g, tl.x[i], face, m.range, colour, false, null);
      drawFighter(g, tl.x[i], face, poseFor(ph, m, this.frame / 10), colour, {
        flash: flash ? 1 : 0,
        ghost: ph === 'invuln' ? 0.55 : 0,
        down: false,
      });
      if (ph === 'parryWindow') {
        g.strokeStyle = '#7cc4ff'; g.lineWidth = 2; g.globalAlpha = 0.8;
        g.beginPath(); g.arc(tl.x[i], GROUND - 62, 30, 0, Math.PI * 2); g.stroke();
        g.globalAlpha = 1;
      }
      if (ph === 'armour') {
        g.strokeStyle = '#ffab5e'; g.lineWidth = 2; g.globalAlpha = 0.7;
        g.beginPath(); g.arc(tl.x[i], GROUND - 62, 26, 0, Math.PI * 2); g.stroke();
        g.globalAlpha = 1;
      }
    }

    // Called assists. Drawn a touch smaller and tinted to their own character, so it is
    // obvious at a glance that a second body just arrived and whose it is.
    for (const ex of tl.extras ?? []) {
      const face = ex.team === 0 ? facing : -facing;
      const colour = mixHex(CHARS[ex.char].accent, SIDE_TINT[ex.team], 0.3);
      g.save();
      g.translate(ex.x, GROUND);
      g.scale(0.86, 0.86);
      g.translate(-ex.x, -GROUND);
      drawFighter(g, ex.x, face, poseFor(ex.phase, { id: '', level: 'mid' }, this.frame / 10), colour, {
        ghost: 0.14, flash: ex.phase === 'active' ? 1 : 0,
      });
      g.restore();
      g.fillStyle = colour;
      g.globalAlpha = 0.85;
      g.font = '700 9px ui-monospace, monospace';
      g.textAlign = 'center';
      g.fillText(CHARS[ex.char].name.toUpperCase(), ex.x, GROUND - 116);
      g.globalAlpha = 1;
    }

    this.label(`frame ${this.frame} / ${r.total}`, this.leftWorld + 34, this.topWorld + 46, '#5e5e5e', 8, 'left');
    this.label('You', tl.x[0], GROUND - 122, '#ffffff', 8);

    // Frame advantage, printed once the exchange has settled. YOMIH puts this number
    // right next to the fighters because it is the single thing that decides the next turn.
    if (this.adv != null && this.frame >= r.total) {
      const n = this.adv > 0 ? `+${this.adv}` : `${this.adv}`;
      const col = this.adv === 0 ? '#cfd6dd' : this.adv > 0 ? '#7dffb0' : '#ff6b7f';
      this.label(`advantage: ${n}`, (tl.x[0] + tl.x[1]) / 2, GROUND + 96, col, 10);
    }
  }

  /**
   * Hitbox / hurtbox overlay, the way the source game shows it: a blue box for what can be
   * hit and a red one for what is hitting. Turning this on is the fastest way to understand
   * why a move whiffed — the reach is drawn, not described.
   */
  drawBoxes(g, tl, facing) {
    const r = this.result;
    const bodyW = 46, bodyH = 112;
    for (let i = 0; i < 2; i++) {
      const x = tl.x[i];
      g.strokeStyle = '#4aa8ff'; g.lineWidth = 1.5; g.globalAlpha = 0.55;
      g.strokeRect(x - bodyW / 2, GROUND - bodyH, bodyW, bodyH);
      g.fillStyle = '#4aa8ff14';
      g.fillRect(x - bodyW / 2, GROUND - bodyH, bodyW, bodyH);

      const m = r.summary[i].move;
      if (tl.phase[i] === 'active' && m.range) {
        const face = i === 0 ? facing : -facing;
        const top = m.level === 'high' ? GROUND - bodyH - 6
          : m.level === 'low' ? GROUND - 40 : GROUND - 86;
        const h = m.level === 'low' ? 40 : 46;
        const w = m.range;
        g.globalAlpha = 0.9;
        g.strokeStyle = '#ff4d63'; g.lineWidth = 2;
        g.strokeRect(face > 0 ? x : x - w, top, w, h);
        g.fillStyle = '#ff4d6322';
        g.fillRect(face > 0 ? x : x - w, top, w, h);
      }
      if (tl.phase[i] === 'invuln' || tl.phase[i] === 'parryWindow') {
        g.globalAlpha = 0.8;
        g.strokeStyle = tl.phase[i] === 'invuln' ? '#9aa7b6' : '#7cc4ff';
        g.setLineDash([4, 4]); g.lineWidth = 2;
        g.strokeRect(x - bodyW / 2 - 3, GROUND - bodyH - 3, bodyW + 6, bodyH + 6);
        g.setLineDash([]);
      }
    }
    g.globalAlpha = 1;
  }
}

const idlePhase = (f) => (f.state === 'down' ? 'stun' : f.state === 'stunned' ? 'stun' : 'idle');

/* ----------------------------------------------------------------- sound */

/** Tiny synthesised blips. No assets, no network, and easy to mute. */
export class Sfx {
  constructor() { this.ctx = null; this.on = true; }
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  blip(freq, dur, type = 'square', vol = 0.05) {
    if (!this.on) return;
    const c = this.ensure();
    if (!c) return;
    const o = c.createOscillator(), gn = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.5), c.currentTime + dur);
    gn.gain.setValueAtTime(vol, c.currentTime);
    gn.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(gn).connect(c.destination);
    o.start(); o.stop(c.currentTime + dur);
  }
  event(type) {
    if (type === 'hit') this.blip(180, 0.16, 'square', 0.07);
    else if (type === 'block') this.blip(320, 0.07, 'triangle', 0.04);
    else if (type === 'armour') this.blip(140, 0.1, 'sawtooth', 0.045);
    else if (type === 'parry') this.blip(880, 0.2, 'triangle', 0.06);
    else if (type === 'clash') this.blip(520, 0.12, 'sawtooth', 0.05);
  }
  click() { this.blip(660, 0.03, 'triangle', 0.025); }
}

export { W as STAGE_W, H as STAGE_H };
