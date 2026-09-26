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
