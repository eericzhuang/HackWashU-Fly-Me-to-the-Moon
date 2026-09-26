"""One full scan: dark frame + four directions -> reveal.png.

  python -m terminator.scan                 # auto-detect Arduino, camera 0
  python -m terminator.scan --port COM3 --camera 1
  python -m terminator.scan --manual        # no Arduino: prompts you to move a flashlight
  python -m terminator.scan --list-cameras  # snapshot every camera index into out/cameras/
  python -m terminator.scan --aim           # all LEDs on + live preview to place paper/camera
                                            # (press r to drag a crop box; prints the --roi to use)

Output (this is the contract with the web/AI side):
  out/scan_YYYYmmdd_HHMMSS/
      dark.png  dir_0.png  dir_1.png  dir_2.png  dir_3.png
      reveal.png  relief_raw.png  meta.json
  out/latest/    same files, overwritten on every scan
meta.json has status "capturing" while images arrive and "done" at the end,
plus "captured": [...] so a UI can show each direction as it lands.
In out/latest, meta.json is always replaced last, so any file it lists is complete.
"""
from __future__ import annotations

import argparse
import json
import shutil
import time
from datetime import datetime
from pathlib import Path

import cv2

from .capture import Camera, LedBoard, ManualBoard, list_cameras
from .reveal import DIRECTIONS, reveal_folder

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
LATEST = OUT / "latest"


def crop(img, roi):
    if roi is None:
        return img
    x, y, w, h = roi
    return img[y:y + h, x:x + w]


def write_meta(folder: Path, meta: dict) -> None:
    tmp = folder / "meta.json.tmp"
    tmp.write_text(json.dumps(meta, indent=2))
    tmp.replace(folder / "meta.json")


def publish(folder: Path, *names: str) -> None:
    """Mirror files into out/latest, each via tmp + rename. meta.json goes last so the UI
    never sees a direction in "captured" before its image is fully there."""
    LATEST.mkdir(parents=True, exist_ok=True)
    for name in sorted(names, key=lambda n: n == "meta.json"):
        tmp = LATEST / f"{name}.tmp"
        shutil.copy2(folder / name, tmp)
        tmp.replace(LATEST / name)


def aim(board: LedBoard | ManualBoard, cam: Camera) -> None:
    board.all_on()
    print("Aim mode: all LEDs on. In the preview: r = drag a crop box, q = quit.")
    title = "aim (r = select roi, q = quit)"
    while True:
        frame = cam.preview()
        cv2.imshow(title, frame)
        key = cv2.waitKey(30) & 0xFF
        if key == ord("r"):
            x, y, w, h = cv2.selectROI(title, frame, showCrosshair=False)
            if w and h:
                print(f"--roi {x} {y} {w} {h}")
        elif key == ord("q"):
            break
    cv2.destroyAllWindows()
    board.off()


def scan(board: LedBoard | ManualBoard, cam: Camera, roi=None, n_avg: int = 5, settle: float = 5.0,
         method: str = "range") -> Path:
    t0 = time.time()
    folder = OUT / datetime.now().strftime("scan_%Y%m%d_%H%M%S")
    folder.mkdir(parents=True, exist_ok=True)
    meta = {"status": "capturing", "directions": DIRECTIONS, "captured": [], "started": datetime.now().isoformat()}
    write_meta(folder, meta)
    # Older files stay in out/latest until overwritten (deleting them would 404 a reader that
    # just saw the previous "done"); meta.json says which ones belong to this scan.
    publish(folder, "meta.json")

    board.off()
    print(f"[{time.time() - t0:5.1f}s] dark frame")
    cv2.imwrite(str(folder / "dark.png"), crop(cam.grab(n_avg, settle), roi))
    publish(folder, "dark.png")
    for k in range(4):
        board.light(k)
        print(f"[{time.time() - t0:5.1f}s] LED {k} ({DIRECTIONS[k]})")
        cv2.imwrite(str(folder / f"dir_{k}.png"), crop(cam.grab(n_avg, settle), roi))
        meta["captured"].append(k)
        write_meta(folder, meta)
        publish(folder, f"dir_{k}.png", "meta.json")
    board.off()

    print(f"[{time.time() - t0:5.1f}s] combining")
    reveal_folder(folder, method=method)
    meta.update(status="done", seconds=round(time.time() - t0, 2))
    write_meta(folder, meta)
    publish(folder, "reveal.png", "relief_raw.png", "meta.json")
    return folder


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--port", default=None)
    p.add_argument("--camera", type=int, default=0)
    p.add_argument("--exposure", type=float, default=None, help="manual exposure value, camera-specific")
    p.add_argument("--roi", type=int, nargs=4, metavar=("X", "Y", "W", "H"), default=None)
    p.add_argument("--avg", type=int, default=5, help="frames averaged per shot")
    p.add_argument("--settle", type=float, default=5.0, help="seconds to wait after switching LED before shooting")
    p.add_argument("--rotate", choices=["cw", "ccw", "180"], default=None, help="rotate camera frames upright")
    p.add_argument("--method", choices=["range", "depth"], default="range", help="see terminator.reveal")
    p.add_argument("--aim", action="store_true")
    p.add_argument("--manual", action="store_true", help="no Arduino; you move a flashlight when prompted")
    p.add_argument("--list-cameras", action="store_true")
    a = p.parse_args()

    if a.list_cameras:
        list_cameras(OUT / "cameras")
        return
    board = ManualBoard() if a.manual else LedBoard(a.port)
    cam = Camera(a.camera, exposure=a.exposure, rotate=a.rotate)
    try:
        if a.aim:
            aim(board, cam)
        else:
            print(scan(board, cam, a.roi, a.avg, a.settle, a.method) / "reveal.png")
    finally:
        board.close()
        cam.close()


if __name__ == "__main__":
    main()
