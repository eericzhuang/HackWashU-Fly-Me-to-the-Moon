import { sleep, type Voice } from "../show/director";

export const WORD_MS = 380;

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
