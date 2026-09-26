"""Line up photos taken with a hand-touched phone, then write them as a scan folder.

Tapping the shutter shifts even a propped-up phone a little, so every photo is registered
to the first one using only ink (printed rules, pencil marks), which looks the same under
every light direction. On blank paper, draw two or three small pencil crosses away from
the writing to give it something to lock onto.

Used by terminator.phone and tools/import_photos.py.
"""
from __future__ import annotations

import os
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

from .reveal import DIRECTIONS

ROTATIONS = {"cw": cv2.ROTATE_90_CLOCKWISE, "ccw": cv2.ROTATE_90_COUNTERCLOCKWISE, "180": cv2.ROTATE_180}
PHOTO_EXT = {".jpg", ".jpeg", ".png", ".heic", ".tif", ".tiff"}


def load(path: Path, max_side: int | None = None) -> np.ndarray:
    """BGR float image (color kept: reveal.py weighs channels itself), optionally shrunk so its
    long side is at most max_side (full 24-48 MP phone photos make alignment crawl)."""
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None and path.suffix.lower() == ".heic":
        # OpenCV can't read HEIC; macOS sips can.
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "x.png"
            subprocess.run(["sips", "-s", "format", "png", str(path), "--out", str(out)], check=True, capture_output=True)
            img = cv2.imread(str(out), cv2.IMREAD_COLOR)
    if img is None:
        raise FileNotFoundError(path)
    if max_side and max(img.shape[:2]) > max_side:
        f = max_side / max(img.shape[:2])
        img = cv2.resize(img, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
    return img.astype(np.float32)


def capture_time(path: Path) -> float:
    """When the photo was taken (Spotlight reads it from EXIF), else when the file appeared.

    AirDrop delivers photos in no particular order, so file times alone can't be trusted.
    """
    try:
        out = subprocess.run(["mdls", "-raw", "-name", "kMDItemContentCreationDate", str(path)],
                             capture_output=True, text=True, timeout=5).stdout.strip()
        return datetime.strptime(out, "%Y-%m-%d %H:%M:%S %z").timestamp()
    except (OSError, ValueError, subprocess.SubprocessError):
        st = os.stat(path)
        return getattr(st, "st_birthtime", st.st_mtime)


def ink_map(g: np.ndarray) -> np.ndarray:
    """Thin dark marks (ink, pencil), mostly independent of where the light came from.

    Keeps only pixels >15% darker than their surroundings: printed rules and pencil are far
    darker than the few-% shading of paper fibers, which changes with every light direction.
    """
    r = cv2.GaussianBlur(g, (0, 0), 1.5) / np.maximum(cv2.GaussianBlur(g, (0, 0), 20), 1.0)
    return cv2.GaussianBlur(np.clip(0.85 - r, 0, None), (0, 0), 2)


def strongest_blob(f: np.ndarray, margin: int = 120) -> np.ndarray:
    """Position of the strongest non-vertical ink blob (a pencil mark, not a printed rule)."""
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 1))
    m = cv2.GaussianBlur(cv2.morphologyEx(f, cv2.MORPH_OPEN, k), (0, 0), 8)
    m[:margin], m[-margin:], m[:, :margin], m[:, -margin:] = 0, 0, 0, 0
    y, x = np.unravel_index(np.argmax(m), m.shape)
    return np.array([x, y], np.float32)


def ecc(src: np.ndarray, dst: np.ndarray, init: np.ndarray) -> tuple[np.ndarray, float]:
    """Coarse-to-fine ECC; returns homography mapping dst coords -> src coords, and correlation."""
    H = init.astype(np.float32)
    cc = 0.0
    # Finer levels start close to the answer, so they get fewer (much costlier) iterations.
    for s, iters in ((0.25, 200), (0.5, 60), (1.0, 25)):
        crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, iters, 1e-5)
        a = cv2.resize(src, None, fx=s, fy=s)
        b = cv2.resize(dst, None, fx=s, fy=s)
        S = np.diag([s, s, 1.0]).astype(np.float32)
        Hs = S @ H @ np.linalg.inv(S)
        if s < 1.0:
            cc, warp = cv2.findTransformECC(b, a, Hs[:2].copy(), cv2.MOTION_AFFINE, crit, None, 5)
            Hs = np.vstack([warp, [0, 0, 1]]).astype(np.float32)
        else:
            cc, Hs = cv2.findTransformECC(b, a, Hs, cv2.MOTION_HOMOGRAPHY, crit, None, 5)
        H = np.linalg.inv(S) @ Hs @ S
    return H, float(cc)


def register(src: np.ndarray, dst: np.ndarray, good_enough: float = 0.7) -> tuple[np.ndarray, float]:
    """Try identity, phase-correlation and pencil-mark starts; keep the best ECC fit.
    Identity matters on ruled paper: the repeating rules can fool the other two."""
    starts = [(0.0, 0.0)]
    (dx, dy), _ = cv2.phaseCorrelate(cv2.GaussianBlur(dst, (0, 0), 4), cv2.GaussianBlur(src, (0, 0), 4))
    starts.append((dx, dy))
    starts.append(tuple(strongest_blob(src) - strongest_blob(dst)))
    best = None
    for dx, dy in starts:
        init = np.array([[1, 0, dx], [0, 1, dy], [0, 0, 1]], np.float32)
        try:
            H, cc = ecc(src, dst, init)
        except cv2.error:
            continue
        if best is None or cc > best[1]:
            best = (H, cc)
        if cc >= good_enough:
            break
    if best is None:
        raise RuntimeError("could not align photos; add a few pencil crosses and keep the camera still")
    return best


def assemble(files: list[Path], out: Path, roi=None, rotate: str | None = None, margin: int = 40,
             max_side: int = 2400, pad: int = 400) -> list[float]:
    """Align photos (N, E, S, W order) to the first and write dir_0..3.png + aligned.jpg into out.

    Photos are first shrunk to max_side; roi is in the first photo's (shrunk) pixel coords and
    applied before rotate. Returns alignment scores.
    aligned.jpg overlays the ink maps: red = first photo, green = the other; yellow = aligned.
    """
    color = [load(f, max_side) for f in files]
    if roi:
        # Work on the roi plus a generous pad: fewer pixels to register, but still enough paper
        # edge and breadboard in view to lock onto (blank paper alone gives ECC nothing).
        x, y, rw, rh = roi
        H0, W0 = color[0].shape[:2]
        x0, y0 = max(x - pad, 0), max(y - pad, 0)
        x1, y1 = min(x + rw + pad, W0), min(y + rh + pad, H0)
        color = [c[y0:y1, x0:x1] for c in color]
        roi = (x - x0, y - y0, rw, rh)
    gray = [c.mean(axis=2) for c in color]
    h, w = gray[0].shape
    if any(g.shape != (h, w) for g in gray):
        raise ValueError("photos have different sizes")
    ink = [ink_map(g) for g in gray]
    out.mkdir(parents=True, exist_ok=True)

    scores, overlay = [], []
    for k, img in enumerate(color):
        if k == 0:
            H, cc = np.eye(3, dtype=np.float32), 1.0
        else:
            H, cc = register(ink[k], ink[0])
            overlay.append(cv2.merge([np.zeros_like(ink[0]),
                                      cv2.warpPerspective(ink[k], H, (w, h), flags=cv2.WARP_INVERSE_MAP),
                                      ink[0]]))
        scores.append(cc)
        print(f"  dir_{k} ({DIRECTIONS[k]}): alignment score {cc:.2f}" + ("  <- low, check aligned.jpg" if cc < 0.6 else ""))
        warped = cv2.warpPerspective(img, H, (w, h), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                                     borderMode=cv2.BORDER_REPLICATE)
        if roi:
            x, y, rw, rh = roi
            warped = warped[y:y + rh, x:x + rw]
        else:
            warped = warped[margin:h - margin, margin:w - margin]
        if rotate:
            warped = cv2.rotate(warped, ROTATIONS[rotate])
        cv2.imwrite(str(out / f"dir_{k}.png"), warped.clip(0, 255).astype(np.uint8))

    ov = np.hstack([cv2.normalize(o, None, 0, 255, cv2.NORM_MINMAX) for o in overlay]).astype(np.uint8)
    cv2.imwrite(str(out / "aligned.jpg"), cv2.resize(ov, None, fx=0.5, fy=0.5))
    return scores
