import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Word } from "../../shared/types";
import type { Outcome } from "../../src/ai/classify";
import type { FeedEvent } from "../../src/feed/types";
import { Director, sleep, TIMING, type Overlay, type Reader, type Soundtrack, type Stage, type Voice } from "../../src/show/director";

const words: Word[] = [
  { text: "Meet", box: [], confidence: 0.9 },
  { text: "me", box: [], confidence: 0.8 },
];
const OK: Outcome = { kind: "ok", words, confident: [0, 1] };
const WEAK: Outcome = { kind: "weak", words: [{ text: "M?", box: [], confidence: 0.2 }], confident: [] };
const DONE: Extract<FeedEvent, { type: "done" }> = {
  type: "done",
  name: "sim",
  urls: { dirs: [], reveal: "/scan/sim/reveal.png?v=x" },
};

function setup(outcome: Outcome, readDelayMs = 100) {
  const stage = {
    idle: vi.fn(), newScan: vi.fn(), ledOn: vi.fn(), photoLanded: vi.fn(), combining: vi.fn(),
    descent: vi.fn(() => sleep(1500)), reveal: vi.fn(async () => {}),
    showWords: vi.fn(), highlight: vi.fn(), hold: vi.fn(), skip: vi.fn(),
  } satisfies Stage;
  const overlay = {
    idle: vi.fn(), capture: vi.fn(), landed: vi.fn(), combining: vi.fn(), reveal: vi.fn(),
    clearCue: vi.fn(), subtitle: vi.fn(), alarm: vi.fn(), waiting: vi.fn(),
  } satisfies Overlay;
  const reader = { read: vi.fn(() => sleep(readDelayMs).then(() => outcome)) } satisfies Reader;
  const voice = {
    speak: vi.fn(async (ws: string[], onWord: (i: number) => void) => {
      for (let i = 0; i < ws.length; i++) {
        onWord(i);
        await sleep(300);
      }
    }),
    alarm: vi.fn(() => sleep(2000)),
    cancel: vi.fn(),
  } satisfies Voice;
  const sound = {
    arm: vi.fn(async () => {}), mute: vi.fn(), idle: vi.fn(), ledOn: vi.fn(),
    photoLanded: vi.fn(), combining: vi.fn(), descent: vi.fn(), reveal: vi.fn(),
    hold: vi.fn(), voiceActive: vi.fn(), heldSun: vi.fn(),
  } satisfies Soundtrack;
  const director = new Director(stage, overlay, reader, voice, sound);
  return { director, stage, overlay, reader, voice, sound };
}

function capture(d: Director): void {
  d.handle({ type: "scanStarted", scanId: "t1" });
  for (let k = 0; k < 4; k++) {
    d.handle({ type: "ledOn", led: k });
    d.handle({ type: "photoLanded", led: k, url: `u${k}` });
  }
  d.handle({ type: "combining" });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Director", () => {
  it("forwards capture cues in order and resets sound for a new scan", () => {
    const { director, sound } = setup(OK);
    expect(sound.idle).toHaveBeenCalledTimes(1);
    director.handle({ type: "scanStarted", scanId: "t1" });
    director.handle({ type: "ledOn", led: 0 });
    director.handle({ type: "photoLanded", led: 0, url: "u0" });
    director.handle({ type: "combining" });
    director.handle({ type: "scanStarted", scanId: "t2" });
    expect(sound.idle).toHaveBeenCalledTimes(3);
    expect(sound.ledOn).toHaveBeenCalledWith(0);
    expect(sound.photoLanded).toHaveBeenCalledWith(0);
    expect(sound.combining).toHaveBeenCalledTimes(1);
    expect(sound.idle.mock.invocationCallOrder[1]).toBeLessThan(sound.ledOn.mock.invocationCallOrder[0]);
    expect(sound.ledOn.mock.invocationCallOrder[0]).toBeLessThan(sound.photoLanded.mock.invocationCallOrder[0]);
    expect(sound.photoLanded.mock.invocationCallOrder[0]).toBeLessThan(sound.combining.mock.invocationCallOrder[0]);
    expect(sound.combining.mock.invocationCallOrder[0]).toBeLessThan(sound.idle.mock.invocationCallOrder[2]);
  });

  it("arms the soundtrack once from a gesture", () => {
    const { director, sound } = setup(OK);
    director.arm();
    director.arm();
    expect(sound.arm).toHaveBeenCalledTimes(1);
  });

  it("ducks through normal speech and restores before hold", async () => {
    const { director, sound } = setup(OK);
    capture(director);
    director.handle(DONE);
    expect(sound.descent).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(sound.reveal).toHaveBeenCalledTimes(1);
    expect(sound.voiceActive).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sound.voiceActive).toHaveBeenLastCalledWith(false);
    await vi.advanceTimersByTimeAsync(TIMING.holdAfterMs);
    expect(sound.hold).toHaveBeenCalledTimes(1);
  });

  it("ducks the 1202 line and restores after the alarm", async () => {
    const { director, sound } = setup(WEAK);
    capture(director);
    director.handle(DONE);
    await vi.advanceTimersByTimeAsync(1600);
    expect(sound.voiceActive).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sound.voiceActive).toHaveBeenLastCalledWith(false);
  });

  it("does not restore a stale voice over a new scan", async () => {
    const { director, sound } = setup(OK);
    capture(director);
    director.handle(DONE);
    await vi.advanceTimersByTimeAsync(1600);
    director.handle({ type: "scanStarted", scanId: "t2" });
    const callsAfterRestart = sound.voiceActive.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sound.voiceActive.mock.calls.length).toBe(callsAfterRestart);
    expect(sound.voiceActive).toHaveBeenLastCalledWith(false);
  });
  it("starts idle", () => {
    const { director, stage, overlay } = setup(OK);
    expect(director.phase).toBe("idle");
    expect(stage.idle).toHaveBeenCalledTimes(1);
    expect(overlay.idle).toHaveBeenCalledWith(false);
  });

  it("runs capture, descent, reveal, reading aloud, then hold", async () => {
    const { director, stage, overlay, reader, voice } = setup(OK);
    capture(director);
    expect(stage.newScan).toHaveBeenCalledTimes(1);
    expect(stage.photoLanded).toHaveBeenCalledTimes(4);
    expect(overlay.capture).toHaveBeenLastCalledWith(3, [0, 1, 2]);
    expect(overlay.landed).toHaveBeenLastCalledWith(3, [0, 1, 2, 3]);
    expect(director.phase).toBe("combining");

    director.handle(DONE);
    expect(director.phase).toBe("descent");
    expect(reader.read).toHaveBeenCalledWith("sim");
    expect(overlay.reveal).toHaveBeenCalled();
    expect(stage.descent).toHaveBeenCalledWith(DONE.urls);

    await vi.advanceTimersByTimeAsync(2500); // descent 1500 + two words at 300 ms each
    expect(stage.reveal).toHaveBeenCalledWith(DONE.urls);
    expect(stage.showWords).toHaveBeenCalledWith(words, [0, 1]);
    expect(voice.speak).toHaveBeenCalledWith(["Meet", "me"], expect.any(Function));
    expect(stage.highlight).toHaveBeenCalledWith(1);
    expect(overlay.subtitle).toHaveBeenCalledWith(["Meet", "me"], 1);
    expect(overlay.subtitle).toHaveBeenLastCalledWith(["Meet", "me"], 2);
    expect(stage.highlight).toHaveBeenLastCalledWith(2);
    expect(director.phase).toBe("reveal");

    await vi.advanceTimersByTimeAsync(TIMING.holdAfterMs);
    expect(director.phase).toBe("hold");
    expect(stage.hold).toHaveBeenCalledTimes(1);
  });

  it("sounds the 1202 alarm instead of reading when the reading is weak", async () => {
    const { director, stage, overlay, voice } = setup(WEAK);
    capture(director);
    director.handle(DONE);
    await vi.advanceTimersByTimeAsync(1600);
    expect(stage.showWords).toHaveBeenCalledWith(WEAK.words, []);
    expect(overlay.alarm).toHaveBeenLastCalledWith(true);
    expect(voice.alarm).toHaveBeenCalledTimes(1);
    expect(voice.speak).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000 + TIMING.holdAfterMs);
    expect(director.phase).toBe("hold");
  });

  it("gives up on OCR after the deadline", async () => {
    const { director, overlay, voice } = setup(OK, 20_000);
    capture(director);
    director.handle(DONE);
    await vi.advanceTimersByTimeAsync(TIMING.readDeadlineMs + 100);
    expect(overlay.alarm).toHaveBeenLastCalledWith(true);
    expect(voice.speak).not.toHaveBeenCalled();
  });

  it("a new scan interrupts the reading and the stale show never finishes", async () => {
    const { director, stage, voice } = setup(OK);
    capture(director);
    director.handle(DONE);
    await vi.advanceTimersByTimeAsync(1600); // speaking word 0
    director.handle({ type: "scanStarted", scanId: "t2" });
    expect(voice.cancel).toHaveBeenCalled();
    expect(director.phase).toBe("capture");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(stage.highlight).not.toHaveBeenCalledWith(1);
    expect(stage.hold).not.toHaveBeenCalled();
    expect(director.phase).toBe("capture");
  });

  it("warns when the capture stalls, and clears the warning on the next event", async () => {
    const { director, overlay } = setup(OK);
    director.handle({ type: "scanStarted", scanId: "t1" });
    director.handle({ type: "ledOn", led: 0 });
    await vi.advanceTimersByTimeAsync(TIMING.stuckMs);
    expect(overlay.waiting).toHaveBeenLastCalledWith(true);
    director.handle({ type: "photoLanded", led: 0, url: "u0" });
    expect(overlay.waiting).toHaveBeenLastCalledWith(false);
  });

  it("Esc goes back to idle and stops the voice", () => {
    const { director, stage, overlay, voice, sound } = setup(OK);
    capture(director);
    director.arm();
    director.toIdle();
    expect(director.phase).toBe("idle");
    expect(stage.idle).toHaveBeenCalledTimes(2);
    expect(overlay.idle).toHaveBeenLastCalledWith(true);
    expect(voice.cancel).toHaveBeenCalled();
    expect(sound.idle).toHaveBeenCalledTimes(3);
    expect(voice.cancel.mock.invocationCallOrder.at(-1)!).toBeLessThan(sound.idle.mock.invocationCallOrder.at(-1)!);
  });

  it("cancels an old reading and idles sound before the next LED chord", async () => {
    const { director, voice, sound } = setup(OK);
    capture(director);
    director.handle(DONE);
    await vi.advanceTimersByTimeAsync(1600);

    director.handle({ type: "scanStarted", scanId: "t2" });
    director.handle({ type: "ledOn", led: 0 });

    const cancel = voice.cancel.mock.invocationCallOrder.at(-1)!;
    const idle = sound.idle.mock.invocationCallOrder.at(-1)!;
    const chord = sound.ledOn.mock.invocationCallOrder.at(-1)!;
    expect(cancel).toBeLessThan(idle);
    expect(idle).toBeLessThan(chord);
  });

  it("skip is passed to the stage", () => {
    const { director, stage } = setup(OK);
    director.skip();
    expect(stage.skip).toHaveBeenCalledTimes(1);
  });

  it("ends in hold and cancels the voice when speak never settles", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { director, stage, voice } = setup(OK);
    voice.speak.mockImplementation(() => new Promise<void>(() => {})); // never resolves
    capture(director);
    director.handle(DONE);

    const speakBoundMs = OK.words.length * TIMING.speakPerWordMs + TIMING.speakSlackMs;
    await vi.advanceTimersByTimeAsync(1500 /* descent */ + speakBoundMs + TIMING.holdAfterMs + 100);
    expect(director.phase).toBe("hold");
    expect(voice.cancel).toHaveBeenCalled();
    expect(stage.hold).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("voice.speak timed out after 7000 ms");
    warn.mockRestore();
  });

  it("ends in hold and logs the error when a stage step rejects", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { director, stage } = setup(OK);
    stage.descent.mockImplementation(() => Promise.reject(new Error("nope")));
    capture(director);
    director.handle(DONE);

    await vi.advanceTimersByTimeAsync(0);
    expect(errorSpy).toHaveBeenCalledWith("show step failed:", expect.any(Error));
    expect(director.phase).toBe("hold");
    expect(stage.hold).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
