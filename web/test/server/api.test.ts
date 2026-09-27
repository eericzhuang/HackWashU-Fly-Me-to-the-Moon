import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiMiddleware, type ApiOptions } from "../../server/api";

const fixture = readFileSync(new URL("../fixtures/vision-response.json", import.meta.url), "utf8");
let server: Server | undefined;

function outWithSim(): string {
  const out = mkdtempSync(join(tmpdir(), "out-"));
  mkdirSync(join(out, "sim"));
  writeFileSync(join(out, "sim", "meta.json"), JSON.stringify({ status: "done", captured: [0, 1, 2, 3] }));
  writeFileSync(join(out, "sim", "reveal.png"), Buffer.from([137, 80, 78, 71]));
  writeFileSync(join(out, "secret.txt"), "not for the browser");
  return out;
}

async function start(options: Partial<ApiOptions> = {}): Promise<string> {
  const outDir = outWithSim();
  const middleware = createApiMiddleware({ outDir, cacheDir: join(outDir, ".cache"), apiKey: "k", ...options });
  const s = createServer((req, res) => {
    void middleware(req, res, (err) => {
      res.statusCode = err ? 500 : 404;
      res.end("fallthrough");
    });
  });
  server = s;
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

afterEach(async () => {
  const s = server;
  server = undefined;
  if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
});

describe("GET /scan", () => {
  it("serves contract files without caching", async () => {
    const base = await start();
    const res = await fetch(`${base}/scan/sim/meta.json?v=abc`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ status: "done", captured: [0, 1, 2, 3] });
  });

  it("refuses anything outside the contract", async () => {
    const base = await start();
    expect((await fetch(`${base}/scan/sim/..%2Fsecret.txt`)).status).toBe(404);
    expect((await fetch(`${base}/scan/other/meta.json`)).status).toBe(404);
    expect((await fetch(`${base}/scan/sim/dir_0.png`)).status).toBe(404); // allowed name, file missing
  });

  it("lists scan folders", async () => {
    const base = await start();
    expect(await (await fetch(`${base}/scan`)).json()).toEqual(["sim"]);
  });

  it("leaves other paths to the next handler", async () => {
    const base = await start();
    expect(await (await fetch(`${base}/index.html`)).text()).toBe("fallthrough");
  });
});

describe("POST /api/read", () => {
  const post = (base: string, body: unknown) =>
    fetch(`${base}/api/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("returns the Vision reading", async () => {
    const base = await start({ fetchImpl: vi.fn<typeof fetch>(async () => new Response(fixture, { status: 200 })) });
    const res = await post(base, { scan: "sim" });
    expect(res.status).toBe(200);
    expect((await res.json()).text).toBe("Meet me on");
  });

  it("rejects a bad scan name", async () => {
    const base = await start();
    expect((await post(base, { scan: "../etc" })).status).toBe(400);
  });

  it("reports a missing key as 503 with a message", async () => {
    const base = await start({ apiKey: undefined });
    const res = await post(base, { scan: "sim" });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/GOOGLE_API_KEY/);
  });
});

describe("POST /api/review", () => {
  const post = (base: string, body: unknown) =>
    fetch(`${base}/api/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("writes the answer where terminator.review looks for it", async () => {
    const outDir = outWithSim();
    const middleware = createApiMiddleware({ outDir, cacheDir: join(outDir, ".cache"), apiKey: "k" });
    const s = createServer((req, res) => void middleware(req, res, () => res.end("fallthrough")));
    server = s;
    await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    const res = await post(base, { scan: "sim", id: "ab12", choice: 1, dx: -3, dy: 10 });
    expect(res.status).toBe(200);
    expect(JSON.parse(readFileSync(join(outDir, "sim", "review_answer.json"), "utf8"))).toEqual({ id: "ab12", choice: 1, dx: -3, dy: 10 });
  });

  it("rejects bad input", async () => {
    const base = await start();
    for (const body of [
      { scan: "../x", id: "ab12", choice: 0, dx: 0, dy: 0 },
      { scan: "sim", id: "AB/..", choice: 0, dx: 0, dy: 0 },
      { scan: "sim", id: "ab12", choice: -1, dx: 0, dy: 0 },
      { scan: "sim", id: "ab12", choice: 0.5, dx: 0, dy: 0 },
      { scan: "sim", id: "ab12", choice: 0, dx: 1e9, dy: 0 },
    ]) {
      expect((await post(base, body)).status).toBe(400);
    }
  });
});
