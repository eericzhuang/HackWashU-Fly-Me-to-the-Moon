/** LED order is north, east, south, west: iii–vi–ii–V. */
export const CHORDS = [
  { notes: ["E3", "G3", "B3", "D4"], bass: "E2" },
  { notes: ["A2", "C3", "E3", "G3"], bass: "A1" },
  { notes: ["D3", "F3", "A3", "C4"], bass: "D2" },
  { notes: ["G2", "B2", "D3", "F3"], bass: "G1" },
] as const;

export const COMBINING = CHORDS[3];
export const RESOLVED = { notes: ["C3", "E3", "G3", "B3", "D4"], bass: "C2" } as const;

export function heldSunMix(azimuth: number, elevation: number): { pan: number; cutoff: number } {
  return { pan: Math.sin(azimuth), cutoff: 500 + 2500 * Math.sin(elevation) };
}
