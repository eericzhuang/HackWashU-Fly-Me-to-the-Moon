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
