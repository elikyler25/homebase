// Sound, synthesized. No samples, no files, no bytes.
//
// Everything here is oscillators and filtered noise, which suits both the
// constraint (the whole game is one self-contained page) and the material: an
// engine note really is a pitch that tracks revs, and tyre squeal really is
// filtered noise that swells as the tyres let go. Driving them off the same
// telemetry the physics already produces means the audio cannot drift out of
// sync with what the car is doing — the squeal *is* the understeer value.

import { clamp } from "./math";

interface Voice {
  gain: GainNode;
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private engineA: OscillatorNode | null = null;
  private engineB: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;

  private squeal: Voice | null = null;
  private rumble: Voice | null = null;

  private started = false;
  enabled = true;

  /**
   * Must be called from a user gesture. Mobile browsers refuse to start an
   * AudioContext otherwise, and a context created outside one stays suspended
   * forever with no error.
   */
  unlock(): void {
    if (this.started || !this.enabled) return;
    type WithWebkit = typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? (globalThis as WithWebkit).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      return; // no audio available; the game is still perfectly playable
    }
    this.started = true;

    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.0001;
    this.master.connect(ctx.destination);

    // One second of white noise, looped, shared by every noise voice.
    const len = Math.floor(ctx.sampleRate);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    void ctx.resume();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stopRace();
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(on ? 0.9 : 0.0001, this.ctx.currentTime, 0.05);
    }
  }

  private noiseVoice(type: BiquadFilterType, freq: number, q: number): Voice | null {
    if (!this.ctx || !this.master || !this.noiseBuffer) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    return { gain };
  }

  /** Spin up the continuous voices for a race. */
  startRace(): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    this.stopRace();
    const ctx = this.ctx;

    // Engine: two saws a few cents apart through a lowpass. The detune is what
    // stops it sounding like a test tone.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 900;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter.connect(this.engineGain).connect(this.master);

    this.engineA = ctx.createOscillator();
    this.engineA.type = "sawtooth";
    this.engineB = ctx.createOscillator();
    this.engineB.type = "square";
    this.engineB.detune.value = -12;
    this.engineA.connect(this.engineFilter);
    this.engineB.connect(this.engineFilter);
    this.engineA.start();
    this.engineB.start();

    this.squeal = this.noiseVoice("bandpass", 1750, 7);
    this.rumble = this.noiseVoice("lowpass", 220, 1);
    this.master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.08);
  }

  stopRace(): void {
    for (const o of [this.engineA, this.engineB]) {
      try {
        o?.stop();
      } catch {
        /* already stopped */
      }
    }
    this.engineA = this.engineB = null;
    this.engineGain = null;
    this.engineFilter = null;
    if (this.squeal) this.squeal.gain.gain.value = 0;
    if (this.rumble) this.rumble.gain.gain.value = 0;
  }

  /**
   * Drive every voice from one telemetry snapshot. Called once per frame, and
   * deliberately uses setTargetAtTime rather than direct assignment so the
   * parameters glide instead of stepping at the frame rate.
   */
  update(t: {
    speed: number;
    maxSpeed: number;
    understeer: number;
    gripBudget: number;
    onTrack: boolean;
    turbo: boolean;
  }): void {
    if (!this.ctx || !this.enabled || !this.engineA) return;
    const now = this.ctx.currentTime;
    const rev = clamp(t.speed / Math.max(1, t.maxSpeed), 0, 1);

    // Pitch rises with speed but never sounds like a siren: a modest range, and
    // a touch of "gearing" so it steps rather than sweeping endlessly upward.
    const gear = Math.floor(rev * 4);
    const inGear = rev * 4 - gear;
    const freq = 55 + gear * 8 + inGear * 46;
    this.engineA.frequency.setTargetAtTime(freq, now, 0.05);
    this.engineB?.frequency.setTargetAtTime(freq * 0.5, now, 0.05);
    this.engineFilter?.frequency.setTargetAtTime(500 + rev * 2200, now, 0.06);
    this.engineGain?.gain.setTargetAtTime(0.05 + rev * 0.1, now, 0.05);

    // Squeal tracks understeer as a fraction of the grip budget, so it starts
    // exactly when the tyres actually let go rather than at some speed guess.
    const slip = clamp(t.understeer / Math.max(1, t.gripBudget * 0.35), 0, 1);
    if (this.squeal) {
      this.squeal.gain.gain.setTargetAtTime(slip * 0.13, now, 0.04);
    }
    if (this.rumble) {
      this.rumble.gain.gain.setTargetAtTime(!t.onTrack ? 0.16 * (0.3 + rev) : 0, now, 0.05);
    }
    if (t.turbo) this.engineGain?.gain.setTargetAtTime(0.2, now, 0.02);
  }

  /** Short synthesized cue: countdown pips, the start tone, a finish chime. */
  cue(kind: "pip" | "go" | "finish" | "turbo"): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    if (kind === "turbo") {
      // Rising filtered-noise whoosh.
      if (!this.noiseBuffer) return;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 3;
      bp.frequency.setValueAtTime(300, now);
      bp.frequency.exponentialRampToValueAtTime(3200, now + 0.45);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.16, now + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      src.connect(bp).connect(g).connect(this.master);
      src.start(now);
      src.stop(now + 0.55);
      return;
    }

    const spec = {
      pip: { f: 660, dur: 0.12, gain: 0.16 },
      go: { f: 1050, dur: 0.4, gain: 0.22 },
      finish: { f: 880, dur: 0.7, gain: 0.2 },
    }[kind];

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(spec.f, now);
    if (kind === "finish") {
      osc.frequency.exponentialRampToValueAtTime(spec.f * 1.5, now + 0.18);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(spec.gain, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + spec.dur);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + spec.dur + 0.05);
  }
}
