/** Pure helpers for the three.js stage. No three.js import, so they run (and are tested) in Node. */

export type Vec3 = [number, number, number];

export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

const SIDES: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]]; // LED 0..3 = N, E, S, W

/** Sun direction (world: x right, y up, z toward the viewer) while LED `led` is lit: the light comes from that
 *  side, tilted a little toward the viewer so slightly more than half the moon is lit. */
export function ledSun(led: number, towardViewer: number): Vec3 {
  const [x, y] = SIDES[led] ?? SIDES[0];
  return normalize([x, y, towardViewer]);
}

/** Sun going round the moon while the photos are combined; angle from +x, counter-clockwise. */
export function orbitSun(angle: number, towardViewer: number): Vec3 {
  return normalize([Math.cos(angle), Math.sin(angle), towardViewer]);
}

/** The held sun from a pointer: the angle round the page centre is the azimuth (0 = east/right, counter-
 *  clockwise; screen y points down); the distance sets the height, noon at the centre and grazing at
 *  `minElevationDeg` from `radius` outward. Radians. */
export function pointerToSun(
  px: number, py: number, cx: number, cy: number, radius: number, minElevationDeg: number,
): { azimuth: number; elevation: number } {
  const dx = px - cx;
  const dy = cy - py;
  const r = Math.min(1, Math.hypot(dx, dy) / Math.max(radius, 1));
  const elevationDeg = 90 - (90 - minElevationDeg) * r;
  return { azimuth: Math.atan2(dy, dx), elevation: (elevationDeg * Math.PI) / 180 };
}

/** Unit sun vector over the page (x east/right, y north/up, z out of the page). */
export function sunVector(azimuth: number, elevation: number): Vec3 {
  const c = Math.cos(elevation);
  return [Math.cos(azimuth) * c, Math.sin(azimuth) * c, Math.sin(elevation)];
}

/** Angle wrapped into (-pi, pi]. */
export function wrapAngle(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t <= 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/** Heights packed by tools/prepare_moon_assets.py (R = high byte, G = low byte, RGBA pixels, rows top-down)
 *  -> 0..1 values with rows bottom-up, the order WebGL data textures use. */
export function unpackHeight(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const src = y * width * 4;
    const dst = (height - 1 - y) * width;
    for (let x = 0; x < width; x++) out[dst + x] = (rgba[src + x * 4] * 256 + rgba[src + x * 4 + 1]) / 65535;
  }
  return out;
}

/** Approximate colour (0..1) of a black body at `kelvin` (Tanner Helland's fit), for star colours. */
export function kelvinToRgb(kelvin: number): Vec3 {
  const t = kelvin / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  return [c(r), c(g), c(b)];
}

export interface StarBuffers {
  positions: Float32Array;
  colors: Float32Array; // colour x brightness
  sizes: Float32Array; // CSS pixels
  count: number;
}

/** Catalogue rows [raDeg, decDeg, vmag, tempK] -> points on a sphere of `radius`. */
export function starBuffers(rows: number[][], radius: number, maxMagnitude: number): StarBuffers {
  const keep = rows.filter((r) => r[2] <= maxMagnitude);
  const positions = new Float32Array(keep.length * 3);
  const colors = new Float32Array(keep.length * 3);
  const sizes = new Float32Array(keep.length);
  keep.forEach(([ra, dec, vmag, kelvin], i) => {
    const a = (ra * Math.PI) / 180;
    const d = (dec * Math.PI) / 180;
    positions.set([radius * Math.cos(d) * Math.cos(a), radius * Math.sin(d), radius * Math.cos(d) * Math.sin(a)], i * 3);
    const flux = Math.min(6, 0.35 + Math.pow(10, -0.4 * (vmag - 3.2)));
    const [r, g, b] = kelvinToRgb(kelvin);
    colors.set([r * flux, g * flux, b * flux], i * 3);
    sizes[i] = 2 + 3.5 * Math.min(1, Math.max(0, (maxMagnitude - vmag) / 7));
  });
  return { positions, colors, sizes, count: keep.length };
}

/** (w, h) of a picture with aspect w/h fitted inside maxW x maxH. */
export function fitSize(aspect: number, maxW: number, maxH: number): [number, number] {
  return aspect >= maxW / maxH ? [maxW, maxW / aspect] : [maxH * aspect, maxH];
}

/** Where each photo parks (world units; moon of radius 1 at the origin, camera at z = 7): its LED's side. */
export const PLATE_SLOTS: Vec3[] = [[0, 1.42, 0.4], [2.2, 0, 0.4], [0, -1.42, 0.4], [-2.2, 0, 0.4]];

/** Point on the spiral a parked photo follows into the moon; p runs 0..1. */
export function spiral(start: Vec3, p: number, turns: number): Vec3 {
  const angle = Math.atan2(start[1], start[0]) + p * turns * 2 * Math.PI;
  const r = Math.hypot(start[0], start[1]) * Math.pow(1 - p, 1.5);
  return [Math.cos(angle) * r, Math.sin(angle) * r, start[2] * (1 - p)];
}
