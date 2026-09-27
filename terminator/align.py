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
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

from .reveal import DIRECTIONS

ROTATIONS = {"cw": cv2.ROTATE_90_CLOCKWISE, "ccw": cv2.ROTATE_90_COUNTERCLOCKWISE, "180": cv2.ROTATE_180}
PHOTO_EXT = {".jpg", ".jpeg", ".png", ".heic", ".tif", ".tiff"}


def load(path: Path, max_side: int | None = None) -> np.ndarray:
    """BGR float image (color kept: reveal.py weighs channels itself), optionally shrunk so its
    long side is at most max_side (full 24-48 MP phone photos make alignment crawl)."""
    img = None
    if path.suffix.lower() in (".jpg", ".jpeg"):
        # Ignore the phone's EXIF orientation: lying flat face-down, its tilt sensor guesses and can
        # flip between shots (scan_20260926_221847: 6, 6, 6, then 3 -> "different sizes"). Every
        # photo gets the same turn instead: the one all our scans had (6 = rotate 90 deg clockwise),
        # which rig.json's roi was picked in.
        img = cv2.imread(str(path), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        if img is not None:
            img = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
    if img is None:
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


def plausible(H: np.ndarray, max_shift: float, max_warp: float = 0.02) -> bool:
    """A tapped phone moves a few pixels and barely rotates; it doesn't zoom, shear or jump.
    On ruled paper ECC can slide a long way along the rules and still score well. (A 5% zoom
    allowance let wrong ~3% zoom fits win on scan_20260926_214156, so a phone that really zooms,
    like scan_20260926_221105's 2.3%, can't be aligned automatically: keep the phone fixed.)"""
    A = H[:2, :2]
    return (abs(H[0, 2]) < max_shift and abs(H[1, 2]) < max_shift and np.abs(H[2, :2]).max() < 1e-4
            and np.abs(A.T @ A - np.eye(2)).max() < 2 * max_warp)


def ecc_rigid(src: np.ndarray, dst: np.ndarray) -> tuple[np.ndarray, float]:
    """Coarse-to-fine shift + rotation from identity: the fallback when nothing else is plausible."""
    W = np.eye(2, 3, dtype=np.float32)
    cc = 0.0
    for s, iters in ((0.25, 200), (0.5, 60), (1.0, 25)):
        crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, iters, 1e-5)
        Ws = W.copy()
        Ws[:, 2] *= s
        cc, Ws = cv2.findTransformECC(cv2.resize(dst, None, fx=s, fy=s), cv2.resize(src, None, fx=s, fy=s),
                                      Ws, cv2.MOTION_EUCLIDEAN, crit, None, 5)
        W = Ws.copy()
        W[:, 2] /= s
    return np.vstack([W, [0, 0, 1]]).astype(np.float32), float(cc)


@dataclass
class Candidate:
    """One way to map the reference frame onto a photo (H: reference coords -> photo coords)."""
    H: np.ndarray
    score: float
    label: str


def shifted(H: np.ndarray, dx: float, dy: float) -> np.ndarray:
    """H with the warped photo moved by (dx, dy) in the reference frame."""
    return (H @ np.array([[1, 0, -dx], [0, 1, -dy], [0, 0, 1]], np.float32)).astype(np.float32)


def same_place(a: np.ndarray, b: np.ndarray, tol: float = 3.0) -> bool:
    return abs(a[0, 2] - b[0, 2]) < tol and abs(a[1, 2] - b[1, 2]) < tol and np.abs(a[:2, :2] - b[:2, :2]).max() < 0.004


def candidates(src: np.ndarray, dst: np.ndarray, max_shift: float = 150.0) -> list[Candidate]:
    """Every plausible registration of src onto dst, best ECC score first, duplicates dropped.

    Starts: identity, phase correlation, pencil mark; plus shift + rotation only, and doing
    nothing. Identity matters on ruled paper: the repeating rules can fool the other starts, and
    a homography can slide along them (scan_20260926_214156 jumped 1375 px). SIFT features were
    tried and dropped: the breadboard's repeating holes let them lock on one hole off.
    The cross-check in assemble() catches what still gets through."""
    (px, py), _ = cv2.phaseCorrelate(cv2.GaussianBlur(dst, (0, 0), 4), cv2.GaussianBlur(src, (0, 0), 4))
    bx, by = strongest_blob(src) - strongest_blob(dst)
    found: list[Candidate] = []
    for (dx, dy), label in (((0.0, 0.0), "ECC from no shift"), ((px, py), "ECC from phase correlation"),
                            ((bx, by), "ECC from darkest mark")):
        if abs(dx) > max_shift or abs(dy) > max_shift:
            continue
        try:
            H, cc = ecc(src, dst, np.array([[1, 0, dx], [0, 1, dy], [0, 0, 1]], np.float32))
        except cv2.error:
            continue
        if plausible(H, max_shift):
            found.append(Candidate(H, cc, label))
        if cc >= 0.7:  # good enough; the other starts only cost time
            break
    try:
        H, cc = ecc_rigid(src, dst)
        if plausible(H, max_shift):
            found.append(Candidate(H, cc, "shift + rotation only"))
    except cv2.error:
        pass
    found.append(Candidate(np.eye(3, dtype=np.float32), 0.0, "no alignment (phone didn't move)"))
    found.sort(key=lambda c: -c.score)
    out: list[Candidate] = []
    for c in found:
        if not any(same_place(c.H, o.H) for o in out):
            out.append(c)
    return out


def register(src: np.ndarray, dst: np.ndarray, max_shift: float = 150.0) -> tuple[np.ndarray, float]:
    best = candidates(src, dst, max_shift)[0]
    return best.H, best.score


@dataclass
class Check:
    """Does photo k agree with the other photos after alignment?"""
    status: str                      # "ok" | "inconsistent" | "unverified"
    correction: tuple[float, float]  # shift that would make it agree with the others (inconsistent only)
    detail: str


def pair_shift(a: np.ndarray, b: np.ndarray, scale: float = 0.5) -> tuple[float, float, float]:
    """Residual shift of b relative to a (full-res px) and how sure phase correlation is."""
    a = cv2.resize(a, None, fx=scale, fy=scale).astype(np.float32)
    b = cv2.resize(b, None, fx=scale, fy=scale).astype(np.float32)
    (dx, dy), resp = cv2.phaseCorrelate(a, b, cv2.createHanningWindow(a.shape[::-1], cv2.CV_32F))
    return dx / scale, dy / scale, float(resp)


def cross_check(warped_ink: list[np.ndarray], ref: int = 0, tol: float = 6.0, min_resp: float = 0.2) -> list[Check]:
    """Loop closure: once every photo is registered to photo `ref`, every PAIR should line up too.

    Anchored at the reference: it never moves. A photo whose confident residual against the
    trusted group (ref, then every photo that agrees with it) is within tol px joins the group;
    one that the trusted group says is off by > tol px is "inconsistent", with the shift that
    moves it onto the group; one no trusted photo can be compared with is "unverified" (e.g.
    east/west shots on ruled paper). Anchoring matters when the photos split into two camera
    positions (scan_20260926_225055: shots 1-2 vs 3-4, 94 px apart): judging each photo against
    "the others" moved both halves toward each other and left them 94 px apart again.
    scan_20260926_005757's south shot was 124 px off, agreed on by the other three."""
    n = len(warped_ink)
    shifts = {}
    for i in range(n):
        for j in range(i + 1, n):
            dx, dy, r = pair_shift(warped_ink[i], warped_ink[j])
            shifts[i, j], shifts[j, i] = (dx, dy, r), (-dx, -dy, r)

    def against(k: int, group: set[int]) -> list[tuple[float, float]]:
        """Shift of k relative to each confident member of group."""
        return [(shifts[j, k][0], shifts[j, k][1]) for j in group if j != k and shifts[j, k][2] >= min_resp]

    trusted = {ref}
    grew = True
    while grew:  # grow the trusted group from the reference outward
        grew = False
        for k in range(n):
            if k in trusted:
                continue
            d = against(k, trusted)
            if d and np.hypot(float(np.median([x for x, _ in d])), float(np.median([y for _, y in d]))) <= tol:
                trusted.add(k)
                grew = True
    out = []
    for k in range(n):
        if k == ref:
            out.append(Check("ok", (0.0, 0.0), "reference photo"))
        elif k in trusted:
            out.append(Check("ok", (0.0, 0.0), f"agrees with {len(against(k, trusted))} trusted photo(s)"))
        elif d := against(k, trusted):
            mx, my = float(np.median([x for x, _ in d])), float(np.median([y for _, y in d]))
            out.append(Check("inconsistent", (-mx, -my),
                             f"{len(d)} photo(s) that agree with the reference say it is off by ({mx:.0f}, {my:.0f}) px"))
        else:
            best = max(shifts[j, k][2] for j in range(n) if j != k)
            out.append(Check("unverified", (0.0, 0.0), f"no trusted photo matches it well enough to check (best {best:.2f})"))
    return out


@dataclass
class ReviewRequest:
    """Photo k's alignment is doubtful; `options[0]` is what the pipeline would pick by itself."""
    k: int
    check: Check
    options: list[Candidate]
    gray: list[np.ndarray]        # the working-frame photos (roi + pad), float
    Hs: list[np.ndarray]          # current registration of every photo
    size: tuple[int, int]         # working frame (w, h)
    roi: tuple | None             # roi inside the working frame
    rotate: str | None
    ref: int = 0                  # the photo everything is registered to


@dataclass
class Decision:
    choice: int                   # index into ReviewRequest.options
    dx: float = 0.0               # extra nudge in the reference frame, px
    dy: float = 0.0
    by: str = "auto"              # "ai" | "human" | "auto"
    why: str = ""


def assemble(files: list[Path], out: Path, roi=None, rotate: str | None = None, margin: int = 40,
             max_side: int = 2400, pad: int = 400,
             review: Callable[[ReviewRequest], Decision] | None = None, ref: int = 0) -> list[dict]:
    """Align photos (N, E, S, W order) to photo `ref` and write dir_0..3.png + aligned.jpg into out.

    ref: which photo is the reference, e.g. 3 when the phone was only settled for the last shot
    (rig.json "ref"). Photos are first shrunk to max_side; roi is in the reference photo's (shrunk) pixel coords and
    applied before rotate. After registering, every photo is cross-checked against the others
    (cross_check); a doubtful one goes to `review` (AI or a person, terminator.review), else an
    inconsistent one is moved to agree with the others. Returns one report dict per photo.
    aligned.jpg overlays the ink maps: red = first photo, green = the other; yellow = aligned.
    """
    color = [load(f, max_side) for f in files]
    if roi:
        # Work on the roi plus a generous pad: fewer pixels to register, but still enough paper
        # edge and breadboard in view to lock onto (blank paper alone gives ECC nothing).
        x, y, rw, rh = roi
        H0, W0 = color[ref].shape[:2]
        x0, y0 = max(x - pad, 0), max(y - pad, 0)
        x1, y1 = min(x + rw + pad, W0), min(y + rh + pad, H0)
        color = [c[y0:y1, x0:x1] for c in color]
        roi = (x - x0, y - y0, rw, rh)
    gray = [c.mean(axis=2) for c in color]
    h, w = gray[ref].shape
    if any(g.shape != (h, w) for g in gray):
        raise ValueError("photos have different sizes")
    ink = [ink_map(g) for g in gray]
    out.mkdir(parents=True, exist_ok=True)

    def warp(img: np.ndarray, H: np.ndarray, **kw) -> np.ndarray:
        return cv2.warpPerspective(img, H, (w, h), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, **kw)

    cands = [[Candidate(np.eye(3, dtype=np.float32), 1.0, "reference")] if k == ref else candidates(ink[k], ink[ref])
             for k in range(4)]
    Hs = [c[0].H for c in cands]
    scores = [c[0].score for c in cands]
    checks = cross_check([warp(ink[k], Hs[k]) for k in range(4)], ref)
    report = []
    for k in range(4):
        chk, by = checks[k], "auto"
        print(f"  dir_{k} ({DIRECTIONS[k]}): alignment score {scores[k]:.2f}, {chk.status}: {chk.detail}")
        if chk.status != "ok":
            options = list(cands[k])
            if chk.status == "inconsistent":
                options.insert(0, Candidate(shifted(Hs[k], *chk.correction), scores[k],
                                            "moved to agree with the other photos"))
            if review is not None:
                d = review(ReviewRequest(k, chk, options, gray, Hs, (w, h), roi, rotate, ref))
                Hs[k], by = shifted(options[d.choice].H, d.dx, d.dy), d.by
                print(f"    -> {d.by} picked '{options[d.choice].label}' + nudge ({d.dx:.0f}, {d.dy:.0f})"
                      + (f": {d.why}" if d.why else ""))
            elif chk.status == "inconsistent":
                Hs[k] = options[0].H
                print(f"    -> auto: {options[0].label}")
        report.append({"led": k, "score": round(scores[k], 3), "check": chk.status, "detail": chk.detail, "by": by})

    overlay = []
    for k, img in enumerate(color):
        H = Hs[k]
        if k != ref:
            overlay.append(cv2.merge([np.zeros_like(ink[ref]), warp(ink[k], H), ink[ref]]))
        warped = warp(img, H, borderMode=cv2.BORDER_REPLICATE)
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
    return report


def locate_roi(photo: Path, template: Path, roi, max_side: int = 2400) -> tuple[list[int], np.ndarray, float]:
    """Where a crop picked on `template` (a photo of the same sheet under the same LED) lies in
    `photo`, when the phone or the sheet has been put back slightly differently.

    Both are flat-fielded, roughly placed by phase correlation, then fitted with coarse-to-fine
    affine ECC (shift, turn, a little zoom); the crop's corners are mapped and boxed.
    Returns (roi in photo's pixels, the 2x3 template->photo warp, ECC score)."""
    def prep(p: Path) -> np.ndarray:
        g = load(p, max_side).mean(axis=2)
        r = g / np.maximum(cv2.GaussianBlur(g, (0, 0), 25), 1.0)
        lo, hi = np.percentile(r, [1, 99])
        return np.clip((r - lo) / max(hi - lo, 1e-6), 0, 1).astype(np.float32)

    t, p = prep(template), prep(photo)

    def fit(W: np.ndarray, levels) -> tuple[np.ndarray, float]:
        cc = 0.0
        for s, iters, motion in levels:
            a, b = cv2.resize(t, None, fx=s, fy=s), cv2.resize(p, None, fx=s, fy=s)
            Ws = W.copy()
            Ws[:, 2] *= s
            cc, Ws = cv2.findTransformECC(a, b, Ws, motion,
                                          (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, iters, 1e-6), None, 5)
            W = Ws.copy()
            W[:, 2] /= s
        return W, float(cc)

    starts = [np.eye(2, 3, dtype=np.float32)]
    for s0 in (0.25, 0.125):
        ts, ps = cv2.resize(t, None, fx=s0, fy=s0), cv2.resize(p, None, fx=s0, fy=s0)
        (dx, dy), _ = cv2.phaseCorrelate(ts, ps, cv2.createHanningWindow(ts.shape[::-1], cv2.CV_32F))
        starts.append(np.array([[1, 0, dx / s0], [0, 1, dy / s0]], np.float32))
    # First shift only at low resolution (wide capture range), then shift + turn + zoom finer.
    levels = ((0.125, 200, cv2.MOTION_TRANSLATION), (0.25, 200, cv2.MOTION_AFFINE), (0.5, 60, cv2.MOTION_AFFINE))
    best = None
    for W0 in starts:
        try:
            W, cc = fit(W0, levels)
        except cv2.error:
            continue
        if best is None or cc > best[1]:
            best = (W, cc)
    if best is None:
        return list(roi), np.eye(2, 3, dtype=np.float32), 0.0
    W, cc = best
    x, y, w, h = roi
    corners = np.array([[x, y, 1], [x + w, y, 1], [x + w, y + h, 1], [x, y + h, 1]], np.float32) @ W.T
    H, Wd = p.shape
    x0, y0 = np.clip(corners.min(axis=0), 0, [Wd, H]).astype(int)
    x1, y1 = np.clip(corners.max(axis=0), 0, [Wd, H]).astype(int)
    return [int(x0), int(y0), int(x1 - x0), int(y1 - y0)], W, float(cc)
