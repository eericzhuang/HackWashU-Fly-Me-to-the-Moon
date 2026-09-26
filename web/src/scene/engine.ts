import * as THREE from "three";
import {
  BlendFunction, BloomEffect, Effect, EffectComposer, EffectPass, NoiseEffect, RenderPass, SMAAEffect,
  ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from "postprocessing";

export interface Frame {
  dt: number; // seconds since the previous frame (capped at 0.1)
  time: number; // seconds
}

/** Multiplies the finished frame. While a scan is capturing the screen stays dark: it would light the paper. */
export class GainEffect extends Effect {
  constructor() {
    super(
      "GainEffect",
      /* glsl */ `
        uniform float gain;
        void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
          outputColor = vec4(inputColor.rgb * gain, inputColor.a);
        }`,
      { uniforms: new Map([["gain", new THREE.Uniform(1)]]) },
    );
  }

  get gain(): number {
    return this.uniforms.get("gain")!.value as number;
  }

  set gain(v: number) {
    this.uniforms.get("gain")!.value = v;
  }
}

/** Renderer, camera, HDR post chain (bloom, ACES, vignette, grain, gain, SMAA) and the frame loop. */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.05, 300);
  readonly bloom: BloomEffect;
  readonly frameGain = new GainEffect();
  private readonly composer: EffectComposer;
  private readonly updaters = new Set<(f: Frame) => void>();
  private last = performance.now();
  private slow = 0;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", stencil: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.append(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x010207);
    this.scene.add(this.camera); // the page hangs off the camera
    this.camera.position.set(0, 0, 7);

    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new BloomEffect({ intensity: 0.9, luminanceThreshold: 0.75, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.7 });
    const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    grain.blendMode.opacity.value = 0.06;
    this.composer.addPass(
      new EffectPass(
        this.camera,
        this.bloom,
        new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
        new VignetteEffect({ darkness: 0.55, offset: 0.35 }),
        grain,
        this.frameGain,
      ),
    );
    this.composer.addPass(new EffectPass(this.camera, new SMAAEffect())); // SMAA is a convolution effect: own pass

    this.resize();
    addEventListener("resize", () => this.resize());
    this.renderer.setAnimationLoop((now: number) => this.loop(now));
  }

  /** Run `fn` every frame before rendering; returns a function that removes it. */
  onFrame(fn: (f: Frame) => void): () => void {
    this.updaters.add(fn);
    return () => this.updaters.delete(fn);
  }

  /** Render one frame right now: for checks in hidden windows, where requestAnimationFrame is throttled. */
  renderOnce(dt = 1 / 60): void {
    this.tick(dt, performance.now());
  }

  private resize(): void {
    const w = Math.max(1, innerWidth); // a hidden window can report 0; zero-sized buffers are invalid
    const h = Math.max(1, innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  private loop(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.tick(dt, now);
    this.adapt(dt);
  }

  private tick(dt: number, now: number): void {
    for (const fn of this.updaters) fn({ dt, time: now / 1000 });
    this.composer.render(dt);
  }

  /** Keep the frame rate: after ~1 s of frames under 40 fps, render at a lower pixel ratio. */
  private adapt(dt: number): void {
    if (document.hidden) return; // hidden windows are throttled on purpose; that isn't slowness
    this.slow = dt > 1 / 40 ? this.slow + 1 : 0;
    const ratio = this.renderer.getPixelRatio();
    if (this.slow > 45 && ratio > 1) {
      this.renderer.setPixelRatio(Math.max(1, ratio - 0.25));
      this.resize();
      this.slow = 0;
    }
  }
}
