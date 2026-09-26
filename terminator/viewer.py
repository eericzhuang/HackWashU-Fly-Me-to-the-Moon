"""Live, animated window for a phone scan (moon theme).

  capture   starfield; the photo that just landed flashes in; a light compass shows which LED
            is on (its beam sweeps across the paper); four moon icons wax to full, one per shot
  combine   the four shots crossfade while alignment runs in a worker thread, then "READY"
  explain   one animated page per processing step (terminator.stages.compute); the presenter
            flips with SPACE / arrows, a pulsing hint shows when a page's animation is done
  final     a curved lunar terminator sweeps across and the hidden message comes out of the dark

OpenCV windows must be driven from the main thread and need waitKey() to repaint, so an
asyncio task renders the current scene at ~30 fps; heavy work runs in threads meanwhile.
A scene is just a function t -> RGB float frame.

  python -m terminator.viewer out/scan_20260926_005757   # replay a past scan, no hardware
"""
from __future__ import annotations

import asyncio
import math
import time
from functools import lru_cache
from typing import Callable

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H = 1600, 900
TITLE = "Terminator"
FUTURA = "/System/Library/Fonts/Supplemental/Futura.ttc"   # the typeface on the Apollo 11 plaque
HEAVY, BOLD, DEMI, MEDIUM, REGULAR = "heavy", "bold", "demi", "medium", "regular"
FACES = {HEAVY: (2, 0.12), BOLD: (2, 0.0), DEMI: (2, 0.02), MEDIUM: (0, 0.0), REGULAR: (0, 0.0)}  # index, tracking
GOLD = (255, 214, 130)
MOON = (246, 232, 190)
LIGHT = (170, 255, 190)   # the rig's green LEDs
DIM = (150, 160, 190)
Scene = Callable[[float], np.ndarray]


# ---------------------------------------------------------------- drawing helpers

def clamp01(x: float) -> float:
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def ease(x: float) -> float:
    x = clamp01(x)
    return x * x * (3 - 2 * x)


@lru_cache(maxsize=1024)
def text(s: str, size: int, face: str = REGULAR, color: tuple = (255, 255, 255)) -> np.ndarray:
    """Rendered text as an RGBA float array (cached); HEAVY gets wide letter spacing."""
    index, track = FACES[face]
    try:
        f = ImageFont.truetype(FUTURA, size, index=index)
    except OSError:
        f = ImageFont.load_default()
    s = s or " "
    gap = size * track
    width = int(sum(f.getlength(c) for c in s) + gap * len(s)) + 4 if gap else int(f.getlength(s)) + 4
    im = Image.new("RGBA", (max(1, width), int(size * 1.35)), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if gap:
        x = 0.0
        for c in s:
            d.text((x, 0), c, font=f, fill=color + (255,))
            x += f.getlength(c) + gap
    else:
        d.text((0, 0), s, font=f, fill=color + (255,))
    return np.asarray(im, np.float32)


def blit(frame: np.ndarray, rgba: np.ndarray, x: int, y: int, alpha: float = 1.0) -> None:
    """Alpha-composite an RGBA (or RGB) float array onto the frame, clipped to its bounds."""
    h, w = rgba.shape[:2]
    x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, W), min(y + h, H)
    if x0 >= x1 or y0 >= y1 or alpha <= 0:
        return
    src = rgba[y0 - y:y1 - y, x0 - x:x1 - x]
    a = (src[..., 3:4] / 255.0 if src.shape[2] == 4 else np.ones(src.shape[:2] + (1,), np.float32)) * alpha
    dst = frame[y0:y1, x0:x1]
    dst *= 1 - a
    dst += src[..., :3] * a


def label(frame, s, x, y, size=22, face=REGULAR, color=(255, 255, 255), alpha=1.0, typed: float | None = None):
    """Draw text; `typed` in [0, 1] reveals it letter by letter."""
    if typed is not None:
        s = s[:int(len(s) * clamp01(typed))]
    if s:
        blit(frame, text(s, size, face, color), x, y, alpha)


def glow_dot(frame, cx, cy, r, color, alpha=1.0):
    """A soft glowing disc."""
    R = int(r * 3)
    yy, xx = np.mgrid[-R:R + 1, -R:R + 1].astype(np.float32)
    d = np.sqrt(xx * xx + yy * yy)
    a = np.clip(1.2 - d / r, 0, 1) + 0.6 * np.exp(-(d / (1.4 * r)) ** 2)
    rgba = np.dstack([np.full_like(d, c) for c in color] + [np.clip(a, 0, 1) * 255])
    blit(frame, rgba, int(cx) - R, int(cy) - R, alpha)


@lru_cache(maxsize=64)
def moon(lit: float, size: int, bright: bool = True) -> np.ndarray:
    """Moon icon (RGBA) lit from the right by fraction `lit` (0 new .. 1 full), antialiased."""
    s = size * 3
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32)
    u, v = (xx + 0.5) / s * 2 - 1, (yy + 0.5) / s * 2 - 1
    inside = u * u + v * v <= 1
    term = (1 - 2 * lit) * np.sqrt(np.clip(1 - v * v, 0, 1))    # the terminator curve
    on = inside & (u >= term)
    col = np.zeros((s, s, 4), np.float32)
    col[inside] = (48, 52, 72, 255)
    col[on] = MOON + (255,) if bright else (110, 110, 120, 255)
    return cv2.resize(col, (size, size), interpolation=cv2.INTER_AREA)


def starfield(seed: int = 7) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    grad = np.linspace(0, 1, H, dtype=np.float32)[:, None, None]
    base = (np.array([6, 8, 20], np.float32) * (1 - grad) + np.array([20, 16, 40], np.float32) * grad)
    base = np.broadcast_to(base, (H, W, 3)).copy()
    layers = []
    for n in (260, 140):
        m = np.zeros((H, W), np.float32)
        m[rng.integers(0, H, n), rng.integers(0, W, n)] = rng.uniform(120, 255, n)
        m = cv2.GaussianBlur(m, (0, 0), 0.9) * 3
        layers.append(np.dstack([m, m, m * 1.1]))
    return base, layers[0], layers[1]


# ---------------------------------------------------------------- viewer

class Viewer:
    def __init__(self) -> None:
        cv2.namedWindow(TITLE, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(TITLE, W, H)
        self.photos: list[np.ndarray | None] = [None] * 4
        self.landed = [0.0] * 4
        self.active: int | None = None
        self.status = ""
        self.t_start = time.time()
        self.bg, self.stars1, self.stars2 = starfield()
        self._fit: dict = {}
        self.scene: Scene = self._capture
        self.scene_t0 = time.time()
        self.hint: tuple[str, float] | None = None
        self.ready = False   # (text, show after this many seconds of the scene)
        self.keys: asyncio.Queue[int] | None = None
        self._pump: asyncio.Task | None = None

    # -- plumbing

    async def __aenter__(self) -> "Viewer":
        self.keys = asyncio.Queue()
        self._pump = asyncio.create_task(self._pump_loop())
        return self

    async def __aexit__(self, *exc) -> None:
        if self._pump:
            self._pump.cancel()

    def _render(self) -> None:
        el = time.time() - self.scene_t0
        frame = self.scene(el)
        if self.hint and el >= self.hint[1]:
            self._draw_hint(frame, self.hint[0], el - self.hint[1])
        cv2.imshow(TITLE, cv2.cvtColor(np.clip(frame, 0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR))

    def _draw_hint(self, frame, msg: str, t: float) -> None:
        """Pulsing gold pill, bottom right: this page is done, the presenter can flip."""
        chip = text(msg, 24, DEMI, (20, 20, 30))
        w, h = chip.shape[1] + 40, 46
        x, y = W - w - 36, H - h - 28
        pulse = 0.55 + 0.45 * (0.5 + 0.5 * math.sin(t * 4))
        a = ease(t * 3)
        glow_dot(frame, x + w - 20, y + h // 2, 30, GOLD, 0.25 * a * pulse)
        pill = np.zeros((h, w, 4), np.float32)
        cv2.rectangle(pill, (0, 0), (w - 1, h - 1), GOLD + (255,), -1)
        blit(frame, pill, x, y, a * pulse)
        blit(frame, chip, x + 20, y + 9, a)

    async def _pump_loop(self) -> None:
        while True:
            t = time.time()
            self._render()
            key = cv2.waitKeyEx(1)
            if key != -1:
                self.keys.put_nowait(key)
            elif cv2.getWindowProperty(TITLE, cv2.WND_PROP_VISIBLE) < 1:
                self.keys.put_nowait(27)   # window closed with the mouse
            await asyncio.sleep(max(0.005, 1 / 30 - (time.time() - t)))

    def _set(self, scene: Scene, hint: tuple[str, float] | None = None) -> None:
        self.scene, self.scene_t0, self.hint = scene, time.time(), hint

    def background(self, t: float) -> np.ndarray:
        tw1, tw2 = 0.65 + 0.35 * math.sin(t * 1.3), 0.65 + 0.35 * math.sin(t * 1.9 + 1.0)
        return self.bg + self.stars1 * tw1 + self.stars2 * tw2

    def fitted(self, img: np.ndarray, w: int, h: int) -> np.ndarray:
        """img scaled to fit w x h (aspect kept), as RGB float; cached per image and size."""
        key = (id(img), w, h)
        if key not in self._fit:
            rgb = cv2.cvtColor(img, cv2.COLOR_GRAY2RGB) if img.ndim == 2 else img
            s = min(w / rgb.shape[1], h / rgb.shape[0])
            self._fit[key] = cv2.resize(rgb, (max(1, int(rgb.shape[1] * s)), max(1, int(rgb.shape[0] * s))),
                                        interpolation=cv2.INTER_AREA).astype(np.float32)
        return self._fit[key]

    def place(self, frame, img, box, alpha=1.0, frame_color=(70, 80, 110)) -> tuple[int, int, int, int]:
        """Fit img centered in box=(x, y, w, h); returns where it landed."""
        x, y, w, h = box
        f = self.fitted(img, w, h)
        px, py = x + (w - f.shape[1]) // 2, y + (h - f.shape[0]) // 2
        blit(frame, f, px, py, alpha)
        if frame_color:
            cv2.rectangle(frame, (px - 1, py - 1), (px + f.shape[1], py + f.shape[0]), frame_color, 1)
        return px, py, f.shape[1], f.shape[0]

    def compass(self, frame, cx, cy, size, active, t, captured=None):
        """The paper seen from above, an LED on each side; the active one glows and its beam
        rakes across the paper."""
        half = size // 2
        cv2.rectangle(frame, (cx - half, cy - half), (cx + half, cy + half), (48, 52, 70), -1)
        cv2.rectangle(frame, (cx - half, cy - half), (cx + half, cy + half), (90, 100, 130), 1)
        pos = [(cx, cy - half - 34), (cx + half + 34, cy), (cx, cy + half + 34), (cx - half - 34, cy)]
        if active is not None:
            lx, ly = pos[active]
            yy, xx = np.mgrid[cy - half:cy + half, cx - half:cx + half].astype(np.float32)
            d = np.sqrt((xx - lx) ** 2 + (yy - ly) ** 2)
            pulse = 0.75 + 0.25 * math.sin(t * 5)
            a = np.exp(-(d - 34) / (size * 0.55)) * pulse
            beam = np.dstack([np.full_like(a, c) for c in LIGHT] + [np.clip(a, 0, 1) * 200])
            blit(frame, beam, cx - half, cy - half)
        for k, (x, y) in enumerate(pos):
            if k == active:
                glow_dot(frame, x, y, 12 + 2 * math.sin(t * 5), LIGHT)
            else:
                done = captured is not None and captured[k] is not None
                cv2.circle(frame, (x, y), 9, (120, 200, 140) if done else (70, 76, 96), -1)
            label(frame, str(k + 1), x - 5, y + (18 if k != 0 else -40), 18, DEMI, DIM)

    def chrome(self, frame, step: int, total: int, title: str, note: str, t: float) -> None:
        label(frame, f"STEP {step} / {total}", 40, 26, 20, DEMI, GOLD, typed=t * 4)
        label(frame, title, 40, 52, 40, BOLD, (255, 255, 255), alpha=ease(t * 3))
        label(frame, note, 42, 108, 20, REGULAR, DIM, alpha=ease(t * 2 - 0.3))
        for i in range(total):
            x = W - 40 - (total - i) * 26
            cv2.circle(frame, (x, 44), 7 if i + 1 == step else 5, GOLD if i + 1 <= step else (70, 76, 96), -1)

    # -- capture

    def board(self, active: int | None, status: str) -> None:
        self.active, self.status = active, status
        for k in range(4):
            if self.photos[k] is not None and self.landed[k] == 0:
                self.landed[k] = time.time()
        if self.scene != self._capture:
            self._set(self._capture)

    def _capture(self, t: float) -> np.ndarray:
        f = self.background(t)
        label(f, "TERMINATOR", 40, 22, 54, HEAVY, (255, 255, 255))
        label(f, "fly me to the moon  ·  reading the shadows a pen leaves behind", 44, 92, 20, REGULAR, DIM)
        box = (40, 140, 1060, 660)
        k_show = self.active if self.active is not None and self.photos[self.active] is not None else \
            max([k for k in range(4) if self.photos[k] is not None], default=None)
        if k_show is not None:
            px, py, pw, ph = self.place(f, self.photos[k_show], box)
            flash = 1 - clamp01((time.time() - self.landed[k_show]) / 0.6)
            if flash > 0:
                f[py:py + ph, px:px + pw] += (255 - f[py:py + ph, px:px + pw]) * flash * 0.85
            label(f, f"LED {k_show + 1}", px + 14, py + 10, 24, DEMI, GOLD)
        else:
            cx, cy = box[0] + box[2] // 2, box[1] + box[3] // 2
            for i in range(3):
                r = 40 + ((t * 70 + i * 60) % 180)
                cv2.circle(f, (cx, cy), int(r), tuple(int(c * (1 - (r - 40) / 180)) for c in LIGHT), 2)
            label(f, "waiting for the first photo", cx - 150, cy + 130, 24, MEDIUM, DIM)
        self.compass(f, 1330, 300, 250, self.active, t, self.photos)
        for k in range(4):
            x, y, size = 1150 + k * 95, 520, 72
            got = self.photos[k] is not None
            s = size + (int(6 * math.sin(t * 5)) if k == self.active and not got else 0)
            blit(f, moon((k + 1) / 4 if got else 0.0, s, got), x + (size - s) // 2, y + (size - s) // 2)
            label(f, str(k + 1), x + 30, y + 80, 18, DEMI, GOLD if got else DIM)
        label(f, "each light = a quarter of the moon", 1150, 640, 18, REGULAR, DIM)
        dots = "." * (int(t * 2) % 4)
        label(f, self.status + (dots if "take" in self.status or "aligning" in self.status else ""),
              40, 826, 28, DEMI, GOLD)
        el = int(time.time() - self.t_start)
        label(f, f"{el // 60:02d}:{el % 60:02d}", W - 120, 830, 26, MEDIUM, DIM)
        return f

    # -- combine

    def processing(self) -> None:
        self.active, self.status = None, "aligning and combining"
        self._set(self._processing)

    def _processing(self, t: float) -> np.ndarray:
        f = self.background(t)
        label(f, "COMBINING", 40, 22, 54, HEAVY, (255, 255, 255))
        label(f, "registering four photos  ·  fusing their shadows", 44, 92, 20, REGULAR, DIM)
        shots = [p for p in self.photos if p is not None]
        if shots:
            i = int(t * 1.5) % len(shots)
            a = ease(((t * 1.5) % 1 - 0.5) * 2)
            self.place(f, shots[i], (40, 140, 1060, 660), 1.0)
            self.place(f, shots[(i + 1) % len(shots)], (40, 140, 1060, 660), a, None)
        cx, cy = 1330, 420
        if self.ready:
            glow_dot(f, cx, cy, 60, MOON, 0.25 + 0.1 * math.sin(t * 2))
            blit(f, moon(1.0, 110), cx - 55, cy - 55)
            label(f, "done", 1296, 560, 30, DEMI, (140, 240, 160))
        else:
            for i in range(3):
                ang = t * (160 + 60 * i) + i * 120
                cv2.ellipse(f, (cx, cy), (110 - 22 * i, 110 - 22 * i), 0, ang, ang + 110, GOLD if i == 0 else LIGHT, 4 - i)
            blit(f, moon(1.0, 90), cx - 45, cy - 45)
            label(f, "aligning" + "." * (int(t * 2) % 4), 1255, 560, 26, DEMI, GOLD)
            el = int(time.time() - self.t_start)
            label(f, f"{el // 60:02d}:{el % 60:02d}", W - 120, 830, 26, MEDIUM, DIM)
        return f

    # -- explain (presenter-paced)

    async def present(self, d: dict, per_step: float = 4.5) -> None:
        """Hold on "ready", then one page per processing step and the reveal. The presenter flips:
        SPACE / ENTER / -> next, <- back, Q / ESC quit. When a page's animation has finished, a
        pulsing hint says so; pressing next before that first jumps to the page's end state."""
        self.ready = True
        self.hint = ("READY  ·  SPACE  ›  see how it works", 0.0)
        if await self._key() == "quit":
            return self._close()
        pages = []
        if "align_before" in d:
            pages.append((self._s_align, per_step))
        pages += [(self._s_light, per_step + 1.5), (self._s_flat, per_step),
                  (self._s_fuse, per_step + 0.5), (self._s_enhance, per_step + 1.0)]
        i = 0
        while True:
            if i < len(pages):
                make, dur = pages[i]
                self._set(make(d, i + 1, len(pages), dur), ("SPACE  ›  next", dur))
            else:
                dur = 4.0
                self._set(self._final_scene(d["final"]), ("SPACE  ›  close", dur))
            while True:
                k = await self._key()
                if k == "quit":
                    return self._close()
                if k == "back" and i > 0:
                    i -= 1
                    break
                if k == "next":
                    if time.time() - self.scene_t0 < dur:
                        self.scene_t0 = time.time() - dur      # fast-forward to the page's end
                        continue
                    i += 1
                    break
            if i > len(pages):
                return self._close()

    async def _key(self) -> str:
        while True:
            k = await self.keys.get()
            if k in (32, 13, 3, ord("n"), 63235, 2555904, 65363):   # space, enter, right arrow (mac/win/linux)
                return "next"
            if k in (ord("b"), 63234, 2424832, 65361):                # left arrow
                return "back"
            if k in (27, ord("q")):
                return "quit"

    def _close(self) -> None:
        cv2.destroyWindow(TITLE)
        cv2.waitKey(1)

    def _s_align(self, d, step, total, T) -> Scene:
        def scene(t):
            f = self.background(t) * 0.6
            self.chrome(f, step, total, "Align the four shots",
                        "The phone shifts a little at every tap. Registered on the paper edge and breadboard holes.", t)
            m = ease((t - 0.4 * T) / (0.12 * T))
            for b, a, box in ((d["align_before"], d["align_after"], (40, 170, 980, 620)),
                              (d["align_before_zoom"], d["align_after_zoom"], (1050, 170, 510, 620))):
                self.place(f, b, box, 1 - m)
                self.place(f, a, box, m, None)
            col = (255, 110, 110) if m < 0.5 else (140, 240, 160)
            label(f, "stacked as-is: strokes doubled" if m < 0.5 else "ALIGNED: strokes coincide",
                  40, 815, 30, DEMI, col)
            return f
        return scene

    def _s_light(self, d, step, total, T) -> Scene:
        lit = d["lit"]

        def scene(t):
            f = self.background(t) * 0.6
            self.chrome(f, step, total, "Four low-angle lights",
                        "A groove's wall facing the light shines, the far wall falls into shadow. Watch them move.", t)
            p = 0.9
            k, fr = int(t / p) % 4, (t / p) % 1
            box = (40, 170, 1180, 620)
            self.place(f, lit[k], box)
            if fr > 0.65:
                self.place(f, lit[(k + 1) % 4], box, ease((fr - 0.65) / 0.35), None)
            self.compass(f, 1390, 430, 220, k, t)
            label(f, f"LED {k + 1} on", 1320, 610, 28, DEMI, GOLD)
            return f
        return scene

    def _s_flat(self, d, step, total, T) -> Scene:
        def scene(t):
            f = self.background(t) * 0.6
            self.chrome(f, step, total, "Flat-field: divide out the lamp",
                        "R = image / heavy blur(image) removes the bright-near-the-LED gradient; only local shading stays.", t)
            px, py, pw, ph = self.place(f, d["raw0"], (40, 170, 1520, 560))
            r0 = self.fitted(d["R"][0], 1520, 560)
            split = int(pw * ease((t - 0.5) / (0.6 * T)))
            if split > 0:
                blit(f, r0[:, :split], px, py)
                band = np.exp(-((np.arange(-40, 41, dtype=np.float32)) / 12) ** 2)[None, :, None]
                glow = np.dstack([np.full((ph, 81), c, np.float32) for c in GOLD] + [np.repeat(band[..., 0] * 255, ph, 0)])
                blit(f, glow, px + split - 40, py)
            label(f, "corrected", px + 14, py + 10, 24, DEMI, GOLD, alpha=clamp01(split / 200))
            label(f, "raw", px + pw - 70, py + 10, 24, DEMI, DIM, alpha=1 - clamp01((split - pw + 200) / 200))
            self.place(f, d["bg0"], (330, 748, 300, 100), ease(t * 2))
            label(f, "divided by this blur", 40, 780, 26, DEMI, (255, 255, 255), alpha=ease(t * 2))
            return f
        return scene

    def _s_fuse(self, d, step, total, T) -> Scene:
        R, S = d["R"], d["S"]

        def scene(t):
            f = self.background(t) * 0.6
            self.chrome(f, step, total, "Fuse: what changes with the light?",
                        "Flat paper looks the same from every side; a groove flickers. Keep the per-pixel change.", t)
            m = ease((t - 0.25 * T) / (0.35 * T))
            tw, th = 360, 150
            cx, cy = W // 2, 520
            for k in range(4):
                x0, y0 = 40 + k * (tw + 27), 160
                x = int(x0 + (cx - tw // 2 - x0) * m)
                y = int(y0 + (cy - th // 2 - y0) * m)
                s = 1 - 0.6 * m
                im = self.fitted(R[k], int(tw * s) or 1, int(th * s) or 1)
                blit(f, im, x + int(tw * (1 - s) / 2), y + int(th * (1 - s) / 2), 1 - 0.8 * m)
                label(f, f"R{k + 1}", x + 6, y + 4, 18, DEMI, GOLD, alpha=1 - m)
            a = ease((t - 0.45 * T) / (0.25 * T))
            if a > 0:
                self.place(f, S, (40, 330, 1520, 420), a)
            label(f, "S  =  max(R1 .. R4)  -  min(R1 .. R4)", 40, 790, 34, BOLD, GOLD,
                  typed=(t - 0.55 * T) / (0.25 * T))
            return f
        return scene

    def _s_enhance(self, d, step, total, T) -> Scene:
        seq = [(d["S"], "fused"), (d["smooth"], "smooth"), (d["boxed"], "stretch"),
               (d["clahe"], "local contrast"), (d["final"], "invert")]

        def scene(t):
            f = self.background(t) * 0.6
            self.chrome(f, step, total, "Enhance for the reader",
                        "Smooth out paper-fiber speckle, set black/white from the center (red box), even local contrast, invert.", t)
            seg = T / len(seq)
            i = min(int(t / seg), len(seq) - 1)
            fr = (t - i * seg) / seg
            box = (40, 220, 1520, 560)
            self.place(f, seq[i][0], box)
            if i + 1 < len(seq) and fr > 0.7:
                self.place(f, seq[i + 1][0], box, ease((fr - 0.7) / 0.3), None)
            x = 40
            for j, (_, name) in enumerate(seq[1:], start=1):
                on = j <= i
                chip = text(name, 22, DEMI, (20, 20, 30) if on else DIM)
                w = chip.shape[1] + 28
                cv2.rectangle(f, (x, 162), (x + w, 200), GOLD if on else (60, 66, 88), -1 if on else 1)
                blit(f, chip, x + 14, 166)
                x += w + 14
            return f
        return scene

    # -- final

    def final(self, reveal: np.ndarray) -> None:
        self._set(self._final_scene(reveal))

    def _final_scene(self, reveal: np.ndarray) -> Scene:
        box = (80, 190, 1440, 580)

        def scene(t):
            f = self.background(t)
            img = self.fitted(reveal, box[2], box[3])
            ph, pw = img.shape[:2]
            px, py = box[0] + (box[2] - pw) // 2, box[1] + (box[3] - ph) // 2
            # lunar terminator: a curved light/dark boundary sweeping left to right
            prog = ease(t / 2.4)
            yy = (np.arange(ph, dtype=np.float32)[:, None] / ph) * 2 - 1
            xb = -0.25 * pw + prog * 1.5 * pw - 0.25 * pw * (1 - yy ** 2)
            xx = np.arange(pw, dtype=np.float32)[None, :]
            lit = np.clip((xb - xx) / 30 + 0.5, 0, 1)[..., None]
            night = img * 0.07 + np.array([10, 12, 30], np.float32)
            region = f[py:py + ph, px:px + pw]
            region[:] = night * (1 - lit) + img * lit
            edge = np.exp(-((xx - xb) / 18) ** 2)[..., None]
            region += (np.array(GOLD, np.float32) - region) * edge * 0.8
            pulse = 0.5 + 0.5 * math.sin(t * 2)
            cv2.rectangle(f, (px - 3, py - 3), (px + pw + 2, py + ph + 2),
                          tuple(int(c * (0.4 + 0.6 * pulse * prog)) for c in GOLD), 2)
            label(f, "HIDDEN MESSAGE REVEALED", 80, 60, 56, HEAVY, GOLD, typed=(t - 1.6) / 1.2)
            label(f, "the page looked blank  ·  four lights read the dents the pen left behind", 84, 136, 22,
                  REGULAR, DIM, alpha=ease(t - 2.6))
            label(f, "reveal.png sent to the AI", 80, 810, 26, DEMI, (140, 240, 160), alpha=ease(t - 3.0))
            return f
        return scene

async def replay(folder, per_step: float = 4.5, gap: float = 2.5) -> None:
    """Play a finished scan through the viewer, as if it were happening now."""
    import json
    from pathlib import Path

    from .align import ROTATIONS
    from .reveal import load_gray
    from .stages import compute, unaligned

    folder = Path(folder)
    rig_path = Path(__file__).resolve().parent.parent / "rig.json"
    rig = json.loads(rig_path.read_text()) if rig_path.exists() else {}
    raw = sorted((folder / "raw").iterdir()) if (folder / "raw").is_dir() else []
    imgs = [load_gray(folder / f"dir_{k}.png") for k in range(4)]
    before = unaligned(raw, rig["roi"], rig.get("rotate")) if len(raw) == 4 and "roi" in rig else None
    d = compute(imgs, before)
    async with Viewer() as view:
        for k in range(4):
            view.board(k, f"LED {k + 1} on: take photo {k + 1} now")
            await asyncio.sleep(gap)
            if raw:
                p = cv2.cvtColor(cv2.imread(str(raw[k])), cv2.COLOR_BGR2RGB)
                p = cv2.resize(p, None, fx=1600 / max(p.shape[:2]), fy=1600 / max(p.shape[:2]))
                view.photos[k] = cv2.rotate(p, ROTATIONS[rig["rotate"]]) if rig.get("rotate") else p
            else:
                view.photos[k] = d["lit"][k]
            view.board(k, f"got photo {k + 1}")
            await asyncio.sleep(1.0)
        view.processing()
        await asyncio.sleep(4.0)
        await view.present(d, per_step)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="Replay a finished scan folder through the live window.")
    ap.add_argument("folder")
    ap.add_argument("--slide", type=float, default=4.5, help="seconds per processing-step animation")
    a = ap.parse_args()
    asyncio.run(replay(a.folder, a.slide))
