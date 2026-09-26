import { describe, expect, it } from "vitest";
import {
  fitSize, kelvinToRgb, ledSun, normalize, orbitSun, PLATE_SLOTS, pointerToSun, spiral, starBuffers, sunVector,
  unpackHeight, wrapAngle,
} from "../../src/scene/math";

const close = (a: number[], b: number[], digits = 4) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
const DEG = Math.PI / 180;

describe("sun directions", () => {
  it("each LED lights the moon from its side, tilted toward the viewer", () => {
    close(ledSun(0, 0), [0, 1, 0]);
    close(ledSun(1, 0), [1, 0, 0]);
    close(ledSun(2, 0), [0, -1, 0]);
    close(ledSun(3, 0), [-1, 0, 0]);
    close(ledSun(0, 0.12), normalize([0, 1, 0.12]));
  });

  it("the orbiting sun goes counter-clockwise from +x", () => {
    close(orbitSun(Math.PI / 2, 0), [0, 1, 0]);
  });
});

describe("pointerToSun", () => {
  it("the page centre is noon, the rim is grazing, beyond the rim clamps", () => {
    expect(pointerToSun(400, 300, 400, 300, 200, 4).elevation).toBeCloseTo(90 * DEG);
    const rim = pointerToSun(600, 300, 400, 300, 200, 4);
    expect(rim.azimuth).toBeCloseTo(0);
    expect(rim.elevation).toBeCloseTo(4 * DEG);
    expect(pointerToSun(900, 300, 400, 300, 200, 4).elevation).toBeCloseTo(4 * DEG);
  });

  it("screen y points down, so a pointer above the centre is north", () => {
    expect(pointerToSun(400, 100, 400, 300, 200, 4).azimuth).toBeCloseTo(Math.PI / 2);
  });
});

describe("sunVector and wrapAngle", () => {
  it("azimuth 90deg at the horizon is north; elevation 90deg is straight up", () => {
    close(sunVector(Math.PI / 2, 0), [0, 1, 0]);
    close(sunVector(1.234, Math.PI / 2), [0, 0, 1]);
  });

  it("wraps into (-pi, pi]", () => {
    expect(wrapAngle(0)).toBeCloseTo(0);
    expect(wrapAngle(1.5 * Math.PI)).toBeCloseTo(-0.5 * Math.PI);
    expect(wrapAngle(-1.5 * Math.PI)).toBeCloseTo(0.5 * Math.PI);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI);
  });
});

describe("unpackHeight", () => {
  it("reads R*256+G and flips the rows bottom-up", () => {
    // 2x2 RGBA, rows top-down: top = (255,255) (0,0), bottom = (128,0) (0,1)
    const rgba = [255, 255, 0, 255, 0, 0, 0, 255, 128, 0, 0, 255, 0, 1, 0, 255];
    close(Array.from(unpackHeight(rgba, 2, 2)), [(128 * 256) / 65535, 1 / 65535, 1, 0], 6);
  });
});

describe("stars", () => {
  it("black-body colours: 6600 K is white, 3000 K is orange", () => {
    close(kelvinToRgb(6600), [1, 1, 1], 2);
    const [r, g, b] = kelvinToRgb(3000);
    expect(r).toBe(1);
    expect(g).toBeGreaterThan(b);
    expect(b).toBeLessThan(0.5);
  });

  it("keeps stars up to the magnitude limit, on the sphere, bright ones bigger", () => {
    const s = starBuffers([[0, 0, 1, 6600], [90, 0, 7, 6600]], 90, 6.5);
    expect(s.count).toBe(1);
    close(Array.from(s.positions), [90, 0, 0]);
    expect(s.sizes[0]).toBeCloseTo(2 + 3.5 * (5.5 / 7));
  });
});

describe("photo cards", () => {
  it("fits a picture inside a box", () => {
    close(fitSize(2, 1.3, 0.62), [1.24, 0.62]);
    close(fitSize(0.75, 1.3, 0.62), [0.465, 0.62]);
    close(fitSize(3, 1.3, 0.62), [1.3, 1.3 / 3]);
  });

  it("parks each photo on its LED's side of the moon", () => {
    expect(PLATE_SLOTS[0][1]).toBeGreaterThan(1); // north: above
    expect(PLATE_SLOTS[1][0]).toBeGreaterThan(1); // east: right
    expect(PLATE_SLOTS[2][1]).toBeLessThan(-1); // south: below
    expect(PLATE_SLOTS[3][0]).toBeLessThan(-1); // west: left
  });

  it("spirals from the slot into the centre", () => {
    const start: [number, number, number] = [2, 0, 0.4];
    close(spiral(start, 0, 0.75), start);
    close(spiral(start, 1, 0.75), [0, 0, 0]);
    expect(Math.hypot(...spiral(start, 0.5, 0.75).slice(0, 2))).toBeCloseTo(2 * Math.pow(0.5, 1.5));
  });
});
