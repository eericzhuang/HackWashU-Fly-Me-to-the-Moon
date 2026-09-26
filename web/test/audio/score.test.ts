import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToneScore } from "../../src/audio/score";

const tone = vi.hoisted(() => {
  const nodes: FakeNode[] = [];
  class FakeNode {
    frequency = { rampTo: vi.fn() };
    volume = { rampTo: vi.fn() };
    pan = { rampTo: vi.fn() };
    triggerAttack = vi.fn();
    triggerAttackRelease = vi.fn();
    releaseAll = vi.fn();
    start = vi.fn();
    mute = false;
    constructor(..._args: unknown[]) { nodes.push(this); }
    connect() { return this; }
    toDestination() { return this; }
  }
  return { nodes, FakeNode, start: vi.fn(async () => {}) };
});

vi.mock("tone", () => ({
  start: tone.start,
  Volume: tone.FakeNode, Reverb: tone.FakeNode, Filter: tone.FakeNode,
  PolySynth: tone.FakeNode, Synth: tone.FakeNode, FMSynth: tone.FakeNode,
  MonoSynth: tone.FakeNode, Noise: tone.FakeNode, Panner: tone.FakeNode,
}));

beforeEach(() => {
  vi.useFakeTimers();
  tone.nodes.length = 0;
  tone.start.mockReset().mockResolvedValue(undefined);
});

describe("ToneScore", () => {
  it("creates no audio nodes before arm and resumes the current LED chord", async () => {
    const score = new ToneScore();
    score.ledOn(2);
    expect(tone.nodes).toHaveLength(0);
    const arming = score.arm();
    expect(tone.start).toHaveBeenCalledTimes(1);
    await arming;
    expect(tone.nodes.length).toBeGreaterThan(0);
    expect(tone.nodes.some((node) => node.triggerAttack.mock.calls.some(([notes]) =>
      Array.isArray(notes) && notes.join() === "D3,F3,A3,C4"))).toBe(true);
    vi.useRealTimers();
  });

  it("ignores invalid LED indices", async () => {
    const score = new ToneScore();
    await score.arm();
    const attacksBefore = tone.nodes.reduce((n, node) => n + node.triggerAttack.mock.calls.length, 0);
    score.ledOn(-1);
    score.ledOn(4);
    expect(tone.nodes.reduce((n, node) => n + node.triggerAttack.mock.calls.length, 0)).toBe(attacksBefore);
    vi.useRealTimers();
  });

  it("stays silent if the browser denies Tone.start", async () => {
    tone.start.mockRejectedValueOnce(new Error("denied"));
    const score = new ToneScore();
    await expect(score.arm()).rejects.toThrow("denied");
    expect(tone.nodes).toHaveLength(0);
    vi.useRealTimers();
  });

  it("stops combining pulses when muted or moved to idle", async () => {
    const score = new ToneScore();
    await score.arm();
    score.combining();
    await vi.advanceTimersByTimeAsync(2000);
    const pulses = () => tone.nodes.reduce((n, node) => n + node.triggerAttackRelease.mock.calls.length, 0);
    expect(pulses()).toBeGreaterThan(0);
    score.mute(true);
    const beforeMute = pulses();
    await vi.advanceTimersByTimeAsync(5000);
    expect(pulses()).toBe(beforeMute);
    score.mute(false);
    score.idle();
    const beforeIdle = pulses();
    await vi.advanceTimersByTimeAsync(5000);
    expect(pulses()).toBe(beforeIdle);
    vi.useRealTimers();
  });

  it("sustains the resolved chord when reveal becomes hold", async () => {
    const score = new ToneScore();
    await score.arm();
    score.reveal();
    const attacks = () => tone.nodes.reduce((n, node) => n + node.triggerAttack.mock.calls.length, 0);
    const beforeHold = attacks();
    score.hold();
    expect(attacks()).toBe(beforeHold);
    vi.useRealTimers();
  });
});
