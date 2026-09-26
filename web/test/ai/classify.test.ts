import { describe, expect, it } from "vitest";
import type { ReadResult, Word } from "../../shared/types";
import { classify } from "../../src/ai/classify";

const w = (text: string, confidence: number): Word => ({ text, box: [], confidence });
const result = (words: Word[]): ReadResult => ({
  scanId: "s",
  text: words.map((x) => x.text).join(" "),
  words,
  meanConfidence: words.length ? words.reduce((a, x) => a + x.confidence, 0) / words.length : 0,
});

describe("classify", () => {
  it("ok when words were found and are trusted on average; lists the confident ones", () => {
    const words = [w("Meet", 0.9), w("me", 0.3)];
    expect(classify(result(words))).toEqual({ kind: "ok", words, confident: [0] });
  });

  it("0.5 counts as confident", () => {
    expect(classify(result([w("on", 0.5)]))).toMatchObject({ kind: "ok", confident: [0] });
  });

  it("weak when the average is low", () => {
    expect(classify(result([w("M?", 0.4)])).kind).toBe("weak");
  });

  it("weak when nothing was found", () => {
    expect(classify(result([]))).toEqual({ kind: "weak", words: [], confident: [] });
  });

  it("error when there is no result at all", () => {
    expect(classify(null)).toEqual({ kind: "error", words: [], confident: [] });
  });
});
