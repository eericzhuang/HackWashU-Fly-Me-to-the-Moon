import { describe, expect, it, vi } from "vitest";
import { createPanelToggle } from "../../src/dev/panelToggle";

interface Panel { destroy(): void }

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("createPanelToggle", () => {
  it("ignores repeated toggles while the panel module is loading", async () => {
    const pending = deferred<{ open(): Panel }>();
    const panel: Panel = { destroy: vi.fn() };
    const open = vi.fn(() => panel);
    const load = vi.fn(() => pending.promise);
    const toggle = createPanelToggle(true, load);

    const first = toggle();
    const second = toggle();
    expect(load).toHaveBeenCalledTimes(1);
    pending.resolve({ open });
    await Promise.all([first, second]);

    expect(open).toHaveBeenCalledTimes(1);
    await toggle();
    expect(panel.destroy).toHaveBeenCalledTimes(1);
    await toggle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("resets after a failed import and consumes the rejection", async () => {
    const panel: Panel = { destroy: vi.fn() };
    const open = vi.fn(() => panel);
    const onError = vi.fn();
    const load = vi.fn()
      .mockRejectedValueOnce(new Error("chunk failed"))
      .mockResolvedValueOnce({ open });
    const toggle = createPanelToggle(true, load, onError);

    await expect(toggle()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    await toggle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledOnce();
  });
});
