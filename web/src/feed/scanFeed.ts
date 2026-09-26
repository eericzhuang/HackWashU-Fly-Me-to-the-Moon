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
    try {
      const res = await this.fetchImpl(`/scan/${this.name}/meta.json`, { cache: "no-store" });
      if (!res.ok) return;
      const next = deriveState(this.name, (await res.json()) as Meta);
      const events = diffStates(this.state, next);
      this.state = next;
      for (const e of events) this.onEvent(e);
    } catch {
      // keep the last state
    } finally {
      this.busy = false;
    }
  }
}
