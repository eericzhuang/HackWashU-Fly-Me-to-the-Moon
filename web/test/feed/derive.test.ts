import { describe, expect, it } from "vitest";
import type { Meta } from "../../shared/types";
import { deriveState, diffStates, scanUrl } from "../../src/feed/derive";

const meta = (m: Partial<Meta>): Meta => ({ status: "capturing", captured: [], ...m });
const S = (m: Partial<Meta>) => deriveState("latest", meta({ started: "t1", ...m }));

describe("scanUrl", () => {
  it("adds a cache-busting version", () => {
    expect(scanUrl("latest", "dir_0.png", "2026-09-26T00:57:57-0")).toBe(
      "/scan/latest/dir_0.png?v=2026-09-26T00%3A57%3A57-0",
    );
  });
});

describe("deriveState", () => {
  it("capture: the lit LED is the number of photos so far", () => {
    expect(S({ captured: [0, 1] })).toEqual({ name: "latest", scanId: "t1", phase: "capture", activeLed: 2, captured: [0, 1] });
  });

  it("combining once all four landed but the scan is not done", () => {
    expect(S({ captured: [0, 1, 2, 3] })).toMatchObject({ phase: "combining", activeLed: null });
  });

  it("done; scanId falls back to the folder name (out/sim has no 'started')", () => {
    expect(deriveState("sim", meta({ status: "done", captured: [0, 1, 2, 3] }))).toEqual({
      name: "sim", scanId: "sim", phase: "done", activeLed: null, captured: [0, 1, 2, 3],
    });
  });

  it("ignores duplicate and out-of-range indexes", () => {
    expect(S({ captured: [0, 0, 7] }).captured).toEqual([0]);
  });
});

describe("diffStates", () => {
  it("stays quiet when the page opens on a finished scan", () => {
    expect(diffStates(null, S({ status: "done", captured: [0, 1, 2, 3] }))).toEqual([]);
  });

  it("starts a new scan", () => {
    expect(diffStates(null, S({}))).toEqual([{ type: "scanStarted", scanId: "t1" }, { type: "ledOn", led: 0 }]);
  });

  it("joins a scan already in progress", () => {
    expect(diffStates(null, S({ captured: [0, 1] }))).toEqual([
      { type: "scanStarted", scanId: "t1" },
      { type: "photoLanded", led: 0, url: "/scan/latest/dir_0.png?v=t1-0-capturing" },
      { type: "photoLanded", led: 1, url: "/scan/latest/dir_1.png?v=t1-1-capturing" },
      { type: "ledOn", led: 2 },
    ]);
  });

  it("a landed photo lights the next LED", () => {
    expect(diffStates(S({ captured: [0] }), S({ captured: [0, 1] }))).toEqual([
      { type: "photoLanded", led: 1, url: "/scan/latest/dir_1.png?v=t1-1-capturing" },
      { type: "ledOn", led: 2 },
    ]);
  });

  it("the fourth photo starts combining", () => {
    expect(diffStates(S({ captured: [0, 1, 2] }), S({ captured: [0, 1, 2, 3] }))).toEqual([
      { type: "photoLanded", led: 3, url: "/scan/latest/dir_3.png?v=t1-3-capturing" },
      { type: "combining" },
    ]);
  });

  it("done reloads every image under a new version (aligned images replace the previews)", () => {
    expect(diffStates(S({ captured: [0, 1, 2, 3] }), S({ status: "done", captured: [0, 1, 2, 3] }))).toEqual([
      {
        type: "done",
        name: "latest",
        urls: {
          dirs: [0, 1, 2, 3].map((k) => `/scan/latest/dir_${k}.png?v=t1-${k}-done`),
          reveal: "/scan/latest/reveal.png?v=t1-reveal-done",
        },
      },
    ]);
  });

  it("a missed combining poll still yields photoLanded, combining, done in order", () => {
    const types = diffStates(S({ captured: [0, 1, 2] }), S({ status: "done", captured: [0, 1, 2, 3] })).map((e) => e.type);
    expect(types).toEqual(["photoLanded", "combining", "done"]);
  });

  it("a new 'started' restarts the show", () => {
    const next = deriveState("latest", meta({ started: "t2" }));
    expect(diffStates(S({ status: "done", captured: [0, 1, 2, 3] }), next)).toEqual([
      { type: "scanStarted", scanId: "t2" },
      { type: "ledOn", led: 0 },
    ]);
  });

  it("nothing changed, nothing emitted", () => {
    expect(diffStates(S({ captured: [0] }), S({ captured: [0] }))).toEqual([]);
  });
});
