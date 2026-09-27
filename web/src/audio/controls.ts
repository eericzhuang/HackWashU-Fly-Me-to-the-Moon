import type { Soundtrack } from "../show/director";

/** Actions shared by the 3D and CSS stages. The first input arms the Director. */
export function audioKeyActions(director: { arm(): void }, sound: Pick<Soundtrack, "mute">, voice: { muted: boolean }) {
  let muted = false;
  return {
    arm: () => director.arm(),
    mute: () => {
      muted = !muted;
      sound.mute(muted);
      voice.muted = muted;
    },
  };
}
