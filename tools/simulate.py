"""Fake a scan folder so reveal.py and the web UI can be built without hardware.

  python tools/simulate.py "Meet me on the moon at 9"            -> out/sim/
  python tools/simulate.py "hello" --elev 8 --out out/latest

Renders the text as a shallow height map (round-bottomed pen groove, paper
fiber noise, gentle paper curl), then shades it Lambertian-style from four
low-angle directions with an LED distance falloff, a little ambient light and
camera noise. Then runs reveal.py on it, so the folder is a complete "done" scan.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from terminator.reveal import DIRECTIONS, reveal_folder  # noqa: E402

AZIMUTHS = [-np.pi / 2, 0.0, np.pi / 2, np.pi]  # N, E, S, W in image coords (y down)


def text_mask(text: str, w: int, h: int) -> np.ndarray:
    img = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(img)
    size = h // 5
    font = None
    for name in ("DejaVuSans-Oblique.ttf", "Arial Italic.ttf", "arialbi.ttf", "DejaVuSans.ttf"):
        try:
            font = ImageFont.truetype(name, size)
            break
        except OSError:
            continue
    font = font or ImageFont.load_default()
    words, lines, cur = text.split(), [], ""
    for wd in words:
        t = f"{cur} {wd}".strip()
        if d.textlength(t, font=font) > w - 80 and cur:
            lines.append(cur)
            cur = wd
        else:
            cur = t
    lines.append(cur)
    lh = int(size * 1.3)
    y = h // 2 - lh * len(lines) // 2
    for ln in lines:
        d.text((40, y), ln, fill=255, font=font, stroke_width=1, stroke_fill=255)
        y += lh
    return np.asarray(img, np.float32) / 255.0


def simulate(text: str, w=1200, h=600, elev_deg=8.0, depth=1.1, seed=0):
    rng = np.random.default_rng(seed)
    # A ballpoint leaves a round-bottomed groove, deepest along the stroke's center line.
    ink = (text_mask(text, w, h) > 0.5).astype(np.uint8)
    dist = cv2.distanceTransform(ink, cv2.DIST_L2, 5)
    r = max(float(np.percentile(dist[ink > 0], 95)), 1.0)
    m = cv2.GaussianBlur(1 - (1 - np.minimum(dist / r, 1)) ** 2, (0, 0), 1.0)
    fiber = cv2.GaussianBlur(rng.standard_normal((h, w)).astype(np.float32), (0, 0), 1.2)
    curl = cv2.GaussianBlur(rng.standard_normal((h, w)).astype(np.float32), (0, 0), 120)
    cy, cx = np.gradient(curl)
    curl *= 0.035 / max(float(np.hypot(cx, cy).max()), 1e-9)  # paper tilts at most ~2 deg
    height = -1.6 * depth * m + 0.35 * fiber + curl
    gy, gx = np.gradient(height)
    inv = 1.0 / np.sqrt(gx ** 2 + gy ** 2 + 1)
    el = np.deg2rad(elev_deg)
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    ambient = 6.0
    shots = []
    for az in AZIMUTHS:
        lx, ly, lz = np.cos(el) * np.cos(az), np.cos(el) * np.sin(az), np.sin(el)
        shade = np.clip((-gx * lx - gy * ly + lz) * inv, 0, None) / lz
        p = ((xs - w / 2) * np.cos(az) + (ys - h / 2) * np.sin(az)) / (w / 2)
        img = 150 * shade * (1 + 0.3 * p) + ambient + rng.normal(0, 2.0, (h, w))
        shots.append(np.clip(img, 0, 255).astype(np.uint8))
    dark = np.clip(ambient + rng.normal(0, 2.0, (h, w)), 0, 255).astype(np.uint8)
    return shots, dark


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("text")
    p.add_argument("--out", type=Path, default=ROOT / "out" / "sim")
    p.add_argument("--elev", type=float, default=8.0, help="light elevation in degrees")
    p.add_argument("--depth", type=float, default=1.1, help="groove depth, smaller = fainter writing")
    a = p.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    shots, dark = simulate(a.text, elev_deg=a.elev, depth=a.depth)
    cv2.imwrite(str(a.out / "dark.png"), dark)
    for k, s in enumerate(shots):
        cv2.imwrite(str(a.out / f"dir_{k}.png"), s)
    reveal_folder(a.out)
    (a.out / "meta.json").write_text(json.dumps({
        "status": "done", "directions": DIRECTIONS, "captured": [0, 1, 2, 3],
        "seconds": 0.0, "simulated": True, "text": a.text}, indent=2))
    print(a.out)


if __name__ == "__main__":
    main()
