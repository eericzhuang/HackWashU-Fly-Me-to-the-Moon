import gsap from "gsap";
import * as THREE from "three";
import type { Word } from "../../shared/types";
import type { DoneUrls } from "../feed/types";
import type { Stage } from "../show/director";
import { loadSkyAssets, type SkyAssets } from "./assets";
import { Engine } from "./engine";
import { MOON, Moon } from "./moon";
import { PageView } from "./page";
import { PlateDeck } from "./plates";
import { Stars } from "./stars";
import { SunHandle } from "./sunHandle";

/** Look and timing (the dev panel tunes these live). */
export const STAGE = { captureDim: 0.45, descentSeconds: 1.5, sunriseSeconds: 1.5, relightSeconds: 1.2 };

const NIGHT = new THREE.Color(0x010207);
const DAWN = new THREE.Color(0x1d1520);
const HOME = new THREE.Vector3(0, 0, 7);
// The dive: toward the terminator, lit from the west so it runs down the middle of the disc.
const DIVE_CAMERA = new THREE.Vector3(0.12, 0.18, 1.85);
const DIVE_LOOK = new THREE.Vector3(0.02, 0.08, 0.9);
const DIVE_LED = 3;

/** The three.js picture: moon, sky, photos, a sunrise onto the page and a sun you can hold over it. */
export class ThreeStage implements Stage {
  static async create(glRoot: HTMLElement, domRoot: HTMLElement, onHeldSun?: (azimuth: number, elevation: number) => void): Promise<ThreeStage> {
    const engine = new Engine(glRoot);
    const assets = await loadSkyAssets(engine.renderer.capabilities.getMaxAnisotropy());
    return new ThreeStage(engine, assets, domRoot, onHeldSun);
  }

  readonly engine: Engine;
  readonly moon: Moon;
  readonly page: PageView;
  private readonly stars: Stars;
  private readonly plates = new PlateDeck();
  private readonly sunHandle: SunHandle;
  private readonly look = new THREE.Vector3();
  private readonly sky = NIGHT.clone();
  private moves: gsap.core.Animation[] = [];
  private sceneGeneration = 0;
  private holdRequested = false;
  private sunHeld = false;

  private constructor(engine: Engine, assets: SkyAssets, domRoot: HTMLElement, onHeldSun?: (azimuth: number, elevation: number) => void) {
    this.engine = engine;
    this.moon = new Moon(assets);
    this.stars = new Stars(assets.stars);
    this.page = new PageView(engine.camera, domRoot);
    this.sunHandle = new SunHandle(domRoot);
    this.page.onMeasurementsReady(() => this.startHoldIfReady());
    engine.scene.add(this.stars.points, this.moon.mesh, this.plates.group);
    domRoot.classList.add("three");
    engine.onFrame((f) => {
      this.moon.update(f, engine.camera);
      this.stars.update(f, engine.renderer.getPixelRatio());
      engine.camera.lookAt(this.look);
      (engine.scene.background as THREE.Color).copy(this.sky);
      const r = this.page.layout(engine.camera, innerWidth, innerHeight);
      this.sunHandle.setArea(r.left + r.width / 2, r.top + r.height / 2, 0.5 * Math.max(r.width, r.height));
      this.page.setSun(this.sunHandle.update(f.dt));
      if (this.sunHeld) {
        const { azimuth, elevation } = this.sunHandle.angles();
        onHeldSun?.(azimuth, elevation);
      }
    });
  }

  idle(): void { this.reset(1, MOON.turnSeconds); }
  newScan(): void { this.reset(STAGE.captureDim, 0.8); }
  ledOn(led: number): void { this.moon.lightFrom(led); }
  photoLanded(led: number, url: string): void { void this.plates.land(led, url); }
  combining(): void { this.moon.orbit(); this.plates.sink(); }

  async descent(urls: DoneUrls): Promise<void> {
    this.moon.lightFrom(DIVE_LED, 0.6);
    const loading = this.page.load(urls);
    const d = STAGE.descentSeconds;
    this.track(gsap.to(this.engine.camera.position, { x: DIVE_CAMERA.x, y: DIVE_CAMERA.y, z: DIVE_CAMERA.z, duration: d, ease: "power2.in" }));
    this.track(gsap.to(this.look, { x: DIVE_LOOK.x, y: DIVE_LOOK.y, z: DIVE_LOOK.z, duration: d, ease: "power2.in" }));
    await Promise.all([this.wait(d), loading]);
  }

  async reveal(urls: DoneUrls): Promise<void> {
    const generation = this.sceneGeneration;
    if (!this.page.shows(urls.reveal)) await this.page.load(urls);
    if (generation !== this.sceneGeneration) return;
    const s = STAGE.sunriseSeconds;
    this.track(gsap.to(this.engine.frameGain, { gain: 1, duration: s }));
    this.track(gsap.to(this.sky, { r: DAWN.r, g: DAWN.g, b: DAWN.b, duration: s }));
    if (this.page.shows(urls.reveal)) this.page.show(s);
    await this.wait(s);
  }
  showWords(words: Word[], confident: number[]): void { this.page.showWords(words, confident); }
  highlight(index: number | null): void { this.page.highlight(index); }
  hold(): void {
    this.holdRequested = true;
    this.startHoldIfReady();
  }

  skip(): void {
    const running = this.moves;
    this.moves = [];
    for (const m of running) m.progress(1);
    this.moon.finishTurn();
    this.plates.skip();
    this.page.skip();
  }

  /** Render one frame now: for checks in hidden windows, where requestAnimationFrame is throttled. */
  renderOnce(dt?: number): void { this.engine.renderOnce(dt); }

  private reset(gain: number, turnSeconds: number): void {
    this.sceneGeneration++;
    this.holdRequested = false;
    this.sunHeld = false;
    const running = this.moves;
    this.moves = [];
    for (const m of running) m.progress(1).kill();
    this.engine.camera.position.copy(HOME);
    this.look.set(0, 0, 0);
    this.sky.copy(NIGHT);
    this.plates.clear();
    this.page.hide();
    this.sunHandle.stop();
    this.moon.showFull(turnSeconds);
    this.track(gsap.to(this.engine.frameGain, { gain, duration: 0.6 }));
  }
  private startHoldIfReady(): void {
    if (!this.holdRequested || this.sunHeld || !this.page.relight(STAGE.relightSeconds)) return;
    this.sunHeld = true;
    this.sunHandle.start();
  }
  private wait(seconds: number): Promise<void> { return new Promise((resolve) => this.track(gsap.delayedCall(seconds, resolve))); }
  private track(a: gsap.core.Animation): void { this.moves.push(a); }
}
