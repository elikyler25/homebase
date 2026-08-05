// Game shell: track select -> draw -> race -> results, plus input, camera and HUD.

import { DRIVER_POOL } from "./ai";
import { RacingLine, RawSample } from "./line";
import { Vec2, clamp, formatGap, formatTime, lerp, vdist } from "./math";
import { Race, medalFor, referenceTime } from "./race";
import { Renderer } from "./render";
import { Track } from "./track";
import { TRACKS } from "./tracks";
import { CAR_CLASSES, CarClass } from "./vehicle";

type Phase = "menu" | "draw" | "race" | "results";

interface Progress {
  best: Record<string, number>;
  medals: Record<string, "gold" | "silver" | "bronze">;
}

const STORE_KEY = "drawrace.progress.v1";

function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { best: {}, medals: {}, ...JSON.parse(raw) };
  } catch {
    /* private mode, corrupt payload — a fresh profile is the right fallback */
  }
  return { best: {}, medals: {} };
}

function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(p));
  } catch {
    /* nothing to do; progress is a nicety, not a requirement */
  }
}

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el;
};

export class Game {
  private renderer: Renderer;
  private phase: Phase = "menu";
  private track!: Track;
  private carClass: CarClass = CAR_CLASSES.gt;
  private race: Race | null = null;
  private reference = Infinity;
  /** Camera scale at which the whole circuit fits; the race camera works off it. */
  private fitScale = 2;
  private progress = loadProgress();

  // Drawing state
  private drawing = false;
  private raw: RawSample[] = [];
  private previewLine: RacingLine | null = null;
  private lapCovered = 0;
  private lastProjS = 0;
  private strokeStarted = false;

  private lastFrame = 0;
  private pulse = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.bindUi();
    this.bindInput();
    window.addEventListener("resize", () => {
      this.renderer.resize();
      this.fitCamera(true);
    });
    this.buildTrackMenu();
    this.setPhase("menu");
    requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------------- setup

  private bindUi(): void {
    $("btn-retry").addEventListener("click", () => this.startDraw());
    for (const id of ["btn-menu", "btn-menu-2"]) {
      $(id).addEventListener("click", () => this.setPhase("menu"));
    }
    $("btn-clear").addEventListener("click", () => this.resetStroke());
    $("btn-skip").addEventListener("click", () => this.finishRaceFast());
    $("btn-turbo").addEventListener("click", () => this.tryTurbo());
    $("btn-next").addEventListener("click", () => {
      const i = TRACKS.findIndex((t) => t.id === this.track.def.id);
      this.selectTrack(TRACKS[(i + 1) % TRACKS.length].id);
    });
  }

  private buildTrackMenu(): void {
    const list = $("track-list");
    list.innerHTML = "";
    for (const def of TRACKS) {
      const card = document.createElement("button");
      card.className = "track-card";
      const medal = this.progress.medals[def.id];
      const best = this.progress.best[def.id];
      card.innerHTML = `
        <div class="tc-top">
          <span class="tc-name">${def.name}</span>
          ${medal ? `<span class="medal ${medal}"></span>` : ""}
        </div>
        <div class="tc-meta">
          <span class="pill surf-${def.surface}">${def.surface}</span>
          <span class="pill">${CAR_CLASSES[def.classes[0]].name}</span>
          <span class="pill">${def.laps} laps</span>
        </div>
        <div class="tc-best">${best ? `Best ${formatTime(best)}` : "Not raced"}</div>
      `;
      card.addEventListener("click", () => this.selectTrack(def.id));
      list.appendChild(card);
    }
  }

  private selectTrack(id: string): void {
    const def = TRACKS.find((t) => t.id === id) ?? TRACKS[0];
    this.track = new Track(def);
    this.carClass = CAR_CLASSES[def.classes[0]] ?? CAR_CLASSES.gt;
    this.renderer.setTrack(this.track);
    this.reference = referenceTime(this.track, this.carClass.id);
    $("hud-track").textContent = def.name;
    this.startDraw();
  }

  // ---------------------------------------------------------------- phases

  private setPhase(p: Phase): void {
    this.phase = p;
    for (const id of ["screen-menu", "screen-draw", "screen-race", "screen-results"]) {
      $(id).classList.add("hidden");
    }
    $(`screen-${p === "results" ? "results" : p}`).classList.remove("hidden");
    document.body.dataset.phase = p;
    if (p === "menu") {
      this.buildTrackMenu();
      this.race = null;
    }
  }

  private startDraw(): void {
    this.resetStroke();
    this.renderer.clearMarks();
    this.race = null;
    this.setPhase("draw");
    this.fitCamera(true);
    $("draw-hint").textContent = "Trace your line from the start — how fast you draw is how fast you go";
    $("draw-hint").classList.remove("warn");
  }

  private resetStroke(): void {
    this.raw = [];
    this.previewLine = null;
    this.lapCovered = 0;
    this.strokeStarted = false;
    this.drawing = false;
    this.updateDrawProgress();
  }

  private beginRace(): void {
    const line = RacingLine.fromInput(this.raw, this.carClass.maxSpeed, true);
    if (!line.valid) {
      this.warn("That line is too short to race — trace the whole lap");
      return;
    }
    const drivers = DRIVER_POOL.slice(0, 4);
    this.race = new Race(this.track, line, this.carClass, drivers, this.carClass);
    this.renderer.clearMarks();
    this.setPhase("race");
    this.previewLine = line;
  }

  private finishRaceFast(): void {
    if (!this.race) return;
    let guard = 0;
    while (!this.race.finished && guard++ < 6000) this.race.update(1 / 60);
    this.showResults();
  }

  private showResults(): void {
    if (!this.race) return;
    const rows = this.race.standings();
    const me = rows.find((r) => r.isPlayer)!;
    const medal = medalFor(me.time, this.reference, this.track.def.medals);

    const prevBest = this.progress.best[this.track.def.id];
    const improved = !prevBest || me.time < prevBest;
    if (improved) this.progress.best[this.track.def.id] = me.time;
    const order = { bronze: 1, silver: 2, gold: 3 } as const;
    const prevMedal = this.progress.medals[this.track.def.id];
    if (medal && (!prevMedal || order[medal] > order[prevMedal])) {
      this.progress.medals[this.track.def.id] = medal;
    }
    saveProgress(this.progress);

    $("result-pos").textContent = ordinal(me.position);
    $("result-time").textContent = formatTime(me.time);
    $("result-ref").textContent = `${formatGap(me.time - this.reference)} vs reference`;
    const medalEl = $("result-medal");
    medalEl.className = medal ? `medal big ${medal}` : "medal big none";
    medalEl.title = medal ?? "No medal";
    $("result-medal-label").textContent = medal
      ? medal[0].toUpperCase() + medal.slice(1)
      : "No medal";
    $("result-best").textContent = improved
      ? "New personal best"
      : `Best ${formatTime(prevBest ?? Infinity)}`;

    const table = $("result-table");
    table.innerHTML = rows
      .map(
        (r) => `
        <div class="row ${r.isPlayer ? "me" : ""}">
          <span class="pos">${r.position}</span>
          <span class="dot" style="background:${r.colour}"></span>
          <span class="nm">${r.name}</span>
          <span class="tm">${formatTime(r.time)}</span>
          <span class="gp">${r.position === 1 ? "" : formatGap(r.gap)}</span>
        </div>`,
      )
      .join("");

    this.setPhase("results");
  }

  private warn(msg: string): void {
    const el = $("draw-hint");
    el.textContent = msg;
    el.classList.add("warn");
  }

  // ---------------------------------------------------------------- input

  private bindInput(): void {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    c.addEventListener("pointermove", (e) => this.onPointerMove(e));
    c.addEventListener("pointerup", (e) => this.onPointerUp(e));
    c.addEventListener("pointercancel", (e) => this.onPointerUp(e));
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space") {
        e.preventDefault();
        this.tryTurbo();
      }
    });
  }

  private worldOf(e: PointerEvent): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return this.renderer.camera.screenToWorld(
      e.clientX - rect.left,
      e.clientY - rect.top,
      this.renderer.cssWidth,
      this.renderer.cssHeight,
    );
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.phase === "race") {
      this.tryTurbo();
      return;
    }
    if (this.phase !== "draw") return;
    e.preventDefault();
    const p = this.worldOf(e);

    // The stroke has to begin at the start line: it is a lap, not a doodle.
    if (vdist(p, this.track.startPos) > this.track.halfWidth * 3.2) {
      this.warn("Start your line on the grid");
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    this.raw = [{ p, t: e.timeStamp }];
    this.drawing = true;
    this.strokeStarted = true;
    this.lapCovered = 0;
    this.lastProjS = this.track.project(p).s;
    $("draw-hint").classList.remove("warn");
    $("draw-hint").textContent = "Slow through the corners, quick down the straights";
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.drawing || this.phase !== "draw") return;
    e.preventDefault();

    // Coalesced events carry the full touch sample rate. Speed is the input
    // here, so dropping intermediate samples would literally distort the game.
    const events: PointerEvent[] =
      typeof e.getCoalescedEvents === "function" && e.getCoalescedEvents().length
        ? (e.getCoalescedEvents() as PointerEvent[])
        : [e];

    for (const ev of events) {
      const p = this.worldOf(ev);
      const last = this.raw[this.raw.length - 1];
      if (last && vdist(p, last.p) < 0.35) continue;
      this.raw.push({ p, t: ev.timeStamp });

      const s = this.track.project(p).s;
      const d = this.track.wrapDelta(this.lastProjS, s);
      if (Math.abs(d) < this.track.length * 0.2) this.lapCovered += d;
      this.lastProjS = s;
    }

    if (this.raw.length > 3) {
      this.previewLine = RacingLine.fromInput(this.raw, this.carClass.maxSpeed, false);
    }
    this.updateDrawProgress();

    if (this.lapCovered >= this.track.length * 0.985) {
      this.drawing = false;
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be gone */
      }
      this.beginRace();
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.phase !== "draw" || !this.drawing) return;
    e.preventDefault();
    this.drawing = false;
    if (this.lapCovered >= this.track.length * 0.9) {
      this.beginRace();
    } else if (this.strokeStarted) {
      this.warn(
        `Line stops at ${Math.round((this.lapCovered / this.track.length) * 100)}% of the lap — keep going to the finish`,
      );
    }
  }

  private tryTurbo(): void {
    if (this.phase !== "race" || !this.race) return;
    if (this.race.deployPlayerTurbo()) {
      $("btn-turbo").classList.add("fired");
      setTimeout(() => $("btn-turbo").classList.remove("fired"), 220);
    }
  }

  // ---------------------------------------------------------------- camera

  private fitCamera(snap: boolean): void {
    const { min, max } = this.track.bounds;
    // Tight padding: the circuit should fill as much of the screen as it can, so
    // the ribbon the finger has to trace is as wide as possible.
    const pad = 6;
    const w = max.x - min.x + pad * 2;
    const h = max.y - min.y + pad * 2;
    const scale = Math.min(this.renderer.cssWidth / w, this.renderer.cssHeight / h);
    this.fitScale = scale;
    this.renderer.camera.targetCenter = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2 };
    this.renderer.camera.targetScale = scale;
    this.renderer.camera.update(0, snap);
  }

  private raceCamera(dt: number): void {
    if (!this.race) return;
    const v = this.race.player.vehicle;
    const speedT = clamp(v.telemetry.speed / this.carClass.maxSpeed, 0, 1);
    // Lead the camera in the direction of travel, and pull back with speed.
    const lead = 0.45 + speedT * 0.7;
    this.renderer.camera.targetCenter = {
      x: v.pos.x + v.vel.x * lead,
      y: v.pos.y + v.vel.y * lead,
    };
    // Scale relative to the whole-circuit fit rather than a fixed px/m, so the
    // framing holds up whatever size a track is. A fixed zoom looked correct on
    // one layout and filled the screen with infield grass on the others.
    const cam = this.renderer.camera;
    const b = this.track.bounds;

    // "Cover" rather than "contain". The draw view fits the whole circuit, which
    // on a portrait phone leaves a square track floating in grass. For the race,
    // zoom so the track covers the viewport in both axes and pan instead — the
    // cap keeps a wide desktop window from zooming absurdly far in.
    const cover = Math.max(
      this.renderer.cssWidth / Math.max(1, b.max.x - b.min.x),
      this.renderer.cssHeight / Math.max(1, b.max.y - b.min.y),
    );
    const base = clamp(cover, this.fitScale, this.fitScale * 2.4);
    cam.targetScale = Math.max(this.fitScale, base * lerp(1.12, 0.94, speedT));

    // Keep the viewport over the circuit. A follow-cam on a compact track spends
    // half its time pointing at empty grass outside the loop; clamping the centre
    // so the visible rectangle stays within the track bounds fixes the framing
    // without taking the camera off the car.
    const margin = 12;
    const halfW = this.renderer.cssWidth / (2 * cam.targetScale);
    const halfH = this.renderer.cssHeight / (2 * cam.targetScale);
    const midX = (b.min.x + b.max.x) / 2;
    const midY = (b.min.y + b.max.y) / 2;
    const loX = b.min.x - margin + halfW;
    const hiX = b.max.x + margin - halfW;
    const loY = b.min.y - margin + halfH;
    const hiY = b.max.y + margin - halfH;
    // When the view is wider than the track, centre it rather than clamping.
    cam.targetCenter.x = loX > hiX ? midX : clamp(cam.targetCenter.x, loX, hiX);
    cam.targetCenter.y = loY > hiY ? midY : clamp(cam.targetCenter.y, loY, hiY);

    cam.update(dt);
  }

  // ---------------------------------------------------------------- loop

  private frame = (now: number): void => {
    const dt = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, 0.05) : 0.016;
    this.lastFrame = now;
    this.pulse = (Math.sin(now / 320) + 1) / 2;

    if (this.phase === "race" && this.race) {
      this.race.update(dt);
      for (const e of this.race.entrants) {
        for (const s of e.vehicle.skidEmit) {
          this.renderer.addSkid(s.pos, s.heading, s.intensity);
        }
        for (const d of e.vehicle.dustEmit) {
          this.renderer.addParticle(d.pos, d.vel, d.kind);
        }
      }
      this.renderer.stepParticles(dt);
      this.updateRaceHud();
      this.raceCamera(dt);
      if (this.race.finished) this.showResults();
    } else {
      this.renderer.camera.update(dt);
      this.renderer.stepParticles(dt);
    }

    this.draw();
    requestAnimationFrame(this.frame);
  };

  private draw(): void {
    if (!this.track) return;
    const r = this.renderer;
    r.beginFrame();
    r.drawTrackLayer();

    if (this.phase === "draw") {
      if (this.previewLine) r.drawLine(this.previewLine, { alpha: 0.95 });
      this.drawStartArrow();
    } else if (this.phase === "race" || this.phase === "results") {
      if (this.previewLine) {
        r.drawLine(this.previewLine, { alpha: this.phase === "race" ? 0.4 : 0.85 });
      }
      r.drawParticles();
      if (this.race) {
        const lead = this.race.standings()[0];
        for (const e of this.race.entrants) {
          if (e.isPlayer) r.drawPlayerMarker(e, this.pulse);
        }
        for (const e of this.race.entrants) {
          r.drawCar(e, !e.isPlayer && e.name === lead.name);
        }
      }
    }
    r.endFrame();
  }

  /** A chevron on the grid so it is obvious where the stroke has to start. */
  private drawStartArrow(): void {
    if (this.strokeStarted) return;
    const ctx = this.renderer.ctx;
    const smp = this.track.samples[0];
    const a = Math.atan2(smp.tan.y, smp.tan.x);
    ctx.save();
    ctx.translate(smp.pos.x, smp.pos.y);
    ctx.rotate(a);
    ctx.globalAlpha = 0.35 + this.pulse * 0.45;
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 3; i++) {
      const x = 4 + i * 4.5;
      ctx.beginPath();
      ctx.moveTo(x, -3.2);
      ctx.lineTo(x + 3.2, 0);
      ctx.lineTo(x, 3.2);
      ctx.lineTo(x - 1.5, 3.2);
      ctx.lineTo(x + 1.7, 0);
      ctx.lineTo(x - 1.5, -3.2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private updateDrawProgress(): void {
    const pct = clamp((this.lapCovered / this.track.length) * 100, 0, 100);
    ($("draw-bar") as HTMLElement).style.width = `${pct}%`;
    $("draw-pct").textContent = `${Math.round(pct)}%`;
  }

  private updateRaceHud(): void {
    if (!this.race) return;
    const rows = this.race.standings();
    const me = rows.find((r) => r.isPlayer)!;
    const v = this.race.player.vehicle;
    $("hud-pos").textContent = `${me.position}/${rows.length}`;
    $("hud-lap").textContent = `${clamp(v.currentLap, 1, this.track.def.laps)}/${this.track.def.laps}`;
    $("hud-time").textContent = formatTime(this.race.elapsed);
    $("hud-speed").textContent = `${Math.round(v.telemetry.speed * 3.6)}`;
    ($("turbo-fill") as HTMLElement).style.width = `${Math.round(v.turboCharge * 100)}%`;
    $("btn-turbo").classList.toggle("ready", v.turboCharge >= 0.25 && v.turboTimer <= 0);

    const cd = $("countdown");
    if (this.race.state === "countdown") {
      const n = Math.ceil(this.race.countdown - 0.6);
      cd.textContent = n > 0 ? String(n) : "GO";
      cd.classList.remove("hidden");
    } else {
      cd.classList.add("hidden");
    }
  }
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
