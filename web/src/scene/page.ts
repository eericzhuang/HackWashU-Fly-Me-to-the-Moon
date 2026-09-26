import gsap from "gsap";
import * as THREE from "three";
import type { Word } from "../../shared/types";
import type { DoneUrls } from "../feed/types";
import { loadMeasurement, loadPhoto } from "./assets";
import { fitSize, type Vec3 } from "./math";
import { highlightBoxes, renderBoxes } from "./wordBoxes";

/** Framing of the sheet in front of the camera (world units / fractions of the view). */
export const PAGE = { distance: 3, widthFraction: 0.8, heightFraction: 0.66, lift: 0.04 };

const vertexShader = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D revealMap;
  uniform sampler2D d0, d1, d2, d3;
  uniform float relit;
  uniform float opacity;
  uniform vec3 sun;
  uniform float relief, sharpLod, blurLod, exposure;
  uniform vec3 paper;
  in vec2 vUv;
  out vec4 fragColor;

  float ff(sampler2D t) { return textureLod(t, vUv, sharpLod).r / max(textureLod(t, vUv, blurLod).r, 0.02); }

  void main() {
    vec3 color = paper * texture(revealMap, vUv).r * exposure;
    if (relit > 0.0) {
      float rN = ff(d0), rE = ff(d1), rS = ff(d2), rW = ff(d3);
      vec2 slope = relief * vec2(rE - rW, rN - rS);
      float albedo = 0.25 * (rN + rE + rS + rW);
      float horizontal = length(sun.xy);
      float shade = 1.0 + dot(slope, sun.xy / max(horizontal, 1e-4)) * horizontal / max(sun.z, 0.03);
      vec3 lit = paper * albedo * clamp(shade, 0.04, 2.5) * exposure;
      color = mix(color, lit, relit);
    }
    fragColor = vec4(color, opacity);
  }`;

function div(cls: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  return d;
}

/** The revealed page: a sheet in front of the camera with word boxes over it. */
export class PageView {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly words = div("words");
  private readonly boxes = div("boxes");
  private revealUrl = "";
  private imageSize: [number, number] = [2, 1];
  private dirsReady = false;
  private gen = 0;
  private anims: gsap.core.Animation[] = [];
  private measurementsReady: (() => void) | null = null;

  constructor(camera: THREE.Camera, domRoot: HTMLElement) {
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        revealMap: { value: null }, d0: { value: null }, d1: { value: null }, d2: { value: null }, d3: { value: null },
        relit: { value: 0 }, opacity: { value: 0 },
        sun: { value: new THREE.Vector3(0, 1, 0.2).normalize() },
        relief: { value: 1 }, sharpLod: { value: 1.5 }, blurLod: { value: 6 }, exposure: { value: 0.72 },
        paper: { value: new THREE.Color(0.96, 0.93, 0.86) },
      },
      vertexShader, fragmentShader, transparent: true, depthTest: false, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    this.mesh.position.z = -PAGE.distance;
    camera.add(this.mesh);
    this.words.append(this.boxes);
    domRoot.append(this.words);
  }

  get uniforms(): Record<string, THREE.IUniform> { return this.mesh.material.uniforms; }
  shows(url: string): boolean { return this.revealUrl === url; }

  onMeasurementsReady(callback: () => void): void { this.measurementsReady = callback; }

  async load(urls: DoneUrls): Promise<void> {
    const gen = ++this.gen;
    this.revealUrl = "";
    this.dirsReady = false;
    this.mesh.visible = false;
    this.uniforms.opacity.value = 0;
    this.uniforms.relit.value = 0;
    this.words.classList.remove("on");
    this.clearTextures();
    this.imageSize = [2, 1];
    try {
      const reveal = await loadPhoto(urls.reveal);
      if (gen !== this.gen) return void reveal.dispose();
      this.swap("revealMap", reveal);
      this.imageSize = [reveal.image.width, reveal.image.height];
      this.revealUrl = urls.reveal;
    } catch (e) {
      console.warn("reveal image failed to load:", e);
      if (gen === this.gen) this.clearTextures();
      return;
    }
    if (urls.dirs.length !== 4) return;
    void Promise.allSettled(urls.dirs.map(loadMeasurement)).then((results) => {
      const photos = results.flatMap((r) => r.status === "fulfilled" ? [r.value] : []);
      if (gen !== this.gen) return photos.forEach((t) => t.dispose());
      const failure = results.find((r) => r.status === "rejected");
      if (failure?.status === "rejected") {
        photos.forEach((t) => t.dispose());
        console.warn("photos for relighting failed to load:", failure.reason);
        return;
      }
      photos.forEach((t, k) => this.swap(`d${k}`, t));
      this.dirsReady = true;
      this.measurementsReady?.();
    });
  }

  show(seconds: number): void {
    this.mesh.visible = true;
    this.words.classList.add("on");
    this.track(gsap.to(this.uniforms.opacity, { value: 1, duration: seconds }));
  }

  hide(): void {
    this.gen++;
    for (const a of this.anims) a.kill();
    this.anims = [];
    this.mesh.visible = false;
    this.uniforms.opacity.value = 0;
    this.uniforms.relit.value = 0;
    this.words.classList.remove("on");
    this.boxes.replaceChildren();
    this.revealUrl = "";
    this.dirsReady = false;
    this.clearTextures();
    this.imageSize = [2, 1];
  }

  relight(seconds: number): boolean {
    if (!this.dirsReady) return false;
    this.words.classList.remove("on");
    this.track(gsap.to(this.uniforms.relit, { value: 1, duration: seconds }));
    return true;
  }

  setSun(v: Vec3): void { (this.uniforms.sun.value as THREE.Vector3).set(v[0], v[1], v[2]); }
  showWords(words: Word[], confident: number[]): void { renderBoxes(this.boxes, words, confident, this.imageSize[0], this.imageSize[1]); }
  highlight(index: number | null): void { highlightBoxes(this.boxes, index); }

  skip(): void {
    const running = this.anims;
    this.anims = [];
    for (const a of running) a.progress(1);
  }

  layout(camera: THREE.PerspectiveCamera, width: number, height: number): { left: number; top: number; width: number; height: number } {
    const viewH = 2 * PAGE.distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const viewW = viewH * camera.aspect;
    const [w, h] = fitSize(this.imageSize[0] / this.imageSize[1], viewW * PAGE.widthFraction, viewH * PAGE.heightFraction);
    this.mesh.scale.set(w, h, 1);
    this.mesh.position.y = viewH * PAGE.lift;
    const rect = { left: (width - (w / viewW) * width) / 2, top: 0, width: (w / viewW) * width, height: (h / viewH) * height };
    rect.top = height / 2 - PAGE.lift * height - rect.height / 2;
    Object.assign(this.words.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    return rect;
  }

  private swap(name: string, texture: THREE.Texture): void {
    (this.uniforms[name].value as THREE.Texture | null)?.dispose();
    this.uniforms[name].value = texture;
  }
  private clearTextures(): void {
    for (const name of ["revealMap", "d0", "d1", "d2", "d3"]) {
      (this.uniforms[name].value as THREE.Texture | null)?.dispose();
      this.uniforms[name].value = null;
    }
  }
  private track(a: gsap.core.Animation): void { this.anims.push(a); }
}
