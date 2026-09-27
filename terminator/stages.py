"""Every step reveal.py takes, as labeled picture pages (English): shown one by one in the web UI
(steps.json + step_<page>_<panel>.png in the scan folder), and as one sheet by tools/explain.py.

compute() redoes the chosen method with the same parameters as reveal() and checks its last image
against reveal(), so the pictures can't drift from what the pipeline actually does.
"""
from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .align import ROTATIONS, load
from .reveal import flat_field, integrate, groove_depth, reveal

TILE_W = 440
STEP_W = 1200  # width of the per-panel PNGs the web UI shows
FONT_PATHS = ["/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/Supplemental/Arial.ttf",
              "/Library/Fonts/Arial.ttf", "DejaVuSans.ttf"]

# Same defaults as terminator.reveal.reveal()
SIGMA, DENOISE, SMOOTH, LO_PCT, HI_PCT, CLAHE, CENTER, HP = 40.0, 3, 1.5, 85.0, 99.5, 1.0, 0.5, 15.0

Row = tuple[str, str, list[tuple[np.ndarray, str]]]  # title, note, [(image, caption)]


def font(size: int) -> ImageFont.ImageFont:
    for p in FONT_PATHS:
        try:
            return ImageFont.truetype(p, size)
        except OSError:
            continue
    return ImageFont.load_default()


def to_u8(img: np.ndarray, lo: float | None = None, hi: float | None = None) -> np.ndarray:
    """Display scaling: fixed range if given, else 1st-99.5th percentile."""
    if lo is None:
        lo, hi = np.percentile(img, [1, 99.5])
    return (np.clip((img - lo) / max(hi - lo, 1e-9), 0, 1) * 255).astype(np.uint8)


def signed_u8(img: np.ndarray) -> np.ndarray:
    """Signed map around mid-grey: 0 -> 128, symmetric range from the 99th percentile of |img|."""
    a = max(float(np.percentile(np.abs(img), 99)), 1e-9)
    return to_u8(img, -a, a)


def unaligned(raw: list[Path], roi, rotate: str | None, max_side: int = 2400) -> list[np.ndarray]:
    """The raw phone photos cropped like the scan but not registered, for the alignment row."""
    x, y, w, h = roi
    out = [load(r, max_side).mean(axis=2)[y:y + h, x:x + w] for r in raw]
    return [cv2.rotate(u, ROTATIONS[rotate]) for u in out] if rotate else out


def compute(imgs: list[np.ndarray], before: list[np.ndarray] | None = None, method: str = "range") -> dict:
    """Every intermediate image of `method`, display-scaled to uint8.

    Keys: method; align_before/after (+ _zoom, only when `before` is given); lit[4], raw0, bg0, R[4];
    range: max, min, S; depth: gx, gy, height, curl, grooves, signs;
    then smooth, stretched, boxed, clahe, final (== reveal.png).
    """
    d: dict = {"method": method}
    if before is not None:
        b = np.mean([flat_field(u, SIGMA) for u in before], axis=0)
        a = np.mean([flat_field(i, SIGMA) for i in imgs], axis=0)
        hh, ww = a.shape
        zoom = (slice(int(hh * 0.3), int(hh * 0.7)), slice(int(ww * 0.25), int(ww * 0.55)))
        d.update(align_before=to_u8(b), align_after=to_u8(a),
                 align_before_zoom=to_u8(b[zoom]), align_after_zoom=to_u8(a[zoom]))
    d["lit"] = [to_u8(i) for i in imgs]

    den = [cv2.medianBlur(i.astype(np.float32), DENOISE) if DENOISE > 1 else i for i in imgs]
    ratios = [flat_field(i, SIGMA) for i in den]
    d.update(raw0=to_u8(den[0]), bg0=to_u8(cv2.GaussianBlur(den[0], (0, 0), SIGMA)),
             R=[to_u8(r, 0.85, 1.15) for r in ratios])

    if method == "depth":
        rn, re, rs, rw = ratios
        _, (sx, sy) = groove_depth(ratios, HP)
        gx, gy = sx * (rw - re), sy * (rn - rs)
        z = integrate(gx, gy)
        curl = cv2.GaussianBlur(z, (0, 0), HP)
        rel = -(z - curl)
        d.update(gx=signed_u8(gx), gy=signed_u8(gy), height=to_u8(-z), curl=to_u8(-curl), grooves=to_u8(rel),
                 signs=(sx, sy))
    elif method == "range":
        stack = np.stack(ratios)
        mx, mn = stack.max(axis=0), stack.min(axis=0)
        rel = mx - mn
        d.update(max=to_u8(mx, 0.85, 1.25), min=to_u8(mn, 0.75, 1.15), S=to_u8(rel))
    else:
        raise ValueError(f"unknown method {method!r}")

    sm = cv2.GaussianBlur(rel, (0, 0), SMOOTH)
    hh, ww = sm.shape
    cy, cx = int(hh * (1 - CENTER) / 2), int(ww * (1 - CENTER) / 2)
    lo, hi = np.percentile(sm[cy:hh - cy, cx:ww - cx], [LO_PCT, HI_PCT])
    st = (np.clip((sm - lo) / max(hi - lo, 1e-6), 0, 1) * 255).astype(np.uint8)
    boxed = cv2.cvtColor(st, cv2.COLOR_GRAY2RGB)
    cv2.rectangle(boxed, (cx, cy), (ww - cx, hh - cy), (230, 60, 60), max(3, ww // 300))
    cl = cv2.createCLAHE(clipLimit=CLAHE, tileGridSize=(8, 8)).apply(st)
    final = 255 - cl
    check, _ = reveal(imgs, method=method, sigma=SIGMA, denoise=DENOISE, lo_pct=LO_PCT, hi_pct=HI_PCT,
                      clahe_clip=CLAHE, smooth=SMOOTH, center=CENTER, hp_sigma=HP)
    assert np.abs(check.astype(int) - final.astype(int)).max() <= 1, "stages.py drifted from reveal()"
    d.update(smooth=to_u8(sm), stretched=st, boxed=boxed, clahe=cl, final=final)
    return d


def align_note(report: list[dict] | None) -> str:
    base = ("Registered on things that look the same under every light (paper edge, printed lines, board holes), "
            "then every pair of photos is cross-checked.")
    if not report:
        return base
    parts = []
    for r in report[1:]:
        if r["check"] == "ok":
            parts.append(f"LED {r['led'] + 1} ok")
        else:
            who = {"ai": "AI", "human": "a person", "auto": "auto"}.get(r["by"], r["by"])
            parts.append(f"LED {r['led'] + 1} {r['check']}, decided by {who}")
    return base + " " + "; ".join(parts) + "."


def rows(d: dict, report: list[dict] | None = None) -> list[Row]:
    """The explainer pages (title, note, panels)."""
    out = []
    if "align_before" in d:
        out.append(("Align: the phone shifts a little every time the shutter is tapped", align_note(report),
                    [(d["align_before"], "before: mean of 4"), (d["align_after"], "after: mean of 4"),
                     (d["align_before_zoom"], "before (zoomed)"), (d["align_after_zoom"], "after (zoomed)")]))
    out.append(("Input: same paper, four low-angle lights",
                "A groove's wall facing the light is bright, the far wall dark. "
                "Each shot mostly shows strokes that run across its light direction.",
                [(im, f"LED {k + 1} ({'NESW'[k]})") for k, im in enumerate(d["lit"])]))
    out.append(("Flat-field: R = image / heavy blur(image)",
                f"Removes the brighter-near-the-LED gradient and exposure differences (blur sigma {SIGMA:g} px, "
                "far wider than a stroke). Only local shading is left.",
                [(d["raw0"], "LED 1 raw"), (d["bg0"], "its blurred background"),
                 (d["R"][0], "LED 1 corrected (R1)"), (d["R"][1], "LED 2 corrected (R2)")]))
    if d["method"] == "depth":
        out.append(("Slopes: opposite lights disagree where the paper tilts",
                    "West minus east gives the left-right slope, north minus south the up-down slope "
                    "(grey = flat). A groove shows as a bright wall next to a dark wall.",
                    [(d["gx"], "left-right slope  R(W) - R(E)"), (d["gy"], "up-down slope  R(N) - R(S)")]))
        out.append(("Integrate: add up the slopes into a height map",
                    "The FFT finds the surface whose slopes match best (Frankot-Chellappa), which also averages "
                    f"out paper-fiber speckle. Subtracting a wide blur ({HP:g} px) removes the curl of the sheet.",
                    [(d["height"], "height from the slopes"), (d["curl"], "paper curl (wide blur)"),
                     (d["grooves"], "height - curl = the grooves")]))
    else:
        out.append(("Fuse: compare the four R at every pixel",
                    "Flat paper looks the same from every side; a groove flickers as the light moves. "
                    "S = max - min is large on strokes.",
                    [(d["max"], "per-pixel max"), (d["min"], "per-pixel min"), (d["S"], "S = max - min (strokes bright)")]))
    out.append(("Enhance: smooth, stretch, local contrast, invert",
                f"Blur sigma {SMOOTH:g} hides paper-fiber speckle. Black/white points come from the red box only: "
                f"{LO_PCT:g}th percentile -> white, {HI_PCT:g}th -> black. CLAHE evens out local contrast.",
                [(d["smooth"], "smoothed"), (d["boxed"], "stretched (percentiles in red box)"),
                 (d["clahe"], "CLAHE"), (d["final"], "inverted = the fused image")]))
    return out


def write_steps(folder: Path, pages: list[Row]) -> list[str]:
    """steps.json + step_<page>_<panel>.png for the web UI. Returns the file names (json last)."""
    files, manifest = [], []
    for i, (title, note, panels) in enumerate(pages):
        entry = {"title": title, "note": note, "panels": []}
        for j, (img, caption) in enumerate(panels):
            name = f"step_{i}_{j}.png"
            h = int(img.shape[0] * STEP_W / img.shape[1])
            small = cv2.resize(img, (STEP_W, h), interpolation=cv2.INTER_AREA)
            cv2.imwrite(str(folder / name), cv2.cvtColor(small, cv2.COLOR_RGB2BGR) if small.ndim == 3 else small)
            entry["panels"].append({"file": name, "caption": caption})
            files.append(name)
        manifest.append(entry)
    (folder / "steps.json").write_text(json.dumps({"pages": manifest}, indent=1))
    return files + ["steps.json"]


def tile(img: np.ndarray, caption: str, width: int = TILE_W, caption_size: int = 18) -> Image.Image:
    h = int(img.shape[0] * width / img.shape[1])
    im = Image.fromarray(cv2.resize(img, (width, h), interpolation=cv2.INTER_AREA)).convert("RGB")
    out = Image.new("RGB", (width, h + caption_size + 16), "white")
    out.paste(im, (0, 0))
    ImageDraw.Draw(out).text((6, h + 7), caption, fill="black", font=font(caption_size))
    return out


def render_row(r: Row, tile_w: int = TILE_W, cols: int = 4, title_size: int = 28, note_size: int = 17) -> Image.Image:
    """Title, note, then the panels in a grid of `cols` columns."""
    title, note, panels = r
    tiles = [tile(img, cap, tile_w, max(18, title_size * 2 // 3)) for img, cap in panels]
    grid = [tiles[i:i + cols] for i in range(0, len(tiles), cols)]
    top = title_size + note_size + 34
    width = cols * (tile_w + 12) + 16
    out = Image.new("RGB", (width, top + sum(max(t.height for t in g) + 10 for g in grid)), "white")
    d = ImageDraw.Draw(out)
    d.text((14, 8), title, fill="black", font=font(title_size))
    d.text((14, title_size + 20), note, fill=(90, 90, 90), font=font(note_size))
    y = top
    for g in grid:
        for i, t in enumerate(g):
            out.paste(t, (14 + i * (tile_w + 12), y))
        y += max(t.height for t in g) + 10
    return out


def sheet(rows: list[Row]) -> Image.Image:
    imgs = [render_row(r) for r in rows]
    W = max(i.width for i in imgs)
    out = Image.new("RGB", (W, sum(i.height for i in imgs) + 10 * len(imgs)), "white")
    y = 0
    for i in imgs:
        out.paste(i, (0, y))
        y += i.height + 10
        ImageDraw.Draw(out).line([(14, y - 5), (W - 14, y - 5)], fill=(220, 220, 220), width=2)
    return out
