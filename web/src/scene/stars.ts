import * as THREE from "three";
import type { Frame } from "./engine";
import { starBuffers } from "./math";

/** The Yale Bright Star Catalogue as twinkling points: the real sky, real star colours. */
export class Stars {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;

  constructor(rows: number[][]) {
    const b = starBuffers(rows, 90, 6.5);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(b.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(b.colors, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(b.sizes, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: { pixelRatio: { value: 1 }, time: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute vec3 color;
        uniform float pixelRatio;
        uniform float time;
        varying vec3 vColor;
        void main() {
          float twinkle = 0.85 + 0.15 * sin(time * 1.7 + position.x * 13.0 + position.y * 7.0);
          vColor = color * twinkle;
          gl_PointSize = size * pixelRatio;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
          gl_FragColor = vec4(vColor * a * a, 1.0);
        }`,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.rotation.set(0.4, 2.2, 0); // a pleasant patch of sky behind the moon
    this.points.frustumCulled = false;
  }

  update(f: Frame, pixelRatio: number): void {
    this.points.material.uniforms.time.value = f.time;
    this.points.material.uniforms.pixelRatio.value = pixelRatio;
  }
}
