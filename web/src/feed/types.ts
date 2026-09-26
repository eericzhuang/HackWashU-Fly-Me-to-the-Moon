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
