import { createReadStream } from "node:fs";
import { rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

/** Connect-style middleware: GET /scan, GET /scan/:name/:file, POST /api/read, POST /api/review.
 *  Everything else -> next(). */
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
      if (req.method === "POST" && path === "/api/review") {
        return sendJson(res, 200, await writeReviewAnswer(o.outDir, await readJsonBody(req)));
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

/** A person's answer to an open alignment review: out/<scan>/review_answer.json, which
 *  terminator.review polls. Written via tmp + rename so the pipeline never reads half a file. */
export async function writeReviewAnswer(outDir: string, body: unknown): Promise<{ ok: true }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const num = (v: unknown, lim: number) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= lim;
  if (typeof b.scan !== "string" || !SCAN_NAME.test(b.scan)) throw new HttpError(400, "bad scan name");
  if (typeof b.id !== "string" || !/^[a-z0-9]{1,32}$/.test(b.id)) throw new HttpError(400, "bad review id");
  if (!num(b.choice, 9) || !Number.isInteger(b.choice) || (b.choice as number) < 0) throw new HttpError(400, "bad choice");
  if (!num(b.dx, 2000) || !num(b.dy, 2000)) throw new HttpError(400, "bad nudge");
  const answer = { id: b.id, choice: b.choice, dx: b.dx, dy: b.dy };
  const dir = join(outDir, b.scan);
  const tmp = join(dir, "review_answer.json.tmp");
  await writeFile(tmp, JSON.stringify(answer));
  await rename(tmp, join(dir, "review_answer.json"));
  return { ok: true };
}
