import type { Word } from "../../shared/types";
import type { DoneUrls } from "../feed/types";
import type { Stage } from "../show/director";

const SUN = ["n", "e", "s", "w"]; // LED index -> side the light comes from
export const CLOSEUP_MS = 2000;
export const DESCENT_MS = 1500;

function div(cls: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  return d;
}

/** The L0 picture in plain DOM + CSS (style.css). L1 replaces it with three.js behind the same Stage interface. */
export class DomStage implements Stage {
  private readonly root: HTMLElement;
  private readonly moon = div("moon");
  private readonly plates: HTMLImageElement[];
  private readonly page = div("page");
  private readonly revealImg = document.createElement("img");
  private readonly boxes = div("boxes");
  private timers: ReturnType<typeof setTimeout>[] = [];
  private endDescent: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.plates = [0, 1, 2, 3].map((k) => {
      const img = document.createElement("img");
      img.className = "plate";
      img.alt = "";
      img.dataset.led = String(k);
      return img;
    });
    this.revealImg.className = "reveal";
    this.revealImg.alt = "";
    this.page.append(this.revealImg, this.boxes);
    root.append(div("sky"), this.moon, ...this.plates, this.page);
    this.reset("idle");
  }

  idle(): void {
    this.reset("idle");
  }

  newScan(): void {
    this.reset("capture");
  }

  ledOn(led: number): void {
    this.root.dataset.mode = "capture";
    this.moon.dataset.sun = SUN[led];
  }

  /** The photo shows big (dimmed) for CLOSEUP_MS, then parks on its side of the moon. */
  photoLanded(led: number, url: string): void {
    for (const p of this.plates) if (p.dataset.state === "closeup") p.dataset.state = "parked";
    const plate = this.plates[led];
    plate.src = url;
    plate.dataset.state = "closeup";
    this.later(CLOSEUP_MS, () => {
      if (plate.dataset.state === "closeup") plate.dataset.state = "parked";
    });
  }

  combining(): void {
    this.root.dataset.mode = "combining";
    this.moon.dataset.sun = "spin";
    // Let the last photo finish its close-up before everything sinks into the moon.
    this.later(CLOSEUP_MS, () => {
      for (const p of this.plates) p.dataset.state = "gone";
    });
  }

  descent(urls: DoneUrls): Promise<void> {
    this.revealImg.src = urls.reveal; // start loading while the moon rushes in
    this.root.dataset.mode = "descent";
    return new Promise((resolve) => {
      const end = () => {
        clearTimeout(timer);
        this.endDescent = null;
        resolve();
      };
      const timer = setTimeout(end, DESCENT_MS);
      this.endDescent = end;
    });
  }

  async reveal(urls: DoneUrls): Promise<void> {
    if (this.revealImg.getAttribute("src") !== urls.reveal) this.revealImg.src = urls.reveal;
    await this.revealImg.decode().catch(() => {}); // a broken image must not stop the show
    this.root.dataset.mode = "reveal";
  }

  /** One box per word, positioned in % of the reveal image, so it follows the image's size. */
  showWords(words: Word[], confident: number[]): void {
    const w = this.revealImg.naturalWidth || 1;
    const h = this.revealImg.naturalHeight || 1;
    this.boxes.replaceChildren(
      ...words.map((word, i) => {
        const b = div(confident.includes(i) ? "box confident" : "box");
        if (word.box.length === 0) {
          b.hidden = true;
          return b;
        }
        const xs = word.box.map((p) => p[0]);
        const ys = word.box.map((p) => p[1]);
        const x0 = Math.min(...xs);
        const y0 = Math.min(...ys);
        b.style.left = `${(x0 / w) * 100}%`;
        b.style.top = `${(y0 / h) * 100}%`;
        b.style.width = `${((Math.max(...xs) - x0) / w) * 100}%`;
        b.style.height = `${((Math.max(...ys) - y0) / h) * 100}%`;
        return b;
      }),
    );
  }

  highlight(index: number | null): void {
    Array.from(this.boxes.children).forEach((b, i) => {
      b.classList.toggle("said", index !== null && i < index);
      b.classList.toggle("now", i === index);
    });
  }

  hold(): void {
    this.root.dataset.mode = "hold";
  }

  skip(): void {
    this.endDescent?.();
    for (const p of this.plates) if (p.dataset.state === "closeup") p.dataset.state = "parked";
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms));
  }

  private reset(mode: string): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.endDescent?.();
    this.root.dataset.mode = mode;
    this.moon.dataset.sun = "full";
    for (const p of this.plates) {
      p.dataset.state = "hidden";
      p.removeAttribute("src");
    }
    this.revealImg.removeAttribute("src");
    this.boxes.replaceChildren();
  }
}
