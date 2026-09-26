import * as THREE from "three";
import type { SkyAssets } from "./assets";
import type { Frame } from "./engine";
import { ledSun, orbitSun } from "./math";

/** Sun behaviour (the dev panel tunes these live; shading lives in the uniforms). */
export const MOON = { tilt: 0.12, orbitSeconds: 8, turnSeconds: 1.5 };

const smooth = (t: number) => t * t * (3 - 2 * t);

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vPos;
  void main() {
    vUv = uv;
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform sampler2D colorMap;
  uniform sampler2D heightMap;
  uniform float heightRange;
  uniform vec2 texel;
  uniform vec3 sunObj;
  uniform vec3 camObj;
  uniform float exaggeration;
  uniform float exposure;
  uniform float earthshine;
  uniform int steps;
  uniform float reach;
  varying vec2 vUv;
  varying vec3 vPos;

  const float PI = 3.14159265359;
  const float R_KM = 1737.4;
  const float SUN_RADIUS = 0.0047; // radians

  float heightAt(vec2 uv) { return texture2D(heightMap, uv).r * heightRange * exaggeration / R_KM; }

  // inverse of three.js SphereGeometry: x = -cos(phi) sin(theta), y = cos(theta), z = sin(phi) sin(theta)
  vec2 uvOf(vec3 p) {
    float theta = acos(clamp(p.y, -1.0, 1.0));
    float phi = atan(p.z, -p.x);
    return vec2(fract(phi / (2.0 * PI)), 1.0 - theta / PI);
  }

  void main() {
    vec3 up = normalize(vPos);
    vec3 east = normalize(vec3(up.z, 0.0, -up.x) + vec3(1e-5, 0.0, 0.0));
    vec3 north = cross(up, east);
    float cosLat = max(cos((vUv.y - 0.5) * PI), 0.05);

    float h0 = heightAt(vUv);
    float dhE = (heightAt(vUv + vec2(texel.x, 0.0)) - heightAt(vUv - vec2(texel.x, 0.0))) / (4.0 * PI * texel.x * cosLat);
    float dhN = (heightAt(vUv + vec2(0.0, texel.y)) - heightAt(vUv - vec2(0.0, texel.y))) / (2.0 * PI * texel.y);

    vec3 L = normalize(sunObj);
    vec3 V = normalize(camObj - up);
    // relief normals turn noisy where the surface is seen edge-on: fade them out toward the limb
    vec3 N = normalize(mix(up - dhE * east - dhN * north, up, smoothstep(0.35, 0.05, dot(up, V))));
    vec3 albedo = texture2D(colorMap, vUv).rgb;

    // Lommel-Seeliger: regolith isn't Lambertian, which is why the full moon looks flat
    float mu0 = dot(N, L);
    float mu = max(dot(N, V), 0.0);
    float ls = mu0 > 0.0 ? mu0 / (mu0 + mu + 1e-4) : 0.0;

    // cast shadows: march toward the sun over the curved surface
    float vis = 1.0;
    float sinE = dot(L, up);
    if (sinE < -0.2) {
      vis = 0.0;
    } else if (mu0 > 0.0 && steps > 0) {
      vec3 Lt = L - up * sinE;
      float lenT = length(Lt);
      if (lenT > 1e-4) {
        vec3 dir = Lt / lenT;
        float tanE = sinE / lenT;
        for (int i = 1; i <= 64; i++) {
          if (i > steps) break;
          float f = float(i) / float(steps);
          float t = reach * f * f;
          vec3 p = up * cos(t) + dir * sin(t);
          float terrain = heightAt(uvOf(p)) - 0.5 * t * t;
          float ray = h0 + t * tanE;
          vis = min(vis, clamp((ray - terrain) / (t * SUN_RADIUS * 2.0) + 0.5, 0.0, 1.0));
          if (vis <= 0.0) break;
        }
      }
    }

    float phase = acos(clamp(dot(L, V), -1.0, 1.0));
    // with the sun behind the viewer every shadow hides behind the rock that casts it
    vis = mix(1.0, vis, smoothstep(0.1, 0.6, phase));
    float surge = 1.0 + 0.35 * exp(-phase / 0.06); // opposition surge
    gl_FragColor = vec4(albedo * (ls * vis * surge * exposure + earthshine * mu), 1.0);
  }`;

/** The moon from NASA LRO colour and LOLA heights, with the sun where the lit LED is. */
export class Moon {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly sun = new THREE.Vector3(0, 0, 1); // world space
  private readonly from = new THREE.Vector3(0, 0, 1);
  private readonly to = new THREE.Vector3(0, 0, 1);
  private t = 1;
  private seconds = MOON.turnSeconds;
  private mode: "full" | "led" | "orbit" = "full";
  private angle = 0;
  private readonly inverse = new THREE.Quaternion();
  private readonly scratch = new THREE.Vector3();

  constructor(a: SkyAssets) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        colorMap: { value: a.moonColor },
        heightMap: { value: a.moonHeight },
        heightRange: { value: a.heightRangeKm },
        texel: { value: new THREE.Vector2(1 / a.moonHeight.image.width, 1 / a.moonHeight.image.height) },
        sunObj: { value: new THREE.Vector3(0, 0, 1) },
        camObj: { value: new THREE.Vector3(0, 0, 7) },
        exaggeration: { value: 5 },
        exposure: { value: 2.6 },
        earthshine: { value: 0.025 },
        steps: { value: 40 },
        reach: { value: 0.12 },
      },
      vertexShader,
      fragmentShader,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), material);
    this.mesh.rotation.y = -Math.PI / 2; // texture centre (longitude 0, the near side) faces the camera
  }

  get uniforms(): Record<string, THREE.IUniform> {
    return this.mesh.material.uniforms;
  }

  /** Sun behind the viewer: the flat, featureless full moon — the page that looks blank. */
  showFull(seconds = MOON.turnSeconds): void {
    this.mode = "full";
    this.turn(seconds);
  }

  /** Light from LED `led`'s side: a quarter moon whose terminator runs through the middle. */
  lightFrom(led: number, seconds = MOON.turnSeconds): void {
    this.mode = "led";
    this.to.set(...ledSun(led, MOON.tilt));
    this.turn(seconds);
  }

  /** The sun keeps circling the moon (while the photos are combined). */
  orbit(): void {
    this.mode = "orbit";
    this.angle = Math.atan2(this.sun.y, this.sun.x);
  }

  /** Jump a running turn of the sun to its end. */
  finishTurn(): void {
    this.t = 1;
  }

  update(f: Frame, camera: THREE.Camera): void {
    if (this.mode === "orbit") {
      this.angle += (f.dt * 2 * Math.PI) / MOON.orbitSeconds;
      this.sun.set(...orbitSun(this.angle, MOON.tilt));
    } else {
      if (this.mode === "full") this.to.copy(camera.position).normalize();
      this.t = Math.min(1, this.t + f.dt / this.seconds);
      this.sun.copy(this.from).lerp(this.to, smooth(this.t)).normalize();
    }
    this.mesh.rotation.y = -Math.PI / 2 + 0.1 * Math.sin(f.time * 0.15); // a slow, libration-like sway
    this.mesh.updateMatrixWorld();
    this.inverse.copy(this.mesh.quaternion).invert();
    this.uniforms.sunObj.value.copy(this.sun).applyQuaternion(this.inverse);
    this.uniforms.camObj.value.copy(this.mesh.worldToLocal(this.scratch.copy(camera.position)));
  }

  private turn(seconds: number): void {
    this.from.copy(this.sun);
    this.seconds = Math.max(seconds, 1e-3);
    this.t = seconds > 0 ? 0 : 1;
  }
}
