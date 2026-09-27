# Terminator (晨昏线) — HackWashU 2026

Theme: "Fly Me to the Moon". On the Moon, craters are only visible near the
terminator, where sunlight comes in at a low angle and casts long shadows. We do
the same to a sheet of paper: four LEDs at grazing angles reveal the invisible
indentations a pen left on the page underneath, then AI reads the hidden message.

## Demo (what judges see, ~30 s)
1. Judge writes a secret on a notepad with a ballpoint, tears off that page.
2. The blank-looking page underneath goes into the taped frame; lights off.
3. LEDs fire N, E, S, W in turn; the web UI shows each photo plus a moon phase step.
4. The four photos combine into one image of the handwriting.
5. AI transcribes it and reads it aloud.

## Team split
- Eric: hardware, Arduino, capture sync, image processing (this repo: `arduino/`, `terminator/`, `tools/`)
- Teammate: web UI (moon-phase animation, results), AI transcription + TTS, pitch

The only interface between the two halves is the scan folder below.

## Interface contract (do not change without telling the teammate)
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

## Layout
```
arduino/terminator_leds/terminator_leds.ino   LED controller (serial protocol below)
arduino/test_leds/test_leds.ino               wiring check, no serial needed
terminator/capture.py   LedBoard (serial) + Camera (OpenCV, frame averaging)
terminator/scan.py      full scan CLI, writes the contract above; --aim for setup
terminator/reveal.py    4 images -> reveal.png (runs standalone on any scan folder)
terminator/phone.py     phone scan: LEDs + chime cue, you tap the shutter (Night mode), photos pulled over USB;
                        --redo <scan> re-aligns/recombines a past scan's raw/ and publishes it as new
terminator/align.py     ink-based photo registration + pairwise cross-check (used by phone.py, import_photos)
terminator/review.py    doubtful alignment -> Claude (ANTHROPIC_API_KEY) -> a person in the web UI -> auto
                        (off by default since the phone is fixed: --review ai|human turns it on)
terminator/relight.py   virtual sun (same model as the web's "hold the sun"); ~25 sun angles read by
                        Google Vision, the consensus reading's image becomes reveal.png
terminator/stages.py    every reveal step (range or depth) as labeled pages (English); checked against
                        reveal(); written as steps.json + step_*.png for the web UI
tools/simulate.py       synthetic scans for testing without hardware
tools/import_photos.py  4 hand-taken phone photos (N,E,S,W) -> aligned scan folder + reveal
tools/explain.py        one labeled PNG of every reveal step (for debugging and the pitch)
web/                    web UI (Vite + TS), the only screen. Reads out/; writes only review_answer.json.
  server/               Vite plugin: GET /scan/:name/:file (contract files only, no-store),
                        POST /api/read (Google Vision; key in web/.env.local, never in the browser)
  src/feed/             meta.json -> show events (ScanFeed live, ReplayFeed for dev/backup demo)
  src/show/director.ts  the show's state machine; Stage/Overlay/Voice/Screens are swappable (L0 = DOM/CSS)
  src/ui/panels.ts      step-by-step pages (presenter-paced, terminator wipe, hint when a page is done)
                        and the alignment review (red/cyan overlay, 1-9 pick, arrows nudge, Enter)
  src/audio/          local Tone.js chord score and Quindar cues; browser speech with word timing
  src/scene/threeStage.ts  3D stage (three.js): NASA moon lit from the LED's side, real stars, photo cards,
                        dive + sunrise, page relit by a sun you can hold; ?stage=dom = CSS fallback
  public/sky/           moon/star assets (NASA SVS CGI Moon Kit, Yale BSC); tools/prepare_moon_assets.py
```

## Commands
```
pip install -r requirements.txt
python tools/simulate.py "Meet me on the moon at 9"   # -> out/sim/
python -m terminator.reveal out/sim                   # -> out/sim/reveal.png
python -m terminator.phone [--quiet]                  # MAIN DEMO FLOW: iPhone + Arduino on USB, web UI open
python -m terminator.phone --review human             # doubtful alignments go to a person (default: off, automatic)
python -m terminator.relight out/latest               # relight a scan folder: relit.png + relit.json
python -m terminator.phone --redo out/scan_20260926_214156   # replay a past scan through the pipeline + web UI
python -m terminator.scan --aim                       # all LEDs on + live preview; r = pick ROI
python -m terminator.scan [--port COM3] [--camera 1] [--roi X Y W H] [--rotate cw] [--settle 5]
python -m terminator.scan --list-cameras              # snapshot each camera index -> out/cameras/
python -m terminator.scan --manual [--camera 1]       # no Arduino: prompts you to move a flashlight
python tools/import_photos.py out/test1               # -> out/test1_scan/ (aligns on ink first)
python tools/explain.py out/latest                    # -> out/latest/explain.png
cd web && npm ci                                      # once (Node >= 22.12 for tests; the demo alone runs on >= 20.19)
cd web && npm run dev                                 # http://localhost:5173 watches out/latest
#   ?stage=dom  the CSS stand-in stage;  D = tuning panel (moon relief, bloom, capture dim, page relight)
#   http://localhost:5173/?replay=sim&pace=2500       plays out/sim as if live (no hardware)
#   ?replay=scan_20260926_005757&pace=6000            a real scan as if live (backup demo)
#   AI reading needs GOOGLE_API_KEY in web/.env.local; without it the reveal shows the 1202 path
#   first key or click arms local audio; M toggles score, Quindar and browser speech
#   R replays, Esc idles, F toggles fullscreen; ?stage=dom uses the same audio
#   after "done": step pages first (→/Space/Enter next, ← back; ?steps=off skips them), then the reveal
#   alignment review: 1-9 pick, arrows nudge (Shift x10), Enter send; auto-accepts option 1 on timeout
cd web && npm test                                    # unit tests
cd web && npm run demo                                # build + serve for the demo machine
```

The score and radio cue tones run locally after the first gesture. Spoken reveal and 1202 use
the browser's speech synthesis; no TTS API is needed. Word highlighting uses speech boundary
events when available and estimated timing otherwise, so voice quality and timing vary by browser.

## Hardware
- RedBoard/Uno, 4 LEDs (same color; green best: half the phone's Bayer pixels are green,
  blue worst), 4 x 220 ohm. Anode -> resistor -> pin, cathode -> GND. 10k is the dimmer option
  (~0.3 mA, likely too dim). Dim with resistors or a paper diffuser, never PWM (camera banding).
- Pins (as wired): D2 north/up, D3 south/down, D4 west/left, D5 east/right. "North" = top edge
  of the paper in the camera image. The sketch maps serial index 0-3 (N,E,S,W) -> pins {2,5,3,4}.
  `arduino/test_leds/` lights up, down, left, right for 10 s each to check wiring.
- LEDs lie flat on the table ~5 cm from the paper edge, pointing at the center (elevation ~5-15 deg).
- Camera: phone used as a webcam (Continuity Camera / DroidCam), directly above, pointing down.
- No enclosure: dark room, or cover paper + phone with a jacket.

Serial protocol, 115200 baud, single chars: `'0'-'3'` light one LED only, `'x'` all off,
`'a'` all on, `'?'` ping. Each reply is `ok <cmd>`. Board prints `ready` on boot.

## Image processing (reveal.py)
1. `I_k <- I_k - dark` (remove ambient; skipped with a warning if the dark frame is
   suspiciously bright, i.e. auto-exposure boosted its gain)
2. `R_k = I_k / GaussianBlur(I_k, sigma=40)` — flat-field; removes LED falloff and any
   global exposure change between shots, so auto-exposure is tolerable
3. `--method range` (default): `S = max_k R_k - min_k R_k`. Robust to imperfect light
   placement; wide grooves show as outlines.
   `--method depth` (photometric stereo): slopes `gx = R_W - R_E`, `gy = R_N - R_S`,
   Frankot-Chellappa FFT integration -> height, minus its Gaussian blur (`--hp 15`) to drop
   paper curl. Gives solid strokes; integration also suppresses fiber speckle. Slope signs
   are auto-picked (most negative skew = sparse grooves), so mirrored LED wiring is harmless;
   N/S swapped with E/W (90 deg rotation) is not. Skew does NOT reliably pick the right
   pairing of photos, only signs. On hand-held flashlight photos it lost all strokes along
   one axis, but on the LED rig it wins: terminator.phone defaults to `depth` (reveal.py's CLI
   and terminator.scan still default to `range`; stages.py explains whichever method ran).
   Vision on real scans: WASHU range "WAS" vs depth "WASHID"; HACKWASHU range nothing vs
   depth "ACKWASH". Keep anything dark and sharp (cables) out of the crop: it flips the skew
   sign pick.
4. Gaussian smooth 1.5, percentile stretch (85th -> white, 99.5th -> black) measured on the
   central 50% only (`--center`), CLAHE 1.0, invert

Tuning knobs are CLI flags: `--method --sigma --hp --smooth --lo --hi --clahe --denoise`.
`sigma` must be much larger than stroke width at the camera's resolution; `--hp` a few x.

## Conventions
- Python 3.10+, type hints, no heavy frameworks. Keep each module runnable on its own.
- Anything the demo depends on must work offline except the AI call.
- Test processing changes against `out/sim` (and a faint one: `tools/simulate.py ... --depth 0.5`)
  and look at the output image before calling it done.

## Status / next
- [x] Arduino sketch, capture + scan CLI, reveal pipeline, simulator (verified on synthetic data)
- [x] Photometric-stereo depth reveal (solid strokes, readable at `--depth 0.3`); atomic `out/latest`
- [x] Real-paper test (out/test1, hand-held flashlight, WeChat-compressed 960x1280 JPEGs):
      indentations clearly visible; `range` reveal reads "HELLO". Photos needed alignment.
- [x] test2 (green LEDs upright on the breadboard, paper strip on it): the LED pair along the
      board (text >= ~5 cm away) shows strokes clearly; the cross pair (1-2 cm away) shows
      nothing, so strokes parallel to the board are lost. Needs a crop to the paper (`--roi`),
      else the breadboard swamps the stretch. `depth` beat `range` here (rules leak into range).
- [x] test3: LEDs moved to the four corners of the board -> "WASHU" readable with both methods
      (range ghosts from hand-held misalignment). Corner LEDs = diagonal light; `depth` still
      assumes N/E/S/W axes (works, but not exact).
- [x] Serial LED control verified on the real board (/dev/cu.usbserial-120, pins {2,5,3,4}).
- [x] Continuity Camera rejected: no Night mode, blurry up close. Main flow is terminator.phone
      (native Camera app, Night mode, USB pull via pymobiledevice3). Dry-run with fakes passes.
- [x] First real terminator.phone scan (out/scan_20260926_005757, iPhone 16 Pro, JPG): "WASHU"
      readable after cropping to the paper and rotating ccw -> saved as rig.json. ~76 s shooting
      + ~17 s align/combine. The south shot had a long cable shadow (grazing light!).
- [x] Live window (terminator.viewer) + explain.png per scan -> replaced by the web UI's step pages
      (terminator.viewer deleted 2026-09-26).
- [x] Web UI L0 (branch ui): live/replay feeds, Director, CSS stand-in visuals, Vision OCR (real key checked on out/sim: 7 words, conf 0.99, 0.6 s), browser speech, 1202 alarm
- [x] Web UI L1 visuals (branch ui): three.js moon/stars/cards/page, hold-the-sun relighting, tuning panel
- [x] Web UI L2 local sound (branch ui): gesture-armed chord walk, photo pings, Quindar around browser speech,
      shared M mute, held-sun pan/filter; speaker level and voice timing still need demo-Mac rehearsal
- [x] Web UI (branch `ui`) merged into `hardware`; 117 web tests pass. A fake-hardware phone.run
      drove the live web page through capture -> combining -> reveal on the real WASHU photos.
- [x] GOOGLE_API_KEY in web/.env.local works; Vision answers in < 1 s. Real scan
      out/scan_20260926_214156 (HACKWASHU on ruled paper): the first reveal was blank (stale
      rig.json roi included the breadboard; registration slid 1375 px along the rules). Fixed with
      a plausibility gate in align.register + depth + new roi -> Vision "ACKWASH".
- [x] Alignment cross-check (loop closure): found scan_20260926_005757's south shot 124 px off; fixed
      -> Vision reads "WASHU" (was "WAS"). Doubtful photos go AI -> person (web review panel) -> auto;
      human round trip and the AI-failure fallback verified. AI step untested: no ANTHROPIC_API_KEY yet.
- [x] Web step pages (depth: align, input, flat-field, slopes, integrate, enhance), 130 web tests pass.
- [x] Phone now fixed: review off by default; rig.json {"roi": [720,0,385,1980], "rotate": "ccw", "ref": 3}
      (ref = photo the others align to and the roi is measured in; 3 = the last shot). Cross-check is
      anchored at ref (scan_20260926_225055 split 2+2, 94 px apart). Photo EXIF orientation is ignored
      (face-down phone flipped it mid-scan).
- [x] reveal.png = best virtual-sun relight (terminator.relight; fused image kept as reveal_fused.png).
      Vision: scan_20260926_225055 "INCKWASHU" (H cut by the frame edge), 005757 "WASHU", 214156 "HACKWASH".
- [x] scan_20260926_230415 (HACKWASHU, crossbars pressed hard, rig roi [835,0,315,1930]): Vision reads
      "HACKWASHU" exactly (sun 135 deg, 20 deg, two suns). Consensus vote limited to the top 8 tries.
- [x] Crop re-found automatically (optional): rig.json "template" = a photo the roi was picked on;
      align.locate_roi fits the new reference photo to it (affine ECC, phase-correlation starts); match >= 0.5
      -> moved crop, else rig.json's crop + a WARNING. Works for put-back offsets like (-39, 53) px (match 0.84).
- [x] Backup for the demo: `?replay=scan_20260926_230415` is a real scan Vision read as "HACKWASHU".
- [ ] Frame the whole word with margin on both ends (the first H touched the photo edge)
- [ ] Put ANTHROPIC_API_KEY in web/.env.local and try the AI review on a real doubtful scan
- [ ] Rehearse with real hardware: web UI fullscreen + `phone --quiet`; screen light vs grooves
- [ ] Keep cables away from the paper; re-pick rig.json if the phone or paper moves; tune `--lo`
- [ ] Optional: 3D relief view from the depth map (already computed in reveal.py)

## Known gotchas
- CAMERA MODE SWITCH: under the dimmer N/E LEDs the iPhone jumps to ISO 1000 + digital zoom 4.33 (vs 2.17,
  ISO 500): those shots are blurrier and ~96 px offset. Every scan on 2026-09-26 had 1-2 such shots, which is
  why readings varied run to run. Long-press for AE/AF LOCK and even out the LEDs; phone.py warns (EXIF check).
- Anything besides paper in frame (breadboard) swamps the stretch -> crop with rig.json roi.
- Alignment needs features: blank paper gives ECC nothing, so align.assemble registers on the
  roi plus a 400 px pad that includes the paper edge and breadboard holes.
- On ruled paper ECC can slide along the rules and still score well; align.register rejects
  fits that shift > 150 px, zoom, shear or tilt, then falls back to shift + rotation only.
  Low alignment scores (~0.3) under the east/west lights are normal there if the fit is plausible.
- If the paper moves, rig.json's roi is stale and the reveal fills with breadboard holes: re-pick it.
- Ruled notepad lines are ink and leak into the reveal (especially if misaligned); blank
  paper is cleaner for the demo.
- Photos sent through WeChat lose EXIF and get recompressed; AirDrop keeps full quality.
- Opening the serial port resets the Arduino; LedBoard waits 2 s.
- The phone's native shutter can't be triggered from the Mac (no Night mode via Continuity Camera); "automatic photos" = Continuity Camera frames via OpenCV.
  Its orientation can differ from the Photos app; fix with `--rotate`, check in `--aim`.
- macOS usually ignores OpenCV exposure/focus settings; flat-fielding compensates for exposure.
  Continuity Camera can't tap-to-focus or use macro: keep the phone >= ~20 cm above the paper.
- Strokes parallel to one light direction vanish in that shot; that's why we need all four.
- Light must reach the text at a low angle: LED height << horizontal distance (>= ~5 cm).
  Grooves only show when the LED lies flat (grazing light). Upright LEDs on the breadboard light
  the paper from above and wash the grooves out, however bright or dim they are.
- reveal.load_gray averages channels instead of cv2 luma weights (blue-only light kept 30 gray levels).
- `--method range` shows wide strokes as outlines (flat groove floor has no gradient); `depth` doesn't.
- The simulator's round-bottomed groove + ~2 deg paper curl is a guess; recheck against a real scan.
