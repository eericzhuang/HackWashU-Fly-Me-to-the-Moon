import * as THREE from "three";
import { unpackHeight } from "./math";

const SKY = "/sky/";
const loader = new THREE.TextureLoader();

export interface SkyAssets {
  moonColor: THREE.Texture;
  moonHeight: THREE.DataTexture;
  heightRangeKm: number;
  stars: number[][];
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`cannot load ${url}`));
    img.src = url;
  });
}

/** The 16-bit moon height map as a linear-filtered half-float texture (0..1 of the height range). */
async function loadHeight(url: string): Promise<THREE.DataTexture> {
  const img = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const values = unpackHeight(g.getImageData(0, 0, img.width, img.height).data, img.width, img.height);
  const half = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i++) half[i] = THREE.DataUtils.toHalfFloat(values[i]);
  const tex = new THREE.DataTexture(half, img.width, img.height, THREE.RedFormat, THREE.HalfFloatType);
  tex.wrapS = THREE.RepeatWrapping; // longitude wraps round the moon
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export async function loadSkyAssets(maxAnisotropy: number): Promise<SkyAssets> {
  const [moonColor, moonHeight, meta, stars] = await Promise.all([
    loader.loadAsync(`${SKY}moon_color.jpg`),
    loadHeight(`${SKY}moon_height.png`),
    fetch(`${SKY}moon_height.json`).then((r) => r.json() as Promise<{ minKm: number; maxKm: number }>),
    fetch(`${SKY}stars.json`).then((r) => r.json() as Promise<number[][]>),
  ]);
  moonColor.colorSpace = THREE.SRGBColorSpace;
  moonColor.anisotropy = maxAnisotropy;
  return { moonColor, moonHeight, heightRangeKm: meta.maxKm - meta.minKm, stars };
}

/** A scan image to look at (a photo, the reveal): an sRGB picture. */
export async function loadPhoto(url: string): Promise<THREE.Texture<HTMLImageElement>> {
  const t = await loader.loadAsync(url);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A scan photo used as a measurement (relighting): raw values, mipmapped so a coarse level is the flat-field blur. */
export async function loadMeasurement(url: string): Promise<THREE.Texture<HTMLImageElement>> {
  const t = await loader.loadAsync(url);
  t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
