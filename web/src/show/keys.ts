export interface KeyActions {
  arm(): void;
  skip(): void;
  replay(): void;
  idle(): void;
  mute(): void;
  fullscreen(): void;
  dev(): void;
  /** Arrows, Enter, PageUp/PageDown and 1-9, for the step pages and the alignment review. */
  panel?(key: string, shift: boolean): void;
}

const PANEL_KEYS = /^(Arrow(Left|Right|Up|Down)|Enter|Page(Up|Down)|[1-9])$/;

/** Browsers block sound until the user does something, so the first key (or click) only arms audio.
 *  After that: Space skip, R replay, Esc idle, M mute, F fullscreen, D tuning panel;
 *  arrows / Enter / 1-9 go to the panels (arrows may repeat while held, to nudge). */
export function bindKeys(target: EventTarget, a: KeyActions): void {
  let armed = false;
  const arm = (): boolean => {
    if (armed) return false;
    armed = true;
    a.arm();
    return true;
  };
  target.addEventListener("pointerdown", () => {
    arm();
  });
  target.addEventListener("keydown", (ev) => {
    const e = ev as KeyboardEvent;
    if (arm()) return;
    // Cmd/Ctrl+R must still reload the page, Cmd+F must still search, and holding a key must not repeat it.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (a.panel && PANEL_KEYS.test(e.key)) {
      if (e.repeat && !e.key.startsWith("Arrow")) return;
      e.preventDefault();
      a.panel(e.key, e.shiftKey);
      return;
    }
    if (e.repeat) return;
    switch (e.key) {
      case " ":
        e.preventDefault();
        a.skip();
        break;
      case "r":
      case "R":
        a.replay();
        break;
      case "Escape":
        a.idle();
        break;
      case "m":
      case "M":
        a.mute();
        break;
      case "f":
      case "F":
        a.fullscreen();
        break;
      case "d":
      case "D":
        a.dev();
        break;
    }
  });
}
