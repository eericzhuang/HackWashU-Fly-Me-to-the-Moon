"""Relight the page with a virtual sun and keep the one Google reads best.

Same model as the web UI's "hold the sun" (web/src/scene/page.ts): from the four aligned,
flat-fielded photos R_N, R_E, R_S, R_W
    slope  = (R_E - R_W, R_N - R_S)
    albedo = mean(R)
    shade  = 1 + relief * (slope . sun_dir) / tan(elevation)
    image  = albedo * clip(shade, 0.04, 2.5)
A low sun from the right side makes the grooves stand out like craters at the terminator.

best() tries a ring of sun azimuths at a low elevation, asks Google Vision to read each
(GOOGLE_API_KEY, from the environment or web/.env.local), refines around the best, and returns
the clearest image: the one whose reading agrees most with what the other sun angles read
(a consensus, so one lucky over-read like "TINCKWI KWASHU" doesn't win), confidence breaking
ties. Without a key it falls back to the sharpest-looking one.

  python -m terminator.relight out/latest      # -> relit.png + relit.json next to reveal.png
"""
from __future__ import annotations

import base64
import json
import math
import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import numpy as np

from .reveal import flat_field, load_gray

ROOT = Path(__file__).resolve().parent.parent
VISION = "https://vision.googleapis.com/v1/images:annotate"


def vision_key() -> str | None:
    if os.environ.get("GOOGLE_API_KEY"):
        return os.environ["GOOGLE_API_KEY"]
    env = ROOT / "web" / ".env.local"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("GOOGLE_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"') or None
    return None


def slopes(images: list[np.ndarray], sigma: float = 40.0) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(gx, gy, albedo) from N, E, S, W photos, like the web shader (slightly smoothed)."""
    r = [cv2.GaussianBlur(flat_field(cv2.medianBlur(i.astype(np.float32), 3), sigma), (0, 0), 1.2) for i in images]
    rn, re, rs, rw = r
    return re - rw, rn - rs, (rn + re + rs + rw) / 4


def lit_by(gx: np.ndarray, gy: np.ndarray, albedo: np.ndarray, azimuth_deg: float, elevation_deg: float,
           relief: float = 1.0) -> np.ndarray:
    a = math.radians(azimuth_deg)
    shade = 1 + relief * (gx * math.cos(a) + gy * math.sin(a)) / math.tan(math.radians(elevation_deg))
    return albedo * np.clip(shade, 0.04, 2.5)


def render(gx: np.ndarray, gy: np.ndarray, albedo: np.ndarray, azimuth_deg: float, elevation_deg: float,
           suns: int = 1, relief: float = 1.0) -> np.ndarray:
    """uint8 page lit by a sun at (azimuth, elevation); azimuth 0 = from the right, 90 = from the top.

    suns=2 adds a second sun 90 deg around and keeps the darker of the two pictures at every
    pixel: every stroke has a shadowed wall under at least one of them, so crossbars (the H and A
    in HACKWASHU) show as well as uprights. One sun alone loses strokes parallel to its light."""
    lit = lit_by(gx, gy, albedo, azimuth_deg, elevation_deg, relief)
    if suns == 2:
        lit = np.minimum(lit, lit_by(gx, gy, albedo, azimuth_deg + 90, elevation_deg, relief))
    h, w = lit.shape
    c = lit[h // 4:3 * h // 4, w // 8:7 * w // 8]  # stretch on the middle, where the writing is
    lo, hi = np.percentile(c, [0.5, 99.5])
    return (np.clip((lit - lo) / max(hi - lo, 1e-6), 0, 1) * 255).astype(np.uint8)


def read(img: np.ndarray, key: str, timeout: float = 15.0) -> tuple[str, float, list[list[float]]]:
    """(text, score, boxes): score = sum of confidence x letters, so more letters read surely wins;
    boxes = [x0, y0, x1, y1] of each word, in image pixels."""
    ok, png = cv2.imencode(".png", img)
    body = {"requests": [{"image": {"content": base64.b64encode(png.tobytes()).decode()},
                          "features": [{"type": "DOCUMENT_TEXT_DETECTION"}],
                          "imageContext": {"languageHints": ["en-t-i0-handwrit"]}}]}
    req = urllib.request.Request(VISION, json.dumps(body).encode(),
                                 {"Content-Type": "application/json", "X-Goog-Api-Key": key})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            r = json.load(resp)["responses"][0]
    except Exception as e:
        print(f"  vision failed: {type(e).__name__}: {e}")
        return "", 0.0, []
    words = [("".join(s["text"] for s in w["symbols"]), w.get("confidence", 0.0), w["boundingBox"].get("vertices", []))
             for pg in r.get("fullTextAnnotation", {}).get("pages", []) for b in pg["blocks"]
             for pa in b["paragraphs"] for w in pa["words"]]
    score = sum(c * sum(ch.isalnum() for ch in t) for t, c, _ in words)
    boxes = []
    for t, _, vs in words:
        if vs and any(ch.isalnum() for ch in t):
            xs, ys = [v.get("x", 0) for v in vs], [v.get("y", 0) for v in vs]
            boxes.append([min(xs), min(ys), max(xs), max(ys)])
    return " ".join(t for t, _, _ in words), float(score), boxes


def levenshtein(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def consensus_pick(tried: list[dict], top: int = 8) -> dict:
    """Among the `top` best-scoring tries, the one whose text (letters only) is closest to the
    others' (weighted by their score). Only the top ones vote: with ~45 sun angles most read the
    word partly, and letting them all vote made a short partial read win (scan_20260926_230415:
    "HACKWAS" beat two exact "HACKWASHU" reads that had the highest scores)."""
    norm = lambda t: "".join(ch for ch in t["text"].upper() if ch.isalnum())
    read = [t for t in sorted(tried, key=lambda t: -t["score"])[:top] if norm(t)]
    if not read:
        return max(tried, key=lambda t: t["score"])
    def cost(t):
        return sum(o["score"] * levenshtein(norm(t), norm(o)) / max(len(norm(t)), len(norm(o))) for o in read)
    return min(read, key=lambda t: (cost(t), -t["score"]))


def word_box(tried: list[dict], top: int = 100) -> list[float] | None:
    """[x0, y0, x1, y1] around the whole line of writing: every sun angle reads a different part of
    it (HACKWAS, ACKWASHU, ...), and all relit images share one geometry, so the union of the
    words every try found covers the word (the top 8 alone missed the U once). Words off the main line (a stray letter in
    the paper's texture) are left out."""
    boxes = [b for t in sorted(tried, key=lambda t: -t["score"])[:top] for b in t.get("boxes", [])]
    if not boxes:
        return None
    main = max(boxes, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
    cy, h = (main[1] + main[3]) / 2, main[3] - main[1]
    line = [b for b in boxes if abs((b[1] + b[3]) / 2 - cy) < h]
    return [min(b[0] for b in line), min(b[1] for b in line), max(b[2] for b in line), max(b[3] for b in line)]


def sharpness(img: np.ndarray) -> float:
    """Key-less fallback score: strong fine detail in the middle of the page."""
    h, w = img.shape
    c = img[h // 4:3 * h // 4, w // 8:7 * w // 8].astype(np.float32)
    return float(np.percentile(np.abs(c - cv2.GaussianBlur(c, (0, 0), 6)), 99))


def best(images: list[np.ndarray], key: str | None = None) -> dict:
    """The clearest relit page: {"image", "azimuth", "elevation", "text", "score", "tried"}."""
    gx, gy, albedo = slopes(images)
    key = key if key is not None else vision_key()

    def score(c):
        az, el, suns = c
        img = render(gx, gy, albedo, az, el, suns)
        if key:
            text, s, boxes = read(img, key)
        else:
            text, s, boxes = "", sharpness(img), []
        return {"image": img, "azimuth": az % 360, "elevation": el, "suns": suns, "text": text, "score": s,
                "boxes": boxes}

    tried = []
    with ThreadPoolExecutor(8) as pool:
        tried += list(pool.map(score, [(az, 12.0, suns) for suns in (1, 2) for az in range(0, 360, 30)]))
        top = sorted(tried, key=lambda t: -t["score"])[:3]
        fine = {((t["azimuth"] + d) % 360, el, t["suns"]) for t in top for d in (-15, 0, 15) for el in (8.0, 12.0, 20.0)}
        fine -= {(t["azimuth"], t["elevation"], t["suns"]) for t in tried}
        tried += list(pool.map(score, sorted(fine)))
    win = consensus_pick(tried) if key else max(tried, key=lambda t: t["score"])
    return {**win, "tried": [{k: t[k] for k in ("azimuth", "elevation", "suns", "text", "score")} for t in tried],
            "box": word_box(tried), "by": "vision" if key else "sharpness"}


def relight_folder(folder: Path) -> dict:
    folder = Path(folder)
    b = best([load_gray(folder / f"dir_{k}.png") for k in range(4)])
    cv2.imwrite(str(folder / "relit.png"), b["image"])
    info = {k: v for k, v in b.items() if k != "image"}
    (folder / "relit.json").write_text(json.dumps(info, indent=1))
    return b


if __name__ == "__main__":
    import sys
    b = relight_folder(Path(sys.argv[1]))
    print(f"sun at azimuth {b['azimuth']:.0f}, elevation {b['elevation']:.0f}: {b['text']!r} (score {b['score']:.1f}, {len(b['tried'])} tried)")
