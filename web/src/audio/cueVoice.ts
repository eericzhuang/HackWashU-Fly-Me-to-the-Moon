import type { Voice } from "../show/director";
import type { Quindar } from "./quindar";

type MutableVoice = Voice & { muted: boolean };
type TonePort = Pick<Quindar, "play" | "muted">;

/** Adds local radio cue tones without changing browser speech or its word timing. */
export class CueVoice implements Voice {
  private generation = 0;
  private current?: { generation: number; abort: AbortController; resolve: () => void };

  constructor(private readonly browser: MutableVoice, private readonly tones: TonePort) {}

  get muted(): boolean { return this.browser.muted; }
  set muted(on: boolean) {
    this.browser.muted = on;
    this.tones.muted = on;
  }

  speak(words: string[], onWord: (i: number) => void): Promise<void> {
    return this.run((generation) => this.browser.speak(words, (i) => {
      if (this.current?.generation === generation) onWord(i);
    }));
  }

  alarm(): Promise<void> {
    return this.run(() => this.browser.alarm());
  }

  cancel(): void {
    this.generation++;
    const current = this.current;
    this.current = undefined;
    current?.abort.abort();
    this.browser.cancel();
    current?.resolve();
  }

  private run(speech: (generation: number) => Promise<void>): Promise<void> {
    if (this.current) this.cancel();
    const generation = ++this.generation;
    const abort = new AbortController();
    return new Promise<void>((resolve) => {
      this.current = { generation, abort, resolve };
      const live = () => this.current?.generation === generation;
      void (async () => {
        try {
          await this.tones.play("start", abort.signal);
          if (!live()) return;
          await speech(generation);
          if (!live()) return;
          await this.tones.play("end", abort.signal);
        } catch (error) {
          if (live()) console.error("voice cue failed:", error);
        } finally {
          if (live()) {
            this.current = undefined;
            resolve();
          }
        }
      })();
    });
  }
}
