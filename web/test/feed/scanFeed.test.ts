import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Meta } from "../../shared/types";
import { ScanFeed } from "../../src/feed/scanFeed";
import type { FeedEvent } from "../../src/feed/types";

/** A fetch that answers each call with the next reply: a Meta (200 JSON) or a bare status code. */
function replies(...rs: (Meta | number)[]) {
  let i = 0;
  return vi.fn<typeof fetch>(async () => {
    const r = rs[Math.min(i++, rs.length - 1)];
    return typeof r === "number" ? new Response("", { status: r }) : new Response(JSON.stringify(r), { status: 200 });
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("ScanFeed", () => {
  it("polls meta.json without cache and turns changes into events", async () => {
    const fetchImpl = replies(
      { status: "capturing", captured: [], started: "t1" },
      { status: "capturing", captured: [0], started: "t1" },
    );
    const feed = new ScanFeed("latest", 250, fetchImpl);
    const events: FeedEvent[] = [];
    feed.start((e) => events.push(e));

    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([{ type: "scanStarted", scanId: "t1" }, { type: "ledOn", led: 0 }]);
    expect(fetchImpl).toHaveBeenCalledWith("/scan/latest/meta.json", { cache: "no-store" });

    await vi.advanceTimersByTimeAsync(250);
    expect(events.slice(2)).toEqual([
      { type: "photoLanded", led: 0, url: "/scan/latest/dir_0.png?v=t1-0-capturing" },
      { type: "ledOn", led: 1 },
    ]);
    feed.stop();
  });

  it("keeps the last state when a poll fails", async () => {
    const same: Meta = { status: "capturing", captured: [0], started: "t1" };
    const feed = new ScanFeed("latest", 250, replies(same, 404, same));
    const events: FeedEvent[] = [];
    feed.start((e) => events.push(e));
    await vi.advanceTimersByTimeAsync(600);
    expect(events.map((e) => e.type)).toEqual(["scanStarted", "photoLanded", "ledOn"]);
    expect(feed.current).toMatchObject({ scanId: "t1", captured: [0] });
    feed.stop();
  });

  it("stops polling when stopped", async () => {
    const fetchImpl = replies({ status: "done", captured: [0, 1, 2, 3] });
    const feed = new ScanFeed("sim", 250, fetchImpl);
    feed.start(() => {});
    await vi.advanceTimersByTimeAsync(0);
    feed.stop();
    const calls = fetchImpl.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchImpl.mock.calls.length).toBe(calls);
  });
});
