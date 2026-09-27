# Scan folder contract

The Python side (capture and processing) and the web UI only talk through a scan folder. Python
writes it; the web UI polls `out/latest/meta.json` and reads the files it lists. The only file the
web UI writes is `review_answer.json`.

`python -m terminator.scan` writes:
```
out/scan_YYYYmmdd_HHMMSS/
  dark.png                 all LEDs off (ambient)
  dir_0.png .. dir_3.png   north, east, south, west (grayscale-able PNGs)
  reveal.png               final image: dark strokes on white. Send this to the AI.
  relief_raw.png           debug only
  meta.json                {"status": "capturing"|"done", "directions": [...],
                            "captured": [k, ...], "seconds": float}
out/latest/                mirror of the most recent scan, updated after every image
```
The UI polls `out/latest/meta.json`; `captured` grows as each direction lands,
`status == "done"` means `reveal.png` is ready. Every file in `out/latest` is replaced
atomically and `meta.json` always last, so anything it lists is complete. Files from the
previous scan stay until overwritten; trust `meta.json`, not file existence.
`out/sim/` is a committed synthetic scan (status "done") for UI development without hardware.
terminator.phone adds `"source": "phone"` and writes unaligned previews as dir_k.png while
capturing (cropped to rig.json's roi and rotated, so they look like the final ones); they are
replaced by aligned ones when status becomes "done". The web UI derives the scan id from
`started` and the lit LED from `len(captured)`, so keep both.

terminator.phone also writes (all published to out/latest the same way):
```
  meta.json "review"       while capturing (all 4 in): a doubtful photo alignment waiting for a person:
                           {"id", "led", "check": "inconsistent"|"unverified", "detail", "ref": file,
                            "options": [{"label", "score", "file"}], "ai": {choice, confidence, why}|null,
                            "timeout": s}. Gone again once answered or timed out.
  review_ref.png, review_<i>.png   reference photo (red) and candidate i (cyan), screen-blended by the UI
  review_answer.json       written BY THE WEB UI (POST /api/review): {"id", "choice", "dx", "dy"}
                           (nudge in review-image pixels); terminator.review polls out/latest for it
  meta.json on "done"      + "method", "alignment": [{led, score, check, detail, by: auto|ai|human}],
                           "steps": "steps.json"
  steps.json, step_<page>_<panel>.png   the step-by-step pages (terminator.stages), shown before the reveal
```
