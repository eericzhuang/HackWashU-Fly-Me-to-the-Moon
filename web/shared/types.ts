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
