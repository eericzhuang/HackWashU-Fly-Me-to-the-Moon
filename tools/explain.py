"""Draw every step reveal.py takes from four photos to the final image, as one labeled PNG.

  python tools/explain.py out/latest                 # -> out/latest/explain.png
  python tools/explain.py out/scan_20260926_005757   # also shows alignment if raw/ + rig.json exist

The steps themselves live in terminator/stages.py (shared with the live window).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from terminator.reveal import load_gray  # noqa: E402
from terminator.stages import compute, rows, sheet, unaligned  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("folder", type=Path)
    p.add_argument("--out", type=Path, default=None)
    a = p.parse_args()
    f = a.folder

    imgs = [load_gray(f / f"dir_{k}.png") for k in range(4)]
    before = None
    raw = sorted((f / "raw").iterdir()) if (f / "raw").is_dir() else []
    rig_path = ROOT / "rig.json"
    if len(raw) == 4 and rig_path.exists():
        rig = json.loads(rig_path.read_text())
        before = unaligned(raw, rig["roi"], rig.get("rotate"))
    out = a.out or f / "explain.png"
    sheet(rows(compute(imgs, before))).save(out)
    print(out)


if __name__ == "__main__":
    main()
