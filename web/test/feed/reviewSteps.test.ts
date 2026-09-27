import { describe, expect, it } from "vitest";
import type { Meta, ReviewInfo } from "../../shared/types";
import { deriveState, diffStates } from "../../src/feed/derive";

const review: ReviewInfo = {
  id: "ab12", led: 3, check: "unverified", detail: "no other photo matches it", ref: "review_ref.png",
  options: [{ label: "shift + rotation only", score: 0.28, file: "review_0.png" }, { label: "no alignment", score: 0, file: "review_1.png" }],
  ai: null, timeout: 90,
};
const S = (m: Partial<Meta>) => deriveState("latest", { status: "capturing", captured: [0, 1, 2, 3], started: "t1", ...m });

describe("alignment review in meta.json", () => {
  it("opens a review with cache-busted image URLs", () => {
    const ev = diffStates(S({}), S({ review }));
    expect(ev).toEqual([{
      type: "review", name: "latest", review,
      urls: { ref: "/scan/latest/review_ref.png?v=t1-review-ab12",
              options: ["/scan/latest/review_0.png?v=t1-review-ab12", "/scan/latest/review_1.png?v=t1-review-ab12"] },
    }]);
  });

  it("closes it when the pipeline removes it, and not again on the next poll", () => {
    expect(diffStates(S({ review }), S({}))).toEqual([{ type: "reviewDone" }]);
    expect(diffStates(S({}), S({}))).toEqual([]);
  });

  it("a second review for another photo replaces the first", () => {
    const ev = diffStates(S({ review }), S({ review: { ...review, id: "cd34", led: 1 } }));
    expect(ev.map((e) => e.type)).toEqual(["review"]);
  });

  it("closes the review when the scan finishes and passes the step pages on", () => {
    const ev = diffStates(S({ review }), S({ status: "done", steps: "steps.json" }));
    expect(ev.map((e) => e.type)).toEqual(["reviewDone", "done"]);
    const done = ev[1] as Extract<(typeof ev)[number], { type: "done" }>;
    expect(done.urls.steps).toBe("/scan/latest/steps.json?v=t1-steps");
  });

  it("a finished scan without step pages has no steps URL", () => {
    const ev = diffStates(S({}), S({ status: "done" }));
    expect((ev[0] as Extract<(typeof ev)[number], { type: "done" }>).urls.steps).toBeUndefined();
  });
});
