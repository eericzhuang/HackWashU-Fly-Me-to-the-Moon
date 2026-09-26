import type { Overlay } from "../show/director";

const DIRECTIONS = ["North", "East", "South", "West"];
const GOT_SHOT_MS = 1500; // how long "Got shot k" stays before the next instruction

function add(parent: HTMLElement, cls: string, text = ""): HTMLElement {
  const e = document.createElement("div");
  e.className = cls;
  e.textContent = text;
  parent.append(e);
  return e;
}

/** Every piece of on-screen text. Which parts show is decided by #overlay[data-mode] in style.css. */
export class DomOverlay implements Overlay {
  private readonly root: HTMLElement;
  private readonly armHint: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly line: HTMLElement;
  private readonly dots: HTMLElement[];
  private readonly sub: HTMLElement;
  private readonly alarmBox: HTMLElement;
  private readonly waitNote: HTMLElement;
  private cueTimer: ReturnType<typeof setTimeout> | undefined;
  private gotUntil = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    add(root, "wordmark", "TERMINATOR");
    const idle = add(root, "idle");
    add(idle, "prompt", "Write a secret. Tear off the page.");
    add(idle, "note", "FULL MOON · NO SHADOWS · THE PAGE LOOKS BLANK");
    this.armHint = add(idle, "arm", "press any key to arm audio");
    const cue = add(root, "cue");
    this.kicker = add(cue, "kicker");
    this.line = add(cue, "line");
    const progress = add(root, "progress");
    this.dots = ["N", "E", "S", "W"].map((d) => {
      const dot = add(progress, "dot");
      dot.dataset.dir = d;
      return dot;
    });
    this.sub = add(root, "subtitle");
    this.alarmBox = add(root, "alarm", "1202 PROGRAM ALARM");
    this.waitNote = add(root, "waiting", "waiting for photo…");
  }

  idle(armed: boolean): void {
    this.root.dataset.mode = "idle";
    this.armHint.hidden = armed;
    this.clearCue();
    this.mark([], null);
  }

  capture(led: number, captured: number[]): void {
    this.root.dataset.mode = "capture";
    this.mark(captured, led);
    this.cue(this.afterGot(), `SHOT ${led + 1} / 4`, `${DIRECTIONS[led]} light on — tap the shutter`);
  }

  landed(led: number, captured: number[]): void {
    this.mark(captured, null);
    this.cue(0, `SHOT ${led + 1} / 4`, `Got shot ${led + 1}`);
    this.gotUntil = performance.now() + GOT_SHOT_MS;
  }

  combining(): void {
    this.root.dataset.mode = "combining";
    this.mark([0, 1, 2, 3], null);
    this.cue(this.afterGot(), "COMBINING", "aligning four shots");
  }

  reveal(): void {
    this.root.dataset.mode = "reveal";
    this.clearCue();
  }

  clearCue(): void {
    clearTimeout(this.cueTimer);
    this.kicker.textContent = "";
    this.line.textContent = "";
  }

  subtitle(words: string[], current: number | null): void {
    this.sub.replaceChildren(
      ...words.map((w, i) => {
        const s = document.createElement("span");
        s.textContent = w.toUpperCase();
        if (current !== null) s.className = i < current ? "said" : i === current ? "now" : "";
        return s;
      }),
    );
  }

  alarm(on: boolean): void {
    this.alarmBox.classList.toggle("on", on);
  }

  waiting(on: boolean): void {
    this.waitNote.classList.toggle("on", on);
  }

  /** ms left on a "Got shot k" message, so the next instruction doesn't replace it at once. */
  private afterGot(): number {
    return Math.max(0, this.gotUntil - performance.now());
  }

  private cue(delayMs: number, kicker: string, line: string): void {
    clearTimeout(this.cueTimer);
    const show = () => {
      this.kicker.textContent = kicker;
      this.line.textContent = line;
    };
    if (delayMs > 0) this.cueTimer = setTimeout(show, delayMs);
    else show();
  }

  private mark(captured: number[], active: number | null): void {
    this.dots.forEach((d, k) => {
      d.classList.toggle("got", captured.includes(k));
      d.classList.toggle("active", k === active);
    });
  }
}
