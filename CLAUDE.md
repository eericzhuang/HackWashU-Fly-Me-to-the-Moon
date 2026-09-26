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
capturing; they are replaced by aligned ones when status becomes "done".

## Layout
```
arduino/terminator_leds/terminator_leds.ino   LED controller (serial protocol below)
arduino/test_leds/test_leds.ino               wiring check, no serial needed
terminator/capture.py   LedBoard (serial) + Camera (OpenCV, frame averaging)
terminator/scan.py      full scan CLI, writes the contract above; --aim for setup
terminator/reveal.py    4 images -> reveal.png (runs standalone on any scan folder)
terminator/phone.py     phone scan: LEDs + chime cue, you tap the shutter (Night mode), photos pulled over USB
terminator/align.py     ink-based photo registration (used by phone.py and tools/import_photos.py)
terminator/stages.py    every reveal step as labeled image rows (English); checked against reveal()
terminator/viewer.py    animated live window for phone.py (moon theme, Futura): capture, combine, then
                        presenter-paced pages (SPACE/-> next, <- back, Q quit; a hint pulses when a
                        page is done), terminator-wipe reveal. `python -m terminator.viewer <scan>` replays
tools/simulate.py       synthetic scans for testing without hardware
tools/import_photos.py  4 hand-taken phone photos (N,E,S,W) -> aligned scan folder + reveal
tools/explain.py        one labeled PNG of every reveal step (for debugging and the pitch)
```

## Commands
```
pip install -r requirements.txt
python tools/simulate.py "Meet me on the moon at 9"   # -> out/sim/
python -m terminator.reveal out/sim                   # -> out/sim/reveal.png
python -m terminator.phone [--slide 4.5] [--no-show]   # MAIN DEMO FLOW: iPhone + Arduino on USB
python -m terminator.viewer out/scan_20260926_005757  # replay a past scan's animation, no hardware
python -m terminator.scan --aim                       # all LEDs on + live preview; r = pick ROI
python -m terminator.scan [--port COM3] [--camera 1] [--roi X Y W H] [--rotate cw] [--settle 5]
python -m terminator.scan --list-cameras              # snapshot each camera index -> out/cameras/
python -m terminator.scan --manual [--camera 1]       # no Arduino: prompts you to move a flashlight
python tools/import_photos.py out/test1               # -> out/test1_scan/ (aligns on ink first)
python tools/explain.py out/latest                    # -> out/latest/explain.png
```

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
   one axis, so it is not the default until it wins on the LED rig.
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
- [x] Live window (terminator.viewer) + explain.png per scan; dry-run with the real photos passes.
      Slides start after status "done" is published, so the web UI is never held up by them.
- [ ] Keep cables away from the paper; re-pick rig.json if the phone or paper moves; tune `--lo`
- [ ] Optional: 3D relief view from the depth map (already computed in reveal.py)

## Known gotchas
- Anything besides paper in frame (breadboard) swamps the stretch -> crop with rig.json roi.
- Alignment needs features: blank paper gives ECC nothing, so align.assemble registers on the
  roi plus a 400 px pad that includes the paper edge and breadboard holes.
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
