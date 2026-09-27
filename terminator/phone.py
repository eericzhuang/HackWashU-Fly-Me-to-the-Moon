"""Phone scan: the Mac drives the LEDs and cues you; you tap the shutter in the phone's own
Camera app (Night mode works); each photo is pulled over the USB cable into the scan folder.

  python -m terminator.phone                  # phone on USB, Arduino on USB; web UI shows the show
  python -m terminator.phone --quiet          # no chime / spoken number (the web UI has its own sound)
  python -m terminator.phone --min-on 8       # keep each LED on at least 8 s
  python -m terminator.phone --review human   # doubtful alignments: ask a person (default: off, automatic)
  python -m terminator.phone --redo out/scan_20260926_214156   # re-align + recombine a past scan's raw/

Paper crop and rotation default to rig.json (repo root), so a fixed setup needs no flags:
  {"roi": [x, y, w, h], "rotate": "ccw", "ref": 3}   roi in photo `ref`'s pixels (2400 px frame);
  ref = the photo the others are aligned to (3 = the last one, once the phone has settled)

Per LED: light it, chime + say the number, wait until a new photo shows up in the phone's
DCIM (the LED stays on through a long Night-mode exposure) and at least --min-on seconds
have passed, copy the photo, move on. Afterwards the photos are aligned (terminator.align;
doubtful ones go to terminator.review: AI, then a person in the web UI), combined
(terminator.reveal), explained step by step (terminator.stages -> steps.json + step_*.png)
and published to out/latest like terminator.scan does. The web UI (web/) is the screen.

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
import numpy as np

from .align import ROTATIONS, assemble, load, locate_roi
from .capture import LedBoard
from .relight import best as best_relight
from .reveal import DIRECTIONS, load_gray, reveal_folder
from .review import Reviewer
from .scan import LATEST, OUT, publish, write_meta
from .stages import compute, rows, sheet, unaligned, write_steps

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


def cue(k: int, quiet: bool = False) -> None:
    """Chime and say the shot number, without blocking. quiet: nothing (the web UI plays its own cues)."""
    if quiet:
        return
    subprocess.Popen(["afplay", "/System/Library/Sounds/Glass.aiff"])
    subprocess.Popen(["say", str(k + 1)])


def camera_mode(path: Path) -> tuple[float | None, int | None, float | None]:
    """(digital zoom, ISO, exposure s) from EXIF. Under a dim LED the iPhone switches to another
    sensor mode (ISO 1000, digital zoom 4.33 instead of 2.17): that photo is blurrier and offset
    ~96 px from the others, which spoiled several scans on 2026-09-26. AE/AF lock prevents it."""
    try:
        from PIL import Image
        sub = Image.open(path).getexif().get_ifd(0x8769)
        return sub.get(41988), sub.get(34855), sub.get(33434)
    except Exception:
        return None, None, None


def check_modes(shots: list[Path]) -> bool:
    modes = [camera_mode(s) for s in shots]
    zooms = {round(float(z), 2) for z, _, _ in modes if z is not None}
    if len(zooms) > 1:
        print("  WARNING: the photos were taken in different camera modes "
              + ", ".join(f"photo {k + 1}: zoom {float(z):.2f} ISO {iso}" for k, (z, iso, _) in enumerate(modes))
              + ". Long-press the screen for AE/AF LOCK (and make the LEDs equally bright), then retake.")
        return False
    return True


def to_png(src: Path, dst: Path, roi=None, rotate: str | None = None) -> None:
    """Phone photo -> PNG preview for the UI, cropped to the paper and turned upright like the
    final images (roi is in the same 2400 px frame as align.assemble uses)."""
    img = load(src, 2400)
    if roi:
        x, y, w, h = roi
        img = img[y:y + h, x:x + w]
    if rotate:
        img = cv2.rotate(img, ROTATIONS[rotate])
    cv2.imwrite(str(dst), img.astype(np.uint8))


async def run(board, phone, min_on: float = 5.0, timeout: float = 60.0, roi=None, rotate: str | None = None,
              method: str = "depth", quiet: bool = False, review: str = "ai", review_timeout: float = 90.0,
              ref: int = 0) -> Path:
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
            cue(k, quiet)
            print(f"[{time.time() - t0:5.1f}s] LED {k + 1} ({DIRECTIONS[k]}) on - take photo {k + 1} now")
            path = await phone.wait_new(known, timeout)
            known.add(path)
            await asyncio.sleep(max(0.0, min_on - (time.time() - lit)))
            dst = raw / f"{k}_{PurePosixPath(path).name}"
            dst.write_bytes(await phone.read(path))
            shots.append(dst)
            # Preview so the UI can show each direction as it lands; replaced by the aligned one.
            to_png(dst, folder / f"dir_{k}.png", roi, rotate)
            meta["captured"].append(k)
            write_meta(folder, meta)
            publish(folder, f"dir_{k}.png", "meta.json")
            print(f"[{time.time() - t0:5.1f}s]   got {PurePosixPath(path).name}")
    finally:
        board.off()

    print(f"[{time.time() - t0:5.1f}s] aligning and combining")
    await asyncio.to_thread(finish, folder, shots, meta, roi, rotate, method, review, review_timeout, t0, ref)
    return folder


def finish(folder: Path, shots: list[Path], meta: dict, roi, rotate: str | None, method: str = "depth",
           review: str = "ai", review_timeout: float = 90.0, t0: float | None = None, ref: int = 0) -> None:
    """Align (asking for help when unsure), combine, write the step pages, publish "done".
    Blocking; terminator.phone runs it in a worker thread."""
    t0 = t0 or time.time()

    def show_review(r: dict | None, files: list[str]) -> None:
        if r is None:
            meta.pop("review", None)
        else:
            meta["review"] = r
        write_meta(folder, meta)
        publish(folder, *files, "meta.json")

    # Put back slightly differently? Find the crop again on the reference photo by matching it to
    # the photo the crop was picked on (rig.json "template"); too different -> keep rig.json's crop.
    meta["same_camera_mode"] = check_modes(shots)
    rig = json.loads(RIG.read_text()) if RIG.exists() else {}
    template = RIG.parent / rig["template"] if rig.get("template") else None
    if roi and template and template.exists():
        found, _, cc = locate_roi(shots[ref], template, rig.get("roi", roi))
        if cc >= 0.5:
            print(f"  crop found on photo {ref + 1}: {found} (match {cc:.2f}; rig.json has {rig.get('roi')})")
            roi = found
        else:
            print(f"  WARNING: photo {ref + 1} doesn't match the template (match {cc:.2f}); phone or paper moved a lot."
                  f" Using rig.json's crop {roi}")
        meta["roi"] = roi
    reviewer = Reviewer(folder, show_review, LATEST / "review_answer.json", review, review_timeout)
    report = assemble(shots, folder, roi=roi, rotate=rotate, review=reviewer, ref=ref)
    reveal_folder(folder, method=method)
    # The final image is the page relit by the virtual sun Google reads best (terminator.relight),
    # like "hold the sun" in the web UI; the fused image stays as reveal_fused.png.
    imgs = [load_gray(folder / f"dir_{k}.png") for k in range(4)]
    (folder / "reveal.png").replace(folder / "reveal_fused.png")
    lit = best_relight(imgs)
    cv2.imwrite(str(folder / "reveal.png"), lit["image"])
    print(f"[{time.time() - t0:5.1f}s] clearest sun: azimuth {lit['azimuth']:.0f}, elevation {lit['elevation']:.0f} "
          f"-> {lit['text']!r} ({len(lit['tried'])} tried, by {lit['by']}); drawing the steps")

    # The step pages go out with "done", so the web UI can walk through them before the reveal.
    before = unaligned(shots, roi, rotate) if roi else None
    d = compute(imgs, before, method)
    pages = rows(d, report)
    pages.append(("Relight: pick the sun that reads best",
                  f"The four photos give the slope at every point, so the page can be lit from any side. "
                  f"{len(lit['tried'])} virtual suns were tried and read by the AI; this one reads clearest "
                  f"(sun from {lit['azimuth']:.0f} deg, {lit['elevation']:.0f} deg above the paper).",
                  [(lit["image"], "reveal.png (sent to the AI)")]))
    step_files = write_steps(folder, pages)
    sheet(pages).save(folder / "explain.png")
    meta.pop("review", None)
    meta.update(status="done", seconds=round(time.time() - t0, 2), method=method, alignment=report,
                steps="steps.json", relight={k: lit[k] for k in ("azimuth", "elevation", "text", "by", "box")})
    write_meta(folder, meta)
    publish(folder, *[f"dir_{k}.png" for k in range(4)], "reveal.png", "relief_raw.png", *step_files, "meta.json")
    print(f"[{time.time() - t0:5.1f}s] done")


def redo(folder: Path, roi, rotate: str | None, method: str, review: str, review_timeout: float, ref: int = 0) -> None:
    """Re-run finish() on a past scan's raw/ photos (new crop, new method...) and publish it as a
    fresh scan, so the web UI plays it again."""
    shots = sorted((folder / "raw").iterdir())
    if len(shots) != 4:
        raise SystemExit(f"{folder}/raw needs exactly 4 photos, found {len(shots)}")
    meta = {"status": "capturing", "directions": DIRECTIONS, "captured": [0, 1, 2, 3], "source": "phone",
            "started": datetime.now().isoformat(), "redo": folder.name}
    for k, s in enumerate(shots):
        to_png(s, folder / f"dir_{k}.png", roi, rotate)
    write_meta(folder, meta)
    publish(folder, *[f"dir_{k}.png" for k in range(4)], "meta.json")
    finish(folder, shots, meta, roi, rotate, method, review, review_timeout, ref=ref)


async def amain(a: argparse.Namespace) -> Path:
    board = LedBoard(a.port)
    try:
        async with Phone() as phone:
            return await run(board, phone, a.min_on, a.timeout, a.roi, a.rotate, a.method, a.quiet,
                             a.review, a.review_timeout, a.ref)
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
    p.add_argument("--method", choices=["range", "depth"], default="depth")
    p.add_argument("--quiet", action="store_true", help="no chime or spoken number (the web UI plays its own)")
    p.add_argument("--review", choices=["ai", "human", "off"], default="off",
                   help="doubtful alignment: off (default: phone is fixed, fully automatic); "
                        "ai = Claude first, then a person in the web UI; human = person only")
    p.add_argument("--review-timeout", type=float, default=90.0, help="seconds to wait for a person")
    p.add_argument("--redo", type=Path, default=None, help="re-process a past scan folder's raw/ photos")
    p.add_argument("--ref", type=int, choices=[0, 1, 2, 3], default=None,
                   help="photo the others are aligned to and the roi is measured in (default: rig.json, else 0)")
    a = p.parse_args()
    rig = json.loads(RIG.read_text()) if RIG.exists() else {}
    a.roi = a.roi or rig.get("roi")
    a.rotate = a.rotate or rig.get("rotate")
    a.ref = a.ref if a.ref is not None else int(rig.get("ref", 0))
    if a.redo:
        redo(a.redo, a.roi, a.rotate, a.method, a.review, a.review_timeout, a.ref)
        print(a.redo / "reveal.png")
        return
    print(asyncio.run(amain(a)) / "reveal.png")


if __name__ == "__main__":
    main()
