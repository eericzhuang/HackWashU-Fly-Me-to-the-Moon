/** Types shared by the Node server (web/server) and the browser app (web/src). */

/** out/<scan>/meta.json, written by Eric's terminator.scan / terminator.phone. */
export interface Meta {
  status: "capturing" | "done";
  directions?: string[];
  captured: number[];
  started?: string;
  seconds?: number;
  source?: string;
  method?: "range" | "depth";
  /** Present while terminator.review waits for a person to settle a doubtful photo alignment. */
  review?: ReviewInfo;
  /** On "done": the step-by-step pages (steps.json) and how each photo's alignment was decided. */
  steps?: string;
  alignment?: AlignmentReport[];
}

/** meta.review: photo `led` may be misaligned; options[i].file overlays (cyan) on `ref` (red). */
export interface ReviewInfo {
  id: string;
  led: number;
  check: "inconsistent" | "unverified" | string;
  detail: string;
  options: { label: string; score: number; file: string }[];
  ref: string;
  ai: { choice: number | null; confidence: number; why: string } | null;
  timeout: number; // seconds the pipeline waits before using options[0]
}

/** POST /api/review body; dx, dy nudge the chosen option, in the review image's pixels. */
export interface ReviewAnswer {
  scan: string;
  id: string;
  choice: number;
  dx: number;
  dy: number;
}

export interface AlignmentReport {
  led: number;
  score: number;
  check: string;
  detail: string;
  by: "auto" | "ai" | "human" | string;
}

/** steps.json: one page per processing step, images are files in the same scan folder. */
export interface StepsManifest {
  pages: { title: string; note: string; panels: { file: string; caption: string }[] }[];
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
