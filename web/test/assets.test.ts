import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sky = (file: string) => new URL(`../public/sky/${file}`, import.meta.url);

describe("committed sky assets", () => {
  it("the height map is a 2048x1024 PNG and its metadata covers the lunar relief", () => {
    const meta = JSON.parse(readFileSync(sky("moon_height.json"), "utf8"));
    expect(meta).toMatchObject({ width: 2048, height: 1024 });
    expect(meta.minKm).toBeLessThan(-8);
    expect(meta.maxKm).toBeGreaterThan(10);
    const png = readFileSync(sky("moon_height.png"));
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(2048); // IHDR width
    expect(png.readUInt32BE(20)).toBe(1024); // IHDR height
  });

  it("star rows are [raDeg, decDeg, vmag, kelvin]", () => {
    const stars = JSON.parse(readFileSync(sky("stars.json"), "utf8")) as number[][];
    expect(stars.length).toBeGreaterThan(9000);
    for (const [ra, dec, vmag, kelvin] of stars) {
      expect(ra).toBeGreaterThanOrEqual(0);
      expect(ra).toBeLessThan(360);
      expect(Math.abs(dec)).toBeLessThanOrEqual(90);
      expect(vmag).toBeGreaterThan(-2);
      expect(vmag).toBeLessThan(9);
      expect(kelvin).toBeGreaterThan(1000);
    }
  });

  it("the colour map is a JPEG under 3 MB", () => {
    const jpg = readFileSync(sky("moon_color.jpg"));
    expect([jpg[0], jpg[1]]).toEqual([0xff, 0xd8]);
    expect(statSync(sky("moon_color.jpg")).size).toBeLessThan(3_000_000);
  });
});
