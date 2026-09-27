import * as Tone from "tone";

export type QuindarKind = "start" | "end";

/** Two brief local cues on the same audio context as the lunar score. */
export class Quindar {
  private isMuted = false;
  private readonly active = new Set<() => void>();

  get muted(): boolean { return this.isMuted; }
  set muted(on: boolean) {
    this.isMuted = on;
    if (on) for (const finish of [...this.active]) finish();
  }

  play(which: QuindarKind, signal: AbortSignal): Promise<void> {
    if (this.isMuted || signal.aborted) return Promise.resolve();
    const context = Tone.getContext();
    if (context.state !== "running") return Promise.resolve();

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const at = context.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(which === "start" ? 2525 : 2475, at);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.08, at + 0.01);
    gain.gain.setValueAtTime(0.08, at + 0.24);
    gain.gain.linearRampToValueAtTime(0, at + 0.25);
    oscillator.connect(gain);
    gain.connect(context.rawContext.destination);

    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        oscillator.onended = null;
        this.active.delete(finish);
        try { oscillator.stop(); } catch { /* already stopped by the audio context */ }
        oscillator.disconnect();
        gain.disconnect();
        resolve();
      };
      oscillator.onended = finish;
      signal.addEventListener("abort", finish, { once: true });
      this.active.add(finish);
      oscillator.start(at);
      timer = setTimeout(finish, 250);
      if (signal.aborted || this.isMuted) finish();
    });
  }
}
