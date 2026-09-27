# Web UI L0 (Skeleton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A complete, demoable end-to-end web show for the Terminator scan: it follows `out/latest/meta.json` hands-free through capture → combining → reveal, OCRs `reveal.png` with Google Vision, reads the words aloud with word highlighting, and falls back to the "1202 alarm" when reading fails. The visuals are a plain CSS stand-in that L1 will replace with three.js.

**Architecture:** `web/` is a Vite + TypeScript app. A Vite plugin (Node, `web/server/`) serves the scan files read-only (`GET /scan/...`) and proxies OCR (`POST /api/read`) so the Google key never reaches the browser. In the browser (`web/src/`), a feed turns `meta.json` changes into events, and a `Director` state machine drives three swappable parts: `Stage` (the picture), `Overlay` (HTML text) and `Voice` (speech).

**Tech Stack:** Vite 8.3.1, TypeScript 7.0.2, Vitest 5.0.2, @types/node 26.6.3. No runtime dependencies in L0.

**Spec:** `docs/dev/web-ui/specs/2026-09-26-web-ui-design.md`. This plan covers layer **L0** only. L1 (moon + sound), L2 (descent + hold the sun) and L3 (easter eggs) get their own plans once L0 exists.

## Global Constraints

- Node ≥ 20.19 (Vite 8). Development happens on Windows (Node 24); the demo runs on Eric's Mac.
- Do not modify Eric's Python code or the scan-folder contract. The web side only **reads** `out/`, and never writes to it.
- `GOOGLE_API_KEY` lives only in `web/.env.local` (gitignored) and is read only by the Node server. Never give it a `VITE_` prefix, never put it in a URL (send the `X-Goog-Api-Key` header instead), and never enter or commit a real key yourself. The user types it in.
- Everything works offline except the Google call: no CDN imports.
- LED index → direction: `0 = north (top)`, `1 = east (right)`, `2 = south (bottom)`, `3 = west (left)`.
- UI copy is English, verbatim from the spec: `Write a secret. Tear off the page.`, `FULL MOON · NO SHADOWS · THE PAGE LOOKS BLANK`, `SHOT k / 4`, `<Dir> light on — tap the shutter`, `Got shot k`, `COMBINING`, `aligning four shots`, `1202 PROGRAM ALARM`, `waiting for photo…`, `press any key to arm audio`.
- Timing constants: OCR deadline 8000 ms after `done`; hold 3000 ms after reading; stuck warning after 120 000 ms with no event while capturing; photo close-up 2000 ms.
- OCR confidence threshold: `0.5` (`ok` means mean ≥ 0.5 and at least one word).
- TypeScript is strict, with `verbatimModuleSyntax`: import types with `import type`.
- Run every command from `web/` unless noted. Commit messages follow the repo style: a plain sentence, no `feat:` prefix. Never pass `-n` or `--no-verify` to git.

---

## File Structure

```
web/
  package.json            scripts: dev, build, demo, test, typecheck
  tsconfig.json           one strict config for src/, server/, shared/, test/
  vite.config.ts          ports + the terminator-api plugin (reads GOOGLE_API_KEY)
  vitest.config.ts        node environment, test/**/*.test.ts
  index.html              #stage and #overlay roots
  .env.example            GOOGLE_API_KEY= (template, committed)
  shared/types.ts         Meta, Word, ReadResult (used by server and browser)
  server/http.ts          HttpError, sendJson, readJsonBody
  server/scans.ts         SCAN_NAME, SCAN_FILES, resolveScanFile, listScans
  server/cache.ts         cachePath, readCache, writeCache (web/.cache)
  server/vision.ts        LANGUAGE_HINTS, visionRequestBody, parseVisionResponse, readReveal
  server/api.ts           createApiMiddleware (GET /scan, GET /scan/:name/:file, POST /api/read)
  server/plugin.ts        terminatorApi (mounts the middleware on dev + preview)
  src/main.ts             wiring: feeds -> Director; keys
  src/style.css           L0 look (stage + overlay)
  src/feed/types.ts       Phase, ScanState, FeedEvent, Feed
  src/feed/derive.ts      scanUrl, deriveState, diffStates (pure)
  src/feed/scanFeed.ts    ScanFeed (polls meta.json)
  src/feed/replayFeed.ts  replayTimeline, ReplayFeed (fake live scan from a finished folder)
  src/ai/classify.ts      MIN_CONFIDENCE, Outcome, classify (pure)
  src/ai/reader.ts        HttpReader (POST /api/read, never rejects)
  src/show/director.ts    Director + Stage/Overlay/Reader/Voice interfaces, TIMING, sleep
  src/show/keys.ts        bindKeys
  src/scene/domStage.ts   DomStage (CSS moon, plates, reveal page, word boxes)
  src/ui/overlay.ts       DomOverlay (all text)
  src/audio/voice.ts      SilentVoice, BrowserVoice (speechSynthesis)
  test/...                Vitest tests mirroring the paths above
```

---

### Task 1: Scaffold `web/` and scan-folder access

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vitest.config.ts`, `web/vite.config.ts`, `web/index.html`, `web/src/main.ts`, `web/shared/types.ts`, `web/server/scans.ts`
- Test: `web/test/server/scans.test.ts`

**Interfaces:**
- Produces: `shared/types.ts` → `Meta`, `Word`, `ReadResult`; `server/scans.ts` → `SCAN_NAME: RegExp`, `SCAN_FILES: Set<string>`, `resolveScanFile(outDir: string, name: string, file: string): string | null`, `listScans(outDir: string): string[]`

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "terminator-web",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20.19" },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "demo": "vite build && vite preview",
    "test": "vitest run",
    "typecheck": "tsc -p ."
  }
}
```

- [ ] **Step 2: Install the dev dependencies**

Run: `npm install -D vite@8.3.1 vitest@5.0.2 typescript@7.0.2 @types/node@26.6.3`
Expected: `added N packages`, and `package-lock.json` is created. `web/node_modules/` is already gitignored.

- [ ] **Step 3: Create the configs**

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["node", "vite/client"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src", "server", "shared", "test", "vite.config.ts", "vitest.config.ts"]
}
```

`web/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
```

`web/vite.config.ts` (Task 3 adds the API plugin):
```ts
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
});
```

- [ ] **Step 4: Create the page shell**

`web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Terminator</title>
  </head>
  <body>
    <div id="stage"></div>
    <div id="overlay"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`web/src/main.ts` (a temporary placeholder; Task 8 replaces it):
```ts
document.querySelector<HTMLElement>("#overlay")!.textContent = "TERMINATOR";
```

- [ ] **Step 5: Create the shared types**

`web/shared/types.ts`:
```ts
/** Types shared by the Node server (web/server) and the browser app (web/src). */

/** out/<scan>/meta.json, written by Eric's terminator.scan / terminator.phone. */
export interface Meta {
  status: "capturing" | "done";
  directions?: string[];
  captured: number[];
  started?: string;
  seconds?: number;
  source?: string;
}

/** One word Google Vision found in reveal.png; box vertices are reveal.png pixels. */
export interface Word {
  text: string;
  box: [number, number][];
  confidence: number;
}

/** POST /api/read response. */
export interface ReadResult {
  scanId: string;
  text: string;
  words: Word[];
  meanConfidence: number;
}
```

- [ ] **Step 6: Write the failing test**

`web/test/server/scans.test.ts`:
```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listScans, resolveScanFile } from "../../server/scans";

describe("resolveScanFile", () => {
  it("allows contract files in known scan folders", () => {
    expect(resolveScanFile("/o", "latest", "meta.json")).toBe(join("/o", "latest", "meta.json"));
    expect(resolveScanFile("/o", "sim", "reveal.png")).toBe(join("/o", "sim", "reveal.png"));
    expect(resolveScanFile("/o", "scan_20260926_005757", "dir_3.png")).toBe(
      join("/o", "scan_20260926_005757", "dir_3.png"),
    );
  });

  it("rejects unknown folders, unknown files and traversal", () => {
    expect(resolveScanFile("/o", "..", "meta.json")).toBeNull();
    expect(resolveScanFile("/o", "cameras", "meta.json")).toBeNull();
    expect(resolveScanFile("/o", "latest", "../rig.json")).toBeNull();
    expect(resolveScanFile("/o", "latest", "raw")).toBeNull();
    expect(resolveScanFile("/o", "latest", "explain.png")).toBeNull();
  });
});

describe("listScans", () => {
  it("lists folders with a meta.json: latest, sim, then newest scan first", () => {
    const out = mkdtempSync(join(tmpdir(), "out-"));
    for (const name of ["scan_20260925_120000", "sim", "scan_20260926_005757", "latest", "cameras"]) {
      mkdirSync(join(out, name));
      writeFileSync(join(out, name, "meta.json"), "{}");
    }
    mkdirSync(join(out, "scan_20260101_000000")); // no meta.json: skipped
    expect(listScans(out)).toEqual(["latest", "sim", "scan_20260926_005757", "scan_20260925_120000"]);
  });

  it("returns [] when out/ does not exist", () => {
    expect(listScans(join(tmpdir(), "terminator-missing-out-dir"))).toEqual([]);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run test/server/scans.test.ts`
Expected: FAIL, because `../../server/scans` cannot be resolved.

- [ ] **Step 8: Implement `web/server/scans.ts`**

```ts
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Scan folders the UI may read: the live mirror, the committed simulation, and past scans. */
export const SCAN_NAME = /^(latest|sim|scan_\d{8}_\d{6})$/;

/** The only files the UI may read from a scan folder (the interface contract in CLAUDE.md). */
export const SCAN_FILES = new Set([
  "meta.json",
  "dark.png",
  "dir_0.png",
  "dir_1.png",
  "dir_2.png",
  "dir_3.png",
  "reveal.png",
  "relief_raw.png",
]);

/** Absolute path of out/<name>/<file>, or null if the folder or file is not allowed. */
export function resolveScanFile(outDir: string, name: string, file: string): string | null {
  if (!SCAN_NAME.test(name) || !SCAN_FILES.has(file)) return null;
  return join(outDir, name, file);
}

/** Scan folders under outDir that have a meta.json: latest, sim, then past scans newest first. */
export function listScans(outDir: string): string[] {
  if (!existsSync(outDir)) return [];
  const rank = (n: string) => (n === "latest" ? 0 : n === "sim" ? 1 : 2);
  return readdirSync(outDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && SCAN_NAME.test(d.name) && existsSync(join(outDir, d.name, "meta.json")))
    .map((d) => d.name)
    .sort((a, b) => rank(a) - rank(b) || b.localeCompare(a));
}
```

- [ ] **Step 9: Run the tests, typecheck and build**

Run: `npx vitest run test/server/scans.test.ts`
Expected: PASS (4 tests).

Run: `npm run typecheck`
Expected: no output, exit code 0.

Run: `npm run build`
Expected: `✓ built in ...`, and `web/dist/` is created (gitignored).

- [ ] **Step 10: Commit** (from the repo root)

```bash
git add web/package.json web/package-lock.json web/tsconfig.json web/vitest.config.ts web/vite.config.ts web/index.html web/src/main.ts web/shared/types.ts web/server/scans.ts web/test/server/scans.test.ts
git commit -m "Web UI scaffold (Vite + TS) and read-only scan folder access"
```

---

### Task 2: Google Vision reading with a per-scan cache

**Files:**
- Create: `web/server/http.ts`, `web/server/cache.ts`, `web/server/vision.ts`, `web/test/fixtures/vision-response.json`
- Test: `web/test/server/vision.test.ts`

**Interfaces:**
- Consumes: `Meta`, `ReadResult`, `Word` from `shared/types.ts`
- Produces:
  - `server/http.ts`: `class HttpError extends Error { status: number }`, `sendJson(res, status, body): void`, `readJsonBody(req, limit?): Promise<unknown>`
  - `server/cache.ts`: `cachePath(cacheDir: string, kind: "ocr" | "tts", key: string): string`, `readCache<T>(path): Promise<T | null>`, `writeCache(path, data): Promise<void>`
  - `server/vision.ts`: `LANGUAGE_HINTS: string[]`, `visionRequestBody(pngBase64)`, `parseVisionResponse(json): Omit<ReadResult, "scanId">`, `interface ReadOptions { outDir; cacheDir; name; apiKey: string | undefined; fetchImpl?: typeof fetch }`, `readReveal(o: ReadOptions): Promise<ReadResult>` (throws `HttpError` 404/409/503/502)

- [ ] **Step 1: Create the Vision fixture**

`web/test/fixtures/vision-response.json` (the shape of a real `images:annotate` answer, trimmed; the second word's last vertex has no `x`, as Google omits zero coordinates):
```json
{
  "responses": [
    {
      "fullTextAnnotation": {
        "text": "Meet me\non\n",
        "pages": [
          {
            "blocks": [
              {
                "paragraphs": [
                  {
                    "words": [
                      {
                        "boundingBox": { "vertices": [{ "x": 45, "y": 165 }, { "x": 300, "y": 165 }, { "x": 300, "y": 255 }, { "x": 45, "y": 255 }] },
                        "symbols": [{ "text": "M" }, { "text": "e" }, { "text": "e" }, { "text": "t" }],
                        "confidence": 0.94
                      },
                      {
                        "boundingBox": { "vertices": [{ "x": 340, "y": 190 }, { "x": 490, "y": 190 }, { "x": 490, "y": 255 }, { "y": 255 }] },
                        "symbols": [{ "text": "m" }, { "text": "e" }],
                        "confidence": 0.88
                      }
                    ]
                  },
                  {
                    "words": [
                      {
                        "boundingBox": { "vertices": [{ "x": 548, "y": 190 }, { "x": 668, "y": 190 }, { "x": 668, "y": 255 }, { "x": 548, "y": 255 }] },
                        "symbols": [{ "text": "o" }, { "text": "n" }],
                        "confidence": 0.5
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

`web/test/server/vision.test.ts`:
```ts
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
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run test/server/vision.test.ts`
Expected: FAIL, because `../../server/vision` cannot be resolved.

- [ ] **Step 4: Implement `web/server/http.ts`**

```ts
import type { IncomingMessage, ServerResponse } from "node:http";

/** An error with the HTTP status the API should answer with. */
export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export async function readJsonBody(req: IncomingMessage, limit = 10_000): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new HttpError(413, "request body too large");
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, "request body is not JSON");
  }
}
```

- [ ] **Step 5: Implement `web/server/cache.ts`**

```ts
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** web/.cache/<kind>/<sha1(key)>.json. Hashed because keys contain ':', which Windows file names can't. */
export function cachePath(cacheDir: string, kind: "ocr" | "tts", key: string): string {
  return join(cacheDir, kind, `${createHash("sha1").update(key).digest("hex")}.json`);
}

export async function readCache<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Write via tmp + rename so a half-written cache file is never read. */
export async function writeCache(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, path);
}
```

- [ ] **Step 6: Implement `web/server/vision.ts`**

```ts
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Meta, ReadResult, Word } from "../shared/types";
import { cachePath, readCache, writeCache } from "./cache";
import { HttpError } from "./http";

const ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

/** Google's documented hint for English handwriting. If Vision rejects it, change this to ["en"]. */
export const LANGUAGE_HINTS = ["en-t-i0-handwrit"];

export function visionRequestBody(pngBase64: string) {
  return {
    requests: [
      {
        image: { content: pngBase64 },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        imageContext: { languageHints: LANGUAGE_HINTS },
      },
    ],
  };
}

interface VisionWord {
  boundingBox?: { vertices?: { x?: number; y?: number }[] };
  symbols?: { text?: string }[];
  confidence?: number;
}

interface VisionResponse {
  error?: { message?: string };
  responses?: {
    error?: { message?: string };
    fullTextAnnotation?: { pages?: { blocks?: { paragraphs?: { words?: VisionWord[] }[] }[] }[] };
  }[];
}

/** The words in reading order with their boxes; text is the words joined by single spaces,
 *  so word i of the text is words[i] (the voice and the highlight rely on that). */
export function parseVisionResponse(json: VisionResponse): Omit<ReadResult, "scanId"> {
  const words: Word[] = [];
  for (const page of json.responses?.[0]?.fullTextAnnotation?.pages ?? [])
    for (const block of page.blocks ?? [])
      for (const para of block.paragraphs ?? [])
        for (const w of para.words ?? []) {
          const text = (w.symbols ?? []).map((s) => s.text ?? "").join("");
          if (!text) continue;
          const box = (w.boundingBox?.vertices ?? []).map((v): [number, number] => [v.x ?? 0, v.y ?? 0]);
          words.push({ text, box, confidence: w.confidence ?? 0 });
        }
  const meanConfidence = words.length ? words.reduce((sum, w) => sum + w.confidence, 0) / words.length : 0;
  return { text: words.map((w) => w.text).join(" "), words, meanConfidence };
}

export interface ReadOptions {
  outDir: string;
  cacheDir: string;
  name: string;
  apiKey: string | undefined;
  fetchImpl?: typeof fetch;
}

/** OCR out/<name>/reveal.png with Google Vision. Cached per scan in web/.cache/ocr, so replays are free. */
export async function readReveal(o: ReadOptions): Promise<ReadResult> {
  const dir = join(o.outDir, o.name);
  let meta: Meta;
  try {
    meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8")) as Meta;
  } catch {
    throw new HttpError(404, `no scan at out/${o.name}`);
  }
  if (meta.status !== "done") throw new HttpError(409, `scan ${o.name} is not done yet`);

  const revealPath = join(dir, "reveal.png");
  const info = await stat(revealPath).catch(() => null);
  if (!info) throw new HttpError(404, `no reveal.png in out/${o.name}`);
  const scanId = meta.started ?? o.name;
  const path = cachePath(o.cacheDir, "ocr", `${o.name}:${meta.started ?? "-"}:${info.mtimeMs}`);
  const cached = await readCache<ReadResult>(path);
  if (cached) return cached;
  if (!o.apiKey) throw new HttpError(503, "GOOGLE_API_KEY is not set (put it in web/.env.local)");

  const png = await readFile(revealPath);
  const res = await (o.fetchImpl ?? fetch)(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": o.apiKey },
    body: JSON.stringify(visionRequestBody(png.toString("base64"))),
  });
  const json = (await res.json().catch(() => ({}))) as VisionResponse;
  const error = json.error?.message ?? json.responses?.[0]?.error?.message;
  if (!res.ok || error) throw new HttpError(502, `Google Vision: ${error ?? res.status}`);

  const result: ReadResult = { scanId, ...parseVisionResponse(json) };
  await writeCache(path, result);
  return result;
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run test/server`
Expected: PASS (all tests in `scans.test.ts` and `vision.test.ts`).

Run: `npm run typecheck`
Expected: exit code 0.

- [ ] **Step 8: Commit**

```bash
git add web/server/http.ts web/server/cache.ts web/server/vision.ts web/test/fixtures/vision-response.json web/test/server/vision.test.ts
git commit -m "Server-side Google Vision reading of reveal.png, cached per scan"
```

---

### Task 3: HTTP API middleware and the Vite plugin

**Files:**
- Create: `web/server/api.ts`, `web/server/plugin.ts`, `web/.env.example`
- Modify: `web/vite.config.ts` (full replacement below)
- Test: `web/test/server/api.test.ts`

**Interfaces:**
- Consumes: `resolveScanFile`, `listScans`, `SCAN_NAME` (Task 1); `HttpError`, `sendJson`, `readJsonBody`, `readReveal` (Task 2)
- Produces:
  - `server/api.ts`: `interface ApiOptions { outDir: string; cacheDir: string; apiKey: string | undefined; fetchImpl?: typeof fetch }`, `createApiMiddleware(o: ApiOptions): (req, res, next) => Promise<void>`
  - `server/plugin.ts`: `terminatorApi(options: ApiOptions): Plugin`
  - HTTP routes:
    - `GET /scan` → `string[]`
    - `GET /scan/:name/:file` → the file, sent with `Cache-Control: no-store`
    - `POST /api/read` with `{ "scan": string }` → `ReadResult` on success, otherwise `{ "error": string }` with status 400, 404, 409, 502 or 503

- [ ] **Step 1: Write the failing tests**

`web/test/server/api.test.ts`:
```ts
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/server/api.test.ts`
Expected: FAIL, because `../../server/api` cannot be resolved.

- [ ] **Step 3: Implement `web/server/api.ts`**

```ts
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError, readJsonBody, sendJson } from "./http";
import { listScans, resolveScanFile, SCAN_NAME } from "./scans";
import { readReveal } from "./vision";

export interface ApiOptions {
  outDir: string;
  cacheDir: string;
  apiKey: string | undefined;
  fetchImpl?: typeof fetch;
}

type Next = (err?: unknown) => void;

const TYPES: Record<string, string> = { json: "application/json", png: "image/png" };

/** Connect-style middleware: GET /scan, GET /scan/:name/:file, POST /api/read. Everything else -> next(). */
export function createApiMiddleware(o: ApiOptions) {
  return async (req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    try {
      if (req.method === "GET" && path === "/scan") return sendJson(res, 200, listScans(o.outDir));
      const file = /^\/scan\/([^/]+)\/([^/]+)$/.exec(path);
      if (req.method === "GET" && file) return await sendScanFile(res, o.outDir, file[1], file[2]);
      if (req.method === "POST" && path === "/api/read") {
        const body = (await readJsonBody(req)) as { scan?: unknown };
        const name = typeof body.scan === "string" ? body.scan : "";
        if (!SCAN_NAME.test(name)) throw new HttpError(400, "bad scan name");
        return sendJson(res, 200, await readReveal({ ...o, name }));
      }
      next();
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
      next(e);
    }
  };
}

async function sendScanFile(res: ServerResponse, outDir: string, name: string, file: string): Promise<void> {
  const decoded = decodeURIComponent(file);
  const full = resolveScanFile(outDir, decodeURIComponent(name), decoded);
  if (!full) throw new HttpError(404, "not a scan file");
  const info = await stat(full).catch(() => null);
  if (!info?.isFile()) throw new HttpError(404, "not found");
  res.statusCode = 200;
  res.setHeader("Content-Type", TYPES[decoded.split(".").pop() ?? ""] ?? "application/octet-stream");
  res.setHeader("Content-Length", info.size);
  res.setHeader("Cache-Control", "no-store"); // out/latest files are replaced in place
  createReadStream(full).pipe(res);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/server`
Expected: PASS (every server test).

- [ ] **Step 5: Implement `web/server/plugin.ts`, update `web/vite.config.ts` and add `web/.env.example`**

`web/server/plugin.ts`:
```ts
import type { Plugin } from "vite";
import { createApiMiddleware, type ApiOptions } from "./api";

/** Mounts the scan/API middleware on both `vite` (development) and `vite preview` (the demo). */
export function terminatorApi(options: ApiOptions): Plugin {
  const middleware = createApiMiddleware(options);
  return {
    name: "terminator-api",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
```

`web/vite.config.ts` (full replacement):
```ts
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import { terminatorApi } from "./server/plugin";

const webDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  // Prefix "" loads GOOGLE_API_KEY for the server only; the browser only ever sees VITE_* variables.
  const env = loadEnv(mode, webDir, "");
  return {
    plugins: [
      terminatorApi({
        outDir: fileURLToPath(new URL("../out", import.meta.url)),
        cacheDir: fileURLToPath(new URL("./.cache", import.meta.url)),
        apiKey: env.GOOGLE_API_KEY || undefined,
      }),
    ],
    server: { port: 5173, strictPort: true },
    preview: { port: 5173, strictPort: true },
  };
});
```

`web/.env.example`:
```
# Copy to web/.env.local (gitignored) and fill in. Read only by the Node server, never sent to the browser.
GOOGLE_API_KEY=
```

- [ ] **Step 6: Check the dev server by hand**

Run `npm run dev` in a second terminal (it keeps running), then:

Run: `curl -s http://localhost:5173/scan/sim/meta.json`
Expected: the JSON from `out/sim/meta.json` (`"status": "done"`, `"text": "Meet me on the moon at 9"`).

Run: `curl -s http://localhost:5173/scan`
Expected: `["sim"]`, plus any other scan folders in `out/`.

Run: `curl -s -X POST -H "Content-Type: application/json" -d "{\"scan\":\"sim\"}" http://localhost:5173/api/read`
Expected, with no `.env.local` yet: `{"error":"GOOGLE_API_KEY is not set (put it in web/.env.local)"}`

Stop the dev server.

- [ ] **Step 7: Typecheck and commit**

Run: `npm run typecheck`
Expected: exit code 0.

```bash
git add web/server/api.ts web/server/plugin.ts web/vite.config.ts web/.env.example web/test/server/api.test.ts
git commit -m "Scan file and OCR API as a Vite plugin for dev and preview"
```

---

### Task 4: Deriving show events from meta.json

**Files:**
- Create: `web/src/feed/types.ts`, `web/src/feed/derive.ts`
- Test: `web/test/feed/derive.test.ts`

**Interfaces:**
- Consumes: `Meta` from `shared/types.ts`
- Produces:
  - `src/feed/types.ts`:
    ```ts
    type Phase = "capture" | "combining" | "done";
    interface ScanState { name: string; scanId: string; phase: Phase; activeLed: number | null; captured: number[] }
    interface DoneUrls { dirs: string[]; reveal: string }
    type FeedEvent =
      | { type: "scanStarted"; scanId: string }
      | { type: "ledOn"; led: number }
      | { type: "photoLanded"; led: number; url: string }
      | { type: "combining" }
      | { type: "done"; name: string; urls: DoneUrls };
    interface Feed { start(onEvent: (e: FeedEvent) => void): void; stop(): void }
    ```
  - `src/feed/derive.ts`: `scanUrl(name, file, version): string`, `deriveState(name: string, meta: Meta): ScanState`, `diffStates(prev: ScanState | null, next: ScanState): FeedEvent[]`

- [ ] **Step 1: Write the failing tests**

`web/test/feed/derive.test.ts`:
```ts
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/feed/derive.test.ts`
Expected: FAIL, because `../../src/feed/derive` cannot be resolved.

- [ ] **Step 3: Implement `web/src/feed/types.ts`**

```ts
export type Phase = "capture" | "combining" | "done";

/** What one meta.json says, in the show's terms. */
export interface ScanState {
  name: string; // folder under out/: "latest", "sim", "scan_..."
  scanId: string; // meta.started, or the folder name when there is none (out/sim)
  phase: Phase;
  activeLed: number | null; // the LED lit right now (capture only)
  captured: number[];
}

export interface DoneUrls {
  dirs: string[];
  reveal: string;
}

export type FeedEvent =
  | { type: "scanStarted"; scanId: string }
  | { type: "ledOn"; led: number }
  | { type: "photoLanded"; led: number; url: string }
  | { type: "combining" }
  | { type: "done"; name: string; urls: DoneUrls };

/** A source of show events: the live scan folder, or a replay of a finished one. */
export interface Feed {
  start(onEvent: (e: FeedEvent) => void): void;
  stop(): void;
}
```

- [ ] **Step 4: Implement `web/src/feed/derive.ts`**

```ts
import type { Meta } from "../../shared/types";
import type { DoneUrls, FeedEvent, ScanState } from "./types";

/** URL of a scan file. `version` defeats the browser cache, since out/latest files are replaced in place. */
export function scanUrl(name: string, file: string, version: string): string {
  return `/scan/${name}/${file}?v=${encodeURIComponent(version)}`;
}

/** terminator.phone lights LED k right after photo k-1 lands, so while capturing the lit LED is
 *  captured.length; four photos in but not done means aligning/combining. */
export function deriveState(name: string, meta: Meta): ScanState {
  const captured = (meta.captured ?? []).filter((k, i, all) => k >= 0 && k < 4 && all.indexOf(k) === i);
  const scanId = meta.started ?? name;
  if (meta.status === "done") return { name, scanId, phase: "done", activeLed: null, captured };
  const phase = captured.length >= 4 ? "combining" : "capture";
  return { name, scanId, phase, activeLed: phase === "capture" ? captured.length : null, captured };
}

function doneUrls(s: ScanState): DoneUrls {
  return {
    dirs: [0, 1, 2, 3].map((k) => scanUrl(s.name, `dir_${k}.png`, `${s.scanId}-${k}-done`)),
    reveal: scanUrl(s.name, "reveal.png", `${s.scanId}-reveal-done`),
  };
}

/** Events that take the show from `prev` to `next`. prev === null is the first poll after the page
 *  loads: a finished scan stays quiet (the page idles), an unfinished one is joined mid-way. */
export function diffStates(prev: ScanState | null, next: ScanState): FeedEvent[] {
  if (prev === null && next.phase === "done") return [];
  const fresh = prev === null || prev.scanId !== next.scanId;
  const before: ScanState = fresh ? { ...next, phase: "capture", activeLed: null, captured: [] } : prev;
  const events: FeedEvent[] = fresh ? [{ type: "scanStarted", scanId: next.scanId }] : [];

  for (const k of next.captured) {
    if (!before.captured.includes(k)) {
      events.push({ type: "photoLanded", led: k, url: scanUrl(next.name, `dir_${k}.png`, `${next.scanId}-${k}-capturing`) });
    }
  }
  if (next.phase === "capture" && next.activeLed !== null && next.activeLed !== before.activeLed) {
    events.push({ type: "ledOn", led: next.activeLed });
  }
  if (next.phase !== "capture" && before.phase === "capture") events.push({ type: "combining" });
  if (next.phase === "done" && before.phase !== "done") events.push({ type: "done", name: next.name, urls: doneUrls(next) });
  return events;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/feed/derive.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/feed/types.ts web/src/feed/derive.ts web/test/feed/derive.test.ts
git commit -m "Derive show events from meta.json changes"
```

---

### Task 5: Live feed (polling) and replay feed

**Files:**
- Create: `web/src/feed/scanFeed.ts`, `web/src/feed/replayFeed.ts`
- Test: `web/test/feed/scanFeed.test.ts`, `web/test/feed/replayFeed.test.ts`

**Interfaces:**
- Consumes: `deriveState`, `diffStates`, `scanUrl` (Task 4); `Feed`, `FeedEvent`, `ScanState` (Task 4)
- Produces:
  - `class ScanFeed implements Feed`: `constructor(name = "latest", intervalMs = 250, fetchImpl?: typeof fetch)`, `readonly name: string`, `get current(): ScanState | null`, `poll(): Promise<void>`
  - `interface Timed { at: number; event: FeedEvent }`, `replayTimeline(name, scanId, paceMs, combineMs): Timed[]`
  - `class ReplayFeed implements Feed`: `constructor(name = "sim", paceMs = 6000, combineMs = 5000)`, `readonly name: string`

- [ ] **Step 1: Write the failing tests**

`web/test/feed/scanFeed.test.ts`:
```ts
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
```

`web/test/feed/replayFeed.test.ts`:
```ts
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/feed`
Expected: FAIL, because `scanFeed` and `replayFeed` cannot be resolved (the `derive` tests still pass).

- [ ] **Step 3: Implement `web/src/feed/scanFeed.ts`**

```ts
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
```

- [ ] **Step 4: Implement `web/src/feed/replayFeed.ts`**

```ts
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
    event: { type: "done", name, urls: { dirs, reveal: scanUrl(name, "reveal.png", `${scanId}-reveal`) } },
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
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/feed`
Expected: PASS (every test in `derive`, `scanFeed` and `replayFeed`).

- [ ] **Step 6: Commit**

```bash
git add web/src/feed/scanFeed.ts web/src/feed/replayFeed.ts web/test/feed/scanFeed.test.ts web/test/feed/replayFeed.test.ts
git commit -m "Live meta.json feed and replay feed for development and backup demos"
```

---

### Task 6: Classifying the reading, and the client that asks for it

**Files:**
- Create: `web/src/ai/classify.ts`, `web/src/ai/reader.ts`
- Test: `web/test/ai/classify.test.ts`, `web/test/ai/reader.test.ts`

**Interfaces:**
- Consumes: `ReadResult`, `Word` from `shared/types.ts`; `POST /api/read` (Task 3)
- Produces:
  - `MIN_CONFIDENCE = 0.5`, `interface Outcome { kind: "ok" | "weak" | "error"; words: Word[]; confident: number[] }`, `classify(result: ReadResult | null): Outcome`
  - `class HttpReader { constructor(fetchImpl?: typeof fetch); read(scan: string): Promise<Outcome> }` (never rejects)

- [ ] **Step 1: Write the failing tests**

`web/test/ai/classify.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { ReadResult, Word } from "../../shared/types";
import { classify } from "../../src/ai/classify";

const w = (text: string, confidence: number): Word => ({ text, box: [], confidence });
const result = (words: Word[]): ReadResult => ({
  scanId: "s",
  text: words.map((x) => x.text).join(" "),
  words,
  meanConfidence: words.length ? words.reduce((a, x) => a + x.confidence, 0) / words.length : 0,
});

describe("classify", () => {
  it("ok when words were found and are trusted on average; lists the confident ones", () => {
    const words = [w("Meet", 0.9), w("me", 0.3)];
    expect(classify(result(words))).toEqual({ kind: "ok", words, confident: [0] });
  });

  it("0.5 counts as confident", () => {
    expect(classify(result([w("on", 0.5)]))).toMatchObject({ kind: "ok", confident: [0] });
  });

  it("weak when the average is low", () => {
    expect(classify(result([w("M?", 0.4)])).kind).toBe("weak");
  });

  it("weak when nothing was found", () => {
    expect(classify(result([]))).toEqual({ kind: "weak", words: [], confident: [] });
  });

  it("error when there is no result at all", () => {
    expect(classify(null)).toEqual({ kind: "error", words: [], confident: [] });
  });
});
```

`web/test/ai/reader.test.ts`:
```ts
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/ai`
Expected: FAIL, because the modules cannot be resolved.

- [ ] **Step 3: Implement `web/src/ai/classify.ts`**

```ts
import type { ReadResult, Word } from "../../shared/types";

export const MIN_CONFIDENCE = 0.5;

export interface Outcome {
  kind: "ok" | "weak" | "error";
  words: Word[];
  confident: number[]; // indexes of words at or above MIN_CONFIDENCE
}

/** ok: words found and trusted on average -> read them aloud.
 *  weak: nothing found, or low confidence -> 1202 alarm, still show the image.
 *  error: no result at all (network, Google, timeout) -> same alarm. */
export function classify(result: ReadResult | null): Outcome {
  if (!result) return { kind: "error", words: [], confident: [] };
  const confident = result.words.flatMap((w, i) => (w.confidence >= MIN_CONFIDENCE ? [i] : []));
  const ok = result.words.length > 0 && result.meanConfidence >= MIN_CONFIDENCE;
  return { kind: ok ? "ok" : "weak", words: result.words, confident };
}
```

- [ ] **Step 4: Implement `web/src/ai/reader.ts`**

```ts
import type { ReadResult } from "../../shared/types";
import { classify, type Outcome } from "./classify";

/** Asks the server to OCR a scan's reveal.png. Never rejects: any failure becomes kind "error". */
export class HttpReader {
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)) {
    this.fetchImpl = fetchImpl;
  }

  async read(scan: string): Promise<Outcome> {
    try {
      const res = await this.fetchImpl("/api/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scan }),
      });
      if (!res.ok) {
        console.warn("OCR failed:", res.status, await res.text());
        return classify(null);
      }
      return classify((await res.json()) as ReadResult);
    } catch (e) {
      console.warn("OCR failed:", e);
      return classify(null);
    }
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/ai`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/ai/classify.ts web/src/ai/reader.ts web/test/ai/classify.test.ts web/test/ai/reader.test.ts
git commit -m "Classify OCR readings (ok / weak / error) and fetch them from the server"
```

---

### Task 7: The Director state machine

**Files:**
- Create: `web/src/show/director.ts`
- Test: `web/test/show/director.test.ts`

**Interfaces:**
- Consumes: `FeedEvent` (Task 4); `Outcome` (Task 6); `Word` (`shared/types.ts`)
- Produces (everything below is exported from `src/show/director.ts`):
  - `type ShowPhase = "idle" | "capture" | "combining" | "descent" | "reveal" | "hold"`
  - `interface Stage { idle(); newScan(); ledOn(led); photoLanded(led, url); combining(); descent(revealUrl): Promise<void>; reveal(revealUrl): Promise<void>; showWords(words: Word[], confident: number[]); highlight(index: number | null); hold(); skip() }`
  - `interface Overlay { idle(armed: boolean); capture(led, captured: number[]); landed(led, captured: number[]); combining(); reveal(); clearCue(); subtitle(words: string[], current: number | null); alarm(on: boolean); waiting(on: boolean) }`
    - In `subtitle`, `current === words.length` means every word has been said.
  - `interface Reader { read(scan: string): Promise<Outcome> }`
  - `interface Voice { speak(words: string[], onWord: (i: number) => void): Promise<void>; alarm(): Promise<void>; cancel(): void }`
  - `TIMING = { readDeadlineMs: 8000, holdAfterMs: 3000, stuckMs: 120000 }`
  - `sleep(ms): Promise<void>`
  - `class Director`: `constructor(stage, overlay, reader, voice)`, `phase: ShowPhase`, `armed: boolean`, `handle(e: FeedEvent): void`, `toIdle(): void`, `arm(): void`, `skip(): void`

- [ ] **Step 1: Write the failing tests**

`web/test/show/director.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Word } from "../../shared/types";
import type { Outcome } from "../../src/ai/classify";
import type { FeedEvent } from "../../src/feed/types";
import { Director, sleep, TIMING, type Overlay, type Reader, type Stage, type Voice } from "../../src/show/director";

const words: Word[] = [
  { text: "Meet", box: [], confidence: 0.9 },
  { text: "me", box: [], confidence: 0.8 },
];
const OK: Outcome = { kind: "ok", words, confident: [0, 1] };
const WEAK: Outcome = { kind: "weak", words: [{ text: "M?", box: [], confidence: 0.2 }], confident: [] };
const DONE: Extract<FeedEvent, { type: "done" }> = {
  type: "done",
  name: "sim",
  urls: { dirs: [], reveal: "/scan/sim/reveal.png?v=x" },
};

function setup(outcome: Outcome, readDelayMs = 100) {
  const stage = {
    idle: vi.fn(), newScan: vi.fn(), ledOn: vi.fn(), photoLanded: vi.fn(), combining: vi.fn(),
    descent: vi.fn(() => sleep(1500)), reveal: vi.fn(async () => {}),
    showWords: vi.fn(), highlight: vi.fn(), hold: vi.fn(), skip: vi.fn(),
  } satisfies Stage;
  const overlay = {
    idle: vi.fn(), capture: vi.fn(), landed: vi.fn(), combining: vi.fn(), reveal: vi.fn(),
    clearCue: vi.fn(), subtitle: vi.fn(), alarm: vi.fn(), waiting: vi.fn(),
  } satisfies Overlay;
  const reader = { read: vi.fn(() => sleep(readDelayMs).then(() => outcome)) } satisfies Reader;
  const voice = {
    speak: vi.fn(async (ws: string[], onWord: (i: number) => void) => {
      for (let i = 0; i < ws.length; i++) {
        onWord(i);
        await sleep(300);
      }
    }),
    alarm: vi.fn(() => sleep(2000)),
    cancel: vi.fn(),
  } satisfies Voice;
  const director = new Director(stage, overlay, reader, voice);
  return { director, stage, overlay, reader, voice };
}

function capture(d: Director): void {
  d.handle({ type: "scanStarted", scanId: "t1" });
  for (let k = 0; k < 4; k++) {
    d.handle({ type: "ledOn", led: k });
    d.handle({ type: "photoLanded", led: k, url: `u${k}` });
  }
  d.handle({ type: "combining" });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Director", () => {
  it("starts idle", () => {
    const { director, stage, overlay } = setup(OK);
    expect(director.phase).toBe("idle");
    expect(stage.idle).toHaveBeenCalledTimes(1);
    expect(overlay.idle).toHaveBeenCalledWith(false);
  });

  it("runs capture, descent, reveal, reading aloud, then hold", async () => {
    const { director, stage, overlay, reader, voice } = setup(OK);
    capture(director);
    expect(stage.newScan).toHaveBeenCalledTimes(1);
    expect(stage.photoLanded).toHaveBeenCalledTimes(4);
    expect(overlay.capture).toHaveBeenLastCalledWith(3, [0, 1, 2]);
    expect(overlay.landed).toHaveBeenLastCalledWith(3, [0, 1, 2, 3]);
    expect(director.phase).toBe("combining");

    director.handle(DONE);
    expect(director.phase).toBe("descent");
    expect(reader.read).toHaveBeenCalledWith("sim");
    expect(overlay.reveal).toHaveBeenCalled();
    expect(stage.descent).toHaveBeenCalledWith(DONE.urls.reveal);

    await vi.advanceTimersByTimeAsync(2500); // descent 1500 + two words at 300 ms each
    expect(stage.reveal).toHaveBeenCalledWith(DONE.urls.reveal);
    expect(stage.showWords).toHaveBeenCalledWith(words, [0, 1]);
    expect(voice.speak).toHaveBeenCalledWith(["Meet", "me"], expect.any(Function));
    expect(stage.highlight).toHaveBeenCalledWith(1);
    expect(overlay.subtitle).toHaveBeenCalledWith(["Meet", "me"], 1);
    expect(overlay.subtitle).toHaveBeenLastCalledWith(["Meet", "me"], 2);
    expect(stage.highlight).toHaveBeenLastCalledWith(2);
    expect(director.phase).toBe("reveal");

    await vi.advanceTimersByTimeAsync(TIMING.holdAfterMs);
    expect(director.phase).toBe("hold");
    expect(stage.hold).toHaveBeenCalledTimes(1);
  });

  it("sounds the 1202 alarm instead of reading when the reading is weak", async () => {
    const { director, stage, overlay, voice } = setup(WEAK);
    capture(director);
    director.handle(DONE);
    await vi.advanceTimersByTimeAsync(1600);
    expect(stage.showWords).toHaveBeenCalledWith(WEAK.words, []);
    expect(overlay.alarm).toHaveBeenLastCalledWith(true);
    expect(voice.alarm).toHaveBeenCalledTimes(1);
    expect(voice.speak).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000 + TIMING.holdAfterMs);
    expect(director.phase).toBe("hold");
  });

  it("gives up on OCR after the deadline", async () => {
    const { director, overlay, voice } = setup(OK, 20_000);
    capture(director);
    director.handle(DONE);
    await vi.advanceTimersByTimeAsync(TIMING.readDeadlineMs + 100);
    expect(overlay.alarm).toHaveBeenLastCalledWith(true);
    expect(voice.speak).not.toHaveBeenCalled();
  });

  it("a new scan interrupts the reading and the stale show never finishes", async () => {
    const { director, stage, voice } = setup(OK);
    capture(director);
    director.handle(DONE);
    await vi.advanceTimersByTimeAsync(1600); // speaking word 0
    director.handle({ type: "scanStarted", scanId: "t2" });
    expect(voice.cancel).toHaveBeenCalled();
    expect(director.phase).toBe("capture");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(stage.highlight).not.toHaveBeenCalledWith(1);
    expect(stage.hold).not.toHaveBeenCalled();
    expect(director.phase).toBe("capture");
  });

  it("warns when the capture stalls, and clears the warning on the next event", async () => {
    const { director, overlay } = setup(OK);
    director.handle({ type: "scanStarted", scanId: "t1" });
    director.handle({ type: "ledOn", led: 0 });
    await vi.advanceTimersByTimeAsync(TIMING.stuckMs);
    expect(overlay.waiting).toHaveBeenLastCalledWith(true);
    director.handle({ type: "photoLanded", led: 0, url: "u0" });
    expect(overlay.waiting).toHaveBeenLastCalledWith(false);
  });

  it("Esc goes back to idle and stops the voice", () => {
    const { director, stage, overlay, voice } = setup(OK);
    capture(director);
    director.arm();
    director.toIdle();
    expect(director.phase).toBe("idle");
    expect(stage.idle).toHaveBeenCalledTimes(2);
    expect(overlay.idle).toHaveBeenLastCalledWith(true);
    expect(voice.cancel).toHaveBeenCalled();
  });

  it("skip is passed to the stage", () => {
    const { director, stage } = setup(OK);
    director.skip();
    expect(stage.skip).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/show/director.test.ts`
Expected: FAIL, because `../../src/show/director` cannot be resolved.

- [ ] **Step 3: Implement `web/src/show/director.ts`**

```ts
import type { Word } from "../../shared/types";
import type { Outcome } from "../ai/classify";
import type { FeedEvent } from "../feed/types";

export type ShowPhase = "idle" | "capture" | "combining" | "descent" | "reveal" | "hold";

/** The picture. L0: DomStage (CSS). L1 swaps in the three.js scene behind this same interface. */
export interface Stage {
  idle(): void;
  newScan(): void;
  ledOn(led: number): void;
  photoLanded(led: number, url: string): void;
  combining(): void;
  /** Resolves when the move into the page is over. */
  descent(revealUrl: string): Promise<void>;
  /** Resolves once the clean reveal image is on screen. */
  reveal(revealUrl: string): Promise<void>;
  showWords(words: Word[], confident: number[]): void;
  /** index = the word being spoken; words before it count as said. null clears. */
  highlight(index: number | null): void;
  hold(): void;
  /** Jump the running animation to its end state. */
  skip(): void;
}

/** The text on top of the picture (HTML). */
export interface Overlay {
  idle(armed: boolean): void;
  capture(led: number, captured: number[]): void;
  landed(led: number, captured: number[]): void;
  combining(): void;
  reveal(): void;
  clearCue(): void;
  /** current: the word being spoken; words.length = all said; null = none yet. */
  subtitle(words: string[], current: number | null): void;
  alarm(on: boolean): void;
  waiting(on: boolean): void;
}

export interface Reader {
  /** Never rejects. */
  read(scan: string): Promise<Outcome>;
}

export interface Voice {
  /** Resolves when finished or cancelled; onWord(i) fires as word i starts. */
  speak(words: string[], onWord: (i: number) => void): Promise<void>;
  /** The 1202 line. */
  alarm(): Promise<void>;
  cancel(): void;
}

export const TIMING = {
  readDeadlineMs: 8000, // after "done": no OCR by then -> 1202 alarm
  holdAfterMs: 3000, // after reading, before "hold the sun"
  stuckMs: 120_000, // no event this long while capturing -> "waiting for photo…"
};

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const NO_RESULT: Outcome = { kind: "error", words: [], confident: [] };

/** Runs the show. Feed events move it through the capture; after "done" it times itself.
 *  Every restart bumps `gen`; an async step that wakes up under an old gen stops quietly. */
export class Director {
  phase: ShowPhase = "idle";
  armed = false;
  private gen = 0;
  private captured: number[] = [];
  private stuckTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly stage: Stage;
  private readonly overlay: Overlay;
  private readonly reader: Reader;
  private readonly voice: Voice;

  constructor(stage: Stage, overlay: Overlay, reader: Reader, voice: Voice) {
    this.stage = stage;
    this.overlay = overlay;
    this.reader = reader;
    this.voice = voice;
    stage.idle();
    overlay.idle(false);
  }

  handle(e: FeedEvent): void {
    switch (e.type) {
      case "scanStarted":
        this.restart("capture");
        this.stage.newScan();
        break;
      case "ledOn":
        this.phase = "capture";
        this.stage.ledOn(e.led);
        this.overlay.capture(e.led, [...this.captured]);
        this.watchStuck();
        break;
      case "photoLanded":
        if (!this.captured.includes(e.led)) this.captured.push(e.led);
        this.stage.photoLanded(e.led, e.url);
        this.overlay.landed(e.led, [...this.captured]);
        this.watchStuck();
        break;
      case "combining":
        this.phase = "combining";
        this.clearStuck();
        this.stage.combining();
        this.overlay.combining();
        break;
      case "done":
        void this.finish(e.name, e.urls.reveal);
        break;
    }
  }

  /** Esc: back to the full moon. */
  toIdle(): void {
    this.restart("idle");
    this.stage.idle();
    this.overlay.idle(this.armed);
  }

  /** First key press: audio may play from now on. */
  arm(): void {
    this.armed = true;
    if (this.phase === "idle") this.overlay.idle(true);
  }

  skip(): void {
    this.stage.skip();
  }

  private restart(phase: ShowPhase): void {
    this.gen++;
    this.phase = phase;
    this.captured = [];
    this.clearStuck();
    this.voice.cancel();
    this.overlay.alarm(false);
    this.overlay.subtitle([], null);
    this.overlay.clearCue();
  }

  private async finish(scan: string, revealUrl: string): Promise<void> {
    const gen = this.gen;
    const live = () => gen === this.gen;
    this.clearStuck();
    this.overlay.reveal();
    this.phase = "descent";
    // Ask for the reading now, so it arrives while the descent plays.
    const reading = Promise.race([this.reader.read(scan), sleep(TIMING.readDeadlineMs).then(() => NO_RESULT)]);
    await this.stage.descent(revealUrl);
    if (!live()) return;
    this.phase = "reveal";
    await this.stage.reveal(revealUrl);
    if (!live()) return;
    const outcome = await reading;
    if (!live()) return;

    this.stage.showWords(outcome.words, outcome.confident);
    if (outcome.kind === "ok") {
      const texts = outcome.words.map((w) => w.text);
      this.overlay.subtitle(texts, null);
      await this.voice.speak(texts, (i) => {
        if (!live()) return;
        this.stage.highlight(i);
        this.overlay.subtitle(texts, i);
      });
      if (!live()) return;
      this.stage.highlight(texts.length);
      this.overlay.subtitle(texts, texts.length);
    } else {
      this.overlay.alarm(true);
      await this.voice.alarm();
      if (!live()) return;
    }
    await sleep(TIMING.holdAfterMs);
    if (!live()) return;
    this.phase = "hold";
    this.stage.hold();
  }

  private watchStuck(): void {
    this.clearStuck();
    this.stuckTimer = setTimeout(() => this.overlay.waiting(true), TIMING.stuckMs);
  }

  private clearStuck(): void {
    clearTimeout(this.stuckTimer);
    this.stuckTimer = undefined;
    this.overlay.waiting(false);
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/show/director.test.ts`
Expected: PASS (8 tests).

Run: `npm test && npm run typecheck`
Expected: all tests pass; typecheck exits with code 0.

- [ ] **Step 5: Commit**

```bash
git add web/src/show/director.ts web/test/show/director.test.ts
git commit -m "Director state machine: capture, descent, reveal, reading, 1202 alarm, hold"
```

---

### Task 8: L0 picture and text (DOM stage, overlay, styles) in replay mode

**Files:**
- Create: `web/src/scene/domStage.ts`, `web/src/ui/overlay.ts`, `web/src/audio/voice.ts` (only `SilentVoice` in this task), `web/src/style.css`
- Modify: `web/src/main.ts` (full replacement)

**Interfaces:**
- Consumes: `Stage`, `Overlay`, `Voice`, `Director`, `sleep` (Task 7); `ReplayFeed` (Task 5); `HttpReader` (Task 6); `Word` (`shared/types.ts`)
- Produces:
  - `class DomStage implements Stage`: `constructor(root: HTMLElement)`; `CLOSEUP_MS = 2000`; `DESCENT_MS = 1500`
  - `class DomOverlay implements Overlay`: `constructor(root: HTMLElement)`
  - `class SilentVoice implements Voice`: steps through words every `WORD_MS = 380` without sound
  - CSS hooks:
    - `#stage[data-mode]` and `#overlay[data-mode]`, each one of `idle`, `capture`, `combining`, `descent`, `reveal`, `hold`
    - `.moon[data-sun]`: `full`, `n`, `e`, `s`, `w` or `spin`
    - `.plate[data-state]`: `hidden`, `closeup`, `parked` or `gone`

This task is visual. It has no unit tests; it is checked by running a replay in a browser (Step 6). The logic it calls is already tested.

- [ ] **Step 1: Implement `web/src/audio/voice.ts` (SilentVoice only)**

```ts
import { sleep, type Voice } from "../show/director";

export const WORD_MS = 380;

/** No sound: steps through the words at a speaking pace, so the highlight still moves. */
export class SilentVoice implements Voice {
  private cancelled = false;

  async speak(words: string[], onWord: (i: number) => void): Promise<void> {
    this.cancelled = false;
    for (let i = 0; i < words.length && !this.cancelled; i++) {
      onWord(i);
      await sleep(WORD_MS);
    }
  }

  async alarm(): Promise<void> {
    await sleep(2000);
  }

  cancel(): void {
    this.cancelled = true;
  }
}
```

- [ ] **Step 2: Implement `web/src/scene/domStage.ts`**

```ts
import type { Word } from "../../shared/types";
import type { Stage } from "../show/director";

const SUN = ["n", "e", "s", "w"]; // LED index -> side the light comes from
export const CLOSEUP_MS = 2000;
export const DESCENT_MS = 1500;

function div(cls: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  return d;
}

/** The L0 picture in plain DOM + CSS (style.css). L1 replaces it with three.js behind the same Stage interface. */
export class DomStage implements Stage {
  private readonly root: HTMLElement;
  private readonly moon = div("moon");
  private readonly plates: HTMLImageElement[];
  private readonly page = div("page");
  private readonly revealImg = document.createElement("img");
  private readonly boxes = div("boxes");
  private timers: ReturnType<typeof setTimeout>[] = [];
  private endDescent: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.plates = [0, 1, 2, 3].map((k) => {
      const img = document.createElement("img");
      img.className = "plate";
      img.alt = "";
      img.dataset.led = String(k);
      return img;
    });
    this.revealImg.className = "reveal";
    this.revealImg.alt = "";
    this.page.append(this.revealImg, this.boxes);
    root.append(div("sky"), this.moon, ...this.plates, this.page);
    this.reset("idle");
  }

  idle(): void {
    this.reset("idle");
  }

  newScan(): void {
    this.reset("capture");
  }

  ledOn(led: number): void {
    this.root.dataset.mode = "capture";
    this.moon.dataset.sun = SUN[led];
  }

  /** The photo shows big (dimmed) for CLOSEUP_MS, then parks on its side of the moon. */
  photoLanded(led: number, url: string): void {
    for (const p of this.plates) if (p.dataset.state === "closeup") p.dataset.state = "parked";
    const plate = this.plates[led];
    plate.src = url;
    plate.dataset.state = "closeup";
    this.later(CLOSEUP_MS, () => {
      if (plate.dataset.state === "closeup") plate.dataset.state = "parked";
    });
  }

  combining(): void {
    this.root.dataset.mode = "combining";
    this.moon.dataset.sun = "spin";
    // Let the last photo finish its close-up before everything sinks into the moon.
    this.later(CLOSEUP_MS, () => {
      for (const p of this.plates) p.dataset.state = "gone";
    });
  }

  descent(revealUrl: string): Promise<void> {
    this.revealImg.src = revealUrl; // start loading while the moon rushes in
    this.root.dataset.mode = "descent";
    return new Promise((resolve) => {
      const end = () => {
        clearTimeout(timer);
        this.endDescent = null;
        resolve();
      };
      const timer = setTimeout(end, DESCENT_MS);
      this.endDescent = end;
    });
  }

  async reveal(revealUrl: string): Promise<void> {
    if (this.revealImg.getAttribute("src") !== revealUrl) this.revealImg.src = revealUrl;
    await this.revealImg.decode().catch(() => {}); // a broken image must not stop the show
    this.root.dataset.mode = "reveal";
  }

  /** One box per word, positioned in % of the reveal image, so it follows the image's size. */
  showWords(words: Word[], confident: number[]): void {
    const w = this.revealImg.naturalWidth || 1;
    const h = this.revealImg.naturalHeight || 1;
    this.boxes.replaceChildren(
      ...words.map((word, i) => {
        const b = div(confident.includes(i) ? "box confident" : "box");
        if (word.box.length === 0) {
          b.hidden = true;
          return b;
        }
        const xs = word.box.map((p) => p[0]);
        const ys = word.box.map((p) => p[1]);
        const x0 = Math.min(...xs);
        const y0 = Math.min(...ys);
        b.style.left = `${(x0 / w) * 100}%`;
        b.style.top = `${(y0 / h) * 100}%`;
        b.style.width = `${((Math.max(...xs) - x0) / w) * 100}%`;
        b.style.height = `${((Math.max(...ys) - y0) / h) * 100}%`;
        return b;
      }),
    );
  }

  highlight(index: number | null): void {
    Array.from(this.boxes.children).forEach((b, i) => {
      b.classList.toggle("said", index !== null && i < index);
      b.classList.toggle("now", i === index);
    });
  }

  hold(): void {
    this.root.dataset.mode = "hold";
  }

  skip(): void {
    this.endDescent?.();
    for (const p of this.plates) if (p.dataset.state === "closeup") p.dataset.state = "parked";
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms));
  }

  private reset(mode: string): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.endDescent?.();
    this.root.dataset.mode = mode;
    this.moon.dataset.sun = "full";
    for (const p of this.plates) {
      p.dataset.state = "hidden";
      p.removeAttribute("src");
    }
    this.revealImg.removeAttribute("src");
    this.boxes.replaceChildren();
  }
}
```

- [ ] **Step 3: Implement `web/src/ui/overlay.ts`**

```ts
import type { Overlay } from "../show/director";

const DIRECTIONS = ["North", "East", "South", "West"];
const GOT_SHOT_MS = 1500; // how long "Got shot k" stays before the next instruction

function add(parent: HTMLElement, cls: string, text = ""): HTMLElement {
  const e = document.createElement("div");
  e.className = cls;
  e.textContent = text;
  parent.append(e);
  return e;
}

/** Every piece of on-screen text. Which parts show is decided by #overlay[data-mode] in style.css. */
export class DomOverlay implements Overlay {
  private readonly root: HTMLElement;
  private readonly armHint: HTMLElement;
  private readonly kicker: HTMLElement;
  private readonly line: HTMLElement;
  private readonly dots: HTMLElement[];
  private readonly sub: HTMLElement;
  private readonly alarmBox: HTMLElement;
  private readonly waitNote: HTMLElement;
  private cueTimer: ReturnType<typeof setTimeout> | undefined;
  private gotUntil = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    add(root, "wordmark", "TERMINATOR");
    const idle = add(root, "idle");
    add(idle, "prompt", "Write a secret. Tear off the page.");
    add(idle, "note", "FULL MOON · NO SHADOWS · THE PAGE LOOKS BLANK");
    this.armHint = add(idle, "arm", "press any key to arm audio");
    const cue = add(root, "cue");
    this.kicker = add(cue, "kicker");
    this.line = add(cue, "line");
    const progress = add(root, "progress");
    this.dots = ["N", "E", "S", "W"].map((d) => {
      const dot = add(progress, "dot");
      dot.dataset.dir = d;
      return dot;
    });
    this.sub = add(root, "subtitle");
    this.alarmBox = add(root, "alarm", "1202 PROGRAM ALARM");
    this.waitNote = add(root, "waiting", "waiting for photo…");
  }

  idle(armed: boolean): void {
    this.root.dataset.mode = "idle";
    this.armHint.hidden = armed;
    this.clearCue();
    this.mark([], null);
  }

  capture(led: number, captured: number[]): void {
    this.root.dataset.mode = "capture";
    this.mark(captured, led);
    this.cue(this.afterGot(), `SHOT ${led + 1} / 4`, `${DIRECTIONS[led]} light on — tap the shutter`);
  }

  landed(led: number, captured: number[]): void {
    this.mark(captured, null);
    this.cue(0, `SHOT ${led + 1} / 4`, `Got shot ${led + 1}`);
    this.gotUntil = performance.now() + GOT_SHOT_MS;
  }

  combining(): void {
    this.root.dataset.mode = "combining";
    this.mark([0, 1, 2, 3], null);
    this.cue(this.afterGot(), "COMBINING", "aligning four shots");
  }

  reveal(): void {
    this.root.dataset.mode = "reveal";
    this.clearCue();
  }

  clearCue(): void {
    clearTimeout(this.cueTimer);
    this.kicker.textContent = "";
    this.line.textContent = "";
  }

  subtitle(words: string[], current: number | null): void {
    this.sub.replaceChildren(
      ...words.map((w, i) => {
        const s = document.createElement("span");
        s.textContent = w.toUpperCase();
        if (current !== null) s.className = i < current ? "said" : i === current ? "now" : "";
        return s;
      }),
    );
  }

  alarm(on: boolean): void {
    this.alarmBox.classList.toggle("on", on);
  }

  waiting(on: boolean): void {
    this.waitNote.classList.toggle("on", on);
  }

  /** ms left on a "Got shot k" message, so the next instruction doesn't replace it at once. */
  private afterGot(): number {
    return Math.max(0, this.gotUntil - performance.now());
  }

  private cue(delayMs: number, kicker: string, line: string): void {
    clearTimeout(this.cueTimer);
    const show = () => {
      this.kicker.textContent = kicker;
      this.line.textContent = line;
    };
    if (delayMs > 0) this.cueTimer = setTimeout(show, delayMs);
    else show();
  }

  private mark(captured: number[], active: number | null): void {
    this.dots.forEach((d, k) => {
      d.classList.toggle("got", captured.includes(k));
      d.classList.toggle("active", k === active);
    });
  }
}
```

- [ ] **Step 4: Create `web/src/style.css`**

```css
/* L0 look: night sky, a CSS moon whose terminator turns toward the lit LED, photo plates, the reveal page.
   L1 replaces the stage with three.js; the overlay rules stay. */
:root {
  --night: #04060d;
  --moon-dark: rgba(18, 20, 29, 0.96);
  --gold: #ffd682;
  --led: #9dffb5;
  --dim: #8f93a8;
  --faint: #6b6f82;
  --text: #e8e3d3;
  /* Photos on screen while capturing stay this dark: the screen must not light the paper (spec §2). */
  --capture-dim: 0.55;
  --font: Jost, Futura, "Century Gothic", "Trebuchet MS", sans-serif;
  --mono: "JetBrains Mono", Consolas, "Courier New", monospace;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; overflow: hidden; background: var(--night); color: var(--text); font-family: var(--font); }
#stage, #overlay { position: fixed; inset: 0; }
#overlay { pointer-events: none; }

/* ---------- stage ---------- */
#stage { background: var(--night); }
#stage[data-mode="reveal"], #stage[data-mode="hold"] {
  background: radial-gradient(ellipse at 50% 45%, #3a3040 0%, #0c0f1d 70%);
}

.sky {
  position: absolute; inset: 0; opacity: 0.8;
  background-image:
    radial-gradient(1px 1px at 20px 30px, #ffffffcc, transparent),
    radial-gradient(1px 1px at 140px 80px, #ffffff88, transparent),
    radial-gradient(1.5px 1.5px at 260px 170px, #ffffffaa, transparent),
    radial-gradient(1px 1px at 90px 220px, #ffffff66, transparent),
    radial-gradient(1px 1px at 330px 260px, #ffffff99, transparent),
    radial-gradient(1px 1px at 200px 120px, #ffffff55, transparent);
  background-size: 360px 300px;
}

.moon {
  --r: min(22vh, 22vw);
  position: absolute; left: 50%; top: 50%;
  width: calc(var(--r) * 2); height: calc(var(--r) * 2);
  translate: -50% -50%;
  border-radius: 50%;
  background:
    radial-gradient(circle at 38% 34%, #a19c8e88 0 13%, transparent 14%),
    radial-gradient(circle at 58% 48%, #a19c8e77 0 10%, transparent 11%),
    radial-gradient(circle at 44% 64%, #a19c8e66 0 8%, transparent 9%),
    radial-gradient(circle at 45% 40%, #f1ecdf, #cfc9b8 70%, #9f9a8b);
  filter: drop-shadow(0 0 40px #ffd68222);
  transition: scale 1.5s ease-in, opacity 1.5s ease-in;
}
/* The terminator: a dark half, turned so the lit side faces the active LED. */
.moon::after {
  content: ""; position: absolute; inset: 0; border-radius: 50%;
  background: linear-gradient(to bottom, transparent 46%, var(--moon-dark) 54%);
  opacity: 0;
  transition: opacity 1.5s ease, rotate 1.5s ease;
}
.moon[data-sun="n"]::after { opacity: 1; rotate: 0deg; }
.moon[data-sun="e"]::after { opacity: 1; rotate: 90deg; }
.moon[data-sun="s"]::after { opacity: 1; rotate: 180deg; }
.moon[data-sun="w"]::after { opacity: 1; rotate: 270deg; }
.moon[data-sun="spin"]::after { opacity: 1; animation: spin 8s linear infinite; }
@keyframes spin { from { rotate: 0deg; } to { rotate: 360deg; } }
#stage[data-mode="descent"] .moon,
#stage[data-mode="reveal"] .moon,
#stage[data-mode="hold"] .moon { scale: 6; opacity: 0; }

.plate {
  position: absolute; left: 50%; top: 50%;
  width: 18vw; height: auto;
  translate: -50% -50%;
  opacity: 0;
  border: 1px solid #3a3f55;
  filter: brightness(var(--capture-dim));
  transition: left 0.8s ease, top 0.8s ease, width 0.8s ease, opacity 0.8s ease, scale 0.8s ease;
}
.plate[data-state="closeup"] { width: 60vw; max-height: 70vh; object-fit: contain; opacity: 1; z-index: 2; }
.plate[data-state="parked"] { opacity: 0.85; }
.plate[data-state="parked"][data-led="0"] { top: 13%; }
.plate[data-state="parked"][data-led="1"] { left: 83%; }
.plate[data-state="parked"][data-led="2"] { top: 87%; }
.plate[data-state="parked"][data-led="3"] { left: 17%; }
.plate[data-state="gone"] { opacity: 0; scale: 0.1; transition-duration: 2s; }

.page {
  position: absolute; left: 50%; top: 46%;
  translate: -50% -50%;
  opacity: 0;
  transition: opacity 1.5s ease;
  line-height: 0;
}
#stage[data-mode="reveal"] .page, #stage[data-mode="hold"] .page { opacity: 1; }
.reveal { display: block; max-width: 80vw; max-height: 68vh; background: #f7f3ea; box-shadow: 0 0 90px #ffd68240; }
.boxes { position: absolute; inset: 0; }
.box {
  position: absolute; border-radius: 4px;
  outline: 2px solid transparent; outline-offset: 2px;
  transition: background-color 0.2s, outline-color 0.2s, box-shadow 0.2s;
}
.box.confident { outline-color: #c9a44c40; }
.box.said { outline-color: #c9a44c99; }
.box.now { background: #ffd6824d; outline-color: #e0a82e; box-shadow: 0 0 18px #ffd682aa; }

/* ---------- overlay ---------- */
.wordmark { position: absolute; left: 3vw; top: 3.5vh; font-size: max(11px, 0.9vw); letter-spacing: 0.4em; color: var(--dim); }

.idle { position: absolute; left: 0; right: 0; bottom: 11vh; text-align: center; opacity: 0; transition: opacity 0.8s; }
#overlay[data-mode="idle"] .idle { opacity: 1; }
.prompt { font-size: max(22px, 3vw); }
.note { margin-top: 1.4vh; font-size: max(10px, 0.8vw); letter-spacing: 0.25em; color: var(--faint); }
.arm { margin-top: 2.2vh; font-size: max(11px, 0.85vw); color: var(--gold); opacity: 0.8; }

.cue { position: absolute; left: 3vw; bottom: 5vh; }
.cue .kicker { font-size: max(11px, 0.95vw); letter-spacing: 0.3em; color: var(--gold); }
.cue .line { margin-top: 0.8vh; font-size: max(16px, 1.6vw); color: #c9cbd6; }

.progress { position: absolute; right: 3vw; bottom: 6vh; display: flex; gap: 1.4vw; opacity: 0; transition: opacity 0.5s; }
#overlay[data-mode="capture"] .progress, #overlay[data-mode="combining"] .progress { opacity: 1; }
.dot { position: relative; width: max(10px, 0.8vw); height: max(10px, 0.8vw); border-radius: 50%; border: 1px solid #4a4f66; }
.dot::after {
  content: attr(data-dir); position: absolute; top: 160%; left: 50%; translate: -50% 0;
  font-size: max(9px, 0.65vw); color: var(--faint);
}
.dot.got { background: var(--text); border-color: var(--text); }
.dot.active { background: var(--led); border-color: var(--led); box-shadow: 0 0 12px var(--led); animation: breathe 1.6s ease-in-out infinite; }
@keyframes breathe { 50% { opacity: 0.45; } }

.subtitle {
  position: absolute; left: 4vw; right: 4vw; bottom: 6vh;
  display: flex; flex-wrap: wrap; justify-content: center; gap: 0.3em 0.9em;
  font-size: max(18px, 2.1vw); letter-spacing: 0.15em; color: #7f8396;
}
.subtitle .said { color: #f2efe6; }
.subtitle .now { color: var(--gold); font-weight: 600; }

.alarm {
  position: absolute; top: 5vh; left: 50%; translate: -50% 0;
  font-family: var(--mono); font-size: max(16px, 1.5vw); letter-spacing: 0.2em; color: #ffb347;
  opacity: 0;
}
.alarm.on { animation: alarm 1.2s steps(1, end) forwards; }
@keyframes alarm { 0% { opacity: 1; } 25% { opacity: 0; } 50% { opacity: 1; } 75% { opacity: 0; } 100% { opacity: 1; } }

.waiting { position: absolute; left: 3vw; bottom: 2vh; font-size: max(11px, 0.85vw); color: var(--dim); opacity: 0; transition: opacity 0.5s; }
.waiting.on { opacity: 1; }
```

- [ ] **Step 5: Replace `web/src/main.ts`**

```ts
import "./style.css";
import { HttpReader } from "./ai/reader";
import { SilentVoice } from "./audio/voice";
import { ReplayFeed } from "./feed/replayFeed";
import { DomStage } from "./scene/domStage";
import { Director } from "./show/director";
import { DomOverlay } from "./ui/overlay";

// Replay only for now: ?replay=sim&pace=2500 plays a finished scan folder as if live.
// Task 9 adds the live feed, speech and keyboard controls.
const params = new URLSearchParams(location.search);
const director = new Director(
  new DomStage(document.querySelector<HTMLElement>("#stage")!),
  new DomOverlay(document.querySelector<HTMLElement>("#overlay")!),
  new HttpReader(),
  new SilentVoice(),
);
new ReplayFeed(params.get("replay") ?? "sim", Number(params.get("pace")) || 6000).start((e) => director.handle(e));
```

- [ ] **Step 6: Watch a replay in the browser**

Run: `npm run dev`, then open `http://localhost:5173/?replay=sim&pace=2500`.
Expected, in order (about 20 s in total):
1. Right away: a dark sky with the moon lit from the top. Bottom left shows `SHOT 1 / 4` / `North light on — tap the shutter`, and the N dot pulses green.
2. At 2.5 s: the north photo appears big in the middle, dimmed; `Got shot 1` shows for about 1.5 s; the moon's lit side turns to the right; the cue changes to `East light on — tap the shutter`. After 2 s the photo shrinks and parks above the moon.
3. The same for E (it parks right), S (bottom) and W (left).
4. At 10 s: `COMBINING` / `aligning four shots`. The terminator spins, and the plates shrink into the moon.
5. At 15 s: the moon scales up and fades (the descent). Then the sky warms and `reveal.png` ("Meet me on the moon at 9") fades in, centered.
6. With no `.env.local`, OCR returns 503: `1202 PROGRAM ALARM` blinks twice at the top, then stays. The browser console shows `OCR failed: 503 ...`, and there are no other errors.

Resize the window to about 1280×800 and to a narrow width. Everything should stay on screen, and there should be no scrollbars.

Stop the dev server.

- [ ] **Step 7: Typecheck, test, commit**

Run: `npm run typecheck && npm test`
Expected: exit code 0; all tests pass.

```bash
git add web/src/scene/domStage.ts web/src/ui/overlay.ts web/src/audio/voice.ts web/src/style.css web/src/main.ts
git commit -m "L0 picture and text: CSS moon, photo plates, reveal page, cues and subtitles"
```

---

### Task 9: Speech, keyboard controls and the live feed

**Files:**
- Create: `web/src/show/keys.ts`
- Modify: `web/src/audio/voice.ts` (add `BrowserVoice` and `ALARM_LINE`; full file below), `web/src/main.ts` (full replacement)
- Test: `web/test/show/keys.test.ts`

**Interfaces:**
- Consumes: `Voice`, `sleep`, `Director` (Task 7); `ScanFeed`, `ReplayFeed` (Task 5); `SilentVoice` (Task 8)
- Produces:
  - `interface KeyActions { arm(); skip(); replay(); idle(); mute(); fullscreen() }`, `bindKeys(target: EventTarget, a: KeyActions): void`
  - `class BrowserVoice implements Voice { muted: boolean }`, `ALARM_LINE: string`

- [ ] **Step 1: Write the failing test**

`web/test/show/keys.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { bindKeys, type KeyActions } from "../../src/show/keys";

function actions() {
  return { arm: vi.fn(), skip: vi.fn(), replay: vi.fn(), idle: vi.fn(), mute: vi.fn(), fullscreen: vi.fn() } satisfies KeyActions;
}

function press(target: EventTarget, key: string): Event {
  const e = Object.assign(new Event("keydown", { cancelable: true }), { key });
  target.dispatchEvent(e);
  return e;
}

describe("bindKeys", () => {
  it("the first key only arms audio; later keys drive the show", () => {
    const t = new EventTarget();
    const a = actions();
    bindKeys(t, a);

    press(t, " ");
    expect(a.arm).toHaveBeenCalledTimes(1);
    expect(a.skip).not.toHaveBeenCalled();

    const e = press(t, " ");
    expect(a.skip).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true); // Space must not scroll the page

    press(t, "r");
    press(t, "Escape");
    press(t, "M");
    press(t, "f");
    press(t, "x"); // unbound: ignored
    expect(a.replay).toHaveBeenCalledTimes(1);
    expect(a.idle).toHaveBeenCalledTimes(1);
    expect(a.mute).toHaveBeenCalledTimes(1);
    expect(a.fullscreen).toHaveBeenCalledTimes(1);
    expect(a.arm).toHaveBeenCalledTimes(1);
  });

  it("a click also arms", () => {
    const t = new EventTarget();
    const a = actions();
    bindKeys(t, a);
    t.dispatchEvent(new Event("pointerdown"));
    expect(a.arm).toHaveBeenCalledTimes(1);
    press(t, " ");
    expect(a.skip).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/show/keys.test.ts`
Expected: FAIL, because `../../src/show/keys` cannot be resolved.

- [ ] **Step 3: Implement `web/src/show/keys.ts`**

```ts
export interface KeyActions {
  arm(): void;
  skip(): void;
  replay(): void;
  idle(): void;
  mute(): void;
  fullscreen(): void;
}

/** Browsers block sound until the user does something, so the first key (or click) only arms audio.
 *  After that: Space skip, R replay, Esc idle, M mute, F fullscreen. */
export function bindKeys(target: EventTarget, a: KeyActions): void {
  let armed = false;
  const arm = (): boolean => {
    if (armed) return false;
    armed = true;
    a.arm();
    return true;
  };
  target.addEventListener("pointerdown", () => {
    arm();
  });
  target.addEventListener("keydown", (ev) => {
    const e = ev as KeyboardEvent;
    if (arm()) return;
    switch (e.key) {
      case " ":
        e.preventDefault();
        a.skip();
        break;
      case "r":
      case "R":
        a.replay();
        break;
      case "Escape":
        a.idle();
        break;
      case "m":
      case "M":
        a.mute();
        break;
      case "f":
      case "F":
        a.fullscreen();
        break;
    }
  });
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run test/show/keys.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add `BrowserVoice` (full new `web/src/audio/voice.ts`)**

```ts
import { sleep, type Voice } from "../show/director";

export const WORD_MS = 380;
export const ALARM_LINE = "Twelve oh two alarm. We're go. Read it with your own eyes.";

/** No sound: steps through the words at a speaking pace, so the highlight still moves. */
export class SilentVoice implements Voice {
  private cancelled = false;

  async speak(words: string[], onWord: (i: number) => void): Promise<void> {
    this.cancelled = false;
    for (let i = 0; i < words.length && !this.cancelled; i++) {
      onWord(i);
      await sleep(WORD_MS);
    }
  }

  async alarm(): Promise<void> {
    await sleep(2000);
  }

  cancel(): void {
    this.cancelled = true;
  }
}

/** L0 voice: the browser's own speech synthesis (the radio effect comes with Cloud TTS in L1).
 *  Word timing comes from boundary events when the voice sends them, otherwise it is estimated. */
export class BrowserVoice implements Voice {
  muted = false;
  private finish: (() => void) | null = null;

  speak(words: string[], onWord: (i: number) => void): Promise<void> {
    return this.say(words, onWord);
  }

  alarm(): Promise<void> {
    return this.say(ALARM_LINE.split(" "), () => {});
  }

  cancel(): void {
    speechSynthesis.cancel();
    this.finish?.();
  }

  private say(words: string[], onWord: (i: number) => void): Promise<void> {
    this.cancel();
    const starts: number[] = [];
    let pos = 0;
    for (const w of words) {
      starts.push(pos);
      pos += w.length + 1;
    }
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(words.join(" "));
      u.lang = "en-US";
      u.rate = 0.95;
      u.volume = this.muted ? 0 : 1;
      let last = -1;
      let estimate: ReturnType<typeof setInterval> | undefined;
      const reach = (i: number) => {
        if (i > last && i < words.length) {
          last = i;
          onWord(i);
        }
      };
      const done = () => {
        clearInterval(estimate);
        if (this.finish === done) this.finish = null;
        resolve();
      };
      u.onstart = () => {
        reach(0);
        // Some voices send no word boundaries: step at a speaking pace until one arrives.
        estimate = setInterval(() => reach(last + 1), WORD_MS);
      };
      u.onboundary = (e) => {
        if (e.name !== "word") return;
        clearInterval(estimate);
        let i = 0;
        while (i + 1 < starts.length && starts[i + 1] <= e.charIndex) i++;
        reach(i);
      };
      u.onend = done;
      u.onerror = done;
      this.finish = done;
      speechSynthesis.speak(u);
      // Without a user gesture Chrome drops speech silently; never hang the show on it.
      setTimeout(() => {
        if (last < 0 && !speechSynthesis.speaking) done();
      }, 1500);
    });
  }
}
```

- [ ] **Step 6: Replace `web/src/main.ts` (final L0 wiring)**

```ts
import "./style.css";
import { HttpReader } from "./ai/reader";
import { BrowserVoice } from "./audio/voice";
import { ReplayFeed } from "./feed/replayFeed";
import { ScanFeed } from "./feed/scanFeed";
import type { FeedEvent } from "./feed/types";
import { DomStage } from "./scene/domStage";
import { Director } from "./show/director";
import { bindKeys } from "./show/keys";
import { DomOverlay } from "./ui/overlay";

// URL options:
//   ?replay=sim&pace=6000   play a finished scan folder as if live (development, or the backup demo)
//   ?scan=latest            which folder the live feed watches (default: latest)
const params = new URLSearchParams(location.search);
const replayName = params.get("replay");
const pace = Number(params.get("pace")) || 6000;

const voice = new BrowserVoice();
const director = new Director(
  new DomStage(document.querySelector<HTMLElement>("#stage")!),
  new DomOverlay(document.querySelector<HTMLElement>("#overlay")!),
  new HttpReader(),
  voice,
);
const play = (e: FeedEvent) => director.handle(e);

let replay: ReplayFeed | null = null;
function startReplay(name: string): void {
  replay?.stop();
  replay = new ReplayFeed(name, pace);
  replay.start(play);
}

const live = replayName ? null : new ScanFeed(params.get("scan") ?? "latest");
live?.start((e) => {
  if (e.type === "scanStarted") replay?.stop(); // a real scan always wins over a replay
  play(e);
});
if (replayName) startReplay(replayName);

bindKeys(window, {
  arm: () => director.arm(),
  skip: () => director.skip(),
  replay: () => startReplay(replayName ?? live!.name),
  idle: () => {
    replay?.stop();
    director.toIdle();
  },
  mute: () => {
    voice.muted = !voice.muted;
  },
  fullscreen: () => {
    void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  },
});
```

- [ ] **Step 7: Check live mode and the keys in the browser**

Run: `npm run dev`, then open `http://localhost:5173/` (live mode, watching `out/latest`).
Expected:
- The idle screen: a full moon, `Write a secret. Tear off the page.`, and `press any key to arm audio` in gold.
- On Windows there is no `out/latest`: the network tab shows `/scan/latest/meta.json` returning 404 every 250 ms, and the page stays idle. There are no other errors.
- Press any key: the gold hint disappears.

Now open `http://localhost:5173/?replay=sim&pace=2500`. Press a key once to arm, then:
- `Space` during a photo close-up parks it at once. `Space` during the descent jumps to the reveal.
- `Esc` goes back to the idle moon. `R` replays `sim` from the start.
- `F` toggles fullscreen.
- With no API key, the reveal ends in `1202 PROGRAM ALARM`, and the browser voice says "Twelve oh two alarm. We're go. Read it with your own eyes." (after arming). With `M` pressed before the reveal, it is silent.

Stop the dev server.

- [ ] **Step 8: Typecheck, test, commit**

Run: `npm run typecheck && npm test`
Expected: exit code 0; all tests pass.

```bash
git add web/src/show/keys.ts web/test/show/keys.test.ts web/src/audio/voice.ts web/src/main.ts
git commit -m "Browser speech with word timing, keyboard controls, live meta.json feed"
```

---

### Task 10: Real Google Vision check, docs, demo build

**Files:**
- Modify: `CLAUDE.md` (the Layout, Commands and Status sections: exact insertions below)

**Interfaces:**
- Consumes: everything above. There is no new code.

- [ ] **Step 1: The user adds the key (do not do this yourself)**

Ask the user to create `web/.env.local` from `web/.env.example` and to paste their Google API key after `GOOGLE_API_KEY=`. Then confirm the file is ignored:

Run (from the repo root): `git check-ignore web/.env.local`
Expected: `web/.env.local` (git ignores the file).

- [ ] **Step 2: Read out/sim with the real API**

Run `npm run dev`, then:

Run: `curl -s -X POST -H "Content-Type: application/json" -d "{\"scan\":\"sim\"}" http://localhost:5173/api/read`
Expected: JSON whose `text` reads `Meet me on the moon at 9` (small OCR slips are acceptable), with 7 or more `words`, each with a 4-point `box` and a `confidence`, and `meanConfidence` ≥ 0.5.

- If the answer is `502` and mentions a language hint, change `LANGUAGE_HINTS` in `web/server/vision.ts` to `["en"]`. Run `npx vitest run test/server` (the tests must still pass), and commit that change on its own.
- If the answer is `502 ... API key not valid` or `... has not been used in project`, the key's project needs the Vision API enabled. That is the user's action in the Google Cloud console.

Run the same command again.
Expected: the same JSON, instantly. It comes from `web/.cache/ocr/`, and Google is not called a second time.

- [ ] **Step 3: Watch the full show with reading**

Open `http://localhost:5173/?replay=sim&pace=2500`, and press a key to arm audio.
Expected, after the reveal:
- A faint gold outline appears around each confident word.
- The browser voice reads "Meet me on the moon at 9". As each word is spoken, its box glows gold on the page, and the subtitle word turns gold.
- When the reading ends, every subtitle word is white and every box has an outline.
- 3 s later, the screen stays on the reveal (phase `hold`).

Stop the dev server.

- [ ] **Step 4: Check the demo build**

Run: `npm run demo`
Expected: `vite build` finishes, and then `vite preview` serves `http://localhost:5173`. Opening `http://localhost:5173/?replay=sim&pace=2500` behaves as in Step 3; the API works under preview too. Stop it.

- [ ] **Step 5: Document the web UI in CLAUDE.md**

In `CLAUDE.md`, section `## Layout`, add these lines at the end of the code block (just before its closing fence):
```
web/                    web UI (Vite + TS), the audience-facing show. Only reads out/.
  server/               Vite plugin: GET /scan/:name/:file (contract files only, no-store),
                        POST /api/read (Google Vision; key in web/.env.local, never in the browser)
  src/feed/             meta.json -> show events (ScanFeed live, ReplayFeed for dev/backup demo)
  src/show/director.ts  the show's state machine; Stage/Overlay/Voice are swappable (L0 = DOM/CSS)
```

In section `## Commands`, add these lines at the end of the code block:
```
cd web && npm ci                                      # once (Node >= 20.19)
cd web && npm run dev                                 # http://localhost:5173 watches out/latest
#   http://localhost:5173/?replay=sim&pace=2500       plays out/sim as if live (no hardware)
cd web && npm test                                    # unit tests
cd web && npm run demo                                # build + serve for the demo machine
```

In section `## Status / next`, add this line after the last `- [x]` item:
```
- [x] Web UI L0 (branch ui): live/replay feeds, Director, CSS stand-in visuals, Vision OCR, browser speech, 1202 alarm
```

- [ ] **Step 6: Run everything once more and commit**

Run (in `web/`): `npm run typecheck && npm test && npm run build`
Expected: exit code 0; all tests pass; the build succeeds.

Run (from the repo root): `git status --short`
Expected: only `CLAUDE.md` is modified (plus `web/server/vision.ts` if Step 2 changed the hint). `web/.env.local`, `web/.cache/` and `web/dist/` must not appear.

```bash
git add CLAUDE.md
git commit -m "Document the web UI: layout, commands, status"
```

---

## After L0

With L0 done, the show works end to end on `out/sim` and on the real rig. The next plan is **L1 (moon and sound)**, which replaces `DomStage` with a three.js `Stage` and `BrowserVoice` with the Cloud TTS radio voice, behind the same interfaces. It needs Cloud Text-to-Speech enabled on the Google project (spec §7).
