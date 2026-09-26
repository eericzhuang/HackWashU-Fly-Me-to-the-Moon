import * as Tone from "tone";
import type { Soundtrack } from "../show/director";
import { CHORDS, COMBINING, RESOLVED, heldSunMix } from "./scoreCues";

type Chord = { readonly notes: readonly string[]; readonly bass: string };
type Phase = { kind: "idle" | "combining" | "descent" | "reveal" | "hold" } | { kind: "led"; index: number };

function makeGraph() {
  const bus = new Tone.Volume(-18).toDestination();
  const pan = new Tone.Panner(0).connect(bus);
  const reverb = new Tone.Reverb({ decay: 2, wet: 0.18 }).connect(pan);
  const lowpass = new Tone.Filter(900, "lowpass").connect(reverb);
  const padOptions = { oscillator: { type: "sawtooth" as const }, envelope: { attack: 1, decay: 0.3, sustain: 0.5, release: 2 } };
  const padA = new Tone.PolySynth(Tone.Synth, padOptions).connect(lowpass);
  const padB = new Tone.PolySynth(Tone.Synth, { ...padOptions, detune: 7 }).connect(lowpass);
  const ping = new Tone.FMSynth({
    harmonicity: 2, modulationIndex: 3,
    envelope: { attack: 0.01, decay: 0.6, sustain: 0.05, release: 1.2 },
    modulation: { type: "sine" },
    modulationEnvelope: { attack: 0.005, decay: 0.2, sustain: 0, release: 0.4 },
  }).connect(reverb);
  const bass = new Tone.MonoSynth({
    oscillator: { type: "triangle" },
    envelope: { attack: 0.03, decay: 0.25, sustain: 0.2, release: 0.8 },
  }).connect(reverb);
  const windFilter = new Tone.Filter(700, "bandpass").connect(new Tone.Volume(-42).connect(reverb));
  const wind = new Tone.Noise("pink").connect(windFilter);
  wind.start();
  return { bus, pan, lowpass, padA, padB, ping, bass, wind };
}

type ScoreGraph = ReturnType<typeof makeGraph>;

/** Local, gesture-armed score. Methods before arm only remember the current show phase. */
export class ToneScore implements Soundtrack {
  private graph?: ScoreGraph;
  private arming?: Promise<void>;
  private phase: Phase = { kind: "idle" };
  private muted = false;
  private ducked = false;
  private pulseTimer?: ReturnType<typeof setTimeout>;
  private pulseDelay = 1600;
  private sun = { azimuth: 0, elevation: Math.PI / 6 };

  arm(): Promise<void> {
    if (this.graph) return Promise.resolve();
    if (this.arming) return this.arming;
    // Tone.start is called in this stack frame, while the input gesture is live.
    const start = Tone.start();
    this.arming = start.then(() => {
      this.graph = makeGraph();
      this.graph.bus.mute = this.muted;
      this.applyPhase();
      this.applyDuck();
    }).catch((error: unknown) => {
      this.arming = undefined;
      throw error;
    });
    return this.arming;
  }

  mute(on: boolean): void {
    this.muted = on;
    if (this.graph) this.graph.bus.mute = on;
    this.clearPulse();
    if (!on && this.phase.kind === "combining" && this.graph) this.startPulse();
  }

  idle(): void {
    this.ducked = false;
    this.transition({ kind: "idle" });
    this.applyDuck();
  }

  ledOn(k: number): void {
    if (!Number.isInteger(k) || k < 0 || k >= CHORDS.length) return;
    this.transition({ kind: "led", index: k });
  }

  photoLanded(k: number): void {
    if (!Number.isInteger(k) || k < 0 || k >= CHORDS.length || !this.graph || this.muted) return;
    this.graph.ping.triggerAttackRelease(CHORDS[k].notes[1], "8n", undefined, 0.25);
  }

  combining(): void { this.transition({ kind: "combining" }); }
  descent(): void { this.transition({ kind: "descent" }); }
  reveal(): void { this.transition({ kind: "reveal" }); }
  hold(): void {
    if (this.phase.kind === "reveal") {
      this.clearPulse();
      this.phase = { kind: "hold" };
      this.heldSun(this.sun.azimuth, this.sun.elevation);
    } else {
      this.transition({ kind: "hold" });
    }
  }

  voiceActive(on: boolean): void {
    this.ducked = on;
    this.applyDuck();
  }

  heldSun(azimuth: number, elevation: number): void {
    this.sun = { azimuth, elevation };
    if (this.phase.kind !== "hold" || !this.graph) return;
    const { pan, cutoff } = heldSunMix(azimuth, elevation);
    this.graph.pan.pan.rampTo(pan, 0.2);
    this.graph.lowpass.frequency.rampTo(cutoff, 0.2);
  }

  private transition(phase: Phase): void {
    this.clearPulse();
    this.phase = phase;
    this.applyPhase();
  }

  private applyPhase(): void {
    const g = this.graph;
    if (!g) return;
    switch (this.phase.kind) {
      case "idle":
        this.playChord({ notes: ["C3", "G3"], bass: "C2" }, 550);
        return;
      case "led":
        this.playChord(CHORDS[this.phase.index], 900);
        return;
      case "combining":
        this.playChord(COMBINING, 900);
        g.lowpass.frequency.rampTo(2500, 12);
        if (!this.muted) this.startPulse();
        return;
      case "descent":
        this.playChord(COMBINING, 500);
        if (!this.muted) g.bass.triggerAttackRelease("G1", "2n", undefined, 0.4);
        return;
      case "reveal":
        this.playChord(RESOLVED, 2000);
        return;
      case "hold":
        this.playChord(RESOLVED, 1200);
        this.heldSun(this.sun.azimuth, this.sun.elevation);
    }
  }

  private playChord(chord: Chord, cutoff: number): void {
    const g = this.graph;
    if (!g) return;
    g.padA.releaseAll();
    g.padB.releaseAll();
    g.padA.triggerAttack([...chord.notes], undefined, 0.15);
    g.padB.triggerAttack([...chord.notes], undefined, 0.12);
    g.lowpass.frequency.rampTo(cutoff, 1.5);
  }

  private startPulse(): void {
    this.pulseDelay = 1600;
    const pulse = () => {
      if (!this.graph || this.muted || this.phase.kind !== "combining") return;
      this.graph.bass.triggerAttackRelease(COMBINING.bass, "8n", undefined, 0.2);
      this.pulseDelay = Math.max(600, this.pulseDelay * 0.9);
      this.pulseTimer = setTimeout(pulse, this.pulseDelay);
    };
    this.pulseTimer = setTimeout(pulse, this.pulseDelay);
  }

  private clearPulse(): void {
    clearTimeout(this.pulseTimer);
    this.pulseTimer = undefined;
  }

  private applyDuck(): void {
    this.graph?.bus.volume.rampTo(this.ducked ? -30 : -18, this.ducked ? 0.1 : 0.5);
  }
}
