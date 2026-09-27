import { afterEach, describe, expect, it, vi } from "vitest";
import { CueVoice } from "../../src/audio/cueVoice";
import { Quindar } from "../../src/audio/quindar";

const audio = vi.hoisted(() => {
  const oscillator = {
    type: "sine", frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(),
    onended: null as (() => void) | null,
  };
  const gain = {
    gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    connect: vi.fn(), disconnect: vi.fn(),
  };
  const context = {
    state: "running", currentTime: 10, rawContext: { destination: {} },
    createOscillator: vi.fn(() => oscillator), createGain: vi.fn(() => gain),
  };
  return { oscillator, gain, context };
});

vi.mock("tone", () => ({ getContext: () => audio.context }));

type ToneKind = "start" | "end";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function rig() {
  const events: string[] = [];
  const tones = {
    muted: false,
    play: vi.fn(async (which: ToneKind, _signal: AbortSignal) => { events.push(which); }),
  };
  const browser = {
    muted: false,
    speak: vi.fn(async (_words: string[], onWord: (i: number) => void) => {
      events.push("speech");
      onWord(0);
    }),
    alarm: vi.fn(async () => { events.push("alarm"); }),
    cancel: vi.fn(() => { events.push("cancel"); }),
  };
  return { events, tones, browser, voice: new CueVoice(browser, tones) };
}

describe("CueVoice", () => {
  it("wraps normal browser speech with start and end cues and forwards word timing", async () => {
    const { events, browser, voice } = rig();
    const heard: number[] = [];
    await voice.speak(["Meet"], (i) => heard.push(i));
    expect(events).toEqual(["start", "speech", "end"]);
    expect(browser.speak).toHaveBeenCalledWith(["Meet"], expect.any(Function));
    expect(heard).toEqual([0]);
  });

  it("wraps the 1202 browser alarm with the same cues", async () => {
    const { events, browser, voice } = rig();
    await voice.alarm();
    expect(events).toEqual(["start", "alarm", "end"]);
    expect(browser.alarm).toHaveBeenCalledTimes(1);
  });

  it("cancels during the start cue, settles, and never starts speech", async () => {
    const { events, browser, tones, voice } = rig();
    const start = deferred();
    tones.play.mockImplementationOnce(async () => { events.push("start"); await start.promise; });
    const speaking = voice.speak(["Meet"], () => events.push("word"));
    voice.cancel();
    await speaking;
    start.resolve();
    await Promise.resolve();
    expect(browser.speak).not.toHaveBeenCalled();
    expect(events).not.toContain("end");
    expect(tones.play.mock.calls[0][1].aborted).toBe(true);
  });

  it("cancels during speech, settles, and ignores late word callbacks", async () => {
    const { events, browser, voice } = rig();
    const speech = deferred();
    let oldWord!: (i: number) => void;
    browser.speak.mockImplementationOnce(async (_words, onWord) => {
      events.push("speech");
      oldWord = onWord;
      await speech.promise;
    });
    const speaking = voice.speak(["Meet"], () => events.push("word"));
    await vi.waitFor(() => expect(browser.speak).toHaveBeenCalledTimes(1));
    voice.cancel();
    await speaking;
    oldWord(0);
    speech.resolve();
    await Promise.resolve();
    expect(events).not.toContain("word");
    expect(events).not.toContain("end");
  });

  it("cancels during the end cue and settles without stale sound", async () => {
    const { events, tones, voice } = rig();
    const end = deferred();
    tones.play.mockImplementationOnce(async (which) => { events.push(which); });
    tones.play.mockImplementationOnce(async (which) => { events.push(which); await end.promise; });
    const speaking = voice.speak(["Meet"], () => {});
    await vi.waitFor(() => expect(tones.play).toHaveBeenCalledTimes(2));
    voice.cancel();
    await speaking;
    end.resolve();
    expect(tones.play.mock.calls[1][1].aborted).toBe(true);
    expect(tones.play).toHaveBeenCalledTimes(2);
  });

  it("propagates mute immediately for normal speech and 1202", async () => {
    const { browser, tones, voice } = rig();
    voice.muted = true;
    expect(browser.muted).toBe(true);
    expect(tones.muted).toBe(true);
    await voice.speak(["Meet"], () => {});
    await voice.alarm();
    expect(browser.muted).toBe(true);
    expect(tones.muted).toBe(true);
    voice.muted = false;
    expect(browser.muted).toBe(false);
    expect(tones.muted).toBe(false);
  });
});

describe("Quindar", () => {
  afterEach(() => vi.useRealTimers());

  it("plays distinct 250 ms sine cues with 10 ms gain ramps", async () => {
    vi.useFakeTimers();
    audio.context.state = "running";
    const tone = new Quindar();
    const first = tone.play("start", new AbortController().signal);
    expect(audio.oscillator.frequency.setValueAtTime).toHaveBeenCalledWith(2525, 10);
    expect(audio.gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.08, 10.01);
    expect(audio.gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 10.25);
    await vi.advanceTimersByTimeAsync(249);
    expect(audio.oscillator.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await first;
    expect(audio.oscillator.stop).toHaveBeenCalledTimes(1);
    const second = tone.play("end", new AbortController().signal);
    expect(audio.oscillator.frequency.setValueAtTime).toHaveBeenLastCalledWith(2475, 10);
    await vi.advanceTimersByTimeAsync(250);
    await second;
  });

  it("aborts a running cue and clears its timer and handlers", async () => {
    vi.useFakeTimers();
    audio.oscillator.stop.mockClear();
    const tone = new Quindar();
    const abort = new AbortController();
    const pending = tone.play("start", abort.signal);
    abort.abort();
    await pending;
    expect(audio.oscillator.stop).toHaveBeenCalledTimes(1);
    expect(audio.oscillator.onended).toBeNull();
    await vi.advanceTimersByTimeAsync(500);
    expect(audio.oscillator.stop).toHaveBeenCalledTimes(1);
  });

  it("skips muted and suspended cues and stops a cue when muted mid-play", async () => {
    vi.useFakeTimers();
    const tone = new Quindar();
    audio.context.createOscillator.mockClear();
    tone.muted = true;
    await tone.play("start", new AbortController().signal);
    tone.muted = false;
    audio.context.state = "suspended";
    await tone.play("start", new AbortController().signal);
    expect(audio.context.createOscillator).not.toHaveBeenCalled();
    audio.context.state = "running";
    const pending = tone.play("start", new AbortController().signal);
    tone.muted = true;
    await pending;
    expect(audio.oscillator.onended).toBeNull();
  });
});
