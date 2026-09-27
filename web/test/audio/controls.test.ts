import { describe, expect, it, vi } from "vitest";
import { audioKeyActions } from "../../src/audio/controls";

describe("audioKeyActions", () => {
  it("arms the director and toggles the same mute state for score and voice", () => {
    const director = { arm: vi.fn() };
    const sound = { mute: vi.fn() };
    const voice = { muted: false };
    const actions = audioKeyActions(director, sound, voice);

    actions.arm();
    expect(director.arm).toHaveBeenCalledTimes(1);

    actions.mute();
    expect(sound.mute).toHaveBeenLastCalledWith(true);
    expect(voice.muted).toBe(true);

    actions.mute();
    expect(sound.mute.mock.calls).toEqual([[true], [false]]);
    expect(voice.muted).toBe(false);
  });
});
