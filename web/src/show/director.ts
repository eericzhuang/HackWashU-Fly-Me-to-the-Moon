import type { Word } from "../../shared/types";
import type { Outcome } from "../ai/classify";
import type { DoneUrls, FeedEvent } from "../feed/types";

export type ShowPhase = "idle" | "capture" | "combining" | "descent" | "reveal" | "hold";

/** The picture. L0: DomStage (CSS). L1 swaps in the three.js scene behind this same interface. */
export interface Stage {
  idle(): void;
  newScan(): void;
  ledOn(led: number): void;
  photoLanded(led: number, url: string): void;
  combining(): void;
  /** Resolves when the move into the page is over. Gets every image of the finished scan. */
  descent(urls: DoneUrls): Promise<void>;
  /** Resolves once the clean reveal image is on screen. */
  reveal(urls: DoneUrls): Promise<void>;
  showWords(words: Word[], confident: number[]): void;
  /** index = the word being spoken; words before it count as said. null clears. */
  highlight(index: number | null): void;
  hold(): void;
  /** Jump the running animation to its end state. */
  skip(): void;
}

/** The text on top of the picture (HTML). */
export interface Overlay {
  idle(armed: boolean): void;
  capture(led: number, captured: number[]): void;
  landed(led: number, captured: number[]): void;
  combining(): void;
  reveal(): void;
  clearCue(): void;
  /** current: the word being spoken; words.length = all said; null = none yet. */
  subtitle(words: string[], current: number | null): void;
  alarm(on: boolean): void;
  waiting(on: boolean): void;
}

export interface Reader {
  /** Never rejects. */
  read(scan: string): Promise<Outcome>;
}

export interface Voice {
  /** Resolves when finished or cancelled; onWord(i) fires as word i starts. */
  speak(words: string[], onWord: (i: number) => void): Promise<void>;
  /** The 1202 line. */
  alarm(): Promise<void>;
  cancel(): void;
}

export const TIMING = {
  readDeadlineMs: 8000, // after "done": no OCR by then -> 1202 alarm
  holdAfterMs: 3000, // after reading, before "hold the sun"
  stuckMs: 120_000, // no event this long while capturing -> "waiting for photo…"
  stepMaxMs: 10_000, // bound for stage.descent and stage.reveal
  speakPerWordMs: 1000, // bound for voice.speak: words.length * speakPerWordMs + speakSlackMs
  speakSlackMs: 5000,
  alarmMaxMs: 15_000, // bound for voice.alarm
};

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Never lets a step hang the show: resolves with `p`'s value, or `undefined` after `ms`. */
export function bounded<T>(p: Promise<T>, ms: number, label: string): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`${label} timed out after ${ms} ms`);
      resolve(undefined);
    }, ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

const NO_RESULT: Outcome = { kind: "error", words: [], confident: [] };

/** Runs the show. Feed events move it through the capture; after "done" it times itself.
 *  Every restart bumps `gen`; an async step that wakes up under an old gen stops quietly. */
export class Director {
  phase: ShowPhase = "idle";
  armed = false;
  private gen = 0;
  private captured: number[] = [];
  private stuckTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly stage: Stage;
  private readonly overlay: Overlay;
  private readonly reader: Reader;
  private readonly voice: Voice;

  constructor(stage: Stage, overlay: Overlay, reader: Reader, voice: Voice) {
    this.stage = stage;
    this.overlay = overlay;
    this.reader = reader;
    this.voice = voice;
    stage.idle();
    overlay.idle(false);
  }

  handle(e: FeedEvent): void {
    switch (e.type) {
      case "scanStarted":
        this.restart("capture");
        this.stage.newScan();
        break;
      case "ledOn":
        this.phase = "capture";
        this.stage.ledOn(e.led);
        this.overlay.capture(e.led, [...this.captured]);
        this.watchStuck();
        break;
      case "photoLanded":
        if (!this.captured.includes(e.led)) this.captured.push(e.led);
        this.stage.photoLanded(e.led, e.url);
        this.overlay.landed(e.led, [...this.captured]);
        this.watchStuck();
        break;
      case "combining":
        this.phase = "combining";
        this.clearStuck();
        this.stage.combining();
        this.overlay.combining();
        break;
      case "done":
        void this.finish(e.name, e.urls);
        break;
    }
  }

  /** Esc: back to the full moon. */
  toIdle(): void {
    this.restart("idle");
    this.stage.idle();
    this.overlay.idle(this.armed);
  }

  /** First key press: audio may play from now on. */
  arm(): void {
    this.armed = true;
    if (this.phase === "idle") this.overlay.idle(true);
  }

  skip(): void {
    this.stage.skip();
  }

  private restart(phase: ShowPhase): void {
    this.gen++;
    this.phase = phase;
    this.captured = [];
    this.clearStuck();
    this.voice.cancel();
    this.overlay.alarm(false);
    this.overlay.subtitle([], null);
    this.overlay.clearCue();
  }

  private async finish(scan: string, urls: DoneUrls): Promise<void> {
    const gen = this.gen;
    const live = () => gen === this.gen;
    try {
      this.clearStuck();
      this.overlay.reveal();
      this.phase = "descent";
      // Ask for the reading now, so it arrives while the descent plays.
      const reading = Promise.race([this.reader.read(scan), sleep(TIMING.readDeadlineMs).then(() => NO_RESULT)]);
      await bounded(this.stage.descent(urls), TIMING.stepMaxMs, "stage.descent");
      if (!live()) return;
      this.phase = "reveal";
      await bounded(this.stage.reveal(urls), TIMING.stepMaxMs, "stage.reveal");
      if (!live()) return;
      const outcome = await reading;
      if (!live()) return;

      this.stage.showWords(outcome.words, outcome.confident);
      if (outcome.kind === "ok") {
        const texts = outcome.words.map((w) => w.text);
        this.overlay.subtitle(texts, null);
        const speakMaxMs = texts.length * TIMING.speakPerWordMs + TIMING.speakSlackMs;
        const spoke = await bounded(
          this.voice
            .speak(texts, (i) => {
              if (!live()) return;
              this.stage.highlight(i);
              this.overlay.subtitle(texts, i);
            })
            .then(() => true),
          speakMaxMs,
          "voice.speak",
        );
        if (!live()) return;
        if (spoke === undefined) this.voice.cancel();
        this.stage.highlight(texts.length);
        this.overlay.subtitle(texts, texts.length);
      } else {
        this.overlay.alarm(true);
        const alarmed = await bounded(this.voice.alarm().then(() => true), TIMING.alarmMaxMs, "voice.alarm");
        if (!live()) return;
        if (alarmed === undefined) this.voice.cancel();
      }
      await sleep(TIMING.holdAfterMs);
      if (!live()) return;
      this.phase = "hold";
      this.stage.hold();
    } catch (err) {
      console.error("show step failed:", err);
      if (live()) {
        this.phase = "hold";
        try {
          this.stage.hold();
        } catch (holdErr) {
          console.error("show step failed:", holdErr);
        }
      }
    }
  }

  private watchStuck(): void {
    this.clearStuck();
    this.stuckTimer = setTimeout(() => this.overlay.waiting(true), TIMING.stuckMs);
  }

  private clearStuck(): void {
    clearTimeout(this.stuckTimer);
    this.stuckTimer = undefined;
    this.overlay.waiting(false);
  }
}
