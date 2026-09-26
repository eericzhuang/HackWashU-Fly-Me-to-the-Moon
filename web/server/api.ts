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
