# Web UI L2 (Local Sound) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the lunar chord walk, photo cues, Quindar tones, and fully local spoken reveal to the existing visual show.

**Architecture:** The Director remains the show clock. A `Soundtrack` port receives phase and photo events; a lazy Tone.js implementation creates music only after the first user gesture. `CueVoice` wraps the existing `BrowserVoice` with synthesized Quindar tones. `BrowserVoice` retains word-boundary events and estimated timing fallback, so boxes and subtitles still move without a network request.

**Tech Stack:** Vite 8, TypeScript 7, Vitest 5, Tone.js 15.1.22, browser Web Speech and Web Audio APIs.

**Spec:** `docs/dev/web-ui/specs/2026-09-26-web-ui-design.md` §§3 and 6–9, with the §8 order note. **User revision, 2026-09-26:** no TTS API; use existing browser speech plus local Tone.js music and Quindar. This supersedes `/api/speak`, Cloud TTS cache, the MP3 alarm asset, radio filtering and SSML timepoints for this layer. Browser speech cannot be routed through our Web Audio filter; timing uses `onboundary` when available, then estimates. Paper-terrain descent remains a later layer.

## Global Constraints

- Work only in `web/`, `CLAUDE.md`, and web UI docs. Do not modify `terminator/`, `arduino/`, `tools/`, `out/`, or `web/.env.local`.
- All new sound is synthesized locally with Tone.js; no CDN, samples, Google speech call, credential use, or new server endpoint. Keep existing OCR unchanged.
- `0/1/2/3 = north/east/south/west`. Capture cues must stay quiet enough for instructions and the hardware cue; measure on the demo Mac.
- The first key or pointer gesture arms Tone.js. `M` mutes music, Quindar and browser speech. New scan, Esc and replay cancel stale tones, loops, speech and callbacks.
- Keep `?stage=dom`, replay, the 1202 visual path, and offline OCR-failure behavior working. The Director's existing speech/alarm bounds remain.
- Use Vitest TDD for pure cues, Director orchestration and voice cancellation. Verify sound and visuals in the browser. Run `npm run typecheck && npm test && npm run build` from `web/`; report warnings.
- Plain-sentence commit messages. Commit after each task. Run `git commit` alone; never pass `-n` or `--no-verify`. Do not push, merge into `hardware`, or create a PR.

## Review Focus

1. First gesture during a scan: arm once, pick up the current phase, never start two loops (Tasks 1 and 3).
2. Old show finishing after new scan/idle: never restart a chord or unduck a new voice (Task 1).
3. Esc, replay or new scan during either Quindar tone or browser speech: stop old sound/callback and settle the Voice promise (Task 2).
4. M before/after arming and during speech or 1202: music, Quindar and speech share one mute state (Tasks 2 and 3).
5. No word boundary events or denied Tone start: estimated highlighting completes and the Director reaches hold (Tasks 2 and 3).

---

## File Structure

| Path | Responsibility |
|---|---|
| `web/src/audio/scoreCues.ts`, `score.ts` | Pure harmony/sun mapping and lazy Tone score |
| `web/src/audio/quindar.ts`, `cueVoice.ts` | Cancellable local tones around BrowserVoice |
| `web/src/audio/controls.ts` | Arm/mute key actions |
| `web/src/show/director.ts` | Soundtrack port and show lifecycle |
| `web/src/scene/threeStage.ts`, `sunHandle.ts` | Forward held-sun angles |
| `web/src/main.ts` | Wire score, voice and controls |
| `web/test/audio/*.test.ts`, `web/test/show/director.test.ts` | Pure and orchestration tests |

## Task 1: Chord walk and show cues

**Files:** Create `web/src/audio/scoreCues.ts`, `web/src/audio/score.ts`, `web/test/audio/scoreCues.test.ts`; modify `web/package.json`, `web/package-lock.json`, `web/src/show/director.ts`, `web/test/show/director.test.ts`.

**Interfaces:** `Soundtrack` port in `director.ts`: `arm():Promise<void>`, `mute(on:boolean):void`, `idle():void`, `ledOn(k:number):void`, `photoLanded(k:number):void`, `combining():void`, `descent():void`, `reveal():void`, `hold():void`, `voiceActive(on:boolean):void`, `heldSun(azimuth:number,elevation:number):void`. Director accepts a default silent implementation. `ToneScore implements Soundtrack`.

- [ ] **Step 1: Install Tone.js.** From `web/`, run `npm install tone@15.1.22`; check lockfile scope.
- [ ] **Step 2: Write failing cue tests.** Use the following exact mapping and test all indices, G7 combining, Cmaj9 reveal and sun bounds. Invalid LED index is ignored by `ToneScore`. Run `npm test -- test/audio/scoreCues.test.ts`; verify red.

  ```ts
  export const CHORDS = [
    {notes:["E3","G3","B3","D4"],bass:"E2"}, // Em7, north
    {notes:["A2","C3","E3","G3"],bass:"A1"}, // Am7, east
    {notes:["D3","F3","A3","C4"],bass:"D2"}, // Dm7, south
    {notes:["G2","B2","D3","F3"],bass:"G1"}, // G7, west
  ] as const;
  export const COMBINING = CHORDS[3];
  export const RESOLVED = {notes:["C3","E3","G3","B3","D4"],bass:"C2"} as const; // Cmaj9
  export function heldSunMix(azimuth:number,elevation:number) {
    return {pan:Math.sin(azimuth),cutoff:500+2500*Math.sin(elevation)};
  }
  ```

- [ ] **Step 3: Implement lazy Tone graph.** Constructor stores phase/LED without sounding nodes. `arm()` invokes `Tone.start()` synchronously from the gesture, builds graph once, then replays stored phase; rejected start leaves show silent. Music bus `Tone.Volume(-18)` → `Tone.Reverb({decay:2,wet:0.18})` → destination. Two slightly detuned sawtooth `PolySynth(Synth)` pads with slow attack/release through lowpass, FM `FMSynth` photo ping, sine/triangle bass, and pink `Noise` through bandpass wind. Quiet C drone at idle; `ledOn(k)` moves to `CHORDS[k]` over ~1.5 s; photo landing pings; combining holds G7, slowly opens filter and accelerates one bass pulse; descent rumbles; reveal resolves Cmaj9; hold sustains it. `heldSun` ramps cutoff/pan via `heldSunMix`. Own and clear the combining timer/transport event on every phase change/reset/mute. `voiceActive(true)` ducks music by 12 dB, `false` restores over 0.5 s; `mute` silences bus immediately.

  ```ts
  const bus = new Tone.Volume(-18).toDestination();
  const reverb = new Tone.Reverb({decay:2,wet:0.18}).connect(bus);
  const lowpass = new Tone.Filter(900,"lowpass").connect(reverb);
  const padA = new Tone.PolySynth(Tone.Synth,{oscillator:{type:"sawtooth"},envelope:{attack:1,decay:0.3,sustain:0.5,release:2}}).connect(lowpass);
  const padB = new Tone.PolySynth(Tone.Synth,{oscillator:{type:"sawtooth"},detune:7,envelope:{attack:1,decay:0.3,sustain:0.5,release:2}}).connect(lowpass);
  padA.releaseAll(); padB.releaseAll();
  padA.triggerAttack(chord.notes); padB.triggerAttack(chord.notes);
  ```

- [ ] **Step 4: Wire Director and test.** Add optional `sound:Soundtrack = SILENT_SOUND` constructor arg. Call `sound.idle()` on construction/`toIdle`, phase/photo methods alongside stage events, and `sound.voiceActive(true/false)` around speak/alarm. Use `finally { if (live()) sound.voiceActive(false); }`; `restart` clears old cue and duck state. `Director.arm()` calls `void sound.arm().catch(console.warn)` within the gesture. In `director.test.ts` test event order, 1202, stale show and interruption. Run focused tests, full suite, typecheck.
- [ ] **Step 5: Commit.** Task 3 owns app replay listening because main wiring is not yet present. Stage named files and commit `Add the lunar chord walk and capture cues`.

## Task 2: Quindar around browser speech

**Files:** Create `web/src/audio/quindar.ts`, `web/src/audio/cueVoice.ts`, `web/test/audio/cueVoice.test.ts`; modify `web/src/audio/voice.ts` only if a demonstrated cancel/mute defect requires it.

**Interfaces:** `CueVoice implements Voice`, with `muted:boolean`; constructor takes a mutable browser voice (`Voice & {muted:boolean}`) and a Quindar port. `Quindar.play("start"|"end",signal)` resolves after 250 ms or abort; uses the shared Tone context.

- [ ] **Step 1: Write failing tests.** Test start tone → `BrowserVoice.speak` with the same callback → end tone, and the same around `ALARM_LINE`. Cancel during first tone, speech and last tone: pending promise resolves and no stale callback/tone follows. `muted=true` propagates to both dependencies during ordinary speech and 1202. Run `npm test -- test/audio/cueVoice.test.ts`; verify red.

  ```ts
  const events:string[]=[];
  const browser={muted:false,speak:async(_w:string[],onWord:(i:number)=>void)=>{events.push("speech");onWord(0);},alarm:async()=>{events.push("alarm");},cancel:()=>{events.push("cancel");}};
  const tones={muted:false,play:async(which:"start"|"end")=>{events.push(which);}};
  await new CueVoice(browser,tones).speak(["Meet"],()=>{});
  expect(events).toEqual(["start","speech","end"]);
  ```

- [ ] **Step 2: Implement Quindar.** Sine oscillator and gain envelope: 2525 Hz before speech, 2475 Hz after, 250 ms each, 10 ms gain ramps. `AbortSignal` stops a tone and resolves it. Skip when muted or Tone context suspended. Own and clear oscillator/timeout/ended handlers.

  ```ts
  const hz=which==="start"?2525:2475;
  const at=Tone.getContext().currentTime;
  oscillator.frequency.setValueAtTime(hz,at);
  gain.gain.setValueAtTime(0,at);
  gain.gain.linearRampToValueAtTime(0.08,at+0.01);
  gain.gain.setValueAtTime(0.08,at+0.24);
  gain.gain.linearRampToValueAtTime(0,at+0.25);
  ```

- [ ] **Step 3: Implement CueVoice.** Use generation and `AbortController` per call. `cancel()` increments generation, aborts tone, calls `browser.cancel()`, settles current promise once. Gate every awaited continuation and word callback by generation. `muted` setter updates both dependencies immediately. Keep BrowserVoice's `onboundary`/estimated timing and utterance reference; do not claim the browser voice has a Web Audio radio filter. Run focused tests, full suite, typecheck; verify green.
- [ ] **Step 4: Commit.** Stage named files and commit `Add local Quindar cues around browser speech`.

## Task 3: Connect stages and document

**Files:** Create `web/src/audio/controls.ts`, `web/test/audio/controls.test.ts`; modify `web/src/main.ts`, `web/src/scene/threeStage.ts`, `web/src/scene/sunHandle.ts`, `web/test/show/director.test.ts`, `CLAUDE.md`, `docs/dev/web-ui/TODO.md`.

**Interfaces:** `ThreeStage.create(glRoot,domRoot,onHeldSun?)`; callback receives azimuth/elevation radians only during hold. `SunHandle.angles()` returns `{azimuth,elevation}` from follower. DOM stage has no sun callback.

- [ ] **Step 1: Write failing integration tests.** Existing `show/keys.test.ts` verifies first key/pointer arms once. In `audio/controls.test.ts`, fake sound/voice/Director; two `mute()` calls produce `sound.mute(true/false)` and `voice.muted=true/false`; `arm()` invokes `director.arm()`. In `director.test.ts`, Esc and new scan cancel voice and send `sound.idle()` before a new chord. Run focused tests; verify red.
- [ ] **Step 2: Wire without autoplay.** Construct `ToneScore` and `CueVoice(new BrowserVoice(),new Quindar())` before `Director`; pass score to Director. In main, pass this helper's actions to `bindKeys`; first gesture calls `director.arm()` synchronously. The CSS stage uses the same audio wiring. Supply `(azimuth,elevation)=>score.heldSun(azimuth,elevation)` to ThreeStage. After `sunHandle.update(dt)`, forward `sunHandle.angles()` only while `sunHeld`; do not derive angle from CSS.

  ```ts
  export function audioKeyActions(director:Pick<Director,"arm">,sound:Pick<Soundtrack,"mute">,voice:{muted:boolean}) {
    let muted=false;
    return {arm:()=>director.arm(),mute:()=>{muted=!muted;sound.mute(muted);voice.muted=muted;}};
  }
  ```

- [ ] **Step 3: Browser verification.** Replay `?replay=sim&pace=2500` in 3D and `?stage=dom`: first gesture, M on/off, each LED, combining, reveal word/subtitle highlighting, hold sun pan/filter, R, Esc, second scan, and existing OCR 1202 failure. Confirm no Google speech request, other runtime external asset or WebGL error. Check loop stops. Record that local voice quality/boundary timing depend on browser. Run `npm run typecheck && npm test && npm run build`.
- [ ] **Step 4: Docs and commit.** `CLAUDE.md`: local sound, gesture and M, browser voice limitation, demo commands. `docs/dev/web-ui/TODO.md`: mark sound done after review, remove Cloud TTS enablement, leave speaker/hardware rehearsal open. Stage only owned files; commit `Connect local sound to the web show`.

## Reference

- [Tone.js 15.1.22 start()](https://tonejs.github.io/docs/15.1.22/functions/start.html) and [context](https://tonejs.github.io/docs/15.1.22/classes/Context.html)
