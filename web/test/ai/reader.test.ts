import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadResult } from "../../shared/types";
import { HttpReader } from "../../src/ai/reader";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("HttpReader", () => {
  it("posts the scan name and classifies a good reading", async () => {
    const body: ReadResult = {
      scanId: "sim",
      text: "Meet me",
      words: [
        { text: "Meet", box: [], confidence: 0.9 },
        { text: "me", box: [], confidence: 0.8 },
      ],
      meanConfidence: 0.85,
    };
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status: 200 }));
    const out = await new HttpReader(fetchImpl).read("sim");
    expect(out).toEqual({ kind: "ok", words: body.words, confident: [0, 1] });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/read",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ scan: "sim" }) }),
    );
  });

  it("turns a server error into kind 'error'", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{"error":"no key"}', { status: 503 }));
    expect((await new HttpReader(fetchImpl).read("sim")).kind).toBe("error");
  });

  it("turns a network failure into kind 'error'", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect((await new HttpReader(fetchImpl).read("sim")).kind).toBe("error");
  });
});
