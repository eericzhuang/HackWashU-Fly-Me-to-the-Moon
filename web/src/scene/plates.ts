import gsap from "gsap";
import * as THREE from "three";
import { loadPhoto } from "./assets";
import { fitSize, PLATE_SLOTS, spiral, type Vec3 } from "./math";

/** Sizes (world units; moon of radius 1 at the origin, camera at z = 7) and timings. */
export const PLATES = {
  closeupSeconds: 2, // the photo shows big this long (it is dimmed like the whole frame while capturing)
  moveSeconds: 0.8,
  sinkSeconds: 6,
  sinkStagger: 0.25,
  sinkTurns: 0.75,
  closeupZ: 3.2,
  closeupMax: [2.4, 1.3] as [number, number],
  parkedMax: [1.3, 0.62] as [number, number],
  brightness: 0.85,
  frameOpacity: 0.85,
};

interface Plate {
  group: THREE.Group;
  photo: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  frame: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  anim: gsap.core.Timeline;
}

const QUAD = new THREE.PlaneGeometry(1, 1);

/** The four photos as cards: each lands big in front of the moon, then parks on its LED's side; while the
 *  photos are combined they spiral into the moon. */
export class PlateDeck {
  readonly group = new THREE.Group();
  private plates: (Plate | undefined)[] = [];
  private sinking: gsap.core.Animation | null = null;
  private gen = 0;

  async land(led: number, url: string): Promise<void> {
    const gen = this.gen;
    const texture = await loadPhoto(url).catch((e: unknown) => {
      console.warn("photo failed to load:", e);
      return null;
    });
    if (!texture) return;
    if (gen !== this.gen) return void texture.dispose(); // a new scan started meanwhile
    if (this.sinking) return void texture.dispose(); // the photos are already going into the moon: too late
    for (const p of this.plates) p?.anim.progress(1); // an earlier close-up parks at once
    this.remove(led);
    const aspect = texture.image.width / texture.image.height;
    const [cw, ch] = fitSize(aspect, ...PLATES.closeupMax);
    const [pw, ph] = fitSize(aspect, ...PLATES.parkedMax);
    const [sx, sy, sz] = PLATE_SLOTS[led];
    const plate = this.build(texture);
    plate.group.position.set(0, 0, PLATES.closeupZ);
    plate.group.scale.set(cw * 0.9, ch * 0.9, 1);
    plate.anim
      .to(plate.group.scale, { x: cw, y: ch, duration: 0.5, ease: "power2.out" }, 0)
      .to(plate.photo.material, { opacity: 1, duration: 0.5 }, 0)
      .to(plate.frame.material, { opacity: PLATES.frameOpacity, duration: 0.5 }, 0)
      .to(plate.group.position, { x: sx, y: sy, z: sz, duration: PLATES.moveSeconds, ease: "power3.inOut" }, PLATES.closeupSeconds)
      .to(plate.group.scale, { x: pw, y: ph, duration: PLATES.moveSeconds, ease: "power3.inOut" }, PLATES.closeupSeconds);
    this.plates[led] = plate;
    this.group.add(plate.group);
  }

  /** Spiral every photo into the moon, after the last close-up has had its time. */
  sink(): void {
    this.sinking?.kill();
    this.sinking = gsap.delayedCall(PLATES.closeupSeconds, () => {
      this.sinking = this.spiralIn();
    });
  }

  skip(): void {
    for (const p of this.plates) p?.anim.progress(1);
    // A pending sink is a delayedCall: finishing it starts the spiral (reassigning `sinking`)...
    this.sinking?.progress(1);
    // ...which then finishes too.
    this.sinking?.progress(1);
  }

  clear(): void {
    this.gen++;
    this.sinking?.kill();
    this.sinking = null;
    for (let k = 0; k < 4; k++) this.remove(k);
  }

  private spiralIn(): gsap.core.Timeline {
    const tl = gsap.timeline();
    this.plates.forEach((p, i) => {
      if (!p) return;
      const s = { p: 0 };
      let start: Vec3 = [0, 0, 0];
      let size: [number, number] = [1, 1];
      tl.to(
        s,
        {
          p: 1,
          duration: PLATES.sinkSeconds,
          ease: "power2.in",
          onStart: () => {
            p.anim.progress(1);
            start = [p.group.position.x, p.group.position.y, p.group.position.z];
            size = [p.group.scale.x, p.group.scale.y];
          },
          onUpdate: () => {
            const [x, y, z] = spiral(start, s.p, PLATES.sinkTurns);
            const k = 1 - 0.9 * s.p;
            p.group.position.set(x, y, z);
            p.group.scale.set(size[0] * k, size[1] * k, 1);
            p.photo.material.opacity = 1 - s.p;
            p.frame.material.opacity = PLATES.frameOpacity * (1 - s.p);
          },
        },
        i * PLATES.sinkStagger,
      );
    });
    return tl;
  }

  private build(texture: THREE.Texture): Plate {
    const photo = new THREE.Mesh(
      QUAD,
      new THREE.MeshBasicMaterial({ map: texture, color: new THREE.Color().setScalar(PLATES.brightness), transparent: true, opacity: 0, depthWrite: false }),
    );
    const frame = new THREE.Mesh(QUAD, new THREE.MeshBasicMaterial({ color: 0x1c2030, transparent: true, opacity: 0, depthWrite: false }));
    frame.scale.set(1.04, 1.06, 1);
    frame.position.z = -0.002;
    const group = new THREE.Group();
    group.add(frame, photo);
    return { group, photo, frame, anim: gsap.timeline() };
  }

  private remove(led: number): void {
    const p = this.plates[led];
    if (!p) return;
    p.anim.kill();
    p.group.removeFromParent();
    p.photo.material.map?.dispose();
    p.photo.material.dispose();
    p.frame.material.dispose();
    this.plates[led] = undefined;
  }
}
