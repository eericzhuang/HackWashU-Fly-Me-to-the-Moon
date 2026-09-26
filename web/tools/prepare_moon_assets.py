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
