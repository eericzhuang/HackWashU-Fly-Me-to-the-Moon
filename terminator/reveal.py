"""Turn four raking-light photos into one image of the hidden handwriting.

Idea: flat paper looks about the same no matter which side the light comes
from. An indented pen stroke does not: its wall facing the light is bright,
the other wall is in shadow, and which is which flips with the light
direction.

Common steps
  1. subtract the dark frame (ambient light), if there is one and it is sane
  2. flat-field each image: R_k = I_k / blur(I_k)
     removes the "near the LED is brighter" gradient and any exposure change
     between shots (a global gain cancels in the ratio)

method "range" (default): S = max_k R_k - min_k R_k. Needs no wiring order and
tolerates lights that aren't exactly opposite (hand-held flashlight); wide grooves
come out as outlines (a flat groove floor has no slope). Best on real paper so far.

method "depth": photometric stereo, solid strokes
  3. opposite lights give the surface slope: gx ~ R_W - R_E, gy ~ R_N - R_S
  4. integrate the slopes into a height map (Frankot-Chellappa, FFT)
     integration is a low-pass, so paper-fiber speckle drops out
  5. high-pass the height (removes paper curl), grooves = how far below local level
  6. the sign of the slopes depends on LED wiring; pick the sign combo whose
     height map has the strongest one-sided (negative) tail, i.e. sparse grooves
  Needs the four lights really at N, E, S, W; with a hand-held flashlight it lost
  every stroke parallel to one axis (out/test1, 2026-09-25). Re-test on the LED rig.

Finally: percentile stretch, CLAHE, invert -> dark strokes on white.

Usage:
  python -m terminator.reveal path/to/scan_folder [--method range|depth]
The folder must contain dir_0.png .. dir_3.png (N, E, S, W) and optionally dark.png.
Writes reveal.png (and relief_raw.png) into the same folder.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np

DIRECTIONS = ["north", "east", "south", "west"]


def load_gray(path: Path) -> np.ndarray:
    img = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise FileNotFoundError(path)
    img = img.astype(np.float32)
    if img.ndim == 3:
        # Channel mean, not the usual luma weights: under a single-color LED nearly all the
        # signal sits in one channel, and cv2's gray conversion scales blue by 0.11 (~29 levels).
        img = img[..., :3].mean(axis=2)
    return img


def flat_field(img: np.ndarray, sigma: float) -> np.ndarray:
    background = cv2.GaussianBlur(img, (0, 0), sigma)
    return img / np.maximum(background, 1.0)


def integrate(gx: np.ndarray, gy: np.ndarray) -> np.ndarray:
    """Frankot-Chellappa: least-squares height z with dz/dx ~ gx, dz/dy ~ gy.

    The slopes are mirrored into a 2x2 even extension of z first, so the FFT's
    periodic boundary doesn't wrap one edge of the page onto the other.
    """
    h, w = gx.shape
    gx = np.block([[gx, -gx[:, ::-1]], [gx[::-1], -gx[::-1, ::-1]]])
    gy = np.block([[gy, gy[:, ::-1]], [-gy[::-1], -gy[::-1, ::-1]]])
    wx = np.fft.fftfreq(2 * w) * 2 * np.pi
    wy = np.fft.fftfreq(2 * h) * 2 * np.pi
    WX, WY = np.meshgrid(wx, wy)
    denom = WX ** 2 + WY ** 2
    denom[0, 0] = 1.0
    Z = (-1j * WX * np.fft.fft2(gx) - 1j * WY * np.fft.fft2(gy)) / denom
    Z[0, 0] = 0.0
    return np.real(np.fft.ifft2(Z))[:h, :w].astype(np.float32)


def skewness(x: np.ndarray) -> float:
    x = x.ravel().astype(np.float64)
    x = x - x.mean()
    return float((x ** 3).mean() / max(x.var(), 1e-12) ** 1.5)


def groove_depth(ratios: list[np.ndarray], hp_sigma: float) -> tuple[np.ndarray, tuple[int, int]]:
    """Height map of the grooves (positive = pressed in) and the slope signs used."""
    rn, re, rs, rw = ratios
    gx, gy = rw - re, rn - rs
    best = None
    for sx in (1, -1):
        for sy in (1, -1):
            z = integrate(sx * gx, sy * gy)
            z -= cv2.GaussianBlur(z, (0, 0), hp_sigma)
            sk = skewness(z)
            if best is None or sk < best[0]:
                best = (sk, -z, (sx, sy))
    return best[1], best[2]


def reveal(
    images: list[np.ndarray],
    dark: np.ndarray | None = None,
    method: str = "range",
    sigma: float = 40.0,
    denoise: int = 3,
    lo_pct: float = 85.0,
    hi_pct: float = 99.5,
    clahe_clip: float = 1.0,
    smooth: float = 1.5,
    hp_sigma: float = 15.0,
    center: float = 0.5,
) -> tuple[np.ndarray, np.ndarray]:
    """Return (reveal_u8, relief_float).

    images: dir_0..dir_3 in N, E, S, W order (method "range" accepts any number >= 2).
    reveal_u8: uint8 image, dark strokes on white, ready to show or send to AI.
    relief_float: raw stroke-strength map, useful for debugging.
    """
    if len(images) < 2:
        raise ValueError("need at least two light directions")
    if method == "depth" and len(images) != 4:
        raise ValueError("method 'depth' needs exactly four images in N, E, S, W order")

    if dark is not None and np.median(dark) > 0.5 * min(np.median(i) for i in images):
        # Auto-exposure cranked the gain up for the dark shot; subtracting it would eat the signal.
        print("warning: dark frame is too bright relative to the lit shots, not subtracting it")
        dark = None

    ratios = []
    for img in images:
        if dark is not None:
            img = np.clip(img - dark, 1.0, None)
        if denoise > 1:
            img = cv2.medianBlur(img.astype(np.float32), denoise)
        ratios.append(flat_field(img, sigma))

    if method == "depth":
        relief, signs = groove_depth(ratios, hp_sigma)
        if signs != (1, 1):
            print(f"note: light order looks mirrored (slope signs {signs}); compensated automatically")
    elif method == "range":
        stack = np.stack(ratios)
        relief = stack.max(axis=0) - stack.min(axis=0)
    else:
        raise ValueError(f"unknown method {method!r}")
    if smooth > 0:
        relief = cv2.GaussianBlur(relief, (0, 0), smooth)

    # Percentiles from the central part only: the writing is there, while whatever else is in
    # frame (a breadboard, the paper's edge, cables) changes wildly between lights and would
    # otherwise set the black point and wash the strokes out.
    h, w = relief.shape
    cy, cx = int(h * (1 - center) / 2), int(w * (1 - center) / 2)
    lo, hi = np.percentile(relief[cy:h - cy, cx:w - cx] if center < 1 else relief, [lo_pct, hi_pct])
    norm = np.clip((relief - lo) / max(hi - lo, 1e-6), 0.0, 1.0)
    u8 = (norm * 255).astype(np.uint8)
    if clahe_clip > 0:
        u8 = cv2.createCLAHE(clipLimit=clahe_clip, tileGridSize=(8, 8)).apply(u8)
    return 255 - u8, relief


def reveal_folder(folder: Path, **kwargs) -> Path:
    folder = Path(folder)
    images = [load_gray(folder / f"dir_{k}.png") for k in range(4)]
    dark_path = folder / "dark.png"
    dark = load_gray(dark_path) if dark_path.exists() else None
    out, relief = reveal(images, dark=dark, **kwargs)
    cv2.imwrite(str(folder / "reveal.png"), out)
    raw = cv2.normalize(relief, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    cv2.imwrite(str(folder / "relief_raw.png"), raw)
    return folder / "reveal.png"


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("folder", type=Path)
    p.add_argument("--method", choices=["range", "depth"], default="range")
    p.add_argument("--sigma", type=float, default=40.0, help="flat-field blur, px (bigger than stroke width)")
    p.add_argument("--hp", type=float, default=15.0, help="depth high-pass, px (a few x stroke width)")
    p.add_argument("--denoise", type=int, default=3, help="median filter size, odd, 0 to disable")
    p.add_argument("--lo", type=float, default=85.0, help="lower percentile mapped to white")
    p.add_argument("--hi", type=float, default=99.5, help="upper percentile mapped to black")
    p.add_argument("--smooth", type=float, default=1.5, help="Gaussian sigma on relief map, 0 to disable")
    p.add_argument("--clahe", type=float, default=1.0, help="CLAHE clip limit, 0 to disable")
    p.add_argument("--center", type=float, default=0.5,
                   help="fraction of width/height (centered) used to set the contrast stretch; 1 = all")
    a = p.parse_args()
    out = reveal_folder(a.folder, method=a.method, sigma=a.sigma, hp_sigma=a.hp, denoise=a.denoise,
                        lo_pct=a.lo, hi_pct=a.hi, clahe_clip=a.clahe, smooth=a.smooth,
                        center=a.center)
    print(out)


if __name__ == "__main__":
    main()
