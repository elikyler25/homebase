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
const COL = { ink: '#e9eef4', dim: '#3a4653', floor: '#131a22' };

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

function drawFighter(g, x, facing, pose, colour, opts = {}) {
  const { ghost = 0, flash = 0, down = false } = opts;
  const lean = pose.lean * facing;
  const hipY = GROUND - 46 * S + pose.crouch * 24 * S;
  const headY = hipY - 46 * S + pose.crouch * 12 * S;

  g.save();
  g.globalAlpha = 1 - ghost;

  // shadow
  g.fillStyle = '#00000066';
  g.beginPath();
  g.ellipse(x, GROUND + 2, (20 - pose.crouch * 4) * S, 4.5, 0, 0, Math.PI * 2);
  g.fill();

  if (down) {
    // flat on the floor: a body lying along the ground, head toward the opponent
    g.strokeStyle = colour; g.lineWidth = 6; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x - 26 * facing, GROUND - 8);
    g.lineTo(x + 19 * facing, GROUND - 12);
    g.stroke();
    g.fillStyle = colour;
    g.beginPath(); g.arc(x + 29 * facing, GROUND - 14, 10, 0, Math.PI * 2); g.fill();
    g.restore();
    return;
  }

  const shoulderX = x + lean * 16 * S;
  const shoulderY = hipY - 34 * S;

  // legs
  g.strokeStyle = colour; g.lineWidth = 5.5; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(x + lean * 5 * S, hipY);
  g.lineTo(x - 12 * S * facing - lean * 4, GROUND);
  g.moveTo(x + lean * 5 * S, hipY);
  g.lineTo(x + 13 * S * facing + lean * 12, GROUND);
  g.stroke();

  // torso
  g.lineWidth = 7.5;
  g.beginPath();
  g.moveTo(x + lean * 5 * S, hipY);
  g.lineTo(shoulderX, shoulderY);
  g.stroke();

  // head
  g.fillStyle = colour;
  g.beginPath();
  g.arc(shoulderX + lean * 5, headY, 11, 0, Math.PI * 2);
  g.fill();

  // weapon arm — the reach of this line is what the range arc is telling you about
  const a = pose.arm * facing;
  const len = (20 + pose.reach * 34) * S;
  const hx = shoulderX + Math.cos(a) * len * facing;
  const hy = shoulderY + Math.sin(a) * len;
  g.strokeStyle = flash ? '#ffffff' : colour;
  g.lineWidth = flash ? 6.5 : 5;
  g.beginPath();
  g.moveTo(shoulderX, shoulderY);
  g.lineTo(hx, hy);
  g.stroke();

  // off arm
  g.globalAlpha = (1 - ghost) * 0.6;
  g.lineWidth = 4.5;
  g.beginPath();
  g.moveTo(shoulderX, shoulderY + 3);
  g.lineTo(shoulderX - 15 * S * facing, shoulderY + 15 * S);
  g.stroke();

  g.restore();
}

/* ---------------------------------------------------------------- arena */

function drawArena(g, shake, top, bot, left, right) {
  g.save();
  g.translate(shake.x, shake.y);
  const L = left - 80, R = right + 80, wide = R - L;

  const sky = g.createLinearGradient(0, top, 0, GROUND);
  sky.addColorStop(0, '#070c12');
  sky.addColorStop(1, '#0c131c');
  g.fillStyle = sky;
  g.fillRect(L, top - 80, wide, GROUND - top + 80);

  // A far backdrop of vertical bars. Parallax at a third of camera speed, which is what
  // makes the movement game legible: you can see yourself crossing the stage.
  g.strokeStyle = '#111a24'; g.lineWidth = 6;
  for (let x = Math.floor(L / 120) * 120; x < R; x += 120) {
    const px = x + (x - (L + R) / 2) * -0.66;
    g.beginPath(); g.moveTo(px, GROUND - 250); g.lineTo(px, GROUND - 30); g.stroke();
  }

  // distance ticks — a quiet ruler so spacing is readable at a glance
  g.strokeStyle = '#18222d'; g.lineWidth = 1.5;
  for (let x = Math.ceil(L / 50) * 50; x < R; x += 50) {
    const tall = x % 250 === 0;
    g.beginPath(); g.moveTo(x, GROUND - (tall ? 22 : 11)); g.lineTo(x, GROUND); g.stroke();
  }

  g.fillStyle = COL.floor;
  g.fillRect(L, GROUND, wide, bot - GROUND + 80);
  g.strokeStyle = '#2b3949'; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(L, GROUND); g.lineTo(R, GROUND); g.stroke();

  // the walls you can be cornered against
  g.fillStyle = '#090f16';
  if (L < RULES.ARENA_MIN) g.fillRect(L, top - 80, RULES.ARENA_MIN - L, GROUND - top + 80);
  if (R > RULES.ARENA_MAX) g.fillRect(RULES.ARENA_MAX, top - 80, R - RULES.ARENA_MAX, GROUND - top + 80);
  g.strokeStyle = '#26333f'; g.lineWidth = 2;
  g.beginPath();
  g.moveTo(RULES.ARENA_MIN, top); g.lineTo(RULES.ARENA_MIN, GROUND);
  g.moveTo(RULES.ARENA_MAX, top); g.lineTo(RULES.ARENA_MAX, GROUND);
  g.stroke();
  g.restore();
}

/** A translucent wedge showing exactly how far a move reaches. */
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
    g.globalAlpha = 0.85;
    g.fillStyle = colour;
    g.font = '600 10px ui-monospace, monospace';
    g.textAlign = facing > 0 ? 'right' : 'left';
    g.fillText(label, tip - 4 * facing, GROUND + 18);
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
    this.groundPx = h * 0.88;   // thin floor strip; the room belongs to the fighters
  }

  /**
   * A camera, the way a fighting game has one: centred between the fighters and zoomed to
   * the distance between them. Drawing the whole 1000-unit arena at a fixed scale instead
   * leaves the fighters tiny at the bottom of an empty screen on any tall display.
   */
  aimCamera(x0, x1, snap = false) {
    const gap = Math.abs(x0 - x1);
    const visW = Math.min(W, Math.max(540, gap + 470));
    const target = {
      scale: Math.min(this.cssW / visW, this.cssH / 300),
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

  /** Put the canvas into world coordinates for the rest of the drawing code. */
  applyTransform() {
    const k = this.dpr * this.scale;
    this.g.setTransform(k, 0, 0, k, this.dpr * (this.cssW / 2 - this.cam.x * this.scale),
      this.dpr * (this.groundPx - GROUND * this.scale));
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
        this.burst(victim, GROUND - 60, e.counter ? 26 : 18, e.counter ? '#ffe066' : sideColour(this.state, e.by));
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

  burst(x, y, n, colour) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 260;
      this.sparks.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        life: 0.2 + Math.random() * 0.32, colour,
      });
    }
  }

  draw() {
    const g = this.g;
    const pos = this.mode === 'playback' && this.result
      ? (this.result.timeline[this.frame]?.x ?? [400, 600])
      : (this.preview ? [pointOf(this.preview.state, 0).x, pointOf(this.preview.state, 1).x] : [400, 600]);
    this.aimCamera(pos[0], pos[1], this.snapCam);
    this.snapCam = false;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.c.width, this.c.height);
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
      g.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
    }
    g.globalAlpha = 1;

    for (const f of this.floats) {
      g.globalAlpha = Math.max(0, Math.min(1, f.life * 1.6));
      g.fillStyle = f.colour;
      g.font = '700 15px ui-monospace, monospace';
      g.textAlign = 'center';
      g.strokeStyle = '#05080c'; g.lineWidth = 3;
      g.strokeText(f.text, f.x, f.y);
      g.fillText(f.text, f.x, f.y);
    }
    g.globalAlpha = 1;
    g.restore();
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

    g.fillStyle = '#2c3846';
    g.font = '600 10px ui-monospace, monospace';
    g.textAlign = 'center';
    g.fillText(`${Math.round(Math.abs(a.x - b.x))} apart`, (a.x + b.x) / 2, GROUND - 108);
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

    g.fillStyle = '#3b4a5c';
    g.font = '700 12px ui-monospace, monospace';
    g.textAlign = 'left';
    g.fillText(`FRAME ${String(this.frame).padStart(2, '0')} / ${r.total}`, this.leftWorld + 16, this.topWorld + 26);

    // Frame advantage, printed once the exchange has settled. YOMIH puts this number
    // right next to the fighters because it is the single thing that decides the next turn.
    if (this.adv != null && this.frame >= r.total) {
      const good = this.adv > 0;
      g.font = '800 26px ui-monospace, monospace';
      g.textAlign = 'center';
      g.fillStyle = this.adv === 0 ? '#9aa7b6' : good ? '#5ef2a0' : '#ff7a8a';
      const label = this.adv > 0 ? `+${this.adv}` : `${this.adv}`;
      g.fillText(label, tl.x[0], GROUND - 150);
      g.font = '700 9px ui-monospace, monospace';
      g.fillStyle = '#5b6876';
      g.fillText(this.adv === 0 ? 'EVEN' : good ? 'YOU ACT FIRST' : 'THEY ACT FIRST', tl.x[0], GROUND - 136);
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
