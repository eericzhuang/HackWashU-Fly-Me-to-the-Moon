import { pointerToSun, sunVector, wrapAngle, type Vec3 } from "./math";

/** The held sun (the dev panel tunes these live). */
export const SUN = { minElevationDeg: 4, idleSeconds: 6, orbitDegPerSecond: 20, autoElevationDeg: 9, follow: 6 };

const RAD = Math.PI / 180;

/** The held sun's state: it follows the pointer with a little inertia; left alone for SUN.idleSeconds it circles
 *  low on its own, so the relief keeps moving even when nobody touches it. */
export class SunFollower {
  azimuth = 0.75 * Math.PI;
  elevation = SUN.autoElevationDeg * RAD;
  private target = { azimuth: this.azimuth, elevation: this.elevation };
  private idle = SUN.idleSeconds; // starts circling

  point(px: number, py: number, cx: number, cy: number, radius: number): void {
    this.target = pointerToSun(px, py, cx, cy, radius, SUN.minElevationDeg);
    this.idle = 0;
  }

  /** Advance dt seconds; returns the page-space sun vector. */
  step(dt: number): Vec3 {
    this.idle += dt;
    if (this.idle >= SUN.idleSeconds) {
      this.target.azimuth = wrapAngle(this.target.azimuth + SUN.orbitDegPerSecond * RAD * dt);
      this.target.elevation = SUN.autoElevationDeg * RAD;
    }
    const k = 1 - Math.exp(-SUN.follow * dt);
    this.azimuth = wrapAngle(this.azimuth + wrapAngle(this.target.azimuth - this.azimuth) * k);
    this.elevation += (this.target.elevation - this.elevation) * k;
    return sunVector(this.azimuth, this.elevation);
  }
}
