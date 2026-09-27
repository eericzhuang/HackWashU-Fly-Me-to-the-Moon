import { sleep, type Voice } from "../show/director";

export const WORD_MS = 380;
export const ALARM_LINE = "Twelve oh two alarm. We're go. Read it with your own eyes.";

/** No sound: steps through the words at a speaking pace, so the highlight still moves. */
export class SilentVoice implements Voice {
  private cancelled = false;

  async speak(words: string[], onWord: (i: number) => void): Promise<void> {
    this.cancelled = false;
    for (let i = 0; i < words.length && !this.cancelled; i++) {
      onWord(i);
      await sleep(WORD_MS);
    }
  }

  async alarm(): Promise<void> {
    await sleep(2000);
  }

  cancel(): void {
    this.cancelled = true;
  }
}

/** Browser speech stays outside Web Audio. Word timing comes from boundary events when
 *  the voice sends them, otherwise it is estimated. */
export class BrowserVoice implements Voice {
  private isMuted = false;
  private finish: (() => void) | null = null;
  // Chrome can garbage-collect an utterance nothing references, and then never fire onend.
  private utterance: SpeechSynthesisUtterance | null = null;

  get muted(): boolean { return this.isMuted; }
  set muted(on: boolean) {
    this.isMuted = on;
    if (on && this.finish) this.cancel();
  }

  speak(words: string[], onWord: (i: number) => void): Promise<void> {
    return this.say(words, onWord);
  }

  alarm(): Promise<void> {
    return this.say(ALARM_LINE.split(" "), () => {});
  }

  cancel(): void {
    speechSynthesis.cancel();
    this.finish?.();
  }

  private say(words: string[], onWord: (i: number) => void): Promise<void> {
    this.cancel();
    const starts: number[] = [];
    let pos = 0;
    for (const w of words) {
      starts.push(pos);
      pos += w.length + 1;
    }
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(words.join(" "));
      u.lang = "en-US";
      u.rate = 0.95;
      u.volume = this.muted ? 0 : 1;
      let last = -1;
      let finished = false;
      let estimate: ReturnType<typeof setInterval> | undefined;
      let fallback: ReturnType<typeof setTimeout> | undefined;
      const reach = (i: number) => {
        if (!finished && i > last && i < words.length) {
          last = i;
          onWord(i);
        }
      };
      const done = () => {
        if (finished) return;
        finished = true;
        clearInterval(estimate);
        clearTimeout(fallback);
        u.onstart = null;
        u.onboundary = null;
        u.onend = null;
        u.onerror = null;
        if (this.finish === done) this.finish = null;
        if (this.utterance === u) this.utterance = null;
        resolve();
      };
      u.onstart = () => {
        if (finished) return;
        reach(0);
        // Some voices send no word boundaries: step at a speaking pace until one arrives.
        estimate = setInterval(() => reach(last + 1), WORD_MS);
      };
      u.onboundary = (e) => {
        if (finished || e.name !== "word") return;
        clearInterval(estimate);
        let i = 0;
        while (i + 1 < starts.length && starts[i + 1] <= e.charIndex) i++;
        reach(i);
      };
      u.onend = done;
      u.onerror = done;
      this.finish = done;
      this.utterance = u;
      speechSynthesis.speak(u);
      // Without a user gesture Chrome drops speech silently; never hang the show on it.
      if (!finished) {
        fallback = setTimeout(() => {
          if (last < 0 && !speechSynthesis.speaking) done();
        }, 1500);
      }
    });
  }
}
