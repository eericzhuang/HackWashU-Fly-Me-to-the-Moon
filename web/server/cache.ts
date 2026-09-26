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
