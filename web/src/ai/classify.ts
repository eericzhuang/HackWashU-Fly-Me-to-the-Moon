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
