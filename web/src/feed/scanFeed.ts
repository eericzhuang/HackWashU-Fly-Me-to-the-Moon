import type { Meta } from "../../shared/types";
import { deriveState, diffStates } from "./derive";
import type { Feed, FeedEvent, ScanState } from "./types";

/** Polls out/<name>/meta.json (4x a second by default) and turns changes into show events. */
export class ScanFeed implements Feed {
  readonly name: string;
  private readonly intervalMs: number;
  private readonly fetchImpl: typeof fetch;
  private state: ScanState | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private onEvent: (e: FeedEvent) => void = () => {};
  private busy = false;
  private failing = false;

  // The arrow keeps `fetch` unbound from this object (calling it as a method throws "Illegal invocation").
  constructor(
    name = "latest",
    intervalMs = 250,
    fetchImpl: typeof fetch = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
  ) {
    this.name = name;
    this.intervalMs = intervalMs;
    this.fetchImpl = fetchImpl;
  }

  /** The last state seen, e.g. the finished scan the page opened on. */
  get current(): ScanState | null {
    return this.state;
  }

  start(onEvent: (e: FeedEvent) => void): void {
    this.stop();
    this.onEvent = onEvent;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One poll. A failure (no scan yet, server restarting) keeps the last state; the next tick retries. */
  async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    let events: FeedEvent[] = [];
    try {
      const res = await this.fetchImpl(`/scan/${this.name}/meta.json`, { cache: "no-store" });
      if (!res.ok) return;
      const next = deriveState(this.name, (await res.json()) as Meta);
      events = diffStates(this.state, next);
      this.state = next;
      this.failing = false;
    } catch (err) {
      // Keep the last state; only the first failure of a streak is worth logging.
      if (!this.failing) {
        this.failing = true;
        console.warn("meta.json poll failed:", err);
      }
    } finally {
      this.busy = false;
    }
    // Dispatched after the try/finally, each isolated: one bad handler must not drop the rest.
    for (const e of events) {
      try {
        this.onEvent(e);
      } catch (err) {
        console.error("show event failed:", e.type, err);
      }
    }
  }
}
