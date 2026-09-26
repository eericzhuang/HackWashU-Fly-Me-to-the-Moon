import { describe, expect, it } from "vitest";
import { CHORDS, COMBINING, RESOLVED, heldSunMix } from "../../src/audio/scoreCues";

describe("lunar score cues", () => {
  it("walks Em7, Am7, Dm7, G7 with the four LED directions", () => {
    expect(CHORDS).toEqual([
      { notes: ["E3", "G3", "B3", "D4"], bass: "E2" },
      { notes: ["A2", "C3", "E3", "G3"], bass: "A1" },
      { notes: ["D3", "F3", "A3", "C4"], bass: "D2" },
      { notes: ["G2", "B2", "D3", "F3"], bass: "G1" },
    ]);
  });

  it("holds G7 while combining and resolves to Cmaj9", () => {
    expect(COMBINING).toEqual(CHORDS[3]);
    expect(RESOLVED).toEqual({ notes: ["C3", "E3", "G3", "B3", "D4"], bass: "C2" });
  });

  it("maps held sun angle to bounded pan and cutoff", () => {
    expect(heldSunMix(0, 0)).toEqual({ pan: 0, cutoff: 500 });
    expect(heldSunMix(Math.PI / 2, Math.PI / 2)).toEqual({ pan: 1, cutoff: 3000 });
    expect(heldSunMix(-Math.PI / 2, Math.PI / 6).pan).toBeCloseTo(-1);
    expect(heldSunMix(0, Math.PI / 6).cutoff).toBeCloseTo(1750);
  });
});
