"""Phone scan: the Mac drives the LEDs and cues you; you tap the shutter in the phone's own
Camera app (Night mode works); each photo is pulled over the USB cable into the scan folder.

  python -m terminator.phone                  # phone on USB, Arduino on USB
  python -m terminator.phone --min-on 8       # keep each LED on at least 8 s
  python -m terminator.phone --rotate cw      # rotate the final images upright
  python -m terminator.phone --no-show        # no live window

A window (terminator.viewer) animates the capture, then waits on "READY"; the presenter flips
through the processing steps and the reveal with SPACE / arrows (a hint pulses when a page's
--slide-second animation is done). explain.png is saved too.

Paper crop and rotation default to rig.json (repo root), so a fixed setup needs no flags:
  {"roi": [x, y, w, h], "rotate": "ccw"}   roi in the first photo's pixels after shrinking to 2400 px

Per LED: light it, chime + say the number, wait until a new photo shows up in the phone's
DCIM (the LED stays on through a long Night-mode exposure) and at least --min-on seconds
have passed, copy the photo, move on. Afterwards the photos are aligned (terminator.align),
combined (terminator.reveal) and published to out/latest like terminator.scan does.

First run: unlock the phone and tap "Trust" when it asks about this computer.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import subprocess
import time
from datetime import datetime
from pathlib import Path, PurePosixPath

import cv2

from .align import ROTATIONS, assemble
from .capture import LedBoard
from .reveal import DIRECTIONS, load_gray, reveal_folder
from .scan import OUT, publish, write_meta
from .stages import compute, rows, sheet, unaligned

PHOTO_SUFFIXES = {".heic", ".jpg", ".jpeg"}
RIG = Path(__file__).resolve().parent.parent / "rig.json"


class Phone:
    """New photos in the iPhone's camera roll, read over USB (AFC, no jailbreak needed)."""

    async def __aenter__(self) -> "Phone":
        from pymobiledevice3.lockdown import create_using_usbmux
        from pymobiledevice3.services.afc import AfcService

        try:
            self.lockdown = await create_using_usbmux(autopair=True)
        except Exception as e:  # no device, not trusted, locked...
            raise RuntimeError(f"can't reach the iPhone over USB ({type(e).__name__}: {e}). "
                               "Plug it in, unlock it and tap Trust.") from None
        self.afc = await AfcService(self.lockdown).__aenter__()
        return self

    async def __aexit__(self, *exc) -> None:
        await self.afc.aclose()

    async def photos(self, newest_dirs: int | None = None) -> set[str]:
        dirs = sorted(d for d in await self.afc.listdir("/DCIM") if d[:3].isdigit())
        if newest_dirs:
            dirs = dirs[-newest_dirs:]
        found = set()
        for d in dirs:
            for f in await self.afc.listdir(f"/DCIM/{d}"):
                if PurePosixPath(f).suffix.lower() in PHOTO_SUFFIXES:
                    found.add(f"/DCIM/{d}/{f}")
        return found

    async def wait_new(self, known: set[str], timeout: float) -> str:
        """Path of the first photo not in known, once its size has stopped changing."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            new = sorted((await self.photos(newest_dirs=2)) - known)
            if new:
                path = new[-1]
                size = -1
                while True:
                    s = int((await self.afc.stat(path))["st_size"])
                    if s == size and s > 0:
                        return path
                    size = s
                    await asyncio.sleep(0.5)
            await asyncio.sleep(0.3)
        raise TimeoutError("no new photo arrived")

    async def read(self, path: str) -> bytes:
        return await self.afc.get_file_contents(path)


def cue(k: int) -> None:
    """Chime and say the shot number, without blocking."""
    subprocess.Popen(["afplay", "/System/Library/Sounds/Glass.aiff"])
    subprocess.Popen(["say", str(k + 1)])


def to_png(src: Path, dst: Path) -> None:
    """Phone photo -> PNG preview for the UI (sips handles HEIC and applies EXIF rotation)."""
    subprocess.run(["sips", "-Z", "2400", "-s", "format", "png", str(src), "--out", str(dst)],
                   check=True, capture_output=True)


async def run(board, phone, min_on: float = 5.0, timeout: float = 60.0, roi=None, rotate: str | None = None,
              method: str = "range", view=None, slide: float = 4.5) -> Path:
    t0 = time.time()
    folder = OUT / datetime.now().strftime("scan_%Y%m%d_%H%M%S")
    raw = folder / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    meta = {"status": "capturing", "directions": DIRECTIONS, "captured": [], "source": "phone",
            "started": datetime.now().isoformat()}
    write_meta(folder, meta)
    publish(folder, "meta.json")

    known = await phone.photos()
    shots = []
    board.off()
    try:
        for k in range(4):
            board.light(k)
            lit = time.time()
            cue(k)
            if view:
                view.board(k, f"LED {k + 1} on: take photo {k + 1} now")
            print(f"[{time.time() - t0:5.1f}s] LED {k + 1} ({DIRECTIONS[k]}) on - take photo {k + 1} now")
            path = await phone.wait_new(known, timeout)
            known.add(path)
            await asyncio.sleep(max(0.0, min_on - (time.time() - lit)))
            dst = raw / f"{k}_{PurePosixPath(path).name}"
            dst.write_bytes(await phone.read(path))
            shots.append(dst)
            # Unaligned preview so the UI can show each direction as it lands; replaced below.
            to_png(dst, folder / f"dir_{k}.png")
            meta["captured"].append(k)
            write_meta(folder, meta)
            publish(folder, f"dir_{k}.png", "meta.json")
            print(f"[{time.time() - t0:5.1f}s]   got {PurePosixPath(path).name}")
            if view:
                preview = cv2.cvtColor(cv2.imread(str(folder / f"dir_{k}.png")), cv2.COLOR_BGR2RGB)
                view.photos[k] = cv2.rotate(preview, ROTATIONS[rotate]) if rotate else preview
                view.board(k, f"got photo {k + 1}")
    finally:
        board.off()

    print(f"[{time.time() - t0:5.1f}s] aligning and combining")
    if view:
        view.processing()
    # Worker thread, so the window keeps repainting meanwhile.
    await asyncio.to_thread(assemble, shots, folder, roi=roi, rotate=rotate)
    await asyncio.to_thread(reveal_folder, folder, method=method)
    meta.update(status="done", seconds=round(time.time() - t0, 2))
    write_meta(folder, meta)
    publish(folder, *[f"dir_{k}.png" for k in range(4)], "reveal.png", "relief_raw.png", "meta.json")
    print(f"[{time.time() - t0:5.1f}s] done")

    # Explain the processing (after "done" is published, so the web UI/AI never wait on it):
    # an animated scene per step in the window, and the same steps saved as explain.png.
    imgs = [load_gray(folder / f"dir_{k}.png") for k in range(4)]
    before = await asyncio.to_thread(unaligned, shots, roi, rotate) if roi else None
    d = await asyncio.to_thread(compute, imgs, before)
    await asyncio.to_thread(lambda: sheet(rows(d)).save(folder / "explain.png"))
    if view:
        await view.present(d, slide)
    return folder


async def amain(a: argparse.Namespace) -> Path:
    board = LedBoard(a.port)
    try:
        async with Phone() as phone:
            if not a.show:
                return await run(board, phone, a.min_on, a.timeout, a.roi, a.rotate, a.method)
            from .viewer import Viewer
            async with Viewer() as view:
                return await run(board, phone, a.min_on, a.timeout, a.roi, a.rotate, a.method, view, a.slide)
    finally:
        board.close()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--port", default=None)
    p.add_argument("--min-on", type=float, default=5.0, help="minimum seconds each LED stays on")
    p.add_argument("--timeout", type=float, default=60.0, help="give up if no photo arrives within this")
    p.add_argument("--roi", type=int, nargs=4, metavar=("X", "Y", "W", "H"), default=None,
                   help="crop to the paper, in the first photo's pixel coords after shrinking to 2400 px")
    p.add_argument("--rotate", choices=["cw", "ccw", "180"], default=None)
    p.add_argument("--method", choices=["range", "depth"], default="range")
    p.add_argument("--no-show", dest="show", action="store_false", help="no live window")
    p.add_argument("--slide", type=float, default=4.5, help="seconds per processing-step animation")
    a = p.parse_args()
    rig = json.loads(RIG.read_text()) if RIG.exists() else {}
    a.roi = a.roi or rig.get("roi")
    a.rotate = a.rotate or rig.get("rotate")
    print(asyncio.run(amain(a)) / "reveal.png")


if __name__ == "__main__":
    main()
