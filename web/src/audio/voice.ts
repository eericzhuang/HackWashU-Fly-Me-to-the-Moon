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

/** L0 voice: the browser's own speech synthesis (the radio effect comes with Cloud TTS in L1).
 *  Word timing comes from boundary events when the voice sends them, otherwise it is estimated. */
export class BrowserVoice implements Voice {
  muted = false;
  private finish: (() => void) | null = null;
  // Chrome can garbage-collect an utterance nothing references, and then never fire onend.
  private utterance: SpeechSynthesisUtterance | null = null;

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
      let estimate: ReturnType<typeof setInterval> | undefined;
      const reach = (i: number) => {
        if (i > last && i < words.length) {
          last = i;
          onWord(i);
        }
      };
      const done = () => {
        clearInterval(estimate);
        if (this.finish === done) this.finish = null;
        if (this.utterance === u) this.utterance = null;
        resolve();
      };
      u.onstart = () => {
        reach(0);
        // Some voices send no word boundaries: step at a speaking pace until one arrives.
        estimate = setInterval(() => reach(last + 1), WORD_MS);
      };
      u.onboundary = (e) => {
        if (e.name !== "word") return;
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
      setTimeout(() => {
        if (last < 0 && !speechSynthesis.speaking) done();
      }, 1500);
    });
  }
}
