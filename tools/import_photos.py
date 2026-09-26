"""Turn four hand-taken phone photos into a scan folder: align them, then run reveal.

  python tools/import_photos.py out/test1              # photos sorted by capture time
  python tools/import_photos.py out/test1 --files n.jpg e.jpg s.jpg w.jpg
  python tools/import_photos.py out/test2 --roi 260 20 910 1910   # keep only the paper

Photos must be in N, E, S, W lighting order. Alignment details: terminator/align.py.
For the full LED-driven flow use `python -m terminator.phone` instead.

Writes <folder>_scan/ with dir_0..3.png, reveal.png, relief_raw.png, meta.json, aligned.jpg.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from terminator.align import PHOTO_EXT, assemble, capture_time  # noqa: E402
from terminator.reveal import DIRECTIONS, reveal_folder  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("folder", type=Path)
    p.add_argument("--files", nargs=4, default=None, help="explicit N E S W file names inside folder")
    p.add_argument("--out", type=Path, default=None)
    p.add_argument("--margin", type=int, default=40, help="px cropped off every side after warping")
    p.add_argument("--roi", type=int, nargs=4, metavar=("X", "Y", "W", "H"), default=None,
                   help="crop to the paper after aligning (coords in the first photo)")
    p.add_argument("--rotate", choices=["cw", "ccw", "180"], default=None,
                   help="rotate the output upright (after --roi, which is in original photo coords)")
    p.add_argument("--method", choices=["range", "depth"], default="range")
    a = p.parse_args()

    if a.files:
        files = [a.folder / f for f in a.files]
    else:
        files = sorted((f for f in a.folder.iterdir() if f.suffix.lower() in PHOTO_EXT), key=capture_time)
        if len(files) != 4:
            sys.exit(f"expected 4 photos in {a.folder}, found {len(files)}; use --files")
    print("order N, E, S, W:", *[f.name for f in files], sep="\n  ")

    out = a.out or a.folder.with_name(a.folder.name + "_scan")
    assemble(files, out, roi=a.roi, rotate=a.rotate, margin=a.margin)
    print(reveal_folder(out, method=a.method))
    (out / "meta.json").write_text(json.dumps({
        "status": "done", "directions": DIRECTIONS, "captured": [0, 1, 2, 3], "seconds": 0.0,
        "imported": [f.name for f in files]}, indent=2))


if __name__ == "__main__":
    main()
