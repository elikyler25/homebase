// Screens, input and the frame loop for the slot game.
//
// The input is one boolean. Everything else on screen exists to tell the player
// how close the corner is to the grip budget, because with no steering that is
// the only decision they have and the only thing they can get better at.

import { GameAudio } from "../audio";
import { clamp, formatTime } from "../math";
import { Renderer } from "../render";
import { Track } from "../track";
import { TRACKS } from "../tracks";
import { CAR_CLASSES } from "../vehicle";
import { Lane, makeLanes } from "./lane";
import { MARSHAL_DELAY } from "./slotcar";
import {
  SLOT_DT,
  SlotRace,
  SlotStanding,
  slotMedals,
  slotReferenceTime,
} from "./slotrace";

const $ = (id: string): HTMLElement => document.getElementById(id)!;

// Skill is planning margin, and 0.93 is very nearly the fastest lap the circuit
// has. A field that all but matches the reference means a first-timer races
// nobody -- they watch three cars leave. Pulled back so the top car is beatable
// by someone driving well rather than perfectly.
const RIVALS = [
  { name: "Aalto", colour: "#4fc3f7", skill: 0.84 },
  { name: "Bergman", colour: "#ffd23f", skill: 0.72 },
  { name: "Costa", colour: "#9ccc65", skill: 0.58 },
];

/** Two, not three. Long enough to recover from a deslot, short enough to retry. */
const LAPS = 2;

interface Progress {
  best: Record<string, number>;
  medals: Record<string, string>;
}

export class SlotGame {
  private renderer: Renderer;
  private audio = new GameAudio();
  private track!: Track;
  private lanes: Lane[] = [];
  /** Public so the browser harness can read the state it cannot see. */
  race: SlotRace | null = null;
  private trackIndex = 0;
  /** Best achievable time for ONE lap. Scaled by the race's own lap count at
   * the flag rather than by a constant: the browser harness shortens a race to
   * a single lap, and a medal measured against a three-lap yardstick handed it
   * gold for finishing last. */
  private lapReference = 0;
  private phase: "menu" | "race" | "result" = "menu";
  private held = false;
  private last = 0;
  private accumulator = 0;
  private progress: Progress = { best: {}, medals: {} };
  /** Cleanest lap of the race, for the post-race note. */
  private deslotsThisRace = 0;
  private lastPip = 99;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.load();
    this.buildMenu();
    this.wire();
    window.addEventListener("resize", () => this.renderer.resize());
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---- persistence ----
  private load(): void {
    try {
      const raw = localStorage.getItem("slotracer.progress.v1");
      if (raw) this.progress = { best: {}, medals: {}, ...JSON.parse(raw) };
    } catch {
      /* a corrupt or unavailable store must not stop the game starting */
    }
  }
  private save(): void {
    try {
      localStorage.setItem("slotracer.progress.v1", JSON.stringify(this.progress));
    } catch {
      /* private browsing: play on, just do not remember */
    }
  }

  // ---- menu ----
  private buildMenu(): void {
    const list = $("track-list");
    list.innerHTML = "";
    TRACKS.forEach((def, i) => {
      const b = document.createElement("button");
      b.className = "track-card";
      const best = this.progress.best[def.id];
      const medal = this.progress.medals[def.id];
      b.innerHTML =
        `<div class="name">${def.name}</div>` +
        `<div class="meta">${def.surface} · ${Math.round(new Track(def).length)} m · 4 slots</div>` +
        (best ? `<div class="best">${formatTime(best)}${medal ? ` · ${medal}` : ""}</div>` : "");
      b.addEventListener("click", () => this.startRace(i));
      list.appendChild(b);
    });
  }

  private wire(): void {
    const t = $("throttle");
    const down = (e: Event): void => {
      e.preventDefault();
      this.held = true;
      t.classList.add("held");
      this.audio.unlock();
    };
    const up = (e: Event): void => {
      e.preventDefault();
      this.held = false;
      t.classList.remove("held");
    };
    // Pointer events cover touch and mouse; `pointercancel` matters because a
    // finger dragged off the button would otherwise leave the throttle stuck on.
    t.addEventListener("pointerdown", down);
    t.addEventListener("pointerup", up);
    t.addEventListener("pointercancel", up);
    t.addEventListener("pointerleave", up);
    // Keyboard for desktop: space or either arrow, same one bit.
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (e.code === "Space" || e.code === "ArrowUp") { down(e); }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space" || e.code === "ArrowUp") { up(e); }
    });

    $("btn-quit").addEventListener("click", () => this.toMenu());
    $("r-menu").addEventListener("click", () => this.toMenu());
    $("r-again").addEventListener("click", () => this.startRace(this.trackIndex));
  }

  private show(which: "menu" | "race" | "result"): void {
    this.phase = which;
    $("s-menu").classList.toggle("on", which === "menu");
    $("s-result").classList.toggle("on", which === "result");
    $("hud").classList.toggle("on", which === "race");
  }

  private toMenu(): void {
    this.audio.stopRace();
    this.race = null;
    this.buildMenu();
    this.show("menu");
  }

  // ---- race ----
  private startRace(index: number): void {
    this.trackIndex = index;
    const def = TRACKS[index];
    this.track = new Track(def);
    this.lanes = makeLanes(this.track, 4);
    const car = CAR_CLASSES[def.classes[0]];
    this.renderer.setTrack(this.track, this.lanes.map((l) => l.offset));
    this.renderer.clearMarks();
    this.lapReference = slotReferenceTime(this.track, car, this.lanes[0]);
    this.deslotsThisRace = 0;

    this.race = new SlotRace(this.track, LAPS, [
      { name: "You", colour: car.colour, car, lane: this.lanes[0] },
      ...RIVALS.map((r, i) => ({
        name: r.name, colour: r.colour, car, lane: this.lanes[i + 1], skill: r.skill,
      })),
    ]);
    this.held = false;
    $("throttle").classList.remove("held");
    this.lastPip = 99;
    this.show("race");
    this.audio.unlock();
    this.audio.startRace();
  }

  private get player() {
    return this.race!.entrants[0];
  }

  private frame(now: number): void {
    const dt = Math.min(0.05, (now - this.last) / 1000 || 0);
    this.last = now;

    if (this.phase === "race" && this.race) {
      const race = this.race;
      if (race.state === "running") this.player.cara.throttle = this.held;
      // Fixed-step physics so a slow frame cannot change the outcome.
      this.accumulator = Math.min(0.25, this.accumulator + dt);
      while (this.accumulator >= SLOT_DT) {
        const before = this.player.cara.deslotCount;
        race.update(SLOT_DT);
        if (this.player.cara.deslotCount > before) this.deslotsThisRace++;
        this.accumulator -= SLOT_DT;
      }
      this.updateHud();
      if (race.state === "finished") this.finish();
    }

    this.draw(dt);
    requestAnimationFrame((t) => this.frame(t));
  }

  private updateHud(): void {
    const race = this.race!;
    const me = this.player.cara;
    const table = race.standings();
    const mine = table.find((r) => r.isPlayer)!;

    $("v-pos").textContent = `${mine.position}/${table.length}`;
    $("v-lap").textContent = `${Math.min(LAPS, me.laps + 1)}/${LAPS}`;
    $("v-time").textContent = formatTime(race.time);
    $("v-speed").textContent = String(Math.round(me.speed * 3.6));

    // The meter: what the corner is taking now (the fill) and what the corner
    // ahead will take if the thumb stays down (the amber marker).
    const load = clamp(me.telemetry.load, 0, 1.25);
    const fill = $("grip-fill");
    fill.style.width = `${Math.min(100, load * 88)}%`;
    const danger = me.telemetry.danger;
    fill.style.background =
      danger > 0.05 ? "var(--accent)" : load > 0.82 ? "var(--amber)" : "var(--green)";

    const look = me.outlook();
    $("grip-ahead").style.width = `${clamp(look.ahead * 88, 0, 100)}%`;
    // Amber: hold this and you will not make it. Red: you already will not,
    // whatever you do now — which is worth showing separately, because it is
    // the difference between "lift" and "brace".
    const lift = me.telemetry.lift;
    const late = me.telemetry.tooLate && !me.deslotted;
    const t = $("throttle");
    t.classList.toggle("lift", lift && !late);
    t.classList.toggle("late", late);
    const word = $("lift-word");
    word.classList.toggle("on", lift);
    word.classList.toggle("late", late);
    word.textContent = late ? "TOO FAST" : "LIFT";

    const off = me.deslotted;
    $("deslot-msg").classList.toggle("on", off);
    if (off) {
      $("v-marshal").textContent = `back in ${Math.max(0, me.deslotTimer).toFixed(1)}s`;
    }

    const msg = $("centre-msg");
    if (race.state === "countdown") {
      const n = Math.ceil(race.countdown);
      msg.textContent = n > 0 ? String(n) : "GO";
      msg.style.opacity = "1";
    } else {
      msg.style.opacity = "0";
    }

    // Countdown pips, once each, on the way down.
    const n = Math.ceil(race.countdown);
    if (race.state === "countdown" && n !== this.lastPip) {
      this.lastPip = n;
      if (n > 0) this.audio.cue("pip");
    } else if (race.state === "running" && this.lastPip !== 0) {
      this.lastPip = 0;
      this.audio.cue("go");
    }
  }

  private finish(): void {
    const race = this.race!;
    const table = race.standings();
    const mine = table.find((r) => r.isPlayer)!;
    const def = TRACKS[this.trackIndex];

    const prev = this.progress.best[def.id];
    if (!prev || mine.time < prev) this.progress.best[def.id] = mine.time;

    const reference = this.lapReference * race.laps;
    const m = slotMedals(reference);
    const medal =
      mine.time <= m.gold ? "gold" : mine.time <= m.silver ? "silver" : mine.time <= m.bronze ? "bronze" : "none";
    const best = this.progress.medals[def.id];
    const rank = { none: 0, bronze: 1, silver: 2, gold: 3 } as Record<string, number>;
    if (!best || rank[medal] > rank[best]) this.progress.medals[def.id] = medal;
    this.save();

    $("r-title").textContent = mine.position === 1 ? "Won" : `Finished ${ordinal(mine.position)}`;
    const md = $("r-medal");
    md.className = `medal ${medal}`;
    md.textContent = medal === "none" ? "No medal" : `${medal[0].toUpperCase()}${medal.slice(1)}`;
    $("r-sub").textContent =
      `${formatTime(mine.time)} · reference ${formatTime(reference)} · ` +
      `gold under ${formatTime(m.gold)}`;

    $("r-rows").innerHTML = table
      .map(
        (r: SlotStanding) =>
          `<tr class="${r.isPlayer ? "you" : ""}"><td class="pos">${r.position}</td>` +
          `<td>${r.name}</td><td>${formatTime(r.time)}</td>` +
          `<td class="gap">${r.deslots ? `${r.deslots} off` : "clean"}</td></tr>`,
      )
      .join("");

    $("r-note").textContent =
      this.deslotsThisRace === 0
        ? `A clean race — no deslots. ${
            mine.time <= m.gold
              ? "And on the pace. That is as good as this circuit gets."
              : `You were ${(mine.time - reference).toFixed(1)} s off the reference, so there is time in carrying more speed, not in being braver with the trigger.`
          }`
        : `${this.deslotsThisRace} deslot${this.deslotsThisRace === 1 ? "" : "s"}, ` +
          `costing about ${(this.deslotsThisRace * MARSHAL_DELAY).toFixed(1)} s of marshalling alone. ` +
          `A lap ${((this.deslotsThisRace * MARSHAL_DELAY) / race.laps).toFixed(1)} s slower and clean would have beaten it.`;

    this.audio.cue("finish");
    this.audio.stopRace();
    this.show("result");
  }

  private draw(dt: number): void {
    const r = this.renderer;
    r.beginFrame();
    if (this.phase === "race" && this.race) {
      const me = this.player.cara;
      // Show the layout, do not make them learn it a corner at a time.
      //
      // This started as a close chase camera, then a rotating one. Both are
      // wrong for a car on rails. Groove Racer -- the slot game this is chasing
      // -- used a fixed view and blocky cars precisely so the tight stuff was
      // easy to follow, and that is the structural answer: with no steering,
      // every decision is about a corner you have not reached, so the fix is to
      // put that corner on screen rather than to caption it.
      //
      // Fixed orientation, wide enough that several corners are in frame at
      // once, and biased along the direction of travel so the road ahead gets
      // the space rather than the road behind.
      const bounds = this.track.bounds;
      const w = bounds.max.x - bounds.min.x;
      const h = bounds.max.y - bounds.min.y;
      const whole = Math.min(
        this.renderer.cssWidth / (w + 60),
        this.renderer.cssHeight / (h + 60),
      );
      // Small circuits get framed entirely, the way a slot layout sits on a
      // table. Big ones get the widest view that still leaves the car readable.
      const scale = clamp(whole, 0.95, 2.0);
      const framedWhole = whole >= 0.95;
      const lead = framedWhole ? 0 : clamp(me.speed * 1.6, 0, 90);
      r.camera.targetCenter = framedWhole
        ? { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2 }
        : {
            x: me.pos.x + Math.cos(me.heading) * lead,
            y: me.pos.y + Math.sin(me.heading) * lead,
          };
      r.camera.targetRotation = 0;
      r.camera.anchorY = 0.5;
      r.camera.targetScale = scale;
      r.camera.update(dt, this.race.time < 0.05);
      r.drawTrackLayer();
      r.stepParticles(dt);
      r.drawParticles();
      for (const e of this.race.entrants) {
        r.drawSlotCar(e.cara.pos, e.cara.heading, e.opts.colour, e.opts.car, {
          isPlayer: e.isPlayer,
          faded: e.cara.deslotted,
        });
      }
    }
    r.endFrame();
  }
}

const ordinal = (n: number): string =>
  n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
