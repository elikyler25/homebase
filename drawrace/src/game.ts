// Game shell: track select -> draw -> race -> results, plus input, camera and HUD.

import { DRIVER_POOL } from "./ai";
import { GameAudio } from "./audio";
import { RacingLine, RawSample } from "./line";
import { Vec2, clamp, formatGap, formatTime, lerp, vdist } from "./math";
import { Race, medalFor, referenceTime } from "./race";
import { Renderer } from "./render";
import { BALLOON_RADIUS, Balloon, SKILL_EVENTS, SkillEvent, placeBalloons } from "./skill";
import { Track } from "./track";
import { TRACKS } from "./tracks";
import { CAR_CLASSES, CarClass } from "./vehicle";

type Phase = "menu" | "draw" | "race" | "results";

/**
 * The career. Three championships, each gated on medals won in the ones before
 * it, so the harder surfaces and the formula cars arrive only once the drawing
 * hand has had some practice on asphalt.
 */
interface Championship {
  tier: 1 | 2 | 3;
  name: string;
  blurb: string;
  /** Medals needed anywhere in the game before this one opens. */
  needs: number;
}

const CHAMPIONSHIPS: Championship[] = [
  { tier: 1, name: "Rookie Cup", blurb: "Learn the line", needs: 0 },
  { tier: 2, name: "National Series", blurb: "Loose surfaces, faster cars", needs: 3 },
  { tier: 3, name: "World League", blurb: "Everything you have", needs: 8 },
];

interface Progress {
  best: Record<string, number>;
  medals: Record<string, "gold" | "silver" | "bronze">;
  /** Best balloon count per skill event. */
  balloons?: Record<string, number>;
  muted?: boolean;
}

const STORE_KEY = "drawrace.progress.v2";
const STORE_KEY_V1 = "drawrace.progress.v1";

/**
 * Results are keyed by circuit AND car class. A lap in a rally car around a GT
 * circuit is a different problem, so filing both under the circuit alone would
 * let a slow car's time overwrite a fast one's and make "best" meaningless.
 */
const resultKey = (trackId: string, classId: string): string => `${trackId}:${classId}`;

function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { best: {}, medals: {}, ...JSON.parse(raw) };
    // Migrate a v1 profile: those entries were keyed by circuit alone, and were
    // always driven in that circuit's default class.
    const old = localStorage.getItem(STORE_KEY_V1);
    if (old) {
      const p = JSON.parse(old) as Progress;
      const out: Progress = { best: {}, medals: {}, muted: p.muted };
      const defaultClass = (id: string) =>
        TRACKS.find((t) => t.id === id)?.classes[0] ?? "gt";
      for (const [id, v] of Object.entries(p.best ?? {})) {
        out.best[resultKey(id, defaultClass(id))] = v;
      }
      for (const [id, v] of Object.entries(p.medals ?? {})) {
        out.medals[resultKey(id, defaultClass(id))] = v;
      }
      return out;
    }
  } catch {
    /* private mode, corrupt payload — a fresh profile is the right fallback */
  }
  return { best: {}, medals: {}, balloons: {} };
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
  private audio = new GameAudio();
  /** Non-null when the current event is a balloon run rather than a race. */
  private skill: SkillEvent | null = null;
  private balloons: Balloon[] = [];
  /** Last countdown integer announced, so pips fire once each. */
  private lastPip = 99;

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
    this.audio.setEnabled(!this.progress.muted);
    this.syncSoundButton();
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
    $("btn-sound").addEventListener("click", () => this.toggleSound());
    $("btn-skip").addEventListener("click", () => this.finishRaceFast());
    $("btn-turbo").addEventListener("click", () => this.tryTurbo());
    $("btn-next").addEventListener("click", () => {
      const i = TRACKS.findIndex((t) => t.id === this.track.def.id);
      // Skip past anything still locked, rather than dropping the player into a
      // championship they have not earned.
      for (let k = 1; k <= TRACKS.length; k++) {
        const next = TRACKS[(i + k) % TRACKS.length];
        if (this.isUnlocked(next.tier)) {
          this.selectTrack(next.id);
          return;
        }
      }
    });
  }

  /**
   * Circuits with at least one medal. Deliberately counts circuits rather than
   * circuit-class pairs: otherwise re-running one track in all three cars would
   * unlock the whole career without ever seeing a second layout.
   */
  private get medalCount(): number {
    const seen = new Set<string>();
    for (const k of Object.keys(this.progress.medals)) seen.add(k.split(":")[0]);
    return seen.size;
  }

  /** Best medal earned on a circuit in any class, for the menu card. */
  private bestMedalFor(trackId: string): "gold" | "silver" | "bronze" | undefined {
    const order = { bronze: 1, silver: 2, gold: 3 } as const;
    let best: "gold" | "silver" | "bronze" | undefined;
    for (const [k, v] of Object.entries(this.progress.medals)) {
      if (k.split(":")[0] !== trackId) continue;
      if (!best || order[v] > order[best]) best = v;
    }
    return best;
  }

  private bestTimeFor(trackId: string): number | undefined {
    let best: number | undefined;
    for (const [k, v] of Object.entries(this.progress.best)) {
      if (k.split(":")[0] !== trackId) continue;
      if (best === undefined || v < best) best = v;
    }
    return best;
  }

  private isUnlocked(tier: number): boolean {
    const c = CHAMPIONSHIPS.find((x) => x.tier === tier);
    return !c || this.medalCount >= c.needs;
  }

  private toggleSound(): void {
    const muted = !this.progress.muted;
    this.progress.muted = muted;
    saveProgress(this.progress);
    this.audio.setEnabled(!muted);
    this.syncSoundButton();
  }

  private syncSoundButton(): void {
    const muted = !!this.progress.muted;
    $("btn-sound").textContent = muted ? "Sound off" : "Sound on";
    $("btn-sound").classList.toggle("muted", muted);
  }

  private buildTrackMenu(): void {
    const list = $("track-list");
    list.innerHTML = "";
    const won = this.medalCount;
    const golds = TRACKS.filter((t) => this.bestMedalFor(t.id) === "gold").length;
    $("career-progress").textContent =
      `${won}/${TRACKS.length} medals · ${golds} gold`;

    for (const champ of CHAMPIONSHIPS) {
      const defs = TRACKS.filter((t) => t.tier === champ.tier);
      if (!defs.length) continue;
      const open = this.isUnlocked(champ.tier);
      const head = document.createElement("div");
      head.className = `tier-head${open ? "" : " locked"}`;
      head.innerHTML = `
        <div class="th-left">
          <div class="th-name">${champ.name}</div>
          <div class="th-blurb">${
            open ? champ.blurb : `Win ${champ.needs - won} more medal${champ.needs - won === 1 ? "" : "s"} to unlock`
          }</div>
        </div>
        <div class="th-count">${
          defs.filter((d) => this.bestMedalFor(d.id)).length
        }/${defs.length}</div>
      `;
      list.appendChild(head);

      for (const def of defs) {
        const card = document.createElement("button");
        card.className = `track-card${open ? "" : " locked"}`;
        if (!open) card.disabled = true;
        const medal = this.bestMedalFor(def.id);
        const best = this.bestTimeFor(def.id);
        card.innerHTML = `
          <div class="tc-top">
            <span class="tc-name">${def.name}</span>
            ${medal ? `<span class="medal ${medal}"></span>` : ""}
          </div>
          <div class="tc-meta">
            <span class="pill surf-${def.surface}">${def.surface}</span>
            <span class="pill">${def.classes.map((c) => CAR_CLASSES[c].name).join(" / ")}</span>
            <span class="pill">${def.laps} laps</span>
          </div>
          <div class="tc-best">${best ? `Best ${formatTime(best)}` : "Not raced"}</div>
        `;
        if (open) card.addEventListener("click", () => this.selectTrack(def.id));
        list.appendChild(card);
      }

      for (const ev of SKILL_EVENTS.filter((e) => e.tier === champ.tier)) {
        const card = document.createElement("button");
        card.className = `track-card skill${open ? "" : " locked"}`;
        if (!open) card.disabled = true;
        const key = resultKey(ev.id, ev.classId);
        const medal = this.progress.medals[key];
        const best = this.progress.balloons?.[key];
        card.innerHTML = `
          <div class="tc-top">
            <span class="tc-name">${ev.name}</span>
            ${medal ? `<span class="medal ${medal}"></span>` : ""}
          </div>
          <div class="tc-meta">
            <span class="pill skillpill">Balloons</span>
            <span class="pill">${CAR_CLASSES[ev.classId].name}</span>
            <span class="pill">${ev.balloons.length} to pop</span>
          </div>
          <div class="tc-best">${
            best !== undefined ? `Best ${best}/${ev.balloons.length}` : "Not attempted"
          }</div>
        `;
        if (open) card.addEventListener("click", () => this.selectSkill(ev.id));
        list.appendChild(card);
      }
    }
  }

  private selectSkill(eventId: string): void {
    const ev = SKILL_EVENTS.find((e) => e.id === eventId);
    if (!ev) return;
    this.skill = ev;
    const def = TRACKS.find((t) => t.id === ev.trackId) ?? TRACKS[0];
    this.track = new Track(def);
    this.carClass = CAR_CLASSES[ev.classId] ?? CAR_CLASSES.gt;
    this.renderer.setTrack(this.track);
    this.balloons = placeBalloons(this.track, ev.balloons);
    this.reference = Infinity;
    $("hud-track").textContent = ev.name;
    $("class-row").classList.add("hidden");
    this.startDraw();
  }

  private selectTrack(id: string, classId?: string): void {
    this.skill = null;
    this.balloons = [];
    const def = TRACKS.find((t) => t.id === id) ?? TRACKS[0];
    this.track = new Track(def);
    const wanted = classId && def.classes.includes(classId) ? classId : def.classes[0];
    this.carClass = CAR_CLASSES[wanted] ?? CAR_CLASSES.gt;
    this.renderer.setTrack(this.track);
    // Medal thresholds are relative to a perfect lap IN THIS CAR, so switching
    // class re-bases them: a gold in the rally car is a gold for the rally car.
    this.reference = referenceTime(this.track, this.carClass.id);
    $("hud-track").textContent = def.name;
    this.buildClassPicker();
    this.startDraw();
  }

  private buildClassPicker(): void {
    const row = $("class-row");
    const defs = this.track.def.classes;
    row.innerHTML = "";
    row.classList.toggle("hidden", defs.length < 2);
    for (const id of defs) {
      const car = CAR_CLASSES[id];
      if (!car) continue;
      const chip = document.createElement("button");
      chip.className = `class-chip${id === this.carClass.id ? " on" : ""}`;
      chip.innerHTML =
        `<span class="cc-dot" style="background:${car.colour}"></span>${car.name}`;
      chip.addEventListener("click", () => {
        if (id === this.carClass.id) return;
        this.selectTrack(this.track.def.id, id);
      });
      row.appendChild(chip);
    }
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
    const line = RacingLine.fromInput(
      this.raw,
      this.carClass.maxSpeed,
      this.carClass.brake,
      true,
    );
    if (!line.valid) {
      this.warn("That line is too short to race — trace the whole lap");
      return;
    }
    // A skill run is a puzzle, not a race: no opponents, one lap.
    const drivers = this.skill ? [] : DRIVER_POOL.slice(0, 4);
    for (const b of this.balloons) b.popped = false;
    this.race = new Race(
      this.track,
      line,
      this.carClass,
      drivers,
      this.carClass,
      this.skill ? this.skill.laps : this.track.def.laps,
    );
    this.renderer.clearMarks();
    this.setPhase("race");
    this.previewLine = line;
    this.lastPip = 99;
    this.audio.startRace();
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

    if (this.skill) {
      this.showSkillResults(me.time);
      return;
    }
    const medal = medalFor(me.time, this.reference, this.track.def.medals);

    const key = resultKey(this.track.def.id, this.carClass.id);
    const prevBest = this.progress.best[key];
    const improved = !prevBest || me.time < prevBest;
    if (improved) this.progress.best[key] = me.time;
    const order = { bronze: 1, silver: 2, gold: 3 } as const;
    const prevMedal = this.progress.medals[key];
    if (medal && (!prevMedal || order[medal] > order[prevMedal])) {
      this.progress.medals[key] = medal;
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

    this.audio.stopRace();
    this.audio.cue("finish");
    this.setPhase("results");
  }

  /**
   * Skill runs are graded on balloons collected, not on lap time. There is no
   * reference lap to scale against — the ideal line through a given set of
   * balloons is a different problem for every layout — so the grade is simply
   * how much of the course you actually cleared.
   */
  private showSkillResults(time: number): void {
    const ev = this.skill!;
    const got = this.balloonsPopped;
    const total = this.balloons.length;
    const frac = total ? got / total : 0;
    const medal: "gold" | "silver" | "bronze" | null =
      got === total ? "gold" : frac >= 0.8 ? "silver" : frac >= 0.6 ? "bronze" : null;

    const key = resultKey(ev.id, ev.classId);
    this.progress.balloons = this.progress.balloons ?? {};
    const prev = this.progress.balloons[key];
    const improved = prev === undefined || got > prev;
    if (improved) this.progress.balloons[key] = got;
    const order = { bronze: 1, silver: 2, gold: 3 } as const;
    const prevMedal = this.progress.medals[key];
    if (medal && (!prevMedal || order[medal] > order[prevMedal])) {
      this.progress.medals[key] = medal;
    }
    saveProgress(this.progress);

    $("result-pos").textContent = `${got}/${total}`;
    $("result-time").textContent = formatTime(time);
    $("result-ref").textContent =
      got === total ? "Every balloon popped" : `${total - got} missed`;
    $("result-best").textContent = improved
      ? "New best"
      : `Best ${prev}/${total}`;
    const medalEl = $("result-medal");
    medalEl.className = medal ? `medal big ${medal}` : "medal big none";
    $("result-medal-label").textContent = medal
      ? medal[0].toUpperCase() + medal.slice(1)
      : "No medal";
    $("result-table").innerHTML = `
      <div class="row me">
        <span class="pos">·</span>
        <span class="dot" style="background:${this.carClass.colour}"></span>
        <span class="nm">${ev.name}</span>
        <span class="tm">${got}/${total}</span>
        <span class="gp"></span>
      </div>`;

    this.audio.stopRace();
    this.audio.cue("finish");
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
    this.audio.unlock();
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
      this.previewLine = RacingLine.fromInput(
        this.raw,
        this.carClass.maxSpeed,
        this.carClass.brake,
        false,
      );
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
      this.audio.cue("turbo");
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
      const pv = this.race.player.vehicle;
      if (this.skill) this.popBalloons(pv.pos);
      this.audio.update({
        speed: pv.telemetry.speed,
        maxSpeed: this.carClass.maxSpeed,
        understeer: pv.telemetry.understeer,
        gripBudget: this.carClass.grip * this.track.surface.grip * 9.81,
        onTrack: pv.telemetry.onTrack,
        turbo: pv.turboTimer > 0,
      });
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

    if (this.skill) r.drawBalloons(this.balloons, BALLOON_RADIUS, this.pulse);

    if (this.phase === "draw") {
      if (this.previewLine) r.drawLine(this.previewLine, { alpha: 0.95 });
      this.drawStartArrow();
    } else if (this.phase === "race" || this.phase === "results") {
      if (this.previewLine) {
        r.drawLine(this.previewLine, { alpha: this.phase === "race" ? 0.26 : 0.85 });
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

  private popBalloons(carPos: Vec2): void {
    for (const b of this.balloons) {
      if (b.popped) continue;
      const dx = b.pos.x - carPos.x;
      const dy = b.pos.y - carPos.y;
      if (dx * dx + dy * dy <= BALLOON_RADIUS * BALLOON_RADIUS) {
        b.popped = true;
        this.audio.cue("pip");
        for (let i = 0; i < 6; i++) {
          this.renderer.addParticle(
            b.pos,
            { x: (Math.random() - 0.5) * 22, y: (Math.random() - 0.5) * 22 },
            "tyre",
          );
        }
      }
    }
  }

  private get balloonsPopped(): number {
    return this.balloons.filter((b) => b.popped).length;
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
    $("hud-pos").textContent = this.skill
      ? `${this.balloonsPopped}/${this.balloons.length}`
      : `${me.position}/${rows.length}`;
    $("hud-pos-label").textContent = this.skill ? "Balloons" : "Pos";
    const laps = this.race.laps;
    $("hud-lap").textContent = `${clamp(v.currentLap, 1, laps)}/${laps}`;
    $("hud-time").textContent = formatTime(this.race.elapsed);
    $("hud-speed").textContent = `${Math.round(v.telemetry.speed * 3.6)}`;
    ($("turbo-fill") as HTMLElement).style.width = `${Math.round(v.turboCharge * 100)}%`;
    $("btn-turbo").classList.toggle("ready", v.turboCharge >= 0.25 && v.turboTimer <= 0);

    const cd = $("countdown");
    if (this.race.state === "countdown") {
      const n = Math.ceil(this.race.countdown - 0.6);
      cd.textContent = n > 0 ? String(n) : "GO";
      cd.classList.remove("hidden");
      if (n !== this.lastPip) {
        this.lastPip = n;
        this.audio.cue(n > 0 ? "pip" : "go");
      }
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
