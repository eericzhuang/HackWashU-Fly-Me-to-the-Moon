import { afterEach, describe, expect, it, vi } from "vitest";
import { ReplayFeed, replayTimeline } from "../../src/feed/replayFeed";
import type { FeedEvent } from "../../src/feed/types";

afterEach(() => vi.useRealTimers());

describe("replayTimeline", () => {
  it("lays out a whole scan: one photo per pace, then combining, then done", () => {
    const t = replayTimeline("sim", "r1", 1000, 500);
    expect(t.map((x) => [x.at, x.event.type])).toEqual([
      [0, "scanStarted"], [0, "ledOn"],
      [1000, "photoLanded"], [1000, "ledOn"],
      [2000, "photoLanded"], [2000, "ledOn"],
      [3000, "photoLanded"], [3000, "ledOn"],
      [4000, "photoLanded"], [4000, "combining"],
      [4500, "done"],
    ]);
    expect(t[2].event).toEqual({ type: "photoLanded", led: 0, url: "/scan/sim/dir_0.png?v=r1-0" });
    expect(t[10].event).toEqual({
      type: "done",
      name: "sim",
      urls: { dirs: [0, 1, 2, 3].map((k) => `/scan/sim/dir_${k}.png?v=r1-${k}`), reveal: "/scan/sim/reveal.png?v=r1-reveal" },
    });
  });
});

describe("ReplayFeed", () => {
  it("plays in real time and can be stopped", async () => {
    vi.useFakeTimers();
    const feed = new ReplayFeed("sim", 1000, 500);
    const seen: string[] = [];
    feed.start((e) => seen.push(e.type));
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual(["scanStarted", "ledOn", "photoLanded", "ledOn"]);
    feed.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(seen).toHaveLength(4);
  });

  it("gives every replay a fresh scanId so the show restarts cleanly", async () => {
    vi.useFakeTimers();
    const feed = new ReplayFeed("sim", 1000, 500);
    const ids: string[] = [];
    const onEvent = (e: FeedEvent) => {
      if (e.type === "scanStarted") ids.push(e.scanId);
    };
    feed.start(onEvent);
    await vi.advanceTimersByTimeAsync(0);
    feed.start(onEvent);
    await vi.advanceTimersByTimeAsync(0);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    feed.stop();
  });
});
