# Web UI L1 (Light and 3D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CSS stand-in picture with a three.js scene: a real moon (NASA LRO/LOLA data, lunar Lommel–Seeliger shading, ray-marched terminator shadows) whose sun follows the lit LED, the real star sky, the photos as 3D cards, a dive toward the terminator, a sunrise onto the revealed page, and "hold the sun" — the page relit live from the four real photos, where the writing appears with a low sun and vanishes at noon.

**Architecture:** A new `ThreeStage` implements the existing `Stage` interface, so the Director, feeds, overlay, reader and voice are untouched (except that the stage now receives all done-URLs). `ThreeStage` composes focused modules: `Engine` (renderer + HDR post chain + frame loop), `Moon`, `Stars`, `PlateDeck`, `PageView` (with DOM word boxes over it) and `SunHandle` (pointer → sun). Pure math lives in `scene/math.ts` and `scene/sunFollower.ts` and is unit-tested in Node. `DomStage` stays as the `?stage=dom` fallback and is used when WebGL or the assets fail. Tasks 5–7 grow `ThreeStage` in steps: it first borrows the photos/page from `DomStage`, then takes them over, so the app works and can be looked at after every task.

**Tech Stack:** three 0.186.1, postprocessing 6.39.5, gsap 3.15.0, lil-gui 0.21.0, @fontsource/jost 5.3.0, @fontsource/jetbrains-mono 5.3.0, @types/three 0.186.0 (plus the L0 stack: Vite 8, TypeScript 7, Vitest 5).

**Spec:** `docs/superpowers/specs/2026-09-26-web-ui-design.md` §3–§4. Order change (user, 2026-09-26): visuals first. This plan = the spec's L1 visuals + L2's "hold the sun"; sound/Cloud TTS and the paper-terrain descent come in later plans. Both risky shaders (moon, relight) were proven in a scratchpad spike first; the code below is the spike's.

## Global Constraints

- Everything from the L0 plan still holds: never write to `out/`; the Google key stays server-side; offline except Google (all libraries from npm, all assets committed, no CDN); LED index → direction `0 = north (top)`, `1 = east (right)`, `2 = south (bottom)`, `3 = west (left)`; TypeScript strict with `verbatimModuleSyntax` (`import type` for types); commit messages are plain sentences; never pass `-n`/`--no-verify` to git and run `git commit` as its own command.
- Exact versions: `three@0.186.1`, `postprocessing@6.39.5`, `gsap@3.15.0`, `lil-gui@0.21.0`, `@fontsource/jost@5.3.0`, `@fontsource/jetbrains-mono@5.3.0`, dev `@types/three@0.186.0`.
- Sky assets live in `web/public/sky/` (served as `/sky/...`): `moon_color.jpg`, `moon_height.png`, `moon_height.json`, `stars.json`, `CREDITS.md`. Credit: "NASA's Scientific Visualization Studio".
- The screen is a light source: while a scan is capturing/combining the whole WebGL frame is multiplied by `STAGE.captureDim` (default `0.45`); the reveal is a 1.5 s "sunrise" back to `1`.
- `?stage=dom` must keep the L0 CSS stage working, and any failure creating the 3D stage must fall back to it.
- WebGL code has no unit tests (Node has no WebGL); visual results are checked by the controller in the in-app browser. Every pure helper gets Vitest tests.
- Run commands from `web/` unless noted.

---

## File Structure

```
web/
  public/sky/                moon_color.jpg, moon_height.png, moon_height.json, stars.json, CREDITS.md
  tools/prepare_moon_assets.py   how the sky assets were built (documented, rerunnable)
  index.html                 + <div id="gl"> under #stage
  src/main.ts                picks ThreeStage (or DomStage), fonts, D = tuning panel
  src/style.css              + 3D layering, word layer, held sun
  src/scene/math.ts          pure: sun directions, pointer->sun, height unpacking, star buffers, card sizes, spiral, angles
  src/scene/sunFollower.ts   pure: the held sun's inertia and idle orbit
  src/scene/assets.ts        texture/JSON loaders (sky, photos, measurements)
  src/scene/engine.ts        renderer, camera, HDR post chain + GainEffect, frame loop, adaptive pixel ratio
  src/scene/moon.ts          moon mesh + shader, sun state (full / LED side / orbit)
  src/scene/stars.ts         star points
  src/scene/plates.ts        PlateDeck: photo cards (close-up, park, spiral in)
  src/scene/wordBoxes.ts     word boxes DOM helpers (shared by DomStage and PageView)
  src/scene/page.ts          PageView: reveal sheet + relight shader + word layer
  src/scene/sunHandle.ts     SunHandle: pointer -> SunFollower, the sun glyph and hint
  src/scene/threeStage.ts    ThreeStage implements Stage
  src/scene/domStage.ts      (modified) DoneUrls signatures, uses wordBoxes
  src/show/director.ts       (modified) Stage.descent/reveal receive DoneUrls
  src/show/keys.ts           (modified) D -> dev panel
  src/dev/devPanel.ts        lil-gui tuning panel
  test/assets.test.ts, test/scene/math.test.ts, test/scene/sunFollower.test.ts, test/show/*.test.ts (modified)
```

---

### Task 1: Dependencies, sky assets, fonts

**Files:**
- Create: `web/public/sky/moon_color.jpg`, `web/public/sky/moon_height.png`, `web/public/sky/moon_height.json`, `web/public/sky/stars.json` (copied), `web/public/sky/CREDITS.md`, `web/tools/prepare_moon_assets.py`
- Modify: `web/package.json`, `web/package-lock.json` (npm), `web/src/main.ts` (font imports)
- Test: `web/test/assets.test.ts`

**Interfaces:**
- Produces: URLs `/sky/moon_color.jpg` (4096x2048 sRGB JPEG), `/sky/moon_height.png` (2048x1024 RGB; 16-bit height = R*256+G, rows top-down), `/sky/moon_height.json` (`{"minKm","maxKm","width","height"}`), `/sky/stars.json` (`[[raDeg, decDeg, vmag, tempK], ...]`); font families `Jost` (400/500/600) and `JetBrains Mono` (400).

- [ ] **Step 1: Install the packages**

Run: `npm install three@0.186.1 postprocessing@6.39.5 gsap@3.15.0 lil-gui@0.21.0 @fontsource/jost@5.3.0 @fontsource/jetbrains-mono@5.3.0`
Run: `npm install -D @types/three@0.186.0`
Expected: both succeed; `package.json` lists them.

- [ ] **Step 2: Copy the prepared sky assets**

The controller already built them (scratchpad spike). From the repo root:
```bash
mkdir -p web/public/sky
cp "/c/Users/alexa/AppData/Local/Temp/claude/D--vscode-projects-HackWashU-Fly-Me-to-the-Moon/265b5f46-c2ff-4052-abfb-0f278ec5bb33/scratchpad/spike/public/assets/"{moon_color.jpg,moon_height.png,moon_height.json,stars.json} web/public/sky/
ls -la web/public/sky
```
Expected: four files, about 2.3 MB, 3.7 MB, 67 B, 240 KB.

`web/public/sky/CREDITS.md`:
```markdown
# Credits

- Moon colour and elevation maps: NASA's Scientific Visualization Studio, CGI Moon Kit
  (https://svs.gsfc.nasa.gov/4720), from LRO LROC and LOLA data.
- Stars: Yale Bright Star Catalogue (BSC5), via https://github.com/brettonw/YaleBrightStarCatalog (MIT).
- Fonts (npm @fontsource): Jost and JetBrains Mono, SIL Open Font License 1.1.

Built with `web/tools/prepare_moon_assets.py`.
```

- [ ] **Step 3: Write the failing asset test**

`web/test/assets.test.ts`:
```ts
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sky = (file: string) => new URL(`../public/sky/${file}`, import.meta.url);

describe("committed sky assets", () => {
  it("the height map is a 2048x1024 PNG and its metadata covers the lunar relief", () => {
    const meta = JSON.parse(readFileSync(sky("moon_height.json"), "utf8"));
    expect(meta).toMatchObject({ width: 2048, height: 1024 });
    expect(meta.minKm).toBeLessThan(-8);
    expect(meta.maxKm).toBeGreaterThan(10);
    const png = readFileSync(sky("moon_height.png"));
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(2048); // IHDR width
    expect(png.readUInt32BE(20)).toBe(1024); // IHDR height
  });

  it("star rows are [raDeg, decDeg, vmag, kelvin]", () => {
    const stars = JSON.parse(readFileSync(sky("stars.json"), "utf8")) as number[][];
    expect(stars.length).toBeGreaterThan(9000);
    for (const [ra, dec, vmag, kelvin] of stars) {
      expect(ra).toBeGreaterThanOrEqual(0);
      expect(ra).toBeLessThan(360);
      expect(Math.abs(dec)).toBeLessThanOrEqual(90);
      expect(vmag).toBeGreaterThan(-2);
      expect(vmag).toBeLessThan(9);
      expect(kelvin).toBeGreaterThan(1000);
    }
  });

  it("the colour map is a JPEG under 3 MB", () => {
    const jpg = readFileSync(sky("moon_color.jpg"));
    expect([jpg[0], jpg[1]]).toEqual([0xff, 0xd8]);
    expect(statSync(sky("moon_color.jpg")).size).toBeLessThan(3_000_000);
  });
});
```

- [ ] **Step 4: Run it**

Run: `npx vitest run test/assets.test.ts`
Expected: PASS (3 tests) — the assets were copied in Step 2. (If you run this before Step 2 it fails with ENOENT; that is the red state.)

- [ ] **Step 5: Add the asset builder script (documentation of how the assets were made)**

`web/tools/prepare_moon_assets.py`:
```python
"""Build the moon and star assets in web/public/sky/ (run once; the outputs are committed).

Inputs, downloaded into one folder (e.g. raw/):
  lroc_color_poles_4k.tif  https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_4k.tif
  ldem_16_uint.tif         https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16_uint.tif
  bsc5-short.json          https://brettonw.github.io/YaleBrightStarCatalog/bsc5-short.json
Convert the colour TIFF to raw/lroc_color_4k.jpg (quality ~92) first: Pillow may crash decoding its LZW RGB
data. Windows: PowerShell TiffBitmapDecoder -> JpegBitmapEncoder. macOS: sips -s format jpeg.

  python web/tools/prepare_moon_assets.py raw web/public/sky

Outputs:
  moon_color.jpg    4096x2048 sRGB (copied)
  moon_height.png   2048x1024; 16-bit height packed into R (high byte) + G (low byte), rows top-down
  moon_height.json  {"minKm", "maxKm", "width", "height"}
  stars.json        [[raDeg, decDeg, vmag, tempK], ...]
LDEM "uint" values are half-metres offset by 20000: elevation_m = (value - 20000) / 2.
"""
import argparse
import json
import re
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
W, H = 2048, 1024


def resample_axis(a: np.ndarray, n: int, axis: int, wrap: bool) -> np.ndarray:
    """Linear resample along one axis to n samples, pixel centres aligned."""
    m = a.shape[axis]
    x = (np.arange(n) + 0.5) * m / n - 0.5
    if wrap:
        i0 = np.floor(x).astype(int) % m
        i1 = (i0 + 1) % m
    else:
        x = np.clip(x, 0, m - 1)
        i0 = np.floor(x).astype(int)
        i1 = np.minimum(i0 + 1, m - 1)
    t = (x - np.floor(x)).astype(np.float32)
    shape = [1, 1]
    shape[axis] = n
    t = t.reshape(shape)
    return np.take(a, i0, axis=axis) * (1 - t) + np.take(a, i1, axis=axis) * t


def height_map(raw: Path, out: Path) -> None:
    dem = Image.open(raw / "ldem_16_uint.tif")
    dem.load()
    w0, h0 = dem.size
    # np.frombuffer, not np.array(image): the latter crashed with some numpy/Pillow builds
    km = (np.frombuffer(dem.tobytes(), dtype=np.uint16).reshape(h0, w0).astype(np.float32) - 20000.0) * 0.0005
    km = km.reshape(h0 // 2, 2, w0 // 2, 2).mean(axis=(1, 3))
    km = resample_axis(km, W, axis=1, wrap=True)   # longitude wraps
    km = resample_axis(km, H, axis=0, wrap=False)  # latitude clamps
    lo, hi = float(km.min()), float(km.max())
    q = np.round((km - lo) / (hi - lo) * 65535.0).astype(np.uint32)
    rgb = np.zeros((H, W, 3), dtype=np.uint8)
    rgb[..., 0] = (q >> 8).astype(np.uint8)
    rgb[..., 1] = (q & 255).astype(np.uint8)
    Image.frombytes("RGB", (W, H), rgb.tobytes()).save(out / "moon_height.png", optimize=True)
    (out / "moon_height.json").write_text(json.dumps({"minKm": round(lo, 4), "maxKm": round(hi, 4), "width": W, "height": H}))


def star_table(raw: Path, out: Path) -> None:
    num = re.compile(r"[-+]?\d+(?:\.\d+)?")
    rows = []
    for s in json.loads((raw / "bsc5-short.json").read_text(encoding="utf-8")):
        try:
            rh, rm, rs = (float(v) for v in num.findall(s["RA"])[:3])
            d = [float(v) for v in num.findall(s["Dec"])[:3]]
            sign = -1.0 if s["Dec"].strip().startswith("-") else 1.0
            dec = sign * (abs(d[0]) + d[1] / 60 + d[2] / 3600)
            rows.append([round((rh + rm / 60 + rs / 3600) * 15.0, 3), round(dec, 3), round(float(s["V"]), 2), int(float(s.get("K") or 6000))])
        except (KeyError, ValueError, IndexError):
            continue
    (out / "stars.json").write_text(json.dumps(rows, separators=(",", ":")))


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("raw", type=Path)
    p.add_argument("out", type=Path)
    a = p.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(a.raw / "lroc_color_4k.jpg", a.out / "moon_color.jpg")
    height_map(a.raw, a.out)
    star_table(a.raw, a.out)
    print("wrote", sorted(f.name for f in a.out.iterdir()))


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Load the fonts**

In `web/src/main.ts`, directly below the first line `import "./style.css";`, add:
```ts
import "@fontsource/jost/400.css";
import "@fontsource/jost/500.css";
import "@fontsource/jost/600.css";
import "@fontsource/jetbrains-mono/400.css";
```
(`style.css` already names `Jost` and `"JetBrains Mono"` first in `--font` / `--mono`.)

- [ ] **Step 7: Verify and commit**

Run: `npm test && npm run typecheck && npm run build`
Expected: all tests pass (64), typecheck clean, build succeeds; `ls dist/sky` shows the four assets and `ls dist/assets` contains `.woff2` font files.

```bash
git add web/package.json web/package-lock.json web/public/sky web/tools/prepare_moon_assets.py web/test/assets.test.ts web/src/main.ts
git commit -m "Moon, star and font assets for the 3D stage"
```

---

### Task 2: Pure scene math

**Files:**
- Create: `web/src/scene/math.ts`, `web/src/scene/sunFollower.ts`
- Test: `web/test/scene/math.test.ts`, `web/test/scene/sunFollower.test.ts`

**Interfaces:**
- Produces (`math.ts`): `type Vec3 = [number, number, number]`, `normalize(v)`, `ledSun(led, towardViewer): Vec3`, `orbitSun(angle, towardViewer): Vec3`, `pointerToSun(px, py, cx, cy, radius, minElevationDeg): {azimuth, elevation}` (radians), `sunVector(azimuth, elevation): Vec3`, `wrapAngle(a)`, `unpackHeight(rgba, width, height): Float32Array`, `kelvinToRgb(k): Vec3`, `interface StarBuffers {positions, colors, sizes, count}`, `starBuffers(rows, radius, maxMagnitude): StarBuffers`, `fitSize(aspect, maxW, maxH): [number, number]`, `PLATE_SLOTS: Vec3[]`, `spiral(start, p, turns): Vec3`.
- Produces (`sunFollower.ts`): `SUN = { minElevationDeg: 4, idleSeconds: 6, orbitDegPerSecond: 20, autoElevationDeg: 9, follow: 6 }`, `class SunFollower { azimuth; elevation; point(px, py, cx, cy, radius): void; step(dt): Vec3 }`.

- [ ] **Step 1: Write the failing tests**

`web/test/scene/math.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  fitSize, kelvinToRgb, ledSun, normalize, orbitSun, PLATE_SLOTS, pointerToSun, spiral, starBuffers, sunVector,
  unpackHeight, wrapAngle,
} from "../../src/scene/math";

const close = (a: number[], b: number[], digits = 4) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
const DEG = Math.PI / 180;

describe("sun directions", () => {
  it("each LED lights the moon from its side, tilted toward the viewer", () => {
    close(ledSun(0, 0), [0, 1, 0]);
    close(ledSun(1, 0), [1, 0, 0]);
    close(ledSun(2, 0), [0, -1, 0]);
    close(ledSun(3, 0), [-1, 0, 0]);
    close(ledSun(0, 0.12), normalize([0, 1, 0.12]));
  });

  it("the orbiting sun goes counter-clockwise from +x", () => {
    close(orbitSun(Math.PI / 2, 0), [0, 1, 0]);
  });
});

describe("pointerToSun", () => {
  it("the page centre is noon, the rim is grazing, beyond the rim clamps", () => {
    expect(pointerToSun(400, 300, 400, 300, 200, 4).elevation).toBeCloseTo(90 * DEG);
    const rim = pointerToSun(600, 300, 400, 300, 200, 4);
    expect(rim.azimuth).toBeCloseTo(0);
    expect(rim.elevation).toBeCloseTo(4 * DEG);
    expect(pointerToSun(900, 300, 400, 300, 200, 4).elevation).toBeCloseTo(4 * DEG);
  });

  it("screen y points down, so a pointer above the centre is north", () => {
    expect(pointerToSun(400, 100, 400, 300, 200, 4).azimuth).toBeCloseTo(Math.PI / 2);
  });
});

describe("sunVector and wrapAngle", () => {
  it("azimuth 90deg at the horizon is north; elevation 90deg is straight up", () => {
    close(sunVector(Math.PI / 2, 0), [0, 1, 0]);
    close(sunVector(1.234, Math.PI / 2), [0, 0, 1]);
  });

  it("wraps into (-pi, pi]", () => {
    expect(wrapAngle(0)).toBeCloseTo(0);
    expect(wrapAngle(1.5 * Math.PI)).toBeCloseTo(-0.5 * Math.PI);
    expect(wrapAngle(-1.5 * Math.PI)).toBeCloseTo(0.5 * Math.PI);
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI);
  });
});

describe("unpackHeight", () => {
  it("reads R*256+G and flips the rows bottom-up", () => {
    // 2x2 RGBA, rows top-down: top = (255,255) (0,0), bottom = (128,0) (0,1)
    const rgba = [255, 255, 0, 255, 0, 0, 0, 255, 128, 0, 0, 255, 0, 1, 0, 255];
    close(Array.from(unpackHeight(rgba, 2, 2)), [(128 * 256) / 65535, 1 / 65535, 1, 0], 6);
  });
});

describe("stars", () => {
  it("black-body colours: 6600 K is white, 3000 K is orange", () => {
    close(kelvinToRgb(6600), [1, 1, 1], 2);
    const [r, g, b] = kelvinToRgb(3000);
    expect(r).toBe(1);
    expect(g).toBeGreaterThan(b);
    expect(b).toBeLessThan(0.5);
  });

  it("keeps stars up to the magnitude limit, on the sphere, bright ones bigger", () => {
    const s = starBuffers([[0, 0, 1, 6600], [90, 0, 7, 6600]], 90, 6.5);
    expect(s.count).toBe(1);
    close(Array.from(s.positions), [90, 0, 0]);
    expect(s.sizes[0]).toBeCloseTo(2 + 3.5 * (5.5 / 7));
  });
});

describe("photo cards", () => {
  it("fits a picture inside a box", () => {
    close(fitSize(2, 1.3, 0.62), [1.24, 0.62]);
    close(fitSize(0.75, 1.3, 0.62), [0.465, 0.62]);
    close(fitSize(3, 1.3, 0.62), [1.3, 1.3 / 3]);
  });

  it("parks each photo on its LED's side of the moon", () => {
    expect(PLATE_SLOTS[0][1]).toBeGreaterThan(1); // north: above
    expect(PLATE_SLOTS[1][0]).toBeGreaterThan(1); // east: right
    expect(PLATE_SLOTS[2][1]).toBeLessThan(-1); // south: below
    expect(PLATE_SLOTS[3][0]).toBeLessThan(-1); // west: left
  });

  it("spirals from the slot into the centre", () => {
    const start: [number, number, number] = [2, 0, 0.4];
    close(spiral(start, 0, 0.75), start);
    close(spiral(start, 1, 0.75), [0, 0, 0]);
    expect(Math.hypot(...spiral(start, 0.5, 0.75).slice(0, 2))).toBeCloseTo(2 * Math.pow(0.5, 1.5));
  });
});
```

`web/test/scene/sunFollower.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { SUN, SunFollower } from "../../src/scene/sunFollower";

const DEG = Math.PI / 180;

describe("SunFollower", () => {
  it("starts circling low on its own", () => {
    const s = new SunFollower();
    const a0 = s.azimuth;
    s.step(1);
    expect(s.azimuth - a0).toBeCloseTo(SUN.orbitDegPerSecond * DEG, 1);
    expect(s.elevation).toBeCloseTo(SUN.autoElevationDeg * DEG, 3);
  });

  it("follows the pointer: the page centre raises the sun to noon", () => {
    const s = new SunFollower();
    s.point(400, 300, 400, 300, 200);
    for (let i = 0; i < 120; i++) s.step(1 / 60);
    expect(s.elevation).toBeCloseTo(90 * DEG, 2);
  });

  it("goes back to circling after SUN.idleSeconds without the pointer", () => {
    const s = new SunFollower();
    s.point(400, 300, 400, 300, 200);
    for (let i = 0; i < 60 * (SUN.idleSeconds + 2); i++) s.step(1 / 60);
    expect(s.elevation).toBeCloseTo(SUN.autoElevationDeg * DEG, 2);
  });

  it("takes the short way round across +-pi", () => {
    const s = new SunFollower();
    s.point(400 - 200, 300 - 20, 400, 300, 200); // just north of west: azimuth ~ +174deg
    for (let i = 0; i < 120; i++) s.step(1 / 60);
    const before = s.azimuth;
    s.point(400 - 200, 300 + 20, 400, 300, 200); // just south of west: azimuth ~ -174deg
    s.step(1 / 60);
    expect(Math.abs(Math.atan2(Math.sin(s.azimuth - before), Math.cos(s.azimuth - before)))).toBeLessThan(12 * DEG);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/scene`
Expected: FAIL — `../../src/scene/math` and `../../src/scene/sunFollower` cannot be resolved.

- [ ] **Step 3: Implement `web/src/scene/math.ts`**

```ts
/** Pure helpers for the three.js stage. No three.js import, so they run (and are tested) in Node. */

export type Vec3 = [number, number, number];

export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

const SIDES: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]]; // LED 0..3 = N, E, S, W

/** Sun direction (world: x right, y up, z toward the viewer) while LED `led` is lit: the light comes from that
 *  side, tilted a little toward the viewer so slightly more than half the moon is lit. */
export function ledSun(led: number, towardViewer: number): Vec3 {
  const [x, y] = SIDES[led] ?? SIDES[0];
  return normalize([x, y, towardViewer]);
}

/** Sun going round the moon while the photos are combined; angle from +x, counter-clockwise. */
export function orbitSun(angle: number, towardViewer: number): Vec3 {
  return normalize([Math.cos(angle), Math.sin(angle), towardViewer]);
}

/** The held sun from a pointer: the angle round the page centre is the azimuth (0 = east/right, counter-
 *  clockwise; screen y points down); the distance sets the height, noon at the centre and grazing at
 *  `minElevationDeg` from `radius` outward. Radians. */
export function pointerToSun(
  px: number, py: number, cx: number, cy: number, radius: number, minElevationDeg: number,
): { azimuth: number; elevation: number } {
  const dx = px - cx;
  const dy = cy - py;
  const r = Math.min(1, Math.hypot(dx, dy) / Math.max(radius, 1));
  const elevationDeg = 90 - (90 - minElevationDeg) * r;
  return { azimuth: Math.atan2(dy, dx), elevation: (elevationDeg * Math.PI) / 180 };
}

/** Unit sun vector over the page (x east/right, y north/up, z out of the page). */
export function sunVector(azimuth: number, elevation: number): Vec3 {
  const c = Math.cos(elevation);
  return [Math.cos(azimuth) * c, Math.sin(azimuth) * c, Math.sin(elevation)];
}

/** Angle wrapped into (-pi, pi]. */
export function wrapAngle(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t <= 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/** Heights packed by tools/prepare_moon_assets.py (R = high byte, G = low byte, RGBA pixels, rows top-down)
 *  -> 0..1 values with rows bottom-up, the order WebGL data textures use. */
export function unpackHeight(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const src = y * width * 4;
    const dst = (height - 1 - y) * width;
    for (let x = 0; x < width; x++) out[dst + x] = (rgba[src + x * 4] * 256 + rgba[src + x * 4 + 1]) / 65535;
  }
  return out;
}

/** Approximate colour (0..1) of a black body at `kelvin` (Tanner Helland's fit), for star colours. */
export function kelvinToRgb(kelvin: number): Vec3 {
  const t = kelvin / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  return [c(r), c(g), c(b)];
}

export interface StarBuffers {
  positions: Float32Array;
  colors: Float32Array; // colour x brightness
  sizes: Float32Array; // CSS pixels
  count: number;
}

/** Catalogue rows [raDeg, decDeg, vmag, tempK] -> points on a sphere of `radius`. */
export function starBuffers(rows: number[][], radius: number, maxMagnitude: number): StarBuffers {
  const keep = rows.filter((r) => r[2] <= maxMagnitude);
  const positions = new Float32Array(keep.length * 3);
  const colors = new Float32Array(keep.length * 3);
  const sizes = new Float32Array(keep.length);
  keep.forEach(([ra, dec, vmag, kelvin], i) => {
    const a = (ra * Math.PI) / 180;
    const d = (dec * Math.PI) / 180;
    positions.set([radius * Math.cos(d) * Math.cos(a), radius * Math.sin(d), radius * Math.cos(d) * Math.sin(a)], i * 3);
    const flux = Math.min(6, 0.35 + Math.pow(10, -0.4 * (vmag - 3.2)));
    const [r, g, b] = kelvinToRgb(kelvin);
    colors.set([r * flux, g * flux, b * flux], i * 3);
    sizes[i] = 2 + 3.5 * Math.min(1, Math.max(0, (maxMagnitude - vmag) / 7));
  });
  return { positions, colors, sizes, count: keep.length };
}

/** (w, h) of a picture with aspect w/h fitted inside maxW x maxH. */
export function fitSize(aspect: number, maxW: number, maxH: number): [number, number] {
  return aspect >= maxW / maxH ? [maxW, maxW / aspect] : [maxH * aspect, maxH];
}

/** Where each photo parks (world units; moon of radius 1 at the origin, camera at z = 7): its LED's side. */
export const PLATE_SLOTS: Vec3[] = [[0, 1.42, 0.4], [2.2, 0, 0.4], [0, -1.42, 0.4], [-2.2, 0, 0.4]];

/** Point on the spiral a parked photo follows into the moon; p runs 0..1. */
export function spiral(start: Vec3, p: number, turns: number): Vec3 {
  const angle = Math.atan2(start[1], start[0]) + p * turns * 2 * Math.PI;
  const r = Math.hypot(start[0], start[1]) * Math.pow(1 - p, 1.5);
  return [Math.cos(angle) * r, Math.sin(angle) * r, start[2] * (1 - p)];
}
```

- [ ] **Step 4: Implement `web/src/scene/sunFollower.ts`**

```ts
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
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/scene`
Expected: PASS (all math and SunFollower tests). If "starts circling low on its own" is off by a hair, do not loosen it — check `k` (with `follow = 6`, one 1 s step closes 99.75 % of the gap, so `toBeCloseTo(…, 1)` holds).

- [ ] **Step 6: Commit**

Run: `npm test && npm run typecheck` (all pass, clean), then:
```bash
git add web/src/scene/math.ts web/src/scene/sunFollower.ts web/test/scene/math.test.ts web/test/scene/sunFollower.test.ts
git commit -m "Pure math for the 3D stage: sun directions, held sun, stars, cards"
```

---

### Task 3: The stage receives every done-URL

**Files:**
- Modify: `web/src/show/director.ts`, `web/src/scene/domStage.ts`, `web/test/show/director.test.ts`

**Interfaces:**
- Changes: `Stage.descent(urls: DoneUrls): Promise<void>` and `Stage.reveal(urls: DoneUrls): Promise<void>` (was `revealUrl: string`); `DoneUrls` is `{ dirs: string[]; reveal: string }` from `src/feed/types.ts`. The relit page needs `urls.dirs` (the aligned photos).

- [ ] **Step 1: Make the tests expect the URLs object**

In `web/test/show/director.test.ts`, change the two assertions in "runs capture, descent, reveal, reading aloud, then hold":
- `expect(stage.descent).toHaveBeenCalledWith(DONE.urls.reveal);` → `expect(stage.descent).toHaveBeenCalledWith(DONE.urls);`
- `expect(stage.reveal).toHaveBeenCalledWith(DONE.urls.reveal);` → `expect(stage.reveal).toHaveBeenCalledWith(DONE.urls);`

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/show/director.test.ts`
Expected: FAIL — descent/reveal were called with the reveal URL string, not the object.

- [ ] **Step 3: Change the Stage interface and the Director (`web/src/show/director.ts`)**

1. Add to the imports: `import type { DoneUrls, FeedEvent } from "../feed/types";` (replacing the existing `import type { FeedEvent } from "../feed/types";`).
2. In `interface Stage`, replace the two members:
```ts
  /** Resolves when the move into the page is over. Gets every image of the finished scan. */
  descent(urls: DoneUrls): Promise<void>;
  /** Resolves once the clean reveal image is on screen. */
  reveal(urls: DoneUrls): Promise<void>;
```
3. In `handle`, `case "done":` becomes `void this.finish(e.name, e.urls);`
4. `private async finish(scan: string, revealUrl: string)` becomes `private async finish(scan: string, urls: DoneUrls)`, and its two stage calls become `this.stage.descent(urls)` and `this.stage.reveal(urls)` (inside the existing `bounded(...)` calls, unchanged otherwise).

- [ ] **Step 4: Update `web/src/scene/domStage.ts`**

1. Add `import type { DoneUrls } from "../feed/types";` below the existing type imports.
2. Replace `descent` and `reveal`:
```ts
  descent(urls: DoneUrls): Promise<void> {
    this.revealImg.src = urls.reveal; // start loading while the moon rushes in
    this.root.dataset.mode = "descent";
    return new Promise((resolve) => {
      const end = () => {
        clearTimeout(timer);
        this.endDescent = null;
        resolve();
      };
      const timer = setTimeout(end, DESCENT_MS);
      this.endDescent = end;
    });
  }

  async reveal(urls: DoneUrls): Promise<void> {
    if (this.revealImg.getAttribute("src") !== urls.reveal) this.revealImg.src = urls.reveal;
    await this.revealImg.decode().catch(() => {}); // a broken image must not stop the show
    this.root.dataset.mode = "reveal";
  }
```

- [ ] **Step 5: Verify and commit**

Run: `npm test && npm run typecheck`
Expected: all tests pass (the two changed assertions included), typecheck clean.
```bash
git add web/src/show/director.ts web/src/scene/domStage.ts web/test/show/director.test.ts
git commit -m "The stage gets every image of a finished scan, not just the reveal"
```

---

### Task 4: Engine, assets loader, moon and stars

**Files:**
- Create: `web/src/scene/engine.ts`, `web/src/scene/assets.ts`, `web/src/scene/moon.ts`, `web/src/scene/stars.ts`

**Interfaces:**
- Consumes: `unpackHeight`, `ledSun`, `orbitSun`, `starBuffers` (Task 2); `/sky/*` (Task 1).
- Produces:
  - `engine.ts`: `interface Frame { dt: number; time: number }`; `class GainEffect extends Effect { gain: number }`; `class Engine { renderer; scene; camera (PerspectiveCamera, fov 30, at (0,0,7), added to the scene); bloom: BloomEffect; frameGain: GainEffect; onFrame(fn): () => void; renderOnce(dt?): void }`
  - `assets.ts`: `interface SkyAssets { moonColor; moonHeight; heightRangeKm; stars }`, `loadSkyAssets(maxAnisotropy): Promise<SkyAssets>`, `loadPhoto(url): Promise<Texture<HTMLImageElement>>` (sRGB picture), `loadMeasurement(url): Promise<Texture<HTMLImageElement>>` (raw values, mipmapped). `Texture` is generic in @types/three 0.186; the `<HTMLImageElement>` is what makes `texture.image.width` type-check.
  - `moon.ts`: `MOON = { tilt: 0.12, orbitSeconds: 8, turnSeconds: 1.5 }`; `class Moon { mesh; uniforms; showFull(seconds?); lightFrom(led, seconds?); orbit(); finishTurn(); update(frame, camera) }` — uniforms `exaggeration` (5), `exposure` (2.6), `earthshine` (0.025), `steps` (40), `reach` (0.12) are tunable
  - `stars.ts`: `class Stars { points; update(frame, pixelRatio) }`

This task has no unit tests (WebGL); it is checked visually at the end of Task 5. Transcribe the shaders exactly — they were proven in the spike.

- [ ] **Step 1: Implement `web/src/scene/engine.ts`**

```ts
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
```

- [ ] **Step 2: Implement `web/src/scene/assets.ts`**

```ts
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
```

- [ ] **Step 3: Implement `web/src/scene/moon.ts`**

```ts
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
```

- [ ] **Step 4: Implement `web/src/scene/stars.ts`**

```ts
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
```

- [ ] **Step 5: Verify and commit**

Run: `npm test && npm run typecheck && npm run build`
Expected: tests pass, typecheck clean, build succeeds (the modules are not imported yet; typecheck still checks them).
```bash
git add web/src/scene/engine.ts web/src/scene/assets.ts web/src/scene/moon.ts web/src/scene/stars.ts
git commit -m "three.js engine with HDR post, the NASA moon and the real star sky"
```

---

### Task 5: ThreeStage, first version (3D moon and stars; photos and page still DOM)

**Files:**
- Create: `web/src/scene/threeStage.ts`
- Modify: `web/index.html`, `web/src/style.css`, `web/src/main.ts`

**Interfaces:**
- Consumes: `Engine`, `loadSkyAssets`, `Moon`, `Stars` (Task 4); `DomStage` (Task 3 signatures); `Stage`, `DoneUrls`.
- Produces: `STAGE = { captureDim: 0.45, descentSeconds: 1.5, sunriseSeconds: 1.5, relightSeconds: 1.2 }`; `class ThreeStage implements Stage { static create(glRoot, domRoot): Promise<ThreeStage>; engine; moon; renderOnce(dt?) }`; in dev builds `window.__terminator = { director, stage }`.

- [ ] **Step 1: Add the WebGL layer to `web/index.html`**

Replace the body's first line `<div id="stage"></div>` with:
```html
    <div id="gl"></div>
    <div id="stage"></div>
```

- [ ] **Step 2: Add the layering rules to `web/src/style.css`**

Append at the end of the file:
```css
/* ---------- 3D stage: the three.js canvas under the DOM stage ---------- */
#gl { position: fixed; inset: 0; }
#gl canvas { display: block; }
#stage.three, #stage.three[data-mode="reveal"], #stage.three[data-mode="hold"] { background: transparent; }
#stage.three .sky, #stage.three .moon { display: none; }
```

- [ ] **Step 3: Implement `web/src/scene/threeStage.ts` (first version)**

```ts
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
```

- [ ] **Step 4: Wire it into `web/src/main.ts`**

Replace the whole file with (fonts from Task 1 kept; the feed/keys wiring is unchanged except that the stage is created first):
```ts
import "./style.css";
import "@fontsource/jost/400.css";
import "@fontsource/jost/500.css";
import "@fontsource/jost/600.css";
import "@fontsource/jetbrains-mono/400.css";
import { HttpReader } from "./ai/reader";
import { BrowserVoice } from "./audio/voice";
import { ReplayFeed } from "./feed/replayFeed";
import { ScanFeed } from "./feed/scanFeed";
import type { FeedEvent } from "./feed/types";
import { DomStage } from "./scene/domStage";
import { ThreeStage } from "./scene/threeStage";
import { Director, type Stage } from "./show/director";
import { bindKeys } from "./show/keys";
import { DomOverlay } from "./ui/overlay";

// URL options:
//   ?replay=sim&pace=6000   play a finished scan folder as if live (development, or the backup demo)
//   ?scan=latest            which folder the live feed watches (default: latest)
//   ?stage=dom              the CSS stand-in instead of three.js (weak GPU, or no WebGL)
const params = new URLSearchParams(location.search);
const replayName = params.get("replay");
const pace = Number(params.get("pace")) || 6000;
const stageRoot = document.querySelector<HTMLElement>("#stage")!;

async function makeStage(): Promise<Stage> {
  if (params.get("stage") === "dom") return new DomStage(stageRoot);
  try {
    return await ThreeStage.create(document.querySelector<HTMLElement>("#gl")!, stageRoot);
  } catch (e) {
    console.warn("3D stage unavailable, using the CSS stage:", e);
    return new DomStage(stageRoot);
  }
}

const stage = await makeStage();
const voice = new BrowserVoice();
const director = new Director(stage, new DomOverlay(document.querySelector<HTMLElement>("#overlay")!), new HttpReader(), voice);
const play = (e: FeedEvent) => director.handle(e);

let replay: ReplayFeed | null = null;
function startReplay(name: string): void {
  replay?.stop();
  replay = new ReplayFeed(name, pace);
  replay.start(play);
}

const live = replayName ? null : new ScanFeed(params.get("scan") ?? "latest");
live?.start((e) => {
  if (e.type === "scanStarted") replay?.stop(); // a real scan always wins over a replay
  play(e);
});
if (replayName) startReplay(replayName);

bindKeys(window, {
  arm: () => director.arm(),
  skip: () => director.skip(),
  // In replay mode R always restarts the replay; live, R must never jump into a running
  // capture or replay a folder that isn't finished yet.
  replay: () => {
    if (replayName) startReplay(replayName);
    else if (live?.current?.phase === "done") startReplay(live.name);
  },
  idle: () => {
    replay?.stop();
    director.toIdle();
  },
  mute: () => {
    voice.muted = !voice.muted;
  },
  fullscreen: () => {
    const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    void p.catch(() => {}); // a rejected request (e.g. no user gesture) must not become an unhandled rejection
  },
});

// Dev builds: a handle for checks in the browser console (e.g. __terminator.stage.renderOnce()).
if (import.meta.env.DEV) Object.assign(window, { __terminator: { director, stage } });
```

- [ ] **Step 5: Verify**

Run: `npm test && npm run typecheck && npm run build`
Expected: all pass. Controller then checks visually (below); the implementer only runs a smoke check if a dev server is already running on 5173 (do not start or stop servers): `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/src/scene/threeStage.ts` → 200.

**Controller visual check** (`http://localhost:5173/?replay=sim&pace=2500`, use `__terminator.stage.renderOnce(dt)` and `__terminator.director.handle(...)` / `skip()` if the pane is hidden):
- idle: full moon, flat, stars around, no CSS moon/sky visible;
- each LED: quarter moon lit from that side (N top, E right, S bottom, W left), crater shadows along the terminator, whole frame dimmed (~0.45);
- combining: the terminator circles;
- descent: camera dives to the terminator; reveal: DOM page over a dawn background, frame back to full brightness;
- `?stage=dom`: the L0 look, unchanged.

- [ ] **Step 6: Commit**

```bash
git add web/index.html web/src/style.css web/src/scene/threeStage.ts web/src/main.ts
git commit -m "3D stage: the real moon follows the LEDs, the CSS stage stays as fallback"
```

---

### Task 6: The photos as 3D cards

**Files:**
- Create: `web/src/scene/plates.ts`
- Modify: `web/src/scene/threeStage.ts` (full replacement below)

**Interfaces:**
- Consumes: `loadPhoto` (Task 4), `fitSize`, `PLATE_SLOTS`, `spiral`, `Vec3` (Task 2).
- Produces: `PLATES` (sizes/timings incl. `brightness: 0.85`); `class PlateDeck { group; land(led, url): Promise<void>; sink(): void; skip(): void; clear(): void }`.

- [ ] **Step 1: Implement `web/src/scene/plates.ts`**

```ts
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
```

- [ ] **Step 2: Replace `web/src/scene/threeStage.ts` (photos now 3D; the page still DOM)**

```ts
import gsap from "gsap";
import * as THREE from "three";
import type { Word } from "../../shared/types";
import type { DoneUrls } from "../feed/types";
import type { Stage } from "../show/director";
import { loadSkyAssets, type SkyAssets } from "./assets";
import { DomStage } from "./domStage";
import { Engine } from "./engine";
import { MOON, Moon } from "./moon";
import { PlateDeck } from "./plates";
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

/** The three.js picture behind the Stage interface. This version draws the moon, the sky and the photos in 3D
 *  and still borrows the reveal page from DomStage (task 7 moves it into 3D). */
export class ThreeStage implements Stage {
  static async create(glRoot: HTMLElement, domRoot: HTMLElement): Promise<ThreeStage> {
    const engine = new Engine(glRoot);
    const assets = await loadSkyAssets(engine.renderer.capabilities.getMaxAnisotropy());
    return new ThreeStage(engine, assets, domRoot);
  }

  readonly engine: Engine;
  readonly moon: Moon;
  private readonly stars: Stars;
  private readonly plates = new PlateDeck();
  private readonly dom: DomStage;
  private readonly look = new THREE.Vector3();
  private readonly sky = NIGHT.clone();
  private moves: gsap.core.Animation[] = [];

  private constructor(engine: Engine, assets: SkyAssets, domRoot: HTMLElement) {
    this.engine = engine;
    this.moon = new Moon(assets);
    this.stars = new Stars(assets.stars);
    engine.scene.add(this.stars.points, this.moon.mesh, this.plates.group);
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
  }

  photoLanded(led: number, url: string): void {
    void this.plates.land(led, url);
  }

  combining(): void {
    this.moon.orbit();
    this.plates.sink();
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
    this.plates.skip();
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
    this.plates.clear();
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
```

- [ ] **Step 3: Verify and commit**

Run: `npm test && npm run typecheck && npm run build` → all pass.

**Controller visual check** (`?replay=sim&pace=2500`): each photo lands as a card in front of the moon (dimmed with the frame), holds ~2 s, then flies to its side (N above, E right, S below, W left); with a 3:4 portrait test image nothing leaves the screen; on combining the cards spiral into the moon after the last close-up; Space during a close-up parks it; a new scan clears the cards.

```bash
git add web/src/scene/plates.ts web/src/scene/threeStage.ts
git commit -m "Photos land as 3D cards, park on their LED's side and spiral into the moon"
```

---

### Task 7: The page in 3D — dive, sunrise, word boxes, hold the sun

**Files:**
- Create: `web/src/scene/wordBoxes.ts`, `web/src/scene/page.ts`, `web/src/scene/sunHandle.ts`
- Modify: `web/src/scene/domStage.ts` (use wordBoxes), `web/src/scene/threeStage.ts` (final version below), `web/src/style.css`

**Interfaces:**
- Consumes: `loadPhoto`, `loadMeasurement` (Task 4); `fitSize`, `Vec3` (Task 2); `SUN`, `SunFollower` (Task 2).
- Produces:
  - `wordBoxes.ts`: `renderBoxes(container, words, confident, imageWidth, imageHeight): void`, `highlightBoxes(container, index): void`
  - `page.ts`: `PAGE = { distance: 3, widthFraction: 0.8, heightFraction: 0.66, lift: 0.04 }`; `class PageView { mesh; uniforms (relief 1, sharpLod 1.5, blurLod 6, exposure 0.72, …); shows(url); load(urls): Promise<void>; show(seconds); hide(); relight(seconds): boolean; setSun(v); showWords; highlight; skip(); layout(camera, width, height): {left, top, width, height} }`
  - `sunHandle.ts`: `class SunHandle { setArea(x, y, radius); start(); stop(); update(dt): Vec3 }`
  - `ThreeStage` final: no DomStage inside; `readonly page: PageView`.

- [ ] **Step 1: Extract the word boxes into `web/src/scene/wordBoxes.ts`**

```ts
import type { Word } from "../../shared/types";

/** One absolutely positioned box per word, in % of the image, so the boxes follow the image's on-screen size. */
export function renderBoxes(container: HTMLElement, words: Word[], confident: number[], imageWidth: number, imageHeight: number): void {
  const w = imageWidth || 1;
  const h = imageHeight || 1;
  container.replaceChildren(
    ...words.map((word, i) => {
      const b = document.createElement("div");
      b.className = confident.includes(i) ? "box confident" : "box";
      if (word.box.length === 0) {
        b.hidden = true;
        return b;
      }
      const xs = word.box.map((p) => p[0]);
      const ys = word.box.map((p) => p[1]);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      b.style.left = `${(x0 / w) * 100}%`;
      b.style.top = `${(y0 / h) * 100}%`;
      b.style.width = `${((Math.max(...xs) - x0) / w) * 100}%`;
      b.style.height = `${((Math.max(...ys) - y0) / h) * 100}%`;
      return b;
    }),
  );
}

/** index = the word being spoken; earlier words count as said; null clears. */
export function highlightBoxes(container: HTMLElement, index: number | null): void {
  Array.from(container.children).forEach((b, i) => {
    b.classList.toggle("said", index !== null && i < index);
    b.classList.toggle("now", i === index);
  });
}
```

In `web/src/scene/domStage.ts`: add `import { highlightBoxes, renderBoxes } from "./wordBoxes";` and replace the bodies of `showWords` and `highlight`:
```ts
  /** One box per word, positioned in % of the reveal image, so it follows the image's size. */
  showWords(words: Word[], confident: number[]): void {
    renderBoxes(this.boxes, words, confident, this.revealImg.naturalWidth, this.revealImg.naturalHeight);
  }

  highlight(index: number | null): void {
    highlightBoxes(this.boxes, index);
  }
```

- [ ] **Step 2: Implement `web/src/scene/page.ts`**

```ts
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
  uniform sampler2D d0, d1, d2, d3; // the aligned photos: LEDs N, E, S, W
  uniform float relit;              // 0 = the clean reveal image, 1 = the page relit by the sun
  uniform float opacity;
  uniform vec3 sun;                 // page space: x east (right), y north (up), z out of the page
  uniform float relief, sharpLod, blurLod, exposure;
  uniform vec3 paper;
  in vec2 vUv;
  out vec4 fragColor;

  // flat-field, as reveal.py: the photo over a heavy blur of itself (a coarse mip level). The photo itself is
  // read one mip level soft too: paper fibre is noise to a relighter.
  float ff(sampler2D t) { return textureLod(t, vUv, sharpLod).r / max(textureLod(t, vUv, blurLod).r, 0.02); }

  void main() {
    vec3 color = paper * texture(revealMap, vUv).r * exposure; // dark strokes on white paper
    if (relit > 0.0) {
      float rN = ff(d0), rE = ff(d1), rS = ff(d2), rW = ff(d3);
      // a wall facing a light is brighter in that light's photo, so the slope leans toward it
      vec2 slope = relief * vec2(rE - rW, rN - rS);
      float albedo = 0.25 * (rN + rE + rS + rW);
      // flat paper stays at 1; the relief term grows as the sun sinks (cot elevation) and is 0 at noon
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

/** The revealed page: a sheet in front of the camera — the clean reveal image, then the page relit by a sun
 *  you can hold — and over it the word boxes the reading lights up. */
export class PageView {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly words = div("words");
  private readonly boxes = div("boxes");
  private revealUrl = "";
  private imageSize: [number, number] = [2, 1];
  private dirsReady = false;
  private gen = 0;
  private anims: gsap.core.Animation[] = [];

  constructor(camera: THREE.Camera, domRoot: HTMLElement) {
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        revealMap: { value: null },
        d0: { value: null },
        d1: { value: null },
        d2: { value: null },
        d3: { value: null },
        relit: { value: 0 },
        opacity: { value: 0 },
        sun: { value: new THREE.Vector3(0, 1, 0.2).normalize() },
        relief: { value: 1 },
        sharpLod: { value: 1.5 },
        blurLod: { value: 6 },
        exposure: { value: 0.72 },
        paper: { value: new THREE.Color(0.96, 0.93, 0.86) },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    this.mesh.position.z = -PAGE.distance;
    camera.add(this.mesh); // travels with the camera, so the page is always framed
    this.words.append(this.boxes);
    domRoot.append(this.words);
  }

  get uniforms(): Record<string, THREE.IUniform> {
    return this.mesh.material.uniforms;
  }

  /** Is `url` the reveal image loaded now? */
  shows(url: string): boolean {
    return this.revealUrl === url;
  }

  /** Load the reveal image (awaited) and, in the background, the four photos for relighting. Never rejects. */
  async load(urls: DoneUrls): Promise<void> {
    const gen = ++this.gen;
    this.revealUrl = urls.reveal;
    this.dirsReady = false;
    try {
      const reveal = await loadPhoto(urls.reveal);
      if (gen !== this.gen) return void reveal.dispose();
      this.swap("revealMap", reveal);
      this.imageSize = [reveal.image.width, reveal.image.height];
    } catch (e) {
      console.warn("reveal image failed to load:", e);
      return;
    }
    if (urls.dirs.length !== 4) return;
    Promise.all(urls.dirs.map(loadMeasurement)).then(
      (photos) => {
        if (gen !== this.gen) return photos.forEach((t) => t.dispose());
        photos.forEach((t, k) => this.swap(`d${k}`, t));
        this.dirsReady = true;
      },
      (e: unknown) => console.warn("photos for relighting failed to load:", e),
    );
  }

  /** Fade the sheet in. */
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
  }

  /** Crossfade from the reveal image to the relit page; false (and nothing changes) until the photos are in. */
  relight(seconds: number): boolean {
    if (!this.dirsReady) return false;
    this.words.classList.remove("on"); // the boxes belong to the reveal image
    this.track(gsap.to(this.uniforms.relit, { value: 1, duration: seconds }));
    return true;
  }

  setSun(v: Vec3): void {
    (this.uniforms.sun.value as THREE.Vector3).set(v[0], v[1], v[2]);
  }

  showWords(words: Word[], confident: number[]): void {
    renderBoxes(this.boxes, words, confident, this.imageSize[0], this.imageSize[1]);
  }

  highlight(index: number | null): void {
    highlightBoxes(this.boxes, index);
  }

  skip(): void {
    const running = this.anims;
    this.anims = [];
    for (const a of running) a.progress(1);
  }

  /** Size the sheet to the view and move the word layer over it; returns its screen rectangle in CSS px. */
  layout(camera: THREE.PerspectiveCamera, width: number, height: number): { left: number; top: number; width: number; height: number } {
    const viewH = 2 * PAGE.distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const viewW = viewH * camera.aspect;
    const [w, h] = fitSize(this.imageSize[0] / this.imageSize[1], viewW * PAGE.widthFraction, viewH * PAGE.heightFraction);
    this.mesh.scale.set(w, h, 1);
    this.mesh.position.y = viewH * PAGE.lift;
    const rect = { left: 0, top: 0, width: (w / viewW) * width, height: (h / viewH) * height };
    rect.left = (width - rect.width) / 2;
    rect.top = height / 2 - PAGE.lift * height - rect.height / 2;
    Object.assign(this.words.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    return rect;
  }

  private swap(name: string, texture: THREE.Texture): void {
    (this.uniforms[name].value as THREE.Texture | null)?.dispose();
    this.uniforms[name].value = texture;
  }

  private track(a: gsap.core.Animation): void {
    this.anims.push(a);
  }
}
```

- [ ] **Step 3: Implement `web/src/scene/sunHandle.ts`**

```ts
import type { Vec3 } from "./math";
import { SUN, SunFollower } from "./sunFollower";

function div(cls: string, text = ""): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = text;
  return d;
}

/** "Hold the sun" on screen: the pointer steers the sun over the page (round = direction, toward the middle =
 *  higher); a small glowing sun shows where it is, and a hint says how. */
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

  setArea(x: number, y: number, radius: number): void {
    this.area = { x, y, radius };
  }

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

  /** Advance one frame; returns the page-space sun vector (frozen while inactive). */
  update(dt: number): Vec3 {
    const v = this.follower.step(this.active ? dt : 0);
    if (this.active) {
      // the glyph sits where the sun is: at the rim when grazing, in the middle at noon
      const elevationDeg = (this.follower.elevation * 180) / Math.PI;
      const r = ((90 - elevationDeg) / (90 - SUN.minElevationDeg)) * this.area.radius;
      const x = this.area.x + r * Math.cos(this.follower.azimuth);
      const y = this.area.y - r * Math.sin(this.follower.azimuth);
      this.glyph.style.transform = `translate(${x}px, ${y}px)`;
    }
    return v;
  }
}
```

- [ ] **Step 4: Add the page, word-layer and sun styles to `web/src/style.css`**

Append:
```css
/* word boxes over the 3D page (positioned every frame by PageView.layout) */
.words { position: absolute; pointer-events: none; opacity: 0; transition: opacity 0.6s; }
.words.on { opacity: 1; }

/* the held sun */
#stage.holding { cursor: none; }
.sun {
  position: absolute; left: 0; top: 0; width: 22px; height: 22px; margin: -11px 0 0 -11px;
  border-radius: 50%; pointer-events: none; opacity: 0; transition: opacity 0.6s;
  background: radial-gradient(circle, #fff6dc 0 30%, #ffd68299 45%, transparent 70%);
  box-shadow: 0 0 24px 6px #ffd68266;
}
.sun.on { opacity: 1; }
.sun-hint {
  position: absolute; left: 0; right: 0; bottom: 2.2vh; text-align: center; pointer-events: none;
  font-size: max(11px, 0.85vw); letter-spacing: 0.3em; color: var(--gold); opacity: 0; transition: opacity 0.8s;
}
.sun-hint.on { opacity: 0.85; }
```

- [ ] **Step 5: Replace `web/src/scene/threeStage.ts` with the final version**

```ts
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

/** The three.js picture: a real moon lit from the LED's side, the photos as cards, a dive to the terminator, a
 *  sunrise onto the page and a sun you can hold over it. Same Stage interface as the CSS stand-in (DomStage),
 *  which stays as the fallback. */
export class ThreeStage implements Stage {
  static async create(glRoot: HTMLElement, domRoot: HTMLElement): Promise<ThreeStage> {
    const engine = new Engine(glRoot);
    const assets = await loadSkyAssets(engine.renderer.capabilities.getMaxAnisotropy());
    return new ThreeStage(engine, assets, domRoot);
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

  private constructor(engine: Engine, assets: SkyAssets, domRoot: HTMLElement) {
    this.engine = engine;
    this.moon = new Moon(assets);
    this.stars = new Stars(assets.stars);
    this.page = new PageView(engine.camera, domRoot);
    this.sunHandle = new SunHandle(domRoot);
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
    });
  }

  idle(): void {
    this.reset(1, MOON.turnSeconds);
  }

  newScan(): void {
    this.reset(STAGE.captureDim, 0.8);
  }

  ledOn(led: number): void {
    this.moon.lightFrom(led);
  }

  photoLanded(led: number, url: string): void {
    void this.plates.land(led, url);
  }

  combining(): void {
    this.moon.orbit();
    this.plates.sink();
  }

  async descent(urls: DoneUrls): Promise<void> {
    this.moon.lightFrom(DIVE_LED, 0.6);
    const loading = this.page.load(urls);
    const d = STAGE.descentSeconds;
    this.track(gsap.to(this.engine.camera.position, { x: DIVE_CAMERA.x, y: DIVE_CAMERA.y, z: DIVE_CAMERA.z, duration: d, ease: "power2.in" }));
    this.track(gsap.to(this.look, { x: DIVE_LOOK.x, y: DIVE_LOOK.y, z: DIVE_LOOK.z, duration: d, ease: "power2.in" }));
    await Promise.all([this.wait(d), loading]);
  }

  async reveal(urls: DoneUrls): Promise<void> {
    if (!this.page.shows(urls.reveal)) await this.page.load(urls);
    const s = STAGE.sunriseSeconds;
    this.track(gsap.to(this.engine.frameGain, { gain: 1, duration: s }));
    this.track(gsap.to(this.sky, { r: DAWN.r, g: DAWN.g, b: DAWN.b, duration: s }));
    this.page.show(s);
    await this.wait(s);
  }

  showWords(words: Word[], confident: number[]): void {
    this.page.showWords(words, confident);
  }

  highlight(index: number | null): void {
    this.page.highlight(index);
  }

  hold(): void {
    if (this.page.relight(STAGE.relightSeconds)) this.sunHandle.start();
  }

  skip(): void {
    const running = this.moves;
    this.moves = [];
    for (const m of running) m.progress(1); // tweens jump to their end, waits resolve
    this.moon.finishTurn();
    this.plates.skip();
    this.page.skip();
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
    this.plates.clear();
    this.page.hide();
    this.sunHandle.stop();
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
```

- [ ] **Step 6: Verify and commit**

Run: `npm test && npm run typecheck && npm run build` → all pass.

**Controller visual check** (`?replay=sim&pace=2500` with the real key, and `?stage=dom` once):
- descent: camera dives toward the terminator (west light, craters with long shadows);
- reveal: the sky warms to dawn, the frame brightens, the sheet fades in (dark strokes on warm paper), word boxes sit exactly on the words and light up as they are read;
- hold (3 s after reading): the sheet crossfades to the relit page; a small sun circles low by itself (writing in relief, shadows moving); moving the pointer takes over — at the page centre the writing vanishes (noon), toward the rim it stands out; after 6 s without the pointer it circles again; hint shown at the bottom;
- a new scan / Esc: page, sun and hint disappear, the camera is back home, full moon;
- `?stage=dom`: L0 look with word boxes still working (wordBoxes extraction).

```bash
git add web/src/scene/wordBoxes.ts web/src/scene/page.ts web/src/scene/sunHandle.ts web/src/scene/domStage.ts web/src/scene/threeStage.ts web/src/style.css
git commit -m "3D page: dive to the terminator, sunrise, word boxes, and a sun you can hold"
```

---

### Task 8: Tuning panel (D)

**Files:**
- Create: `web/src/dev/devPanel.ts`
- Modify: `web/src/show/keys.ts`, `web/test/show/keys.test.ts`, `web/src/main.ts`

**Interfaces:**
- Consumes: `ThreeStage` (`engine.bloom`, `moon.uniforms`, `page.uniforms`), `STAGE`, `MOON`, `PLATES`, `SUN`.
- Produces: `KeyActions.dev(): void` bound to `d`/`D`; `openDevPanel(stage: ThreeStage): GUI`.

- [ ] **Step 1: Write the failing key test**

In `web/test/show/keys.test.ts`: in `actions()`, add `dev: vi.fn()` to the returned object. Then add this test at the end of the `describe` block:
```ts
  it("D opens the tuning panel", () => {
    const t = new EventTarget();
    const a = actions();
    bindKeys(t, a);
    press(t, " "); // arm
    press(t, "d");
    press(t, "D");
    expect(a.dev).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/show/keys.test.ts`
Expected: FAIL — `dev` is never called (and typecheck would flag the unknown property until Step 3).

- [ ] **Step 3: Bind D in `web/src/show/keys.ts`**

Add `dev(): void;` as the last member of `interface KeyActions`, change the doc comment's last line to `After that: Space skip, R replay, Esc idle, M mute, F fullscreen, D tuning panel.`, and add this case to the `switch`:
```ts
      case "d":
      case "D":
        a.dev();
        break;
```

- [ ] **Step 4: Implement `web/src/dev/devPanel.ts`**

```ts
import GUI from "lil-gui";
import { MOON } from "../scene/moon";
import { PLATES } from "../scene/plates";
import { SUN } from "../scene/sunFollower";
import { STAGE, type ThreeStage } from "../scene/threeStage";

/** Live tuning for rehearsals (D): moon relief and exposure, bloom, capture dim, card brightness, page relight. */
export function openDevPanel(stage: ThreeStage): GUI {
  const gui = new GUI({ title: "Terminator tuning (D to close)" });

  const m = stage.moon.uniforms;
  const moon = gui.addFolder("Moon");
  moon.add(m.exaggeration, "value", 1, 12, 0.5).name("relief x");
  moon.add(m.exposure, "value", 0.5, 6, 0.1).name("exposure");
  moon.add(m.earthshine, "value", 0, 0.1, 0.005).name("earthshine");
  moon.add(m.steps, "value", 0, 64, 4).name("shadow steps");
  moon.add(MOON, "tilt", -0.3, 0.6, 0.01).name("sun toward viewer");

  const frame = gui.addFolder("Frame");
  frame.add(stage.engine.bloom, "intensity", 0, 3, 0.05).name("bloom");
  frame.add(stage.engine.bloom.luminanceMaterial, "threshold", 0, 1, 0.01).name("bloom threshold");
  frame.add(STAGE, "captureDim", 0.1, 1, 0.05).name("capture dim (next scan)");
  frame.add(PLATES, "brightness", 0.3, 1.2, 0.05).name("photo brightness (next photo)");

  const p = stage.page.uniforms;
  const page = gui.addFolder("Page relight");
  page.add(p.relief, "value", 0.1, 4, 0.1).name("relief gain");
  page.add(p.sharpLod, "value", 0, 3, 0.25).name("smoothing (mip)");
  page.add(p.blurLod, "value", 3, 8, 0.25).name("flat-field blur (mip)");
  page.add(p.exposure, "value", 0.3, 1.5, 0.02).name("exposure");
  page.add(SUN, "autoElevationDeg", 2, 30, 1).name("idle sun height");

  return gui;
}
```

- [ ] **Step 5: Toggle it from `web/src/main.ts`**

1. Below `const play = ...`, add:
```ts
let panel: { destroy(): void } | null = null;
async function toggleDevPanel(): Promise<void> {
  if (panel) {
    panel.destroy();
    panel = null;
    return;
  }
  if (!(stage instanceof ThreeStage)) return; // the CSS stage has nothing to tune
  const { openDevPanel } = await import("./dev/devPanel");
  panel = openDevPanel(stage);
}
```
2. In the `bindKeys(window, { ... })` object, after `fullscreen: ...`, add:
```ts
  dev: () => void toggleDevPanel(),
```

- [ ] **Step 6: Verify and commit**

Run: `npm test && npm run typecheck && npm run build`
Expected: all pass (keys test included); the build emits a separate chunk for the panel.

**Controller visual check:** D opens the panel; moving "relief x" or "relief gain" changes the picture live; D closes it.

```bash
git add web/src/dev/devPanel.ts web/src/show/keys.ts web/test/show/keys.test.ts web/src/main.ts
git commit -m "Tuning panel on D for rehearsals"
```

---

### Task 9: Docs and final checks

**Files:**
- Modify: `CLAUDE.md`, `docs/superpowers/specs/2026-09-26-web-ui-design.md`

- [ ] **Step 1: CLAUDE.md**

In `## Layout`, inside the code block, after the line starting with `  src/show/director.ts`, add:
```
  src/scene/threeStage.ts  3D stage (three.js): NASA moon lit from the LED's side, real stars, photo cards,
                        dive + sunrise, page relit by a sun you can hold; ?stage=dom = CSS fallback
  public/sky/           moon/star assets (NASA SVS CGI Moon Kit, Yale BSC); tools/prepare_moon_assets.py
```
In `## Commands`, inside the code block, after the `npm run dev` line and its comment, add:
```
#   ?stage=dom  the CSS stand-in stage;  D = tuning panel (moon relief, bloom, capture dim, page relight)
```
In `## Status / next`, after the `Web UI L0` line, add:
```
- [x] Web UI L1 visuals (branch ui): three.js moon/stars/cards/page, hold-the-sun relighting, tuning panel
```

- [ ] **Step 2: Spec §8 note**

In `docs/superpowers/specs/2026-09-26-web-ui-design.md`, directly under the `## 8. 分层交付` heading, add:
```markdown
> 2026-09-26 调整顺序（用户决定）：先做画面。L1 = 3D 月球、星空、照片卡片、降落与日出、握住太阳（原 L2 的重打光）。声音和 Cloud TTS 挪到下一层，纸面地形降落放在最后。
```

- [ ] **Step 3: Final verification and commit**

Run (in `web/`): `npm run typecheck && npm test && npm run build` → all pass.
Run (repo root): `git status --short` → only the two doc files modified (plus the untracked `.claude/`, which is not committed).
```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-26-web-ui-design.md
git commit -m "Document the 3D stage and the new layer order"
```

---

## After L1

Next plans: **sound** (Tone.js chord walk, Quindar, Cloud TTS radio voice — enable Cloud Text-to-Speech on the Google project first) and **the paper-terrain descent** (the moon surface morphing into the page's relief).
