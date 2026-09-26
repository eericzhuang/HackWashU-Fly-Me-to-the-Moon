import type { Vec3 } from "./math";
import { SUN, SunFollower } from "./sunFollower";

function div(cls: string, text = ""): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = text;
  return d;
}

/** Hold the sun on screen: pointer direction controls azimuth and distance controls elevation. */
export class SunHandle {
  private readonly follower = new SunFollower();
  private readonly glyph = div("sun");
  private readonly hint = div("sun-hint", "HOLD THE SUN · move the light · centre = noon");
  private readonly root: HTMLElement;
  private active = false;
  private area = { x: 0, y: 0, radius: 1 };

  constructor(root: HTMLElement) {
    this.root = root;
    root.append(this.glyph, this.hint);
    addEventListener("pointermove", (e) => {
      if (this.active) this.follower.point(e.clientX, e.clientY, this.area.x, this.area.y, this.area.radius);
    });
  }
  setArea(x: number, y: number, radius: number): void { this.area = { x, y, radius }; }
  start(): void {
    this.active = true;
    this.glyph.classList.add("on");
    this.hint.classList.add("on");
    this.root.classList.add("holding");
  }
  stop(): void {
    this.active = false;
    this.glyph.classList.remove("on");
    this.hint.classList.remove("on");
    this.root.classList.remove("holding");
  }
  update(dt: number): Vec3 {
    const v = this.follower.step(this.active ? dt : 0);
    if (this.active) {
      const elevationDeg = (this.follower.elevation * 180) / Math.PI;
      const r = ((90 - elevationDeg) / (90 - SUN.minElevationDeg)) * this.area.radius;
      const x = this.area.x + r * Math.cos(this.follower.azimuth);
      const y = this.area.y - r * Math.sin(this.follower.azimuth);
      this.glyph.style.transform = `translate(${x}px, ${y}px)`;
    }
    return v;
  }
}
