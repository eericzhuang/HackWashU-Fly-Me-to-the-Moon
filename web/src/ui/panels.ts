import type { ReviewAnswer, StepsManifest } from "../../shared/types";
import type { FeedEvent } from "../feed/types";
import type { Screens } from "../show/director";

type ReviewEvent = Extract<FeedEvent, { type: "review" }>;

const PANEL_STAGGER_S = 0.55; // between one picture's entrance and the next
const WIPE_S = 1.3; // one picture's terminator wipe
const MANIFEST_TIMEOUT_MS = 4000;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** The file part of a scan URL (/scan/<name>/<file>?v=...) -> the same URL for a sibling file. */
function sibling(url: string, file: string): string {
  const u = new URL(url, location.href);
  u.pathname = u.pathname.replace(/[^/]+$/, file);
  return u.pathname + u.search;
}

interface Page {
  kicker: string;
  title: string;
  note: string;
  panels: { src: string; caption: string }[];
  hint: string;
}

/** Presenter-paced pages, one per processing step (terminator.stages). Each page's pictures come in
 *  one by one behind a moving terminator line; when the page is done a hint pulses. → / Space /
 *  Enter: next (or finish the animation at once), ←: back. */
export class StepsView {
  private readonly root: HTMLElement;
  private pages: Page[] = [];
  private index = 0;
  private ready = false;
  private readyTimer: ReturnType<typeof setTimeout> | undefined;
  private resolve: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  get open(): boolean {
    return this.resolve !== null;
  }

  async show(url: string): Promise<void> {
    this.close();
    let manifest: StepsManifest;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), MANIFEST_TIMEOUT_MS);
      const res = await fetch(url, { cache: "no-store", signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) return; // no step pages for this scan (e.g. out/sim): go straight on
      manifest = (await res.json()) as StepsManifest;
    } catch (e) {
      console.warn("step pages unavailable:", e);
      return;
    }
    const n = manifest.pages.length;
    if (!n) return;
    this.pages = [
      { kicker: "PROCESSING COMPLETE", title: "Four photos in. One message out.",
        note: `Here is every step the computer just took, in ${n} pages.`, panels: [], hint: "→  WALK THROUGH" },
      ...manifest.pages.map((p, i) => ({
        kicker: `STEP ${i + 1} / ${n}`,
        title: p.title,
        note: p.note,
        panels: p.panels.map((x) => ({ src: sibling(url, x.file), caption: x.caption })),
        hint: i === n - 1 ? "→  REVEAL" : "→  NEXT",
      })),
    ];
    // Warm the cache so each page's pictures are there when it opens.
    for (const p of this.pages) for (const x of p.panels) new Image().src = x.src;
    return new Promise<void>((resolve) => {
      this.resolve = resolve;
      this.go(0);
    });
  }

  next(): void {
    if (!this.open) return;
    if (!this.ready) return this.finishAnimation();
    if (this.index >= this.pages.length - 1) {
      const done = this.resolve;
      this.close();
      done?.();
      return;
    }
    this.go(this.index + 1);
  }

  back(): void {
    if (this.open && this.index > 0) this.go(this.index - 1);
  }

  close(): void {
    clearTimeout(this.readyTimer);
    this.resolve = null;
    this.root.replaceChildren();
    this.root.classList.remove("on");
  }

  private go(i: number): void {
    clearTimeout(this.readyTimer);
    this.index = i;
    this.ready = false;
    const p = this.pages[i];
    const box = el("div", "steps");
    const head = el("div", "steps-head");
    head.append(el("div", "steps-kicker", p.kicker), el("h1", "steps-title", p.title), el("p", "steps-note", p.note));
    const grid = el("div", `steps-grid n${p.panels.length}`);
    p.panels.forEach((x, j) => {
      const fig = el("figure", "steps-fig");
      fig.style.setProperty("--d", `${(j * PANEL_STAGGER_S).toFixed(2)}s`);
      const wipe = el("div", "steps-wipe");
      const img = el("img");
      img.src = x.src;
      img.alt = x.caption;
      wipe.append(img);
      fig.append(wipe, el("figcaption", "", x.caption));
      grid.append(fig);
    });
    const dots = el("div", "steps-dots");
    this.pages.forEach((_, j) => dots.append(el("span", j === i ? "on" : j < i ? "seen" : "")));
    box.append(head, grid, dots, el("div", "steps-hint", p.hint));
    this.root.replaceChildren(box);
    this.root.classList.add("on");
    const ms = p.panels.length ? ((p.panels.length - 1) * PANEL_STAGGER_S + WIPE_S + 0.3) * 1000 : 900;
    this.readyTimer = setTimeout(() => this.markReady(), ms);
  }

  private finishAnimation(): void {
    this.root.querySelector(".steps")?.classList.add("ff");
    this.markReady();
  }

  private markReady(): void {
    clearTimeout(this.readyTimer);
    this.ready = true;
    this.root.querySelector(".steps")?.classList.add("ready");
  }
}

/** A doubtful photo alignment, settled by the presenter: the reference photo in red, a candidate
 *  alignment in cyan (screen-blended: where they coincide it's grey/white, a miss shows the same
 *  line twice). 1-9 picks a candidate, arrows nudge it (Shift = 10 px), Enter sends the answer. */
export class ReviewView {
  private readonly root: HTMLElement;
  private readonly post: (a: ReviewAnswer) => Promise<boolean>;
  private e: ReviewEvent | null = null;
  private choice = 0;
  private dx = 0;
  private dy = 0;
  private sent = false;
  private deadline = 0;
  private tick: ReturnType<typeof setInterval> | undefined;
  private cand!: HTMLImageElement;
  private chips: HTMLElement[] = [];
  private status!: HTMLElement;

  constructor(root: HTMLElement, post: (a: ReviewAnswer) => Promise<boolean>) {
    this.root = root;
    this.post = post;
  }

  get open(): boolean {
    return this.e !== null;
  }

  show(e: ReviewEvent): void {
    this.close();
    this.e = e;
    const r = e.review;
    this.choice = r.ai?.choice ?? 0;
    this.dx = this.dy = 0;
    this.sent = false;
    this.deadline = performance.now() + r.timeout * 1000;

    const box = el("div", "review");
    const head = el("div", "review-head");
    head.append(
      el("div", "steps-kicker", `ALIGNMENT CHECK · LED ${r.led + 1} (${"NESW"[r.led] ?? "?"})`),
      el("h1", "review-title", r.check === "inconsistent" ? "This photo disagrees with the others" : "The computer can't verify this photo"),
      el("p", "steps-note", r.detail),
    );
    if (r.ai) {
      const pick = r.ai.choice === null ? "none of them" : `option ${r.ai.choice + 1}`;
      head.append(el("p", "review-ai", `AI suggests ${pick} (confidence ${r.ai.confidence.toFixed(2)}): ${r.ai.why}`));
    }
    const view = el("div", "review-view");
    const ref = el("img", "review-ref");
    ref.src = e.urls.ref;
    ref.alt = "reference photo (red)";
    this.cand = el("img", "review-cand");
    this.cand.alt = "candidate alignment (cyan)";
    this.cand.addEventListener("load", () => this.render());
    view.append(ref, this.cand);
    const list = el("div", "review-options");
    this.chips = r.options.map((o, i) => {
      const c = el("div", "review-chip", `${i + 1}  ${o.label}`);
      list.append(c);
      return c;
    });
    this.status = el("div", "review-status");
    box.append(head, view, list,
      el("div", "review-help", "1–9 choose · ← ↑ → ↓ nudge (Shift ×10) · Enter accept"), this.status);
    this.root.replaceChildren(box);
    this.root.classList.add("on");
    this.render();
    this.tick = setInterval(() => this.renderStatus(), 250);
  }

  key(key: string, shift: boolean): boolean {
    const e = this.e;
    if (!e || this.sent) return !!e;
    const step = shift ? 10 : 1;
    if (/^[1-9]$/.test(key)) {
      const i = Number(key) - 1;
      if (i < e.review.options.length) this.choice = i;
    } else if (key === "ArrowLeft") this.dx -= step;
    else if (key === "ArrowRight") this.dx += step;
    else if (key === "ArrowUp") this.dy -= step;
    else if (key === "ArrowDown") this.dy += step;
    else if (key === "Enter") {
      void this.submit();
      return true;
    } else return false;
    this.render();
    return true;
  }

  close(): void {
    clearInterval(this.tick);
    this.e = null;
    this.root.replaceChildren();
    this.root.classList.remove("on");
  }

  private async submit(): Promise<void> {
    const e = this.e;
    if (!e) return;
    this.sent = true;
    this.renderStatus();
    const ok = await this.post({ scan: e.name, id: e.review.id, choice: this.choice, dx: this.dx, dy: this.dy });
    if (!ok && this.e === e) {
      this.sent = false;
      this.status.textContent = "could not send — press Enter to retry";
    }
  }

  private render(): void {
    const e = this.e;
    if (!e) return;
    const src = e.urls.options[this.choice];
    if (!this.cand.src.endsWith(src)) this.cand.src = src;
    // Nudges are in the image's own pixels; the picture on screen is scaled.
    const s = this.cand.naturalWidth ? this.cand.clientWidth / this.cand.naturalWidth : 1;
    this.cand.style.translate = `${this.dx * s}px ${this.dy * s}px`;
    this.chips.forEach((c, i) => c.classList.toggle("on", i === this.choice));
    this.renderStatus();
  }

  private renderStatus(): void {
    if (!this.e) return;
    const left = Math.max(0, Math.ceil((this.deadline - performance.now()) / 1000));
    const nudge = this.dx || this.dy ? ` · nudged (${this.dx}, ${this.dy}) px` : "";
    this.status.textContent = this.sent
      ? "sent — the pipeline continues with your choice"
      : `option ${this.choice + 1}${nudge} · auto-accepts option 1 in ${left}s`;
  }
}

/** Both panels behind the Director's Screens interface. */
export class Panels implements Screens {
  readonly stepsView: StepsView;
  readonly reviewView: ReviewView;
  private readonly stepsEnabled: boolean;

  constructor(root: HTMLElement, stepsEnabled = true,
              fetchImpl: typeof fetch = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)) {
    const steps = el("div", "panel");
    const review = el("div", "panel");
    root.append(steps, review);
    this.stepsView = new StepsView(steps);
    this.reviewView = new ReviewView(review, async (a) => {
      try {
        const res = await fetchImpl("/api/review", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(a),
        });
        return res.ok;
      } catch {
        return false;
      }
    });
    this.stepsEnabled = stepsEnabled;
  }

  review(e: ReviewEvent): void {
    this.reviewView.show(e);
  }

  closeReview(): void {
    this.reviewView.close();
  }

  steps(url: string): Promise<void> {
    return this.stepsEnabled ? this.stepsView.show(url) : Promise.resolve();
  }

  closeSteps(): void {
    this.stepsView.close();
  }

  key(key: string, shift: boolean): boolean {
    if (this.reviewView.open) return this.reviewView.key(key, shift);
    if (this.stepsView.open) {
      if (key === "ArrowRight" || key === "Enter" || key === "PageDown") this.stepsView.next();
      else if (key === "ArrowLeft" || key === "PageUp") this.stepsView.back();
      else return false;
      return true;
    }
    return false;
  }

  skip(): boolean {
    if (this.reviewView.open) return true;
    if (this.stepsView.open) {
      this.stepsView.next();
      return true;
    }
    return false;
  }
}
