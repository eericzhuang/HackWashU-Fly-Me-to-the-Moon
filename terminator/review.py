"""Ask for help when align.assemble isn't sure about a photo: first an AI, then a person.

  AI     Claude looks at the reference photo (red) overlaid on each candidate alignment (cyan)
         and picks one. Needs ANTHROPIC_API_KEY (environment, or web/.env.local). It only
         decides alone if it is confident; otherwise its pick is passed on to the person.
  person The web UI (web/) shows the same overlays: 1-9 picks a candidate, arrow keys nudge it
         (Shift = 10 px), Enter accepts. The answer comes back as out/latest/review_answer.json.
  nobody After --review-timeout seconds the pipeline's own pick (option 0) is used.

While a review is open, meta.json carries a "review" object (see CLAUDE.md, interface contract)
and the scan folder holds review_ref.png + review_<i>.png (published to out/latest).
"""
from __future__ import annotations

import base64
import json
import os
import time
import urllib.request
import uuid
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

from .align import ROTATIONS, Decision, ReviewRequest

ROOT = Path(__file__).resolve().parent.parent
MODEL = "claude-sonnet-5"
DISPLAY_SIDE = 1400      # long side of the review images, px
CONTEXT = 150            # px of working frame shown around the roi (paper edge, board holes)
AI_CONFIDENT = 0.75      # the AI decides alone at or above this confidence


def api_key() -> str | None:
    if os.environ.get("ANTHROPIC_API_KEY"):
        return os.environ["ANTHROPIC_API_KEY"]
    env = ROOT / "web" / ".env.local"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("ANTHROPIC_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"') or None
    return None


class View:
    """Renders a request's photos the same way for the AI and the web page: flat-fielded, cropped
    to the roi plus some context, turned upright, shrunk to DISPLAY_SIDE."""

    def __init__(self, r: ReviewRequest):
        self.r = r
        w, h = r.size
        if r.roi:
            x, y, rw, rh = r.roi
            self.box = (max(x - CONTEXT, 0), max(y - CONTEXT, 0), min(x + rw + CONTEXT, w), min(y + rh + CONTEXT, h))
        else:
            self.box = (0, 0, w, h)
        bw, bh = self.box[2] - self.box[0], self.box[3] - self.box[1]
        self.scale = min(1.0, DISPLAY_SIDE / max(bw, bh))

    def image(self, k: int, H: np.ndarray) -> np.ndarray:
        """uint8 view of photo k warped by H (flat-fielded, so the light direction matters less)."""
        w, h = self.r.size
        g = cv2.warpPerspective(self.r.gray[k], H, (w, h), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                                borderMode=cv2.BORDER_REPLICATE)
        g = g / np.maximum(cv2.GaussianBlur(g, (0, 0), 25), 1.0)
        x0, y0, x1, y1 = self.box
        g = g[y0:y1, x0:x1]
        lo, hi = np.percentile(g, [1, 99.5])
        u = (np.clip((g - lo) / max(hi - lo, 1e-6), 0, 1) * 255).astype(np.uint8)
        u = cv2.resize(u, None, fx=self.scale, fy=self.scale, interpolation=cv2.INTER_AREA)
        return cv2.rotate(u, ROTATIONS[self.r.rotate]) if self.r.rotate else u

    def ref(self) -> np.ndarray:
        other = self.r.ref if self.r.k != self.r.ref else (self.r.ref + 1) % 4
        return self.image(other, self.r.Hs[other])

    def option(self, i: int) -> np.ndarray:
        return self.image(self.r.k, self.r.options[i].H)

    def to_frame(self, dx: float, dy: float) -> tuple[float, float]:
        """A nudge in displayed (upright, shrunk) pixels -> reference-frame pixels."""
        dx, dy = dx / self.scale, dy / self.scale
        return {None: (dx, dy), "ccw": (-dy, dx), "cw": (dy, -dx), "180": (-dx, -dy)}[self.r.rotate]


def red(u: np.ndarray) -> np.ndarray:
    return cv2.merge([np.zeros_like(u), np.zeros_like(u), u])      # BGR


def cyan(u: np.ndarray) -> np.ndarray:
    return cv2.merge([u, u, np.zeros_like(u)])


def ask_ai(view: View, key: str, timeout: float = 30.0) -> dict | None:
    """{"choice": i | None, "confidence": 0..1, "why": str}, or None if the call failed."""
    r = view.r
    ref = view.ref()
    content: list[dict] = [{"type": "text", "text": (
        "Four photos of the same sheet of paper were taken with a phone that may have moved slightly "
        "between shots; each photo is lit from a different side, so shading differs, but printed lines, "
        "the paper edge, holes in the board behind it and pencil marks are in the same place. "
        f"Photo {r.k + 1}'s alignment to the reference is in doubt: {r.check.detail}.\n"
        "Each image below overlays the reference in RED and one candidate alignment of that photo in CYAN. "
        "Where they coincide, lines look white or grey; a wrong alignment shows the same line twice, once "
        "red and once cyan, side by side. Pick the candidate where lines, edges and holes coincide best.\n"
        'Reply with JSON only: {"choice": <candidate number or null if none is right>, '
        '"confidence": <0 to 1>, "why": "<one short sentence>"}')}]
    for i, c in enumerate(r.options):
        comp = cv2.addWeighted(red(ref), 1.0, cyan(view.option(i)), 1.0, 0)
        comp = cv2.resize(comp, None, fx=0.6, fy=0.6, interpolation=cv2.INTER_AREA)
        ok, jpg = cv2.imencode(".jpg", comp, [cv2.IMWRITE_JPEG_QUALITY, 85])
        content.append({"type": "text", "text": f"Candidate {i}: {c.label}"})
        content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                                   "data": base64.b64encode(jpg.tobytes()).decode()}})
    body = {"model": MODEL, "max_tokens": 300, "messages": [{"role": "user", "content": content}]}
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", json.dumps(body).encode(), {
        "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = "".join(b.get("text", "") for b in json.load(resp)["content"])
        ans = json.loads(text[text.index("{"):text.rindex("}") + 1])
        choice = ans.get("choice")
        if choice is not None and not (isinstance(choice, int) and 0 <= choice < len(r.options)):
            choice = None
        return {"choice": choice, "confidence": float(ans.get("confidence") or 0), "why": str(ans.get("why") or "")}
    except Exception as e:  # network, auth, bad JSON: fall through to the person
        print(f"    AI review failed ({type(e).__name__}: {e})")
        return None


class Reviewer:
    """The `review` callback for align.assemble.

    folder: the scan folder (review images are written there)
    publish(review, files): put `review` (dict, or None when done) into meta.json and mirror
        `files` + meta.json to out/latest; supplied by terminator.phone
    answer: where the web UI drops its answer (out/latest/review_answer.json)
    mode: "ai" (AI, then person if unsure), "human" (person only), "off" (never ask)
    """

    def __init__(self, folder: Path, publish: Callable[[dict | None, list[str]], None], answer: Path,
                 mode: str = "ai", timeout: float = 90.0):
        self.folder, self.publish, self.answer = folder, publish, answer
        self.mode, self.timeout = mode, timeout
        self.key = api_key() if mode == "ai" else None
        if mode == "ai" and not self.key:
            print("  (no ANTHROPIC_API_KEY: doubtful alignments go straight to the web UI)")

    def __call__(self, r: ReviewRequest) -> Decision:
        if self.mode == "off":
            return Decision(0, by="auto")
        view = View(r)
        ai = None
        if self.key:
            t = time.time()
            ai = ask_ai(view, self.key)
            if ai:
                print(f"    AI ({time.time() - t:.1f}s): candidate {ai['choice']}, confidence {ai['confidence']:.2f}: {ai['why']}")
                if ai["choice"] is not None and ai["confidence"] >= AI_CONFIDENT:
                    return Decision(ai["choice"], by="ai", why=ai["why"])
        return self.ask_person(r, view, ai)

    def ask_person(self, r: ReviewRequest, view: View, ai: dict | None) -> Decision:
        rid = uuid.uuid4().hex[:8]
        files = ["review_ref.png"] + [f"review_{i}.png" for i in range(len(r.options))]
        cv2.imwrite(str(self.folder / files[0]), red(view.ref()))
        for i in range(len(r.options)):
            cv2.imwrite(str(self.folder / files[i + 1]), cyan(view.option(i)))
        self.answer.unlink(missing_ok=True)
        review = {"id": rid, "led": r.k, "check": r.check.status, "detail": r.check.detail,
                  "options": [{"label": c.label, "score": round(c.score, 3), "file": files[i + 1]}
                              for i, c in enumerate(r.options)],
                  "ref": files[0], "ai": ai, "timeout": self.timeout}
        self.publish(review, files)
        print(f"    waiting up to {self.timeout:.0f}s for a person in the web UI (1-{len(r.options)} pick, arrows nudge, Enter)")
        deadline = time.time() + self.timeout
        try:
            while time.time() < deadline:
                try:
                    a = json.loads(self.answer.read_text())
                except (OSError, ValueError):
                    time.sleep(0.25)
                    continue
                if a.get("id") != rid:
                    time.sleep(0.25)
                    continue
                choice = int(a.get("choice", 0))
                choice = choice if 0 <= choice < len(r.options) else 0
                dx, dy = view.to_frame(float(a.get("dx", 0)), float(a.get("dy", 0)))
                return Decision(choice, dx, dy, by="human")
            fallback = ai["choice"] if ai and ai["choice"] is not None else 0
            print("    no answer in time; using " + ("the AI's pick" if fallback else "the automatic pick"))
            return Decision(fallback, by="ai" if fallback else "auto", why="timeout")
        finally:
            self.answer.unlink(missing_ok=True)
            self.publish(None, [])
