import { describe, expect, it, vi } from "vitest";
import { bindKeys, type KeyActions } from "../../src/show/keys";

function actions() {
  return { arm: vi.fn(), skip: vi.fn(), replay: vi.fn(), idle: vi.fn(), mute: vi.fn(), fullscreen: vi.fn(), dev: vi.fn() } satisfies KeyActions;
}

function press(
  target: EventTarget,
  key: string,
  extra: Partial<Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey" | "repeat">> = {},
): Event {
  const e = Object.assign(new Event("keydown", { cancelable: true }), { key, ...extra });
  target.dispatchEvent(e);
  return e;
}

describe("bindKeys", () => {
  it("the first key only arms audio; later keys drive the show", () => {
    const t = new EventTarget();
    const a = actions();
    bindKeys(t, a);

    press(t, " ");
    expect(a.arm).toHaveBeenCalledTimes(1);
    expect(a.skip).not.toHaveBeenCalled();

    const e = press(t, " ");
    expect(a.skip).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true); // Space must not scroll the page

    press(t, "r");
    press(t, "Escape");
    press(t, "M");
    press(t, "f");
    press(t, "x"); // unbound: ignored
    expect(a.replay).toHaveBeenCalledTimes(1);
    expect(a.idle).toHaveBeenCalledTimes(1);
    expect(a.mute).toHaveBeenCalledTimes(1);
    expect(a.fullscreen).toHaveBeenCalledTimes(1);
    expect(a.arm).toHaveBeenCalledTimes(1);
  });

  it("a click also arms", () => {
    const t = new EventTarget();
    const a = actions();
    bindKeys(t, a);
    t.dispatchEvent(new Event("pointerdown"));
    expect(a.arm).toHaveBeenCalledTimes(1);
    press(t, " ");
    expect(a.skip).toHaveBeenCalledTimes(1);
  });

  it("ignores modified and repeated key presses; a plain key still drives the show", () => {
    const t = new EventTarget();
    const a = actions();
    bindKeys(t, a);
    press(t, " "); // arm

    press(t, "r", { ctrlKey: true });
    press(t, "r", { metaKey: true });
    press(t, "r", { altKey: true });
    press(t, "r", { repeat: true });
    expect(a.replay).not.toHaveBeenCalled();

    press(t, "r");
    expect(a.replay).toHaveBeenCalledTimes(1);
  });

  it("D opens the tuning panel", () => {
    const t = new EventTarget();
    const a = actions();
    bindKeys(t, a);
    press(t, " "); // arm
    press(t, "d");
    press(t, "D");
    expect(a.dev).toHaveBeenCalledTimes(2);
  });
});
