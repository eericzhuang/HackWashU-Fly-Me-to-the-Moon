# Web UI: status and what's left

Branch `ui`. Last updated 2026-09-26.
Spec: `docs/superpowers/specs/2026-09-26-web-ui-design.md`
Plans: `docs/superpowers/plans/2026-09-26-web-ui-L0-skeleton.md`, `docs/superpowers/plans/2026-09-26-web-ui-L1-light-and-3d.md`

## Done
- **L0 skeleton (all 10 tasks, final review passed):**
  - live and replay feeds, the Director, the CSS stage;
  - Google Vision OCR, checked with the real key on `out/sim`;
  - browser speech with word highlighting, the 1202 alarm, keyboard controls.
- **L1 tasks 1–5:**
  - assets and fonts, scene math, stage URLs, engine, moon and stars, first ThreeStage;
  - the NASA moon lit from each LED's side, the real star sky, the dive to the terminator;
  - `?stage=dom` fallback.
- **L1 task 6:** photos as 3D cards (close-up, park, spiral into the moon); the late-photo fix (`4e98a78`) passed independent review.
- **L1 task 7:** 3D reveal page, word boxes, and hold-the-sun relighting from the four captures.
- **L1 task 8:** D-key tuning panel for the moon, bloom, capture dim, and page relighting.

## Remaining L1 work
- [ ] Final whole-branch review of L1

## Later layers
- [ ] Sound and Cloud TTS: Tone.js chord walk, Quindar tones, Cloud TTS radio voice (enable **Cloud Text-to-Speech** on the Google project first)
- [ ] Paper-terrain descent: the moon surface morphing into the page's relief
- [ ] Easter eggs: handwriting melody, ghost pen

## Coordinate with Eric (spec §11)
- [ ] Screen: web UI runs the show; run `python -m terminator.phone --no-show`; his viewer handles the tech deep-dive
- [ ] phone.py plays a chime and `say` at every LED, which clashes with our music: add a `--quiet` flag, or keep it
- [ ] Install Node on the demo Mac, then `cd web && npm ci && npm run demo`

## Rehearsal checklist
- [ ] Full real scan on the Mac: frame rate, M (mute) and F (fullscreen) keys
- [ ] Screen-brightness A/B test (screen black vs UI on during capture); tune `STAGE.captureDim` (0.45)
- [ ] Real OCR time on a real scan's reveal.png vs the 8 s deadline

## Known minor issues (accepted or deferred)
- `vite build` passes with warnings: existing extensionless-import forward-compatibility warning, plus the L1 `threeStage` chunk at about 786 kB (over Vite's 500 kB advisory threshold).
- `server/api.ts`: the scan-file stream has no `error` handler. The user chose not to fix it.
- `assets.ts`: fetches of `moon_height.json`/`stars.json` don't check `r.ok`.
- `cache.ts`: the temp file name isn't unique, so two windows reading the same new scan at once could collide.
- `scanFeed`, `voice`, `domStage`: small items listed in `.superpowers/sdd/progress.md` (local only).
