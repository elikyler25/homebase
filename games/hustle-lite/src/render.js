/*
 * HUSTLE LITE — renderer.
 *
 * Draws the arena and replays a `resolveTurn` timeline. It reads the engine's output and
 * never decides anything itself: every position, phase and impact on screen came out of
 * the simulation, so what you watch is exactly what was scored.
 */
import { RULES, MOVES } from './engine.js';

const W = 1000, H = 300;
const GROUND = 246;
const COL = {
  you: '#3fe0cf', them: '#ff5f78',
  youDim: '#1d6f68', themDim: '#7d2f3b',
  ink: '#e9eef4', dim: '#3a4653', floor: '#131a22',
};

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
  const hipY = GROUND - 46 + pose.crouch * 24;
  const headY = hipY - 46 + pose.crouch * 12;

  g.save();
  g.globalAlpha = 1 - ghost;

  // shadow
  g.fillStyle = '#00000066';
  g.beginPath();
  g.ellipse(x, GROUND + 2, 20 - pose.crouch * 4, 4.5, 0, 0, Math.PI * 2);
  g.fill();

  if (down) {
    // flat on the floor: a body lying along the ground, head toward the opponent
    g.strokeStyle = colour; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x - 22 * facing, GROUND - 7);
    g.lineTo(x + 16 * facing, GROUND - 10);
    g.stroke();
    g.fillStyle = colour;
    g.beginPath(); g.arc(x + 24 * facing, GROUND - 12, 8, 0, Math.PI * 2); g.fill();
    g.restore();
    return;
  }

  const shoulderX = x + lean * 16;
  const shoulderY = hipY - 34;

  // legs
  g.strokeStyle = colour; g.lineWidth = 4.5; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(x + lean * 5, hipY);
  g.lineTo(x - 12 * facing - lean * 4, GROUND);
  g.moveTo(x + lean * 5, hipY);
  g.lineTo(x + 13 * facing + lean * 12, GROUND);
  g.stroke();

  // torso
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(x + lean * 5, hipY);
  g.lineTo(shoulderX, shoulderY);
  g.stroke();

  // head
  g.fillStyle = colour;
  g.beginPath();
  g.arc(shoulderX + lean * 5, headY, 9, 0, Math.PI * 2);
  g.fill();

  // weapon arm — the reach of this line is what the range arc is telling you about
  const a = pose.arm * facing;
  const len = 20 + pose.reach * 34;
  const hx = shoulderX + Math.cos(a) * len * facing;
  const hy = shoulderY + Math.sin(a) * len;
  g.strokeStyle = flash ? '#ffffff' : colour;
  g.lineWidth = flash ? 5 : 4;
  g.beginPath();
  g.moveTo(shoulderX, shoulderY);
  g.lineTo(hx, hy);
  g.stroke();

  // off arm
  g.globalAlpha = (1 - ghost) * 0.6;
  g.lineWidth = 3.5;
  g.beginPath();
  g.moveTo(shoulderX, shoulderY + 3);
  g.lineTo(shoulderX - 15 * facing, shoulderY + 15);
  g.stroke();

  g.restore();
}

/* ---------------------------------------------------------------- arena */

function drawArena(g, shake) {
  g.clearRect(0, 0, W, H);
  g.save();
  g.translate(shake.x, shake.y);

  const sky = g.createLinearGradient(0, 0, 0, GROUND);
  sky.addColorStop(0, '#0c1119');
  sky.addColorStop(1, '#0a0f15');
  g.fillStyle = sky;
  g.fillRect(-20, -20, W + 40, GROUND + 20);

  // distance ticks — a quiet ruler so spacing is readable at a glance
  g.strokeStyle = '#141c25'; g.lineWidth = 1;
  for (let x = RULES.ARENA_MIN; x <= RULES.ARENA_MAX; x += 50) {
    g.beginPath(); g.moveTo(x, GROUND - 12); g.lineTo(x, GROUND); g.stroke();
  }

  g.fillStyle = COL.floor;
  g.fillRect(-20, GROUND, W + 40, H - GROUND + 20);
  g.strokeStyle = '#243040'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(-20, GROUND); g.lineTo(W + 20, GROUND); g.stroke();

  // the walls you can be cornered against
  g.fillStyle = '#0e141c';
  g.fillRect(-20, 0, RULES.ARENA_MIN + 20, GROUND);
  g.fillRect(RULES.ARENA_MAX, 0, W - RULES.ARENA_MAX + 20, GROUND);
  g.strokeStyle = '#1d2734';
  g.beginPath();
  g.moveTo(RULES.ARENA_MIN, 0); g.lineTo(RULES.ARENA_MIN, GROUND);
  g.moveTo(RULES.ARENA_MAX, 0); g.lineTo(RULES.ARENA_MAX, GROUND);
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
    this.c.width = W; this.c.height = H;
    this.g = canvas.getContext('2d');
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
  }

  /** Show a static neutral pose — used between turns while you are choosing. */
  setPreview(state, myMove, theirBestMove, showThreat) {
    this.result = null;
    this.playing = false;
    this.preview = { state, myMove, theirBestMove, showThreat };
    this.draw();
  }

  play(result) {
    this.result = result;
    this.preview = null;
    this.frame = 0;
    this.acc = 0;
    this.hitstop = 0;
    this.sparks.length = 0;
    this.trails.length = 0;
    this.playing = true;
  }

  seek(f) {
    if (!this.result) return;
    this.playing = false;
    this.frame = Math.max(0, Math.min(this.result.total, f));
    this.trails.length = 0;
    this.draw();
  }

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
      if (tl.phase[i] === 'active') {
        this.trails.push({ x: tl.x[i], colour: i === 0 ? COL.you : COL.them, life: 0.22 });
      }
    }
    for (const e of tl.events) {
      const victim = tl.x[1 - e.by];
      if (e.type === 'hit') {
        this.shake.mag = Math.min(16, 5 + e.dmg * 0.4);
        this.hitstop = 0.09 + Math.min(0.11, e.dmg * 0.005);
        this.burst(victim, GROUND - 60, 18, e.by === 0 ? COL.you : COL.them);
      } else if (e.type === 'block') {
        this.shake.mag = 3; this.hitstop = 0.05;
        this.burst(victim, GROUND - 60, 8, '#9fb3c8');
      } else if (e.type === 'armour') {
        this.shake.mag = 4; this.hitstop = 0.06;
        this.burst(victim, GROUND - 60, 10, '#ffab5e');
      } else if (e.type === 'parry') {
        this.shake.mag = 7; this.hitstop = 0.19;
        this.burst(tl.x[e.by], GROUND - 60, 22, '#7cc4ff');
      } else if (e.type === 'clash') {
        this.shake.mag = 6; this.hitstop = 0.1;
        this.burst((tl.x[0] + tl.x[1]) / 2, GROUND - 55, 14, '#ffd166');
      }
    }
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
    drawArena(g, this.shake);
    g.save();
    g.translate(this.shake.x, this.shake.y);

    if (this.preview) this.drawPreview(g);
    else if (this.result) this.drawFrame(g);

    for (const t of this.trails) {
      g.globalAlpha = Math.max(0, t.life / 0.22) * 0.35;
      g.strokeStyle = t.colour; g.lineWidth = 3;
      g.beginPath(); g.moveTo(t.x, GROUND - 90); g.lineTo(t.x, GROUND - 10); g.stroke();
    }
    g.globalAlpha = 1;

    for (const s of this.sparks) {
      g.globalAlpha = Math.max(0, Math.min(1, s.life * 3));
      g.fillStyle = s.colour;
      g.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
    }
    g.globalAlpha = 1;
    g.restore();
  }

  drawPreview(g) {
    const { state, myMove, theirBestMove, showThreat } = this.preview;
    const [a, b] = state.fighters;
    const facing = a.x <= b.x ? 1 : -1;

    if (myMove?.range) {
      drawRange(g, a.x, facing, myMove.range, COL.you, false, `${myMove.name} ${myMove.range}`);
    }
    if (showThreat && theirBestMove?.range) {
      drawRange(g, b.x, -facing, theirBestMove.range, COL.them, true, `${theirBestMove.name} ${theirBestMove.range}`);
    }

    drawFighter(g, a.x, facing, poseFor(idlePhase(a), MOVES.jab, 0), COL.you, { down: a.state === 'down' });
    drawFighter(g, b.x, -facing, poseFor(idlePhase(b), MOVES.jab, 0), COL.them, { down: b.state === 'down' });

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

    for (let i = 0; i < 2; i++) {
      const m = r.summary[i].move;
      const ph = tl.phase[i];
      const colour = i === 0 ? COL.you : COL.them;
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

    g.fillStyle = '#33404f';
    g.font = '600 11px ui-monospace, monospace';
    g.textAlign = 'left';
    g.fillText(`FRAME ${String(this.frame).padStart(2, '0')} / ${r.total}`, 16, 24);
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
