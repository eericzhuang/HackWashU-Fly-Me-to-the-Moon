import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserVoice } from "../../src/audio/voice";
import { CueVoice } from "../../src/audio/cueVoice";

class FakeUtterance {
  static all: FakeUtterance[] = [];
  lang = "";
  rate = 1;
  volume = 1;
  onstart: (() => void) | null = null;
  onboundary: ((event: { name: string; charIndex: number }) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly text: string) { FakeUtterance.all.push(this); }
}

const synth = {
  speaking: false,
  speak: vi.fn((_utterance: FakeUtterance) => { synth.speaking = true; }),
  cancel: vi.fn(() => { synth.speaking = false; }),
};

beforeEach(() => {
  vi.useFakeTimers();
  FakeUtterance.all.length = 0;
  synth.speaking = false;
  synth.speak.mockClear();
  synth.cancel.mockClear();
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("speechSynthesis", synth);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("BrowserVoice active mute", () => {
  it("cancels ordinary speech, settles, and ignores callbacks from the old utterance", async () => {
    const voice = new BrowserVoice();
    const words: number[] = [];
    const speaking = voice.speak(["Meet", "moon"], (i) => words.push(i));
    const old = FakeUtterance.all[0];
    const oldStart = old.onstart;
    const oldBoundary = old.onboundary;
    old.onstart?.();
    expect(words).toEqual([0]);
    const cancelsBeforeMute = synth.cancel.mock.calls.length;

    voice.muted = true;
    expect(synth.cancel).toHaveBeenCalledTimes(cancelsBeforeMute + 1);
    await speaking;
    expect(synth.speaking).toBe(false);

    voice.muted = false;
    const nextWords: number[] = [];
    const next = voice.speak(["Next"], (i) => nextWords.push(i));
    expect(FakeUtterance.all[1].volume).toBe(1);
    oldStart?.();
    oldBoundary?.({ name: "word", charIndex: 5 });
    expect(words).toEqual([0]);
    expect(nextWords).toEqual([]);
    FakeUtterance.all[1].onend?.();
    await next;
  });

  it("cancels and settles the active 1202 alarm when muted", async () => {
    const voice = new BrowserVoice();
    const alarming = voice.alarm();
    const utterance = FakeUtterance.all[0];
    expect(utterance.text).toContain("Twelve oh two alarm");
    const cancelsBeforeMute = synth.cancel.mock.calls.length;

    voice.muted = true;
    expect(synth.cancel).toHaveBeenCalledTimes(cancelsBeforeMute + 1);
    await alarming;
    expect(synth.speaking).toBe(false);
    voice.muted = false;
    const next = voice.alarm();
    expect(FakeUtterance.all[1].volume).toBe(1);
    FakeUtterance.all[1].onend?.();
    await next;
  });
});

it("settles the wrapped voice on mute without a late end cue after immediate unmute", async () => {
  const tones = { muted: false, play: vi.fn(async (_which: "start" | "end", _signal: AbortSignal) => {}) };
  const voice = new CueVoice(new BrowserVoice(), tones);
  const speaking = voice.speak(["Meet"], () => {});
  await Promise.resolve();
  expect(FakeUtterance.all).toHaveLength(1);

  voice.muted = true;
  voice.muted = false;
  await speaking;
  expect(tones.play.mock.calls.map(([which]) => which)).toEqual(["start"]);
  expect(synth.speaking).toBe(false);
});
