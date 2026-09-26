# Web UI L2 (Sound and Voice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the existing visual show its chord walk, capture cues, Quindar tones, radio voice with word timepoints, and a dependable browser-voice fallback.

**Architecture:** The Director remains the show clock. A `Soundtrack` port receives its phase and photo events; a lazy Tone.js implementation makes the music only after the first gesture. A server-only `/api/speak` creates and caches marked Cloud TTS audio. A new Voice implementation plays that audio through a Web Audio radio chain and drives the existing word callback from the audio clock; browser speech remains the fallback. The 1202 alarm uses the same cue/voice path.

**Tech Stack:** Vite 8, TypeScript 7, Vitest 5, Tone.js 15.1.22, Web Audio API, Cloud Text-to-Speech REST v1beta1.

**Spec:** `docs/superpowers/specs/2026-09-26-web-ui-design.md` §§3, 5.3, 6–9, with the §8 order note (sound after visuals). User choice: reuse the existing server-side Google API key, test it once Cloud TTS is enabled, and keep browser speech if it fails; decide on ADC only from that result. The paper-terrain descent belongs to a later plan.

## Global Constraints

- Work only in `web/`, `CLAUDE.md`, and web UI docs. Do not modify `terminator/`, `arduino/`, `tools/`, or `out/`. Do not read, print, or change `web/.env.local`.
- All runtime music and cues are synthesized locally with Tone.js; no CDN or copyrighted samples. Google is the only network dependency. Keep the key on the server (`GOOGLE_API_KEY`, never `VITE_`).
- `0/1/2/3 = north/east/south/west`. Capture audio must be quiet enough for the hardware cue and judge's instructions; test the actual room volume on the demo Mac.
- The first key or pointer gesture arms audio; no autoplay assumption. `M` mutes music, Quindar, and both voice implementations. New scan, Esc, and replay cancel stale sounds and word callbacks.
- Keep `?stage=dom`, replay mode, existing 1202 visual path, and offline OCR-failure path working. A failed TTS request must not delay the show beyond the Director's existing bounds.
- Use Vitest TDD for SSML, response/mark validation, timing, cue mapping, and orchestration. Verify audible and visual behavior in the browser and on the demo Mac. Run `npm run typecheck && npm test && npm run build` from `web/` before claiming done; note any build warnings.
- Plain-sentence commit messages. Commit after each task. Run `git commit` alone; never pass `-n` or `--no-verify`. Do not push, merge into `hardware`, or create a PR.

## Review Focus

1. OCR tokens containing `& < > " '` or empty/oversized text: SSML remains valid; the endpoint rejects an invalid request before calling Google (Task 1 tests).
2. Google returning missing, duplicate, out-of-order, or nonfinite marks: do not speak a cloud clip with misleading word highlights; use browser speech (Tasks 1 and 3 tests).
3. `Esc`, replay, or a new scan during fetch, decode, Quindar, or playback: stale audio and callbacks stop and the pending Voice promise resolves (Task 3 tests).
4. A muted or unarmed browser, including a failed `Tone.start()`: the Director still reaches hold and `M` affects every source (Tasks 2–4 tests).
5. Word marks at the start of MP3 silence and timer throttling in a hidden pane: highlights follow the audio context clock, are emitted once and in order, and stop at clip end (Task 3 tests and browser check).

---

## File Structure

| Path | Responsibility |
|---|---|
| `web/server/tts.ts` | XML escape, marked SSML, Google request/validation, TTS cache |
| `web/server/api.ts` | `POST /api/speak` with the existing middleware and key |
| `web/src/audio/scoreCues.ts` | Pure phase-to-harmony and sun-to-timbre/pan mapping |
| `web/src/audio/score.ts` | Lazy Tone.js pad, FM piano, bass, wind, pulse, music bus |
| `web/src/audio/quindar.ts` | Local 2525/2475 Hz tone envelopes and cancellable timer |
| `web/src/audio/cloudVoice.ts` | TTS client, audio-clock marks, radio processing, browser fallback |
| `web/src/audio/controls.ts` | Pure key-action wiring for arm and shared mute |
| `web/src/audio/voice.ts` | Retain `BrowserVoice` and `SilentVoice`; make mute/cancel safe for fallback |
| `web/src/show/director.ts` | Optional soundtrack port and lifecycle calls |
| `web/src/scene/threeStage.ts` | Forward held-sun angle/elevation to sound; visual behavior unchanged |
| `web/src/main.ts` | Create and wire sound, voice, arm and mute |
| `web/test/server/tts.test.ts`, `web/test/server/api.test.ts` | Server and HTTP behavior |
| `web/test/audio/scoreCues.test.ts`, `web/test/audio/cloudVoice.test.ts`, `web/test/audio/controls.test.ts`, `web/test/show/director.test.ts` | Pure cues, clock/cancel, key actions, Director integration |
| `web/public/assets/audio/alarm-1202.mp3` | Generated once from approved alarm line after Cloud TTS is enabled |

## Task 1: Marked Cloud TTS endpoint and cache

**Files:** Create `web/server/tts.ts`, `web/test/server/tts.test.ts`; modify `web/server/api.ts`, `web/test/server/api.test.ts`. Do not access the actual key or service in unit tests.

**Interfaces:** `speakWords({words, apiKey, cacheDir, fetchImpl?}): Promise<SpeakResult>`; `SpeakResult = {audio: string; marks: {word: number; t: number}[]}`. HTTP body `{words: string[]}`; HTTP result is `SpeakResult`.

- [ ] **Step 1: Write failing pure tests.** Assert the exact SSML and validation boundary:

  ```ts
  expect(markedSsml(["Meet", "a&b", "<moon>", "say\"hi'"]))
    .toBe('<speak><mark name="w0"/>Meet <mark name="w1"/>a&amp;b <mark name="w2"/>&lt;moon&gt; <mark name="w3"/>say&quot;hi&apos;</speak>');
  expect(() => validateWords([])).toThrow();
  expect(() => validateWords([" "])).toThrow();
  expect(() => validateWords(["x".repeat(81)])).toThrow();
  expect(() => validateWords(Array(81).fill("x"))).toThrow();
  expect(() => validateWords(Array(20).fill("x".repeat(60)))).toThrow();
  ```

  `validateWords` accepts 1–80 nonblank strings, each at most 80 Unicode code points, joined text at most 1000 code points, and rejects XML-invalid control characters. Keep the original word indices; trim surrounding whitespace but reject embedded line breaks. Run `npm test -- test/server/tts.test.ts`; expect red.

- [ ] **Step 2: Implement SSML and request.** Use `voice = "en-US-Neural2-D"`; make it a server constant, not a client-supplied value. Escape `&` first, then `< > " '`. Send:

  ```ts
  {
    input: { ssml: markedSsml(words) },
    voice: { languageCode: "en-US", name: "en-US-Neural2-D" },
    audioConfig: { audioEncoding: "MP3", speakingRate: 0.95 },
    enableTimePointing: ["SSML_MARK"],
  }
  ```

  URL `https://texttospeech.googleapis.com/v1beta1/text:synthesize`; headers `Content-Type: application/json`, `X-Goog-Api-Key: apiKey`. Use `cachePath(cacheDir, "tts", voice + ":" + ssml)` and existing `readCache`/`writeCache`. A cache hit needs no key. A missing key is HTTP 503; Google failure is HTTP 502 with a concise message and no key. Serialize concurrent identical requests in this process using a `Map<string, Promise<SpeakResult>>` so one miss makes one Google call and one cache write.

- [ ] **Step 3: Validate Google output before caching.** Require a nonempty canonical base64 `audioContent` (decode to nonempty bytes, re-encode and compare); require exactly one finite nonnegative `timeSeconds` for each `w0…wN`, in nondecreasing time order, with no unexpected or duplicate names. Map to `{word:i,t}`. Incomplete/invalid marks are HTTP 502, causing browser-voice fallback. Mock Google in `tts.test.ts`: valid response, cache hit with missing key, 403/disabled API, malformed audio, missing/duplicate/out-of-order/nonfinite marks, and concurrent identical calls. Expected: only valid output is cached, one fetch for two concurrent calls. Run the focused tests; expect green.

- [ ] **Step 4: Add the HTTP route and tests.** In `createApiMiddleware`, route `POST /api/speak` through `readJsonBody` and `speakWords`, return `sendJson`. Pass only `o.apiKey`, `o.cacheDir`, and `o.fetchImpl`. In `api.test.ts`, POST valid words and assert the shape, POST invalid words and assert 400, POST with missing key and assert 503, and check the key is never in the response. Run `npm test -- test/server/tts.test.ts test/server/api.test.ts`, then typecheck.

- [ ] **Step 5: Commit.** Stage only the four named files; commit `Add cached marked speech endpoint`.

## Task 2: Chord walk and show cues

**Files:** Create `web/src/audio/scoreCues.ts`, `web/src/audio/score.ts`, `web/test/audio/scoreCues.test.ts`; modify `web/package.json`, `web/package-lock.json`, `web/src/show/director.ts`, `web/test/show/director.test.ts`.

**Interfaces:** `Soundtrack` port in `director.ts`: `arm(): Promise<void>`, `mute(on:boolean):void`, `idle():void`, `ledOn(k:number):void`, `photoLanded(k:number):void`, `combining():void`, `descent():void`, `reveal():void`, `hold():void`, `voiceActive(on:boolean):void`, `heldSun(azimuth:number,elevation:number):void`. The Director accepts a default silent implementation to preserve test callers. `ToneScore implements Soundtrack`.

- [ ] **Step 1: Install the pinned library.** Run `npm install tone@15.1.22` from `web/`. Check the package lock changed only for Tone.js and its dependencies.

- [ ] **Step 2: Write failing cue tests.** `scoreCues.ts` exports these exact, pure data and functions:

  ```ts
  export const CHORDS = [
    {notes:["C3","E3","G3","B3","D4"], bass:"C2"},
    {notes:["A2","C3","E3","G3","B3"], bass:"A1"},
    {notes:["F2","A2","C3","E3","G3"], bass:"F1"},
    {notes:["D3","F3","A3","C4","E4"], bass:"D2"},
  ] as const;
  export const COMBINING = {notes:["G2","B2","D3","F3"], bass:"G1"} as const;
  export const RESOLVED = CHORDS[0];
  export function heldSunMix(azimuth:number,elevation:number) {
    return {pan:Math.sin(azimuth), cutoff:500 + 2500*Math.sin(elevation)};
  }
  ```

  Test all four LED indices, G7 combining, Cmaj9 reveal, and `heldSunMix` bounds (pan −1..1, cutoff 500..3000 Hz for 0..90°). Invalid LED indices should be ignored by `ToneScore`, not index an undefined chord. Run `npm test -- test/audio/scoreCues.test.ts`; expect red.

- [ ] **Step 3: Implement `ToneScore`.** The constructor stores state but creates no sounding nodes. `arm()` calls `Tone.start()` synchronously from the gesture handler, then builds the graph once; if start rejects, keep a silent state and let the visual show continue. Make a `Tone.Volume(-18)` music bus into `Tone.Reverb({decay:2,wet:0.18})` into destination. Route two slightly detuned sawtooth `PolySynth(Synth)` pads through `Tone.Filter(900,"lowpass")`, an FM `FMSynth` photo ping, a sine/triangle `Synth` bass, and pink `Noise` through a bandpass to that bus. Set pad attack about 1 s and release about 2 s; use `releaseAll()` before each chord. Idle is a very quiet C drone/wind; each `ledOn(k)` moves to `CHORDS[k]` over about 1.5 s; `photoLanded` plays one short FM note; combining holds G7 and slowly opens the filter while a bass pulse accelerates; descent adds a low rumble; reveal resolves Cmaj9; hold sustains it. `heldSun` ramps filter cutoff and stereo pan from `heldSunMix`. Keep a single owned interval/transport event for combining and clear it on every phase transition, reset, mute, and disposal. `voiceActive(true)` ducks the music bus by 12 dB; `false` restores over 0.5 s. `mute` silences the music bus immediately. Do not play or allocate new loops before arm.

  The core graph and transition should follow this shape; keep node handles on the class so they can be stopped/disposed:

  ```ts
  const bus = new Tone.Volume(-18).toDestination();
  const reverb = new Tone.Reverb({ decay: 2, wet: 0.18 }).connect(bus);
  const lowpass = new Tone.Filter(900, "lowpass").connect(reverb);
  const padA = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "sawtooth" }, envelope: { attack: 1, decay: 0.3, sustain: 0.5, release: 2 } }).connect(lowpass);
  const padB = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "sawtooth" }, detune: 7, envelope: { attack: 1, decay: 0.3, sustain: 0.5, release: 2 } }).connect(lowpass);
  // On chord change: release the previous notes, then trigger both pads' new notes.
  padA.releaseAll(); padB.releaseAll();
  padA.triggerAttack(chord.notes); padB.triggerAttack(chord.notes);
  ```

- [ ] **Step 4: Wire Director calls and test ordering.** Add an optional `sound: Soundtrack = SILENT_SOUND` constructor argument. Call `sound.idle()` on construction/`toIdle`, `sound.ledOn/photoLanded/combining` alongside stage events, `sound.descent/reveal/hold` when the phase starts, and `sound.voiceActive(true/false)` around both `voice.speak` and `voice.alarm`. Use `finally { if (live()) sound.voiceActive(false); }` so an old show cannot unduck a new voice; `restart` resets the old cue and duck state. `Director.arm()` invokes `void sound.arm().catch(console.warn)` while the key gesture is live. In `director.test.ts`, use a fake sound and verify four LED calls, combine → descent → reveal → hold, duck/restore on success and 1202, interruption during speech, and that a stale show's `finally` cannot change a new show's duck state. Run focused tests and typecheck; expect green.

- [ ] **Step 5: Browser listen and commit.** With replay `?replay=sim&pace=2500`, first gesture arms, the four chords and photo notes sound in order, combining loop stops on done and Esc, and hold does not leave an old loop. Check `?stage=dom` too. Stage only named files; commit `Add the lunar chord walk and capture cues`.

## Task 3: Quindar, radio voice, and word clock

**Files:** Create `web/src/audio/quindar.ts`, `web/src/audio/cloudVoice.ts`, `web/test/audio/cloudVoice.test.ts`; modify `web/src/audio/voice.ts` only where fallback cancellation/muting needs it.

**Interfaces:** `CloudVoice implements Voice`; constructor receives `BrowserVoice`, a `fetch` function, and a shared Tone/Web Audio context access function. It exposes `muted`, `speak(words,onWord)`, `alarm()`, `cancel()`. `Quindar.play("start"|"end", signal)` resolves after its 250 ms envelope, and stops early on cancellation. `Director.arm()` starts the shared Tone context from the gesture.

- [ ] **Step 1: Write failing clock and fallback tests.** Inject a fake audio clock/clip into `CloudVoice` (small `AudioPlayback` interface in `cloudVoice.ts`: `decode(base64)`, `play(buffer,onEnded)`, `time():number`, `stop()`). Test exact word callbacks `[0,1,2]` from marks at `0,0.4,0.9` even when one timer tick jumps from `0.1` to `0.95`; no duplicates; `cancel()` during request/decode/Quindar/clip resolves and emits no later callback; 502 or bad marks routes once to `BrowserVoice.speak`; muted cloud clip makes no sound but advances the show. Use fake timers and fake playback, not microphone or real AudioContext. Run `npm test -- test/audio/cloudVoice.test.ts`; expect red.

  ```ts
  const seen: number[] = [];
  const emitDue = wordClock([{word:0,t:0}, {word:1,t:0.4}, {word:2,t:0.9}], (i) => seen.push(i));
  emitDue(0.1); emitDue(0.95); emitDue(1.2);
  expect(seen).toEqual([0, 1, 2]);
  ```

- [ ] **Step 2: Implement local tones and clip playback.** `Quindar` is a sine oscillator through a gain envelope: 2525 Hz for 0.25 s before the voice, 2475 Hz for 0.25 s after; ramp gain up/down over about 10 ms so it does not click. Use the shared Tone audio context, not a second clock. For a cloud clip: base64 → ArrayBuffer → `decodeAudioData`, `AudioBufferSourceNode` → highpass 300 Hz → lowpass 3000 Hz → gentle WaveShaper → DynamicsCompressor → voice gain → destination, with a very faint filtered noise layer only while transmitting. Schedule marks against the actual source start time on `AudioContext.currentTime`; a short `requestAnimationFrame`/timer pump catches every due mark in a `while` loop, and `onended` performs the final cleanup. `cancel()` stops source, tone, noise, clock pump, fetch via `AbortController`, and settles the pending promise exactly once. Gate each async continuation with a generation counter before playback or callback.

  ```ts
  export function wordClock(marks: {word:number;t:number}[], onWord:(i:number)=>void) {
    let next = 0;
    return (elapsedSeconds:number) => {
      while (next < marks.length && marks[next].t <= elapsedSeconds) onWord(marks[next++].word);
    };
  }
  // At playback: const startedAt = context.currentTime;
  // On each pump: emitDue(context.currentTime - startedAt);
  ```

- [ ] **Step 3: Fetch and fallback.** `POST /api/speak` with `{words}`; validate that `marks.length === words.length`, indices are `0..N−1`, and times are finite, nonnegative, nondecreasing before cloud playback. On fetch/decode/mark failure, or if the shared audio context is still suspended, log a concise warning and call the existing `BrowserVoice.speak` with the same callback. Browser voice still uses `onboundary` or its estimated timing; it has no radio filter, while Quindar plays on both paths when the context runs. Preserve `BrowserVoice`'s `SpeechSynthesisUtterance` reference and cancellation promise. `alarm()` uses the approved line `ALARM_LINE`; until Task 5's local MP3 exists, use browser speech with Quindar. `muted` stops both voice outputs and Quindar while still allowing timed highlights/show completion. Run the focused tests and typecheck; expect green.

- [ ] **Step 4: Commit.** Stage only named files; commit `Add radio voice with Quindar and word timing`.

## Task 4: Wire audio into both stages and rehearse fallback

**Files:** Create `web/src/audio/controls.ts`, `web/test/audio/controls.test.ts`; modify `web/src/main.ts`, `web/src/scene/threeStage.ts`, `web/src/scene/sunHandle.ts`, `web/test/show/director.test.ts`, `docs/TODO-web-ui.md`.

**Interfaces:** `ThreeStage.create(glRoot,domRoot,onHeldSun?)`; `onHeldSun(azimuthRadians,elevationRadians)` is called only while hold is active. `SunHandle.angles()` returns `{azimuth,elevation}` from its follower. DOM stage simply has no sun callback.

- [ ] **Step 1: Write failing integration tests.** Existing `show/keys.test.ts` covers the first pointer/key arming exactly once. In new `audio/controls.test.ts`, use fake sound/voice/Director and assert two `mute()` calls set `sound.mute(true/false)` and `voice.muted` to true/false. A first `arm()` calls `director.arm()` once. In `director.test.ts`, Esc cancels active voice and sends `sound.idle()`; a new scan does the same before its first chord. Run these tests; expect red.

- [ ] **Step 2: Wire without introducing autoplay.** `controls.ts` exports `audioKeyActions(director, sound, voice)`, with local `muted = false`; `arm()` calls `director.arm()`, while `mute()` toggles `muted`, calls `sound.mute(muted)` and sets `voice.muted = muted`. Construct `ToneScore` and `CloudVoice` before `Director`, pass sound to `Director`; `makeStage` supplies `(azimuth,elevation) => score.heldSun(azimuth,elevation)` to `ThreeStage.create`. Pass the two actions to the existing `bindKeys`; its first gesture invokes `director.arm()` synchronously, which calls `Tone.start()`. Ensure creating the CSS fallback still uses the same score/voice. In `ThreeStage` frame update, after `sunHandle.update(dt)`, forward `sunHandle.angles()` only when `sunHeld` is true. `SunHandle.angles()` returns `this.follower.azimuth/elevation` without reading CSS positions. Run tests and typecheck.

  ```ts
  export function audioKeyActions(director: Pick<Director,"arm">, sound: Pick<Soundtrack,"mute">, voice: {muted:boolean}) {
    let muted = false;
    return {
      arm: () => director.arm(),
      mute: () => { muted = !muted; sound.mute(muted); voice.muted = muted; },
    };
  }
  ```

- [ ] **Step 3: Verify in the browser.** Run replay in both 3D and `?stage=dom`: first gesture, M on/off, each LED, combining, `done`, word/subtitle alignment, hold sun pan/filter, R, Esc, and deliberate `/api/speak` 503 (Cloud TTS disabled) while OCR succeeds. Both fallbacks must reach hold within the Director's existing bounds. Check no stale sound after starting a second scan. Run `npm run typecheck && npm test && npm run build`; commit `Connect sound and browser voice fallback`.

## Task 5: Enable-service check, local 1202 clip, and docs

**Files:** Create `web/public/assets/audio/alarm-1202.mp3`; modify `web/src/audio/cloudVoice.ts`, `web/test/audio/cloudVoice.test.ts`, `CLAUDE.md`, `docs/TODO-web-ui.md`. This task starts only after the user enables Cloud Text-to-Speech for the existing Google project; no credential file is inspected or changed by the implementer.

- [ ] **Step 1: Exercise real key on the local server.** With the server already reading its key, call `/api/speak` using innocuous synthetic words (`Meet me on the moon at 9`) and inspect only HTTP status, response shape, mark count/order, audible result, and cache hit. Never print the key, request headers, or base64 audio. If key auth is rejected, record status/error and keep browser fallback; ask the user whether to switch to ADC before changing credentials. Do not claim Cloud TTS is verified without this check.

- [ ] **Step 2: Generate the 1202 asset.** Once Cloud TTS succeeds, synthesize `ALARM_LINE` with the same voice and save the returned MP3 bytes to `web/public/assets/audio/alarm-1202.mp3` (never to `out/`). With the dev server running, this one-time script runs from `web/` and prints no audio or credential:

  ```js
  import { mkdirSync, writeFileSync } from "node:fs";
  const words = "Twelve oh two alarm. We're go. Read it with your own eyes.".split(/\s+/);
  const response = await fetch("http://localhost:5173/api/speak", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ words }),
  });
  if (!response.ok) throw new Error(`speech endpoint returned ${response.status}`);
  const { audio } = await response.json();
  mkdirSync("public/assets/audio", { recursive: true });
  writeFileSync("public/assets/audio/alarm-1202.mp3", Buffer.from(audio, "base64"));
  ```

  Commit the asset only after listening to it. Add a test that `alarm()` prefers that local file through the same radio chain and falls back to browser speech when the file is unavailable; Quindar still brackets it. This clip has no runtime network dependency.

- [ ] **Step 3: Rehearse and document.** In 3D and CSS replay, test cloud playback, word boxes/subtitles, Quindar, ducking, M, Esc and R. On the demo Mac, test external-speaker level, browser gesture arming, real scan timing, and whether `phone.py` cues clash (coordinate any `--quiet` choice with Eric; do not edit his code). With network disabled, a cached OCR scan still shows and the 1202/fallback path reaches hold. Update `CLAUDE.md` commands/status and `docs/TODO-web-ui.md` with actual results and unresolved hardware choices. Run `npm run typecheck && npm test && npm run build`; stage only owned files and commit `Verify cloud speech and add local alarm audio`.

## External references checked for this plan

- [Google Cloud TTS v1beta1 synthesis and timepoints](https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1beta1/text/synthesize)
- [Google SSML `<mark>` guidance](https://docs.cloud.google.com/text-to-speech/docs/ssml)
- [Google supported voices and Studio mark limitation](https://cloud.google.com/text-to-speech/docs/voices)
- [Tone.js 15.1.22 `start()`](https://tonejs.github.io/docs/15.1.22/functions/start.html) and [context](https://tonejs.github.io/docs/15.1.22/classes/Context.html)
