import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Scan folders the UI may read: the live mirror, the committed simulation, and past scans. */
export const SCAN_NAME = /^(latest|sim|scan_\d{8}_\d{6})$/;

/** The only files the UI may read from a scan folder (docs/scan-contract.md). */
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

/** Step pages (terminator.stages) and alignment-review images (terminator.review). */
export const SCAN_EXTRA = /^(steps\.json|step_\d{1,2}_\d\.png|review_ref\.png|review_\d\.png)$/;

/** Absolute path of out/<name>/<file>, or null if the folder or file is not allowed. */
export function resolveScanFile(outDir: string, name: string, file: string): string | null {
  if (!SCAN_NAME.test(name) || !(SCAN_FILES.has(file) || SCAN_EXTRA.test(file))) return null;
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
