// Canvas renderer.
//
// The static track is baked once into an offscreen canvas and blitted under a
// camera transform; only cars, the line, particles and skid marks are redrawn
// per frame. That keeps a phone at 60 fps while still allowing a fairly dense
// track surface (kerbs, edge lines, surface grain).

import { SPRITE_L, SPRITE_W, carSprite } from "./carart";
import { RacingLine } from "./line";
import { Vec2, clamp, damp, lerp, vadd, vscale } from "./math";
import { Entrant } from "./race";
import { Track } from "./track";

export interface Palette {
  ground: string;
  groundAlt: string;
  road: string;
  roadAlt: string;
  edge: string;
  kerbA: string;
  kerbB: string;
  grain: string;
  /** Apron just outside the racing surface — gravel trap, sand, snow bank. */
  runoff: string;
  /** Trackside cover: trees, scrub, drifts. Two tones for depth. */
  scenery: string;
  sceneryAlt: string;
}

export const PALETTES: Record<string, Palette> = {
  asphalt: {
    ground: "#243026",
    groundAlt: "#2b3a2d",
    road: "#3c4148",
    roadAlt: "#44494f",
    edge: "#eef3f7",
    kerbA: "#e63946",
    kerbB: "#f7f7f7",
    grain: "rgba(255,255,255,0.028)",
    runoff: "#6d6a5c",
    scenery: "#1c2a1e",
    sceneryAlt: "#2c4030",
  },
  gravel: {
    ground: "#37421f",
    groundAlt: "#404d26",
    road: "#8d7a5c",
    roadAlt: "#9a8668",
    edge: "#d9cdb4",
    kerbA: "#c4713a",
    kerbB: "#efe3cb",
    grain: "rgba(0,0,0,0.05)",
    runoff: "#5e5138",
    scenery: "#2a3316",
    sceneryAlt: "#3d4a20",
  },
  ice: {
    ground: "#e4eef4",
    groundAlt: "#d6e4ed",
    road: "#a9c9dd",
    roadAlt: "#b6d3e4",
    edge: "#ffffff",
    kerbA: "#5b9bd5",
    kerbB: "#ffffff",
    grain: "rgba(255,255,255,0.06)",
    runoff: "#c6d8e6",
    scenery: "#9fb8c9",
    sceneryAlt: "#b9cede",
  },
};

/**
 * dust  — gravel and grass thrown up by a wheel off the racing surface
 * tyre  — white smoke off a sliding tyre, the visual tell that you overcooked it
 * smoke — turbo exhaust
 */
export type ParticleKind = "dust" | "tyre" | "smoke";

export interface Particle {
  pos: Vec2;
  vel: Vec2;
  life: number;
  maxLife: number;
  size: number;
  kind: ParticleKind;
}

const PARTICLE_SPEC: Record<ParticleKind, { life: [number, number]; size: [number, number]; grow: number; alpha: number; colour: string }> = {
  dust:  { life: [0.7, 1.2], size: [0.5, 1.4], grow: 1.1, alpha: 0.34, colour: "200,180,140" },
  tyre:  { life: [0.6, 1.3], size: [0.4, 1.0], grow: 2.4, alpha: 0.3,  colour: "232,236,240" },
  smoke: { life: [0.45, 0.8], size: [0.4, 1.1], grow: 1.4, alpha: 0.24, colour: "190,215,240" },
};

const BAKE_PPM = 6; // pixels per metre in the baked track layer
const BAKE_PAD = 14; // metres of margin around the track bounds

export class Camera {
  center: Vec2 = { x: 0, y: 0 };
  scale = 2;
  targetCenter: Vec2 = { x: 0, y: 0 };
  targetScale = 2;

  update(dt: number, snap = false): void {
    if (snap) {
      this.center = { ...this.targetCenter };
      this.scale = this.targetScale;
      return;
    }
    this.center = {
      x: damp(this.center.x, this.targetCenter.x, 7, dt),
      y: damp(this.center.y, this.targetCenter.y, 7, dt),
    };
    this.scale = damp(this.scale, this.targetScale, 4.5, dt);
  }

  apply(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.translate(w / 2, h / 2);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-this.center.x, -this.center.y);
  }

  screenToWorld(sx: number, sy: number, w: number, h: number): Vec2 {
    return {
      x: (sx - w / 2) / this.scale + this.center.x,
      y: (sy - h / 2) / this.scale + this.center.y,
    };
  }
}

export class Renderer {
  ctx: CanvasRenderingContext2D;
  camera = new Camera();
  particles: Particle[] = [];

  private trackLayer: HTMLCanvasElement | null = null;
  private skidLayer: HTMLCanvasElement | null = null;
  private skidCtx: CanvasRenderingContext2D | null = null;
  private layerOrigin: Vec2 = { x: 0, y: 0 };
  private palette: Palette = PALETTES.asphalt;

  cssWidth = 0;
  cssHeight = 0;
  dpr = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.cssWidth = Math.max(1, rect.width);
    this.cssHeight = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.cssWidth * this.dpr);
    this.canvas.height = Math.round(this.cssHeight * this.dpr);
  }

  /** Bake the static track. Called once per track load. */
  setTrack(track: Track): void {
    this.palette = PALETTES[track.def.surface] ?? PALETTES.asphalt;
    const { min, max } = track.bounds;
    this.layerOrigin = { x: min.x - BAKE_PAD, y: min.y - BAKE_PAD };
    const w = Math.ceil((max.x - min.x + BAKE_PAD * 2) * BAKE_PPM);
    const h = Math.ceil((max.y - min.y + BAKE_PAD * 2) * BAKE_PPM);

    const layer = document.createElement("canvas");
    layer.width = w;
    layer.height = h;
    const lc = layer.getContext("2d")!;
    this.bakeTrack(lc, track, w, h);
    this.trackLayer = layer;

    const skid = document.createElement("canvas");
    skid.width = w;
    skid.height = h;
    this.skidLayer = skid;
    this.skidCtx = skid.getContext("2d")!;
    this.particles.length = 0;
  }

  clearMarks(): void {
    if (this.skidCtx && this.skidLayer) {
      this.skidCtx.clearRect(0, 0, this.skidLayer.width, this.skidLayer.height);
    }
    this.particles.length = 0;
  }

  private toLayer(p: Vec2): Vec2 {
    return {
      x: (p.x - this.layerOrigin.x) * BAKE_PPM,
      y: (p.y - this.layerOrigin.y) * BAKE_PPM,
    };
  }

  private bakeTrack(
    c: CanvasRenderingContext2D,
    track: Track,
    w: number,
    h: number,
  ): void {
    const pal = this.palette;

    // Ground, with a soft mottle so large flat areas do not read as dead space.
    c.fillStyle = pal.ground;
    c.fillRect(0, 0, w, h);
    c.save();
    for (let i = 0; i < 260; i++) {
      const x = pseudo(i * 3.7) * w;
      const y = pseudo(i * 7.1 + 11) * h;
      const r = 30 + pseudo(i * 2.3) * 120;
      c.globalAlpha = 0.05 + pseudo(i) * 0.05;
      c.fillStyle = pal.groundAlt;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();

    const ribbon = (inset: number): void => {
      c.beginPath();
      const L = track.left;
      const R = track.right;
      const push = (idx: number, sign: number, first: boolean) => {
        const smp = track.samples[idx];
        const p = vadd(smp.pos, vscale(smp.nor, sign * (track.halfWidth - inset)));
        const q = this.toLayer(p);
        if (first) c.moveTo(q.x, q.y);
        else c.lineTo(q.x, q.y);
      };
      for (let i = 0; i < L.length; i++) push(i, 1, i === 0);
      for (let i = R.length - 1; i >= 0; i--) push(i, -1, false);
      c.closePath();
    };

    // Trackside cover, outside the run-off. Placed by walking the centreline and
    // stepping out past the apron, so it hugs the circuit's shape instead of
    // being scattered over the whole field.
    this.bakeScenery(c, track);

    // Run-off apron. `ribbon` insets from the half-width, so a negative inset
    // expands: this is the same outline as the road, just wider.
    c.save();
    c.fillStyle = pal.runoff;
    ribbon(-5.5);
    c.fill();
    c.restore();

    // No canvas shadow on the road fill. The ribbon is an annulus drawn as one
    // path — outer edge forward, inner edge back — so its outline includes a
    // seam straight across the track at s=0. A fill ignores that seam under
    // nonzero winding, but `shadowBlur` traces the whole outline and painted a
    // dark hairline across the start/finish line. The run-off apron already
    // separates road from ground, so the shadow was doing no work anyway.
    c.save();
    c.fillStyle = pal.road;
    ribbon(0);
    c.fill();
    c.restore();

    // Surface grain: fine speckle, clipped to the road.
    c.save();
    ribbon(0);
    c.clip();
    c.fillStyle = pal.roadAlt;
    for (let i = 0; i < 1400; i++) {
      const x = pseudo(i * 1.37 + 3) * w;
      const y = pseudo(i * 5.11 + 17) * h;
      const r = 1 + pseudo(i * 0.7) * 5;
      c.globalAlpha = 0.05 + pseudo(i * 9.3) * 0.14;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
    // A faint racing groove down the middle: tyres have been here before.
    c.globalAlpha = 0.16;
    c.strokeStyle = "rgba(0,0,0,0.5)";
    c.lineWidth = track.halfWidth * 0.55 * BAKE_PPM;
    c.lineCap = "round";
    c.beginPath();
    track.samples.forEach((s, i) => {
      const q = this.toLayer(s.pos);
      if (i === 0) c.moveTo(q.x, q.y);
      else c.lineTo(q.x, q.y);
    });
    c.closePath();
    c.stroke();
    c.restore();

    // Kerbs on the inside and outside of meaningful corners only — a kerb on a
    // straight is noise, and their absence is a legibility cue for the player.
    this.bakeKerbs(c, track);

    // Edge lines.
    c.save();
    c.strokeStyle = pal.edge;
    c.globalAlpha = 0.85;
    c.lineWidth = 0.45 * BAKE_PPM;
    for (const side of [track.left, track.right]) {
      c.beginPath();
      side.forEach((p, i) => {
        const q = this.toLayer(p);
        if (i === 0) c.moveTo(q.x, q.y);
        else c.lineTo(q.x, q.y);
      });
      c.closePath();
      c.stroke();
    }
    c.restore();

    this.bakeStartLine(c, track);
  }

  /**
   * Trees, scrub or snow drifts along both sides of the circuit. Clustered and
   * gated pseudo-randomly so the trackside has rhythm rather than a hedge.
   */
  private bakeScenery(c: CanvasRenderingContext2D, track: Track): void {
    const pal = this.palette;
    const n = track.samples.length;
    c.save();
    for (let i = 0; i < n; i += 7) {
      for (const side of [-1, 1]) {
        const gate = pseudo(i * 0.37 + (side > 0 ? 91 : 17));
        if (gate > 0.42) continue;
        const smp = track.samples[i];
        const clump = 2 + Math.floor(pseudo(i * 1.9 + side) * 3);
        for (let k = 0; k < clump; k++) {
          const off =
            track.halfWidth + 11 + pseudo(i * 3.1 + k * 5.7 + side * 3) * 16;
          const along = (pseudo(i * 2.3 + k * 1.7) - 0.5) * 9;
          const p = vadd(
            vadd(smp.pos, vscale(smp.nor, side * off)),
            vscale(smp.tan, along),
          );
          const q = this.toLayer(p);
          const r = (1.6 + pseudo(i * 4.4 + k) * 2.4) * BAKE_PPM;
          // Shadow first, then the canopy, offset the same way as the cars.
          c.globalAlpha = 0.28;
          c.fillStyle = "#000";
          c.beginPath();
          c.arc(q.x + r * 0.18, q.y + r * 0.24, r, 0, Math.PI * 2);
          c.fill();
          c.globalAlpha = 1;
          c.fillStyle = pseudo(i + k * 2.2) > 0.5 ? pal.scenery : pal.sceneryAlt;
          c.beginPath();
          c.arc(q.x, q.y, r, 0, Math.PI * 2);
          c.fill();
        }
      }
    }
    c.restore();
  }

  private bakeKerbs(c: CanvasRenderingContext2D, track: Track): void {
    const pal = this.palette;
    const n = track.samples.length;
    const stripe = 2.2; // metres per kerb stripe
    c.save();
    c.lineCap = "butt";
    for (let i = 0; i < n; i++) {
      const k = track.samples[i].curv;
      if (Math.abs(k) < 0.009) continue;
      const strength = clamp((Math.abs(k) - 0.009) / 0.03, 0, 1);
      const inner = k > 0 ? 1 : -1; // curvature positive = turning left
      for (const sign of [inner, -inner]) {
        const isInner = sign === inner;
        const width = (isInner ? 1.5 : 1.1) * strength;
        if (width < 0.25) continue;
        const smp = track.samples[i];
        const next = track.samples[(i + 1) % n];
        const off = track.halfWidth - width / 2;
        const a = this.toLayer(vadd(smp.pos, vscale(smp.nor, sign * off)));
        const b = this.toLayer(vadd(next.pos, vscale(next.nor, sign * off)));
        const band = Math.floor(smp.s / stripe) % 2 === 0;
        c.strokeStyle = band ? pal.kerbA : pal.kerbB;
        c.globalAlpha = 0.55 + strength * 0.45;
        c.lineWidth = width * BAKE_PPM;
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
        c.stroke();
      }
    }
    c.restore();
  }

  private bakeStartLine(c: CanvasRenderingContext2D, track: Track): void {
    const smp = track.samples[0];
    const cols = 10;
    const rows = 2;
    const depth = 3.2;
    c.save();
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < cols; i++) {
        const t = (i / cols - 0.5) * 2 * track.halfWidth;
        const t2 = ((i + 1) / cols - 0.5) * 2 * track.halfWidth;
        const d0 = r * (depth / rows);
        const d1 = (r + 1) * (depth / rows);
        const p1 = vadd(vadd(smp.pos, vscale(smp.nor, t)), vscale(smp.tan, d0));
        const p2 = vadd(vadd(smp.pos, vscale(smp.nor, t2)), vscale(smp.tan, d0));
        const p3 = vadd(vadd(smp.pos, vscale(smp.nor, t2)), vscale(smp.tan, d1));
        const p4 = vadd(vadd(smp.pos, vscale(smp.nor, t)), vscale(smp.tan, d1));
        c.fillStyle = (i + r) % 2 === 0 ? "#f4f4f4" : "#1c1f22";
        c.beginPath();
        const q1 = this.toLayer(p1);
        const q2 = this.toLayer(p2);
        const q3 = this.toLayer(p3);
        const q4 = this.toLayer(p4);
        c.moveTo(q1.x, q1.y);
        c.lineTo(q2.x, q2.y);
        c.lineTo(q3.x, q3.y);
        c.lineTo(q4.x, q4.y);
        c.closePath();
        c.fill();
      }
    }
    c.restore();
  }

  addSkid(pos: Vec2, heading: number, intensity: number): void {
    if (!this.skidCtx) return;
    const c = this.skidCtx;
    const p = this.toLayer(pos);
    const len = 1.5 * BAKE_PPM;
    const dx = Math.cos(heading) * len * 0.5;
    const dy = Math.sin(heading) * len * 0.5;
    const nx = -Math.sin(heading) * 0.85 * BAKE_PPM;
    const ny = Math.cos(heading) * 0.85 * BAKE_PPM;
    c.strokeStyle = `rgba(24,22,22,${clamp(intensity * 0.34, 0.03, 0.26)})`;
    c.lineWidth = 0.45 * BAKE_PPM;
    c.lineCap = "round";
    for (const s of [1, -1]) {
      c.beginPath();
      c.moveTo(p.x + nx * s - dx, p.y + ny * s - dy);
      c.lineTo(p.x + nx * s + dx, p.y + ny * s + dy);
      c.stroke();
    }
  }

  addParticle(pos: Vec2, vel: Vec2, kind: ParticleKind): void {
    if (this.particles.length > 360) return;
    const spec = PARTICLE_SPEC[kind];
    const life = spec.life[0] + Math.random() * (spec.life[1] - spec.life[0]);
    this.particles.push({
      pos: { ...pos },
      vel: {
        x: vel.x * 0.35 + (Math.random() - 0.5) * 5,
        y: vel.y * 0.35 + (Math.random() - 0.5) * 5,
      },
      life,
      maxLife: life,
      size: spec.size[0] + Math.random() * (spec.size[1] - spec.size[0]),
      kind,
    });
  }

  stepParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.pos = vadd(p.pos, vscale(p.vel, dt));
      p.vel = vscale(p.vel, Math.exp(-2.6 * dt));
      p.size += dt * PARTICLE_SPEC[p.kind].grow;
    }
  }

  beginFrame(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.palette.ground;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    ctx.save();
    this.camera.apply(ctx, this.cssWidth, this.cssHeight);
  }

  endFrame(): void {
    this.ctx.restore();
  }

  drawTrackLayer(): void {
    if (!this.trackLayer) return;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      this.trackLayer,
      this.layerOrigin.x,
      this.layerOrigin.y,
      this.trackLayer.width / BAKE_PPM,
      this.trackLayer.height / BAKE_PPM,
    );
    if (this.skidLayer) {
      ctx.drawImage(
        this.skidLayer,
        this.layerOrigin.x,
        this.layerOrigin.y,
        this.skidLayer.width / BAKE_PPM,
        this.skidLayer.height / BAKE_PPM,
      );
    }
  }

  /**
   * The drawn line, coloured and sized by requested speed: wide and pale where
   * the player was slow, tapering to a thin red stripe where they were flat out.
   * This is the game's primary readback — you debug your own lap by looking at it.
   */
  drawLine(line: RacingLine, opts: { alpha?: number; upTo?: number; glow?: boolean } = {}): void {
    if (line.nodes.length < 2) return;
    const ctx = this.ctx;
    const alpha = opts.alpha ?? 1;
    const upTo = opts.upTo ?? Infinity;
    const vmax = Math.max(line.maxSpeed, 1);
    const vmin = Math.min(line.minSpeed, vmax - 0.001);

    const widthFor = (sp: number) => {
      const t = clamp((sp - vmin) / Math.max(1e-3, vmax - vmin), 0, 1);
      return lerp(2.9, 1.05, t);
    };
    const colourFor = (sp: number) => {
      const t = clamp((sp - vmin) / Math.max(1e-3, vmax - vmin), 0, 1);
      // pale ice-blue -> amber -> red
      if (t < 0.5) {
        const u = t / 0.5;
        return `rgb(${Math.round(lerp(226, 255, u))},${Math.round(
          lerp(240, 194, u),
        )},${Math.round(lerp(252, 71, u))})`;
      }
      const u = (t - 0.5) / 0.5;
      return `rgb(${Math.round(lerp(255, 255, u))},${Math.round(
        lerp(194, 59, u),
      )},${Math.round(lerp(71, 48, u))})`;
    };

    if (opts.glow !== false) {
      ctx.save();
      ctx.globalAlpha = alpha * 0.22;
      ctx.globalCompositeOperation = "lighter";
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      for (let i = 0; i < line.nodes.length - 1; i++) {
        const a = line.nodes[i];
        if (a.s > upTo) break;
        const b = line.nodes[i + 1];
        ctx.strokeStyle = colourFor(a.speed);
        ctx.lineWidth = widthFor(a.speed) * 2.6;
        ctx.beginPath();
        ctx.moveTo(a.pos.x, a.pos.y);
        ctx.lineTo(b.pos.x, b.pos.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Quad strip: exact variable width, no seams between segments.
    ctx.save();
    ctx.globalAlpha = alpha;
    for (let i = 0; i < line.nodes.length - 1; i++) {
      const a = line.nodes[i];
      if (a.s > upTo) break;
      const b = line.nodes[i + 1];
      const wa = widthFor(a.speed) / 2;
      const wb = widthFor(b.speed) / 2;
      const na = { x: -a.tan.y, y: a.tan.x };
      const nb = { x: -b.tan.y, y: b.tan.x };
      ctx.fillStyle = colourFor((a.speed + b.speed) / 2);
      ctx.beginPath();
      ctx.moveTo(a.pos.x + na.x * wa, a.pos.y + na.y * wa);
      ctx.lineTo(b.pos.x + nb.x * wb, b.pos.y + nb.y * wb);
      ctx.lineTo(b.pos.x - nb.x * wb, b.pos.y - nb.y * wb);
      ctx.lineTo(a.pos.x - na.x * wa, a.pos.y - na.y * wa);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawParticles(): void {
    const ctx = this.ctx;
    ctx.save();
    for (const p of this.particles) {
      const spec = PARTICLE_SPEC[p.kind];
      // Fade in briefly as well as out, so puffs bloom instead of popping.
      const t = p.life / p.maxLife;
      const fade = Math.min(1, (1 - t) * 6) * t;
      ctx.fillStyle = `rgba(${spec.colour},${(fade * spec.alpha).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawCar(e: Entrant, isLeader: boolean): void {
    const ctx = this.ctx;
    const v = e.vehicle;
    const spr = carSprite(v.car.id, e.colour);

    // Shadow. The silhouette rotates with the car but the offset is world-fixed,
    // because the sun does not turn with the vehicle — baking the offset into
    // the rotating sprite would swing the shadow around through the corners.
    ctx.save();
    ctx.globalAlpha = 0.36;
    ctx.translate(v.pos.x + 0.5, v.pos.y + 0.72);
    ctx.rotate(v.heading);
    ctx.drawImage(spr.shadow, -SPRITE_L / 2, -SPRITE_W / 2, SPRITE_L, SPRITE_W);
    ctx.restore();

    ctx.save();
    ctx.translate(v.pos.x, v.pos.y);
    ctx.rotate(v.heading);
    ctx.drawImage(spr.body, -SPRITE_L / 2, -SPRITE_W / 2, SPRITE_L, SPRITE_W);

    if (v.turboTimer > 0) {
      const flare = 1.4 + Math.random() * 1.3;
      const g = ctx.createLinearGradient(-v.car.radius, 0, -v.car.radius - flare, 0);
      g.addColorStop(0, "rgba(160,220,255,0.85)");
      g.addColorStop(1, "rgba(90,160,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-v.car.radius, -0.42);
      ctx.lineTo(-v.car.radius - flare, 0);
      ctx.lineTo(-v.car.radius, 0.42);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    if (isLeader) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 0.16;
      ctx.beginPath();
      ctx.arc(v.pos.x, v.pos.y, v.car.radius * 1.95, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Marker ring drawn under the player's car so it never gets lost in traffic. */
  drawPlayerMarker(e: Entrant, pulse: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${0.28 + pulse * 0.22})`;
    ctx.lineWidth = 0.22;
    ctx.beginPath();
    ctx.arc(e.vehicle.pos.x, e.vehicle.pos.y, e.vehicle.car.radius * (2.4 + pulse * 0.35), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** Deterministic hash-noise in [0,1) — keeps the baked texture stable. */
function pseudo(x: number): number {
  const s = Math.sin(x * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}
