import gsap from "gsap";
import * as THREE from "three";
import type { Word } from "../../shared/types";
import type { DoneUrls } from "../feed/types";
import type { Stage } from "../show/director";
import { loadSkyAssets, type SkyAssets } from "./assets";
import { DomStage } from "./domStage";
import { Engine } from "./engine";
import { MOON, Moon } from "./moon";
import { Stars } from "./stars";

/** Look and timing (the dev panel tunes these live). */
export const STAGE = { captureDim: 0.45, descentSeconds: 1.5, sunriseSeconds: 1.5, relightSeconds: 1.2 };

const NIGHT = new THREE.Color(0x010207);
const DAWN = new THREE.Color(0x1d1520);
const HOME = new THREE.Vector3(0, 0, 7);
// The dive: toward the terminator, lit from the west so it runs down the middle of the disc.
const DIVE_CAMERA = new THREE.Vector3(0.12, 0.18, 1.85);
const DIVE_LOOK = new THREE.Vector3(0.02, 0.08, 0.9);
const DIVE_LED = 3;

/** The three.js picture behind the Stage interface. This version draws the moon and the sky in 3D and still
 *  borrows the photos and the reveal page from DomStage (tasks 6 and 7 move them into 3D). */
export class ThreeStage implements Stage {
  static async create(glRoot: HTMLElement, domRoot: HTMLElement): Promise<ThreeStage> {
    const engine = new Engine(glRoot);
    const assets = await loadSkyAssets(engine.renderer.capabilities.getMaxAnisotropy());
    return new ThreeStage(engine, assets, domRoot);
  }

  readonly engine: Engine;
  readonly moon: Moon;
  private readonly stars: Stars;
  private readonly dom: DomStage;
  private readonly look = new THREE.Vector3();
  private readonly sky = NIGHT.clone();
  private moves: gsap.core.Animation[] = [];

  private constructor(engine: Engine, assets: SkyAssets, domRoot: HTMLElement) {
    this.engine = engine;
    this.moon = new Moon(assets);
    this.stars = new Stars(assets.stars);
    engine.scene.add(this.stars.points, this.moon.mesh);
    domRoot.classList.add("three");
    this.dom = new DomStage(domRoot);
    engine.onFrame((f) => {
      this.moon.update(f, engine.camera);
      this.stars.update(f, engine.renderer.getPixelRatio());
      engine.camera.lookAt(this.look);
      (engine.scene.background as THREE.Color).copy(this.sky);
    });
  }

  idle(): void {
    this.reset(1, MOON.turnSeconds);
    this.dom.idle();
  }

  newScan(): void {
    this.reset(STAGE.captureDim, 0.8);
    this.dom.newScan();
  }

  ledOn(led: number): void {
    this.moon.lightFrom(led);
    this.dom.ledOn(led);
  }

  photoLanded(led: number, url: string): void {
    this.dom.photoLanded(led, url);
  }

  combining(): void {
    this.moon.orbit();
    this.dom.combining();
  }

  async descent(urls: DoneUrls): Promise<void> {
    this.moon.lightFrom(DIVE_LED, 0.6);
    const d = STAGE.descentSeconds;
    this.track(gsap.to(this.engine.camera.position, { x: DIVE_CAMERA.x, y: DIVE_CAMERA.y, z: DIVE_CAMERA.z, duration: d, ease: "power2.in" }));
    this.track(gsap.to(this.look, { x: DIVE_LOOK.x, y: DIVE_LOOK.y, z: DIVE_LOOK.z, duration: d, ease: "power2.in" }));
    await Promise.all([this.wait(d), this.dom.descent(urls)]);
  }

  async reveal(urls: DoneUrls): Promise<void> {
    const s = STAGE.sunriseSeconds;
    this.track(gsap.to(this.engine.frameGain, { gain: 1, duration: s }));
    this.track(gsap.to(this.sky, { r: DAWN.r, g: DAWN.g, b: DAWN.b, duration: s }));
    await this.dom.reveal(urls);
  }

  showWords(words: Word[], confident: number[]): void {
    this.dom.showWords(words, confident);
  }

  highlight(index: number | null): void {
    this.dom.highlight(index);
  }

  hold(): void {
    this.dom.hold();
  }

  skip(): void {
    const running = this.moves;
    this.moves = [];
    for (const m of running) m.progress(1); // tweens jump to their end, waits resolve
    this.moon.finishTurn();
    this.dom.skip();
  }

  /** Render one frame now: for checks in hidden windows, where requestAnimationFrame is throttled. */
  renderOnce(dt?: number): void {
    this.engine.renderOnce(dt);
  }

  private reset(gain: number, turnSeconds: number): void {
    const running = this.moves;
    this.moves = [];
    for (const m of running) m.progress(1).kill(); // finish (resolving any wait), then stop
    this.engine.camera.position.copy(HOME);
    this.look.set(0, 0, 0);
    this.sky.copy(NIGHT);
    this.moon.showFull(turnSeconds);
    this.track(gsap.to(this.engine.frameGain, { gain, duration: 0.6 }));
  }

  private wait(seconds: number): Promise<void> {
    return new Promise((resolve) => this.track(gsap.delayedCall(seconds, resolve)));
  }

  private track(a: gsap.core.Animation): void {
    this.moves.push(a);
  }
}
