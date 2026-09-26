import { describe, expect, it } from "vitest";
import { SUN, SunFollower } from "../../src/scene/sunFollower";

const DEG = Math.PI / 180;

describe("SunFollower", () => {
  it("starts circling low on its own", () => {
    const s = new SunFollower();
    const a0 = s.azimuth;
    s.step(1);
    expect(s.azimuth - a0).toBeCloseTo(SUN.orbitDegPerSecond * DEG, 1);
    expect(s.elevation).toBeCloseTo(SUN.autoElevationDeg * DEG, 3);
  });

  it("follows the pointer: the page centre raises the sun to noon", () => {
    const s = new SunFollower();
    s.point(400, 300, 400, 300, 200);
    for (let i = 0; i < 120; i++) s.step(1 / 60);
    expect(s.elevation).toBeCloseTo(90 * DEG, 2);
  });

  it("goes back to circling after SUN.idleSeconds without the pointer", () => {
    const s = new SunFollower();
    s.point(400, 300, 400, 300, 200);
    for (let i = 0; i < 60 * (SUN.idleSeconds + 2); i++) s.step(1 / 60);
    expect(s.elevation).toBeCloseTo(SUN.autoElevationDeg * DEG, 2);
  });

  it("takes the short way round across +-pi", () => {
    const s = new SunFollower();
    s.point(400 - 200, 300 - 20, 400, 300, 200); // just north of west: azimuth ~ +174deg
    for (let i = 0; i < 120; i++) s.step(1 / 60);
    const before = s.azimuth;
    s.point(400 - 200, 300 + 20, 400, 300, 200); // just south of west: azimuth ~ -174deg
    s.step(1 / 60);
    expect(Math.abs(Math.atan2(Math.sin(s.azimuth - before), Math.cos(s.azimuth - before)))).toBeLessThan(12 * DEG);
  });
});
