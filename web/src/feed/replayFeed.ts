import { scanUrl } from "./derive";
import type { Feed, FeedEvent } from "./types";

export interface Timed {
  at: number; // ms after start
  event: FeedEvent;
}

/** A fake live capture of a finished scan folder: one photo every paceMs, combining for combineMs, then done. */
export function replayTimeline(name: string, scanId: string, paceMs: number, combineMs: number): Timed[] {
  const dirs = [0, 1, 2, 3].map((k) => scanUrl(name, `dir_${k}.png`, `${scanId}-${k}`));
  const out: Timed[] = [
    { at: 0, event: { type: "scanStarted", scanId } },
    { at: 0, event: { type: "ledOn", led: 0 } },
  ];
  for (let k = 0; k < 4; k++) {
    const at = (k + 1) * paceMs;
    out.push({ at, event: { type: "photoLanded", led: k, url: dirs[k] } });
    out.push({ at, event: k < 3 ? { type: "ledOn", led: k + 1 } : { type: "combining" } });
  }
  out.push({
    at: 4 * paceMs + combineMs,
    event: {
      type: "done",
      name,
      urls: { dirs, reveal: scanUrl(name, "reveal.png", `${scanId}-reveal`), steps: scanUrl(name, "steps.json", `${scanId}-steps`) },
    },
  });
  return out;
}

let replays = 0;

/** Plays replayTimeline in real time: development without hardware, and the backup demo. */
export class ReplayFeed implements Feed {
  readonly name: string;
  private readonly paceMs: number;
  private readonly combineMs: number;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(name = "sim", paceMs = 6000, combineMs = 5000) {
    this.name = name;
    this.paceMs = paceMs;
    this.combineMs = combineMs;
  }

  start(onEvent: (e: FeedEvent) => void): void {
    this.stop();
    const scanId = `replay-${this.name}-${++replays}`;
    for (const { at, event } of replayTimeline(this.name, scanId, this.paceMs, this.combineMs)) {
      this.timers.push(setTimeout(() => onEvent(event), at));
    }
  }

  stop(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
}
