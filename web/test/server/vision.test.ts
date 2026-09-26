import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseVisionResponse, readReveal } from "../../server/vision";

const fixtureText = readFileSync(new URL("../fixtures/vision-response.json", import.meta.url), "utf8");
const fixture = JSON.parse(fixtureText);

function fakeScan(status: "capturing" | "done") {
  const outDir = mkdtempSync(join(tmpdir(), "out-"));
  mkdirSync(join(outDir, "sim"));
  writeFileSync(join(outDir, "sim", "meta.json"), JSON.stringify({ status, captured: [0, 1, 2, 3] }));
  writeFileSync(join(outDir, "sim", "reveal.png"), Buffer.from([137, 80, 78, 71]));
  return { outDir, cacheDir: join(outDir, ".cache"), name: "sim" };
}

const okFetch = () => vi.fn<typeof fetch>(async () => new Response(fixtureText, { status: 200 }));

describe("parseVisionResponse", () => {
  it("returns the words in reading order with boxes and confidence", () => {
    const r = parseVisionResponse(fixture);
    expect(r.words.map((w) => w.text)).toEqual(["Meet", "me", "on"]);
    expect(r.text).toBe("Meet me on");
    expect(r.words[0].box).toEqual([[45, 165], [300, 165], [300, 255], [45, 255]]);
    expect(r.words[1].box[3]).toEqual([0, 255]);
    expect(r.meanConfidence).toBeCloseTo((0.94 + 0.88 + 0.5) / 3);
  });

  it("handles a response with no text", () => {
    expect(parseVisionResponse({ responses: [{}] })).toEqual({ text: "", words: [], meanConfidence: 0 });
  });
});

describe("readReveal", () => {
  it("sends the key in a header, not the URL, and caches the result", async () => {
    const fetchImpl = okFetch();
    const scan = fakeScan("done");
    const first = await readReveal({ ...scan, apiKey: "k123", fetchImpl });
    expect(first).toMatchObject({ scanId: "sim", text: "Meet me on" });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://vision.googleapis.com/v1/images:annotate");
    expect((init!.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("k123");
    const body = JSON.parse(init!.body as string);
    expect(body.requests[0].features).toEqual([{ type: "DOCUMENT_TEXT_DETECTION" }]);
    expect(body.requests[0].image.content).toBe(Buffer.from([137, 80, 78, 71]).toString("base64"));

    const again = await readReveal({ ...scan, apiKey: undefined, fetchImpl });
    expect(again).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses a scan that is not done (reveal.png may be stale)", async () => {
    await expect(readReveal({ ...fakeScan("capturing"), apiKey: "k", fetchImpl: okFetch() })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("404s a missing scan", async () => {
    const scan = fakeScan("done");
    await expect(readReveal({ ...scan, name: "latest", apiKey: "k", fetchImpl: okFetch() })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("needs a key when nothing is cached", async () => {
    await expect(readReveal({ ...fakeScan("done"), apiKey: undefined, fetchImpl: okFetch() })).rejects.toMatchObject({
      status: 503,
    });
  });

  it("turns a Google error into 502 with Google's message", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 400 }),
    );
    await expect(readReveal({ ...fakeScan("done"), apiKey: "bad", fetchImpl })).rejects.toMatchObject({
      status: 502,
      message: "Google Vision: API key not valid",
    });
  });
});
